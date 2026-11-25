// Post vom Laptop: Rückfragen, „erledigt“-Hinweise, „Für dich“ (Dokumente, Ergebnisse, Hinweise) und Quittungen holen, prüfen, ablegen – und Antworten bauen.
// Alles hier ist Logik ohne Oberfläche, damit sie sich einzeln prüfen lässt (Speicher und Briefkasten kommen von außen).
//
// Ablauf
//  - Der Laptop legt verschlüsselte, beglaubigte Umschläge für dieses Handy im Briefkasten ab (nur für Verwalter-Handys; eine Station – A055 –
//    bekommt auf demselben Weg nur den Stand der Übersicht, zugeschnitten auf ihr Profil).
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
import { scanListe } from './scan-daten.js';
import { mitteilungAnwenden, mitteilungNormieren } from './mitteilung.js';

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
const DINGE_TAGE = 30;          // „Für dich“ bleibt so lange auf dem Handy (oder bis „Erledigt“ getippt wird)
const MAX_DINGE = 100;
const QUITTUNGEN_TAGE = 30;     // eine Quittung bleibt so lange, wie die gesendete Nachricht im Verlauf steht
const MAX_QUITTUNGEN = 300;
const MAX_BESTAETIGUNGEN = 100;   // Karten „Bestätigen?“, solange die Nachricht im Verlauf steht
export const KARTEN_STAENDE = ['offen', 'stimmt', 'falsch'];
export const KARTEN_WAHLEN = ['stimmt', 'falsch'];
export const MAX_PDF = 10 * 1024 * 1024;     // größer als 10 MB bekommt das Handy nicht (der Laptop schickt dann nur den Hinweis)
export const DING_ARTEN = ['dokument', 'ergebnis', 'hinweis', 'nachricht'];
export const NACHRICHT_ANLAESSE = ['zusage', 'abholbereit', 'aenderung'];

export const schluesselVon = (instanz, id) => `${normModus(instanz)}:${id}`;

// ---- Zustand (liegt im Handy, IndexedDB „einstellungen“) --------------------------------------------------------------------
export function neuerStand() { return { v: 1, fragen: {}, items: {}, dinge: {}, quittungen: {}, uebersicht: {}, uebersichtGrund: {}, bestaetigungen: {}, anleitungen: {}, anleitungenGrund: {} }; }

