// Der Reiter „Wissen“ der Übersicht (Funktion „wissen“, N13): die Wiki-Seiten zum Nachlesen am Handy – zum Beispiel eine Anleitung im Schlepper.
// Seit N15 heißt er „Anleitungen“ (im Wiki liegen dafür nur noch Anleitungen), und dieselbe Darstellung zeigt auf dem Handy eines Mitarbeiters den
// Bereich „Anleitungen“ (Funktion „anleitungen“, app.js: anleitungenZeichnen).
// Oben die Anleitungen, dann Themen, Betriebe, Konzepte; das Suchfeld der Übersicht sucht in Titel und Text (Groß/Klein egal, „Mähwerk“ findet auch „Maehwerk“).
// Antippen öffnet die Seite groß. Die Daten kommen als geprüfte Liste vom Laptop (js/post.js, wissenListe); hier wird nur gezeichnet – ausschließlich mit
// DOM-Elementen und textContent, nie mit HTML aus den Daten. Ein Verweis auf eine andere Wiki-Seite öffnet sie in der App; eine Internet-Adresse steht nur als Text da.
// Ohne Netz bleibt der zuletzt geholte Stand lesbar (er liegt mit der Übersicht im Handy). Geändert wird hier nichts.
import { wissenPfad } from './post.js';

export const WISSEN_REITER = { name: 'Anleitungen', farbe: '#8a6fc9', icon: '<path d="M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2z"/><path d="M20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z"/><path d="M7 8h2M15 8h2M7 12h2M15 12h2"/>' };
export const WISSEN_NOCH_NICHT = 'Noch keine Anleitungen vom Laptop. Tippe oben auf Aktualisieren.';
export const WISSEN_NUR_TITEL = 'Diese Seite ist zu lang fürs Handy. Lies sie am Laptop: Zentrale, Seite „Anleitungen“.';
export const WISSEN_FUSS = 'Nur zum Nachlesen – geändert wird im Chat mit Claude.';
const MAX_ZEILEN = 20000;

let offen = '';                     // die geöffnete Seite (Pfad); leer = die Liste
let vorher = [];                    // über Verweise geöffnete Seiten: „Zurück“ geht dorthin zurück
let letzteSuche = '';

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}

// Für die Suche: Groß/Klein egal, ä = ae, ö = oe, ü = ue, ß = ss, Leerraum zusammengezogen (dieselbe Regel wie in der Zentrale).
export function wissenNorm(text) {
  return String(text || '').toLocaleLowerCase('de').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').split(/\s+/).filter(Boolean).join(' ');
}
const heuCache = new WeakMap();
export function wissenPasst(seite, suche) {
  const woerter = wissenNorm(suche).split(' ').filter(Boolean);
  if (!woerter.length) return true;
  let heu = heuCache.get(seite);
  if (heu === undefined) { heu = wissenNorm(seite.titel + ' ' + (seite.text || '')); heuCache.set(seite, heu); }
  return woerter.every(w => heu.includes(w));
}

export function wissenSchliessen() { offen = ''; vorher = []; }
export function wissenOffen() { return offen; }

function datum(stand) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stand || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

// ---- Markdown -> DOM (nur Text-Knoten und feste Elemente) ------------------------------------------------------------------------------
const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|!\[([^\]\n]*)\]\(([^)\n]*)\)|\[([^\]\n]+)\]\(([^)\n]*)\)|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])|(?<!\w)_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g;
const TRENN = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LISTE = /^(\s*)([-*+]|\d{1,4}[.)])\s+(.*)$/;
const UEBER = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LINIE = /^((-\s*){3,}|(\*\s*){3,}|(_\s*){3,})$/;

