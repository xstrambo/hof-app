// Warteschlange im Stall (A032, Funktion „offline“): Was ohne Netz gesprochen oder geschrieben wird, liegt verschlüsselt im Handy (IndexedDB, Status „wartet“)
// und geht raus, sobald Netz da ist – in der Reihenfolge des Entstehens, unter derselben Kennung (der Briefkasten legt eine Kennung nur einmal an: nichts doppelt).
// Dieses Modul kennt nur die Regeln und die Sätze; gesendet wird in app.js (postausgang), gezeichnet in app.js (zeichneListen).
//
// Grenzen (Niklas, 06.11.2026): höchstens 50 Einträge und 200 MB in der Warteschlange; eine Nachricht, die länger als 7 Tage wartet, bekommt einen Hinweis.
// Nichts wird still verworfen: Ist die Schlange voll, wird die NEUE Nachricht nicht angenommen (mit Hinweis; der Text bleibt im Entwurf), und alte bleiben liegen.
export const MAX_EINTRAEGE = 50;
export const MAX_MB = 200;
export const MAX_BYTES = MAX_MB * 1024 * 1024;
export const ALT_TAGE = 7;
export const ALT_MS = ALT_TAGE * 864e5;

const grosse = n => {
  const u = n && n.umschlag;
  return u ? (Number.isFinite(u.size) ? u.size : Number.isFinite(u.byteLength) ? u.byteLength : Number.isFinite(u.length) ? u.length : 0) : 0;
};

// Die Wartenden (Nachrichten und Antworten auf Rückfragen), älteste zuerst.
export function wartende(liste) {
  return (Array.isArray(liste) ? liste : []).filter(n => n && n.status === 'wartet').sort((a, b) => (a.erstellt || 0) - (b.erstellt || 0));
}

// { anzahl, bytes, alt (wie viele länger als 7 Tage warten), aeltesteTage }
export function zustand(liste, jetzt = Date.now()) {
  const w = wartende(liste);
  const alt = w.filter(n => Number.isFinite(n.erstellt) && jetzt - n.erstellt > ALT_MS).length;
  const erste = w.length && Number.isFinite(w[0].erstellt) ? Math.max(0, Math.floor((jetzt - w[0].erstellt) / 864e5)) : 0;
  return { anzahl: w.length, bytes: w.reduce((s, n) => s + grosse(n), 0), alt, aeltesteTage: erste };
}

// Darf noch etwas in die Schlange? neueBytes = Größe der neuen Nachricht. Antwort { ok: true } oder { ok: false, grund: 'eintraege' | 'groesse', text }.
export function platzFuer(liste, neueBytes = 0, jetzt = Date.now()) {
  const z = zustand(liste, jetzt);
  if (z.anzahl >= MAX_EINTRAEGE) {
    return { ok: false, grund: 'eintraege', text: `Es warten schon ${z.anzahl} Nachrichten auf Netz – mehr passen nicht in die Warteschlange. Deine Nachricht ist noch da; sende sie, sobald Empfang ist.` };
  }
  if (z.bytes + (Number(neueBytes) || 0) > MAX_BYTES) {
    return { ok: false, grund: 'groesse', text: `Die Warteschlange ist voll (${MAX_MB} MB). Deine Nachricht ist noch da; sende sie, sobald Empfang ist und die wartenden raus sind.` };
  }
  return { ok: true };
}

// „wartet auf Netz (2)“ – leer, wenn nichts wartet.
export function zaehlText(anzahl) {
  return anzahl > 0 ? `wartet auf Netz (${anzahl})` : '';
}

// Hinweis zu Nachrichten, die länger als 7 Tage warten.
export function altText(alt) {
  if (!(alt > 0)) return '';
  return alt === 1
    ? `1 Nachricht wartet schon über ${ALT_TAGE} Tage. Sie bleibt liegen und geht raus, sobald Netz da ist – prüfe, ob sie noch gebraucht wird.`
    : `${alt} Nachrichten warten schon über ${ALT_TAGE} Tage. Sie bleiben liegen und gehen raus, sobald Netz da ist – prüfe, ob sie noch gebraucht werden.`;
}

// Die Zeile unter „Zuletzt gesendet“: Zähler und, wenn nötig, der Hinweis zu alten Nachrichten. Nur Text (textContent).
export function hinweisZeile(liste, jetzt = Date.now()) {
  const z = zustand(liste, jetzt);
  const teile = [zaehlText(z.anzahl), altText(z.alt)].filter(Boolean);
  return { text: teile.join(' · '), anzahl: z.anzahl, alt: z.alt };
}

export function zeigeHinweis(el, liste, jetzt = Date.now()) {
  if (!el) return null;
  const h = hinweisZeile(liste, jetzt);
  el.textContent = h.text;
  el.hidden = !h.text;
  el.classList.toggle('ws-alt', h.alt > 0);
  el.dataset.anzahl = String(h.anzahl);
  return h;
}
