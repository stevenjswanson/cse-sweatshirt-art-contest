# Project memory

CSE Sweatshirt Art Contest submission site: Google Apps Script web app. See README.md for deploy steps, config, and tests.

## Decisions (made with the user)
- Accept **PNG and PDF only**. Aspect ratio default **1:1**; PNG minimum default **1024x1024**. All configurable via `CONFIG` in `apps-script/Code.gs`.
- Choices Claude made that the user did not specify (change if they object): 1% aspect tolerance; orientation matters for non-square ratios; every PDF page must match; no minimum size for PDFs.
- Deploy as "Execute as: Me" + "Anyone within UC San Diego"; server re-checks `@ucsd.edu`.
- Deployment follows the apps-script-webapp skill: clasp v3, `.claspignore` allowlist, one pinned prod deployment updated via `scripts/safe-deploy.sh` (never `create-deployment` again).
- Repo is public: Drive folder / spreadsheet ids live in Script Properties (`FOLDER_ID`, `SPREADSHEET_ID`), not in code. (Earlier commits contain them.)
- Styling deferred until basic functionality works.

## Known limitations
- PDF page sizes are measured client-side (pdf.js 3.11.174 from cdn.jsdelivr.net); server trusts them. PNG dimensions are verified server-side from the IHDR chunk.
- Nothing has been run inside Apps Script yet; see README "Status". Pinned `oauthScopes` were not checked against Google docs (developers.google.com blocked from the cloud env).

## Conventions
- Keep `CONFIG` as the single source of rules; `Index.html` receives it via the template.
- Run `cd tests && npm test` after changing server logic (`server.test.js` uses `gas-harness.js`, a Node vm with fake Google services).
- Identity: only `Session.getActiveUser()`; never `getEffectiveUser()` for the viewer. Any new unsuffixed function in `Code.gs` is callable via `google.script.run` — gate it.
- Sheet columns are addressed by header name via `COLS`; add new columns there and run `setupSheets()`.
- Scratch work goes in `scratch/` (git-ignored), not /tmp.
- The user's preferences: brief answers, no speculation, flag anything unverified.
