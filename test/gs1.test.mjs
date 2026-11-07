// Tests für js/gs1.js (GS1-Codes lesen). Aufruf im Ordner der Hof-App:  node --test test/
// Alle Nummern sind erfunden (Testhof Pappelweide). 4000000000013 ist eine gültige GTIN-13 (Prüfziffer 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { liesCode, zerlege, pruefzifferOk, gtinNormal, gtinGleich, datumAusGs1 } from '../js/gs1.js';

const GS = '\u001d';

test('Prüfziffer: gültige und ungültige Nummern', () => {
  assert.equal(pruefzifferOk('4000000000013'), true);
  assert.equal(pruefzifferOk('04000000000013'), true);       // GTIN-14 mit führender 0
  assert.equal(pruefzifferOk('4000000000017'), false);
  assert.equal(pruefzifferOk('40000000000'), false);          // falsche Länge
  assert.equal(pruefzifferOk('73513537'), true);              // EAN-8
  assert.equal(pruefzifferOk('73513538'), false);
  assert.equal(pruefzifferOk(''), false);
  assert.equal(pruefzifferOk(null), false);
});

test('GTIN gleich machen: 14, 13, 12, 8 Stellen', () => {
  assert.equal(gtinNormal('04000000000013'), '4000000000013');
  assert.equal(gtinNormal('012345678905'), '0012345678905');   // UPC-A bekommt eine 0 vorn
  assert.equal(gtinGleich('04000000000013', '4000000000013'), true);
  assert.equal(gtinGleich('73513537', '00000073513537'), true);
  assert.equal(gtinGleich('4000000000013', '4000000000020'), false);
  assert.equal(gtinGleich('', ''), false);
});

test('Datum: JJMMTT, Tag 00 = Monatsende, Ungültiges leer', () => {
  assert.equal(datumAusGs1('261231'), '2026-12-31');
  assert.equal(datumAusGs1('260200'), '2026-02-28');
  assert.equal(datumAusGs1('280200'), '2028-02-29');          // Schaltjahr
  assert.equal(datumAusGs1('261301'), '');
  assert.equal(datumAusGs1('260230'), '');
  assert.equal(datumAusGs1('26123'), '');
  assert.equal(datumAusGs1(''), '');
});

test('Beispiel aus dem Auftrag: (01)…(15)…(10)… mit Klammern', () => {
  const r = liesCode('(01)04000000000013(15)261231(10)PW25-11');
  assert.equal(r.ok, true);
  assert.equal(r.art, 'gs1');
  assert.equal(r.gtin, '4000000000013');
  assert.equal(r.code, '4000000000013');
  assert.equal(r.mhd, '2026-12-31');
  assert.equal(r.mhdAi, '15');
  assert.equal(r.charge, 'PW25-11');
  assert.deepEqual(r.fehler, []);
});

test('Ohne Klammern: feste Längen, Charge am Ende; Charge in der Mitte endet am Gruppentrenner', () => {
  const a = liesCode('0104000000000013' + '15261231' + '10PW25-11');
  assert.equal(a.gtin, '4000000000013'); assert.equal(a.mhd, '2026-12-31'); assert.equal(a.charge, 'PW25-11');
  const b = liesCode('0104000000000013' + '10PW25-11' + GS + '15261231');
  assert.equal(b.charge, 'PW25-11'); assert.equal(b.mhd, '2026-12-31');
  const c = liesCode(']C1' + '0104000000000013' + '17270630' + '10L7');    // mit Symbologie-Kennung; 17 = Verbrauchsdatum
  assert.equal(c.mhd, '2027-06-30'); assert.equal(c.mhdAi, '17'); assert.equal(c.charge, 'L7');
});

test('MHD (15) geht vor Verbrauchsdatum (17)', () => {
  const r = liesCode('(01)04000000000013(17)270101(15)261231');
  assert.equal(r.mhd, '2026-12-31'); assert.equal(r.mhdAi, '15');
});

test('Gewicht (310x): Komma-Stelle aus der Kennung', () => {
  assert.equal(liesCode('(01)04000000000013(3102)000125').gewichtKg, 1.25);
  assert.equal(liesCode('(01)04000000000013(3100)000007').gewichtKg, 7);
  assert.equal(liesCode('(01)04000000000013(3103)001250').gewichtKg, 1.25);
  assert.equal(liesCode('(01)04000000000013').gewichtKg, null);
  const ohne = liesCode('0104000000000013' + '3102000125' + '15261231');
  assert.equal(ohne.gewichtKg, 1.25); assert.equal(ohne.mhd, '2026-12-31');
});

