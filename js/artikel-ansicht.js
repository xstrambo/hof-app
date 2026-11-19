// Der Reiter „Artikel“ der Übersicht (Funktion „artikel“, A063): der Artikelstamm zum Ansehen, mit Suche, Filter nach Warengruppe und der Ansicht „Preise prüfen“.
// Die Daten kommen als geprüfte Liste vom Laptop (js/post.js, artikelListe); hier wird nur gezeichnet – ausschließlich mit textContent, nie mit HTML. Nichts wird geändert.
import { ARTIKEL_PREIS_HINWEIS } from './post.js';

export const ARTIKEL_REITER = { name: 'Artikel', farbe: '#5b8fb9', icon: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>' };
export const ARTIKEL_ZEILEN_MAX = 150;
// A069: Sortieren per Tippen auf die Überschrift (feste Liste wie in der Zentrale; alles andere fällt auf die Nummer zurück)
export const ARTIKEL_SORTIERBAR = ['nr', 'name', 'gruppe', 'haendler', 'endkunde'];
const wahl = { gruppe: '', pruefen: false, sort: 'nr', ab: false };   // die Auswahl bleibt, solange die App offen ist; ein unbekannter Wert fällt beim Zeichnen weg
let letzteSuche = '';
// Die Spalten der Tabelle: breit (ab 720 Punkten) alle acht, am Handy nur Artikel · Händler · Endkunde (Umschalten nur über CSS, styles.css „.ar-…“)
const SPALTEN = [
  { k: 'nr', lang: 'Nr.', sort: true, kl: 'ar-sp-nr' },
  { k: 'name', lang: 'Artikel', sort: true, kl: 'ar-sp-name' },
  { k: 'gruppe', lang: 'Warengruppe', sort: true, kl: 'ar-sp-gruppe' },
  { k: 'haendler', lang: 'Händlerpreis', kurz: 'Händler', sort: true, zahl: true, kl: 'ar-sp-h' },
  { k: 'endkunde', lang: 'Endkundenpreis', kurz: 'Endkunde', sort: true, zahl: true, kl: 'ar-sp-e' },
  { k: 'verkauf', lang: 'Verkauf', kl: 'ar-sp-v' },
  { k: 'barcode', lang: 'Barcode', kl: 'ar-sp-c' },
  { k: 'hinweis', lang: 'Hinweis', kl: 'ar-sp-i' },
];
const WERT = { nr: z => z.n, name: z => z.a, gruppe: z => z.g, haendler: z => z.h, endkunde: z => z.e };

// Für das Alphabet: Groß und Klein egal, Umlaute wie ihre Grundbuchstaben (ä wie a, ß wie ss) – wie zentrale/tabelle.py
export function artikelSortText(t) {
  return String(t || '').toLocaleLowerCase('de').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// Ein Preis-Text mit Komma („2,10“, „1.234,50“) als Zahl; leer oder unlesbar = null
export function artikelZahl(t) {
  const s = String(t || '').replace(/[€\s]/g, '');
  if (!s) return null;
  const z = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(z) ? z : null;
}

// Ordnet die Zeilen: Preise als Zahlen, Texte nach artikelSortText; leere immer am Ende (in beiden Richtungen); bei Gleichstand die Nummer
export function artikelOrdnen(zeilen, sort, ab) {
  const s = ARTIKEL_SORTIERBAR.includes(sort) ? sort : 'nr';
  const zahl = s === 'haendler' || s === 'endkunde';
  const vgl = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const nach_nr = (a, b) => vgl(a.n ? 0 : 1, b.n ? 0 : 1) || vgl(artikelSortText(a.n), artikelSortText(b.n)) || vgl(artikelSortText(a.a), artikelSortText(b.a));
  const wert = z => { const w = WERT[s](z); return zahl ? artikelZahl(w) : (w ? artikelSortText(w) : null); };
  const paare = zeilen.map(z => [wert(z), z]);
  const voll = paare.filter(p => p[0] !== null && p[0] !== ''), leer = paare.filter(p => p[0] === null || p[0] === '');
  voll.sort((p, q) => (ab ? -1 : 1) * vgl(p[0], q[0]) || nach_nr(p[1], q[1]));
  leer.sort((p, q) => nach_nr(p[1], q[1]));
  return [...voll, ...leer].map(p => p[1]);
}

// nur für Prüfungen: die Sortierung auf den Standard (Nummer, aufsteigend) zurück
export function artikelSortierungZuruecksetzen() { wahl.sort = 'nr'; wahl.ab = false; }

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
  if (!ARTIKEL_SORTIERBAR.includes(wahl.sort)) { wahl.sort = 'nr'; wahl.ab = false; }
  const karte = el('div', 'ue-tabelle ar-liste');
  const tabelle = el('table', 'ar-tabelle');
  const kopf = el('tr');
  for (const sp of SPALTEN) {
    const th = el('th', sp.kl + (sp.zahl ? ' ar-zahl' : ''));
    th.scope = 'col';
    const beschriftung = sp.kurz ? [el('span', 'ar-lang', sp.lang), el('span', 'ar-kurz', sp.kurz)] : [el('span', '', sp.lang)];
    if (sp.sort) {
      const gewaehlt = wahl.sort === sp.k;
      const b = el('button', 'ar-sort');
      b.type = 'button';
      b.dataset.sort = sp.k;
      b.append(...beschriftung);
      if (gewaehlt) {
        th.setAttribute('aria-sort', wahl.ab ? 'descending' : 'ascending');
        const pfeil = el('span', 'ar-pfeil', wahl.ab ? '▼' : '▲');
        pfeil.setAttribute('aria-hidden', 'true');
        b.append(pfeil);
      }
      b.addEventListener('click', () => { if (wahl.sort === sp.k) wahl.ab = !wahl.ab; else { wahl.sort = sp.k; wahl.ab = false; } neu(); });
      th.append(b);
    } else {
      const t = el('span', 'ar-kopf-text');
      t.append(...beschriftung);
      th.append(t);
    }
    kopf.append(th);
  }
  const thead = el('thead');
  thead.append(kopf);
  const tbody = el('tbody');
  for (const z of artikelOrdnen(treffer, wahl.sort, wahl.ab).slice(0, ARTIKEL_ZEILEN_MAX)) {
    const zeile = el('tr', 'ar-zeile');
    zeile.dataset.artikel = z.n;
    const zelle = (klasse, text) => el('td', klasse, text);
    const name = zelle('ar-sp-name');
    name.append(el('span', 'ar-name', z.a || '(ohne Name)'));
    const klein = [z.n || 'ohne Nummer', z.g, z.c ? 'Barcode ' + z.c : ''].filter(Boolean).join(' · ');
    name.append(el('span', 'ar-unter', klein));               // am Handy unter dem Namen (breit stehen Nummer, Gruppe, Barcode in eigenen Spalten)
    if (z.v.length || z.i.length) {
      const marken = el('span', 'ar-marken');
      for (const v of z.v) marken.append(el('span', 'ue-marke gruen', v));
      for (const i of z.i) marken.append(el('span', 'ue-marke gelb', i));
      name.append(marken);
    }
    const verkauf = zelle('ar-sp-v'), hinweis = zelle('ar-sp-i');
    for (const v of z.v) verkauf.append(el('span', 'ue-marke gruen', v));
    for (const i of z.i) hinweis.append(el('span', 'ue-marke gelb', i));
    zeile.append(zelle('ar-sp-nr', z.n || 'ohne Nummer'), name, zelle('ar-sp-gruppe', z.g), zelle('ar-sp-h ar-zahl ar-preis', preis(z.h)),
      zelle('ar-sp-e ar-zahl ar-preis', preis(z.e)), verkauf, zelle('ar-sp-c', z.c), hinweis);
    tbody.append(zeile);
  }
  tabelle.append(thead, tbody);
  karte.append(tabelle);
  wurzel.append(karte);
  if (treffer.length > ARTIKEL_ZEILEN_MAX) wurzel.append(el('p', 'ue-leer', `… und ${treffer.length - ARTIKEL_ZEILEN_MAX} weitere – bitte die Suche eingrenzen`));
  if (artikel.mehr) wurzel.append(el('p', 'ue-leer', `… und ${artikel.mehr} weitere Artikel (am Laptop)`));
  const fuss = 'Nur zum Ansehen: geändert wird der Artikelstamm am Laptop.' + (artikel.geprueft ? ` Preise zuletzt mit dem Automaten abgeglichen: ${artikel.geprueft.slice(8, 10)}.${artikel.geprueft.slice(5, 7)}.${artikel.geprueft.slice(0, 4)}.` : '');
  wurzel.append(el('p', 'ue-leer', fuss));
}
