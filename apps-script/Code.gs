// Drive folder that receives uploaded images.
const FOLDER_ID = '1HhgiMdHCTl52irrKl4fvTiyTGC9sTAcn';
// Spreadsheet that receives one metadata row per submission.
const SHEET_ID = '1bw3KXp7GE4cgoadDNle9OSo8UQaGtwWx3ODEaTbTd1k';
const SHEET_NAME = 'Sheet1';

const ALLOWED_DOMAIN = 'ucsd.edu';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const HEADERS = ['Timestamp', 'Email', 'Name', 'File name', 'File ID', 'File URL', 'MIME type', 'Size (bytes)'];

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.email = getUserEmail_();
  template.allowed = isAllowed_(template.email);
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

/**
 * Called from the client via google.script.run.
 * @param {{name: string, fileName: string, mimeType: string, base64: string}} form
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
  if (ALLOWED_MIME_TYPES.indexOf(form.mimeType) === -1) {
    throw new Error('Unsupported file type: ' + form.mimeType);
  }

  const bytes = Utilities.base64Decode(form.base64);
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    throw new Error('Image must be between 1 byte and ' + (MAX_BYTES / 1024 / 1024) + ' MB.');
  }

  const timestamp = new Date();
  const stamp = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const safeOriginal = String(form.fileName || 'image').replace(/[^\w.\-]+/g, '_').slice(0, 100);
  const storedName = stamp + '_' + email.split('@')[0] + '_' + safeOriginal;

  const blob = Utilities.newBlob(bytes, form.mimeType, storedName);
  const file = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
  file.setDescription('Submitted by ' + name + ' <' + email + '>');

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }
    sheet.appendRow([timestamp, email, name, storedName, file.getId(), file.getUrl(), form.mimeType, bytes.length]);
  } finally {
    lock.releaseLock();
  }

  return { fileName: storedName };
}
