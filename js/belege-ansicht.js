// Der Reiter „Belege“ der Übersicht (Funktion „belege“, A053): Rechnungen und Lieferscheine nach Betrieb getrennt, mit Suche. Die Daten kommen als geprüfte Liste vom
// Laptop (js/post.js, belegeListe); hier wird nur gezeichnet – ausschließlich mit textContent, nie mit HTML. Antippen zeigt die Angaben, „Original holen“ bittet den Laptop,
// die PDF in die Post („Für dich“) zu legen (der vorhandene Weg, nichts geht auf Vorrat ins Netz).
export const BELEGE_REITER = { name: 'Belege', farbe: '#8a6bbf', icon: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>' };
export const OHNE_BETRIEB = '__ohne__';
export const ALLE_BETRIEBE = '__alle__';
export const BELEGE_ZEILEN_MAX = 150;
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const PRUEF_TEXT = { 'passt': 'passt zur Lieferung', 'weicht ab': 'weicht ab', 'kein Lieferschein': 'ohne Lieferschein', 'nicht prüfbar': 'nicht prüfbar', 'ohne Lieferung (Dienstleistung)': 'ohne Lieferung (Dienstleistung)' };
const PRUEF_TON = { 'passt': 'gruen', 'weicht ab': 'rot', 'kein Lieferschein': 'gelb', 'nicht prüfbar': '', 'ohne Lieferung (Dienstleistung)': '' };

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}

export function tagText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

// Welcher Betrieb gilt? Standard ist der erste; „ohne Betrieb“ und „alle“ nur auf ausdrücklichen Wunsch; ein unbekannter fällt auf den ersten zurück.
export function betriebWahl(belege, wunsch) {
  const ids = belege.betriebe.map(b => b.i);
  if (wunsch === OHNE_BETRIEB || wunsch === ALLE_BETRIEBE || ids.includes(wunsch)) return wunsch;
  return ids.length ? ids[0] : ALLE_BETRIEBE;
}

export function belegPasst(z, betrieb, art, suche) {
  if (betrieb === OHNE_BETRIEB) { if (z.b) return false; }
  else if (betrieb !== ALLE_BETRIEBE && z.b !== betrieb) return false;
  if (art && z.a !== art) return false;
  const s = String(suche || '').trim().toLocaleLowerCase('de');
  if (!s) return true;
  const heu = `${z.s} ${z.t} ${z.n} ${z.v} ${z.a}`.toLocaleLowerCase('de');
  return s.split(/\s+/).every(w => heu.includes(w));
}

// Neueste zuerst: die Zeilen kommen schon so vom Laptop; hier wird nur gruppiert (Monat) – ohne Datum steht am Ende.
function monatVon(iso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso || '');
  return m ? `${MONATE[Number(m[2]) - 1]} ${m[1]}` : 'Ohne Datum';
}

function knopf(text, an, beiTipp, daten) {
  const b = el('button', 'be-knopf' + (an ? ' an' : ''), text);
  b.type = 'button';
  b.setAttribute('aria-pressed', String(!!an));
  for (const [k, v] of Object.entries(daten || {})) b.dataset[k] = v;
  b.addEventListener('click', beiTipp);
  return b;
}

function einzelheiten(z, bk, betriebsnamen, betriebe) {
  const k = el('div', 'be-detail');
  const feld = (name, wert) => { if (wert) { const p = el('p', 'be-feld'); p.append(el('span', 'be-fname', name), document.createTextNode(wert)); k.append(p); } };
  feld('Art', z.a);
  feld('Datum', tagText(z.d));
  feld('Absender', z.s);
  feld('Betrieb', betriebsnamen[z.b] || z.b || 'nicht belegt');
  feld('Nummer', z.n);
  feld('Betrag', z.v);
  feld('Fällig', tagText(z.f));
  feld('Prüfung', PRUEF_TEXT[z.p] || '');
  feld('Auszug', z.t);
  if (!z.b && bk && bk.zuordnen) {                        // N4: nur Verwalter-Handys bekommen den Handgriff (der Laptop prüft es noch einmal)
    const kasten = el('div', 'be-zuordnen');
    if (z.w) {
      kasten.append(el('p', 'be-klein be-wird', 'Wird zugeordnet … Der Laptop trägt es beim nächsten Lauf ein.'));
    } else {
      kasten.append(el('p', 'be-klein', 'Zu welchem Betrieb gehört dieser Beleg?'));
      for (const b of betriebe) {
        const k2 = el('button', 'knopf be-betrieb', b.n);
        k2.type = 'button';
        k2.dataset.beleg = z.i;
        k2.dataset.betrieb = b.i;
        k2.disabled = !!bk.laeuft;
        k2.addEventListener('click', () => bk.zuordnen(z.i, b.i));
        kasten.append(k2);
      }
    }
    k.append(kasten);
  }
  if (z.o && bk) {
    const b = el('button', 'knopf be-original', bk.laeuft ? 'Original wird geholt …' : 'Original holen');
    b.type = 'button';
    b.dataset.beleg = z.i;
    b.disabled = !!bk.laeuft;
    b.addEventListener('click', () => bk.original(z.i));
    k.append(b);
    k.append(el('p', 'be-klein', 'Das Original kommt als PDF in die Post, unter „Für dich“.'));
  } else {
    k.append(el('p', 'be-klein', 'Das Original bleibt am Laptop.'));
  }
  return k;
}