const text = (x, n) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const textMitZeilen = (x, n) => (typeof x === 'string' ? x.replace(/\r/g, '').split('\n').map(z => z.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '');
const zeitText = x => (typeof x === 'string' && ZEIT.test(x) ? x.slice(0, 19) : '');
const istObjekt = x => !!x && typeof x === 'object' && !Array.isArray(x);

// Die Anfrage „Darf sich die Hof-App bei <Seite> anmelden?“ (A064): genau diese acht Felder werden am Handy unterschrieben, jedes ist Text in diesen Grenzen
// (dieselben wie am Laptop, freigabe_kern.FELD_MAX). Alles andere – ein neuntes Feld, ein fehlendes, ein zu langes, Steuerzeichen, Leerraum am Rand – ist keine Anfrage.
export const ANMELDE_GRENZEN = { id: 80, seite: 60, adresse: 120, wer: 40, grund: 160, erstellt: 25, gueltig_bis: 25, zufall: 64 };
export const ANMELDE_ANTWORTEN = ['Ja, anmelden', 'Nein'];
export const ANMELDE_JA = 'Ja, anmelden';
export function anmeldungKopf(a) {
  if (!istObjekt(a)) return null;
  const namen = Object.keys(ANMELDE_GRENZEN);
  if (Object.keys(a).length !== namen.length) return null;
  const aus = {};
  for (const n of namen) {
    const w = a[n];
    if (typeof w !== 'string' || !w || w.length > ANMELDE_GRENZEN[n] || /[\u0000-\u001f\u007f]/.test(w) || w !== w.trim()) return null;
    aus[n] = w;
  }
  return aus;
}
// Ein Nachweis (Unterschrift vom Handy) hat genau diese vier Texte in diesen Grenzen (wie am Laptop); mehr nimmt der Laptop nicht an.
export const NACHWEIS_GRENZEN = { kennung: 1400, authenticatorData: 1400, clientDataJSON: 2800, signature: 120 };
export function nachweisKopf(n) {
  if (!istObjekt(n) || Object.keys(n).length !== Object.keys(NACHWEIS_GRENZEN).length) return null;
  const aus = {};
  for (const [name, max] of Object.entries(NACHWEIS_GRENZEN)) {
    if (typeof n[name] !== 'string' || !n[name] || n[name].length > max) return null;
    aus[name] = n[name];
  }
  return aus;
}

// Wie die Zentrale aus der Rückfrage-Datei eine Auswahl zum Antippen macht, hat der Laptop schon erledigt; hier wird nur noch geprüft.
export function frageKopf(k) {
  if (!istObjekt(k) || k.art !== 'rueckfrage') return null;
  const id = typeof k.id === 'string' ? k.id : '';
  if (!ID_OK.test(id) || typeof k.stand !== 'string' || !k.stand || k.stand.length > 40) return null;
  // Eine Anmelde-Anfrage: der Block „anmeldung“ muss genau stimmen, und die Knöpfe heißen fest „Ja, anmelden“ und „Nein“ – sonst kommt die Frage nicht aufs Handy.
  const anmeldung = k.frage_art === 'anmeldung' ? anmeldungKopf(k.anmeldung) : null;
  if (k.frage_art === 'anmeldung' && (!anmeldung || !Array.isArray(k.antworten) || k.antworten.length !== 2 || k.antworten.some((x, i) => x !== ANMELDE_ANTWORTEN[i]))) return null;
  const antworten = (Array.isArray(k.antworten) ? k.antworten : []).filter(a => typeof a === 'string' && a.trim()).slice(0, MAX_ANTWORTEN).map(a => text(a, 120));
  const punkte = [];
  for (const p of (Array.isArray(k.punkte) ? k.punkte : []).slice(0, MAX_PUNKTE)) {
    if (istObjekt(p) && Number.isInteger(p.nr) && typeof p.werkzeug === 'string' && p.werkzeug) {
      punkte.push({ nr: p.nr, werkzeug: text(p.werkzeug, 60), titel: text(p.titel, 60) || text(p.werkzeug, 60), text: text(p.text, 240) });
    }
  }
  const werkzeug = text(k.werkzeug, 60);
  // Die ganze Nachricht, auf die sich die Frage bezieht (nur Text; ungekürzt bis 4000 Zeichen) und die erkannten Positionen
  const nachricht = {};
  if (istObjekt(k.nachricht)) {
    const nt = textMitZeilen(k.nachricht.text, 4000);
    const np = (Array.isArray(k.nachricht.positionen) ? k.nachricht.positionen : []).slice(0, 40).map(x => text(x, 240)).filter(Boolean);
    if (nt) nachricht.text = nt;
    if (np.length) nachricht.positionen = np;
  }
  return {
    id, stand: k.stand, text: textMitZeilen(k.text, 2000), werkzeug, werkzeug_titel: text(k.werkzeug_titel, 60) || werkzeug,
    frage_art: anmeldung ? 'anmeldung' : k.frage_art === 'freigabe' ? 'freigabe' : 'frage', antworten, bezug: text(k.bezug, 80), an: text(k.an, 40),
    erstellt: text(k.erstellt, 40), gesendet: zeitText(k.gesendet),
    ...(anmeldung ? { anmeldung } : {}),
    ...(EINGABEN.includes(k.eingabe) ? { eingabe: k.eingabe } : {}),
    ...(punkte.length ? { punkte } : {}),
    ...(nachricht.text || nachricht.positionen ? { nachricht } : {}),
  };
}

export function erledigtKopf(k) {
  if (!istObjekt(k) || k.art !== 'erledigt' || typeof k.id !== 'string' || !ID_OK.test(k.id)) return null;
  return { id: k.id, grund: k.grund === 'beantwortet' ? 'beantwortet' : 'erledigt', antwort: text(k.antwort, 300), von: text(k.von, 40), ueber: text(k.ueber, 40), am: zeitText(k.am) };
}

// „Für dich“: ein Dokument (PDF), ein Ergebnis oder ein Hinweis. Das PDF steht nicht im Zustand, sondern in einem eigenen Eintrag (dateiSchluessel).
const dateiName = x => text(x, 100).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || 'dokument.pdf';
export const pdfSignatur = b => !!b && b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;    // „%PDF-“
export const dateiSchluessel = key => `post-datei:${key}`;

// Der feste Teil einer Karte „Nachricht an Kunden“: Anlass, Fassung, Bestellung (VB-…), Kunde, ob Niklas schon „Geschickt“ gesagt hat. Alles andere fällt weg.
const NACHRICHT_BESTELLUNG = /^VB-\d{4}-\d{4,6}$/;
function nachrichtBlock(n, bezug) {
  if (!istObjekt(n) || !NACHRICHT_ANLAESSE.includes(n.anlass) || !Number.isInteger(n.fassung) || n.fassung < 1 || n.fassung > 999) return null;
  if (typeof n.bestellung !== 'string' || !NACHRICHT_BESTELLUNG.test(n.bestellung) || n.bestellung !== bezug) return null;
  return { anlass: n.anlass, fassung: n.fassung, bestellung: n.bestellung, kunde: text(n.kunde, 60), geschickt: n.geschickt === true };
}

export function dingKopf(k) {
  if (!istObjekt(k) || k.art !== 'fuer_dich') return null;
  const id = typeof k.id === 'string' ? k.id : '';
  if (!ID_OK.test(id) || !DING_ARTEN.includes(k.ding)) return null;
  const titel = text(k.titel, 80);
  if (!titel) return null;
  const meta = Array.isArray(k.dateien) && istObjekt(k.dateien[0]) ? k.dateien[0] : (istObjekt(k.datei) ? { ...k.datei, typ: 'application/pdf' } : null);
  const datei = k.ding === 'dokument' && meta && meta.typ === 'application/pdf' && Number.isInteger(meta.groesse) && meta.groesse > 0 && meta.groesse <= MAX_PDF
    ? { name: dateiName(meta.name), groesse: meta.groesse } : null;
  const fehlt = k.ding === 'dokument' && !datei && ['zu_gross', 'ungueltig'].includes(k.datei_fehlt) ? k.datei_fehlt : '';
  const werkzeug = text(k.werkzeug, 60);
  const nachricht = k.ding === 'nachricht' ? nachrichtBlock(k.nachricht, text(k.bezug, 80)) : null;       // A025: der Entwurf einer Nachricht an einen Kunden
  if (k.ding === 'nachricht' && !nachricht) return null;
  return {
    ...(nachricht ? { nachricht } : {}),
    id, ding: k.ding, titel, text: textMitZeilen(k.text, 1500), werkzeug, werkzeug_titel: text(k.werkzeug_titel, 60) || werkzeug,
    bezug: text(k.bezug, 80), erstellt: text(k.erstellt, 40), gesendet: zeitText(k.gesendet),
    ...(datei ? { datei } : {}), ...(fehlt ? { datei_fehlt: fehlt, datei_name: dateiName(k.datei_name) } : {}),
  };
}

// Die Übersicht (Funktion „uebersicht“): der Laptop schickt auf Anfrage einen Stand mit sechs Reitern. Hier wird alles streng geprüft und gekürzt –
// was nicht passt, fällt weg; angezeigt wird später nur Text (textContent), nie HTML. Ein Reiter ist entweder ein Hinweis (die Quelle fehlt) oder Zahlen + Tabelle.
export const UEBERSICHT_TABS = ['lager', 'laden', 'tier', 'best', 'mittel', 'masch'];
export const UEBERSICHT_MAX_ZEILEN = 150;
const ZAHL_TON = ['', 'warn', 'rot'];
const MARKE_TON = ['gelb', 'rot', 'gruen'];
const MASCH_ID = /^MA-\d{1,6}$/;
const einzeilig = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

// Die Liste aller Maschinen im Reiter „masch“ (nur Text; leer bleibt leer – nichts wird ergänzt).
function maschListe(l) {
  const zeilen = [];
  for (const r of (Array.isArray(l.zeilen) ? l.zeilen : []).slice(0, UEBERSICHT_MAX_ZEILEN)) {
    if (!istObjekt(r)) continue;
    const n = einzeilig(r.n, 80);
    if (!n) continue;
    const i = typeof r.i === 'string' && MASCH_ID.test(r.i) ? r.i : '';                  // Kennung der Maschine (A037): ohne sie lässt sich die Zeile nicht antippen
    zeilen.push({ ...(i ? { i } : {}), n, art: einzeilig(r.art, 30), ps: einzeilig(r.ps, 16), besitz: einzeilig(r.besitz, 50), betrieb: einzeilig(r.betrieb, 40),
                  bj: einzeilig(r.bj, 4), letzter: einzeilig(r.letzter, 24) });
  }
  const entfernt = [];
  for (const r of (Array.isArray(l.entfernt) ? l.entfernt : []).slice(0, UEBERSICHT_MAX_ZEILEN)) {
    if (!istObjekt(r) || typeof r.i !== 'string' || !MASCH_ID.test(r.i)) continue;
    const n = einzeilig(r.n, 80);
    if (n) entfernt.push({ i: r.i, n, wann: einzeilig(r.wann, 10) });
  }
  return { titel: einzeilig(l.titel, 60), zeilen, mehr: Number.isInteger(l.mehr) && l.mehr > 0 && l.mehr < 1e6 ? l.mehr : 0, ...(entfernt.length ? { entfernt } : {}) };
}

// Die Gebäude-Infos (Funktion „hof“, Auftrag A015): je Standort Gebäude mit Kennzahl und Info-Abschnitten. Streng geprüft und gekürzt, nur Text.
// Ein Gebäude ohne Verknüpfung trägt keine Abschnitte: dort kommt nie eine Zahl an, nur „noch nicht verknüpft“.
export const HOF_MAX_STANDORTE = 6;
export const HOF_MAX_GEBAEUDE = 25;
export const HOF_MAX_ABSCHNITTE = 8;
export const HOF_MAX_ZEILEN = 10;
export const HOF_NICHT_VERKNUEPFT = 'noch nicht verknüpft';
const HOF_ZEILE_TON = ['', 'gelb', 'rot'];
const HOF_KARTE = ['ok', 'fehlt', 'kaputt', 'leer'];
const HOF_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function hofGebaeude(g) {
  if (!istObjekt(g) || typeof g.id !== 'string' || !HOF_ID.test(g.id)) return null;
  const name = einzeilig(g.name, 60);
  if (!name) return null;
  const verknuepft = g.verknuepft === true && istObjekt(g.ziel) && !!einzeilig(g.ziel.name, 60);
  const aus = { id: g.id, name, rolle: einzeilig(g.rolle, 30), art: einzeilig(g.art, 12), verknuepft,
                ziel: verknuepft ? { art: einzeilig(g.ziel.art, 12), name: einzeilig(g.ziel.name, 60) } : null,
                kennzahl: verknuepft ? einzeilig(g.kennzahl, 24) : HOF_NICHT_VERKNUEPFT, ton: verknuepft && ['warn', 'rot'].includes(g.ton) ? g.ton : '',
                hinweis: einzeilig(g.hinweis, 240), abschnitte: [] };
  if (!verknuepft) return aus;                         // ohne Verknüpfung keine Abschnitte und keine Zahl
  for (const a of (Array.isArray(g.abschnitte) ? g.abschnitte : []).slice(0, HOF_MAX_ABSCHNITTE)) {
    if (!istObjekt(a)) continue;
    const titel = einzeilig(a.titel, 60);
    if (!titel) continue;
    const zeilen = [];
    for (const z of (Array.isArray(a.zeilen) ? a.zeilen : []).slice(0, HOF_MAX_ZEILEN)) {
      if (!istObjekt(z)) continue;
      const t = einzeilig(z.t, 140);
      if (t) zeilen.push({ t, ton: HOF_ZEILE_TON.includes(z.ton) ? z.ton : '' });
    }
    aus.abschnitte.push({ titel, zeilen, leer: einzeilig(a.leer, 140) });
  }
  if (Array.isArray(g.maschinen)) {                                  // Maschinen der Halle zum Antippen (A037)
    aus.maschinen = g.maschinen.slice(0, 12).filter(m => istObjekt(m) && typeof m.id === 'string' && MASCH_ID.test(m.id) && einzeilig(m.n, 60)).map(m => ({ id: m.id, n: einzeilig(m.n, 60) }));
  }
  return aus;
}

// Die Karte fürs Handy (A037, Funktion „hofkarte_bearbeiten“): Umrisse und Plätze in Metern, dazu die Objekte ohne Platz und die ausgeblendeten. Alles streng geprüft und
// gekürzt; Zahlen bleiben Zahlen, Namen Text. Was nicht passt, fällt weg.
export const PLAN_MAX_OBJEKTE = 120;
export const PLAN_MAX_PUNKTE = 40;
const PLAN_PLATZ = ['osm', 'luftbild', 'skizze', 'schema', 'eigen'];       // skizze = nach Skizze von Niklas geschätzt, schema = Lage und Form nicht echt (A050)
const meter = x => (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 3000 ? x : null);
const punkt = p => (Array.isArray(p) && p.length === 2 && meter(p[0]) !== null && meter(p[1]) !== null ? [p[0], p[1]] : null);

function planObjekt(o) {
  if (!istObjekt(o) || typeof o.id !== 'string' || !HOF_ID.test(o.id)) return null;
  const name = einzeilig(o.name, 60);
  if (!name) return null;
  const aus = { id: o.id, name, rolle: einzeilig(o.rolle, 30), platz: PLAN_PLATZ.includes(o.platz) ? o.platz : 'luftbild', eigen: o.eigen === true, neu: o.neu === true, seit: einzeilig(o.seit, 10),
                bild: typeof o.bild === 'string' && o.bild.length <= 20000 ? o.bild : '' };      // das Gebäude gezeichnet wie am Laptop (karte-ansicht.js lässt nur Zeichen-Elemente durch)
  if (o.form === 'kreis') {
    const m = punkt(o.mitte);
    if (!m || typeof o.d !== 'number' || !(o.d >= 0.5 && o.d <= 80)) return null;
    return { ...aus, form: 'kreis', mitte: m, d: o.d };
  }
  if (o.form === 'poly') {
    const pts = (Array.isArray(o.pts) ? o.pts : []).slice(0, PLAN_MAX_PUNKTE).map(punkt);
    if (pts.length < 3 || pts.some(p => !p)) return null;
    return { ...aus, form: 'poly', pts };
  }
  return null;
}

function planOhne(o) {
  if (!istObjekt(o) || typeof o.id !== 'string' || !HOF_ID.test(o.id)) return null;
  const name = einzeilig(o.name, 60);
  if (!name) return null;
  const v = istObjekt(o.vorschlag) ? o.vorschlag : {};
  const gut = (x, a, b) => (typeof x === 'number' && x >= a && x <= b ? x : null);
  return { id: o.id, name, rolle: einzeilig(o.rolle, 30), rund: o.rund === true, vorschlag: { d: gut(v.d, 0.5, 80), b: gut(v.b, 1, 200), t: gut(v.t, 1, 200), woher: einzeilig(v.woher, 80) } };
}

// Die Lage des Standorts auf der gemeinsamen Karte (A050): Versatz und Rahmen in Metern des gemeinsamen Blatts. Fehlt oder passt etwas nicht, gibt es keinen Rahmen (nichts wird geraten).
function planBlatt(b) {
  if (!istObjekt(b) || !Array.isArray(b.versatz) || b.versatz.length !== 2 || !Array.isArray(b.rahmen) || b.rahmen.length !== 4) return null;
  const v = b.versatz.map(meter), r = b.rahmen.map(meter);
  if (v.some(x => x === null) || r.some(x => x === null) || !(r[2] > r[0]) || !(r[3] > r[1])) return null;
  return { versatz: v, rahmen: r };
}

export function hofPlan(p) {
  if (!istObjekt(p)) return null;
  const objekte = (Array.isArray(p.objekte) ? p.objekte : []).slice(0, PLAN_MAX_OBJEKTE).map(planObjekt).filter(Boolean);
  const ohne = (Array.isArray(p.ohne_platz) ? p.ohne_platz : []).slice(0, 60).map(planOhne).filter(Boolean);
  const weg = (Array.isArray(p.ausgeblendet) ? p.ausgeblendet : []).slice(0, 30)
    .filter(a => istObjekt(a) && typeof a.id === 'string' && HOF_ID.test(a.id) && einzeilig(a.name, 60)).map(a => ({ id: a.id, name: einzeilig(a.name, 60) }));
  const blatt = planBlatt(p.blatt);
  return { objekte, ohne_platz: ohne, ausgeblendet: weg, ...(blatt ? { blatt } : {}) };
}

// Die Landkarte (A054): Felder mit Feldgrenzen und Gebäude mit echter Lage (Länge, Breite). Alles streng geprüft: Was nicht passt, fällt weg – nichts wird geraten.
export const LK_MAX_FELDER = 400;
export const LK_MAX_PUNKTE = 300;
const LK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const LK_FARBE = /^#[0-9a-fA-F]{6}$/;
const lkPunkt = p => (Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85 ? [p[0], p[1]] : null);
function lkRinge(r) {
  if (!Array.isArray(r) || !r.length || r.length > 20) return null;
  const aus = [];
  for (const ring of r) {
    if (!Array.isArray(ring) || ring.length < 3 || ring.length > LK_MAX_PUNKTE) return null;
    const pts = ring.map(lkPunkt);
    if (pts.some(p => !p)) return null;
    aus.push(pts);
  }
  return aus;
}
function lkFlaeche(o, idMuster) {
  if (!istObjekt(o) || typeof o.id !== 'string' || !idMuster.test(o.id)) return null;
  const name = einzeilig(o.name, 80), ringe = lkRinge(o.ringe);
  if (!name || !ringe) return null;
  return { id: o.id, name, unter: einzeilig(o.unter, 60), farbe: typeof o.farbe === 'string' && LK_FARBE.test(o.farbe) ? o.farbe : '#9aa3a0', ringe };
}
export function hofLandkarte(l) {
  if (!istObjekt(l)) return null;
  const felder = [], gebaeude = [], standorte = [], legende = [];
  for (const f of (Array.isArray(l.felder) ? l.felder : []).slice(0, LK_MAX_FELDER)) {
    const a = lkFlaeche(f, LK_ID);
    if (!a) continue;
    for (const [feld, n] of [['nr', 12], ['ha', 16], ['anbau', 120], ['anbau_art', 30], ['vorfrucht', 120], ['betrieb', 60], ['jahr', 12], ['frucht', 30]]) a[feld] = einzeilig(f[feld], n);
    felder.push(a);
  }
  for (const g of (Array.isArray(l.gebaeude) ? l.gebaeude : []).slice(0, PLAN_MAX_OBJEKTE * 3)) {
    const a = lkFlaeche(g, HOF_ID);
    if (a) gebaeude.push({ ...a, standort: typeof g.standort === 'string' && HOF_ID.test(g.standort) ? g.standort : '' });
  }
  for (const s of (Array.isArray(l.standorte) ? l.standorte : []).slice(0, HOF_MAX_STANDORTE)) {
    const m = istObjekt(s) ? lkPunkt(s.mitte) : null;
    if (m && typeof s.id === 'string' && HOF_ID.test(s.id) && einzeilig(s.name, 60)) standorte.push({ id: s.id, name: einzeilig(s.name, 60), mitte: m });
  }
  for (const x of (Array.isArray(l.legende) ? l.legende : []).slice(0, 20)) {
    if (istObjekt(x) && einzeilig(x.name, 30) && typeof x.farbe === 'string' && LK_FARBE.test(x.farbe)) legende.push({ name: einzeilig(x.name, 30), farbe: x.farbe });
  }
  if (!felder.length && !gebaeude.length) return null;
  const aus = { felder, gebaeude, standorte, legende, gelesen: einzeilig(l.gelesen, 40), luftbild: false, quelle: '' };
  const lb = istObjekt(l.luftbild) ? l.luftbild : null;                 // Luftbild nur, wenn der Laptop es ausdrücklich schickt: https und alle drei Platzhalter
  if (lb && typeof lb.adresse === 'string' && lb.adresse.length <= 300 && /^https:\/\/[A-Za-z0-9.-]+\/[^\s"'<>]*$/.test(lb.adresse)
      && ['{z}', '{x}', '{y}'].every(k => lb.adresse.includes(k))) {
    aus.luftbild = true; aus.adresse = lb.adresse; aus.quelle = einzeilig(lb.quelle, 120);
  }
  return aus;
}

export function hofListe(h) {
  if (!istObjekt(h) || h.version !== 1) return null;
  const standorte = [];
  for (const s of (Array.isArray(h.standorte) ? h.standorte : []).slice(0, HOF_MAX_STANDORTE)) {
    if (!istObjekt(s) || typeof s.id !== 'string' || !HOF_ID.test(s.id) || !einzeilig(s.name, 60)) continue;
    const gebaeude = (Array.isArray(s.gebaeude) ? s.gebaeude : []).slice(0, HOF_MAX_GEBAEUDE).map(hofGebaeude).filter(Boolean);
    const plan = s.plan !== undefined ? hofPlan(s.plan) : null;
    standorte.push({ id: s.id, name: einzeilig(s.name, 60), gebaeude, weitere: Number.isInteger(s.weitere) && s.weitere > 0 && s.weitere < 1e6 ? s.weitere : 0, ...(plan ? { plan } : {}) });
  }
  const bild = istObjekt(h.bild) && typeof h.bild.s === 'number' && h.bild.s >= 1 && h.bild.s <= 20 && typeof h.bild.defs === 'string' && h.bild.defs.length <= 4000
    ? { s: h.bild.s, defs: h.bild.defs } : null;
  const landkarte = h.landkarte !== undefined ? hofLandkarte(h.landkarte) : null;
  return { karte: HOF_KARTE.includes(h.karte) ? h.karte : 'kaputt', hinweis: einzeilig(h.hinweis, 240), standorte, ...(bild ? { bild } : {}), ...(landkarte ? { landkarte } : {}) };
}

// Die Bestellkarte (Reiter „best“, A040): zu jeder Zeile der Tabelle kann der Laptop Einzelheiten schicken (gleiche Reihenfolge wie die Zeilen). Alles Text, gekürzt;
// ohne Kunde oder ohne Position gibt es keine Karte. Was der Laptop nicht schickt, steht nicht da – nichts wird ergänzt.
export const BESTELL_MAX_POSTEN = 20;
const ZAHLWEGE = ['Kasse', 'Rechnung'];
export function bestellDetail(x) {
  if (!istObjekt(x)) return null;
  const kunde = einzeilig(x.kunde, 80);
  const pos = [];
  for (const p of (Array.isArray(x.pos) ? x.pos : []).slice(0, BESTELL_MAX_POSTEN)) {
    if (!istObjekt(p)) continue;
    const name = einzeilig(p.p, 80);
    if (!name) continue;
    pos.push({ p: name, m: einzeilig(p.m, 24), z: einzeilig(p.z, 60), e: einzeilig(p.e, 16) });
  }
  if (!kunde || !pos.length) return null;
  const aus = { kunde, wann: einzeilig(x.wann, 40), status: einzeilig(x.status, 24), pos, mehr: Number.isInteger(x.mehr) && x.mehr > 0 && x.mehr < 1e6 ? x.mehr : 0 };
  for (const [feld, n] of [['wunsch', 160], ['notiz', 200], ['herkunft', 30], ['kontakt', 80], ['betrieb', 40], ['vorher', 40]]) { const s = einzeilig(x[feld], n); if (s) aus[feld] = s; }
  if (ZAHLWEGE.includes(x.zahlweg)) aus.zahlweg = x.zahlweg;
  if (typeof x.nr === 'string' && /^V[BE]-\d{4}-\d{3,6}$/.test(x.nr)) aus.nr = x.nr;            // A055 Stufe 3: die Nummer der Bestellung (nur für eine Station, die „abgeholt“ melden darf)
  return aus;
}

function uebersichtTab(t) {
  if (!istObjekt(t)) return null;
  const zahlen = (Array.isArray(t.zahlen) ? t.zahlen : []).filter(istObjekt).slice(0, 3)
    .map(z => ({ wert: einzeilig(z.wert, 16), text: einzeilig(z.text, 40), ton: ZAHL_TON.includes(z.ton) ? z.ton : '' })).filter(z => z.wert || z.text);
  const tab = istObjekt(t.tabelle) ? t.tabelle : {};
  const kopf = Array.isArray(tab.kopf) ? tab.kopf : [];
  const zeilen = [];
  const details = Array.isArray(tab.details) ? tab.details : [];
  (Array.isArray(tab.zeilen) ? tab.zeilen : []).slice(0, UEBERSICHT_MAX_ZEILEN).forEach((r, i) => {
    if (!istObjekt(r)) return;
    const a = einzeilig(r.a, 80);
    if (!a) return;
    const m = istObjekt(r.m) && einzeilig(r.m.t, 24) ? { t: einzeilig(r.m.t, 24), ton: MARKE_TON.includes(r.m.ton) ? r.m.ton : 'gelb' } : null;
    const d = bestellDetail(details[i] !== undefined ? details[i] : r.d);                          // die Karte zur Zeile (nur Reiter „best“): gleiche Stelle in der Liste der Einzelheiten
    zeilen.push({ a, k: einzeilig(r.k, 120), m, z: einzeilig(r.z, 24), ...(d ? { d } : {}) });
  });
  const aus = {
    hinweis: einzeilig(t.hinweis, 240), stand: einzeilig(t.stand, 40), zahlen,
    tabelle: { titel: einzeilig(tab.titel, 60), kopf: [einzeilig(kopf[0], 30), einzeilig(kopf[1], 30)], zeilen, mehr: Number.isInteger(tab.mehr) && tab.mehr > 0 && tab.mehr < 1e6 ? tab.mehr : 0 },
  };
  if (Array.isArray(t.scan)) aus.scan = scanListe(t.scan);       // Artikelliste für den Scanner (nur im Reiter „lager“ vom Laptop gefüllt)
  if (istObjekt(t.liste)) aus.liste = maschListe(t.liste);         // Liste aller Maschinen (Reiter „masch“, auch ohne Einsätze)
  return aus;
}

// Station (Auftrag A055): ein Gerät (z. B. ein Tablet im Hofladen), dem der Laptop nur bestimmte Reiter schickt und das nur bestimmte Handgriffe hat. Was es zeigt und
// anbietet, sagt das Profil im Stand (`profil: { reiter: […], handgriffe: […] }`) – nur der Stand für eine Station trägt eines. Hier wird es geprüft: nur bekannte Reiter
// und Handgriffe, jede Angabe einmal, in fester Reihenfolge; alles andere fällt weg (ein unlesbares Profil ist ein leeres). Fehlt `profil`, ist es der Stand für ein
// Verwalter-Handy und alles gilt wie bisher. Das Profil ist Komfort, keine Sicherheit: durchgesetzt wird am Laptop.
export const STATION_REITER = [...UEBERSICHT_TABS, 'hof'];
export const SCAN_HANDGRIFFE = ['inventur', 'wareneingang', 'verkauf'];        // die drei Arten des Scanners
export const STATION_HANDGRIFFE = [...SCAN_HANDGRIFFE, 'sprechen'];            // sprechen = freie Nachrichten (Sprache, Text, Anhang)
export const STATION_ABGEHOLT = 'abgeholt';                                    // „Bestellung abgeholt“ (A055 Stufe 3): kein Handgriff des Scanners, steht aber in der Liste der Handgriffe, wenn das Profil es erlaubt
const STATION_GROESSEN = ['klein', 'mittel', 'gross'];
const STATION_TAKTE = [5, 15, 30, 60];
export function profilKopf(p) {
  const bekannt = (liste, erlaubt) => (Array.isArray(liste) ? erlaubt.filter(n => liste.includes(n)) : []);
  if (!istObjekt(p)) return { reiter: [], handgriffe: [] };
  const aus = { reiter: bekannt(p.reiter, STATION_REITER), handgriffe: bekannt(p.handgriffe, [...STATION_HANDGRIFFE, STATION_ABGEHOLT]) };
  const tafeln = [];                                                           // Stufe 2: die Tafeln der Station (Größe, Reihenfolge) – nur für erlaubte Reiter, jede einmal
  for (const t of Array.isArray(p.tafeln) ? p.tafeln : []) {
    if (istObjekt(t) && aus.reiter.includes(t.art) && !tafeln.some(x => x.art === t.art)) tafeln.push({ art: t.art, groesse: STATION_GROESSEN.includes(t.groesse) ? t.groesse : 'mittel' });
  }
  if (tafeln.length) aus.tafeln = tafeln;
  if (STATION_TAKTE.includes(p.takt)) aus.takt = p.takt;
  return aus;
}

// Die Belege (Funktion „belege“, A053): Rechnungen und Lieferscheine aus dem Verzeichnis des Laptops – nur Angaben, nie die Dateien. Streng geprüft und gekürzt, nur Text.
// Je Zeile: i Kennung, a Art, d Datum (JJJJ-MM-TT), s Absender, b Betrieb (Kennung, leer = nicht belegt), n Nummer, v Betrag, f Fälligkeit (JJJJ-MM-TT), p Prüfstatus der Rechnung,
// t Textauszug, o 1 = das Original lässt sich aufs Handy holen. Was fehlt, bleibt leer – nichts wird ergänzt.
export const BELEGE_MAX_ZEILEN = 800;
export const BELEG_PRUEFUNG = ['passt', 'weicht ab', 'kein Lieferschein', 'nicht prüfbar', 'ohne Lieferung (Dienstleistung)'];
const BELEG_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/;
const TAG = /^\d{4}-\d{2}-\d{2}$/;
export function belegeListe(b) {
  if (!istObjekt(b)) return null;
  const betriebe = [];
  for (const x of (Array.isArray(b.betriebe) ? b.betriebe : []).slice(0, 6)) {
    if (!istObjekt(x)) continue;
    const i = einzeilig(x.i, 30), n = einzeilig(x.n, 60);
    if (i && n && !betriebe.some(y => y.i === i)) betriebe.push({ i, n });
  }
  const zeilen = [];
  for (const r of (Array.isArray(b.zeilen) ? b.zeilen : []).slice(0, BELEGE_MAX_ZEILEN)) {
    if (!istObjekt(r) || typeof r.i !== 'string' || !BELEG_ID.test(r.i)) continue;
    const a = einzeilig(r.a, 30);
    if (!a) continue;
    zeilen.push({ i: r.i, a, d: typeof r.d === 'string' && TAG.test(r.d) ? r.d : '', s: einzeilig(r.s, 60), b: einzeilig(r.b, 30), n: einzeilig(r.n, 30), v: einzeilig(r.v, 24),
                  f: typeof r.f === 'string' && TAG.test(r.f) ? r.f : '', p: BELEG_PRUEFUNG.includes(r.p) ? r.p : '', t: einzeilig(r.t, 80), o: r.o === 1, w: r.w === 1 });
  }
  const arten = [...new Set(zeilen.map(z => z.a))];
  return { hinweis: einzeilig(b.hinweis, 240), betriebe, arten, zeilen, mehr: Number.isInteger(b.mehr) && b.mehr > 0 && b.mehr < 1e6 ? b.mehr : 0 };
}

// Die Artikel (Funktion „artikel“, A063): der Artikelstamm vom Laptop – nur Angaben, nur zum Ansehen. Streng geprüft und gekürzt, nur Text.
// Je Zeile: n Artikelnummer, a Name, g Warengruppe, h Händlerpreis, e Endkundenpreis (Text mit Komma, leer = nicht belegt), v wo verkauft (Lexware, Automat, Kasse),
// c Barcode, i Hinweise (Text). Was fehlt, bleibt leer – nichts wird ergänzt.
export const ARTIKEL_MAX_ZEILEN = 600;
export const ARTIKEL_VERKAUF = ['Lexware', 'Automat', 'Kasse'];
export const ARTIKEL_PREIS_HINWEIS = 'Preis nicht über Händlerpreis';
const ARTIKEL_PREIS = /^\d{1,6},\d{2}$/;
export function artikelListe(b) {
  if (!istObjekt(b)) return null;
  const zeilen = [];
  for (const r of (Array.isArray(b.zeilen) ? b.zeilen : []).slice(0, ARTIKEL_MAX_ZEILEN)) {
    if (!istObjekt(r)) continue;
    const n = einzeilig(r.n, 20), a = einzeilig(r.a, 120);
    if (!n && !a) continue;
    zeilen.push({ n, a, g: einzeilig(r.g, 40), h: typeof r.h === 'string' && ARTIKEL_PREIS.test(r.h) ? r.h : '', e: typeof r.e === 'string' && ARTIKEL_PREIS.test(r.e) ? r.e : '',
                  v: ARTIKEL_VERKAUF.filter(x => Array.isArray(r.v) && r.v.includes(x)), c: typeof r.c === 'string' && /^\d{8,14}$/.test(r.c) ? r.c : '',
                  i: (Array.isArray(r.i) ? r.i : []).filter(x => typeof x === 'string').slice(0, 4).map(x => einzeilig(x, 60)).filter(Boolean) });
  }
  const gruppen = [...new Set(zeilen.map(z => z.g).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'de'));
  const pruefen = zeilen.filter(z => z.i.includes(ARTIKEL_PREIS_HINWEIS)).length;
  const gepr = typeof b.geprueft === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.geprueft) ? b.geprueft : '';
  return { hinweis: einzeilig(b.hinweis, 240), gruppen, zeilen, pruefen, geprueft: gepr, mehr: Number.isInteger(b.mehr) && b.mehr > 0 && b.mehr < 1e6 ? b.mehr : 0 };
}

// Das Telefonbuch (Funktion „telefonbuch“, A059): Stellen und Leute vom Laptop – nur Angaben, nur zum Ansehen. Streng geprüft und gekürzt, nur Text.
// Je Stelle: i Kennung (s-0001), n Name, a Art, t Telefon, e Mail, o Ort, l die Leute; je Person: i (p-0001), n Name, z Zuständigkeit, t Telefon, m Mobil, e Mail, x Notiz.
// „ohne“ sind die Leute ohne Stelle. Herkunft und „unsicher“ gehen nie mit; was fehlt, bleibt leer – nichts wird ergänzt.
export const TELEFONBUCH_MAX_PERSONEN = 400;
export const TELEFONBUCH_MAX_STELLEN = 250;
function telefonbuchPerson(r) {
  if (!istObjekt(r) || typeof r.i !== 'string' || !/^p-\d{1,8}$/.test(r.i)) return null;
  const n = einzeilig(r.n, 80);
  if (!n) return null;
  return { i: r.i, n, z: einzeilig(r.z, 100), t: einzeilig(r.t, 40), m: einzeilig(r.m, 40), e: einzeilig(r.e, 100), x: einzeilig(r.x, 120) };
}
export function telefonbuchListe(b) {
  if (!istObjekt(b)) return null;
  let personen = 0;
  const stellen = [];
  for (const s of (Array.isArray(b.stellen) ? b.stellen : []).slice(0, TELEFONBUCH_MAX_STELLEN)) {
    if (!istObjekt(s) || typeof s.i !== 'string' || !/^s-\d{1,8}$/.test(s.i)) continue;
    const n = einzeilig(s.n, 80);
    if (!n) continue;
    const l = [];
    for (const r of Array.isArray(s.l) ? s.l : []) {
      const p = telefonbuchPerson(r);
      if (p && personen < TELEFONBUCH_MAX_PERSONEN) { l.push(p); personen++; }
    }
    stellen.push({ i: s.i, n, a: einzeilig(s.a, 30), t: einzeilig(s.t, 40), e: einzeilig(s.e, 100), o: einzeilig(s.o, 60), l });
  }
  const ohne = [];
  for (const r of Array.isArray(b.ohne) ? b.ohne : []) {
    const p = telefonbuchPerson(r);
    if (p && personen < TELEFONBUCH_MAX_PERSONEN) { ohne.push(p); personen++; }
  }
  const stand = typeof b.stand === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(b.stand) ? b.stand : '';
  return { hinweis: einzeilig(b.hinweis, 240), stellen, ohne, stand, mehr: Number.isInteger(b.mehr) && b.mehr > 0 && b.mehr < 1e6 ? b.mehr : 0 };
}

// Das Wissen (Funktion „wissen“, N13): die Wiki-Seiten vom Laptop zum Nachlesen – Liste (Pfad, Titel, Gruppe, Stand) und der Text als Markdown. Streng geprüft:
// nur Pfade aus erlaubten Zeichen (kein „..“, nur .md), Texte ohne Steuerzeichen und in der Länge begrenzt. Gezeigt wird später nur als Text (js/wissen-ansicht.js).
// Ein Eintrag ohne Text („nur_titel“) steht nur mit Titel da – lesen am Laptop. Die Form ist dieselbe wie vom Laptop (zweimal prüfen ändert nichts).
export const WISSEN_MAX_SEITEN = 1500;
export const WISSEN_MAX_TEXT = 300000;                 // Zeichen je Seite (der Laptop schickt höchstens 250 KB Text für alle Seiten zusammen)
const WISSEN_TEIL = /^[A-Za-z0-9][A-Za-z0-9._ ()-]{0,120}$/;
export function wissenPfad(p) {
  if (typeof p !== 'string' || !p || p.length > 300 || /[\\:\u0000]/.test(p) || p.startsWith('/')) return '';
  const teile = p.split('/');
  if (teile.some(x => x === '.' || x === '..' || !WISSEN_TEIL.test(x))) return '';
  return /\.md$/i.test(teile[teile.length - 1]) ? teile.join('/') : '';
}
const WISSEN_STEUER = new RegExp('[' + [[0, 8], [11, 31], [127, 159], [8203, 8207], [8232, 8233], [8234, 8238], [8294, 8297], [65279, 65279]]
  .map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');      // Steuerzeichen und unsichtbare Richtungszeichen
const wissenText = (x, n) => (typeof x === 'string' ? x.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(WISSEN_STEUER, '').slice(0, n) : '');
const WISSEN_ZUSTAND = ['ok', 'fehlt', 'kaputt'];
const zaehler = x => (Number.isInteger(x) && x > 0 && x < 1e6 ? x : 0);
export function wissenListe(b) {
  if (!istObjekt(b)) return null;
  const zustand = WISSEN_ZUSTAND.includes(b.zustand) ? b.zustand : 'kaputt';
  const seiten = [], schon = new Set();
  for (const s of (Array.isArray(b.seiten) ? b.seiten : []).slice(0, WISSEN_MAX_SEITEN)) {
    if (!istObjekt(s)) continue;
    const pfad = wissenPfad(s.pfad);
    const titel = einzeilig(s.titel, 160);
    if (!pfad || !titel || schon.has(pfad)) continue;
    schon.add(pfad);
    const e = { pfad, titel, gruppe: einzeilig(s.gruppe, 60).toLowerCase(), stand: typeof s.stand === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.stand) ? s.stand : '' };
    const text = wissenText(s.text, WISSEN_MAX_TEXT);
    if (typeof s.text === 'string') e.text = text; else e.nur_titel = true;
    seiten.push(e);
  }
  const gruppen = [], bekannt = new Set();
  for (const g of Array.isArray(b.gruppen) ? b.gruppen : []) {
    if (!Array.isArray(g) || typeof g[0] !== 'string') continue;
    const name = einzeilig(g[0], 60).toLowerCase(), titel = einzeilig(g[1], 60);
    if (bekannt.has(name) || !titel) continue;
    bekannt.add(name); gruppen.push([name, titel]);
  }
  for (const s of seiten) if (!bekannt.has(s.gruppe)) { bekannt.add(s.gruppe); gruppen.push([s.gruppe, s.gruppe ? s.gruppe[0].toUpperCase() + s.gruppe.slice(1) : 'Allgemein']); }
  const benutzt = new Set(seiten.map(s => s.gruppe));
  return { zustand, hinweis: einzeilig(b.hinweis, 240), gruppen: gruppen.filter(([g]) => benutzt.has(g)), seiten,
           nur_titel: seiten.filter(s => s.nur_titel).length, mehr: zaehler(b.mehr), unlesbar: zaehler(b.unlesbar) };
}

export function uebersichtKopf(k) {
  if (!istObjekt(k) || k.art !== 'uebersicht' || k.version !== 1) return null;
  const id = typeof k.id === 'string' ? k.id : '';
  const stand = zeitText(k.stand);
  if (!ID_OK.test(id) || !stand || !istObjekt(k.tabs)) return null;
  const profil = k.profil !== undefined ? profilKopf(k.profil) : null;          // nur im Stand für eine Station (A055)
  const tabs = {};
  for (const name of UEBERSICHT_TABS) { const t = uebersichtTab(k.tabs[name]); if (t) tabs[name] = t; }
  if (!Object.keys(tabs).length && !profil) return null;                 // ohne Profil wie bisher: mindestens ein Reiter. Eine Station kann auch nur Handgriffe haben (dann kommt kein Reiter mit, oder nur die Artikelliste `scan` im Reiter „lager“)
  if (profil && tabs.best) for (const z of tabs.best.tabelle.zeilen) if (z.d) { delete z.d.kontakt; delete z.d.notiz; }      // eine Station sieht nie Kontakt und Notiz einer Bestellung (der Laptop lässt beides schon weg)
  const hof = k.hof !== undefined ? hofListe(k.hof) : null;           // Gebäude-Infos (Funktion „hof“); fehlen sie, bleibt alles andere, wie es war
  const belege = !profil && k.belege !== undefined ? belegeListe(k.belege) : null;           // A053: nur im Stand für ein Verwalter-Handy
  const artikel = !profil && k.artikel !== undefined ? artikelListe(k.artikel) : null;           // A063: nur im Stand für ein Verwalter-Handy
  const telefonbuch = !profil && k.telefonbuch !== undefined ? telefonbuchListe(k.telefonbuch) : null;           // A059: nur im Stand für ein Verwalter-Handy
  const wissen = !profil && k.wissen !== undefined ? wissenListe(k.wissen) : null;                               // N13: nur im Stand für ein Verwalter-Handy
  const ergebnis = istObjekt(k.ergebnis) && typeof k.ergebnis.ok === 'boolean' && einzeilig(k.ergebnis.text, 200) ? { ok: k.ergebnis.ok, text: einzeilig(k.ergebnis.text, 200) } : null;      // das Ergebnis eines Auftrags (A037)
  return { id, frage: typeof k.frage === 'string' && UUID.test(k.frage) ? k.frage : '', stand, gesendet: zeitText(k.gesendet), tabs, ...(hof ? { hof } : {}), ...(belege ? { belege } : {}), ...(artikel ? { artikel } : {}), ...(telefonbuch ? { telefonbuch } : {}), ...(wissen ? { wissen } : {}), ...(ergebnis ? { ergebnis } : {}),
           ...(profil ? { profil } : {}) };
}

// Der Grund, warum der Laptop keinen Stand schickt (A040): ein kurzer fester Satz, dazu ein Kennwort.
export function uebersichtGrundKopf(k) {
  if (!istObjekt(k) || k.art !== 'uebersicht_grund' || k.version !== 1) return null;
  const id = typeof k.id === 'string' ? k.id : '';
  const frage = typeof k.frage === 'string' && UUID.test(k.frage) ? k.frage : '';
  const grund = einzeilig(k.grund, 160);
  const code = typeof k.code === 'string' && /^[a-z_]{1,20}$/.test(k.code) ? k.code : '';
  if (!ID_OK.test(id) || !frage || !grund || !code) return null;
  return { id, frage, code, grund, gesendet: zeitText(k.gesendet) };
}
export function uebersichtGrundFuer(stand, instanz) {
  const g = stand && istObjekt(stand.uebersichtGrund) ? stand.uebersichtGrund[normModus(instanz)] : null;
  return g && g.kopf ? g.kopf : null;
}

function normUebersicht(key, u) {
  if (key !== ECHT && key !== TEST) return null;
  if (!istObjekt(u)) return null;
  const kopf = uebersichtKopf({ ...u.kopf, art: 'uebersicht', version: 1 });
  return kopf ? { instanz: key, kopf, gesehen: Number.isFinite(u.gesehen) ? u.gesehen : Date.now() } : null;
}

// Der zuletzt bekannte Stand der Übersicht dieser Instanz (oder null): bleibt auf dem Handy, auch ohne Netz.
export function uebersichtFuer(stand, instanz) {
  const u = stand && istObjekt(stand.uebersicht) ? stand.uebersicht[normModus(instanz)] : null;
  return u && u.kopf ? u.kopf : null;
}

// ---- Anleitungen für die Handys der Mitarbeiter (Funktion „anleitungen“, N15) ------------------------------------------------------------
// Ein Mitglied bittet (Art „anleitungen_bitte“), der Laptop schickt NUR die Anleitungen (Art „anleitungen“, Form wie das Wissen) oder einen kurzen Satz
// (Art „anleitungen_grund“). Hier wird streng geprüft: wie beim Wissen (wissenListe), dazu nur Seiten der Gruppe „Anleitungen“ mit „anleitung-“ im Namen.
const ANLEITUNG_NAME = /(^|\/)anleitung-[^/]*$/i;
export function anleitungenListe(b) {
  const l = wissenListe(b);
  if (!l) return null;
  const seiten = l.seiten.filter(s => s.gruppe === 'anleitungen' && ANLEITUNG_NAME.test(s.pfad));
  return { ...l, gruppen: seiten.length ? [['anleitungen', 'Anleitungen']] : [], seiten, nur_titel: seiten.filter(s => s.nur_titel).length };
}
export function anleitungenKopf(k) {
  if (!istObjekt(k) || k.art !== 'anleitungen' || k.version !== 1) return null;
  const id = typeof k.id === 'string' ? k.id : '';
  const stand = zeitText(k.stand);
  const liste = anleitungenListe(k.anleitungen);
  if (!ID_OK.test(id) || !stand || !liste) return null;
  return { id, frage: typeof k.frage === 'string' && UUID.test(k.frage) ? k.frage : '', stand, gesendet: zeitText(k.gesendet), anleitungen: liste };
}
export function anleitungenGrundKopf(k) {
  if (!istObjekt(k) || k.art !== 'anleitungen_grund' || k.version !== 1) return null;
  const g = uebersichtGrundKopf({ ...k, art: 'uebersicht_grund' });
  return g;
}
// Die zuletzt bekommenen Anleitungen dieser Instanz (oder null): bleiben auf dem Handy, auch ohne Netz.
export function anleitungenFuer(stand, instanz) {
  const u = stand && istObjekt(stand.anleitungen) ? stand.anleitungen[normModus(instanz)] : null;
  return u && u.kopf ? u.kopf : null;
}
export function anleitungenGrundFuer(stand, instanz) {
  const g = stand && istObjekt(stand.anleitungenGrund) ? stand.anleitungenGrund[normModus(instanz)] : null;
  return g && g.kopf ? g.kopf : null;
}

// Was eine Station (A055) zeigt und anbietet: das Profil aus dem letzten geprüften Stand dieser Instanz. Ohne Stand, ohne Profil im Stand oder wenn der Laptop danach
// gemeldet hat, dass für dieses Gerät nichts eingestellt ist (Grund „kein_profil“), ist es leer – `satz` sagt dann, was stattdessen auf dem Bildschirm steht.
export const STATION_NICHTS = 'Der Laptop hat für dieses Gerät noch nichts geschickt.';
export function stationsProfil(stand, instanz) {
  const i = normModus(instanz);
  const u = stand && istObjekt(stand.uebersicht) ? stand.uebersicht[i] : null;
  const g = stand && istObjekt(stand.uebersichtGrund) ? stand.uebersichtGrund[i] : null;
  const standDanach = !!(u && u.kopf && g && u.gesehen > g.gesehen);                                    // kam nach dem Grund wieder ein Stand, gilt der Stand
  if (g && g.kopf && g.kopf.code === 'kein_profil' && !standDanach) return { reiter: [], handgriffe: [], satz: g.kopf.grund };
  if (!u || !u.kopf || !u.kopf.profil) return { reiter: [], handgriffe: [], satz: STATION_NICHTS };
  const pr = u.kopf.profil;
  return { reiter: [...pr.reiter], handgriffe: [...pr.handgriffe], satz: '', ...(pr.tafeln ? { tafeln: pr.tafeln.map(t => ({ ...t })) } : {}), ...(pr.takt ? { takt: pr.takt } : {}) };
}

// Quittung zu einer Nachricht, die dieses Handy gesendet hat („Angekommen · gebucht: …“). Sie ist keine Karte in der Post, sondern steht im Verlauf
// unter der gesendeten Nachricht (bezug = Kennung der Nachricht). Je Nachricht gilt die neueste Fassung (erst nach `gesendet`, bei gleicher Zeit nach `fassung`).
export function quittungKopf(k) {
  if (!istObjekt(k) || k.art !== 'fuer_dich' || k.ding !== 'quittung') return null;
  const id = typeof k.id === 'string' ? k.id : '';
  const bezug = typeof k.bezug === 'string' ? k.bezug : '';
  const satz = text(k.text, 200);
  if (!ID_OK.test(id) || !UUID.test(bezug) || !satz) return null;
  return { id, bezug, text: satz, fassung: Number.isInteger(k.fassung) && k.fassung >= 0 && k.fassung < 1e9 ? k.fassung : 0, erstellt: text(k.erstellt, 40), gesendet: zeitText(k.gesendet) };
}
const quittungAelter = (neu, alt) => spaeterAls(alt.gesendet, neu.gesendet) || (!spaeterAls(neu.gesendet, alt.gesendet) && neu.fassung < alt.fassung);

// A051: Merker „Fenster ‚Das habe ich verstanden‘ ist für diese Fassung schon von selbst aufgegangen“. Fehlt er (alter Stand), gilt das Fenster als erledigt – alte Karten springen nicht plötzlich auf.
function fensterMerk(x) {
  return Number.isInteger(x.fenster) && x.fenster >= -1 && x.fenster < 1e9
    ? { fenster: x.fenster, ...(x.fensterErinnert === true ? { fensterErinnert: true } : {}), ...(typeof x.fensterHash === 'string' ? { fensterHash: x.fensterHash.slice(0, 20) } : {}) } : {};
}

function normQuittung(key, q) {
  if (!istObjekt(q) || (q.instanz !== ECHT && q.instanz !== TEST)) return null;
  const kopf = quittungKopf({ ...q.kopf, art: 'fuer_dich', ding: 'quittung' });
  if (!kopf || key !== schluesselVon(q.instanz, kopf.bezug)) return null;
  return { instanz: q.instanz, bezug: kopf.bezug, kopf, gesehen: Number.isFinite(q.gesehen) ? q.gesehen : Date.now(), ...fensterMerk(q) };
}

// Die Karte „Bestätigen?“ zu einer Nachricht (Funktion „bestaetigung“): die erkannten Werte in festen Feldern und zwei Knöpfe. Sie steht im Verlauf unter der Nachricht (bezug).
// stand: 'offen' (wartet auf „Stimmt“ / „Falsch“) | 'stimmt' | 'falsch' (dann sagt `satz`, was der Laptop getan hat). Je Nachricht gilt die neueste Fassung.
const kartenText = (x, n) => einzeilig(typeof x === 'number' ? String(x) : x, n);
export function bestaetigungKopf(k) {
  if (!istObjekt(k) || k.art !== 'fuer_dich' || k.ding !== 'bestaetigung') return null;
  const id = typeof k.id === 'string' ? k.id : '';
  const bezug = typeof k.bezug === 'string' ? k.bezug : '';
  if (!/^b-[0-9a-z]{8,16}$/.test(id) || !UUID.test(bezug) || !KARTEN_STAENDE.includes(k.stand)) return null;
  const karten = [];
  for (const b of (Array.isArray(k.karten) ? k.karten : []).slice(0, 8)) {
    if (!istObjekt(b)) continue;
    const felder = [];
    for (const f of (Array.isArray(b.felder) ? b.felder : []).slice(0, 8)) {
      if (Array.isArray(f) && f.length === 2) { const n = kartenText(f[0], 24), w = kartenText(f[1], 80); if (n && w) felder.push([n, w]); }
    }
    const titel = kartenText(b.titel, 60);
    if (titel && felder.length) karten.push({ titel, felder });
  }
  if (!karten.length) return null;
  const satz = einzeilig(k.satz, 240);
  if (k.stand !== 'offen' && !satz) return null;
  // A051: neue Felder des Laptops – nur übernommen, wenn sie da sind (vor_buchen: wartet auf „Stimmt“; erinnert: einmal nach einem Tag erinnert; ueberschrift: fester Kopfsatz des Fensters)
  const mehr = {};
  if (k.vor_buchen === true) mehr.vor_buchen = true;
  if (k.erinnert === true) mehr.erinnert = true;
  const ue = einzeilig(k.ueberschrift, 60);
  if (ue) mehr.ueberschrift = ue;
  return { id, bezug, stand: k.stand, karten, satz, hash: einzeilig(k.hash, 20), fassung: Number.isInteger(k.fassung) && k.fassung >= 0 && k.fassung < 1e9 ? k.fassung : 0,
           erstellt: text(k.erstellt, 40), gesendet: zeitText(k.gesendet), ...mehr };
}
const bestaetigungAelter = (neu, alt) => spaeterAls(alt.gesendet, neu.gesendet) || (!spaeterAls(neu.gesendet, alt.gesendet) && neu.fassung < alt.fassung);

function normBestaetigung(key, b) {
  if (!istObjekt(b) || (b.instanz !== ECHT && b.instanz !== TEST)) return null;
  const kopf = bestaetigungKopf({ ...b.kopf, art: 'fuer_dich', ding: 'bestaetigung' });
  if (!kopf || key !== schluesselVon(b.instanz, kopf.bezug)) return null;
  const aus = { instanz: b.instanz, bezug: kopf.bezug, kopf, gesehen: Number.isFinite(b.gesehen) ? b.gesehen : Date.now(), neu: b.neu === true, ...fensterMerk(b) };
  if (istObjekt(b.meine) && KARTEN_WAHLEN.includes(b.meine.wahl) && b.meine.fassung === kopf.fassung && typeof b.meine.id === 'string') {
    aus.meine = { id: b.meine.id, wahl: b.meine.wahl, fassung: b.meine.fassung, am: Number.isFinite(b.meine.am) ? b.meine.am : Date.now() };
  }
  return aus;
}

function normDing(key, d) {
  if (!istObjekt(d) || (d.instanz !== ECHT && d.instanz !== TEST)) return null;
  const kopf = dingKopf({ ...d.kopf, art: 'fuer_dich' });
  if (!kopf || key !== schluesselVon(d.instanz, kopf.id)) return null;
  const meine = istObjekt(d.meine) && Number.isInteger(d.meine.fassung) ? { fassung: d.meine.fassung, am: Number.isFinite(d.meine.am) ? d.meine.am : Date.now() } : null;
  return { instanz: d.instanz, id: kopf.id, kopf, gesehen: Number.isFinite(d.gesehen) ? d.gesehen : Date.now(), ...(meine ? { meine } : {}) };
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
  if (istObjekt(roh.dinge)) {
    for (const [k, d] of Object.entries(roh.dinge)) {
      const g = normDing(k, d);
      if (g && Object.keys(aus.dinge).length < MAX_DINGE) aus.dinge[k] = g;
    }
  }
  if (istObjekt(roh.uebersicht)) {
    for (const [k, u] of Object.entries(roh.uebersicht)) {
      const g = normUebersicht(k, u);
      if (g) aus.uebersicht[k] = g;
    }
  }
  if (istObjekt(roh.uebersichtGrund)) {
    for (const [k, u] of Object.entries(roh.uebersichtGrund)) {
      if ((k !== ECHT && k !== TEST) || !istObjekt(u)) continue;
      const kopf = uebersichtGrundKopf({ ...u.kopf, art: 'uebersicht_grund', version: 1 });
      if (kopf) aus.uebersichtGrund[k] = { instanz: k, kopf, gesehen: Number.isFinite(u.gesehen) ? u.gesehen : Date.now() };
    }
  }
  for (const [feld, pruef] of [['anleitungen', anleitungenKopf], ['anleitungenGrund', anleitungenGrundKopf]]) {          // N15: Anleitungen eines Mitglieds
    if (!istObjekt(roh[feld])) continue;
    for (const [k, u] of Object.entries(roh[feld])) {
      if ((k !== ECHT && k !== TEST) || !istObjekt(u)) continue;
      const kopf = pruef({ ...u.kopf, art: feld === 'anleitungen' ? 'anleitungen' : 'anleitungen_grund', version: 1 });
      if (kopf) aus[feld][k] = { instanz: k, kopf, gesehen: Number.isFinite(u.gesehen) ? u.gesehen : Date.now() };
    }
  }
  if (istObjekt(roh.quittungen)) {
    for (const [k, q] of Object.entries(roh.quittungen)) {
      const g = normQuittung(k, q);
      if (g && Object.keys(aus.quittungen).length < MAX_QUITTUNGEN) aus.quittungen[k] = g;
    }
  }
  mitteilungNormieren(roh, aus);                                   // der öffentliche Schlüssel des Laptops für Mitteilungen (A064 Stufe 2)
  if (istObjekt(roh.bestaetigungen)) {
    for (const [k, b] of Object.entries(roh.bestaetigungen)) {
      const g = normBestaetigung(k, b);
      if (g && Object.keys(aus.bestaetigungen).length < MAX_BESTAETIGUNGEN) aus.bestaetigungen[k] = g;
    }
  }
  return aus;
}

// Ist Zeit a später als Zeit b? (Beide vom Laptop in derselben Schreibweise; fehlt eine oder ist sie unlesbar: nein.)
export function spaeterAls(a, b) {
  return typeof a === 'string' && typeof b === 'string' && ZEIT.test(a) && ZEIT.test(b) && a.slice(0, 19) > b.slice(0, 19);
}

// ---- Eine Nachricht des Laptops in den Zustand einarbeiten -------------------------------------------------------------------
// Gibt zurück: 'neu' | 'geaendert' | 'gleich' | 'erledigt' | 'vermerkt' (Hinweis zu einer unbekannten Rückfrage) | 'ding' („Für dich“) | 'quittung' | 'bestaetigung' | 'alt' | 'ungueltig'
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
  if (istObjekt(rohKopf) && rohKopf.art === 'mitteilung_schluessel') return mitteilungAnwenden(stand, instanz, rohKopf, jetzt);     // A064 Stufe 2
  if (istObjekt(rohKopf) && rohKopf.art === 'uebersicht') {
    const u = uebersichtKopf(rohKopf);
    if (!u) return 'ungueltig';
    if (!istObjekt(stand.uebersicht)) stand.uebersicht = {};
    const alt = stand.uebersicht[instanz];
    if (alt && alt.kopf && alt.kopf.stand > u.stand) return 'alt';                                              // ein älterer Stand nach einem neueren
    stand.uebersicht[instanz] = { instanz, kopf: u, gesehen: jetzt };
    return 'uebersicht';
  }
  if (istObjekt(rohKopf) && rohKopf.art === 'uebersicht_grund') {
    const g = uebersichtGrundKopf(rohKopf);
    if (!g) return 'ungueltig';
    if (!istObjekt(stand.uebersichtGrund)) stand.uebersichtGrund = {};
    stand.uebersichtGrund[instanz] = { instanz, kopf: g, gesehen: jetzt };
    return 'grund';
  }
  if (istObjekt(rohKopf) && rohKopf.art === 'anleitungen') {                                                    // N15: die Anleitungen eines Mitglieds
    const u = anleitungenKopf(rohKopf);
    if (!u) return 'ungueltig';
    if (!istObjekt(stand.anleitungen)) stand.anleitungen = {};
    const alt = stand.anleitungen[instanz];
    if (alt && alt.kopf && u.stand < alt.kopf.stand) return 'alt';                                              // ältere Anleitungen nach neueren
    stand.anleitungen[instanz] = { instanz, kopf: u, gesehen: jetzt };
    return 'anleitungen';
  }
  if (istObjekt(rohKopf) && rohKopf.art === 'anleitungen_grund') {
    const g = anleitungenGrundKopf(rohKopf);
    if (!g) return 'ungueltig';
    if (!istObjekt(stand.anleitungenGrund)) stand.anleitungenGrund = {};
    stand.anleitungenGrund[instanz] = { instanz, kopf: g, gesehen: jetzt };
    return 'anleitungen';
  }
  if (istObjekt(rohKopf) && rohKopf.art === 'fuer_dich' && rohKopf.ding === 'quittung') {
    const q = quittungKopf(rohKopf);
    if (!q) return 'ungueltig';
    if (!istObjekt(stand.quittungen)) stand.quittungen = {};
    const key = schluesselVon(instanz, q.bezug);
    const alt = stand.quittungen[key];
    if (alt && alt.kopf && quittungAelter(q, alt.kopf)) return 'alt';                                          // eine ältere Fassung nach einer neueren
    if (!alt && Object.keys(stand.quittungen).length >= MAX_QUITTUNGEN) return 'ungueltig';
    stand.quittungen[key] = { instanz, bezug: q.bezug, kopf: q, gesehen: jetzt, ...(alt ? fensterMerk(alt) : { fenster: -1 }) };
    return 'quittung';
  }
  if (istObjekt(rohKopf) && rohKopf.art === 'fuer_dich' && rohKopf.ding === 'bestaetigung') {
    const b = bestaetigungKopf(rohKopf);
    if (!b) return 'ungueltig';
    if (!istObjekt(stand.bestaetigungen)) stand.bestaetigungen = {};
    const key = schluesselVon(instanz, b.bezug);
    const alt = stand.bestaetigungen[key];
    if (alt && alt.kopf && bestaetigungAelter(b, alt.kopf)) return 'alt';                                       // eine ältere Fassung nach einer neueren
    if (!alt && Object.keys(stand.bestaetigungen).length >= MAX_BESTAETIGUNGEN) return 'ungueltig';
    // Eine Antwort dieses Handys bleibt nur für genau die Fassung vermerkt, auf die sie sich bezog (und sie ist vermerkt, bis der Laptop meldet, was er getan hat)
    const meine = alt && alt.meine && alt.kopf && alt.kopf.hash === b.hash && b.stand === 'offen' ? alt.meine : undefined;
    stand.bestaetigungen[key] = { instanz, bezug: b.bezug, kopf: b, gesehen: alt ? alt.gesehen : jetzt, neu: !alt || alt.kopf.stand !== b.stand || alt.neu === true, ...(alt ? fensterMerk(alt) : { fenster: -1 }), ...(meine ? { meine } : {}) };
    return 'bestaetigung';
  }
  if (istObjekt(rohKopf) && rohKopf.art === 'fuer_dich') {
    const d = dingKopf(rohKopf);
    if (!d) return 'ungueltig';
    const key = schluesselVon(instanz, d.id);
    const alt = stand.dinge[key];
    if (alt && alt.kopf && spaeterAls(alt.kopf.gesendet, d.gesendet)) return 'alt';                            // eine ältere Fassung nach einer neueren
    if (!alt && Object.keys(stand.dinge).length >= MAX_DINGE) return 'ungueltig';
    stand.dinge[key] = { instanz, id: d.id, kopf: d, gesehen: alt ? alt.gesehen : jetzt };
    return 'ding';
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

export function dinge(stand, instanz) {
  return Object.values(stand.dinge).filter(d => d.instanz === normModus(instanz) && d.kopf)
    .sort((a, b) => (b.kopf.erstellt || '').localeCompare(a.kopf.erstellt || '') || b.gesehen - a.gesehen || a.id.localeCompare(b.id));
}

// Der Satz, der unter der gesendeten Nachricht steht – oder '' (keine Quittung bekommen).
export function quittungFuer(stand, instanz, nachricht) {
  const q = stand && istObjekt(stand.quittungen) ? stand.quittungen[schluesselVon(instanz, nachricht)] : null;
  return q && q.kopf ? q.kopf.text : '';
}

// Die Karte „Bestätigen?“ zu einer Nachricht: { kopf, meine, ... } oder null (keine bekommen).
export function bestaetigungFuer(stand, instanz, nachricht) {
  const b = stand && istObjekt(stand.bestaetigungen) ? stand.bestaetigungen[schluesselVon(instanz, nachricht)] : null;
  return b && b.kopf ? b : null;
}

// A051: Soll das Fenster „Das habe ich verstanden“ jetzt von selbst aufgehen? Nur für eine offene Karte ohne eigene Antwort, und jede Fassung höchstens einmal
// (eine Erinnerung – `erinnert` – öffnet es noch einmal; dieselben Werte noch einmal geschrieben öffnen es nicht). Ohne Merker (alter Stand) nie.
export function fensterFaellig(eintrag) {
  if (!eintrag || !eintrag.kopf || eintrag.kopf.stand !== 'offen' || eintrag.meine || !Number.isInteger(eintrag.fenster)) return false;
  if (eintrag.fenster < 0) return true;                                                  // noch nie aufgegangen
  if (eintrag.kopf.erinnert === true && eintrag.fensterErinnert !== true) return true;    // die Erinnerung: noch einmal
  return eintrag.kopf.fassung > eintrag.fenster && eintrag.fensterHash !== eintrag.kopf.hash;   // neue Werte: neue Fassung
}
export function fensterMerken(eintrag) {
  eintrag.fenster = eintrag.kopf.fassung;
  eintrag.fensterHash = eintrag.kopf.hash;
  if (eintrag.kopf.erinnert === true) eintrag.fensterErinnert = true;
}
// Dasselbe für eine Quittung (ohne Karte zur selben Nachricht): einmal je Fassung, nur mit Merker.
export function quittungFensterFaellig(eintrag) {
  return !!eintrag && !!eintrag.kopf && Number.isInteger(eintrag.fenster) && eintrag.kopf.fassung > eintrag.fenster;
}

// Aufräumen: Erledigtes nach 14 Tagen, Hinweise ohne Rückfrage nach 14 Tagen, gemerkte Umschläge und „Für dich“ nach 30 Tagen.
// `weg` (optional): hier landen die Schlüssel der „Für dich“-Einträge, die verschwunden sind (ihre PDFs müssen noch gelöscht werden).
export function aufraeumen(stand, jetzt = Date.now(), weg = []) {
  if (istObjekt(stand.quittungen)) for (const [k, q] of Object.entries(stand.quittungen)) if (jetzt - q.gesehen > QUITTUNGEN_TAGE * 864e5) delete stand.quittungen[k];
  if (istObjekt(stand.bestaetigungen)) for (const [k, b] of Object.entries(stand.bestaetigungen)) if (jetzt - b.gesehen > QUITTUNGEN_TAGE * 864e5) delete stand.bestaetigungen[k];
  for (const [k, d] of Object.entries(stand.dinge)) if (jetzt - d.gesehen > DINGE_TAGE * 864e5) { delete stand.dinge[k]; weg.push(k); }
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
  if (k.frage_art === 'anmeldung' && !(istObjekt(antwort) && Number.isInteger(antwort.wahl))) throw new Error('Auf eine Anmeldung gibt es nur „Ja, anmelden“ oder „Nein“');
  if (istObjekt(antwort) && Number.isInteger(antwort.wahl)) {
    if (antwort.wahl < 0 || antwort.wahl >= k.antworten.length) throw new Error('Antwort gibt es nicht');
    kopf.wahl = antwort.wahl;
    kopf.wahl_text = k.antworten[antwort.wahl];
    art = 'wahl'; wert = antwort.wahl;
    if (k.frage_art === 'anmeldung') {
      // „Ja, anmelden“ gibt es nur mit der Unterschrift des Handys (Nachweis); „Nein“ geht nie mit einem Nachweis hinaus.
      if (kopf.wahl_text === ANMELDE_JA) {
        const n = nachweisKopf(antwort.nachweis);
        if (!n) throw new Error('Ohne Bestätigung am Handy gibt es kein Ja');
        kopf.nachweis = n;
      }
    }
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

// ---- Übersicht anfragen ------------------------------------------------------------------------------------------------------
// Die Anfrage ist winzig (nur eine Kennung) und beglaubigt; sie geht NICHT durch die Warteschlange der Nachrichten (eine Anfrage von gestern soll nicht
// später den Laptop wecken), sondern gleich in den Briefkasten. Der Laptop antwortet mit einem Umschlag „uebersicht“, den `holen` ablegt.
// Gibt { id, umschlag, instanz } zurück oder wirft einen Fehler (z. B. wenn der Schlüssel dieser Instanz fehlt – dann wird nichts gesendet).
export async function uebersichtFrageBauen({ instanz, geraet, config, privatKey, jetzt = new Date() }) {
  instanz = normModus(instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  const kopf = { art: 'uebersicht_frage', id: crypto.randomUUID(), ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString() };
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  return { id: kopf.id, umschlag: await verschluesseln(await beglaubigen(klar, mac), laptop), instanz };
}

// ---- Anleitungen erbitten (Funktion „anleitungen“, N15: nur das Handy eines Mitglieds) ------------------------------------------------
// Wie die Anfrage nach der Übersicht: winzig, beglaubigt, gleich in den Briefkasten. Der Laptop antwortet nur mit den Anleitungen (Art „anleitungen“).
export async function anleitungenBitteBauen({ instanz, geraet, config, privatKey, jetzt = new Date() }) {
  instanz = normModus(instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  const kopf = { art: 'anleitungen_bitte', id: crypto.randomUUID(), ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString() };
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  return { id: kopf.id, umschlag: await verschluesseln(await beglaubigen(klar, mac), laptop), instanz };
}

// ---- Das Original eines Belegs holen (Funktion „belege“, A053) ------------------------------------------------------------------
// Eine kleine beglaubigte Anfrage (Art „beleg_original_frage“: nur die Kennung des Belegs). Der Laptop prüft und legt das Original als Karte „Für dich“ in die Post
// dieses Handys (der vorhandene Weg); als Antwort kommt ein kurzer Satz (Art „uebersicht_grund“, Kennung der Anfrage). Sie geht gleich in den Briefkasten, nicht durch die Warteschlange.
export async function belegOriginalFrageBauen({ beleg, instanz, geraet, config, privatKey, jetzt = new Date() }) {
  if (typeof beleg !== 'string' || !BELEG_ID.test(beleg)) throw new Error('Beleg gibt es nicht');
  instanz = normModus(instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  const kopf = { art: 'beleg_original_frage', id: crypto.randomUUID(), beleg, ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString() };
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  return { id: kopf.id, umschlag: await verschluesseln(await beglaubigen(klar, mac), laptop), instanz };
}

// ---- Betrieb zuordnen (Funktion „belege“, N4) ----------------------------------------------------------------------------------------
// Bei einem Beleg ohne Betrieb: eine kleine beglaubigte Bitte (Art „beleg_betrieb_auftrag“: nur die Kennung des Belegs und die Kennung des Betriebs). Das Handy schreibt nie selbst;
// der Laptop prüft (nur Verwalter-Handys) und legt den Auftrag für das Werkzeug „dokumente“ an. Als Antwort kommt ein kurzer Satz (Art „uebersicht_grund“, Kennung der Bitte).
export async function belegBetriebAuftragBauen({ beleg, betrieb, instanz, geraet, config, privatKey, jetzt = new Date() }) {
  if (typeof beleg !== 'string' || !BELEG_ID.test(beleg) || typeof betrieb !== 'string' || !BELEG_ID.test(betrieb)) throw new Error('Beleg oder Betrieb gibt es nicht');
  instanz = normModus(instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  const kopf = { art: 'beleg_betrieb_auftrag', id: crypto.randomUUID(), beleg, betrieb, ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString() };
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  return { id: kopf.id, umschlag: await verschluesseln(await beglaubigen(klar, mac), laptop), instanz };
}

// ---- Die Hof-Karte am Handy bearbeiten (Funktion „hofkarte_bearbeiten“, A037) ------------------------------------------------------
// Eine kleine beglaubigte Nachricht (Art „karte_auftrag“: eine Aktion und ein paar Angaben). Das Handy schreibt nie selbst; der Laptop prüft, führt aus und schickt
// den neuen Stand mit dem Ergebnis zurück (Antwort mit `frage` = Kennung des Auftrags). Sie geht NICHT durch die Warteschlange (ein Auftrag von gestern soll nicht später
// etwas verändern), sondern gleich in den Briefkasten.
export const KARTE_AKTIONEN = ['name', 'platz', 'neu', 'ausblenden', 'einblenden', 'maschine_umbenennen', 'maschine_entfernen', 'maschine_aufnehmen'];
export async function karteAuftragBauen({ aktion, parameter, instanz, geraet, config, privatKey, jetzt = new Date() }) {
  if (!KARTE_AKTIONEN.includes(aktion) || !istObjekt(parameter)) throw new Error('Aktion gibt es nicht');
  instanz = normModus(instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  const kopf = { art: 'karte_auftrag', id: crypto.randomUUID(), aktion, parameter, ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString() };
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  return { id: kopf.id, umschlag: await verschluesseln(await beglaubigen(klar, mac), laptop), instanz };
}

// ---- „Stimmt“ / „Falsch“ zur Karte ------------------------------------------------------------------------------------------------
// Die Antwort ist klein und beglaubigt (Art „bestaetigung_antwort“: Karte, Nachricht, Fassung, Wahl – keine Werte). Sie geht durch die Warteschlange der Nachrichten
// (klappt auch ohne Netz). Der Laptop prüft, dass die Karte diesem Handy gehört, und nimmt nur die erste Antwort.
export async function bestaetigungAntwortBauen({ eintrag, wahl, geraet, config, privatKey, jetzt = new Date() }) {
  const instanz = normModus(eintrag.instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  const k = eintrag.kopf;
  if (!KARTEN_WAHLEN.includes(wahl)) throw new Error('Antwort gibt es nicht');
  if (k.stand !== 'offen' || eintrag.meine) throw new Error('schon beantwortet');
  const kopf = { art: 'bestaetigung_antwort', id: crypto.randomUUID(), karte: k.id, bezug: k.bezug, fassung: k.fassung, wahl, ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString() };
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  return { id: kopf.id, umschlag: await verschluesseln(await beglaubigen(klar, mac), laptop), instanz, meine: { id: kopf.id, wahl, fassung: k.fassung, am: jetzt.getTime() } };
}

// ---- „Geschickt“ zur Karte „Nachricht an Kunden“ (Funktion „kundennachricht“, A025) -----------------------------------------------------
// Eine kleine beglaubigte Meldung (Art „nachricht_geschickt“: Bestellung, Anlass, Fassung – nie der Text). Das Handy schickt dem Kunden nichts; es sagt dem Laptop nur, dass
// Niklas den Text selbst verschickt hat. Der Laptop prüft und trägt den Vermerk „Nachricht geschickt“ in die Bestellung ein. Sie geht durch die Warteschlange (klappt auch ohne Netz).
export async function nachrichtGeschicktBauen({ eintrag, geraet, config, privatKey, jetzt = new Date() }) {
  const instanz = normModus(eintrag.instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  const n = eintrag.kopf && eintrag.kopf.ding === 'nachricht' ? eintrag.kopf.nachricht : null;
  if (!n || n.geschickt || (eintrag.meine && eintrag.meine.fassung === n.fassung)) throw new Error('schon gemeldet');
  const kopf = { art: 'nachricht_geschickt', id: crypto.randomUUID(), bestellung: n.bestellung, anlass: n.anlass, fassung: n.fassung, ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString() };
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  return { id: kopf.id, umschlag: await verschluesseln(await beglaubigen(klar, mac), laptop), instanz, meine: { fassung: n.fassung, am: jetzt.getTime() } };
}

// ---- Dieses Handy für Anmelde-Freigaben einrichten (Funktion „anmelde_freigabe“, A064) ----------------------------------------------
// Eine kleine beglaubigte Nachricht (Art „anmelde_handy“: Gerätename, Kennung und öffentlicher Schlüssel – nichts Geheimes). Sie geht durch die Warteschlange (klappt auch ohne Netz)
// und wird gleich gesendet. Der Laptop prüft, dass sie von einem Verwalter-Handy kommt, und merkt sich Kennung und Schlüssel.
export async function anmeldeHandyBauen({ kennung, schluessel, instanz, geraet, config, privatKey, jetzt = new Date() }) {
  instanz = normModus(instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  if (typeof kennung !== 'string' || !kennung || kennung.length > 1400 || typeof schluessel !== 'string' || !schluessel || schluessel.length > 400) throw new Error('Kennung oder Schlüssel unbrauchbar');
  const kopf = { art: 'anmelde_handy', id: crypto.randomUUID(), ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString(), kennung, schluessel };
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  return { id: kopf.id, umschlag: await verschluesseln(await beglaubigen(klar, mac), laptop), instanz };
}

// ---- Holen -------------------------------------------------------------------------------------------------------------------
// Holt alles, was der Laptop für dieses Handy abgelegt hat, prüft es und arbeitet es in `stand` ein. `speichern(stand)` wird nach jeder
// verarbeiteten Nachricht und VOR dem Quittieren aufgerufen (kommt das Quittieren nicht durch, wird nichts doppelt verarbeitet).
// kasten: antwortenListe(token, test), antwortHolen(token, id, test), antwortQuittieren(token, id, test) (siehe briefkasten.js)
// dateiSpeichern(schluessel, bytes) / dateiLoeschen(schluessel): wohin das PDF eines „Für dich“-Eintrags kommt (kann werfen, z. B. Speicher voll:
// dann wird nichts quittiert und der Umschlag beim nächsten Mal noch einmal geholt).
// arten (optional): nur Nachrichten dieser Arten werden eingearbeitet, alles andere wird verworfen (und quittiert) – eine Station (A055) nimmt so nur die Übersicht an,
// nie Rückfragen, „Für dich“, Quittungen oder Karten.
// Gibt { neu, geaendert, erledigt, dinge, quittungen, bestaetigungen, verworfen, uebersprungen, schluesselFehlt } zurück. Wirft BriefkastenFehler, wenn der Briefkasten nicht antwortet.
export async function holen({ kasten, geraet, config, privatKey, stand, speichern, test = false, jetzt = () => Date.now(), dateiSpeichern = async () => {}, dateiLoeschen = async () => {}, arten = null }) {
  const erg = { neu: 0, geaendert: 0, erledigt: 0, dinge: 0, quittungen: 0, bestaetigungen: 0, uebersicht: 0, anleitungen: 0, verworfen: 0, uebersprungen: 0, schluesselFehlt: false };
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
    let ergebnis = 'ungueltig', bytes = null, dingKey = '', vorher;
    try {
      const klar = await beglaubigtOeffnen(await entschluesseln(umschlag, privatKey), mac);
      const { kopf, dateien } = auspacken(klar);
      if (kopf && kopf.ziel === instanz && (!Array.isArray(arten) || arten.includes(kopf.art))) {
        if (kopf.art === 'uebersicht' || kopf.art === 'uebersicht_grund' || kopf.art === 'anleitungen' || kopf.art === 'anleitungen_grund') {
          ergebnis = dateien.length ? 'ungueltig' : anwenden(stand, instanz, { ...kopf, dateien: [] }, jetzt());          // der Stand (und der Grund) trägt nie eine Datei
        } else if (kopf.art === 'fuer_dich' && kopf.ding === 'bestaetigung') {
          ergebnis = dateien.length ? 'ungueltig' : anwenden(stand, instanz, { ...kopf, dateien: [] }, jetzt());       // eine Karte trägt nie eine Datei
        } else if (kopf.art === 'fuer_dich' && kopf.ding === 'quittung') {
          ergebnis = dateien.length ? 'ungueltig' : anwenden(stand, instanz, { ...kopf, dateien: [] }, jetzt());       // eine Quittung trägt nie eine Datei
        } else if (kopf.art === 'fuer_dich') {
          // Ein Dokument trägt genau ein PDF; alles andere (mehrere Dateien, falscher Typ, kein PDF, zu groß) kommt nicht auf das Handy.
          const roh = { ...kopf, dateien: [] };
          const d = dateien.length === 1 ? dateien[0] : null;
          if (kopf.ding === 'dokument' && dateien.length) {
            if (d && d.typ === 'application/pdf' && d.daten.length > 0 && d.daten.length <= MAX_PDF && pdfSignatur(d.daten)) {
              roh.dateien = [{ name: d.name, typ: d.typ, art: d.art, groesse: d.daten.length }];
              bytes = d.daten;
            } else roh.datei_fehlt = 'ungueltig';
          }
          dingKey = schluesselVon(instanz, typeof kopf.id === 'string' ? kopf.id : '');
          vorher = stand.dinge[dingKey];
          ergebnis = anwenden(stand, instanz, roh, jetzt());
        } else ergebnis = anwenden(stand, instanz, kopf, jetzt());
      }
    } catch { ergebnis = 'ungueltig'; }
    if (ergebnis === 'ding') {
      try {
        if (bytes) await dateiSpeichern(dingKey, bytes);
        else await dateiLoeschen(dingKey);                           // eine neue Fassung ohne PDF: das alte PDF soll nicht übrig bleiben
      } catch (e) {
        if (bytes) { if (vorher) stand.dinge[dingKey] = vorher; else delete stand.dinge[dingKey]; throw e; }     // Speicher voll o. Ä.: nichts quittieren
      }
    }
    stand.items[x.id] = jetzt();
    if (ergebnis === 'neu') erg.neu++;
    else if (ergebnis === 'geaendert') erg.geaendert++;
    else if (ergebnis === 'erledigt' || ergebnis === 'vermerkt') erg.erledigt++;
    else if (ergebnis === 'ding') erg.dinge++;
    else if (ergebnis === 'quittung') erg.quittungen++;
    else if (ergebnis === 'bestaetigung') erg.bestaetigungen++;
    else if (ergebnis === 'uebersicht' || ergebnis === 'grund') erg.uebersicht++;
    else if (ergebnis === 'anleitungen') erg.anleitungen++;
    else if (ergebnis === 'ungueltig' || ergebnis === 'alt') erg.verworfen++;
    await speichern(stand);
    try { await kasten.antwortQuittieren(geraet.token, x.id, test); } catch { /* der Umschlag wird beim nächsten Mal noch einmal quittiert */ }
  }
  const weg = [];
  aufraeumen(stand, jetzt(), weg);
  for (const k of weg) { try { await dateiLoeschen(k); } catch { /* beim nächsten Aufräumen gibt es den Eintrag nicht mehr: das PDF bleibt höchstens liegen */ } }
  await speichern(stand);
  return erg;
}
