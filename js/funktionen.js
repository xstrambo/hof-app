// Neue Funktionen der Hof-App erscheinen zuerst nur im Test-Modus.
// Die Hof-App ist EINE App für Echt und Test – eine Änderung am Programm käme sonst sofort im echten Betrieb an.
// Darum steht in funktionen.json (neben index.html), wer eine neue Funktion sehen darf:
//
//     { "<funktion>": "test" | "alle" }
//
//   "test" = nur wenn der Schalter auf Test steht (nur Verwalter-Handys können ihn umlegen),
//   "alle" = auch im echten Betrieb. Auf „alle“ stellt Claude erst nach Niklas' Ja zum Punkt in der nummerierten Änderungsliste.
//
// Sicher voreingestellt: Fehlt die Funktion in der Datei, ist die Datei kaputt oder nicht erreichbar, oder steht dort irgendetwas
// anderes als „alle“, gilt „test“ – im echten Betrieb erscheint dann nichts Neues. Bestehendes Verhalten (alles, was es vor diesem
// Mechanismus schon gab) hängt NICHT an einer Funktion und bleibt, wie es ist.
//
// Benutzung in der Oberfläche: das neue Element bekommt data-funktion="name". Ohne Freigabe ist es unsichtbar (die Regel steht in
// styles.css, es braucht also kein JavaScript, um es zu verstecken); im Test-Modus ist es sichtbar und gestrichelt orange umrandet,
// solange es noch nicht für alle freigegeben ist. Im Programm: hofApp.funktion('name') (liefert true oder false).
import { TEST, normModus } from './modus.js';

export const DATEI = 'funktionen.json';
export const NAME = /^[a-z][a-z0-9_]{0,39}$/;       // Namen von Funktionen: klein, mit Unterstrich; „_hinweis“ & Co. werden überlesen

// Aus dem Inhalt der Datei die gültigen Einträge machen: { name: 'alle' | 'test' }. Alles Unbrauchbare fällt weg (= gilt „test“).
export function normFlags(roh) {
  const aus = {};
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return aus;
  for (const [name, wert] of Object.entries(roh)) {
    if (NAME.test(name)) aus[name] = wert === 'alle' ? 'alle' : 'test';
  }
  return aus;
}

// Wert einer Funktion: 'alle' oder 'test' (auch für Unbekanntes).
export function flag(flags, name) {
  return flags && Object.prototype.hasOwnProperty.call(flags, name) && flags[name] === 'alle' ? 'alle' : 'test';
}

// Darf die Funktion gerade erscheinen? 'alle': immer. Sonst nur im Test-Modus (modus = der WIRKSAME Modus: Handys ohne Test-Recht sind immer echt).
export function sichtbar(flags, name, modus) {
  return flag(flags, name) === 'alle' || normModus(modus) === TEST;
}

// Ist sie nur wegen des Test-Modus sichtbar (also noch nicht freigegeben)? Dann wird sie als „noch nicht freigegeben“ markiert.
export function nurTest(flags, name, modus) {
  return sichtbar(flags, name, modus) && flag(flags, name) !== 'alle';
}

// Die Datei holen. Gibt die gültigen Einträge zurück, oder null, wenn sie nicht zu holen/lesen war (dann bleibt der bisherige Stand).
// Der Service Worker nimmt bei schwachem Netz die zuletzt gespeicherte Fassung; die Zeitgrenze hier ist nur die letzte Sicherung.
export async function ladeFunktionen(holen = globalThis.fetch && globalThis.fetch.bind(globalThis), url = DATEI, ms = 4000) {
  let timer;
  try {
    const abbruch = typeof AbortController === 'function' ? new AbortController() : null;
    if (abbruch) timer = setTimeout(() => abbruch.abort(), ms);
    const r = await holen(url, { cache: 'no-cache', ...(abbruch ? { signal: abbruch.signal } : {}) });
    if (!r || !r.ok) return null;
    return normFlags(await r.json());
  } catch { return null; } finally { clearTimeout(timer); }
}

// Alle Elemente mit data-funktion neu auszeichnen: funktion-an (sichtbar) und nur-test (noch nicht für alle freigegeben).
export function anwenden(wurzel, flags, modus) {
  for (const el of wurzel.querySelectorAll('[data-funktion]')) {
    const name = el.dataset.funktion;
    el.classList.toggle('funktion-an', sichtbar(flags, name, modus));
    el.classList.toggle('nur-test', nurTest(flags, name, modus));
  }
}
