// Die Übersicht (Funktion „uebersicht“): sechs Reiter mit je drei Zahlen und einer Tabelle, ein Suchfeld, „Aktualisieren“.
// Die Daten kommen als fertiger Stand vom Laptop (js/post.js prüft ihn streng); hier wird nur gezeichnet – ausschließlich mit textContent, nie mit HTML.
import { UEBERSICHT_TABS } from './post.js';

export const REITER = {
  lager: { name: 'Warenlager', farbe: '#2e9d6a', icon: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>' },
  laden: { name: 'Hofladen', farbe: '#3b7ddd', icon: '<path d="M4 9h16l-1-5H5zM5 9v11h14V9M9 20v-6h6v6"/>' },
  tier: { name: 'Tierbestand', farbe: '#e0803a', icon: '<ellipse cx="12" cy="13" rx="8" ry="6.5"/><path d="M6 8 5 4l4 2.5M18 8l1-4-4 2.5"/><ellipse cx="12" cy="15" rx="3" ry="2"/>' },
  best: { name: 'Vorbestellungen', farbe: '#d6457a', icon: '<path d="M3 4h2l2.5 11h10L20 7H6.5"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>' },
  mittel: { name: 'Betriebsmittel', farbe: '#0e8a99', icon: '<path d="M7 3h10l1 4H6zM6 7v13h12V7M10 11h4"/>' },
  masch: { name: 'Maschinen', farbe: '#7d8228', icon: '<circle cx="7" cy="17" r="3"/><circle cx="18" cy="18" r="2"/><path d="M10 17h6M4 14V9h7l2 5M13 9h4l2 5v4"/>' },
};

const SVG = 'http://www.w3.org/2000/svg';
function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}
function symbol(inhalt) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  // Die Symbole sind feste Texte aus diesem Programm (REITER), nie Daten vom Laptop.
  s.innerHTML = inhalt;
  return s;
}

const zwei = n => String(n).padStart(2, '0');

// „Stand: heute 07:15 · vom Laptop“ aus dem Stand-Text des Laptops (JJJJ-MM-TTTHH:MM:SS, Ortszeit des Laptops = die des Hofes).
export function standText(stand, jetzt = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stand || '');
  if (!m) return '';
  const uhr = `${m[4]}:${m[5]}`;
  const tag = `${m[1]}-${m[2]}-${m[3]}`;
  const heute = `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}`;
  const gestern = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - 1);
  const gesternText = `${gestern.getFullYear()}-${zwei(gestern.getMonth() + 1)}-${zwei(gestern.getDate())}`;
  const wann = tag === heute ? `heute ${uhr}` : tag === gesternText ? `gestern ${uhr}` : `${m[3]}.${m[2]}. ${uhr}`;
  return `Stand: ${wann} · vom Laptop`;
}

export function passt(zeile, suche) {
  const s = String(suche || '').trim().toLocaleLowerCase('de');
  if (!s) return true;
  const heu = `${zeile.a} ${zeile.k} ${zeile.m ? zeile.m.t : ''}`.toLocaleLowerCase('de');
  return s.split(/\s+/).every(t => heu.includes(t));
}

// Die Reiter-Leiste (Knöpfe). beiWahl(name) wird beim Antippen gerufen.
export function zeichneReiter(wurzel, aktiv, beiWahl) {
  wurzel.replaceChildren();
  for (const name of UEBERSICHT_TABS) {
    const r = REITER[name];
    const b = el('button', 'ue-reiter' + (name === aktiv ? ' an' : ''));
    b.type = 'button';
    b.dataset.reiter = name;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(name === aktiv));
    b.style.setProperty('--c', r.farbe);
    b.append(symbol(r.icon), el('span', '', r.name));
    b.addEventListener('click', () => beiWahl(name));
    wurzel.append(b);
  }
}

// Der Inhalt eines Reiters. kopf = der geprüfte Stand (oder null: noch keiner da).
export function zeichneInhalt(wurzel, kopf, name, suche) {
  wurzel.replaceChildren();
  const tab = kopf && kopf.tabs ? kopf.tabs[name] : null;
  if (!tab) { wurzel.append(el('p', 'ue-leer', kopf ? 'Dazu gibt es auf dem Laptop gerade nichts.' : 'Noch kein Stand. Tippe oben auf Aktualisieren.')); return; }
  if (tab.hinweis && !tab.zahlen.length && !tab.tabelle.zeilen.length) {      // die Quelle fehlt: nur der Hinweis, keine Zahlen
    wurzel.append(el('p', 'ue-hinweis', tab.hinweis));
    return;
  }
  const zahlen = el('div', 'ue-zahlen');
  for (const z of tab.zahlen) {
    const k = el('div', 'ue-zahl' + (z.ton ? ' ' + z.ton : ''));
    k.append(el('b', '', z.wert), el('span', '', z.text));
    zahlen.append(k);
  }
  if (tab.zahlen.length) wurzel.append(zahlen);
  if (tab.hinweis) wurzel.append(el('p', 'ue-hinweis', tab.hinweis));
  const t = tab.tabelle;
  const treffer = t.zeilen.filter(z => passt(z, suche));
  const karte = el('div', 'ue-tabelle');
  if (t.titel) karte.append(el('h2', '', t.titel));
  if (t.zeilen.length) {
    const kopfZeile = el('div', 'ue-zeile ue-kopf');
    kopfZeile.append(el('span', 'ue-a', t.kopf[0]), el('span', 'ue-z', t.kopf[1]));
    karte.append(kopfZeile);
    for (const z of treffer) {
      const r = el('div', 'ue-zeile');
      const a = el('span', 'ue-a');
      a.append(el('span', 'ue-name', z.a));
      if (z.k || z.m) {
        const klein = el('span', 'ue-klein', z.k);
        if (z.m) klein.append(document.createTextNode(z.k ? ' ' : ''), el('span', 'ue-marke ' + z.m.ton, z.m.t));
        a.append(klein);
      }
      r.append(a, el('span', 'ue-z', z.z));
      karte.append(r);
    }
    if (!treffer.length) karte.append(el('p', 'ue-leer', 'Nichts gefunden.'));
    if (t.mehr) karte.append(el('p', 'ue-leer', `… und ${t.mehr} weitere (am Laptop)`));
  }
  if (t.zeilen.length) wurzel.append(karte);
}
