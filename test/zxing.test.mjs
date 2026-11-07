// Prüft die mitgelieferte Bibliothek (vendor/zxing) mit der Funktion aus js/scanner.js: erst Bilder von Codes zeichnen, dann wieder lesen.
// EAN-13 wird hier von Hand gezeichnet, QR und DataMatrix mit dem Schreiber der Bibliothek.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dekodiereGrau } from '../js/scanner.js';
import { liesCode } from '../js/gs1.js';

const quelle = readFileSync(fileURLToPath(new URL('../vendor/zxing/zxing.min.js', import.meta.url)), 'utf8');
const modul = { exports: {} };
new Function('module', 'exports', quelle).call(modul.exports, modul, modul.exports);      // UMD-Datei laden (ohne Browser)
const ZX = modul.exports;

function bild(matrix, massstab, rand) {
  const w = (matrix.getWidth() + 2 * rand) * massstab, h = (matrix.getHeight() + 2 * rand) * massstab;
  const grau = new Uint8ClampedArray(w * h).fill(255);
  for (let y = 0; y < matrix.getHeight(); y++) for (let x = 0; x < matrix.getWidth(); x++) {
    if (matrix.get(x, y)) for (let dy = 0; dy < massstab; dy++) for (let dx = 0; dx < massstab; dx++) grau[((y + rand) * massstab + dy) * w + (x + rand) * massstab + dx] = 0;
  }
  return { grau, w, h };
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13(c) {
  let b = '101';
  for (let i = 1; i < 7; i++) b += (P[+c[0]][i - 1] === 'L' ? L : G)[+c[i]];
  b += '01010';
  for (let i = 7; i < 13; i++) b += R[+c[i]];
  return b + '101';
}
function eanBild(code, massstab = 3) {
  const bits = ean13(code), rand = 10, hoehe = 60;
  const w = (bits.length + 2 * rand) * massstab, h = hoehe + 20;
  const grau = new Uint8ClampedArray(w * h).fill(255);
  for (let y = 10; y < 10 + hoehe; y++) for (let i = 0; i < bits.length; i++) if (bits[i] === '1') for (let dx = 0; dx < massstab; dx++) grau[y * w + (rand + i) * massstab + dx] = 0;
  return { grau, w, h };
}

test('EAN-13 aus einem Bild lesen', () => {
  const { grau, w, h } = eanBild('4000000000013');
  assert.equal(dekodiereGrau(ZX, grau, w, h), '4000000000013');
});

test('QR mit GS1-Text aus einem Bild lesen und auswerten', () => {
  const m = new ZX.QRCodeWriter().encode('(01)04000000000013(15)261231(10)PW25-11', ZX.BarcodeFormat.QR_CODE, 100, 100, new Map());
  const { grau, w, h } = bild(m, 4, 4);
  const text = dekodiereGrau(ZX, grau, w, h);
  assert.equal(text, '(01)04000000000013(15)261231(10)PW25-11');
  const r = liesCode(text);
  assert.equal(r.gtin, '4000000000013'); assert.equal(r.mhd, '2026-12-31'); assert.equal(r.charge, 'PW25-11');
});

test('DataMatrix mit Gruppentrenner aus einem Bild lesen und auswerten', () => {
  const m = new ZX.DataMatrixWriter().encode('0104000000000013' + '15261231' + '10PW25-11', ZX.BarcodeFormat.DATA_MATRIX, 0, 0, new Map());
  const { grau, w, h } = bild(m, 4, 4);
  const r = liesCode(dekodiereGrau(ZX, grau, w, h));
  assert.equal(r.gtin, '4000000000013'); assert.equal(r.mhd, '2026-12-31'); assert.equal(r.charge, 'PW25-11');
});

test('Eigener Hof-Code als QR', () => {
  const m = new ZX.QRCodeWriter().encode('HOF1|0301-2|PW25-11|2026-12-31', ZX.BarcodeFormat.QR_CODE, 100, 100, new Map());
  const { grau, w, h } = bild(m, 4, 4);
  const r = liesCode(dekodiereGrau(ZX, grau, w, h));
  assert.equal(r.sku, '0301-2'); assert.equal(r.charge, 'PW25-11'); assert.equal(r.mhd, '2026-12-31');
});

test('Ein weißes Bild und Rauschen ergeben keinen Code (null, kein Absturz)', () => {
  assert.equal(dekodiereGrau(ZX, new Uint8ClampedArray(300 * 200).fill(255), 300, 200), null);
  const rausch = new Uint8ClampedArray(300 * 200).map((_, i) => (i * 2654435761 >>> 7) & 255);
  assert.equal(dekodiereGrau(ZX, rausch, 300, 200), null);
});
