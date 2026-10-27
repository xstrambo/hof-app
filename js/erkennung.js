// Spracherkennung in der Cloud (Funktion „transkribieren“, Mistral Voxtral, Server in der EU).
// Ablauf auf dem Handy: Die App nimmt NUR auf (kein Live-Text daneben: auf vielen Android-Handys kann immer nur eines das Mikrofon haben),
// schickt die Aufnahme nach „Fertig“ an die Funktion und trägt den zurückkommenden Text in das Textfeld ein – in 1 bis 3 Sekunden, zum
// Prüfen und Verbessern. Die Aufnahme geht mit der Nachricht an den Laptop, in jedem Fall. Klappt die Erkennung nicht (kein Netz, Monatsgrenze,
// nicht eingerichtet, Fehler), bleibt es bei dem, was es vorher gab: Aufnahme senden, der Laptop schreibt sie ab – mit einem ruhigen Hinweis.
// Das hier ist Logik ohne Oberfläche, damit sie sich einzeln prüfen lässt.
import { BriefkastenFehler } from './briefkasten.js';
import { alsWav, istWav } from './wav.js';

export const FUNKTION = 'sprache_cloud';        // Name in funktionen.json: erst "test", für alle erst nach Niklas' Ja
export const MAX_SEKUNDEN = 180;                // eine Aufnahme dauert höchstens 3 Minuten (danach beendet die App sie selbst)

// Nach einem Ausfall der Cloud-Erkennung nimmt die App eine Weile wieder den Live-Text des Handys (Minuten); dann versucht sie es erneut.
const PAUSE_MINUTEN = { nicht_eingerichtet: 30, grenze: 30, dienst: 5, server: 5, zeit: 2, bremse: 1 };
export function pauseMs(code) { return (PAUSE_MINUTEN[code] || 0) * 60 * 1000; }

// Was tun nach dem Fehler? „nochmal“ = ein erneuter Versuch lohnt sich, sonst gibt es den Knopf nicht.
const NOCHMAL = ['netz', 'dienst', 'server', 'zeit', 'bremse'];
export const wiederholbar = code => NOCHMAL.includes(code);

const ABSCHREIBEN = ' – der Laptop schreibt die Aufnahme ab.';
export const HINWEISE = {
  netz: 'Kein Netz' + ABSCHREIBEN,
  nicht_eingerichtet: 'Spracherkennung noch nicht eingerichtet' + ABSCHREIBEN,
  grenze: 'Monatsgrenze erreicht' + ABSCHREIBEN,
  zu_lang: 'Die Aufnahme ist länger als 3 Minuten' + ABSCHREIBEN,
  bremse: 'Zu viele Aufnahmen kurz hintereinander' + ABSCHREIBEN,
  zeit: 'Die Erkennung braucht zu lange' + ABSCHREIBEN,
  audio: 'Diese Aufnahme ließ sich nicht abschreiben' + ABSCHREIBEN,
  dienst: 'Die Spracherkennung ist gerade nicht erreichbar' + ABSCHREIBEN,
};
export const HINWEIS_LEER = 'Es wurde nichts erkannt – tippe es selbst oder sende die Aufnahme, der Laptop schreibt sie ab.';
export const HINWEIS_LAEUFT = 'Text wird erkannt …';
export const HINWEIS_FERTIG = 'Text erkannt – bitte kurz prüfen.';
export function hinweisFuer(code) { return HINWEISE[code] || HINWEISE.dienst; }

// Ein neuer Text kommt zum vorhandenen dazu, nie darüber: Was jemand unterdessen getippt hat, bleibt.
export function textVerbinden(alt, neu) {
  const a = String(alt || '').trim(), n = String(neu || '').trim();
  return a && n ? a + ' ' + n : a || n;
}

// Welches Aufnahmeformat nimmt die Cloud an? Das Handy nimmt als WebM/Opus (Android) oder MP4/AAC (iPhone) auf; in der Dokumentation von Mistral steht
// nicht, welche Formate gehen. Lehnt die Funktion die Aufnahme als Ton ab („audio“, oder ein allgemeiner Fehler 500 von Mistral), rechnet die App sie in WAV
// um (js/wav.js) und schickt sie noch einmal. Hat das geklappt, schickt dieses Handy 30 Tage lang gleich WAV – dann entfällt der misslungene erste Versuch.
// Die Aufnahme, die mit der Nachricht an den Laptop geht, bleibt immer das Original.
const WAV_MERKER = 'hof-erkennung-wav';
const WAV_MERKEN_MS = 30 * 864e5;
const wavGemerkt = () => { try { const t = Number(localStorage.getItem(WAV_MERKER)); return t > 0 && Date.now() - t < WAV_MERKEN_MS; } catch { return false; } };
const wavMerken = () => { try { localStorage.setItem(WAV_MERKER, String(Date.now())); } catch { /* ohne Speicher: jedes Mal erst das Original */ } };
const formatFehler = err => err instanceof BriefkastenFehler && (err.code === 'audio' || (err.code === 'dienst' && err.grund === 'dienst_500'));

// Die Aufnahme abschreiben lassen. Gibt { ok: true, text } oder { ok: false, code, grund } zurück – wirft nie.
// kasten: der Briefkasten-Zugang (js/briefkasten.js), token: Geräte-Zugang, audio: Blob, dauer: Sekunden, umwandeln: Aufnahme -> WAV-Blob (nur für Tests austauschbar).
export async function erkennen({ kasten, token, audio, dauer, online = (typeof navigator !== 'undefined' ? navigator.onLine : true), umwandeln = alsWav }) {
  if (online === false) return { ok: false, code: 'netz' };
  if (!audio || !audio.size) return { ok: false, code: 'audio' };
  const sek = Math.max(1, Math.ceil(Number(dauer) || 0));
  if (sek > MAX_SEKUNDEN + 5) return { ok: false, code: 'zu_lang' };
  const schicken = ton => kasten.transkribieren(token, ton, { dauer: sek, typ: ton.type || 'audio/webm' });
  const gelungen = (r, wav) => ({ ok: true, text: typeof r.text === 'string' ? r.text.trim() : '', ...(wav ? { wav: true } : {}) });
  // Bekannte Gründe haben einen eigenen Hinweis; alles andere (Zugang abgelehnt, Serverfehler …) heißt „nicht erreichbar“, der Code steht klein darunter.
  const gescheitert = err => {
    const roh = err instanceof BriefkastenFehler ? String(err.code) : 'dienst';
    const bekannt = Object.prototype.hasOwnProperty.call(HINWEISE, roh) || roh === 'server';
    return { ok: false, code: bekannt ? roh : 'dienst', grund: String((err && err.grund) || (bekannt ? '' : roh)) };
  };
  let wav = null;                                                  // die umgerechnete Fassung (höchstens einmal je Aufnahme)
  const wavHolen = async () => wav || (wav = await umwandeln(audio));
  const wavMoeglich = !istWav(audio);
  let ton = audio;
  if (wavMoeglich && wavGemerkt()) { try { ton = await wavHolen(); } catch { ton = audio; } }
  try {
    return gelungen(await schicken(ton), ton !== audio);
  } catch (err) {
    if (ton === audio && wavMoeglich && formatFehler(err)) {
      let w = null;
      try { w = await wavHolen(); } catch { w = null; }              // kann das Handy nicht umrechnen, bleibt es beim ersten Fehler
      if (w) {
        try { const r = await schicken(w); wavMerken(); return gelungen(r, true); }
        catch (err2) { return gescheitert(err2); }
      }
    }
    return gescheitert(err);
  }
}
