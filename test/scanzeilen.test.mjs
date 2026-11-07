// Tests für js/scanzeilen.js (die Zeilen der Nachricht, Chargen-Vorschlag, Vorbelegung) und js/scan-daten.js (Prüfung der Artikelliste).
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanZeile, nachrichtText, mengeLesen, datumDe, chargenSortiert, artikelFinden, vorbelegen, istScanBereich, MAX_ZEILEN } from '../js/scanzeilen.js';
import { scanListe } from '../js/scan-daten.js';
import { liesCode } from '../js/gs1.js';

const LISTE = scanListe([
  { s: '0301-2', n: 'Leindotteröl 0,5 l', e: 'Fl', g: '4000000000013', c: [
    { c: 'PW26-02', m: '2027-03-31', q: 20 }, { c: 'PW25-11', m: '2026-12-31', q: 12 }, { c: 'OHNE', m: '', q: 3 } ] },
  { s: '0501-1', n: 'Nudeln 500 g', e: 'Pkg', g: '', c: [] },
]);

test('Menge lesen: Komma, Punkt, Unsinn', () => {
  assert.equal(mengeLesen('6'), 6);
  assert.equal(mengeLesen('0,5'), 0.5);
  assert.equal(mengeLesen('1.25'), 1.25);
  assert.equal(mengeLesen(' 12 '), 12);
  for (const s of ['', 'abc', '-3', '1,2,3', '1e3', '0,5555', null, undefined]) assert.equal(mengeLesen(s), null, String(s));
});

test('Datum TT.MM.JJJJ', () => {
  assert.equal(datumDe('2026-12-31'), '31.12.2026');
  assert.equal(datumDe('2026-13-31'), '');
  assert.equal(datumDe(''), '');
});

test('Zeile Wareneingang wie im Auftrag', () => {
  assert.equal(scanZeile('eingang', { code: '4000000000013', name: 'Leindotteröl 0,5 l', menge: 6, einheit: 'Fl', charge: 'PW25-11', mhd: '2026-12-31' }),
    'Scan: 4000000000013 · Leindotteröl 0,5 l · Menge: 6 Fl · Charge: PW25-11 · MHD: 31.12.2026');
});

test('Zeile Abgang mit Grund und Charge, Inventur nur mit Menge', () => {
  assert.equal(scanZeile('abgang', { code: '4000000000013', name: 'Leindotteröl 0,5 l', menge: 2, einheit: 'Fl', charge: 'PW25-11', grund: 'Verkauf', mhd: '2026-12-31' }),
    'Scan: 4000000000013 · Leindotteröl 0,5 l · Menge: 2 Fl · Grund: Verkauf · Charge: PW25-11');
  assert.equal(scanZeile('inventur', { code: '4000000000013', name: 'Leindotteröl 0,5 l', menge: 12, einheit: 'Fl', charge: 'X', grund: 'Verkauf' }),
    'Scan: 4000000000013 · Leindotteröl 0,5 l · Menge: 12 Fl');
  assert.equal(scanZeile('inventur', { code: '4000000000013', menge: 0 }), 'Scan: 4000000000013 · Menge: 0');   // gezählt: null ist möglich
});

test('Zeile: ohne Code oder Menge entsteht nichts; ohne Namen fehlt nur der Name; unbekannter Grund fällt weg', () => {
  assert.equal(scanZeile('eingang', { code: '', menge: 1 }), '');
  assert.equal(scanZeile('eingang', { code: '4000000000013', menge: null }), '');
  assert.equal(scanZeile('eingang', { code: '4000000000013', menge: 0 }), '');
  assert.equal(scanZeile('abgang', { code: '4000000000013', menge: -1 }), '');
  assert.equal(scanZeile('eingang', { code: '4000000000013', menge: 1.5 }), 'Scan: 4000000000013 · Menge: 1,5');
  assert.equal(scanZeile('abgang', { code: '4000000000013', menge: 1, grund: 'Geschenk' }), 'Scan: 4000000000013 · Menge: 1');
});

test('Zeile: Trenner, Doppelpunkt und Zeilenumbruch in Name und Charge können die Zeile nicht kaputt machen', () => {
  const z = scanZeile('eingang', { code: '4000000000013', name: 'Öl · kalt: gepresst\nNeu', menge: 1, charge: 'A · B:C\n', mhd: '2026-12-31' });
  assert.ok(!z.includes('\n'));
  assert.equal(z.split(' · ').length, 5);                  // Scan, Name, Menge, Charge, MHD
  assert.ok(!/^Scan: \S+ · [^·]*:/.test(z.replace(/ · (Menge|Charge|MHD):.*$/, '')));   // im Namen steht kein Doppelpunkt
});

test('Nachricht: Kopfzeile + Zeilen; falscher Bereich oder fremde Zeilen ergeben nichts', () => {
  const z1 = 'Scan: 4000000000013 · Menge: 6 Fl', z2 = 'Scan: 0501-1 · Menge: 3';
  assert.equal(nachrichtText('wareneingang', [z1, z2]), `Bereich: Wareneingang\n${z1}\n${z2}`);
  assert.equal(nachrichtText('verkauf', [z1]), `Bereich: Verkauf/Abgang\n${z1}`);
  assert.equal(nachrichtText('inventur', [z1]), `Bereich: Inventur\n${z1}`);
  assert.equal(nachrichtText('tiere', [z1]), '');
  assert.equal(nachrichtText('inventur', []), '');
  assert.equal(nachrichtText('inventur', ['Hallo', 42, null]), '');
  assert.equal(nachrichtText('inventur', Array(MAX_ZEILEN + 5).fill(z1)).split('\n').length, MAX_ZEILEN + 1);
  assert.equal(istScanBereich('wareneingang'), true); assert.equal(istScanBereich('tiere'), false); assert.equal(istScanBereich('toString'), false);
});

