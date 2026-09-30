# Project memory

CSE Sweatshirt Art Contest submission site: Google Apps Script web app. See README.md for deploy steps, config, and tests.

## Decisions (made with the user)
- Accept **PNG and PDF only**. Aspect ratio default **1:1**; PNG minimum default **1024x1024**. All configurable via `CONFIG` in `apps-script/Code.gs`.
- Choices Claude made that the user did not specify (change if they object): 1% aspect tolerance; orientation matters for non-square ratios; every PDF page must match; no minimum size for PDFs.
- Deploy as "Execute as: Me" + "Anyone within UC San Diego"; server re-checks `@ucsd.edu`.
- Styling deferred until basic functionality works.

## Known limitations
- PDF page sizes are measured client-side (pdf.js 3.11.174 from cdn.jsdelivr.net); server trusts them. PNG dimensions are verified server-side from the IHDR chunk.
- Nothing has been run inside Apps Script yet; see README "Status".

## Conventions
- Keep `CONFIG` as the single source of rules; `Index.html` receives it via the template.
- Run `cd tests && npm test` after changing validation logic.
- Scratch work goes in `scratch/` (git-ignored), not /tmp.
- The user's preferences: brief answers, no speculation, flag anything unverified.
