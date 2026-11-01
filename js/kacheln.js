// Kacheln vor dem Einsprechen (Funktion „kacheln“): acht Bereiche zum Antippen. Der gewählte Bereich geht als Feld `bereich` mit der Nachricht mit
// (im verschlüsselten Kopf); der Laptop schreibt ihn als Zeile „Bereich: <Wort>“ in die Nachricht, und der Sortierer ordnet danach ein.
// Ohne Kachel ist alles wie bisher. Die Wörter hier sind dieselben wie in hof-app/abholen.py (BEREICHE) – nur diese acht sind erlaubt.
const SVG = 'http://www.w3.org/2000/svg';

export const BEREICHE = [
  { wert: 'wareneingang', name: 'Wareneingang', farbe: '#2e9d6a', icon: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>' },
  { wert: 'verkauf', name: 'Verkauf', farbe: '#3b7ddd', icon: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>' },
  { wert: 'inventur', name: 'Inventur', farbe: '#8b5cf6', icon: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10l1.5 1.5L13 9M9 16h6"/>' },
  { wert: 'tiere', name: 'Tiere', farbe: '#e0803a', icon: '<ellipse cx="12" cy="13" rx="8" ry="6.5"/><path d="M6 8 5 4l4 2.5M18 8l1-4-4 2.5"/><ellipse cx="12" cy="15" rx="3" ry="2"/>' },
  { wert: 'bestellung', name: 'Bestellung', farbe: '#d6457a', icon: '<path d="M3 4h2l2.5 11h10L20 7H6.5"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>' },
  { wert: 'dokument', name: 'Dokument', farbe: '#0e8a99', icon: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>' },
  { wert: 'aufgabe', name: 'Aufgabe', farbe: '#7d8228', icon: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>' },
  { wert: 'abfrage', name: 'Zeig mir', farbe: '#64748b', icon: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>' },
];
export const WERTE = BEREICHE.map(b => b.wert);
export const istBereich = x => typeof x === 'string' && WERTE.includes(x);
export const bereichVon = wert => BEREICHE.find(b => b.wert === wert) || null;

// Ein Strichsymbol (feste Texte aus diesem Programm, nie Daten von außen).
export function symbol(wert) {
  const b = bereichVon(wert);
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (b) s.innerHTML = b.icon;
  return s;
}

// Die acht Kacheln zeichnen. gewaehlt: der gerade gewählte Wert oder ''. beiWahl(wert): Antippen (die gewählte Kachel noch einmal = abwählen).
export function zeichneKacheln(wurzel, gewaehlt, beiWahl) {
  wurzel.replaceChildren();
  for (const b of BEREICHE) {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'kachel' + (b.wert === gewaehlt ? ' an' : '');
    k.dataset.bereich = b.wert;
    k.setAttribute('aria-pressed', String(b.wert === gewaehlt));
    k.style.setProperty('--c', b.farbe);
    const ic = document.createElement('span');
    ic.className = 'kachel-ic';
    ic.append(symbol(b.wert));
    const t = document.createElement('b');
    t.textContent = b.name;
    k.append(ic, t);
    k.addEventListener('click', () => beiWahl(b.wert === gewaehlt ? '' : b.wert));
    wurzel.append(k);
  }
}
