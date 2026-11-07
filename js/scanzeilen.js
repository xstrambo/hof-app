// Die Zeilen, die der Scanner (Funktion „scanner“) in die Nachricht schreibt – und was dazu gehört. Reine Rechenarbeit, ohne Bildschirm (test/scanzeilen.test.mjs).
//
// Eine Nachricht sieht so aus (das Format liest der Sortierer am Laptop ohne KI, hof-app → sortierer/scan_auftrag.py):
//   Bereich: Wareneingang
//   Scan: 4000000000017 · Leindotteröl 0,5 l · Menge: 6 Fl · Charge: PW25-11 · MHD: 31.12.2026
// Abgang:  Scan: <Code> · <Name> · Menge: 2 Fl · Grund: Verkauf · Charge: PW25-11
// Inventur: Scan: <Code> · <Name> · Menge: 12 Fl
import { gtinGleich } from './gs1.js';

export const SCAN_BEREICHE = {
  wareneingang: { name: 'Wareneingang', art: 'eingang' },
  verkauf: { name: 'Verkauf/Abgang', art: 'abgang' },
  inventur: { name: 'Inventur', art: 'inventur' },
};
export const istScanBereich = x => typeof x === 'string' && Object.prototype.hasOwnProperty.call(SCAN_BEREICHE, x);
export const GRUENDE = ['Verkauf', 'Abholung', 'Schwund', 'Verderb'];
const TRENNER = ' · ';
export const MAX_ZEILEN = 60;

const einzeilig = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// In einem Feld darf weder der Trenner noch ein Doppelpunkt am Anfang stehen, sonst würde der Sortierer es falsch lesen.
const feldText = (x, n) => einzeilig(x, n).replace(/\s·\s/g, ' - ').replace(/·/g, '-');
const nameText = x => feldText(x, 80).replace(/:/g, ' -');

// Eine Zahl aus dem Zahlenfeld („6“, „0,5“, „1.25“). Ungültig oder negativ -> null.
export function mengeLesen(text) {
  const t = String(text == null ? '' : text).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n < 1e7 ? n : null;
}
export const mengeText = n => String(n).replace('.', ',');

// JJJJ-MM-TT -> TT.MM.JJJJ (und zurück). Ungültiges -> ''.
export function datumDe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m && !Number.isNaN(Date.parse(iso)) ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

// Chargen im Bestand: älteste MHD zuerst (Ware ohne MHD zuletzt). Die erste ist der Vorschlag beim Abgang.
export function chargenSortiert(chargen) {
  const liste = (Array.isArray(chargen) ? chargen : []).filter(c => c && typeof c.c === 'string' && (c.q === undefined || c.q > 0));
  return liste.slice().sort((a, b) => {
    if (!!a.m !== !!b.m) return a.m ? -1 : 1;
    return (a.m || '').localeCompare(b.m || '') || a.c.localeCompare(b.c);
  });
}

// Den Artikel zum gelesenen Code finden: nach GTIN (egal wie viele Stellen) oder, bei den eigenen Hof-Codes, nach SKU.
export function artikelFinden(liste, ergebnis) {
  if (!Array.isArray(liste) || !ergebnis) return null;
  if (ergebnis.sku) return liste.find(a => a.s === ergebnis.sku) || null;
  if (ergebnis.gtin) return liste.find(a => a.g && gtinGleich(a.g, ergebnis.gtin)) || null;
  return null;
}

// Eine Zeile `Scan: …`. e = { code, name, menge (Zahl), einheit, charge, mhd (JJJJ-MM-TT), grund }; art = 'eingang' | 'abgang' | 'inventur'.
// Gibt '' zurück, wenn etwas Wichtiges fehlt (Code, Menge).
export function scanZeile(art, e) {
  const code = einzeilig(e && e.code, 40).replace(/\s/g, '');
  const menge = e ? e.menge : null;
  if (!code || typeof menge !== 'number' || !Number.isFinite(menge) || menge < 0 || (menge === 0 && art !== 'inventur')) return '';
  const teile = [`Scan: ${code}`];
  const name = nameText(e.name);
  if (name) teile.push(name);
  teile.push(`Menge: ${mengeText(menge)}${e.einheit ? ' ' + feldText(e.einheit, 12) : ''}`);
  if (art === 'abgang' && e.grund && GRUENDE.includes(e.grund)) teile.push(`Grund: ${e.grund}`);
  if (art !== 'inventur') {
    const charge = feldText(e.charge, 30).replace(/:/g, '-');
    if (charge) teile.push(`Charge: ${charge}`);
  }
  if (art === 'eingang' && e.mhd) {
    const d = datumDe(e.mhd);
    if (d) teile.push(`MHD: ${d}`);
  }
  return teile.join(TRENNER);
}

// Die ganze Nachricht: Kopfzeile + eine Zeile je Artikel.
export function nachrichtText(bereich, zeilen) {
  if (!istScanBereich(bereich)) return '';
  const z = (Array.isArray(zeilen) ? zeilen : []).filter(x => typeof x === 'string' && x.startsWith('Scan: ')).slice(0, MAX_ZEILEN);
  return z.length ? [`Bereich: ${SCAN_BEREICHE[bereich].name}`, ...z].join('\n') : '';
}

// Vorbelegung nach dem Scan. art = Art des Bereichs, artikel = Eintrag aus dem Warenlager (oder null), gelesen = Ergebnis von liesCode.
// Gibt { name, einheit, menge ('' oder Text), charge, mhd, chargenAuswahl, hinweise } zurück.
export function vorbelegen(art, artikel, gelesen) {
  const hinweise = [];
  const einheit = artikel && artikel.e ? artikel.e : '';
  const v = { name: artikel ? artikel.n : '', einheit, menge: '', charge: '', mhd: '', chargenAuswahl: [], hinweise };
  if (art === 'inventur') return v;
  if (art === 'abgang') {
    v.chargenAuswahl = chargenSortiert(artikel && artikel.c);
    if (gelesen && gelesen.charge && v.chargenAuswahl.some(c => c.c === gelesen.charge)) v.charge = gelesen.charge;
    else if (v.chargenAuswahl.length) v.charge = v.chargenAuswahl[0].c;                    // die mit dem ältesten MHD
    if (gelesen && gelesen.charge && !v.chargenAuswahl.some(c => c.c === gelesen.charge)) hinweise.push(`Die Charge ${gelesen.charge} aus dem Code ist nicht im Bestand.`);
    return v;
  }
  if (gelesen) {
    if (gelesen.charge) v.charge = gelesen.charge;
    if (gelesen.mhd) v.mhd = gelesen.mhd;
    if (gelesen.gewichtKg != null) {
      const kg = !einheit || /^kg$/i.test(einheit);
      if (kg) { v.menge = mengeText(gelesen.gewichtKg); if (!einheit) v.einheit = 'kg'; } else hinweise.push(`Im Code steht ein Gewicht von ${mengeText(gelesen.gewichtKg)} kg – bitte prüfen, ob es zur Einheit „${einheit}“ passt.`);
    } else if (gelesen.anzahl != null && !gelesen.gewichtKg) {
      v.menge = String(gelesen.anzahl);
    }
  }
  return v;
}