// Ein Verweis im Wiki („../themen/x.md#abschnitt“) relativ zur Seite `von` – als geprüfter Pfad, sonst ''. Internet-Adressen und Sprungmarken sind keine Seite.
export function zielPfad(ziel, von) {
  let z = String(ziel || '').trim().split(/\s+/)[0] || '';
  z = z.replace(/^</, '').replace(/>$/, '');
  if (!z || z.startsWith('#') || z.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(z)) return '';
  z = z.split('#')[0].split('?')[0];
  try { z = decodeURIComponent(z); } catch { return ''; }
  if (!z) return '';
  const teile = von.includes('/') ? von.slice(0, von.lastIndexOf('/')).split('/') : [];
  for (const t of z.split('/')) {
    if (t === '' || t === '.') continue;
    if (t === '..') { if (!teile.length) return ''; teile.pop(); } else teile.push(t);
  }
  return wissenPfad(teile.join('/'));
}

function inline(text, kx, tiefe = 0) {
  const f = document.createDocumentFragment();
  if (tiefe > 3) { f.append(text); return f; }
  let pos = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > pos) f.append(text.slice(pos, m.index));
    pos = m.index + m[0].length;
    if (m[1] !== undefined) f.append(el('code', 'wi-code-kurz', m[1]));
    else if (m[2] !== undefined) { const b = el('b'); b.append(inline(m[2], kx, tiefe + 1)); f.append(b); }
    else if (m[3] !== undefined) f.append(m[3] || 'Bild');                              // ein Bild: nur sein Text
    else if (m[5] !== undefined) {
      const wort = m[5], ziel = m[6];
      const pfad = zielPfad(ziel, kx.von);
      if (pfad && kx.seiten.has(pfad)) {                                                // eine andere Wiki-Seite: öffnet sie in der App
        const a = el('a', 'wi-verweis');
        a.setAttribute('role', 'link');
        a.tabIndex = 0;
        a.dataset.ziel = pfad;
        a.append(inline(wort, kx, tiefe + 1));
        const auf = e => { e.preventDefault(); kx.oeffnen(pfad); };
        a.addEventListener('click', auf);
        a.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') auf(e); });
        f.append(a);
      } else if (/^https?:\/\//i.test(ziel.trim())) {                                   // Internet: nur als Text, nicht antippbar
        const s = el('span', 'wi-extern');
        s.append(inline(wort, kx, tiefe + 1), ' ', el('span', 'wi-adresse', '(' + ziel.trim() + ')'));
        f.append(s);
      } else f.append(inline(wort, kx, tiefe + 1));
    } else { const i = el('i'); i.append(inline(m[7] !== undefined ? m[7] : m[8], kx, tiefe + 1)); f.append(i); }
  }
  if (pos < text.length) f.append(text.slice(pos));
  return f;
}

function marke(text) {
  if (text.includes('⚠')) return ' wi-widerspruch';
  if (text.includes('❓')) return ' wi-frage';
  return '';
}

function zellen(zeile) {
  let z = zeile.trim();
  if (z.startsWith('|')) z = z.slice(1);
  if (z.endsWith('|') && !z.endsWith('\\|')) z = z.slice(0, -1);
  return z.split(/(?<!\\)\|/).map(c => c.trim());
}

