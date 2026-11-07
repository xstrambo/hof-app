// GS1-Codes lesen (Funktion „scanner“): aus dem Text eines Barcodes oder QR-Codes die Felder holen, die die Hof-App vorbelegt.
// Reine Rechenarbeit ohne Kamera und ohne Bildschirm – darum lässt sich alles mit Node prüfen (test/gs1.test.mjs).
//
// Gelesen werden:
//   - EAN-13, EAN-8, UPC-A (nur Ziffern, Prüfziffer wird geprüft)
//   - GS1-128 und DataMatrix mit Anwendungskennungen (AI): (01) GTIN · (10) Charge · (15) MHD · (17) Verbrauchsdatum · (310x) Gewicht in kg ·
//     (30)/(37) Stückzahl · (21) Seriennummer · (11) Herstelldatum · (02) enthaltene GTIN – mit Klammern „(01)…(15)…“ oder ohne (dann trennt
//     das Gruppentrennzeichen, ASCII 29, die Felder mit wechselnder Länge)
//   - GS1 Digital Link (https://…/01/<GTIN>/10/<Charge>?17=261231)
//   - die eigenen QR-Codes des Hofs: HOF1|<SKU>|<Charge>|<MHD als JJJJ-MM-TT> (Charge und MHD dürfen fehlen)
// Nichts wird geraten: Was nicht sicher zu lesen ist, steht in `fehler`, und das Feld bleibt leer.

const GS = '\u001d';

// AI -> [Länge, veränderlich?]. Bei „veränderlich“ ist die Länge die Obergrenze.
const FEST = {
  '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2,
  '410': 13, '411': 13, '412': 13, '413': 13, '414': 13, '415': 13, '416': 13, '417': 13,
};
const VAR = {
  '10': 20, '21': 20, '22': 20, '30': 8, '37': 8, '240': 30, '241': 30, '242': 6, '243': 20, '250': 30, '251': 30, '253': 30, '254': 20, '255': 25,
  '400': 30, '401': 30, '402': 17, '403': 30, '420': 20, '421': 15, '422': 3, '423': 15, '424': 3, '425': 15, '426': 3, '7001': 13, '7002': 30,
  '7003': 10, '7004': 4, '7030': 30, '8003': 30, '8004': 30, '8006': 18, '8008': 12, '8010': 30, '8011': 12, '8018': 18, '90': 30, '91': 30,
  '92': 30, '93': 30, '94': 30, '95': 30, '96': 30, '97': 30, '98': 30, '99': 30,
};
// 31nn–36nn: Maße und Gewichte, immer 6 Ziffern; die letzte Stelle der AI sagt, wo das Komma steht
const MASS = /^3[1-6][0-9][0-9]$/;

function aiLaenge(ai) {
  if (Object.prototype.hasOwnProperty.call(FEST, ai)) return { n: FEST[ai], var: false };
  if (Object.prototype.hasOwnProperty.call(VAR, ai)) return { n: VAR[ai], var: true };
  if (MASS.test(ai)) return { n: 6, var: false };
  return null;
}

// Welche AI beginnt hier? Probiert 2, 3 und 4 Stellen (die Tabellen sind so gewählt, dass nie zwei gleichzeitig passen).
function aiAt(s, pos) {
  for (const l of [2, 3, 4]) {
    const ai = s.slice(pos, pos + l);
    if (ai.length === l && /^\d+$/.test(ai) && aiLaenge(ai)) return ai;
  }
  return null;
}

