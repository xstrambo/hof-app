// Die Karte „Nachricht an Kunden“ (A025): ein fertiger Textentwurf, den Niklas selbst verschickt. Das Handy sendet dem Kunden nie etwas.
//   Kopieren  – der Text kommt in die Zwischenablage (dann in WhatsApp oder SMS einfügen).
//   Teilen    – das Teilen-Fenster des Handys (WhatsApp, SMS, Mail …); Niklas wählt selbst den Empfänger und tippt selbst auf Senden.
//   Geschickt – meldet dem Laptop, dass der Text verschickt wurde; erst dann steht „Nachricht geschickt“ in der Bestellung.
// Gezeichnet wird nur Text (textContent). Wie die Knöpfe wirken, steht in app.js (postDing).

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}

export const ANLASS_TEXT = { zusage: 'Zusage', abholbereit: 'Abholbereit', aenderung: 'Änderung' };

// Kopieren in die Zwischenablage: erst der moderne Weg, sonst ein unsichtbares Textfeld (ältere Browser, Seiten ohne Berechtigung).
export async function kopiereText(text, doc = document, nav = navigator) {
  try {
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') { await nav.clipboard.writeText(text); return true; }
  } catch { /* weiter mit dem Ersatzweg */ }
  try {
    const feld = doc.createElement('textarea');
    feld.value = text;
    feld.setAttribute('readonly', '');
    feld.style.position = 'fixed';
    feld.style.opacity = '0';
    doc.body.appendChild(feld);
    feld.select();
    const ok = doc.execCommand('copy');
    feld.remove();
    return !!ok;
  } catch { return false; }
}

// Teilen-Fenster des Handys. 'geteilt' | 'abgebrochen' | 'nicht_moeglich' (dann bleibt nur Kopieren).
export async function teileText(text, nav = navigator) {
  if (!nav || typeof nav.share !== 'function') return 'nicht_moeglich';
  try { await nav.share({ text }); return 'geteilt'; }
  catch (e) { return e && e.name === 'AbortError' ? 'abgebrochen' : 'nicht_moeglich'; }
}

// Der untere Teil der Karte: die Knöpfe – oder, wenn schon gemeldet, ein Satz. `zeile` ist die Knopfzeile der Karte (dort kommt „Erledigt“ danach hin).
// ctx.beiDing(aktion, d) mit aktion 'kopieren' | 'teilen' | 'geschickt'.
export function nachrichtFuss(karte, zeile, d, ctx) {
  const k = d.kopf, n = k.nachricht;
  karte.classList.add('ding-nachricht');
  const box = el('p', 'ding-entwurf', k.text);
  box.dataset.entwurf = '1';
  const alt = karte.querySelector('.ding-text');
  if (alt) alt.replaceWith(box); else karte.appendChild(box);
  box.before(el('p', 'ding-zu leise klein', `Entwurf (${ANLASS_TEXT[n.anlass] || n.anlass}, ${n.bestellung}) – verschickt wird nichts von selbst.`));
  const eigene = d.meine && d.meine.fassung === n.fassung;
  if (n.geschickt) {
    karte.appendChild(el('p', 'ding-hinweis leise klein', 'Nachricht geschickt – in der Bestellung vermerkt.'));
    return;
  }
  const knopf = (name, aktion, haupt) => {
    const b = el('button', 'knopf ' + (haupt ? 'haupt' : 'neben'), name);
    b.type = 'button';
    b.dataset.aktion = aktion;
    b.addEventListener('click', () => ctx.beiDing(aktion, d));
    return b;
  };
  zeile.appendChild(knopf('Kopieren', 'kopieren', false));
  zeile.appendChild(knopf('Teilen', 'teilen', true));
  if (eigene) karte.appendChild(el('p', 'ding-hinweis leise klein', 'Geschickt gemeldet – der Laptop trägt es in die Bestellung ein.'));
  else zeile.appendChild(knopf('Geschickt', 'geschickt', false));
}