// Die ganze Seite: Überschriften, Absätze, Listen (auch nummeriert), Tabellen, Code-Blöcke, Zitate, Trennlinien; ❓ und ⚠️ farbig.
export function seiteAlsDom(text, kx) {
  const aus = document.createDocumentFragment();
  const zeilen = String(text || '').replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_ZEILEN);
  let absatz = [], liste = null, listeArt = '';
  const absatzFertig = () => {
    if (!absatz.length) return;
    const roh = absatz.join(' ');
    const kopf = absatz.every(a => a.startsWith('Betrieb:') || a.startsWith('Stand:')) ? ' wi-kopf' : '';
    const p = el('p', 'wi-absatz' + marke(roh) + kopf);
    absatz.forEach((a, i) => { if (i) p.append(el('br')); p.append(inline(a, kx)); });
    aus.append(p);
    absatz = [];
  };
  const listeFertig = () => { if (liste) { aus.append(liste); liste = null; listeArt = ''; } };
  let i = 0;
  while (i < zeilen.length) {
    const z = zeilen[i], s = z.trim();
    if (s.startsWith('```') || s.startsWith('~~~')) {
      absatzFertig(); listeFertig();
      const zaun = s.slice(0, 3), code = [];
      i++;
      while (i < zeilen.length && !zeilen[i].trim().startsWith(zaun)) code.push(zeilen[i++]);
      aus.append(el('pre', 'wi-code', code.join('\n')));
      i++;
      continue;
    }
    if (!s) { absatzFertig(); listeFertig(); i++; continue; }
    let m = UEBER.exec(s);
    if (m) {
      absatzFertig(); listeFertig();
      const h = el('h' + Math.min(m[1].length, 4), 'wi-h' + marke(m[2]));
      h.append(inline(m[2], kx));
      aus.append(h);
      i++;
      continue;
    }
    if (LINIE.test(s)) { absatzFertig(); listeFertig(); aus.append(el('hr', 'wi-linie')); i++; continue; }
    if (s.startsWith('|') && i + 1 < zeilen.length && TRENN.test(zeilen[i + 1])) {
      absatzFertig(); listeFertig();
      const kopf = zellen(s);
      i += 2;
      const rahmen = el('div', 'wi-tabelle'), tab = el('table'), thead = el('thead'), tr0 = el('tr'), tbody = el('tbody');
      for (const c of kopf) { const th = el('th'); th.append(inline(c, kx)); tr0.append(th); }
      thead.append(tr0);
      while (i < zeilen.length && zeilen[i].trim().startsWith('|')) {
        const r = zellen(zeilen[i]);
        const tr = el('tr', marke(r.join(' ')).trim());
        for (const c of r) { const td = el('td'); td.append(inline(c, kx)); tr.append(td); }
        tbody.append(tr);
        i++;
      }
      tab.append(thead, tbody);
      rahmen.append(tab);
      aus.append(rahmen);
      continue;
    }
    if (s.startsWith('>')) {
      absatzFertig(); listeFertig();
      const zitat = [];
      while (i < zeilen.length && zeilen[i].trim().startsWith('>')) zitat.push(zeilen[i++].trim().slice(1).trim());
      const q = el('blockquote', 'wi-zitat' + marke(zitat.join(' ')));
      zitat.filter(Boolean).forEach((x, n) => { if (n) q.append(el('br')); q.append(inline(x, kx)); });
      aus.append(q);
      continue;
    }
    m = LISTE.exec(z);
    if (m) {
      absatzFertig();
      const art = /\d/.test(m[2][0]) ? 'ol' : 'ul';
      if (liste && art !== listeArt && !m[1]) listeFertig();
      if (!liste) { liste = el(art, 'wi-liste'); listeArt = art; }
      const li = el('li', (marke(m[3]) + (m[1].length >= 2 ? ' wi-tief' : '')).trim());
      li.append(inline(m[3], kx));
      liste.append(li);
      i++;
      continue;
    }
    if (liste && /^(  |\t)/.test(z) && liste.lastElementChild) {              // Fortsetzung eines Listenpunkts
      liste.lastElementChild.append(' ', inline(s, kx));
      i++;
      continue;
    }
    listeFertig();
    if (marke(s)) { absatzFertig(); absatz.push(s); absatzFertig(); }        // ❓ / ⚠️: eine eigene, farbige Zeile
    else absatz.push(s);
    i++;
  }
  absatzFertig();
  listeFertig();
  return aus;
}

// ---- Liste und Seite ---------------------------------------------------------------------------------------------------------------
function zurueckKnopf(text, beiTippen) {
  const b = el('button', 'wi-zurueck', text);
  b.type = 'button';
  b.addEventListener('click', beiTippen);
  return b;
}

function nachOben(wurzel) {
  try { wurzel.scrollIntoView({ block: 'start' }); } catch { /* egal */ }
  try { window.scrollTo(0, 0); } catch { /* egal */ }
}

