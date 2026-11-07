// Die Artikelliste für den Scanner (Funktion „scanner“): Der Laptop schickt sie im Reiter „Warenlager“ der Übersicht mit (Feld `scan`).
// Hier wird sie streng geprüft und gekürzt; was nicht passt, fällt weg. Gezeigt wird später nur Text (textContent), nie HTML.
//
//   scan: [{ s: "0301-2", n: "Leindotteröl 0,5 l", e: "Fl", g: "4000000000017",
//            c: [{ c: "PW25-11", m: "2026-12-31", q: 12 }] }]
//   s = SKU · n = Name · e = Einheit · g = Barcode/GTIN (Ziffern) · c = Chargen im Bestand (Charge, MHD, Menge)
const MAX_ARTIKEL = 600;
const MAX_CHARGEN = 12;
const einzeilig = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const istObjekt = x => !!x && typeof x === 'object' && !Array.isArray(x);

export function scanListe(roh) {
  const aus = [];
  const gesehen = new Set();
  for (const a of (Array.isArray(roh) ? roh : []).slice(0, MAX_ARTIKEL)) {
    if (!istObjekt(a)) continue;
    const s = einzeilig(a.s, 20), n = einzeilig(a.n, 80);
    if (!s || !n || gesehen.has(s)) continue;
    gesehen.add(s);
    const g = typeof a.g === 'string' && /^\d{8,14}$/.test(a.g) ? a.g : '';
    const c = [];
    for (const x of (Array.isArray(a.c) ? a.c : []).slice(0, MAX_CHARGEN)) {
      if (!istObjekt(x)) continue;
      const ch = einzeilig(x.c, 30);
      if (!ch) continue;
      const m = typeof x.m === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.m) && !Number.isNaN(Date.parse(x.m)) ? x.m : '';
      const q = typeof x.q === 'number' && Number.isFinite(x.q) && x.q > 0 && x.q < 1e7 ? x.q : 0;
      if (q) c.push({ c: ch, m, q }); else c.push({ c: ch, m });
    }
    aus.push({ s, n, e: einzeilig(a.e, 12), g, c });
  }
  return aus;
}
