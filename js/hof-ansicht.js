// Der Reiter „Hof“ in der Übersicht (Funktion „hof“, Auftrag A015): je Standort die Gebäude als antippbare Kacheln (Name, Rolle, eine Kennzahl),
// Antippen zeigt die Info-Karte. Die Daten kommen vom Laptop (js/post.js prüft sie streng); hier wird nur gezeichnet – ausschließlich mit textContent.
// Verknüpft wird am Laptop (Zentrale, Hof-Karte): Ohne Verknüpfung steht „noch nicht verknüpft“, nie eine Zahl.
import { HOF_NICHT_VERKNUEPFT } from './post.js';

export const HOF_ICON = '<path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/>';
export const HOF_REITER = { name: 'Hof', farbe: '#8a6d2b', icon: HOF_ICON };

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}

// Passt eine Kachel zur Suche? (Name, Rolle, Kennzahl)
export function hofPasst(g, suche) {
  const s = String(suche || '').trim().toLocaleLowerCase('de');
  if (!s) return true;
  const heu = `${g.name} ${g.rolle} ${g.kennzahl}`.toLocaleLowerCase('de');
  return s.split(/\s+/).every(t => heu.includes(t));
}

// Das gewählte Gebäude in der Liste der Standorte (oder null).
export function hofFinden(hof, id) {
  if (!hof) return null;
  for (const s of hof.standorte) for (const g of s.gebaeude) if (g.id === id) return { standort: s, gebaeude: g };
  return null;
}

function karteZeichnen(wurzel, g, zurueck) {
  const k = el('div', 'hof-info');
  const kopf = el('div', 'hof-info-kopf');
  const b = el('button', 'knopf-icon');
  b.type = 'button';
  b.setAttribute('aria-label', 'Zurück zu den Gebäuden');
  b.textContent = '‹';
  b.addEventListener('click', zurueck);
  const titel = el('div', 'hof-info-titel');
  titel.append(el('h2', '', g.name), el('span', 'hof-rolle', g.rolle));
  kopf.append(b, titel);
  k.append(kopf);
  if (!g.verknuepft) {
    k.append(el('p', 'hof-nv', HOF_NICHT_VERKNUEPFT));
    k.append(el('p', 'ue-hinweis', g.hinweis || 'Dieses Gebäude ist noch nicht mit einem Stall, Silo oder Lager verknüpft. Verknüpft wird am Laptop (Hof-Karte).'));
    wurzel.append(k);
    return;
  }
  const zahl = el('div', 'hof-kennzahl' + (g.ton ? ' ' + g.ton : ''));
  zahl.append(el('b', '', g.kennzahl), el('span', '', g.ziel ? `verknüpft mit ${g.ziel.name}` : ''));
  k.append(zahl);
  for (const a of g.abschnitte) {
    const box = el('div', 'ue-tabelle hof-abschnitt');
    box.append(el('h2', '', a.titel));
    if (a.zeilen.length) {
      for (const z of a.zeilen) box.append(el('div', 'ue-zeile hof-zeile' + (z.ton ? ' ' + z.ton : ''), z.t));
    } else {
      box.append(el('p', 'ue-leer', a.leer || 'Nichts eingetragen.'));
    }
    k.append(box);
  }
  wurzel.append(k);
}

// hof = geprüfte Gebäude-Infos (oder null: der Laptop hat keine geschickt). wahl = Kennung des angetippten Gebäudes (oder ''). beiWahl(id) beim Antippen.
export function zeichneHof(wurzel, hof, wahl, suche, beiWahl) {
  wurzel.replaceChildren();
  if (!hof) { wurzel.append(el('p', 'ue-leer', 'Noch keine Gebäude-Infos. Tippe oben auf Aktualisieren.')); return; }
  if (hof.karte !== 'ok') { wurzel.append(el('p', 'ue-hinweis', hof.hinweis || 'Auf dem Laptop gibt es noch keine Hof-Karte.')); return; }
  const treffer = hofFinden(hof, wahl);
  if (treffer) { karteZeichnen(wurzel, treffer.gebaeude, () => beiWahl('')); return; }
  if (hof.hinweis) wurzel.append(el('p', 'ue-hinweis', hof.hinweis));
  for (const s of hof.standorte) {
    const liste = s.gebaeude.filter(g => hofPasst(g, suche));
    if (!s.gebaeude.length && !s.weitere) continue;
    const box = el('section', 'hof-standort');
    box.append(el('h2', '', s.name));
    const gitter = el('div', 'hof-kacheln');
    for (const g of liste) {
      const k = el('button', 'hof-kachel' + (g.verknuepft ? '' : ' nv') + (g.ton ? ' ' + g.ton : ''));
      k.type = 'button';
      k.dataset.gebaeude = g.id;
      k.append(el('span', 'hof-k-name', g.name), el('span', 'hof-k-rolle', g.rolle), el('span', 'hof-k-zahl', g.kennzahl));
      k.addEventListener('click', () => beiWahl(g.id));
      gitter.append(k);
    }
    box.append(gitter);
    if (!liste.length) box.append(el('p', 'ue-leer', 'Nichts gefunden.'));
    if (s.weitere) box.append(el('p', 'ue-leer', `… und ${s.weitere} weitere Gebäude ohne Namen oder Verknüpfung (am Laptop)`));
    wurzel.append(box);
  }
  if (!hof.standorte.length) wurzel.append(el('p', 'ue-leer', 'Es gibt noch keine Gebäude.'));
}
