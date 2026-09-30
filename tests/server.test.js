// Runs the real apps-script/Code.gs in a Node vm with fake Google services
// (gas-harness.js) and checks auth, writes, and owner-only functions.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load } = require('./gas-harness');

const CODE = path.join(__dirname, '../apps-script/Code.gs');
const HEADERS = ['Timestamp', 'Email', 'Name', 'File name', 'File ID', 'File URL', 'MIME type', 'Size (bytes)', 'Dimensions'];
const PNG_OK = fs.readFileSync(path.join(__dirname, 'fixtures/p_1024x1024.png')).toString('base64');
const PNG_WIDE = fs.readFileSync(path.join(__dirname, 'fixtures/p_2048x1024.png')).toString('base64');
const PDF = fs.readFileSync(path.join(__dirname, 'fixtures/d_square.pdf')).toString('base64');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}
function throws(fn) {
  try { fn(); return null; } catch (e) { return e.message; }
}

function build(overrides) {
  return load(CODE, Object.assign({
    sheets: { Sheet1: [HEADERS.slice()] },
    activeUser: 'artist@ucsd.edu',
    effectiveUser: 'owner@ucsd.edu',
    properties: { SPREADSHEET_ID: 'SHEET', FOLDER_ID: 'FOLDER' },
    folders: { FOLDER: 'Contest uploads' },
  }, overrides || {}));
}
const entry = (o) => Object.assign({ name: 'Ada', fileName: 'art.png', base64: PNG_OK }, o);

// --- Identity -------------------------------------------------------------
{
  // Signed out, while getEffectiveUser() is a ucsd.edu owner: must not pass.
  const app = build({ activeUser: '' });
  ok('signed-out viewer is nobody', app.viewerEmail_() === '');
  ok('signed-out submit rejected', /signed in/.test(throws(() => app.submitEntry(entry())) || ''));
  ok('empty email not allowed', app.isAllowed_('') === false);
  ok('other domain not allowed', app.isAllowed_('x@gmail.com') === false);
  ok('lookalike domain not allowed', app.isAllowed_('x@notucsd.edu') === false);
  ok('email is trimmed and lowercased', build({ activeUser: '  Ada@UCSD.edu ' }).viewerEmail_() === 'ada@ucsd.edu');
}

// --- Successful submissions ------------------------------------------------
{
  const app = build();
  const res = app.submitEntry(entry());
  const rows = app.sheetRows('Sheet1');
  const files = app.driveFiles();
  ok('PNG: one row appended', rows.length === 2);
  ok('PNG: one Drive file created', files.length === 1 && files[0].folderId === 'FOLDER');
  ok('PNG: returned name matches file', res.fileName === files[0].name);
  ok('PNG: email column', rows[1][1] === 'artist@ucsd.edu');
  ok('PNG: dimensions column', rows[1][8] === '1024x1024 px', rows[1][8]);
  ok('PNG: timestamp is an ISO string', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[-+]\d\d:\d\d$/.test(rows[1][0]), rows[1][0]);

  const app2 = build();
  app2.submitEntry(entry({ fileName: 'art.pdf', base64: PDF, pdfPageSizes: [{ width: 500, height: 500 }] }));
  ok('PDF: stored as application/pdf', app2.driveFiles()[0].mimeType === 'application/pdf');
}

// --- Columns by header name -------------------------------------------------
{
  // Columns reordered and an extra column added by a human.
  const shuffled = ['Notes', 'Email', 'Timestamp', 'Name', 'Dimensions', 'File name', 'File ID', 'File URL', 'MIME type', 'Size (bytes)'];
  const app = build({ sheets: { Sheet1: [shuffled] } });
  app.submitEntry(entry());
  const row = app.sheetRows('Sheet1')[1];
  ok('writes by header name', row[0] === '' && row[1] === 'artist@ucsd.edu' && row[3] === 'Ada', JSON.stringify(row));

  const missing = build({ sheets: { Sheet1: [HEADERS.filter((h) => h !== 'Email')] } });
  ok('missing header throws', /no column named "Email"/.test(throws(() => missing.submitEntry(entry())) || ''));
  ok('missing header leaves no orphan Drive file', missing.driveFiles().length === 0);

  const lower = build({ sheets: { sheet1: [HEADERS.slice()] } });
  lower.submitEntry(entry());
  ok('tab lookup ignores case', lower.sheetRows('sheet1').length === 2);
}

