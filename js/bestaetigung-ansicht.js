// Die Karte „Bestätigen?“ unter der gesendeten Nachricht (Funktion „bestaetigung“): was der Laptop verstanden hat, in festen Feldern, und zwei Knöpfe.
// Reine Darstellung – geholt und geprüft wird in post.js, gesendet in app.js. Alles, was vom Laptop kommt, wird nur als Text eingesetzt (nie als HTML).

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export const WAHL_TEXT = { stimmt: 'Stimmt', falsch: 'Falsch' };

// eintrag: { instanz, bezug, kopf: { id, stand, karten, satz, fassung }, meine? }
// beiWahl(eintrag, 'stimmt' | 'falsch') -> Promise: wird beim Tippen gerufen (die Knöpfe sind dann gesperrt, bis die Antwort in der Warteschlange liegt)
export function zeichneKarte(eintrag, beiWahl) {
  const k = eintrag.kopf;
  const karte = el('div', 'eintrag-karte');
  karte.dataset.funktion = 'bestaetigung';
  karte.dataset.karte = k.id;
  karte.dataset.stand = k.stand;
  const kopf = el('div', 'karte-kopf');
  kopf.appendChild(el('b', 'karte-frage', k.stand === 'offen' ? 'Bestätigen?' : k.stand === 'stimmt' ? 'Bestätigt' : 'Falsch gemeldet'));
  karte.appendChild(kopf);
  for (const teil of k.karten) {
    const t = el('div', 'karte-teil');
    t.appendChild(el('b', 'karte-titel', teil.titel));
    const felder = el('dl', 'karte-felder');
    for (const [name, wert] of teil.felder) {
      const z = el('div', 'karte-feld' + (wert === 'fehlt' ? ' fehlt' : ''));
      z.appendChild(el('dt', 'karte-name', name));
      z.appendChild(el('dd', 'karte-wert', wert));
      felder.appendChild(z);
    }
    t.appendChild(felder);
    karte.appendChild(t);
  }
  if (k.stand !== 'offen') {
    karte.appendChild(el('p', 'karte-satz', k.satz));
  } else if (eintrag.meine) {
    karte.appendChild(el('p', 'karte-satz', `Deine Antwort: ${WAHL_TEXT[eintrag.meine.wahl]} – der Laptop führt sie gleich aus …`));
  } else {
    const zeile = el('div', 'karte-knoepfe');
    for (const wahl of ['stimmt', 'falsch']) {
      const b = el('button', 'karte-knopf karte-' + wahl, WAHL_TEXT[wahl]);
      b.type = 'button';
      b.dataset.wahl = wahl;
      b.addEventListener('click', async () => {
        for (const x of zeile.querySelectorAll('button')) x.disabled = true;               // nie zweimal tippen: die erste Antwort gilt ohnehin
        let ok = false;
        try { ok = await beiWahl(eintrag, wahl); } finally { if (!ok) for (const x of zeile.querySelectorAll('button')) x.disabled = false; }
      });
      zeile.appendChild(b);
    }
    karte.appendChild(zeile);
  }
  return karte;
}

// Der kurze Satz für die Einblendung oben: die erste Zeile der Karte.
export function einblendungText(eintrag) {
  const t = eintrag.kopf.karten[0];
  const werte = t ? t.felder.filter(([, w]) => w !== 'fehlt').slice(0, 3).map(([, w]) => w) : [];
  return `Bestätigen? ${t ? t.titel : ''}${werte.length ? ' · ' + werte.join(' · ') : ''}`;
}