// wurzel: der Inhaltsbereich; liste: die geprüfte Liste (oder null); suche: der Text im Suchfeld der Übersicht.
export function zeichneWissen(wurzel, liste, suche) {
  suche = suche || '';
  if (suche !== letzteSuche) { letzteSuche = suche; wissenSchliessen(); }       // wer sucht, will die Liste sehen
  wurzel.replaceChildren();
  if (!liste) { wurzel.append(el('p', 'ue-leer', WISSEN_NOCH_NICHT)); return; }
  if (liste.zustand !== 'ok') { wurzel.append(el('p', 'ue-hinweis', liste.hinweis || 'Das Wissen lässt sich gerade nicht lesen.')); return; }
  const seiten = new Map(liste.seiten.map(s => [s.pfad, s]));
  const neu = () => zeichneWissen(wurzel, liste, letzteSuche);
  if (offen && !seiten.has(offen)) wissenSchliessen();
  if (offen) {
    const s = seiten.get(offen);
    const zurueck = () => { offen = vorher.pop() || ''; neu(); nachOben(wurzel); };
    const zText = vorher.length ? 'Zurück zu „' + (seiten.get(vorher[vorher.length - 1]) || { titel: 'der Seite' }).titel + '“' : 'Zurück zur Liste';
    const kx = { von: s.pfad, seiten, oeffnen: pfad => { vorher.push(offen); offen = pfad; neu(); nachOben(wurzel); } };
    const art = el('article', 'wi-seite');
    art.dataset.pfad = s.pfad;
    const text = s.text || '';
    if (!/^\s*#\s/.test(text)) art.append(el('h1', 'wi-h', s.titel));
    if (s.nur_titel) art.append(el('p', 'wi-absatz wi-laptop', WISSEN_NUR_TITEL));
    else art.append(seiteAlsDom(text, kx));
    wurzel.append(zurueckKnopf(zText, zurueck), art, zurueckKnopf(zText, zurueck));
    return;
  }
  if (!liste.seiten.length) { wurzel.append(el('p', 'ue-leer', 'Noch keine Seiten da.')); return; }
  const treffer = liste.seiten.filter(s => wissenPasst(s, suche));
  if (!treffer.length) { wurzel.append(el('p', 'ue-leer', 'Nichts gefunden.')); return; }
  const kasten = el('div', 'ue-tabelle wi-liste-seiten');
  for (const [g, titel] of liste.gruppen) {
    const drin = treffer.filter(s => s.gruppe === g);
    if (!drin.length) continue;
    const gr = el('section', 'wi-gruppe');
    gr.dataset.gruppe = g || 'allgemein';
    gr.append(el('h2', 'wi-gruppe-titel', titel));
    for (const s of drin) {
      const b = el('button', 'wi-eintrag' + (s.nur_titel ? ' wi-nur-titel' : ''));
      b.type = 'button';
      b.dataset.pfad = s.pfad;
      b.append(el('span', 'wi-titel', s.titel));
      const unter = [datum(s.stand) ? 'Stand ' + datum(s.stand) : '', s.nur_titel ? 'am Laptop' : ''].filter(Boolean).join(' · ');
      if (unter) b.append(el('span', 'wi-unter', unter));
      b.addEventListener('click', () => { offen = s.pfad; vorher = []; neu(); nachOben(wurzel); });
      gr.append(b);
    }
    kasten.append(gr);
  }
  wurzel.append(kasten);
  if (suche.trim()) wurzel.append(el('p', 'ue-leer', treffer.length === 1 ? '1 Seite passt.' : `${treffer.length} Seiten passen.`));
  if (liste.mehr) wurzel.append(el('p', 'ue-leer', `… und ${liste.mehr} weitere Seiten (am Laptop)`));
  wurzel.append(el('p', 'ue-leer', WISSEN_FUSS));
}
