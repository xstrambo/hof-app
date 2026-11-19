// Rückfragen vorlesen und per Sprache antworten (A031, Funktion „vorlesen“) – für Hände voll im Stall.
//
// Vorlesen: Gerätestimme des Handys (Web Speech API, speechSynthesis) – keine Cloud, nichts wird irgendwohin gesendet.
// Antwort per Sprache: Aufnahme -> Text (die bestehende Erkennung der App) -> Abgleich mit den Antwortmöglichkeiten der Rückfrage („Ja“, „Freitag“, eine Zahl).
//   Passt es EINDEUTIG, wird die Antwort zur Bestätigung vorgelesen („Freitag 13.11. – stimmt?“); erst auf „Ja“ geht sie raus.
//   Passt es nicht eindeutig, bleibt die Auswahl am Bildschirm. Nie raten: bei mehreren Treffern, einem „nicht“, „kein“, „nein“ im falschen Zusammenhang, einem Wort,
//   das zu nichts passt, oder wenn nichts verstanden wurde, wird nichts gewählt und nichts gesendet. Freie Antworten (Text, Maße) trägt die App nur ins Feld ein.
// Dieses Modul hat keine Oberfläche; gezeichnet wird in post-ansicht.js, Mikrofon und Speicher gehören app.js.

export const SCHALTER = 'vorlesen-auto';             // Speicher: Rückfragen automatisch vorlesen (Standard: aus)
export const GELESEN = 'vorlesen-gelesen';           // Speicher: Schlüssel der schon vorgelesenen Rückfragen
export const GELESEN_MAX = 200;
export const MAX_ZEICHEN = 600;                      // so viel wird höchstens am Stück vorgelesen

const NEGATION = new Set(['nicht', 'kein', 'keine', 'keinen', 'keiner', 'nie', 'nein', 'niemals']);
const JA = new Set(['ja', 'jawohl', 'jep', 'stimmt', 'richtig', 'genau', 'ok', 'okay', 'korrekt', 'passt', 'klar', 'sicher', 'gerne']);
const HOEFLICH = new Set(['bitte', 'doch', 'also', 'mal', 'dann', 'danke']);
const FUELLWORT = new Set(['bitte', 'doch', 'schon', 'also', 'ja']);
const NEIN = new Set(['nein', 'falsch', 'nicht', 'stopp', 'stop', 'abbrechen', 'abbruch', 'kein', 'keine', 'nie', 'moment', 'warte']);
const ZAHLWORT = { null: 0, eins: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwolf: 12 };

// Kleinschreibung, ohne Umlautpunkte und Satzzeichen (beide Seiten werden gleich behandelt), Zahlwörter als Ziffern.
export function woerter(text) {
  const t = String(text === undefined || text === null ? '' : text).toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return t.replace(/[^a-z0-9.,\s]/g, ' ').split(/\s+/).map(w => w.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean)
    .map(w => (Object.prototype.hasOwnProperty.call(ZAHLWORT, w) ? String(ZAHLWORT[w]) : w));
}

// Aus dem Gesprochenen die eine passende Antwortmöglichkeit – oder keine. Rückgabe { ok: true, wahl: Nummer } oder { ok: false, grund }.
export function waehleAus(gesprochen, optionen) {
  let g = woerter(gesprochen);
  if (!g.length) return { ok: false, grund: 'leer' };
  const kern = g.filter(w => !HOEFLICH.has(w));                                           // „Samstag bitte“ ist „Samstag“
  if (kern.length) g = kern;
  const liste = (Array.isArray(optionen) ? optionen : []).map(o => woerter(o));
  const gleich = [], teil = [];
  liste.forEach((ow, i) => {
    if (!ow.length) return;
    if (ow.join(' ') === g.join(' ')) { gleich.push(i); return; }
    const gInO = g.every(w => ow.includes(w)), oInG = ow.every(w => g.includes(w));      // „Freitag“ -> „Freitag 13.11.“ / „ja bitte“ -> „Ja“
    if ((gInO || oInG) && g.join('').length >= 2) teil.push(i);
  });
  if (gleich.length === 1) return { ok: true, wahl: gleich[0] };                          // genau so gesagt wie eine Möglichkeit: sie gilt
  if (gleich.length > 1) return { ok: false, grund: 'mehrere' };
  if (teil.length !== 1) return { ok: false, grund: teil.length ? 'mehrere' : 'keine' };
  const ow = liste[teil[0]];
  if (g.some(w => NEGATION.has(w)) && !ow.some(w => NEGATION.has(w))) return { ok: false, grund: 'verneint' };   // „nicht Freitag“ ist nicht „Freitag“
  return { ok: true, wahl: teil[0] };
}

