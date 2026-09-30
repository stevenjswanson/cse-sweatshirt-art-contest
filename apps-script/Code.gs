// Drive folder that receives uploaded files.
const FOLDER_ID = '1HhgiMdHCTl52irrKl4fvTiyTGC9sTAcn';
// Spreadsheet that receives one metadata row per submission.
const SHEET_ID = '1bw3KXp7GE4cgoadDNle9OSo8UQaGtwWx3ODEaTbTd1k';
const SHEET_NAME = 'Sheet1';

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

const HEADERS = ['Timestamp', 'Email', 'Name', 'File name', 'File ID', 'File URL', 'MIME type', 'Size (bytes)', 'Dimensions'];

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.email = getUserEmail_();
  template.allowed = isAllowed_(template.email);
  template.config = CONFIG;
  return template.evaluate()
    .setTitle('CSE Sweatshirt Art Contest')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getUserEmail_() {
  return (Session.getActiveUser().getEmail() || '').toLowerCase();
}

function isAllowed_(email) {
  return email.endsWith('@' + ALLOWED_DOMAIN);
}

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

/**
 * Called from the client via google.script.run.
 * @param {{name: string, fileName: string, mimeType: string, base64: string,
 *          pdfPageSizes: Array<{width: number, height: number}>}} form
 *   pdfPageSizes is measured in the browser (pdf.js); PNG dimensions are read here.
 */
function submitEntry(form) {
  const email = getUserEmail_();
  if (!isAllowed_(email)) {
    throw new Error('You must be signed in with an @' + ALLOWED_DOMAIN + ' account.');
  }

  const name = String(form.name || '').trim();
  if (!name || name.length > 200) {
    throw new Error('Please enter your name (max 200 characters).');
  }

  const bytes = Utilities.base64Decode(form.base64);
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
    const pages = form.pdfPageSizes || [];
    if (pages.length === 0) {
      throw new Error('Could not read the PDF page sizes.');
    }
    pages.forEach(function (p, i) {
      if (!aspectOk_(p.width, p.height)) {
        throw new Error('PDF page ' + (i + 1) + ' aspect ratio must be ' + aspectLabel_() + '.');
      }
    });
    dimensions = pages.length + ' page(s); page 1 ' + Math.round(pages[0].width) + 'x' + Math.round(pages[0].height) + ' pt';
  } else {
    throw new Error('Only PNG and PDF files are accepted.');
  }

  const timestamp = new Date();
  const stamp = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const safeOriginal = String(form.fileName || 'upload').replace(/[^\w.\-]+/g, '_').slice(0, 100);
  const storedName = stamp + '_' + email.split('@')[0] + '_' + safeOriginal;

  const blob = Utilities.newBlob(bytes, mimeType, storedName);
  const file = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
  file.setDescription('Submitted by ' + name + ' <' + email + '>');

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }
    sheet.appendRow([timestamp, email, name, storedName, file.getId(), file.getUrl(), mimeType, bytes.length, dimensions]);
  } finally {
    lock.releaseLock();
  }

  return { fileName: storedName };
}
