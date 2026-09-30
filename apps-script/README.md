# CSE Sweatshirt Art Contest — submission site

Google Apps Script web app. A signed-in @ucsd.edu user enters their name and uploads a PNG or PDF.
The file goes to the contest Drive folder; a metadata row goes to the contest spreadsheet.

## Files (`apps-script/`)
- `Code.gs` — server: auth check, validation, Drive upload, Sheet logging. IDs and the `CONFIG` rules are constants at the top.
- `Index.html` — the form.
- `appsscript.json` — manifest: runs as the deploying user, access limited to the owner's Workspace domain.

## Deploy
1. Signed in as your **@ucsd.edu** account, go to https://script.google.com → New project.
2. Project Settings → check "Show appsscript.json manifest file in editor".
3. Replace `Code.gs` and `appsscript.json` contents with the files here; add an HTML file named `Index` and paste `Index.html`.
4. Run `doGet` once from the editor to grant Drive/Sheets/email permissions.
5. Deploy → New deployment → Web app. Execute as: **Me**. Who has access: **Anyone within UC San Diego**.
6. Share the `/exec` URL.

(Alternative: `npm i -g @google/clasp`, `clasp create --type webapp --rootDir apps-script`, `clasp push`.)

## Sheet columns
Timestamp, Email, Name, File name, File ID, File URL, MIME type, Size (bytes), Dimensions. The header row is written on the first submission if the sheet is empty.

## Notes
- Authentication is Google's: the "within UC San Diego" access setting forces a ucsd.edu login; `Code.gs` also re-checks the `@ucsd.edu` suffix server-side.
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