// Eine Zahl aus dem Gesprochenen („12“, „zwölf“, „12 Komma 5“). Genau eine Zahl, kein „nicht“. ganz: nur ganze Zahlen. Ergebnis als Text mit Komma.
export function zahlAus(gesprochen, ganz = false) {
  const g = woerter(gesprochen);
  if (!g.length) return { ok: false, grund: 'leer' };
  if (g.some(w => NEGATION.has(w))) return { ok: false, grund: 'verneint' };
  const zahlen = [];
  for (let i = 0; i < g.length; i++) {
    const w = g[i];
    if (!/^\d+([.,]\d+)?$/.test(w)) continue;
    if (/^\d+\.\d{3}$/.test(w)) return { ok: false, grund: 'unklar' };                    // „1.000“: Tausendertrenner oder Dezimalpunkt? nicht raten
    let t = w.replace('.', ',');
    if (g[i + 1] === 'komma' && /^\d+$/.test(w) && /^\d+$/.test(g[i + 2] || '')) { t = w + ',' + g[i + 2]; i += 2; }
    zahlen.push(t);
  }
  if (zahlen.length !== 1) return { ok: false, grund: zahlen.length ? 'mehrere' : 'keine' };
  if (ganz && zahlen[0].includes(',')) return { ok: false, grund: 'nicht_ganz' };
  return { ok: true, text: zahlen[0] };
}

// Passt das Gesprochene zur Rückfrage? Rückgabe:
//   { ergebnis: 'wahl', wahl, anzeige }  eine der Antwortmöglichkeiten, eindeutig
//   { ergebnis: 'zahl', text, anzeige }  eine Zahl, eindeutig (Rückfrage mit Zahl)
//   { ergebnis: 'eingabe', text }        freie Antwort (Text, Maße): nur ins Feld eintragen, nie senden
//   { ergebnis: 'keiner', grund }        nichts Eindeutiges: nichts wählen
export function abgleich(gesprochen, kopf) {
  const t = String(gesprochen === undefined || gesprochen === null ? '' : gesprochen).trim();
  if (!t) return { ergebnis: 'keiner', grund: 'leer' };
  if (!kopf || typeof kopf !== 'object' || kopf.frage_art === 'anmeldung' || kopf.frage_art === 'freigabe') return { ergebnis: 'keiner', grund: 'nicht_per_sprache' };
  if (Array.isArray(kopf.antworten) && kopf.antworten.length) {
    const r = waehleAus(t, kopf.antworten);
    return r.ok ? { ergebnis: 'wahl', wahl: r.wahl, anzeige: String(kopf.antworten[r.wahl]) } : { ergebnis: 'keiner', grund: r.grund };
  }
  const art = kopf.eingabe || 'text';
  if (art === 'zahl' || art === 'ganzzahl') {
    const r = zahlAus(t, art === 'ganzzahl');
    return r.ok ? { ergebnis: 'zahl', text: r.text, anzeige: r.text } : { ergebnis: 'keiner', grund: r.grund };
  }
  return { ergebnis: 'eingabe', text: t.slice(0, 1000) };
}

// Antwort auf „… – stimmt?“: 'ja' | 'nein' | 'unklar'. Nur ein klares Ja zählt (kein „nicht“, kein „nein“ dabei).
export function bestaetigt(gesprochen) {
  const g = woerter(gesprochen);
  if (!g.length) return 'unklar';
  if (g.some(w => NEIN.has(w))) return 'nein';
  return g.some(w => JA.has(w)) && g.every(w => JA.has(w) || FUELLWORT.has(w)) ? 'ja' : 'unklar';
}

// Der Text, der zur Rückfrage vorgelesen wird: die Frage, dann die Antwortmöglichkeiten.
export function fragenText(f) {
  const k = f && f.kopf ? f.kopf : f;
  if (!k || typeof k !== 'object') return '';
  const teile = [];
  const t = String(k.text || '').replace(/\s+/g, ' ').trim();
  if (t) teile.push(t);
  if (Array.isArray(k.antworten) && k.antworten.length && !k.punkte) teile.push('Antworten: ' + k.antworten.map(a => String(a)).join(', ') + '.');
  return teile.join(' ').slice(0, MAX_ZEICHEN);
}

