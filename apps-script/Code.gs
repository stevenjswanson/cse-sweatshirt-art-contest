// Kept first on purpose: the editor's Run dropdown preselects the first function.
/**
 * Owner-only, idempotent. Creates the submissions tab if missing and appends any
 * missing headers from COLS. Never reorders or deletes. Run after changing COLS.
 */
function setupSheets() {
  requireOwner_();
  const book = book_();
  let sheet = findSheet_(book, SHEET_NAME);
  if (!sheet) sheet = book.insertSheet(SHEET_NAME);
  const map = headerMap_(sheet);
  const missing = headerNames_().filter(function (h) { return !map[h]; });
  if (missing.length) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
  }
  const msg = missing.length ? 'Added headers: ' + missing.join(', ') : 'Headers already present.';
  Logger.log(msg);
  return msg;
}

/**
 * Owner-only, read-only. Returns a text report to read in the editor after
 * `clasp push` and before cutting a version.
 */
function diagnose() {
  requireOwner_();
  const lines = [];
  const props = PropertiesService.getScriptProperties();
  const tz = Session.getScriptTimeZone();
  lines.push('Owner: ' + ownerEmail_());
  lines.push('Timezone: ' + tz + '; sample timestamp: ' + nowIso_());
  lines.push('CONFIG: ' + JSON.stringify(CONFIG));

  const folderId = props.getProperty(PROPS.FOLDER_ID);
  if (!folderId) {
    lines.push('Folder: MISSING script property ' + PROPS.FOLDER_ID);
  } else {
    try {
      lines.push('Folder: "' + DriveApp.getFolderById(folderId).getName() + '" (reachable)');
    } catch (e) {
      lines.push('Folder: ERROR ' + e.message);
    }
  }

  try {
    const sheet = findSheet_(book_(), SHEET_NAME);
    if (!sheet) {
      lines.push('Sheet: tab "' + SHEET_NAME + '" not found (run setupSheets)');
    } else {
      const map = headerMap_(sheet);
      lines.push('Sheet: tab "' + sheet.getName() + '", ' + Math.max(sheet.getLastRow() - 1, 0) + ' submission row(s)');
      headerNames_().forEach(function (h) {
        lines.push('  ' + h + ': ' + (map[h] ? 'column ' + map[h] : 'MISSING'));
      });
    }
  } catch (e) {
    lines.push('Sheet: ERROR ' + e.message);
  }

  const report = lines.join('\n');
  Logger.log(report);
  return report;
}

// Script Property names. The Drive folder and spreadsheet ids live there, not in the repo.
const PROPS = { FOLDER_ID: 'FOLDER_ID', SPREADSHEET_ID: 'SPREADSHEET_ID' };
const SHEET_NAME = 'Sheet1';
const WRITABLE_SHEETS = [SHEET_NAME];

const ALLOWED_DOMAIN = 'ucsd.edu';

// Submission rules. Also sent to the browser so it can check files before uploading.
const CONFIG = {
  maxBytes: 10 * 1024 * 1024, // 10 MB
  // Required width:height. Orientation matters, e.g. {width: 4, height: 3} rejects portrait.
  aspectRatio: { width: 1, height: 1 },
  // Allowed relative deviation from aspectRatio (0.01 = 1%).
  aspectTolerance: 0.01,
  pngMinWidth: 1024,
  pngMinHeight: 1024,
};

// Every sheet header the app writes. Columns are found by these names, not position.
const COLS = {
  TIMESTAMP: 'Timestamp',
  EMAIL: 'Email',
  NAME: 'Name',
  FILE_NAME: 'File name',
  FILE_ID: 'File ID',
  FILE_URL: 'File URL',
  MIME: 'MIME type',
  SIZE: 'Size (bytes)',
  DIMENSIONS: 'Dimensions',
};

