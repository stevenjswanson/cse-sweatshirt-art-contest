/**
 * Fake Google Apps Script services, for testing .gs files under Node.
 *
 * Apps Script has no native test story, so server logic tends to go untested
 * and gets verified by clicking around in production. But a .gs file is just
 * JavaScript, and the Google services are globals — so you can run the real
 * file in a vm sandbox with substitutes and assert against it.
 *
 * Usage:
 *
 *   const { load } = require('./gas-harness');
 *   const app = load('../Code.gs', {
 *     sheets: {
 *       'Roster': [['Email'], ['a@x.edu'], ['b@x.edu']],
 *       'Log':    [['User', 'Action', 'Timestamp']]
 *     },
 *     activeUser: 'a@x.edu',
 *     properties: { SPREADSHEET_ID: 'FAKE' }
 *   });
 *
 *   app.rosterEmails_();          // call any function in the file
 *   app.sheetRows('Log');         // inspect what got written
 *
 * Build the fake sheets to match the REAL tab shape, headers included. A test
 * against an idealised 3-column sheet passes happily while production has 34
 * columns and a different header for the one that matters.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** A mutable fake of the Sheet class, backed by an array of row arrays. */
function makeSheet(name, rows) {
  const sheet = {
    _rows: rows,
    getName: () => name,
    getLastRow: () => sheet._rows.length,
    getLastColumn: () =>
      sheet._rows.reduce((m, r) => Math.max(m, r.length), 0),

    getRange(r, c, numRows, numCols) {
      const nr = numRows === undefined ? 1 : numRows;
      const nc = numCols === undefined ? 1 : numCols;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = sheet._rows[r - 1 + i] || [];
            const slice = [];
            for (let j = 0; j < nc; j++) {
              const v = row[c - 1 + j];
              slice.push(v === undefined ? '' : v);
            }
            out.push(slice);
          }
          return out;
        },
        setValues(values) {
          values.forEach((row, i) => {
            const target = r - 1 + i;
            while (sheet._rows.length <= target) sheet._rows.push([]);
            row.forEach((v, j) => { sheet._rows[target][c - 1 + j] = v; });
          });
          return this;
        },
        setValue(v) { return this.setValues([[v]]); },
        getValue() { return this.getValues()[0][0]; },
        clearContent() { return this.setValues([[ '' ]]); }
      };
    },

    appendRow(row) { sheet._rows.push(row.slice()); return sheet; },
    deleteRow(i) { sheet._rows.splice(i - 1, 1); return sheet; },
    insertRowAfter() { return sheet; },
    getDataRange: () => sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
  };
  return sheet;
}

/**
 * Load a .gs file into a sandbox and return it, plus a few inspection helpers.
 *
 * opts.sheets       {tabName: [[...row], ...]} — row 1 is the header row
 * opts.activeUser   what Session.getActiveUser().getEmail() returns ('' = signed out)
 * opts.effectiveUser  defaults to owner@example.com, deliberately DIFFERENT from
 *                     activeUser so a getEffectiveUser() auth bypass fails loudly
 * opts.properties   script properties
 * opts.timeZone     defaults to America/Los_Angeles
 * opts.fetch        function(url, params) -> fake UrlFetchApp response
 * opts.now          fixed Date for deterministic timestamps
 * opts.folders      {folderId: folderName} — DriveApp.getFolderById() throws for others
 */
