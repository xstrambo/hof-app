// „Bestellung abgeholt“ an einer Station (Auftrag A055, Stufe 3): Auf der Bestellkarte steht ein Knopf – nur auf einer Station, deren Profil es erlaubt, und nur, wenn der
// Laptop die Nummer der Bestellung mitgeschickt hat. Erst fragt die Karte nach („Wirklich?“), dann geht eine Zeile „Abgeholt: VB-2026-0007“ an den Laptop; dort bucht das
// Werkzeug Bestellungen (Recht, Rückfrage, nie doppelt). Hier wird nur gemerkt, was dieses Gerät schon gemeldet hat, damit nicht zweimal getippt wird.
export const NR = /^V[BE]-\d{4}-\d{3,6}$/;
export const abgeholtText = nr => 'Abgeholt: ' + nr;
const SCHLUESSEL = 'hof-app-abgeholt-v1';
const MERKEN_MS = 12 * 3600 * 1000;

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}

// { "VB-2026-0007": Zeit in ms } – nur die der letzten zwölf Stunden. Unlesbares fällt weg.
export function gemeldetLaden(speicher = globalThis.localStorage, jetzt = Date.now()) {
  try {
    const d = JSON.parse(speicher.getItem(SCHLUESSEL) || '{}');
    return Object.fromEntries(Object.entries(d && typeof d === 'object' && !Array.isArray(d) ? d : {}).filter(([k, v]) => NR.test(k) && Number.isFinite(v) && jetzt - v < MERKEN_MS));
  } catch { return {}; }
}
export function gemeldetMerken(nr, speicher = globalThis.localStorage, jetzt = Date.now()) {
  try { speicher.setItem(SCHLUESSEL, JSON.stringify({ ...gemeldetLaden(speicher, jetzt), [nr]: jetzt })); } catch { /* ohne Speicher gilt nur diese Sitzung */ }
}

// ctx: { darf: boolean, senden: async nr => boolean }
export function zeichneAbgeholt(wurzel, d, ctx) {
  for (const alt of wurzel.querySelectorAll('.best-abgeholt')) alt.remove();
  if (!ctx || !ctx.darf || !d || typeof d.nr !== 'string' || !NR.test(d.nr)) return;
  const kasten = el('div', 'best-abgeholt');
  const wann = gemeldetLaden()[d.nr];
  if (wann) {
    const uhr = new Date(wann);
    kasten.append(el('p', 'best-abgeholt-satz', `Abgeholt gemeldet um ${String(uhr.getHours()).padStart(2, '0')}:${String(uhr.getMinutes()).padStart(2, '0')}. Der Laptop bucht es.`));
    wurzel.append(kasten);
    return;
  }
  const knopf = el('button', 'knopf haupt best-abgeholt-knopf', 'Bestellung abgeholt'); knopf.type = 'button';
  knopf.addEventListener('click', () => {
    kasten.replaceChildren();
    kasten.append(el('p', 'best-abgeholt-satz', `Hat ${d.kunde} die Bestellung wirklich abgeholt?`));
    const reihe = el('div', 'best-abgeholt-reihe');
    const ja = el('button', 'knopf haupt', 'Ja, abgeholt'); ja.type = 'button';
    const nein = el('button', 'knopf', 'Nein'); nein.type = 'button';
    nein.addEventListener('click', () => zeichneAbgeholt(wurzel, d, ctx));
    ja.addEventListener('click', async () => {
      ja.disabled = nein.disabled = true;
      let ok = false;
      try { ok = await ctx.senden(d.nr); } catch { ok = false; }
      if (ok) gemeldetMerken(d.nr);
      zeichneAbgeholt(wurzel, d, ctx);
      if (!ok) wurzel.querySelector('.best-abgeholt')?.append(el('p', 'ue-hinweis', 'Das ging schief. Bitte noch einmal versuchen.'));
    });
    reihe.append(ja, nein);
    kasten.append(reihe);
  });
  kasten.append(knopf);
  wurzel.append(kasten);
}
