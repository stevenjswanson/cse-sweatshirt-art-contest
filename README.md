# CSE Sweatshirt Art Contest — submission site

Google Apps Script web app. A signed-in @ucsd.edu user enters their name and uploads a PNG or PDF.
The file goes to the contest Drive folder; a metadata row goes to the contest spreadsheet.

## Status
- Server logic passes the local tests (`tests/`), which run the real `Code.gs` against fake Google services.
- **Not yet deployed or run inside Apps Script.** Unverified there: the pinned `oauthScopes` (Google's reference docs were unreachable when they were written), `Session.getActiveUser()` returning the email under "Execute as: Me", pdf.js loading from jsdelivr inside the HtmlService iframe, and upload behavior near the 10 MB cap. `diagnose()` exercises the Drive and Sheets scopes; a submission from `/dev` exercises the rest.
- Styling has not been done yet (intentionally deferred).

## Layout
- `apps-script/` — the Apps Script project. `.claspignore` is an allowlist: only `appsscript.json`, `Code.gs`, `Index.html` are pushed.
- `tests/` — Node tests (not pushed).
- `scripts/first-deploy.sh` — one-time project creation and first deployment.
- `scripts/safe-deploy.sh` — release script (push → verify → version → update the existing deployment).

## Files (`apps-script/`)
- `Code.gs` — server: auth, validation, Drive upload, Sheet logging. `CONFIG` (file rules) and `COLS` (sheet headers) are at the top. `setupSheets()` and `diagnose()` are owner-only and meant to be run from the editor.
- `Index.html` — the form.
- `appsscript.json` — manifest: runs as the deploying user, access limited to the owner's Workspace domain, scopes pinned (Drive, Sheets, userinfo.email).

## Script Properties (required)
The repo is public, so resource ids are not in the code. Set these under Project Settings → Script Properties:

| Property | Value |
|---|---|
| `FOLDER_ID` | id of the Drive folder that receives uploads (the part after `/folders/` in its URL) |
| `SPREADSHEET_ID` | id of the metadata spreadsheet (the part after `/d/` in its URL) |

The deploying account needs permission to add files to the folder (it appears to be in a shared drive) and to edit the sheet.

## First deployment (clasp v3)
`scripts/first-deploy.sh` (run from the repo root) does the steps below with pauses for the editor steps. It refuses to run if `apps-script/.clasp.json` exists.

Prerequisites: enable the Apps Script API at https://script.google.com/home/usersettings; `npm i -g @google/clasp`; `clasp login` as your **@ucsd.edu** account; `clasp --version` shows 3.x.

```bash
cd apps-script
clasp create-script --title "CSE Sweatshirt Art Contest" --type standalone --rootDir .
git checkout appsscript.json      # create-script overwrites the manifest; restore ours
clasp status                      # must list only appsscript.json, Code.gs, Index.html
clasp push -f
```
Then in the editor (`clasp open-script`):
1. Set the two Script Properties above.
2. Run `setupSheets` (first in the Run menu). Accept the permission prompt. It creates the `Sheet1` tab if missing and appends any missing headers; it never reorders or deletes.
3. Run `diagnose` and read the log: folder reachable, every column resolved, no `MISSING`/`ERROR`.
4. Open `https://script.google.com/macros/s/<SCRIPT_ID>/dev` (serves the pushed code; editors only) and submit a test PNG and PDF. Check the Drive folder and sheet, then delete the test rows/files.

Then create the one production deployment:
```bash
clasp create-version "initial"
clasp create-deployment --versionNumber 1 --description "prod"
clasp list-deployments --json     # confirm the prod deployment has a versionNumber (pinned)
```
Record the deployment id below. **Never run `create-deployment` again** — a new deployment is a new URL.

| Deployment | Id | Access |
|---|---|---|
| prod | _(fill in)_ | Anyone within UC San Diego (`DOMAIN`) |

Public URL (domain-scoped form; the plain `/macros/s/…/exec` form may 404 for a domain app):
`https://script.google.com/a/macros/ucsd.edu/s/<DEPLOYMENT_ID>/exec`

Verify on `/exec` from a second @ucsd.edu account (not the owner) and from a non-UCSD account, which should get a Google sign-in wall rather than the form.

## Releasing a change
```bash
cd apps-script
../scripts/safe-deploy.sh <DEPLOYMENT_ID> "what changed"
```
It shows what will be pushed, pushes to HEAD (users unaffected), stops while you run `diagnose()` in the editor and/or try `/dev`, and only on `yes` creates a version and points the existing deployment at it.

## Rollback
```bash
clasp update-deployment <DEPLOYMENT_ID> --versionNumber <previous>
```
Versions are immutable, so this is immediate and complete.

## Changing OAuth scopes
Scopes are pinned in `appsscript.json`, so adding one does not re-prompt for consent. To re-consent: remove the `oauthScopes` block, push, run any function in the editor and accept, restore the block, push again.

## Sheet columns
Timestamp (ISO 8601 with offset, America/Los_Angeles), Email, Name, File name, File ID, File URL, MIME type, Size (bytes), Dimensions. Columns are located by header text in row 1 (`COLS` in `Code.gs`), so they can be reordered and extra columns added. Renaming a header breaks submissions until `COLS` is updated; the check runs before the file is saved to Drive. User text starting with `= + - @` is prefixed with `'` so it is not evaluated as a formula.

## Security notes
- Identity comes only from `Session.getActiveUser()`, never `getEffectiveUser()` (which is the owner under "Execute as: Me"). The server re-checks the `@ucsd.edu` suffix on every submission.
- Callable from the page via `google.script.run`: `submitEntry` (domain users), `setupSheets` and `diagnose` (refuse anyone but the deploying account).
- Because the app runs as the deployer, submitters need no access to the folder or sheet.
- Files are sent base64-encoded through `google.script.run`; capped at 10 MB.

## File rules (`CONFIG` in `Code.gs`)
| Setting | Default | Applies to |
|---|---|---|
| `aspectRatio` | 1:1 (orientation matters for non-square ratios) | PNG, every PDF page |
| `aspectTolerance` | 0.01 (1%) | PNG, PDF |
| `pngMinWidth` / `pngMinHeight` | 1024 / 1024 | PNG |
| `maxBytes` | 10 MB | both |

- File type is decided from the file's first bytes (PNG signature / `%PDF-`), not its name or reported type.
- PNG dimensions are checked in the browser and again on the server (read from the PNG header).
- PDF page sizes are measured in the browser with pdf.js (loaded from cdn.jsdelivr.net), using the displayed page box with rotation applied. The server checks the sizes the browser reports but does not parse the PDF itself, so a user who alters the page's JavaScript could get past the PDF aspect check.

## Tests
```
cd tests && npm install && npm test
```
- `make_fixtures.py` generates synthetic PNGs and PDFs into `tests/fixtures/` (git-ignored).
- `check.js` checks `pngSize_`, `isPdf_`, `aspectOk_` against the fixtures and measures the PDFs with the same pdf.js version (3.11.174) that `Index.html` loads.
- `server.test.js` runs `Code.gs` in a Node `vm` with fakes from `gas-harness.js`: auth (including the `getEffectiveUser` bypass), header-name writes, formula escaping, write allowlist, owner-only functions, `setupSheets` idempotence, `diagnose` output.
- Not covered: real Google services, `google.script.run` transport, and the browser code in `Index.html`.