function load(gsPath, opts) {
  opts = opts || {};
  const resolved = path.isAbsolute(gsPath)
    ? gsPath
    : path.resolve(process.cwd(), gsPath);

  const sheets = {};
  Object.keys(opts.sheets || {}).forEach(name => {
    sheets[name] = makeSheet(name, JSON.parse(JSON.stringify(opts.sheets[name])));
  });

  const cache = {};
  const properties = Object.assign({}, opts.properties);
  const logs = [];
  let uuidCounter = 0;
  const timeZone = opts.timeZone || 'America/Los_Angeles';
  const fixedNow = opts.now || null;

  const book = {
    getSheetByName: n => sheets[n] || null,
    getSheets: () => Object.keys(sheets).map(k => sheets[k]),
    getName: () => 'Fake Spreadsheet',
    getSpreadsheetTimeZone: () => timeZone,
    insertSheet(n) { sheets[n] = makeSheet(n, []); return sheets[n]; }
  };

  // Added for this project: DriveApp fake that records created files.
  const folders = Object.assign({}, opts.folders);
  const driveFiles = [];
  const DriveApp = {
    getFolderById(id) {
      if (!(id in folders)) throw new Error('No item with the given ID could be found: ' + id);
      return {
        getName: () => folders[id],
        createFile(blob) {
          const n = driveFiles.length + 1;
          const f = { folderId: id, name: blob.getName(), mimeType: blob.getContentType(),
                      bytes: blob.getBytes(), description: '' };
          driveFiles.push(f);
          return {
            getId: () => 'file-' + n,
            getUrl: () => 'https://drive.example/file-' + n,
            setDescription(d) { f.description = d; return this; }
          };
        }
      };
    }
  };

  const sandbox = {
    DriveApp,
    SpreadsheetApp: {
      openById: () => book,
      getActiveSpreadsheet: () => book,
      flush: () => {}
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in properties ? properties[k] : null),
        setProperty: (k, v) => { properties[k] = String(v); },
        deleteProperty: k => { delete properties[k]; }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = v; },
        remove: k => { delete cache[k]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => {},
        waitLock: () => {}
      })
    },
    Session: {
      getActiveUser: () => ({
        getEmail: () => (opts.activeUser === undefined ? '' : opts.activeUser)
      }),
      // Deliberately different from activeUser: if the code under test falls back
      // to getEffectiveUser() for identity, tests should show the wrong answer
      // rather than quietly agreeing.
      getEffectiveUser: () => ({
        getEmail: () => opts.effectiveUser || 'owner@example.com'
      }),
      getScriptTimeZone: () => timeZone
    },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        // Enough of a formatter for the patterns these apps actually use.
        const d = date instanceof Date ? date : new Date(date);
        const p = n => String(n).padStart(2, '0');
        const iso = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
                    'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        return fmt && fmt.indexOf('XXX') !== -1 ? iso + '-07:00' : iso;
      },
      sleep: () => {},
      getUuid: () => 'fake-uuid-' + (++uuidCounter),
      // Apps Script byte arrays are signed (-128..127).
      base64Decode: s => Array.from(Buffer.from(s, 'base64')).map(b => (b > 127 ? b - 256 : b)),
      newBlob: (bytes, contentType, name) => ({
        getBytes: () => bytes, getContentType: () => contentType, getName: () => name
      })
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        if (!opts.fetch) throw new Error('UrlFetchApp.fetch called but no opts.fetch provided: ' + url);
        return opts.fetch(url, params);
      }
    },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' }),
      createHtmlOutput: c => ({ getContent: () => c, setTitle() { return this; } })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: t => ({ setMimeType() { return this; }, getContent: () => t })
    },
    Logger: { log: m => { logs.push(String(m)); } },
    console
  };

  if (fixedNow) {
    const RealDate = Date;
    sandbox.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow.getTime(); }
    };
  }

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(resolved, 'utf8'), sandbox, { filename: path.basename(resolved) });

  // Inspection helpers, namespaced so they cannot collide with the file's own
  // functions (which are what you actually want to call on this object).
  sandbox.sheetRows = name => (sheets[name] ? sheets[name]._rows : null);
  sandbox.cacheContents = () => Object.assign({}, cache);
  sandbox.logLines = () => logs.slice();
  sandbox.propertyValues = () => Object.assign({}, properties);
  sandbox.driveFiles = () => driveFiles.slice();

  return sandbox;
}

module.exports = { load, makeSheet };
