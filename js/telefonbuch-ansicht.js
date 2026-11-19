// Der Reiter „Telefonbuch“ der Übersicht (Funktion „telefonbuch“, A059): die Stellen und Leute des Betriebs, mit Suche; antippen zeigt die Person, Telefon und Mobil sind
// Verweise zum Anrufen (tel:), die Mail-Adresse einer zum Schreiben (mailto:). Die Daten kommen als geprüfte Liste vom Laptop (js/post.js, telefonbuchListe); hier wird nur
// gezeichnet – ausschließlich mit textContent, nie mit HTML. Verweise nur aus geprüften Zeichen. Nichts wird geändert (gepflegt wird am Laptop, in der Zentrale).

export const TELEFONBUCH_REITER = { name: 'Telefonbuch', farbe: '#b9855b', icon: '<path d="M7 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7z"/><path d="M7 3v18M4 8h3M4 12h3M4 16h3"/><circle cx="13" cy="10" r="2"/><path d="M10 16c.5-2 5.5-2 6 0"/>' };
export const TELEFONBUCH_LEER = 'Das Telefonbuch ist noch leer. Es füllt sich am Laptop aus deinen betrieblichen Mails, wenn du „Trag ins Telefonbuch ein: …“ sagst oder auf der Seite „Telefonbuch“ in der Zentrale etwas einträgst. Danach tippe oben auf Aktualisieren.';
export const TELEFONBUCH_STELLEN_MAX = 120;
const MAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
let gewaehlt = '';                  // die angetippte Stelle oder Person (Kennung); bleibt, solange die App offen ist
let letzteSuche = '';

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}

// tel:-Adresse aus einer Telefonnummer: nur Ziffern und ein führendes Plus; ohne mindestens 3 Ziffern gibt es keinen Verweis.
export function telAdresse(nummer) {
  const roh = String(nummer || '').trim();
  const ziffern = roh.replace(/\D/g, '');
  if (ziffern.length < 3 || ziffern.length > 20) return '';
  return 'tel:' + (roh.startsWith('+') ? '+' : '') + ziffern;
}
export function mailAdresse(mail) {
  const m = String(mail || '').trim();
  return MAIL.test(m) ? 'mailto:' + m : '';
}

export function telefonbuchPasst(text, suche) {
  const s = String(suche || '').trim().toLocaleLowerCase('de');
  if (!s) return true;
  const heu = text.toLocaleLowerCase('de');
  const ziffern = s.replace(/\D/g, '');
  const nurNummer = /^[\d\s+()/.-]+$/.test(s) && ziffern.length >= 3;
  if (nurNummer) return heu.replace(/\D/g, '').includes(ziffern) || s.split(/\s+/).every(w => heu.includes(w));
  return s.split(/\s+/).every(w => heu.includes(w));
}
const personText = (p, stelle) => `${p.n} ${stelle || ''} ${p.z || ''} ${p.t || ''} ${p.m || ''} ${p.e || ''}`;

function verweis(klasse, beschriftung, wert, adresse) {
  const a = el('a', 'tb-verweis ' + klasse);
  a.append(el('span', 'tb-was', beschriftung), document.createTextNode(' '), el('span', 'tb-wert', wert));
  a.setAttribute('href', adresse);
  return a;
}

function angaben(p, stelleName) {
  const b = el('div', 'tb-detail');
  if (stelleName) b.append(el('p', 'tb-stelle-name', stelleName));
  if (p.z) b.append(el('p', 'tb-zust', p.z));
  const t = telAdresse(p.t), m = telAdresse(p.m), e = mailAdresse(p.e);
  if (p.t) b.append(t ? verweis('tb-tel', 'Anrufen', p.t, t) : el('p', 'tb-nur', 'Telefon ' + p.t));
  if (p.m) b.append(m ? verweis('tb-mobil', 'Mobil anrufen', p.m, m) : el('p', 'tb-nur', 'Mobil ' + p.m));
  if (p.e) b.append(e ? verweis('tb-mail', 'Mail schreiben', p.e, e) : el('p', 'tb-nur', 'Mail ' + p.e));
  if (!p.t && !p.m && !p.e) b.append(el('p', 'tb-nur', 'Noch keine Nummer und keine Mail-Adresse.'));
  if (p.o) b.append(el('p', 'tb-nur', p.o));
  if (p.x) b.append(el('p', 'tb-notiz', p.x));
  return b;
}

