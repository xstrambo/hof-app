// Post vom Laptop: Rückfragen und „erledigt“-Hinweise holen, prüfen, ablegen – und Antworten bauen.
// Alles hier ist Logik ohne Oberfläche, damit sie sich einzeln prüfen lässt (Speicher und Briefkasten kommen von außen).
//
// Ablauf
//  - Der Laptop legt verschlüsselte, beglaubigte Umschläge für dieses Handy im Briefkasten ab (nur für Verwalter-Handys).
//  - Das Handy holt sie (nur dieses Handy kann sie öffnen), prüft die Beglaubigung mit dem öffentlichen Schlüssel des Laptops der genannten
//    Instanz und quittiert – danach ist der Umschlag im Briefkasten gelöscht.
//  - Antworten gehen als beglaubigte Nachricht durch die normale Warteschlange der App (klappt auch ohne Netz) an den Laptop.
//
// Grundsätze
//  - Was nicht stimmt (falsche Beglaubigung, falsche Instanz, kaputt), wird nie angezeigt, sondern still verworfen (und quittiert).
//  - Der Laptop entscheidet, ob eine Antwort gilt: Die erste Antwort gewinnt, egal ob sie hier, in der Zentrale oder am Laptop kam.
//    Dieses Handy zeigt, was der Laptop meldet („beantwortet von …, über Zentrale/Laptop/Hof-App“).
//  - Echt und Test sind getrennt: Jede Rückfrage gehört zu einer Instanz, wird mit deren Schlüssel geprüft und nur in deren Modus gezeigt.
import { entschluesseln, macSchluessel, beglaubigtOeffnen, auspacken, packen, beglaubigen, verschluesseln, L2H, H2L } from './paket.js';
import { ECHT, TEST, normModus, schluesselFuer } from './modus.js';