// --- Rejections -------------------------------------------------------------
{
  const app = build();
  ok('wrong aspect PNG rejected', /aspect ratio/.test(throws(() => app.submitEntry(entry({ base64: PNG_WIDE }))) || ''));
  ok('PDF without page sizes rejected', /page sizes/.test(throws(() => app.submitEntry(entry({ base64: PDF }))) || ''));
  ok('PDF with bad page rejected', /page 2/.test(throws(() => app.submitEntry(entry({ base64: PDF,
    pdfPageSizes: [{ width: 1, height: 1 }, { width: 612, height: 792 }] }))) || ''));
  ok('PDF with non-numeric size rejected', /page 1/.test(throws(() => app.submitEntry(entry({ base64: PDF,
    pdfPageSizes: [{ width: 'x', height: 'x' }] }))) || ''));
  ok('non-PNG/PDF rejected', /Only PNG and PDF/.test(throws(() => app.submitEntry(entry({ base64: Buffer.from('GIF89a......').toString('base64') }))) || ''));
  ok('blank name rejected', /name/.test(throws(() => app.submitEntry(entry({ name: '  ' }))) || ''));
  ok('nothing written after rejections', app.sheetRows('Sheet1').length === 1 && app.driveFiles().length === 0);

  const noProps = build({ properties: {} });
  ok('missing script property named in error', /SPREADSHEET_ID/.test(throws(() => noProps.submitEntry(entry())) || ''));
}

// --- Formula injection --------------------------------------------------------
{
  const app = build();
  app.submitEntry(entry({ name: '=HYPERLINK("http://x","y")' }));
  ok('name starting with = is escaped', app.sheetRows('Sheet1')[1][2].charAt(0) === "'");
  ok('safeCell_ escapes leading -', app.safeCell_('-1').charAt(0) === "'");
  ok('safeCell_ leaves ordinary text', app.safeCell_('Ada') === 'Ada');
}

// --- Write allowlist ----------------------------------------------------------
{
  const app = build({ sheets: { Sheet1: [HEADERS.slice()], Other: [['x']] } });
  ok('refuses non-allowlisted sheet', !!throws(() => app.writableSheet_('Other')));
}

// --- Owner-only functions -----------------------------------------------------
{
  const user = build();
  ok('diagnose refused for non-owner', /owner/.test(throws(() => user.diagnose()) || ''));
  ok('setupSheets refused for non-owner', /owner/.test(throws(() => user.setupSheets()) || ''));
  ok('diagnose refused when signed out', /owner/.test(throws(() => build({ activeUser: '' }).diagnose()) || ''));

  const owner = build({ activeUser: 'owner@ucsd.edu', sheets: {} });
  owner.setupSheets();
  ok('setupSheets creates tab with headers', JSON.stringify(owner.sheetRows('Sheet1')) === JSON.stringify([HEADERS]),
    JSON.stringify(owner.sheetRows('Sheet1')));
  owner.setupSheets();
  ok('setupSheets is idempotent', owner.sheetRows('Sheet1')[0].length === HEADERS.length);

  const partial = build({ activeUser: 'owner@ucsd.edu', sheets: { Sheet1: [['Email', 'Notes']] } });
  partial.setupSheets();
  const hdr = partial.sheetRows('Sheet1')[0];
  ok('setupSheets appends only missing headers, keeps order', hdr[0] === 'Email' && hdr[1] === 'Notes' && hdr.length === HEADERS.length + 1,
    JSON.stringify(hdr));

  const report = build({ activeUser: 'owner@ucsd.edu' }).diagnose();
  ok('diagnose reports folder', /Contest uploads/.test(report));
  ok('diagnose reports every column', HEADERS.every((h) => report.indexOf(h + ': column') !== -1), report);
  const bad = build({ activeUser: 'owner@ucsd.edu', properties: { SPREADSHEET_ID: 'SHEET' },
    sheets: { Sheet1: [['Email']] } }).diagnose();
  ok('diagnose flags missing property and headers', /MISSING script property FOLDER_ID/.test(bad) && /Name: MISSING/.test(bad), bad);
}

// --- Template JSON ------------------------------------------------------------
{
  const app = build();
  const json = app.toJson_({ s: '</script>' + String.fromCharCode(0x2028) });
  ok('toJson_ escapes < and U+2028', json.indexOf('<') === -1 && json.indexOf(String.fromCharCode(0x2028)) === -1);
  ok('toJson_ round-trips', JSON.parse(json).s === '</script>' + String.fromCharCode(0x2028));
  ok('CONFIG is reachable', vm.runInContext('CONFIG.pngMinWidth', app) === 1024);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
