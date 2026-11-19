// Tafeln (Auftrag A055, Stufe 2): Die Übersicht zeigt die gewählten Tafeln gleichzeitig – jede klein, mittel oder groß, in einer Reihenfolge, die man ändern kann.
// Eine Station bekommt ihre Liste vom Laptop (Profil im Stand, eingestellt in der Zentrale unter „Geräte“); ein Verwalter-Handy richtet seine eigene Ansicht
// am Gerät selbst ein (sie bleibt im Gerät, auch nach dem Neustart). Gezeichnet wird ausschließlich mit textContent, nie mit HTML.
import { REITER, zeichneInhalt } from './uebersicht.js';
import { HOF_REITER } from './hof-ansicht.js';

export const ARTEN = ['lager', 'laden', 'tier', 'best', 'mittel', 'masch', 'hof'];
export const GROESSEN = ['klein', 'mittel', 'gross'];
export const GROESSE_TEXT = { klein: 'klein', mittel: 'mittel', gross: 'groß' };
export const TAKTE = [5, 15, 30, 60];
const SCHLUESSEL = 'hof-app-ansicht-v1';
export const SATZ_KAPUTT ='Die gespeicherte Ansicht dieses Geräts war unlesbar. Es gilt die Standard-Ansicht (Reiter). Gespeichert wird erst wieder, wenn du „Fertig“ tippst.';
export const SATZ_LEER = 'Für dieses Gerät ist keine Tafel eingestellt.';

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}
export const tafelName = art => (art === 'hof' ? HOF_REITER : REITER[art])?.name || art;

// Eine Liste von Tafeln in fester Form: nur bekannte und erlaubte Arten, jede einmal, eine unbekannte Größe wird „mittel“.
export function tafelnBereinigen(liste, erlaubt = ARTEN) {
  const aus = [];
  for (const t of Array.isArray(liste) ? liste : []) {
    if (!t || typeof t !== 'object' || typeof t.art !== 'string' || !erlaubt.includes(t.art) || !ARTEN.includes(t.art) || aus.some(x => x.art === t.art)) continue;
    aus.push({ art: t.art, groesse: GROESSEN.includes(t.groesse) ? t.groesse : 'mittel' });
  }
  return aus;
}
export const taktBereinigen = t => (Number.isInteger(t) && TAKTE.includes(t) ? t : 0);

// Die eigene Ansicht dieses Geräts (Verwalter-Handy). { tafeln: [], takt: 0, kaputt: false } – nichts gespeichert heißt: Reiter wie bisher.
export function eigeneLaden(speicher = globalThis.localStorage) {
  const leer = { tafeln: [], takt: 0, kaputt: false };
  let roh = null;
  try { roh = speicher.getItem(SCHLUESSEL); } catch { return leer; }
  if (roh === null || roh === undefined) return leer;
  try {
    const d = JSON.parse(roh);
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.version !== 1 || !Array.isArray(d.tafeln)) throw new Error('Form');
    return { tafeln: tafelnBereinigen(d.tafeln), takt: taktBereinigen(d.takt), kaputt: false };
  } catch { return { ...leer, kaputt: true }; }
}
export function eigeneSpeichern(tafeln, takt, speicher = globalThis.localStorage) {
  try { speicher.setItem(SCHLUESSEL, JSON.stringify({ version: 1, tafeln: tafelnBereinigen(tafeln), takt: taktBereinigen(takt) })); return true; } catch { return false; }
}
export function eigeneLoeschen(speicher = globalThis.localStorage) { try { speicher.removeItem(SCHLUESSEL); } catch { /* nichts zu tun */ } }

// Wie alt der Stand ist, in Worten – und ab wann das auffällt: ohne Takt nach einer Stunde, mit Takt nach dem Dreifachen (mindestens 15 Minuten).
export function altSatz(alterMs, taktMin = 0) {
  if (!Number.isFinite(alterMs)) return '';
  const grenze = taktMin ? Math.max(taktMin * 3, 15) : 60;
  const min = Math.floor(alterMs / 60000);
  if (min < grenze) return '';
  const wie = min < 120 ? `${min} Minuten` : min < 2880 ? `${Math.floor(min / 60)} Stunden` : `${Math.floor(min / 1440)} Tage`;
  return `Achtung: Dieser Stand ist ${wie} alt. Kein Netz, oder ist der Laptop aus?`;
}

// Eine Tafel eine Stelle nach vorn (-1) oder hinten (+1) – die Liste selbst bleibt unverändert.
export function verschoben(liste, index, richtung) {
  const neu = liste.map(t => ({ ...t }));
  const ziel = index + richtung;
  if (index < 0 || index >= neu.length || ziel < 0 || ziel >= neu.length) return neu;
  [neu[index], neu[ziel]] = [neu[ziel], neu[index]];
  return neu;
}