function doGet() {
  const email = viewerEmail_();
  const template = HtmlService.createTemplateFromFile('Index');
  template.email = email;
  template.allowed = isAllowed_(email);
  template.configJson = toJson_(CONFIG);
  return template.evaluate()
    .setTitle('CSE Sweatshirt Art Contest')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Called from the client via google.script.run.
 * @param {{name: string, fileName: string, base64: string,
 *          pdfPageSizes: Array<{width: number, height: number}>}} form
 *   pdfPageSizes is measured in the browser (pdf.js); PNG dimensions are read here.
 */
function submitEntry(form) {
  const email = viewerEmail_();
  if (!isAllowed_(email)) {
    throw new Error('You must be signed in with an @' + ALLOWED_DOMAIN + ' account.');
  }
  form = form || {};

  const name = String(form.name || '').trim();
  if (!name || name.length > 200) {
    throw new Error('Please enter your name (max 200 characters).');
  }

  const bytes = Utilities.base64Decode(String(form.base64 || ''));
  if (bytes.length === 0 || bytes.length > CONFIG.maxBytes) {
    throw new Error('File must be between 1 byte and ' + (CONFIG.maxBytes / 1024 / 1024) + ' MB.');
  }

  let mimeType, dimensions;
  const png = pngSize_(bytes);
  if (png) {
    mimeType = 'image/png';
    if (png.width < CONFIG.pngMinWidth || png.height < CONFIG.pngMinHeight) {
      throw new Error('PNG is ' + png.width + 'x' + png.height + '; minimum is ' +
        CONFIG.pngMinWidth + 'x' + CONFIG.pngMinHeight + '.');
    }
    if (!aspectOk_(png.width, png.height)) {
      throw new Error('PNG is ' + png.width + 'x' + png.height + '; aspect ratio must be ' + aspectLabel_() + '.');
    }
    dimensions = png.width + 'x' + png.height + ' px';
  } else if (isPdf_(bytes)) {
    mimeType = 'application/pdf';
    const pages = Array.isArray(form.pdfPageSizes) ? form.pdfPageSizes : [];
    if (pages.length === 0) {
      throw new Error('Could not read the PDF page sizes.');
    }
    pages.forEach(function (p, i) {
      if (!p || !(p.width > 0) || !(p.height > 0) || !aspectOk_(p.width, p.height)) {
        throw new Error('PDF page ' + (i + 1) + ' aspect ratio must be ' + aspectLabel_() + '.');
      }
    });
    dimensions = pages.length + ' page(s); page 1 ' + Math.round(pages[0].width) + 'x' + Math.round(pages[0].height) + ' pt';
  } else {
    throw new Error('Only PNG and PDF files are accepted.');
  }

  // Resolve the sheet and its columns before touching Drive, so a misconfigured
  // sheet fails without leaving an orphan file in the folder.
  const sheet = writableSheet_(SHEET_NAME);
  const map = headerMap_(sheet);
  headerNames_().forEach(function (h) { col_(map, sheet.getName(), h); });
  const folder = folder_();

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const safeOriginal = String(form.fileName || 'upload').replace(/[^\w.\-]+/g, '_').slice(0, 100);
  const storedName = stamp + '_' + email.split('@')[0] + '_' + safeOriginal;

  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, storedName));
  file.setDescription('Submitted by ' + name + ' <' + email + '>');

  const values = {};
  values[COLS.TIMESTAMP] = nowIso_();
  values[COLS.EMAIL] = email;
  values[COLS.NAME] = name;
  values[COLS.FILE_NAME] = storedName;
  values[COLS.FILE_ID] = file.getId();
  values[COLS.FILE_URL] = file.getUrl();
  values[COLS.MIME] = mimeType;
  values[COLS.SIZE] = bytes.length;
  values[COLS.DIMENSIONS] = dimensions;

  withWriteLock_(function () {
    const row = new Array(sheet.getLastColumn()).fill('');
    Object.keys(values).forEach(function (h) {
      const v = values[h];
      row[map[h] - 1] = typeof v === 'string' ? safeCell_(v) : v;
    });
    sheet.appendRow(row);
  });

  return { fileName: storedName };
}

// ---------------------------------------------------------------------------
// Identity. Never use getEffectiveUser() for the viewer: under "Execute as: Me"
// it is the deploying account, so it would admit every visitor as the owner.
// ---------------------------------------------------------------------------

