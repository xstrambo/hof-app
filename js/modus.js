// Echt | Test: an welche Instanz geht die nächste Nachricht?
// Echt = das echte BetriebsBrain. Test = BetriebsBrain-Test (nur ausgedachte Daten).
// Alles hier ist Logik ohne Oberfläche, damit sie sich einzeln prüfen lässt. Grundsätze:
//  - Gespeichert wird nur "test" oder "echt"; fehlt etwas oder ist es kaputt, gilt "echt" (das ist der Normalfall für alle).
//    (Die eigentliche Sicherheit liegt woanders: Test-Nachrichten sind mit dem Test-Schlüssel verschlüsselt, den das echte
//    BetriebsBrain gar nicht hat, und der Briefkasten liefert sie nur an das Test-BetriebsBrain.)
//  - Der Schalter gilt nur für Geräte, die ihn sehen dürfen (Standard: Verwalter). Für alle anderen ist es immer echt.
//  - Jede Nachricht trägt ihr Ziel selbst (n.ziel) und wird mit dem Schlüssel DIESES Ziels verschlüsselt – nie mit dem anderen.
//    Ist der Schlüssel eines Ziels nicht eingetragen, wird dorthin nichts gesendet (kein Ausweichen auf den anderen Schlüssel).

export const ECHT = 'echt';
export const TEST = 'test';
export const SPEICHER_NAME = 'hof-modus';

export function normModus(wert) { return wert === TEST ? TEST : ECHT; }

// Der Speicher des Browsers (localStorage) kann fehlen oder Fehler werfen (privates Fenster, gesperrte Website-Daten): dann bleibt es bei echt.
export function lokalerSpeicher() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function lesModus(speicher = lokalerSpeicher()) {
  try { return normModus(speicher && speicher.getItem(SPEICHER_NAME)); } catch { return ECHT; }
}

export function schreibModus(modus, speicher = lokalerSpeicher()) {
  try { speicher.setItem(SPEICHER_NAME, normModus(modus)); return true; } catch { return false; }
}

// Darf dieses Gerät zwischen Echt und Test wählen? Nur freigegebene Geräte mit einer der erlaubten Rollen (Standard: admin).
export function testErlaubt(config, geraet) {
  const rollen = Array.isArray(config && config.testRollen) ? config.testRollen : ['admin'];
  return !!geraet && geraet.status === 'frei' && rollen.includes(geraet.rolle);
}

// Der Modus, der wirklich gilt: der gespeicherte, aber nur wenn dieses Gerät wählen darf.
export function wirksamerModus(gespeichert, config, geraet) {
  return testErlaubt(config, geraet) ? normModus(gespeichert) : ECHT;
}

// Der öffentliche Schlüssel des Ziels – nie der des anderen. Leer, wenn das Ziel nicht eingerichtet ist.
export function schluesselFuer(config, ziel) {
  const s = normModus(ziel) === TEST ? config && config.testSchluessel : config && config.laptopSchluessel;
  return typeof s === 'string' ? s.trim() : '';
}

// Das Ziel einer gespeicherten Nachricht (ältere Nachrichten haben keins: echt).
export function zielVon(nachricht) { return nachricht && nachricht.ziel === TEST ? TEST : ECHT; }

// Fehler des Briefkastens, bei denen eine einzelne Test-Nachricht liegen bleibt, ohne die anderen Nachrichten aufzuhalten.
export const TEST_BLOCKIERT = ['ziel_unbekannt', 'verboten', 'ziel'];
export function testBlockiert(ziel, fehlerCode) { return normModus(ziel) === TEST && TEST_BLOCKIERT.includes(fehlerCode); }

export const TEXTE = {
  banner: 'TEST – nur ausgedachte Daten',
  zuEcht: 'Zu Echt wechseln',
  senden: 'Senden',
  sendenTest: 'Test senden',
  keinSchluessel: {
    echt: 'Die App ist noch nicht fertig eingerichtet (Laptop-Schlüssel fehlt).',
    test: 'Der Test ist noch nicht eingerichtet (Test-Schlüssel fehlt). Es wurde nichts gesendet.',
  },
  testNichtBereit: 'Der Test ist noch nicht eingerichtet – Test-Nachrichten warten.',
  gesendetTest: 'Test: geht nur an das Test-BetriebsBrain.',
};