// Wer wird beim automatischen Vorlesen noch vorgelesen? Noch nicht gelesen, noch nicht beantwortet, keine Anmeldung. Reihenfolge wie die Liste.
export function schluesselLesen(f) { return `${f.instanz}:${f.id}:${(f.kopf && f.kopf.stand) || ''}`; }
export function zuLesen(fragen, gelesen) {
  const schon = gelesen instanceof Set ? gelesen : new Set(Array.isArray(gelesen) ? gelesen : []);
  return (Array.isArray(fragen) ? fragen : []).filter(f => f && f.kopf && f.kopf.frage_art !== 'anmeldung' && !(f.meine && f.meine.stand === f.kopf.stand) && !schon.has(schluesselLesen(f)));
}
export function gelesenNormen(roh) {
  return Array.isArray(roh) ? roh.filter(x => typeof x === 'string').slice(-GELESEN_MAX) : [];
}
export const schalterAn = wert => wert === true;                // Standard aus: nur ein ausdrückliches true schaltet ein

// Die Stimme des Geräts. Ohne speechSynthesis (oder ohne Aussprache) ist moeglich false und es passiert nichts.
export function sprecher(synth = globalThis.speechSynthesis, Aeusserung = globalThis.SpeechSynthesisUtterance) {
  const moeglich = !!synth && typeof synth.speak === 'function' && typeof Aeusserung === 'function';
  return {
    moeglich,
    // Liest vor; das Versprechen ist erfüllt, wenn die Stimme fertig ist (oder abgebrochen wurde). Gibt true zurück, wenn gesprochen wurde.
    sprich(text) {
      const satz = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, MAX_ZEICHEN);
      if (!moeglich || !satz) return Promise.resolve(false);
      return new Promise(ok => {
        let fertig = false;
        const ende = r => { if (!fertig) { fertig = true; clearTimeout(timer); ok(r); } };
        const timer = setTimeout(() => ende(true), 1500 + satz.length * 120);                      // manche Geräte melden das Ende nie
        try {
          synth.cancel();
          const u = new Aeusserung(satz);
          u.lang = 'de-DE'; u.rate = 1; u.pitch = 1; u.volume = 1;
          u.onend = () => ende(true);
          u.onerror = () => ende(false);
          synth.speak(u);
        } catch { ende(false); }
      });
    },
    stopp() { try { if (synth && typeof synth.cancel === 'function') synth.cancel(); } catch { /* egal */ } },
  };
}

// Eine Antwort per Sprache. abh: { hoere() -> Promise<Text>, sprich(Text) -> Promise, status(Text), waehle(Nummer), setze(Text), loesche(), senden() -> Promise<boolean> }
// Ergebnis { ergebnis: 'nichts' | 'keiner' | 'eingabe' | 'gesendet' | 'abgelehnt', ... }. Gesendet wird nur nach einem eindeutigen Treffer UND einem klaren „Ja“.
export async function sprachAntwort(kopf, abh) {
  const sage = t => { try { abh.status(t); } catch { /* Anzeige ist nicht wichtig */ } };
  sage('Ich höre zu …');
  let t = '';
  try { t = String((await abh.hoere()) || '').trim(); } catch { t = ''; }
  if (!t) { sage('Nichts verstanden. Wähle selbst oder versuche es noch einmal.'); return { ergebnis: 'nichts' }; }
  const a = abgleich(t, kopf);
  if (a.ergebnis === 'keiner') { sage(`„${t}“ passt nicht eindeutig. Wähle selbst.`); return { ergebnis: 'keiner', gehoert: t, grund: a.grund }; }
  if (a.ergebnis === 'eingabe') { abh.setze(a.text); sage(`Eingetragen: „${a.text}“. Prüfe es und sende selbst.`); return { ergebnis: 'eingabe', gehoert: t }; }
  if (a.ergebnis === 'wahl') abh.waehle(a.wahl); else abh.setze(a.text);
  const frage = `${a.anzeige} – stimmt?`;
  sage(frage);
  await abh.sprich(frage);
  let b = 'unklar';
  try { b = bestaetigt(await abh.hoere()); } catch { b = 'unklar'; }
  if (b === 'ja') {
    sage('Wird gesendet …');
    let ok = false;
    try { ok = (await abh.senden()) === true; } catch { ok = false; }
    if (!ok) sage('Das Senden ging nicht. Tippe auf „Antwort senden“.');
    return { ergebnis: 'gesendet', ok, anzeige: a.anzeige };
  }
  abh.loesche();
  sage(b === 'nein' ? 'Nicht gesendet.' : 'Keine klare Bestätigung – nichts gesendet. Wähle selbst.');
  return { ergebnis: 'abgelehnt', gehoert: b };
}