export function pruefzifferOk(ziffern) {
  if (!/^\d{8}$|^\d{12,14}$/.test(ziffern || '')) return false;
  const z = ziffern.split('').map(Number);
  const pruef = z.pop();
  let summe = 0;
  z.reverse().forEach((d, i) => { summe += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (summe % 10)) % 10 === pruef;
}

// GTIN-14 mit führender 0 ist dieselbe Nummer wie die GTIN-13 (so steht sie im Artikelstamm); UPC-A (12) bekommt eine 0 vorn.
export function gtinNormal(ziffern) {
  let g = String(ziffern || '').replace(/\D/g, '');
  if (g.length === 14 && g[0] === '0') g = g.slice(1);
  if (g.length === 12) g = '0' + g;
  return g;
}

// Zwei Nummern gleich? Egal ob 8, 12, 13 oder 14 Stellen: links mit Nullen auffüllen und vergleichen.
export function gtinGleich(a, b) {
  const x = String(a || '').replace(/\D/g, ''), y = String(b || '').replace(/\D/g, '');
  return !!x && !!y && x.padStart(14, '0') === y.padStart(14, '0');
}

// JJMMTT -> JJJJ-MM-TT. Tag 00 heißt „Monatsende“ (GS1). Ungültiges -> ''.
export function datumAusGs1(jjmmtt) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(jjmmtt || '');
  if (!m) return '';
  const jahr = 2000 + Number(m[1]), monat = Number(m[2]);
  let tag = Number(m[3]);
  if (monat < 1 || monat > 12) return '';
  const imMonat = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  if (tag === 0) tag = imMonat;
  if (tag < 1 || tag > imMonat) return '';
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

// Die Felder eines Codes in „AI -> Wert“. Gibt { felder, fehler } zurück; bei Unlesbarem bricht das Lesen ab, was bis dahin sicher war, bleibt.
export function zerlege(text) {
  const felder = {}, fehler = [];
  let s = String(text || '');
  if (s.includes('(')) {
    // Mit Klammern: „(01)04000000000017(15)261231(10)PW25-11“
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m, rest = s.replace(/^[^(]*/, '');
    if (s.trim().indexOf('(') !== 0) fehler.push('Vor der ersten Klammer steht noch etwas.');
    while ((m = re.exec(rest)) !== null) {
      const ai = m[1], wert = m[2].replace(/\u001d/g, '');
      const l = aiLaenge(ai);
      if (!l) { fehler.push(`Unbekannte Kennung (${ai}).`); break; }
      if (!l.var && wert.length !== l.n) { fehler.push(`(${ai}) hat nicht ${l.n} Stellen.`); continue; }
      if (l.var && (wert.length < 1 || wert.length > l.n)) { fehler.push(`(${ai}) ist zu lang oder leer.`); continue; }
      if (!Object.prototype.hasOwnProperty.call(felder, ai)) felder[ai] = wert; else fehler.push(`(${ai}) steht zweimal im Code.`);
    }
    return { felder, fehler };
  }
  // Ohne Klammern: feste Längen, bei veränderlichen Feldern trennt das Gruppentrennzeichen (GS) oder das Ende.
  s = s.replace(/^\u001d+/, '');
  let pos = 0;
  while (pos < s.length) {
    if (s[pos] === GS) { pos += 1; continue; }
    const ai = aiAt(s, pos);
    if (!ai) { fehler.push('Der Code lässt sich nicht als GS1-Code lesen.'); break; }
    const l = aiLaenge(ai);
    pos += ai.length;
    let ende;
    if (l.var) {
      ende = s.indexOf(GS, pos);
      if (ende < 0) ende = s.length;
      if (ende - pos > l.n) { fehler.push(`(${ai}) ist zu lang.`); break; }
    } else {
      ende = pos + l.n;
      if (ende > s.length || s.slice(pos, ende).includes(GS)) { fehler.push(`(${ai}) ist zu kurz.`); break; }
    }
    const wert = s.slice(pos, ende);
    if (!wert) { fehler.push(`(${ai}) ist leer.`); break; }
    if (!Object.prototype.hasOwnProperty.call(felder, ai)) felder[ai] = wert; else fehler.push(`(${ai}) steht zweimal im Code.`);
    pos = ende;
  }
  return { felder, fehler };
}

function gewichtKg(felder) {
  for (const ai of Object.keys(felder)) {
    if (/^310\d$/.test(ai) && /^\d{6}$/.test(felder[ai])) return Number(felder[ai]) / 10 ** Number(ai[3]);
  }
  return null;
}

function leer() {
  return { ok: false, art: '', code: '', gtin: '', sku: '', mhd: '', mhdAi: '', charge: '', gewichtKg: null, anzahl: null, felder: {}, fehler: [] };
}

function ausFeldern(felder, fehler, art, roh) {
  const r = { ...leer(), art, code: '', felder, fehler: [...fehler] };
  const gtin = felder['01'] || '';
  if (gtin) {
    if (pruefzifferOk(gtin)) { r.gtin = gtinNormal(gtin); r.code = r.gtin; } else r.fehler.push('Die Prüfziffer der Artikelnummer stimmt nicht.');
  } else if (felder['02']) {
    if (pruefzifferOk(felder['02'])) { r.gtin = gtinNormal(felder['02']); r.code = r.gtin; } else r.fehler.push('Die Prüfziffer der Artikelnummer stimmt nicht.');
  }
  for (const ai of ['15', '17']) {                       // MHD (15) wird dem Verbrauchsdatum (17) vorgezogen
    if (felder[ai] && !r.mhd) {
      const d = datumAusGs1(felder[ai]);
      if (d) { r.mhd = d; r.mhdAi = ai; } else r.fehler.push(`Das Datum (${ai}) im Code ist nicht lesbar.`);
    }
  }
  if (felder['10']) r.charge = felder['10'];
  r.gewichtKg = gewichtKg(felder);
  const stk = felder['30'] || felder['37'];
  if (stk && /^\d+$/.test(stk)) r.anzahl = Number(stk);
  r.ok = !!r.gtin;
  if (!r.gtin && !r.fehler.length) r.fehler.push('Im Code steht keine Artikelnummer (01).');
  return r;
}

function digitalLink(text) {
  let u;
  try { u = new URL(text); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const teile = u.pathname.split('/').filter(Boolean);
  const i = teile.findIndex((t, k) => t === '01' && /^\d{14}$/.test(teile[k + 1] || ''));
  if (i < 0) return null;
  const felder = {};
  for (let k = i; k + 1 < teile.length; k += 2) {
    if (/^\d{2,4}$/.test(teile[k]) && aiLaenge(teile[k])) felder[teile[k]] = decodeURIComponent(teile[k + 1]);
  }
  for (const [k, v] of u.searchParams) if (/^\d{2,4}$/.test(k) && aiLaenge(k) && !felder[k]) felder[k] = v;
  return felder;
}

// Der Eingang: der Text, den der Scanner geliefert hat. Gibt immer ein Ergebnis zurück; ok = die Artikelnummer (oder SKU) ist sicher gelesen.
export function liesCode(roh) {
  let text = String(roh == null ? '' : roh).trim();
  const r = leer();
  if (!text) { r.fehler.push('Der Code ist leer.'); return r; }
  text = text.replace(/^\][A-Za-z][0-9A-Za-z]/, '');                      // Symbologie-Kennung („]C1“, „]d2“, „]Q3“)
  // Eigener QR-Code des Hofs
  if (/^HOF1\|/.test(text)) {
    const [, sku = '', charge = '', mhd = ''] = text.split('|');
    r.art = 'eigen';
    if (!/^\d{4}-\d{1,2}$/.test(sku)) { r.fehler.push('Der Hof-Code hat keine gültige Artikelnummer (SKU).'); return r; }
    r.sku = sku; r.code = sku; r.charge = charge.trim().slice(0, 30);
    if (mhd) { if (/^\d{4}-\d{2}-\d{2}$/.test(mhd) && !Number.isNaN(Date.parse(mhd))) r.mhd = mhd; else r.fehler.push('Das MHD im Hof-Code ist nicht lesbar.'); }
    r.ok = true;
    return r;
  }
  // Nur Ziffern: EAN-13 / EAN-8 / UPC-A / GTIN-14
  if (/^\d+$/.test(text) && [8, 12, 13, 14].includes(text.length)) {
    r.art = 'ean';
    if (!pruefzifferOk(text)) { r.fehler.push('Die Prüfziffer stimmt nicht – bitte noch einmal scannen.'); r.code = text; return r; }
    r.gtin = gtinNormal(text); r.code = r.gtin; r.ok = true;
    return r;
  }
  // GS1 Digital Link
  if (/^https?:\/\//i.test(text)) {
    const f = digitalLink(text);
    if (f) return ausFeldern(f, [], 'gs1', text);
    r.art = 'url'; r.fehler.push('Das ist ein Link, kein Artikelcode.');
    return r;
  }
  // GS1-Elementstring (mit oder ohne Klammern)
  if (text.includes('(') || text.includes(GS) || /^(01|02|10|11|13|15|17|21|00)\d/.test(text)) {
    const { felder, fehler } = zerlege(text);
    if (Object.keys(felder).length) return ausFeldern(felder, fehler, 'gs1', text);
    r.art = 'gs1'; r.fehler.push(...(fehler.length ? fehler : ['Der Code lässt sich nicht lesen.']));
    return r;
  }
  r.art = 'text'; r.fehler.push('Das ist kein Artikelcode, den die App kennt.');
  return r;
}