export const STAND_NAME = 'post';
export const EINGABEN = ['zahl', 'ganzzahl', 'masse', 'text'];
export const ENTSCHEIDUNGEN = ['ja', 'nein', 'spaeter'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const MAX_ANTWORTEN = 8;
const MAX_PUNKTE = 20;
const MAX_FRAGEN = 300;
const ERLEDIGT_TAGE = 14;       // Erledigtes bleibt so lange in der Liste
const ITEMS_TAGE = 30;          // so lange merkt sich das Handy, welche Umschläge es schon verarbeitet hat

export const schluesselVon = (instanz, id) => `${normModus(instanz)}:${id}`;

// ---- Zustand (liegt im Handy, IndexedDB „einstellungen“) --------------------------------------------------------------------
export function neuerStand() { return { v: 1, fragen: {}, items: {} }; }

const text = (x, n) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const textMitZeilen = (x, n) => (typeof x === 'string' ? x.replace(/\r/g, '').split('\n').map(z => z.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '');
const zeitText = x => (typeof x === 'string' && ZEIT.test(x) ? x.slice(0, 19) : '');
const istObjekt = x => !!x && typeof x === 'object' && !Array.isArray(x);

// Wie die Zentrale aus der Rückfrage-Datei eine Auswahl zum Antippen macht, hat der Laptop schon erledigt; hier wird nur noch geprüft.
export function frageKopf(k) {
  if (!istObjekt(k) || k.art !== 'rueckfrage') return null;
  const id = typeof k.id === 'string' ? k.id : '';
  if (!ID_OK.test(id) || typeof k.stand !== 'string' || !k.stand || k.stand.length > 40) return null;
  const antworten = (Array.isArray(k.antworten) ? k.antworten : []).filter(a => typeof a === 'string' && a.trim()).slice(0, MAX_ANTWORTEN).map(a => text(a, 120));
  const punkte = [];
  for (const p of (Array.isArray(k.punkte) ? k.punkte : []).slice(0, MAX_PUNKTE)) {
    if (istObjekt(p) && Number.isInteger(p.nr) && typeof p.werkzeug === 'string' && p.werkzeug) {
      punkte.push({ nr: p.nr, werkzeug: text(p.werkzeug, 60), titel: text(p.titel, 60) || text(p.werkzeug, 60), text: text(p.text, 240) });
    }
  }
  const werkzeug = text(k.werkzeug, 60);
  return {
    id, stand: k.stand, text: textMitZeilen(k.text, 2000), werkzeug, werkzeug_titel: text(k.werkzeug_titel, 60) || werkzeug,
    frage_art: k.frage_art === 'freigabe' ? 'freigabe' : 'frage', antworten, bezug: text(k.bezug, 80), an: text(k.an, 40),
    erstellt: text(k.erstellt, 40), gesendet: zeitText(k.gesendet),
    ...(EINGABEN.includes(k.eingabe) ? { eingabe: k.eingabe } : {}),
    ...(punkte.length ? { punkte } : {}),
  };
}

export function erledigtKopf(k) {
  if (!istObjekt(k) || k.art !== 'erledigt' || typeof k.id !== 'string' || !ID_OK.test(k.id)) return null;
  return { id: k.id, grund: k.grund === 'beantwortet' ? 'beantwortet' : 'erledigt', antwort: text(k.antwort, 300), von: text(k.von, 40), ueber: text(k.ueber, 40), am: zeitText(k.am) };
}

function normFrage(key, f) {
  if (!istObjekt(f) || !['offen', 'beantwortet', 'erledigt'].includes(f.zustand) || (f.instanz !== ECHT && f.instanz !== TEST)) return null;
  const kopf = f.kopf === null || f.kopf === undefined ? null : frageKopf({ ...f.kopf, art: 'rueckfrage' });
  const id = kopf ? kopf.id : (typeof f.id === 'string' ? f.id : '');
  if (!ID_OK.test(id) || key !== schluesselVon(f.instanz, id)) return null;
  if (f.zustand === 'offen' && !kopf) return null;
  const aus = { instanz: f.instanz, id, kopf, zustand: f.zustand, gesehen: Number.isFinite(f.gesehen) ? f.gesehen : Date.now() };
  if (istObjekt(f.erledigt)) {
    const e = erledigtKopf({ ...f.erledigt, art: 'erledigt', id });
    if (e) aus.erledigt = { ...e, gesehen: Number.isFinite(f.erledigt.gesehen) ? f.erledigt.gesehen : Date.now() };
  }
  if (f.zustand !== 'offen' && !aus.erledigt) return null;
  if (istObjekt(f.meine) && typeof f.meine.id === 'string' && typeof f.meine.stand === 'string') {
    aus.meine = { id: f.meine.id, stand: f.meine.stand, text: text(f.meine.text, 300), am: Number.isFinite(f.meine.am) ? f.meine.am : Date.now() };
  }
  return aus;
}

export function normStand(roh) {
  const aus = neuerStand();
  if (!istObjekt(roh)) return aus;
  if (istObjekt(roh.items)) for (const [k, v] of Object.entries(roh.items)) if (UUID.test(k) && Number.isFinite(v)) aus.items[k] = v;
  if (istObjekt(roh.fragen)) {
    for (const [k, f] of Object.entries(roh.fragen)) {
      const g = normFrage(k, f);
      if (g && Object.keys(aus.fragen).length < MAX_FRAGEN) aus.fragen[k] = g;
    }
  }
  return aus;
}

// Ist Zeit a später als Zeit b? (Beide vom Laptop in derselben Schreibweise; fehlt eine oder ist sie unlesbar: nein.)
export function spaeterAls(a, b) {
  return typeof a === 'string' && typeof b === 'string' && ZEIT.test(a) && ZEIT.test(b) && a.slice(0, 19) > b.slice(0, 19);
}

// ---- Eine Nachricht des Laptops in den Zustand einarbeiten -------------------------------------------------------------------
// Gibt zurück: 'neu' | 'geaendert' | 'gleich' | 'erledigt' | 'vermerkt' (Hinweis zu einer unbekannten Rückfrage) | 'alt' | 'ungueltig'
export function anwenden(stand, instanz, rohKopf, jetzt = Date.now()) {
  instanz = normModus(instanz);
  if (istObjekt(rohKopf) && rohKopf.art === 'rueckfrage') {
    const k = frageKopf(rohKopf);
    if (!k) return 'ungueltig';
    const key = schluesselVon(instanz, k.id);
    const f = stand.fragen[key];
    if (f && f.zustand !== 'offen' && f.erledigt && !spaeterAls(k.gesendet, f.erledigt.am)) return 'alt';    // eine veraltete Rückfrage, die nach dem Hinweis ankommt
    if (f && f.zustand === 'offen' && f.kopf && spaeterAls(f.kopf.gesendet, k.gesendet)) return 'alt';        // eine ältere Fassung nach einer neueren
    if (!f && Object.keys(stand.fragen).length >= MAX_FRAGEN) return 'ungueltig';
    if (f && f.zustand === 'offen' && f.kopf && f.kopf.stand === k.stand) {
      f.kopf = k;                                                                                              // dieselbe Fassung noch einmal (Erinnerung des Laptops)
      return 'gleich';
    }
    const neu = { instanz, id: k.id, kopf: k, zustand: 'offen', gesehen: f ? f.gesehen : jetzt };
    if (f && f.meine && f.meine.stand === k.stand && f.zustand === 'offen') neu.meine = f.meine;                // eine Antwort auf diese Fassung bleibt vermerkt
    stand.fragen[key] = neu;
    return f && f.kopf ? 'geaendert' : 'neu';
  }
  if (istObjekt(rohKopf) && rohKopf.art === 'erledigt') {
    const e = erledigtKopf(rohKopf);
    if (!e) return 'ungueltig';
    const key = schluesselVon(instanz, e.id);
    const f = stand.fragen[key];
    if (f && f.zustand === 'offen' && f.kopf && spaeterAls(f.kopf.gesendet, e.am)) return 'alt';              // der Hinweis gilt einer früheren Fassung: die offene Rückfrage ist neuer
    if (!f && Object.keys(stand.fragen).length >= MAX_FRAGEN) return 'ungueltig';
    const g = f || { instanz, id: e.id, kopf: null, zustand: 'offen', gesehen: jetzt };
    g.zustand = e.grund === 'beantwortet' ? 'beantwortet' : 'erledigt';
    g.erledigt = { ...e, gesehen: jetzt };
    stand.fragen[key] = g;
    return f && f.kopf ? 'erledigt' : 'vermerkt';
  }
  return 'ungueltig';
}

// ---- Auswahl für die Oberfläche ---------------------------------------------------------------------------------------------
export function offene(stand, instanz) {
  return Object.values(stand.fragen).filter(f => f.instanz === normModus(instanz) && f.zustand === 'offen' && f.kopf)
    .sort((a, b) => (a.kopf.erstellt || '').localeCompare(b.kopf.erstellt || '') || a.id.localeCompare(b.id));
}
export function erledigte(stand, instanz, jetzt = Date.now()) {
  return Object.values(stand.fragen).filter(f => f.instanz === normModus(instanz) && f.zustand !== 'offen' && f.kopf && f.erledigt && jetzt - f.erledigt.gesehen < ERLEDIGT_TAGE * 864e5)
    .sort((a, b) => b.erledigt.gesehen - a.erledigt.gesehen);
}

// Aufräumen: Erledigtes nach 14 Tagen, Hinweise ohne Rückfrage nach 14 Tagen, gemerkte Umschläge nach 30 Tagen.
export function aufraeumen(stand, jetzt = Date.now()) {
  for (const [k, f] of Object.entries(stand.fragen)) {
    if (f.zustand !== 'offen' && f.erledigt && jetzt - f.erledigt.gesehen > ERLEDIGT_TAGE * 864e5) delete stand.fragen[k];
    else if (f.zustand === 'offen' && f.kopf && jetzt - f.gesehen > 60 * 864e5) delete stand.fragen[k];         // nach zwei Monaten ohne Nachricht nicht mehr anbieten
  }
  for (const [k, t] of Object.entries(stand.items)) if (jetzt - t > ITEMS_TAGE * 864e5) delete stand.items[k];
  return stand;
}

// Was die Anzeige über das Ergebnis sagt: von diesem Handy beantwortet, oder anderswo?
export function ergebnisText(f, geraetName = '') {
  const e = f.erledigt;
  if (!e) return '';
  if (e.grund !== 'beantwortet') return 'Erledigt';
  const ort = e.ueber || 'Zentrale/Laptop';
  const wer = e.von ? ` – ${e.von}` : '';
  const meine = !!f.meine && f.meine.text === e.antwort && ort === 'Hof-App';
  if (meine) return `Beantwortet: ${e.antwort}`;
  const spaet = f.meine ? ' Deine Antwort kam zu spät.' : '';
  return `Schon beantwortet (${ort}): ${e.antwort}${wer}.${spaet}`;
}

// Wie der Laptop einen Text kürzt (handy_senden.kurz): Leerraum glätten, bei Überlänge mit „…“ abschneiden.
export function kurz(x, n) {
  const t = String(x ?? '').split(/\s+/).filter(Boolean).join(' ');
  return t.length <= n ? t : t.slice(0, Math.max(n - 1, 1)).trimEnd() + '…';
}

// Die Zusammenfassung einer Antwort, wie der Laptop sie in die Rückfrage schreibt (damit sich „meine“ von „andere“ unterscheiden lässt).
export function antwortText(art, wert, f) {
  if (art === 'wahl') return kurz(f.kopf.antworten[wert] || '', 300);
  if (art === 'text') return kurz(wert, 300);
  const punkte = f.kopf.punkte || [];
  const proWerkzeug = {};                                       // der Laptop zählt je Werkzeug (nicht je Punkt); Unentschiedenes heißt „später“
  for (const [nr, e] of Object.entries(wert)) { const p = punkte.find(q => String(q.nr) === nr); if (p) proWerkzeug[p.werkzeug] = e; }
  for (const p of punkte) if (!(p.werkzeug in proWerkzeug)) proWerkzeug[p.werkzeug] = 'spaeter';
  const alle = Object.values(proWerkzeug);
  const ja = alle.filter(e => e === 'ja').length, nein = alle.filter(e => e === 'nein').length;
  return [[ja, 'Ja'], [nein, 'Nein'], [alle.length - ja - nein, 'Später']].filter(([n]) => n).map(([n, t]) => `${n} ${t}`).join(', ');
}

// ---- Antwort bauen -----------------------------------------------------------------------------------------------------------
// antwort: { wahl: Nummer } | { text: '…' } | { entscheidungen: { '<Nummer des Punktes>': 'ja' | 'nein' | 'spaeter' } }
// Gibt { id, umschlag, meine } zurück oder wirft einen Fehler (z. B. wenn der Schlüssel dieser Instanz fehlt – dann wird nichts gesendet).
export async function antwortBauen({ frage, antwort, geraet, config, privatKey, jetzt = new Date() }) {
  const instanz = normModus(frage.instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  const k = frage.kopf;
  const kopf = { art: 'antwort', id: crypto.randomUUID(), frage: k.id, stand: k.stand, ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString() };
  let art, wert;
  if (istObjekt(antwort) && Number.isInteger(antwort.wahl)) {
    if (antwort.wahl < 0 || antwort.wahl >= k.antworten.length) throw new Error('Antwort gibt es nicht');
    kopf.wahl = antwort.wahl;
    kopf.wahl_text = k.antworten[antwort.wahl];
    art = 'wahl'; wert = antwort.wahl;
  } else if (istObjekt(antwort) && typeof antwort.text === 'string') {
    const t = antwort.text.trim();
    if (!t || t.length > 1000) throw new Error('Text fehlt oder ist zu lang');
    kopf.text = t;
    art = 'text'; wert = t;
  } else if (istObjekt(antwort) && istObjekt(antwort.entscheidungen)) {
    const gueltig = {};
    const erlaubt = new Set((k.punkte || []).map(p => String(p.nr)));
    for (const [nr, e] of Object.entries(antwort.entscheidungen)) if (erlaubt.has(String(nr)) && ENTSCHEIDUNGEN.includes(e)) gueltig[String(nr)] = e;
    if (!Object.keys(gueltig).length) throw new Error('keine Entscheidung');
    kopf.entscheidungen = gueltig;
    art = 'entscheidungen'; wert = gueltig;
  } else {
    throw new Error('keine Antwort');
  }
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  const umschlag = await verschluesseln(await beglaubigen(klar, mac), laptop);
  return { id: kopf.id, umschlag, instanz, meine: { id: kopf.id, stand: k.stand, text: antwortText(art, wert, frage), am: jetzt.getTime() } };
}

// ---- Holen -------------------------------------------------------------------------------------------------------------------
// Holt alles, was der Laptop für dieses Handy abgelegt hat, prüft es und arbeitet es in `stand` ein. `speichern(stand)` wird nach jeder
// verarbeiteten Nachricht und VOR dem Quittieren aufgerufen (kommt das Quittieren nicht durch, wird nichts doppelt verarbeitet).
// kasten: antwortenListe(token, test), antwortHolen(token, id, test), antwortQuittieren(token, id, test) (siehe briefkasten.js)
// Gibt { neu, geaendert, erledigt, verworfen, uebersprungen, schluesselFehlt } zurück. Wirft BriefkastenFehler, wenn der Briefkasten nicht antwortet.
export async function holen({ kasten, geraet, config, privatKey, stand, speichern, test = false, jetzt = () => Date.now() }) {
  const erg = { neu: 0, geaendert: 0, erledigt: 0, verworfen: 0, uebersprungen: 0, schluesselFehlt: false };
  const r = await kasten.antwortenListe(geraet.token, test);
  if (!istObjekt(r)) return erg;
  if (r.hat_schluessel === false) { erg.schluesselFehlt = true; return erg; }
  const macs = {};
  for (const x of (Array.isArray(r.antworten) ? r.antworten : []).slice(0, 50)) {
    if (!istObjekt(x) || typeof x.id !== 'string' || !UUID.test(x.id)) continue;
    if (x.id in stand.items) {                                    // schon verarbeitet, aber das Quittieren ging nicht durch: nur noch quittieren
      try { await kasten.antwortQuittieren(geraet.token, x.id, test); } catch { /* beim nächsten Mal */ }
      continue;
    }
    const instanz = x.instanz === TEST ? TEST : ECHT;
    const laptop = schluesselFuer(config, instanz);
    if (!laptop) { erg.uebersprungen++; continue; }               // diese Instanz ist hier nicht eingerichtet: weder holen noch löschen
    let mac = macs[instanz];
    if (!mac) {
      try { mac = macs[instanz] = await macSchluessel(privatKey, laptop, L2H); }
      catch { erg.uebersprungen++; continue; }                    // ein Fehler in den Einstellungen darf keine Nachricht kosten: nichts holen, nichts löschen
    }
    let umschlag;
    try { umschlag = await kasten.antwortHolen(geraet.token, x.id, test); }
    catch (e) { if (e && e.code === 'fehlt') { erg.uebersprungen++; continue; } throw e; }       // weg (zurückgezogen oder verfallen): weiter mit dem nächsten
    let ergebnis = 'ungueltig';
    try {
      const klar = await beglaubigtOeffnen(await entschluesseln(umschlag, privatKey), mac);
      const { kopf } = auspacken(klar);
      if (kopf && kopf.ziel === instanz) ergebnis = anwenden(stand, instanz, kopf, jetzt());
    } catch { ergebnis = 'ungueltig'; }
    stand.items[x.id] = jetzt();
    if (ergebnis === 'neu') erg.neu++;
    else if (ergebnis === 'geaendert') erg.geaendert++;
    else if (ergebnis === 'erledigt' || ergebnis === 'vermerkt') erg.erledigt++;
    else if (ergebnis === 'ungueltig' || ergebnis === 'alt') erg.verworfen++;
    await speichern(stand);
    try { await kasten.antwortQuittieren(geraet.token, x.id, test); } catch { /* der Umschlag wird beim nächsten Mal noch einmal quittiert */ }
  }
  aufraeumen(stand, jetzt());
  await speichern(stand);
  return erg;
}