// wurzel: der Inhaltsbereich; belege: die geprüfte Liste (oder null); bk: Zustand und Handgriffe (siehe app.js, belegeKontext).
export function zeichneBelege(wurzel, belege, suche, bk) {
  if (!belege) { wurzel.append(el('p', 'ue-leer', 'Noch keine Belege. Tippe oben auf Aktualisieren.')); return; }
  if (belege.hinweis) wurzel.append(el('p', 'ue-hinweis', belege.hinweis));
  if (!belege.betriebe.length && !belege.zeilen.length) return;
  const betrieb = betriebWahl(belege, bk ? bk.betrieb : '');
  const art = bk && belege.arten.includes(bk.art) ? bk.art : '';
  const namen = Object.fromEntries(belege.betriebe.map(b => [b.i, b.n]));
  const ohne = belege.zeilen.filter(z => !z.b).length;
  const wahl = (titel, knoepfe) => { const w = el('div', 'be-wahl'); w.setAttribute('role', 'group'); w.setAttribute('aria-label', titel); w.append(...knoepfe); return w; };
  const betriebe = belege.betriebe.map(b => knopf(b.n, betrieb === b.i, () => bk && bk.setzeBetrieb(b.i), { betrieb: b.i }));
  betriebe.push(knopf(`Ohne Betrieb (${ohne})`, betrieb === OHNE_BETRIEB, () => bk && bk.setzeBetrieb(OHNE_BETRIEB), { betrieb: OHNE_BETRIEB }));
  betriebe.push(knopf('Alle Betriebe', betrieb === ALLE_BETRIEBE, () => bk && bk.setzeBetrieb(ALLE_BETRIEBE), { betrieb: ALLE_BETRIEBE }));
  wurzel.append(wahl('Betrieb', betriebe));
  wurzel.append(wahl('Art', [knopf('Alle Arten', !art, () => bk && bk.setzeArt(''), { art: '' }), ...belege.arten.map(a => knopf(a, art === a, () => bk && bk.setzeArt(a), { art: a }))]));
  if (bk && bk.meldung) wurzel.append(el('p', 'ue-hinweis be-meldung', bk.meldung));
  const treffer = belege.zeilen.filter(z => belegPasst(z, betrieb, art, suche));
  if (!treffer.length) {
    wurzel.append(el('p', 'ue-leer', suche && String(suche).trim() ? 'Nichts gefunden.' : 'Hier ist kein Beleg dieser Art.'));
    return;
  }
  let monat = null;
  let karte = null;
  for (const z of treffer.slice(0, BELEGE_ZEILEN_MAX)) {
    const m = monatVon(z.d);
    if (m !== monat) {
      monat = m;
      karte = el('div', 'ue-tabelle be-monat');
      karte.append(el('h2', '', m));
      wurzel.append(karte);
    }
    const offen = !!bk && bk.offen === z.i;
    const zeile = el('button', 'be-zeile' + (offen ? ' an' : ''));
    zeile.type = 'button';
    zeile.dataset.beleg = z.i;
    zeile.setAttribute('aria-expanded', String(offen));
    const links = el('span', 'be-links');
    links.append(el('span', 'be-name', z.s || '(Absender nicht belegt)'));
    const klein = [z.n ? 'Nr. ' + z.n : '', z.v, z.f ? 'fällig ' + tagText(z.f) : ''].filter(Boolean).join(' · ');
    const unter = el('span', 'be-unter', tagText(z.d) || 'ohne Datum');
    if (klein) unter.append(document.createTextNode(' · ' + klein));
    links.append(unter);
    const rechts = el('span', 'be-rechts');
    rechts.append(el('span', 'ue-marke gruen be-art', z.a));
    if (z.p) rechts.append(el('span', 'ue-marke ' + (PRUEF_TON[z.p] || 'gelb') + ' be-pruef', PRUEF_TEXT[z.p]));
    if (!z.b && z.w) rechts.append(el('span', 'ue-marke be-wird', 'wird zugeordnet'));
    zeile.append(links, rechts);
    if (bk) zeile.addEventListener('click', () => bk.toggle(z.i));
    karte.append(zeile);
    if (offen) karte.append(einzelheiten(z, bk, namen, belege.betriebe));
  }
  if (treffer.length > BELEGE_ZEILEN_MAX) wurzel.append(el('p', 'ue-leer', `… und ${treffer.length - BELEGE_ZEILEN_MAX} weitere – bitte die Suche eingrenzen`));
  if (belege.mehr) wurzel.append(el('p', 'ue-leer', `… und ${belege.mehr} ältere Belege (am Laptop)`));
}