test('Chargen: älteste MHD zuerst, ohne MHD zuletzt, leere Mengen weg', () => {
  const s = chargenSortiert(LISTE[0].c);
  assert.deepEqual(s.map(c => c.c), ['PW25-11', 'PW26-02', 'OHNE']);
  assert.deepEqual(chargenSortiert([{ c: 'A', m: '2026-01-01', q: 0 }, { c: 'B', m: '2026-02-01', q: 1 }]).map(c => c.c), ['B']);
  assert.deepEqual(chargenSortiert(null), []);
});

test('Abgang mit zwei Chargen: die mit dem ältesten MHD wird vorgeschlagen', () => {
  const v = vorbelegen('abgang', LISTE[0], null);
  assert.equal(v.charge, 'PW25-11');
  assert.equal(v.name, 'Leindotteröl 0,5 l'); assert.equal(v.einheit, 'Fl');
  assert.equal(v.chargenAuswahl.length, 3);
  // steht die Charge im Code und ist im Bestand: die gilt
  const mitCode = vorbelegen('abgang', LISTE[0], liesCode('(01)04000000000013(10)PW26-02'));
  assert.equal(mitCode.charge, 'PW26-02');
  // steht eine Charge im Code, die es nicht gibt: Vorschlag bleibt, dazu ein Hinweis
  const fremd = vorbelegen('abgang', LISTE[0], liesCode('(01)04000000000013(10)ZZZ'));
  assert.equal(fremd.charge, 'PW25-11'); assert.equal(fremd.hinweise.length, 1);
  // Artikel ohne Chargen: nichts vorgeschlagen
  assert.equal(vorbelegen('abgang', LISTE[1], null).charge, '');
});

test('Wareneingang: GS1-Code belegt MHD und Charge vor; ohne Code bleibt alles leer', () => {
  const v = vorbelegen('eingang', LISTE[0], liesCode('(01)04000000000013(15)261231(10)PW25-11'));
  assert.equal(v.mhd, '2026-12-31'); assert.equal(v.charge, 'PW25-11'); assert.equal(v.menge, '');
  const e = vorbelegen('eingang', LISTE[0], liesCode('4000000000013'));
  assert.equal(e.mhd, ''); assert.equal(e.charge, ''); assert.equal(e.menge, '');
});

test('Wareneingang: Gewicht aus dem Code nur bei Einheit kg (oder unbekannt); sonst ein Hinweis', () => {
  const kg = { s: '0201-1', n: 'Schinken', e: 'kg', g: '4000000000013', c: [] };
  assert.equal(vorbelegen('eingang', kg, liesCode('(01)04000000000013(3102)000125')).menge, '1,25');
  const fl = vorbelegen('eingang', LISTE[0], liesCode('(01)04000000000013(3102)000125'));
  assert.equal(fl.menge, ''); assert.equal(fl.hinweise.length, 1);
  const unbekannt = vorbelegen('eingang', null, liesCode('(01)04000000000013(3102)000125'));
  assert.equal(unbekannt.menge, '1,25'); assert.equal(unbekannt.einheit, 'kg');
});

test('Inventur: nichts vorbelegt', () => {
  const v = vorbelegen('inventur', LISTE[0], liesCode('(01)04000000000013(15)261231(10)PW25-11'));
  assert.equal(v.mhd, ''); assert.equal(v.charge, ''); assert.equal(v.menge, '');
});

test('Artikel zum Code finden: nach GTIN (egal wie viele Stellen) und nach SKU', () => {
  assert.equal(artikelFinden(LISTE, liesCode('4000000000013')).s, '0301-2');
  assert.equal(artikelFinden(LISTE, liesCode('(01)04000000000013(10)X')).s, '0301-2');
  assert.equal(artikelFinden(LISTE, liesCode('HOF1|0501-1|C1|2026-12-31')).s, '0501-1');
  assert.equal(artikelFinden(LISTE, liesCode('73513537')), null);
  assert.equal(artikelFinden(null, liesCode('4000000000013')), null);
  assert.equal(artikelFinden(LISTE, null), null);
});

test('Artikelliste vom Laptop wird streng geprüft', () => {
  const l = scanListe([
    { s: 'A', n: 'Ok', e: 'Stk', g: '4000000000013', c: [{ c: 'C1', m: '2026-12-31', q: 3 }, { c: '', m: 'x' }, { c: 'C2', m: 'kaputt', q: -4 }] },
    { s: 'A', n: 'Doppelt' }, { n: 'ohne SKU' }, 'Text', null, { s: 'B', n: 'Zu\nlang\u0007', g: 'abc', e: 'x'.repeat(40), c: 'nein' },
  ]);
  assert.equal(l.length, 2);
  assert.deepEqual(l[0].c, [{ c: 'C1', m: '2026-12-31', q: 3 }, { c: 'C2', m: '' }]);
  assert.equal(l[1].n, 'Zu lang'); assert.equal(l[1].g, ''); assert.equal(l[1].e.length, 12); assert.deepEqual(l[1].c, []);
  assert.deepEqual(scanListe('kein Feld'), []);
  assert.equal(scanListe(Array.from({ length: 900 }, (_, i) => ({ s: 'S' + i, n: 'N' + i }))).length, 600);
});