// wurzel: der Inhaltsbereich; liste: die geprüfte Liste (oder null); suche: der Text im Suchfeld der Übersicht.
export function zeichneTelefonbuch(wurzel, liste, suche) {
  letzteSuche = suche || '';
  wurzel.replaceChildren();
  if (!liste) { wurzel.append(el('p', 'ue-leer', 'Noch kein Telefonbuch. Tippe oben auf Aktualisieren.')); return; }
  if (liste.hinweis) wurzel.append(el('p', 'ue-hinweis', liste.hinweis));
  if (!liste.stellen.length && !liste.ohne.length) {
    if (!liste.hinweis) wurzel.append(el('p', 'ue-leer', TELEFONBUCH_LEER));
    return;
  }
  const neu = () => zeichneTelefonbuch(wurzel, liste, letzteSuche);
  const zeile = (id, kopf, unter, istStelle) => {
    const b = el('button', 'tb-zeile' + (istStelle ? ' tb-stellenzeile' : '') + (gewaehlt === id ? ' an' : ''));
    b.type = 'button';
    b.dataset.eintrag = id;
    b.setAttribute('aria-expanded', String(gewaehlt === id));
    b.append(el('span', 'tb-name', kopf));
    if (unter) b.append(el('span', 'tb-unter', unter));
    b.addEventListener('click', () => { gewaehlt = gewaehlt === id ? '' : id; neu(); });
    return b;
  };
  let treffer = 0, gezeigt = 0;
  const karte = el('div', 'ue-tabelle tb-liste');
  for (const s of liste.stellen) {
    const stelleTrifft = telefonbuchPasst(`${s.n} ${s.a || ''} ${s.t || ''} ${s.e || ''} ${s.o || ''}`, suche);
    const leute = stelleTrifft ? s.l : s.l.filter(p => telefonbuchPasst(personText(p, s.n), suche));
    if (!stelleTrifft && !leute.length) continue;
    treffer += leute.length;
    if (gezeigt >= TELEFONBUCH_STELLEN_MAX) continue;
    gezeigt++;
    const gruppe = el('section', 'tb-gruppe');
    gruppe.dataset.stelle = s.i;
    gruppe.append(zeile(s.i, s.n, s.a || '', true));
    if (gewaehlt === s.i) gruppe.append(angaben({ t: s.t, e: s.e, o: s.o }, ''));
    for (const p of leute) {
      gruppe.append(zeile(p.i, p.n, p.z || '', false));
      if (gewaehlt === p.i) gruppe.append(angaben(p, s.n));
    }
    if (!leute.length) gruppe.append(el('p', 'tb-nur tb-niemand', 'Noch niemand eingetragen.'));
    karte.append(gruppe);
  }
  const ohne = liste.ohne.filter(p => telefonbuchPasst(personText(p, ''), suche));
  if (ohne.length) {
    treffer += ohne.length;
    const gruppe = el('section', 'tb-gruppe');
    gruppe.dataset.stelle = 'ohne';
    gruppe.append(el('p', 'tb-ohne-kopf', 'Ohne Stelle'));
    for (const p of ohne) {
      gruppe.append(zeile(p.i, p.n, p.z || '', false));
      if (gewaehlt === p.i) gruppe.append(angaben(p, ''));
    }
    karte.append(gruppe);
  }
  if (!karte.children.length) {
    wurzel.append(el('p', 'ue-leer', 'Nichts gefunden.'));
    return;
  }
  wurzel.append(karte);
  if (gezeigt >= TELEFONBUCH_STELLEN_MAX) wurzel.append(el('p', 'ue-leer', 'Es werden die ersten ' + TELEFONBUCH_STELLEN_MAX + ' Stellen gezeigt – bitte die Suche eingrenzen.'));
  if (liste.mehr) wurzel.append(el('p', 'ue-leer', `… und ${liste.mehr} weitere Einträge (am Laptop)`));
  const stand = liste.stand ? ` Stand des Telefonbuchs: ${liste.stand.slice(8, 10)}.${liste.stand.slice(5, 7)}.${liste.stand.slice(0, 4)}.` : '';
  wurzel.append(el('p', 'ue-leer', 'Nur zum Ansehen: gepflegt wird das Telefonbuch am Laptop.' + stand));
}
