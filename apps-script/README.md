# CSE Sweatshirt Art Contest — submission site

Google Apps Script web app. A signed-in @ucsd.edu user enters their name and uploads an image.
The image goes to the contest Drive folder; a metadata row goes to the contest spreadsheet.

## Files (`apps-script/`)
- `Code.gs` — server: auth check, validation, Drive upload, Sheet logging. IDs are constants at the top.
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
Timestamp, Email, Name, File name, File ID, File URL, MIME type, Size (bytes). The header row is written on the first submission if the sheet is empty.

## Notes
- Authentication is Google's: the "within UC San Diego" access setting forces a ucsd.edu login; `Code.gs` also re-checks the `@ucsd.edu` suffix server-side.
- Because the app runs as the deployer, submitters need no access to the folder or sheet.
- Images are sent base64-encoded through `google.script.run`; capped at 10 MB.