// Die Tafeln der Übersicht. kopf = der geprüfte Stand (oder null). opt: { hofWahl, beiHofWahl, beiBestellung, kk }
export function zeichneTafeln(wurzel, kopf, tafeln, opt = {}) {
  wurzel.replaceChildren();
  if (!tafeln.length) { wurzel.append(el('p', 'ue-hinweis st-satz', SATZ_LEER)); return; }
  const raster = el('div', 'tafeln');
  for (const t of tafeln) {
    const r = t.art === 'hof' ? HOF_REITER : REITER[t.art];
    const kasten = el('section', 'tafel tafel-' + t.groesse);
    kasten.dataset.tafel = t.art;
    kasten.dataset.groesse = t.groesse;
    kasten.style.setProperty('--c', r ? r.farbe : '#888');
    kasten.append(el('h2', 'tafel-kopf', tafelName(t.art)));
    const inhalt = el('div', 'tafel-inhalt');
    zeichneInhalt(inhalt, kopf, t.art, '', opt.hofWahl || '', opt.beiHofWahl || (() => {}), opt.beiBestellung || null, opt.kk || null, null);
    kasten.append(inhalt);
    raster.append(kasten);
  }
  wurzel.append(raster);
}

// Der Editor am Gerät (Verwalter-Handy): welche Tafeln, wie groß, in welcher Reihenfolge; dazu das Auffrischen. aktionen: { fertig(tafeln, takt), zuruecksetzen(), abbrechen() }
// arten = die Arten, die es auf diesem Gerät gibt (ohne „hof“, wenn der Laptop keine Hof-Karte geschickt hat).
export function zeichneEditor(wurzel, start, arten, aktionen, hinweis = '') {
  let arbeit = [...tafelnBereinigen(start.tafeln, arten).map(t => ({ ...t, an: true })), ...arten.filter(a => !start.tafeln.some(t => t.art === a)).map(a => ({ art: a, groesse: 'mittel', an: false }))];
  let takt = taktBereinigen(start.takt);
  const zeichne = () => {
    wurzel.replaceChildren();
    wurzel.append(el('h2', 'ed-titel', 'Ansicht einrichten'));
    wurzel.append(el('p', 'leise klein', 'Gilt nur für dieses Gerät. Haken setzen, Größe wählen, mit den Pfeilen verschieben. Ohne Haken bleibt es bei den Reitern.'));
    if (hinweis) wurzel.append(el('p', 'ue-hinweis', hinweis));
    const liste = el('ol', 'ed-liste');
    arbeit.forEach((t, i) => {
      const z = el('li', 'ed-zeile');
      z.dataset.tafel = t.art;
      const haken = el('label', 'ed-haken');
      const box = el('input'); box.type = 'checkbox'; box.checked = t.an; box.setAttribute('aria-label', tafelName(t.art) + ' zeigen');
      box.addEventListener('change', () => { t.an = box.checked; });
      haken.append(box, el('span', 'ed-name', tafelName(t.art)));
      const groesse = el('select', 'ed-groesse'); groesse.setAttribute('aria-label', 'Größe von ' + tafelName(t.art));
      for (const g of GROESSEN) { const o = el('option', '', GROESSE_TEXT[g]); o.value = g; o.selected = g === t.groesse; groesse.append(o); }
      groesse.addEventListener('change', () => { t.groesse = groesse.value; });
      const hoch = el('button', 'ed-pfeil', '↑'); hoch.type = 'button'; hoch.setAttribute('aria-label', tafelName(t.art) + ' nach oben'); hoch.disabled = i === 0;
      const runter = el('button', 'ed-pfeil', '↓'); runter.type = 'button'; runter.setAttribute('aria-label', tafelName(t.art) + ' nach unten'); runter.disabled = i === arbeit.length - 1;
      hoch.addEventListener('click', () => { arbeit = verschoben(arbeit, i, -1); zeichne(); });
      runter.addEventListener('click', () => { arbeit = verschoben(arbeit, i, 1); zeichne(); });
      z.append(haken, groesse, hoch, runter);
      liste.append(z);
    });
    wurzel.append(liste);
    const tz = el('label', 'ed-takt'); tz.append(el('span', '', 'Von selbst auffrischen'));
    const sel = el('select', 'ed-takt-wahl'); sel.setAttribute('aria-label', 'Von selbst auffrischen');
    for (const [w, text] of [[0, 'nie (nur beim Öffnen)'], ...TAKTE.map(t => [t, `alle ${t} Minuten`])]) { const o = el('option', '', text); o.value = String(w); o.selected = w === takt; sel.append(o); }
    sel.addEventListener('change', () => { takt = Number(sel.value); });
    tz.append(sel);
    wurzel.append(tz);
    const knoepfe = el('div', 'ed-knoepfe');
    const fertig = el('button', 'knopf haupt', 'Fertig'); fertig.type = 'button';
    fertig.addEventListener('click', () => aktionen.fertig(arbeit.filter(t => t.an).map(({ art, groesse }) => ({ art, groesse })), takt));
    const zurueck = el('button', 'knopf', 'Zurück zu den Reitern'); zurueck.type = 'button';
    zurueck.addEventListener('click', () => aktionen.zuruecksetzen());
    const abbrechen = el('button', 'knopf', 'Abbrechen'); abbrechen.type = 'button';
    abbrechen.addEventListener('click', () => aktionen.abbrechen());
    knoepfe.append(fertig, zurueck, abbrechen);
    wurzel.append(knoepfe);
  };
  zeichne();
}