function viewerEmail_() {
  const e = Session.getActiveUser().getEmail();
  return e ? String(e).trim().toLowerCase() : '';
}

function isAllowed_(email) {
  if (!email) return false;
  return email.endsWith('@' + ALLOWED_DOMAIN);
}

// The deploying account. Used only as the reference for owner-only functions.
function ownerEmail_() {
  return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
}

// setupSheets() and diagnose() have no trailing underscore so they show in the
// editor's Run menu, which also makes them callable via google.script.run.
function requireOwner_() {
  const me = viewerEmail_();
  if (!me || me !== ownerEmail_()) throw new Error('Only the script owner can run this.');
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function requiredProperty_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Script property ' + key + ' is not set.');
  return v;
}

function book_() {
  return SpreadsheetApp.openById(requiredProperty_(PROPS.SPREADSHEET_ID));
}

function folder_() {
  return DriveApp.getFolderById(requiredProperty_(PROPS.FOLDER_ID));
}

function headerNames_() {
  return Object.keys(COLS).map(function (k) { return COLS[k]; });
}

// Case-insensitive tab lookup (exact match after folding, never substring).
function findSheet_(book, name) {
  const exact = book.getSheetByName(name);
  if (exact) return exact;
  const wanted = String(name).trim().toLowerCase();
  const all = book.getSheets();
  for (let i = 0; i < all.length; i++) {
    if (String(all[i].getName()).trim().toLowerCase() === wanted) return all[i];
  }
  return null;
}

function writableSheet_(name) {
  const wanted = String(name).trim().toLowerCase();
  const ok = WRITABLE_SHEETS.some(function (n) { return String(n).trim().toLowerCase() === wanted; });
  if (!ok) throw new Error('Refusing to write to "' + name + '"; it is not in WRITABLE_SHEETS.');
  const sheet = findSheet_(book_(), name);
  if (!sheet) throw new Error('Sheet "' + name + '" not found. Run setupSheets().');
  return sheet;
}

/** {headerText: 1-based column} for row 1. */
function headerMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const map = {};
  if (lastCol < 1) return map;
  sheet.getRange(1, 1, 1, lastCol).getValues()[0].forEach(function (h, i) {
    const key = String(h).trim();
    if (key && !map[key]) map[key] = i + 1;
  });
  return map;
}

function col_(map, sheetName, headerName) {
  if (!map[headerName]) {
    throw new Error('Sheet "' + sheetName + '" has no column named "' + headerName +
      '". Run setupSheets() or update COLS.');
  }
  return map[headerName];
}

function withWriteLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The server is busy; please try again in a moment.');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// Stops user text such as "=HYPERLINK(...)" or "-1" being evaluated as a formula.
function safeCell_(text) {
  const s = String(text);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// JSON safe to force-print inside an inline <script>.
function toJson_(obj) {
  return JSON.stringify(obj)
    .split('<').join('\\u003c')
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');
}

// ---------------------------------------------------------------------------
// File checks
// ---------------------------------------------------------------------------

function aspectOk_(width, height) {
  const want = CONFIG.aspectRatio.width / CONFIG.aspectRatio.height;
  return Math.abs((width / height) / want - 1) <= CONFIG.aspectTolerance;
}

function aspectLabel_() {
  return CONFIG.aspectRatio.width + ':' + CONFIG.aspectRatio.height;
}

/** Returns {width, height} from a PNG's IHDR chunk, or null if the bytes are not a PNG. */
function pngSize_(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return null;
  for (let i = 0; i < sig.length; i++) {
    if ((bytes[i] & 0xff) !== sig[i]) return null;
  }
  const u32 = (o) => ((bytes[o] & 0xff) * 0x1000000) + ((bytes[o + 1] & 0xff) << 16) + ((bytes[o + 2] & 0xff) << 8) + (bytes[o + 3] & 0xff);
  return { width: u32(16), height: u32(20) };
}

function isPdf_(bytes) {
  const magic = '%PDF-';
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if ((bytes[i] & 0xff) !== magic.charCodeAt(i)) return false;
  }
  return true;
}