test('Stückzahl (30) und (37)', () => {
  assert.equal(liesCode('(01)04000000000013(37)12').anzahl, 12);
  assert.equal(liesCode('(01)04000000000013(30)6').anzahl, 6);
});

test('EAN-13 und EAN-8 aus dem Strichcode', () => {
  const r = liesCode('4000000000013');
  assert.equal(r.ok, true); assert.equal(r.art, 'ean'); assert.equal(r.gtin, '4000000000013'); assert.equal(r.mhd, ''); assert.equal(r.charge, '');
  assert.equal(liesCode('73513537').gtin, '73513537');
  assert.equal(liesCode(' 4000000000013 \n').gtin, '4000000000013');       // Leerzeichen und Zeilenumbruch drumherum
  assert.equal(liesCode('04000000000013').gtin, '4000000000013');          // ITF-14 / GTIN-14
});

test('Falsche Prüfziffer: nicht ok, mit Hinweis, nichts vorbelegt', () => {
  const r = liesCode('4000000000017');
  assert.equal(r.ok, false);
  assert.match(r.fehler[0], /Prüfziffer/);
  const g = liesCode('(01)04000000000017(15)261231(10)PW25-11');
  assert.equal(g.ok, false); assert.equal(g.gtin, '');
  assert.match(g.fehler.join(' '), /Prüfziffer/);
});

test('Unlesbares wird gemeldet, nie geraten', () => {
  for (const t of ['', '   ', 'Hallo Welt', 'https://example.org/x', '(99)', '(01)123', '(15)261231']) {
    const r = liesCode(t);
    assert.equal(r.ok, false, t);
    assert.ok(r.fehler.length > 0, t);
  }
  assert.equal(liesCode('(01)04000000000013(15)261331').mhd, '');         // ungültiger Monat: kein MHD, aber der Artikel bleibt lesbar
  assert.equal(liesCode('(01)04000000000013(15)261331').gtin, '4000000000013');
  assert.equal(liesCode(null).ok, false);
  assert.equal(liesCode(undefined).ok, false);
});

test('Ein Feld zweimal im Code: das erste gilt, es gibt einen Hinweis', () => {
  const r = liesCode('(01)04000000000013(10)A(10)B');
  assert.equal(r.charge, 'A');
  assert.ok(r.fehler.some(f => /zweimal/.test(f)));
});

test('Zu lange Charge (mehr als 20 Zeichen) wird nicht gelesen', () => {
  const r = liesCode('(01)04000000000013(10)' + 'X'.repeat(21));
  assert.equal(r.charge, '');
  assert.ok(r.fehler.length > 0);
});

test('GS1 Digital Link', () => {
  const r = liesCode('https://id.example.org/01/04000000000013/10/PW25-11?17=261231');
  assert.equal(r.ok, true); assert.equal(r.gtin, '4000000000013'); assert.equal(r.charge, 'PW25-11'); assert.equal(r.mhd, '2026-12-31');
});

test('Eigener Hof-Code: SKU, Charge, MHD', () => {
  const r = liesCode('HOF1|0301-2|PW25-11|2026-12-31');
  assert.equal(r.ok, true); assert.equal(r.art, 'eigen'); assert.equal(r.sku, '0301-2'); assert.equal(r.code, '0301-2');
  assert.equal(r.charge, 'PW25-11'); assert.equal(r.mhd, '2026-12-31'); assert.equal(r.gtin, '');
  const nur = liesCode('HOF1|0301-2||');
  assert.equal(nur.ok, true); assert.equal(nur.charge, ''); assert.equal(nur.mhd, '');
  assert.equal(liesCode('HOF1|abc|x|2026-12-31').ok, false);
  const schlecht = liesCode('HOF1|0301-2|X|2026-13-45');
  assert.equal(schlecht.ok, true); assert.equal(schlecht.mhd, ''); assert.ok(schlecht.fehler.length);
});

test('zerlege: Klammern und Trenner', () => {
  assert.deepEqual(zerlege('(10)AB(21)77').felder, { 10: 'AB', 21: '77' });
  assert.deepEqual(zerlege('10AB' + GS + '2177').felder, { 10: 'AB', 21: '77' });
  assert.deepEqual(zerlege('x(10)AB').fehler.length > 0, true);
});
