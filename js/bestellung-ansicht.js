// Die Bestellkarte (A040): eine Vorbestellung aus der Übersicht, Reiter „Vorbestellungen“, antippen und lesen.
// Gezeichnet wird, was der Laptop geschickt hat (js/post.js prüft und kürzt es: bestellDetail) – ausschließlich mit textContent, nie mit HTML.
// Was der Laptop nicht schickt (Preis, Notiz, Herkunft, Kontakt …), steht nicht da: nichts wird ergänzt oder gerechnet.

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}

const FELDER = [['wunsch', 'Wunsch'], ['notiz', 'Notiz'], ['herkunft', 'Woher'], ['kontakt', 'Kontakt'], ['zahlweg', 'Zahlung'], ['betrieb', 'Betrieb'], ['vorher', 'Vorher']];
const STATUS_TON = { 'zugesagt': 'gruen', 'wartet auf Zusage': 'gelb', 'Ware fehlt': 'gelb', 'überfällig': 'rot' };

export function zeichneBestellung(wurzel, d) {
  wurzel.replaceChildren();
  if (!d) { wurzel.append(el('p', 'ue-leer', 'Diese Bestellung ist nicht mehr da. Bitte in der Übersicht aktualisieren.')); return; }
  const kopf = el('div', 'best-kopf');
  kopf.append(el('h2', 'best-kunde', d.kunde));
  if (d.status) kopf.append(el('span', 'ue-marke ' + (STATUS_TON[d.status] || 'gelb'), d.status));
  wurzel.append(kopf);
  const wann = el('p', 'best-wann');
  wann.append(el('span', 'best-etikett', 'Abholung'), document.createTextNode(' '), el('b', '', d.wann || 'Termin offen'));
  wurzel.append(wann);

  const liste = el('div', 'best-posten');
  liste.append(el('h3', '', d.pos.length === 1 ? '1 Posten' : d.pos.length + (d.mehr ? ' von ' + (d.pos.length + d.mehr) : '') + ' Posten'));
  for (const p of d.pos) {
    const z = el('div', 'best-posten-zeile');
    const links = el('span', 'best-posten-name');
    links.append(el('span', 'best-produkt', p.p));
    if (p.z) links.append(el('span', 'ue-klein', p.z));
    z.append(links, el('span', 'best-menge', p.m));
    if (p.e) z.append(el('span', 'best-preis', p.e));
    liste.append(z);
  }
  if (d.mehr) liste.append(el('p', 'ue-leer', `… und ${d.mehr} weitere (am Laptop)`));
  wurzel.append(liste);

  const rest = el('dl', 'best-felder');
  for (const [feld, name] of FELDER) {
    if (!d[feld]) continue;
    rest.append(el('dt', '', name), el('dd', '', d[feld]));
  }
  if (rest.children.length) wurzel.append(rest);
}
