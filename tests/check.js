// Runs Code.gs's PNG/PDF/aspect helpers against the fixtures, and measures the PDF
// fixtures with the same pdf.js version Index.html loads. Exits non-zero on mismatch.
const fs = require('fs');
const path = require('path');

eval(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8').replace(/^const /gm, 'var '));

const fx = (f) => path.join(__dirname, 'fixtures', f);
// Apps Script byte arrays are signed (-128..127).
const signedBytes = (f) => Array.from(fs.readFileSync(fx(f))).map((b) => (b > 127 ? b - 256 : b));

let failures = 0;
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + ' -> ' + JSON.stringify(actual));
}

const pngOk = (f) => {
  const s = pngSize_(signedBytes(f));
  return s.width >= CONFIG.pngMinWidth && s.height >= CONFIG.pngMinHeight && aspectOk_(s.width, s.height);
};
expect('p_1024x1024 accepted', pngOk('p_1024x1024.png'), true);
expect('p_1023x1024 rejected (min size)', pngOk('p_1023x1024.png'), false);
expect('p_1030x1024 accepted (within 1%)', pngOk('p_1030x1024.png'), true);
expect('p_1040x1024 rejected (aspect)', pngOk('p_1040x1024.png'), false);
expect('p_2048x1024 rejected (aspect)', pngOk('p_2048x1024.png'), false);
expect('PDF magic detected', isPdf_(signedBytes('d_square.pdf')), true);
expect('PNG is not PDF', isPdf_(signedBytes('p_1024x1024.png')), false);
expect('PDF is not PNG', pngSize_(signedBytes('d_square.pdf')), null);

(async () => {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const pagesOk = async (f) => {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(fx(f))) }).promise;
    const r = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const v = (await pdf.getPage(i)).getViewport({ scale: 1 });
      r.push(aspectOk_(v.width, v.height));
    }
    return r;
  };
  expect('d_square pages', await pagesOk('d_square.pdf'), [true, true]);
  expect('d_letter pages', await pagesOk('d_letter.pdf'), [true, false]);
  expect('d_rot (400x300, rotated) page', await pagesOk('d_rot.pdf'), [false]);
  process.exit(failures ? 1 : 0);
})();
