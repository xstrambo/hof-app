// Der Reiter „Artikel“ der Übersicht (Funktion „artikel“, A063): der Artikelstamm zum Ansehen, mit Suche, Filter nach Warengruppe und der Ansicht „Preise prüfen“.
// Die Daten kommen als geprüfte Liste vom Laptop (js/post.js, artikelListe); hier wird nur gezeichnet – ausschließlich mit textContent, nie mit HTML. Nichts wird geändert.
import { ARTIKEL_PREIS_HINWEIS } from './post.js';

export const ARTIKEL_REITER = { name: 'Artikel', farbe: '#5b8fb9', icon: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>' };
export const ARTIKEL_ZEILEN_MAX = 150;
const wahl = { gruppe: '', pruefen: false };          // die Auswahl bleibt, solange die App offen ist; ein unbekannter Wert fällt beim Zeichnen weg
let letzteSuche = '';

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}

export function artikelPasst(z, gruppe, pruefen, suche) {
  if (gruppe && z.g !== gruppe) return false;
  if (pruefen && !z.i.includes(ARTIKEL_PREIS_HINWEIS)) return false;
  const s = String(suche || '').trim().toLocaleLowerCase('de');
  if (!s) return true;
  const heu = `${z.n} ${z.a} ${z.g} ${z.c}`.toLocaleLowerCase('de');
  return s.split(/\s+/).every(w => heu.includes(w));
}

const preis = t => (t ? t + ' €' : '–');

function knopf(text, an, beiTipp, daten) {
  const b = el('button', 'ar-knopf' + (an ? ' an' : ''), text);
  b.type = 'button';
  b.setAttribute('aria-pressed', String(!!an));
  for (const [k, v] of Object.entries(daten || {})) b.dataset[k] = v;
  b.addEventListener('click', beiTipp);
  return b;
}

// wurzel: der Inhaltsbereich; artikel: die geprüfte Liste (oder null); suche: der Text im Suchfeld der Übersicht.
export function zeichneArtikel(wurzel, artikel, suche) {
  letzteSuche = suche || '';
  wurzel.replaceChildren();
  if (!artikel) { wurzel.append(el('p', 'ue-leer', 'Noch keine Artikel. Tippe oben auf Aktualisieren.')); return; }
  if (artikel.hinweis) wurzel.append(el('p', 'ue-hinweis', artikel.hinweis));
  if (!artikel.zeilen.length) return;
  if (wahl.gruppe && !artikel.gruppen.includes(wahl.gruppe)) wahl.gruppe = '';
  const neu = () => zeichneArtikel(wurzel, artikel, letzteSuche);
  const gruppe = wahl.gruppe, pruefen = wahl.pruefen;
  const feld = (titel, knoepfe) => { const w = el('div', 'ar-wahl'); w.setAttribute('role', 'group'); w.setAttribute('aria-label', titel); w.append(...knoepfe); return w; };
  wurzel.append(feld('Warengruppe', [knopf('Alle Warengruppen', !gruppe, () => { wahl.gruppe = ''; neu(); }, { gruppe: '' }),
    ...artikel.gruppen.map(g => knopf(g, gruppe === g, () => { wahl.gruppe = g; neu(); }, { gruppe: g }))]));
  wurzel.append(feld('Ansicht', [knopf('Alle Artikel', !pruefen, () => { wahl.pruefen = false; neu(); }, { ansicht: 'alle' }),
    knopf(`Preise prüfen (${artikel.pruefen})`, pruefen, () => { wahl.pruefen = true; neu(); }, { ansicht: 'pruefen' })]));
  const treffer = artikel.zeilen.filter(z => artikelPasst(z, gruppe, pruefen, suche));
  if (!treffer.length) {
    wurzel.append(el('p', 'ue-leer', suche && String(suche).trim() ? 'Nichts gefunden.' : 'Hier steht kein Artikel.'));
    return;
  }
  const karte = el('div', 'ue-tabelle ar-liste');
  for (const z of treffer.slice(0, ARTIKEL_ZEILEN_MAX)) {
    const zeile = el('div', 'ar-zeile');
    zeile.dataset.artikel = z.n;
    const links = el('span', 'ar-links');
    links.append(el('span', 'ar-name', z.a || '(ohne Name)'));
    const klein = [z.n || 'ohne Nummer', z.g, z.c ? 'Barcode ' + z.c : ''].filter(Boolean).join(' · ');
    links.append(el('span', 'ar-unter', klein));
    const rechts = el('span', 'ar-rechts');
    rechts.append(el('span', 'ar-preis', `Händler ${preis(z.h)}`), el('span', 'ar-preis', `Endkunde ${preis(z.e)}`));
    zeile.append(links, rechts);
    if (z.v.length || z.i.length) {
      const marken = el('span', 'ar-marken');
      for (const v of z.v) marken.append(el('span', 'ue-marke gruen', v));
      for (const i of z.i) marken.append(el('span', 'ue-marke gelb', i));
      zeile.append(marken);
    }
    karte.append(zeile);
  }
  wurzel.append(karte);
  if (treffer.length > ARTIKEL_ZEILEN_MAX) wurzel.append(el('p', 'ue-leer', `… und ${treffer.length - ARTIKEL_ZEILEN_MAX} weitere – bitte die Suche eingrenzen`));
  if (artikel.mehr) wurzel.append(el('p', 'ue-leer', `… und ${artikel.mehr} weitere Artikel (am Laptop)`));
  const fuss = 'Nur zum Ansehen: geändert wird der Artikelstamm am Laptop.' + (artikel.geprueft ? ` Preise zuletzt mit dem Automaten abgeglichen: ${artikel.geprueft.slice(8, 10)}.${artikel.geprueft.slice(5, 7)}.${artikel.geprueft.slice(0, 4)}.` : '');
  wurzel.append(el('p', 'ue-leer', fuss));
}
