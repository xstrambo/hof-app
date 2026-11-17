import grundConfig from './config.js';
import { einstellung, nachrichten, aufraeumen } from './js/speicher.js';
import { briefkastenFuer, normCode, BriefkastenFehler } from './js/briefkasten.js';
import { packen, verschluesseln, fotoVerkleinern } from './js/paket.js';
import { Aufnahme, liveTextMoeglich } from './js/sprache.js';
import { ECHT, TEST, lesModus, schreibModus, normModus, testSchalterErlaubt, schluesselFuer, zielVon, testBlockiert, TEXTE } from './js/modus.js';
import { ladeFunktionen, sichtbar as funktionSichtbar, anwenden as funktionenAnwenden } from './js/funktionen.js';
import { neuerStand, normStand, STAND_NAME, holen as postHolenLogik, antwortBauen, erledigte as postErledigte, schluesselVon, dateiSchluessel, quittungFuer, uebersichtFuer, uebersichtGrundFuer, uebersichtFrageBauen, karteAuftragBauen, bestaetigungFuer, bestaetigungAntwortBauen, stationsProfil, SCAN_HANDGRIFFE } from './js/post.js';
import { zeichneKarte, einblendungText, WAHL_TEXT } from './js/bestaetigung-ansicht.js';
import { zeichneReiter, zeichneInhalt, standText } from './js/uebersicht.js';
import { zeichneBestellung } from './js/bestellung-ansicht.js';
import { istBereich, bereichVon, symbol as bereichSymbol, zeichneKacheln } from './js/kacheln.js';
import { baueScan } from './js/scan-ansicht.js';
import { istScanBereich } from './js/scanzeilen.js';
import { zeichnePost, sichtbareFragen, sichtbareDinge } from './js/post-ansicht.js';
import { FUNKTION as CLOUD, MAX_SEKUNDEN, erkennen, hinweisFuer, wiederholbar, pauseMs, textVerbinden, HINWEIS_LEER, HINWEIS_LAEUFT, HINWEIS_FERTIG } from './js/erkennung.js';

// ---------- Einstellungen ----------
const config = { live_text: 'handy', testSchluessel: '', testRollen: ['admin'], ...grundConfig };
const lokal = ['localhost', '127.0.0.1'].includes(location.hostname);
const q = new URLSearchParams(location.search);
if (lokal && q.has('attrappe')) {
  config.attrappe = true;
  if (q.get('schluessel')) config.laptopSchluessel = q.get('schluessel');
  if (q.get('testschluessel')) config.testSchluessel = q.get('testschluessel');
}
const kasten = briefkastenFuer(config);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let geraet = null;          // {token, id, rolle, status, name}
let modus = ECHT;           // Echt | Test: wohin die nächste Nachricht geht (siehe js/modus.js)
let funktionen = {};        // neue Funktionen: { name: 'test' | 'alle' } aus funktionen.json (siehe js/funktionen.js); leer = alles Neue nur im Test
let entwurf = neuerEntwurf();
let aufnahme = null;
let cloudPauseBis = 0;      // nach einem Ausfall der Cloud-Erkennung nimmt die App bis dahin wieder den Live-Text des Handys
let erkennungOffen = 0;     // so viele Aufnahmen werden gerade abgeschrieben
let letzteErkennung = null; // { audio, dauer } für „Nochmal versuchen“
const HINWEIS_KEIN_LIVETEXT = 'Live-Text auf diesem Handy nicht verfügbar – die Aufnahme wird später abgeschrieben.';
// Ruhiger Hinweis auf dem Aufnahme-Bildschirm, wenn statt Live-Text aufgenommen wird (je nach Grund)
const HINWEIS_WECHSEL = {
  netz: 'Live-Text braucht Netz – ich nehme stattdessen auf. Der Laptop schreibt es\u00A0ab.',
  fehlt: 'Live-Text gibt es auf diesem Handy nicht – ich nehme auf. Der Laptop schreibt es\u00A0ab.',
  stumm: 'Es kommt kein Text an – ich nehme stattdessen auf. Der Laptop schreibt es\u00A0ab.',
  standard: 'Live-Text klappt hier nicht – ich nehme stattdessen auf. Der Laptop schreibt es\u00A0ab.',
};
HINWEIS_WECHSEL.aus = HINWEIS_WECHSEL.fehlt;
// Cloud-Erkennung (Mistral): während der Aufnahme kein Live-Text, der Text kommt gleich nach „Fertig“
HINWEIS_WECHSEL.cloud = 'Ich nehme auf. Nach „Fertig“ steht der Text in ein paar Sekunden da – prüfen, verbessern, senden. Bis zu 3\u00A0Minuten am Stück.';
let aktuell = null;

function neuerEntwurf() { return { text: '', audio: null, audioDauer: 0, anhaenge: [], bereich: '' }; }
// Eingegebenes geht nie verloren: der ganze Entwurf (Text, Aufnahme, Anhänge) liegt im Handy.
let entwurfTimer;
function entwurfMerken(sofort) {
  clearTimeout(entwurfTimer);
  const tu = () => einstellung.setze('entwurf', entwurf).catch(() => {});
  if (sofort) return tu();
  entwurfTimer = setTimeout(tu, 400);
}

// ---------- Bildschirme ----------
// Anzeige-Modus (?anzeige=lager): nur das Warenlager der Übersicht, große Schrift, nur lesen – zum Aufstellen an einem Handy oder Tablet. Alles andere
// (Sprechen, Senden, Post) gibt es auf diesem Gerät dann nicht; das Gerät muss ein freigegebenes Verwalter-Handy sein, und die Übersicht muss gelten.
const ANZEIGE = new URLSearchParams(location.search).get('anzeige') === 'lager';
const anzeigeZiel = () => (funktionAktiv('uebersicht') && geraet?.rolle === 'admin' ? 's-uebersicht' : 's-anzeige-aus');
// Station (Auftrag A055): ein Gerät mit der Rolle „station“ (z. B. ein Tablet im Hofladen). Es hat nur die Übersicht – mit den Reitern und den Handgriffen, die der Laptop
// in seinem letzten Stand als Profil mitgeschickt hat (js/post.js: stationsProfil). Den Mikrofon-Startbildschirm, Post, Freigaben, Kacheln, den Schalter Echt | Test,
// die Hof-Karte zum Bearbeiten und Bestätigungs-Karten gibt es dort nicht. Das Profil ist Komfort, keine Sicherheit: Was eine Station sieht und senden darf, setzt der Laptop durch.
const istStation = () => geraet?.rolle === 'station';
const stationFrei = () => istStation() && geraet.status === 'frei';
const stationSicht = () => stationsProfil(postStand, modus);                 // { reiter, handgriffe, satz } – satz: was dasteht, solange es kein Profil gibt
const stationDarf = griff => stationSicht().handgriffe.includes(griff);
const freiErlaubt = () => !stationFrei() || stationDarf('sprechen');        // freie Nachrichten (Mikrofon, Text, Anhang): auf einer Station nur mit dem Handgriff „sprechen“
// Wohin eine Station statt des gewünschten Bildschirms kommt: Alles, was sie nicht hat, führt zur Übersicht (gilt die Funktion „uebersicht“ nicht, bleibt nur der Hinweis).
function stationZiel(id) {
  const heim = !ANZEIGE && funktionAktiv('uebersicht') ? 's-uebersicht' : 's-anzeige-aus';
  const sicht = stationSicht();
  if (id === 's-bestellung') return heim === 's-uebersicht' && sicht.reiter.includes('best') ? id : heim;
  if (id === 's-scan') return scannerAktiv() && SCAN_HANDGRIFFE.includes(entwurf.bereich) && sicht.handgriffe.includes(entwurf.bereich) ? id : heim;      // nur in der Art des angetippten Handgriffs
  if (id === 's-aufnahme') return sicht.handgriffe.includes('sprechen') ? id : heim;
  if (id === 's-pruefen') return sicht.handgriffe.length ? id : heim;
  return heim;
}
function zeige(id, { verlauf = true } = {}) {
  const ziel = document.getElementById(id);
  if (ziel?.dataset.funktion && !funktionAktiv(ziel.dataset.funktion)) id = 's-start';   // Bildschirm einer noch nicht freigegebenen Funktion: nie zeigen
  if (id === 's-bestellung' && !bestellWahl) id = 's-uebersicht';                          // ohne angetippte Bestellung (z. B. nach dem Neuladen) gibt es keine Karte
  if (stationFrei()) id = stationZiel(id);                                                 // Station: nur die Übersicht und ihre Handgriffe
  if (ANZEIGE && geraet?.status === 'frei' && id !== 's-uebersicht' && id !== 's-anzeige-aus') id = anzeigeZiel();
  if (aktuell === 's-aufnahme' && id !== 's-aufnahme' && aufnahme) { aufnahme.abbrechen(); aufnahme = null; }
  if (aktuell === 's-scan' && id !== 's-scan') scan.schliessen();                  // die Kamera geht aus, sobald man den Scanner verlässt
  $$('.screen').forEach(s => { s.hidden = s.id !== id; });
  const vorher = aktuell;
  aktuell = id;
  if (verlauf) history.pushState({ s: id }, '');
  window.scrollTo(0, 0);
  if (id === 's-start' || id === 's-gesendet') zeichneListen();
  if (id === 's-start') bereichAnzeigen();                    // zeigt auch den Hinweis (er hängt davon ab, ob die Cloud-Erkennung gerade pausiert) und den gewählten Bereich
  if (id === 's-freigaben') ladeFreigaben();
  if (id === 's-post') { postZeichnen(true); postHolen(); }
  if (id === 's-uebersicht') { uebersichtZeichnen(); uebersichtAuto(vorher === 's-bestellung' ? 'zurueck' : 'oeffnen'); }              // A040: die Übersicht holt beim Öffnen selbst (nicht beim Zurück von der Bestellkarte)
  if (id === 's-bestellung') bestellungZeichnen();
  if (id === 's-bereich') bereichZeichnen();
  if (id === 's-scan' && !scan.oeffnen(entwurf.bereich)) id = 's-start';
  if (id === 's-pruefen') { bereichAnzeigen(); pruefenRechte(); }
  navAnzeigen();
}
window.addEventListener('popstate', e => {
  blattZu();
  blaetterSchliessen();
  const ziel = e.state?.s;
  if (!geraet || geraet.status !== 'frei') return;
  if (ziel && ziel !== 's-zugang' && ziel !== 's-warten') zeige(ziel, { verlauf: false });
  else zeige('s-start', { verlauf: false });
});

let meldungTimer;
function meldung(text, ms = 3500) {
  const m = $('#meldung'); m.textContent = text; m.hidden = false;
  clearTimeout(meldungTimer); meldungTimer = setTimeout(() => { m.hidden = true; }, ms);
}

function setzeName() { $$('.nutzer-name').forEach(e => { e.textContent = geraet?.name || ''; }); }

function netzAnzeigen() {
  $$('[data-netz]').forEach(e => {
    e.textContent = navigator.onLine ? 'Online' : 'Offline';
    e.classList.toggle('offline', !navigator.onLine);
  });
}
addEventListener('online', () => { netzAnzeigen(); postausgang(); });
addEventListener('offline', netzAnzeigen);

// ---------- Start / Zugang ----------
async function starten() {
  if (ANZEIGE) document.body.classList.add('anzeige-lager');
  if ('serviceWorker' in navigator && !config.attrappe) navigator.serviceWorker.register('sw.js').catch(() => {});
  netzAnzeigen();
  geraet = await einstellung.hole('geraet');
  await postLaden();
  modusSetzen(lesModus(), { merken: false });
  const flaggen = funktionenLaden();
  const gespeichert = await einstellung.hole('entwurf');
  if (gespeichert) entwurf = { ...neuerEntwurf(), ...gespeichert };
  // Alte Fassungen haben hier gemerkt "Live-Text geht auf diesem Handy nicht" und ihn für immer abgeschaltet.
  // Jetzt wird jedes Mal zuerst Live-Text versucht und bei Bedarf automatisch umgeschaltet: Merker wegräumen.
  einstellung.loesche('livetext-aus').catch(() => {});
  startHinweis();
  if (!geraet) return zeige('s-zugang', { verlauf: false });
  setzeName();
  if (geraet.status !== 'frei') return wartenAuf();
  if (istStation()) await flaggen.catch(() => {});          // Station: ihr Anfang ist die Übersicht, und die hängt an einer Funktion – erst zeigen, wenn funktionen.json gelesen ist
  history.replaceState({ s: 's-start' }, '');
  zeige('s-start', { verlauf: false });                     // (eine Station kommt von hier zur Übersicht, siehe stationZiel)
  hintergrund();
  if (ANZEIGE) return;
  // Angefangener Entwurf? Dann gleich dort weitermachen.
  if (entwurf.text.trim() || entwurf.audio || entwurf.anhaenge.length) { zeigePruefen(false); if (aktuell === 's-pruefen') meldung('Dein angefangener Entwurf ist noch da.'); }
}

$('#f-zugang').addEventListener('submit', async e => {
  e.preventDefault();
  const code = normCode($('#hof-code').value);
  const name = $('#hof-name').value.trim();
  const fehler = $('#zugang-fehler');
  fehler.hidden = true;
  if (code.length !== 7 || !name) { fehler.textContent = 'Bitte Code und Namen eintragen.'; fehler.hidden = false; return; }
  const knopf = e.submitter || $('#f-zugang button'); knopf.disabled = true;
  try {
    const oeff = await geraeteSchluessel();
    const r = await kasten.anmelden(code, name, oeff);
    geraet = { token: r.token, id: r.geraet, rolle: r.rolle, status: r.status, name, code };
    await einstellung.setze('geraet', geraet);
    modusSetzen(lesModus(), { merken: false });
    setzeName();
    if (geraet.status === 'frei') { history.replaceState({ s: 's-start' }, ''); zeige('s-start', { verlauf: false }); hintergrund(); }
    else wartenAuf();
  } catch (err) {
    fehler.textContent = err.code === 'netz' ? 'Kein Netz. Bitte nochmal versuchen, wenn Empfang da ist.'
      : err.code === 'code' ? 'Der Code stimmt nicht oder ist abgelaufen. Frag Niklas nach einem neuen.'
      : 'Das hat nicht geklappt. Bitte nochmal versuchen.';
    fehler.hidden = false;
  } finally { knopf.disabled = false; }
});

// Eigenes Schlüsselpaar je Handy (für Rückfragen in Phase 2). Der private Teil verlässt das Handy nie.
async function geraeteSchluessel() {
  try {
    let paar = await einstellung.hole('geraete-schluessel');
    if (!paar) {
      paar = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      await einstellung.setze('geraete-schluessel', paar);
    }
    const roh = new Uint8Array(await crypto.subtle.exportKey('raw', paar.publicKey));
    return btoa(String.fromCharCode(...roh));
  } catch { return null; }
}

let wartenTimer;
function wartenAuf() {
  zeige('s-warten', { verlauf: false });
  $('#warten-code').textContent = geraet.code || '';
  const pruefe = async () => {
    try {
      const r = await kasten.status(geraet.token);
      if (r.status === 'frei') {
        geraet = { ...geraet, status: 'frei', rolle: r.rolle };
        await einstellung.setze('geraet', geraet);
        modusSetzen(lesModus(), { merken: false });
        clearInterval(wartenTimer);
        history.replaceState({ s: 's-start' }, '');
        zeige('s-start', { verlauf: false }); hintergrund();
        meldung('Du bist freigegeben. Los geht’s!');
      } else if (r.status === 'gesperrt') {
        $('#warten-status').textContent = 'Dieses Handy wurde nicht freigegeben. Sprich mit Niklas.';
      }
    } catch (err) {
      if (err.code === 'unbekannt') { await einstellung.loesche('geraet'); geraet = null; clearInterval(wartenTimer); zeige('s-zugang', { verlauf: false }); }
    }
  };
  clearInterval(wartenTimer); wartenTimer = setInterval(pruefe, 5000); pruefe();
}

// ---------- Sprechen ----------
$('#b-sprechen').addEventListener('click', () => sprechenStarten(false));
$('#b-nochmal').addEventListener('click', () => sprechenStarten(true));

const pegel = $('#pegel');
for (let i = 0; i < 24; i++) pegel.appendChild(document.createElement('span'));

let uhrTimer;
async function sprechenStarten(nochmal) {
  if (stationFrei() && !(nochmal ? stationDarf('sprechen') : stationBeginnen('sprechen'))) return;      // Station: Mikrofon nur mit dem Handgriff „sprechen“
  if (!nochmal) { entwurf = { ...neuerEntwurf(), anhaenge: entwurf.anhaenge, text: entwurf.text, bereich: entwurf.bereich }; }
  const vorher = entwurf.text.trim();
  $('#live-fest').textContent = vorher ? vorher + ' ' : '';
  $('#live-vorlaeufig').textContent = '';
  aufnahmeModus(null);
  zeige('s-aufnahme');
  // Zuerst läuft nur die Spracherkennung (Live-Text). Geht die nicht, schaltet Aufnahme von selbst auf reine
  // Tonaufnahme um und meldet das über beiWechsel. So greifen nie beide gleichzeitig aufs Mikrofon zu.
  // Cloud-Erkennung (nur wenn freigegeben, siehe funktionen.json „sprache_cloud“): dann gar kein Live-Text, sondern gleich aufnehmen –
  // der Text kommt nach „Fertig“ aus der Cloud (js/erkennung.js).
  const cloud = cloudAktiv();
  const a = new Aufnahme({
    liveText: !cloud && config.live_text === 'handy',
    aufnahmeGrund: cloud ? 'cloud' : 'aus',
    beiText: (fest, vor) => {
      $('#live-fest').textContent = [vorher, fest].filter(Boolean).join(' ') + (vor ? ' ' : '');
      $('#live-vorlaeufig').textContent = vor;
      const m = $('.mitschrift'); m.scrollTop = m.scrollHeight;
    },
    beiPegel: p => { const jetzt = performance.now(); if (jetzt - (pegel._t || 0) < 80) return; pegel._t = jetzt; const b = pegel.firstChild; pegel.appendChild(b); b.style.height = Math.max(6, p * 52) + 'px'; },
    beiWechsel: grund => { if (aufnahme === a) aufnahmeModus(grund); },
    beiProblem: art => { if (aufnahme === a) aufnahmeGescheitert(art); },
  });
  a.cloud = cloud;
  aufnahme = a;
  try { await a.starten(); }
  catch (err) {
    if (aufnahme === a) aufnahme = null;
    meldung(mikrofonText(err && err.message), 6000);
    history.back();
    return;
  }
  // Mehr als 3 Minuten nimmt die Cloud-Erkennung nicht an: die App beendet die Aufnahme dann selbst (der Rest geht mit „Nochmal sprechen“).
  if (cloud) setTimeout(() => { if (aufnahme === a) { meldung('Nach 3 Minuten beendet – für mehr bitte „Nochmal sprechen“.', 6000); aufnahmeBeenden(); } }, MAX_SEKUNDEN * 1000);
  const t0 = Date.now();
  $('#uhr').textContent = '0:00';
  clearInterval(uhrTimer);
  uhrTimer = setInterval(() => {
    if (!aufnahme) return clearInterval(uhrTimer);
    const s = Math.round((Date.now() - t0) / 1000);
    $('#uhr').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 250);
}

function mikrofonText(art) {
  return art === 'mikrofon' ? 'Bitte das Mikrofon erlauben (Schloss-Symbol oben in der Adresszeile).' : 'Die Aufnahme geht auf diesem Handy gerade nicht.';
}

// grund = null: Live-Text läuft. Sonst: es wird stattdessen aufgenommen (ruhiger Hinweis im Textfeld).
function aufnahmeModus(grund) {
  const t = $('#live-titel'), h = $('#live-hinweis'), c = $('.cursor');
  if (t) t.textContent = grund ? 'Wird aufgenommen' : 'Wird mitgeschrieben';
  if (c) c.hidden = !!grund; // beim reinen Aufnehmen schreibt niemand mit: kein blinkender Cursor
  const hinweis = grund ? (HINWEIS_WECHSEL[grund] || HINWEIS_WECHSEL.standard) : '';
  // Bei unerwartetem Ausfall steht der technische Code klein darunter (hilft, wenn es auf einem Handy nicht klappt)
  const code = grund && !['aus', 'fehlt', 'netz', 'cloud'].includes(grund) ? grund : '';
  if (h) {
    h.textContent = hinweis;
    if (code) { const k = document.createElement('small'); k.textContent = 'Code: ' + code; h.appendChild(k); }
    h.hidden = !grund;
  } else if (hinweis) meldung(hinweis, 7000);
  const m = $('.mitschrift'); m.scrollTop = m.scrollHeight;
}

// Weder Live-Text noch Aufnahme geht (z. B. Mikrofon nicht erlaubt). Schon erkannter Text bleibt erhalten.
async function aufnahmeGescheitert(art) {
  const a = aufnahme; if (!a) return;
  if (a.textBisher()) { await aufnahmeBeenden(); meldung(mikrofonText(art), 6000); return; }
  a.abbrechen(); aufnahme = null; clearInterval(uhrTimer);
  meldung(mikrofonText(art), 6000);
  history.back();
}

async function aufnahmeBeenden() {
  if (!aufnahme) return;
  const a = aufnahme; aufnahme = null; clearInterval(uhrTimer);
  $('#b-fertig').disabled = true;
  let r;
  try { r = await a.beenden(); }
  catch (err) { console.error(err); r = { text: a.textBisher(), audio: null, dauer: 0, audioDauer: 0 }; } // erkannter Text geht nie verloren
  finally { $('#b-fertig').disabled = false; }
  // Wurde erst Text erkannt und dann umgeschaltet, steht der Rest nur in der Aufnahme: kurzer Hinweis im Text.
  const neu = r.teilweise ? (r.text + ' [Weiter in der Sprachnachricht]').trim() : r.text;
  entwurf.text = [entwurf.text.trim(), neu].filter(Boolean).join(' ');
  if (r.audio) {
    // Bei "Nochmal sprechen" kommt eine zweite Aufnahme dazu; die erste bleibt als Anhang erhalten.
    if (entwurf.audio) entwurf.anhaenge.push(new File([entwurf.audio], 'sprache-1.' + endung(entwurf.audio.type), { type: entwurf.audio.type }));
    entwurf.audio = r.audio; entwurf.audioDauer = r.audioDauer || r.dauer;
  } else if (!r.text && r.dauer >= 2) {
    meldung('Es wurde nichts erkannt. Bitte nochmal sprechen oder tippen.', 4500);
  }
  erkennungAnzeigen(null);
  zeigePruefen(true);
  if (a.cloud && r.audio) erkennungStarten(r.audio, r.audioDauer || r.dauer);   // der Text kommt gleich; das Textfeld bleibt solange bedienbar
}

// ---------- Cloud-Erkennung: Text zur Aufnahme ----------
const cloudAktiv = () => funktionAktiv(CLOUD) && !config.attrappe && !!geraet && geraet.status === 'frei' && !!window.MediaRecorder
  && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia && Date.now() >= cloudPauseBis;

async function erkennungStarten(audio, dauer) {
  letzteErkennung = { audio, dauer };
  const mein = entwurf;
  erkennungOffen++;
  erkennungAnzeigen({ art: 'laeuft' });
  let r;
  try { r = await erkennen({ kasten, token: geraet.token, audio, dauer }); }
  catch { r = { ok: false, code: 'dienst', grund: '' }; }
  erkennungOffen = Math.max(0, erkennungOffen - 1);
  if (r.ok) cloudPauseBis = 0;                                               // die Cloud antwortet wieder: keine Pause mehr nötig
  if (entwurf !== mein) { erkennungAnzeigen(null); return; }                // unterdessen gesendet oder neu begonnen: nichts mehr eintragen
  if (r.ok && r.text) {
    entwurf.text = textVerbinden(entwurf.text, r.text);                      // zum Vorhandenen dazu – was inzwischen getippt wurde, bleibt
    entwurfMerken(true);
    if (aktuell === 's-pruefen') $('#hof-text').value = entwurf.text;
    erkennungAnzeigen({ art: 'fertig' });
  } else if (r.ok) {
    erkennungAnzeigen({ art: 'leer' });
  } else {
    const pause = pauseMs(r.code);
    if (pause) cloudPauseBis = Date.now() + pause;                           // eine Weile wieder Live-Text, dann nochmal die Cloud versuchen
    erkennungAnzeigen({ art: 'fehler', code: r.code, grund: r.grund });
  }
}

// Zeigt unter dem Textfeld, was mit der Erkennung ist. null = nichts anzeigen. Solange eine Erkennung läuft, kann nicht gesendet werden
// (sonst ginge der Text verloren, der gleich kommt) – die Wartezeit ist begrenzt: jede Anfrage gibt nach 20 Sekunden auf, und es gibt höchstens zwei (zweite mit WAV, js/erkennung.js).
function erkennungAnzeigen(z) {
  const box = $('#erkennung'), text = $('#erkennung-text'), nochmal = $('#b-erkennung-nochmal'), grund = $('#erkennung-grund');
  $('#b-senden').disabled = erkennungOffen > 0;
  platzhalterSetzen();
  if (!box) return;
  if (!z) { box.hidden = true; box.removeAttribute('data-art'); return; }
  box.hidden = false; box.dataset.art = z.art;
  text.textContent = z.art === 'laeuft' ? HINWEIS_LAEUFT : z.art === 'fertig' ? HINWEIS_FERTIG : z.art === 'leer' ? HINWEIS_LEER : hinweisFuer(z.code);
  nochmal.hidden = !(z.art === 'fehler' && wiederholbar(z.code) && letzteErkennung);
  grund.textContent = z.art === 'fehler' && z.grund ? 'Code: ' + z.grund : '';
  grund.hidden = !grund.textContent;
}
$('#b-erkennung-nochmal').addEventListener('click', () => { if (letzteErkennung && !erkennungOffen) erkennungStarten(letzteErkennung.audio, letzteErkennung.dauer); });
$('#b-fertig').addEventListener('click', aufnahmeBeenden);
$('#b-abbrechen').addEventListener('click', () => { if (aufnahme) { aufnahme.abbrechen(); aufnahme = null; } history.back(); });

// ---------- Prüfen ----------
function zeigePruefen(ersetzen) {
  $('#hof-text').value = entwurf.text;
  entwurfMerken(true);
  const az = $('#audio-zeile');
  az.hidden = !entwurf.audio;
  $('#audio-label').textContent = 'Sprachaufnahme · ' + dauerText(entwurf.audioDauer) + ' · geht mit';
  platzhalterSetzen();
  zeichneAnhaenge();
  if (ersetzen) { history.replaceState({ s: 's-pruefen' }, ''); zeige('s-pruefen', { verlauf: false }); }
  else zeige('s-pruefen');
}
// Was es beim Prüfen gibt (bei jedem Öffnen des Bildschirms neu gesetzt). Auf einer Station ohne den Handgriff „sprechen“: kein Mikrofon, kein Anhang, kein Tippen –
// der Text kommt nur aus dem Scanner und lässt sich nicht ändern: prüfen, dann senden oder verwerfen. Überall sonst wie bisher.
function pruefenRechte() {
  const nurLesen = !freiErlaubt();
  $('#b-nochmal').hidden = nurLesen;
  $('#b-anhang-pruefen').hidden = nurLesen;
  $('#b-verwerfen').hidden = !nurLesen;
  $('#hof-text').readOnly = nurLesen;
  $('#pruef-hilfe').textContent = nurLesen ? 'Stimmt etwas nicht? Dann verwerfen und neu scannen.' : 'Tippe in den Text, um etwas zu ändern.';
}
// „Verwerfen“ gibt es nur dort, wo sich der Text nicht ändern lässt: der Entwurf ist weg, die Übersicht steht wieder da.
$('#b-verwerfen').addEventListener('click', async () => {
  if (freiErlaubt()) return;
  if (!confirm('Diese Nachricht verwerfen? Die gescannten Zeilen sind dann weg.')) return;
  entwurf = neuerEntwurf();
  clearTimeout(entwurfTimer);
  await einstellung.loesche('entwurf').catch(() => {});
  history.replaceState({ s: 's-uebersicht' }, '');
  zeige('s-uebersicht', { verlauf: false });
  meldung('Verworfen.');
});
// Was im leeren Textfeld steht: läuft gerade eine Erkennung, kommt der Text gleich; nur Aufnahme und kein Text (Live-Text ging nicht,
// Cloud-Erkennung ging nicht): der Laptop schreibt ab; sonst der gewohnte Satz.
function platzhalterSetzen() {
  $('#hof-text').placeholder = erkennungOffen > 0 ? 'Der Text kommt gleich – du kannst auch schon tippen.'
    : entwurf.audio && !entwurf.text.trim() ? 'Kein Text – der Laptop schreibt die Aufnahme ab. Du kannst auch selbst etwas tippen.'
    : 'Hier steht, was du gesagt hast.';
}
$('#hof-text').addEventListener('input', e => { entwurf.text = e.target.value; entwurfMerken(); });
$('#b-zurueck-pruefen').addEventListener('click', () => history.back());

let spieler;
$('#b-play').addEventListener('click', () => {
  if (!entwurf.audio) return;
  if (spieler && !spieler.paused) { spieler.pause(); return; }
  spieler = new Audio(URL.createObjectURL(entwurf.audio)); spieler.play().catch(() => {});
});
$('#b-audio-weg').addEventListener('click', () => { entwurf.audio = null; entwurf.audioDauer = 0; $('#audio-zeile').hidden = true; letzteErkennung = null; erkennungAnzeigen(null); entwurfMerken(); });

function zeichneAnhaenge() {
  const box = $('#anhaenge');
  box.querySelectorAll('.anhang').forEach(e => e.remove());
  const plus = $('#b-anhang-pruefen');
  entwurf.anhaenge.forEach((f, i) => {
    const d = document.createElement('div'); d.className = 'anhang';
    if (f.type.startsWith('image/')) {
      const img = document.createElement('img'); img.alt = 'Foto ' + (i + 1); img.src = URL.createObjectURL(f); d.appendChild(img);
    } else {
      d.innerHTML = f.type.startsWith('audio/')
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
      const n = document.createElement('span'); n.className = 'anhang-name'; n.textContent = f.name; d.appendChild(n);
    }
    const weg = document.createElement('button'); weg.type = 'button'; weg.className = 'weg'; weg.setAttribute('aria-label', 'Anhang entfernen');
    weg.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    weg.addEventListener('click', () => { entwurf.anhaenge.splice(i, 1); zeichneAnhaenge(); entwurfMerken(); });
    d.appendChild(weg);
    box.insertBefore(d, plus);
  });
}

// ---------- Anhänge ----------
function blattAuf() { if (freiErlaubt()) $('#blatt').hidden = false; }
function blattZu() { $('#blatt').hidden = true; }
$('#b-anhang').addEventListener('click', blattAuf);
$('#b-anhang-pruefen').addEventListener('click', blattAuf);
$('#b-blatt-zu').addEventListener('click', blattZu);
$('#b-blatt-abbrechen').addEventListener('click', blattZu);
$('#b-kamera').addEventListener('click', () => $('#in-kamera').click());

for (const id of ['#in-kamera', '#in-fotos', '#in-dokument']) {
  $(id).addEventListener('change', async e => {
    const dateien = [...e.target.files]; e.target.value = '';
    blattZu();
    if (!dateien.length || !freiErlaubt()) return;
    for (const f of dateien) entwurf.anhaenge.push(f.type.startsWith('image/') ? await fotoVerkleinern(f) : f);
    entwurfMerken(true);
    if (aktuell === 's-pruefen') zeichneAnhaenge(); else zeigePruefen(false);
  });
}

$('#f-schnell').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#schnell-text').value.trim();
  if (!t || !freiErlaubt()) return;                       // (eine Station ohne den Handgriff „sprechen“ schreibt keine freien Nachrichten)
  entwurf = { ...neuerEntwurf(), anhaenge: entwurf.anhaenge, text: [entwurf.text.trim(), t].filter(Boolean).join(' '), bereich: entwurf.bereich };
  $('#schnell-text').value = '';
  zeigePruefen(false);
});

// ---------- Senden ----------
$('#b-senden').addEventListener('click', async () => {
  if (erkennungOffen > 0) { meldung('Einen Moment – der Text wird noch erkannt.'); return; }
  entwurf.text = $('#hof-text').value.trim();
  if (!entwurf.text && !entwurf.audio && !entwurf.anhaenge.length) { meldung('Es gibt noch nichts zu senden.'); return; }
  const ziel = modus;                                   // das Ziel gilt ab hier für diese Nachricht – auch wenn später umgeschaltet wird
  const schluessel = schluesselFuer(config, ziel);      // der Schlüssel DIESES Ziels; fehlt er, geht nichts raus (nie der andere Schlüssel)
  if (!schluessel) { meldung(TEXTE.keinSchluessel[ziel], 6000); return; }
  const knopf = $('#b-senden'); knopf.disabled = true;
  try {
    const id = crypto.randomUUID();
    const erstellt = Date.now();
    const dateien = [];
    if (entwurf.audio) dateien.push({ name: 'sprache.' + endung(entwurf.audio.type), typ: entwurf.audio.type, art: 'sprache', daten: new Uint8Array(await entwurf.audio.arrayBuffer()) });
    for (const f of entwurf.anhaenge) {
      const art = f.type.startsWith('image/') ? 'foto' : f.type.startsWith('audio/') ? 'sprache' : 'dokument';
      dateien.push({ name: f.name, typ: f.type || 'application/octet-stream', art, daten: new Uint8Array(await f.arrayBuffer()) });
    }
    const bereich = kachelnAktiv() && istBereich(entwurf.bereich) ? { bereich: entwurf.bereich } : {};            // die gewählte Kachel (Funktion „kacheln“)
    const klar = await packen({ id, von: geraet.name, geraet: geraet.id, erstellt: new Date(erstellt).toISOString(), text: entwurf.text, sprachDauer: entwurf.audioDauer || 0, ziel, ...bereich }, dateien);
    const umschlag = await verschluesseln(klar, schluessel);
    const fotos = dateien.filter(d => d.art === 'foto').length;
    const doks = dateien.filter(d => d.art === 'dokument').length;
    await nachrichten.speichere({
      id, erstellt, status: 'wartet', ziel,
      vorschau: entwurf.text || (fotos ? 'Foto' : doks ? 'Dokument' : 'Sprachnachricht'),
      sprache: entwurf.audioDauer || 0, fotos, doks,
      umschlag: new Blob([umschlag], { type: 'application/octet-stream' }),
    });
    entwurf = neuerEntwurf();
    letzteErkennung = null; erkennungAnzeigen(null);
    clearTimeout(entwurfTimer);
    await einstellung.loesche('entwurf');
    $('#erfolg-titel').textContent = 'Wird gesendet …';
    $('#erfolg-text').textContent = ziel === TEST ? TEXTE.gesendetTest : 'Holt der Laptop sie ab, erscheinen zwei Haken.';
    $('.erfolg').classList.remove('offline');
    history.replaceState({ s: 's-gesendet' }, '');
    zeige('s-gesendet', { verlauf: false });
    const station = stationFrei();                          // Station (A055): statt „Gesendet“ steht gleich wieder die Übersicht da (zeige führt dorthin) – mit einer kurzen Meldung
    if (station) history.replaceState({ s: aktuell }, '');
    await postausgang();
    const n = await nachrichten.hole(id);
    if (n?.status === 'wartet') {
      $('#erfolg-titel').textContent = 'Gespeichert';
      $('#erfolg-text').textContent = 'Kein Netz – geht automatisch raus, sobald Empfang da ist.';
      $('.erfolg').classList.add('offline');
    } else {
      $('#erfolg-titel').textContent = 'Gesendet';
    }
    if (station) meldung(n?.status === 'wartet' ? 'Gespeichert. Kein Netz – geht automatisch raus, sobald Empfang da ist.' : 'Gesendet.', 5000);
  } catch (err) {
    console.error(err);
    meldung('Senden ging schief. Dein Text ist noch da.', 5000);
  } finally { knopf.disabled = false; }
});
$('#b-neu').addEventListener('click', () => { history.replaceState({ s: 's-start' }, ''); zeige('s-start', { verlauf: false }); });

let sendetGerade = false;
let testHinweisGezeigt = false;
async function postausgang() {
  if (sendetGerade || !geraet || geraet.status !== 'frei') return;
  sendetGerade = true;
  try {
    const offen = (await nachrichten.alle()).filter(n => n.status === 'wartet').reverse();
    for (const n of offen) {
      const ziel = zielVon(n);                // jede Nachricht geht an das Ziel, für das sie verschlüsselt wurde
      try {
        await kasten.senden(geraet.token, n.id, n.umschlag, ziel);
        await nachrichten.aendere(n.id, { status: 'gesendet', umschlag: null, gesendet: Date.now() });
      } catch (err) {
        const code = err instanceof BriefkastenFehler ? err.code : '';
        if (testBlockiert(ziel, code)) {      // der Test ist (noch) nicht bereit: nur diese Test-Nachricht bleibt liegen, die anderen gehen weiter
          if (!testHinweisGezeigt) { testHinweisGezeigt = true; meldung(TEXTE.testNichtBereit, 6000); }
          continue;
        }
        if (code === 'nicht_frei' || code === 'unbekannt') {
          meldung('Dieses Handy darf gerade nicht senden. Sprich mit Niklas.', 6000);
        }
        break; // später nochmal
      }
    }
  } finally { sendetGerade = false; zeichneListen(); }
}

async function quittungenHolen() {
  if (!geraet || geraet.status !== 'frei' || !navigator.onLine) return;
  const ids = (await nachrichten.alle()).filter(n => n.status === 'gesendet').map(n => n.id);
  if (!ids.length) return;
  try {
    const r = await kasten.quittungen(geraet.token, ids);
    for (const id of r.abgeholt || []) await nachrichten.aendere(id, { status: 'abgeholt' });
    if (r.abgeholt?.length) zeichneListen();
  } catch { /* später */ }
}

async function freigabenPunkt() {
  if (geraet?.rolle !== 'admin') return;
  try {
    const r = await kasten.verwaltung(geraet.token);
    $('#freigaben-punkt').hidden = !r.geraete.some(g => g.status === 'wartet');
  } catch { /* egal */ }
}

let hintergrundLaeuft = false;
function hintergrund() {
  $('#b-freigaben').hidden = geraet?.rolle !== 'admin';
  postAnzeigen();
  if (hintergrundLaeuft) return;
  hintergrundLaeuft = true;
  aufraeumen().catch(() => {});
  const runde = () => { if (document.visibilityState === 'visible') { postausgang(); quittungenHolen(); freigabenPunkt(); postHolen(); } };
  runde();
  setInterval(runde, 30000);                 // alle 30 Sekunden (und sofort, wenn die App wieder sichtbar wird)
  document.addEventListener('visibilitychange', runde);
  // Station (A055): Ihre Übersicht ist immer offen. Wird das Gerät wieder aufgeweckt, fragt sie wie beim Öffnen von selbst – aber nur, wenn ihr Stand älter als 5 Minuten ist.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && stationFrei() && aktuell === 's-uebersicht') uebersichtAuto('reiter'); });
}

// ---------- Listen ----------
// Der Verlauf zeigt nur die Nachrichten des Modus, in dem man gerade ist: Echt nur Echt-Nachrichten, Test nur Test-Nachrichten – auch das, was
// noch auf Netz wartet. Was zum anderen Modus gehört, ist nicht weg: eine kleine Zeile sagt, wie viele es sind und wo sie stehen.
// Jeder Eintrag hat eine Zeile (zu langer Text endet mit „…“), es sind höchstens 3 – so schiebt der Verlauf das Mikrofon nie aus dem Bild.
const VERLAUF_MAX = 3;
let listenLauf = 0;
async function zeichneListen() {
  const mein = ++listenLauf;
  const alle = (await nachrichten.alle()).filter(n => n.art !== 'antwort');     // Antworten auf Rückfragen stehen in der Post, nicht hier
  if (mein !== listenLauf) return;                                               // unterdessen wurde neu gezeichnet (z. B. den Schalter umgelegt)
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const jetzt = modus;                                                           // erst nach dem Warten lesen: der Schalter kann unterdessen umgelegt worden sein
  verlaufZeigen($('#liste-start'), $('#hinweis-start'), alle, jetzt);
  verlaufZeigen($('#liste-gesendet'), $('#hinweis-gesendet'), alle.filter(n => n.erstellt >= heute.getTime() || n.status === 'wartet'), jetzt);
}

function verlaufZeigen(box, hinweis, liste, jetzt) {
  fuelle(box, liste.filter(n => zielVon(n) === jetzt).slice(0, VERLAUF_MAX));
  const andere = liste.filter(n => zielVon(n) !== jetzt).length;
  const text = andere && testSchalterDa() ? andereText(andere, jetzt) : '';   // wer nicht umschalten darf, hat dort auch nichts
  hinweis.textContent = text; hinweis.hidden = !text;
  hinweis.parentElement.classList.toggle('mit-hinweis', !!text);          // styles.css: mit der Zeile braucht der Verlauf etwas mehr Platz
}
const andereText = (n, jetzt) => jetzt === TEST
  ? (n === 1 ? '1 echte Nachricht' : n + ' echte Nachrichten') + ' – unter Echt'
  : (n === 1 ? '1 Test-Nachricht' : n + ' Test-Nachrichten') + ' – unter Test';

function fuelle(box, liste) {
  box.replaceChildren();
  if (!liste.length) { const l = document.createElement('div'); l.className = 'leer'; l.textContent = 'Noch nichts gesendet.'; box.appendChild(l); return; }
  for (const n of liste) {
    const ziel = zielVon(n);
    const e = document.createElement('div'); e.className = 'eintrag' + (ziel === TEST ? ' test' : ''); e.dataset.id = n.id; e.dataset.status = n.status; e.dataset.ziel = ziel;
    const t = document.createElement('span'); t.className = 'eintrag-text'; t.textContent = n.vorschau; e.appendChild(t);
    // Was mitging, als kleine Zeichen (der Eintrag hat nur eine Zeile)
    if (n.sprache) e.appendChild(mini('sprache', '', 'Sprachnachricht ' + dauerText(n.sprache)));
    if (n.fotos) e.appendChild(mini('foto', n.fotos > 1 ? String(n.fotos) : '', n.fotos === 1 ? '1 Foto' : n.fotos + ' Fotos'));
    if (n.doks) e.appendChild(mini('dok', n.doks > 1 ? String(n.doks) : '', n.doks === 1 ? '1 Dokument' : n.doks + ' Dokumente'));
    const z = document.createElement('span'); z.className = 'zeit';
    const st = document.createElement('span'); st.className = 'st st-' + n.status; st.setAttribute('role', 'img');
    st.setAttribute('aria-label', { wartet: 'Wartet auf Netz', gesendet: 'Gesendet', abgeholt: 'Im BetriebsBrain angekommen' }[n.status]);
    if (n.status === 'wartet') { z.classList.add('wartet'); z.append('wartet auf Netz', st); }
    else z.append(zeitText(n.erstellt), st);
    e.appendChild(z);
    const q = quittungZeile(n, ziel);
    if (q) { e.classList.add('mit-quittung'); e.appendChild(q); }
    const karte = karteZeile(n, ziel);
    if (karte) { e.classList.add('mit-karte'); e.appendChild(karte); }
    box.appendChild(e);
  }
  funktionenAnwenden(box, funktionen, modus);                              // die Quittung trägt data-funktion: im Test als „noch nicht freigegeben“ markiert
}
// Unter der gesendeten Nachricht: was der Laptop daraus gemacht hat („Angekommen · gebucht: Wareneingang“). Nur auf Verwalter-Handys, nur wenn die
// Funktion „quittung“ gilt, nur wenn eine Quittung für genau diese Nachricht (und dieses Ziel) da ist. Der Satz kommt vom Laptop und steht nur als Text da.
function quittungZeile(n, ziel) {
  if (!postAktiv() || !funktionAktiv('quittung')) return null;
  const satz = quittungFuer(postStand, ziel, n.id);
  if (!satz) return null;
  const q = document.createElement('span'); q.className = 'eintrag-quittung'; q.dataset.funktion = 'quittung'; q.textContent = satz;
  return q;
}
// Unter der Quittung: die Karte „Bestätigen?“ (Funktion „bestaetigung“) – was der Laptop verstanden hat, mit „Stimmt“ und „Falsch“. Nur auf Verwalter-Handys, nur für diese Nachricht und dieses Ziel.
function karteZeile(n, ziel) {
  if (!postAktiv() || !funktionAktiv('rueckfragen') || !funktionAktiv('bestaetigung')) return null;
  const b = bestaetigungFuer(postStand, ziel, n.id);
  return b ? zeichneKarte(b, karteAntworten) : null;
}
// „Stimmt“ / „Falsch“: eine kleine beglaubigte Antwort in die Warteschlange legen (geht auch ohne Netz raus). Die erste Antwort gilt; danach sind die Knöpfe weg.
async function karteAntworten(eintrag, wahl) {
  const key = schluesselVon(eintrag.instanz, eintrag.bezug);
  const aktuell = postStand.bestaetigungen[key];
  if (!aktuell || aktuell.kopf.stand !== 'offen' || aktuell.meine || aktuell.kopf.id !== eintrag.kopf.id) { zeichneListen(); return true; }
  if (!schluesselFuer(config, aktuell.instanz)) { meldung(TEXTE.keinSchluessel[aktuell.instanz], 6000); return false; }
  const privatKey = await privaterSchluessel();
  if (!privatKey) { meldung('Dieses Handy kann gerade nicht antworten (Schlüssel fehlt). Bitte Claude Bescheid geben.', 6000); return false; }
  try {
    const r = await bestaetigungAntwortBauen({ eintrag: aktuell, wahl, geraet, config, privatKey });
    await nachrichten.speichere({
      id: r.id, erstellt: Date.now(), status: 'wartet', ziel: r.instanz, art: 'antwort', frage: key,
      vorschau: 'Antwort: ' + WAHL_TEXT[wahl], sprache: 0, fotos: 0, doks: 0,
      umschlag: new Blob([r.umschlag], { type: 'application/octet-stream' }),
    });
    const jetzt = postStand.bestaetigungen[key];                // unterdessen kann eine neue Fassung gekommen sein: dann gilt die Antwort nicht dafür
    if (jetzt && jetzt.kopf.fassung === aktuell.kopf.fassung && jetzt.kopf.stand === 'offen') jetzt.meine = r.meine;
    await postSpeichern(postStand);
    zeichneListen();
    await postausgang();
    return true;
  } catch (err) {
    console.error(err);
    meldung('Die Antwort ging nicht. Bitte nochmal versuchen.', 5000);
    return false;
  }
}
// Neue Karten, die noch nicht angekündigt wurden: kurz oben eingeblendet (antippen: zur Karte)
async function karteAnkuendigen() {
  if (!postAktiv() || !funktionAktiv('bestaetigung')) return;
  let neu = null;
  for (const b of Object.values(postStand.bestaetigungen || {})) {
    if (b.neu && b.instanz === modus) { if (b.kopf.stand === 'offen' && !b.meine) neu = b; b.neu = false; }
    else if (b.neu) b.neu = false;
  }
  await postSpeichern(postStand);
  if (neu) einblendung(einblendungText(neu), 6000);
}
let einblendungTimer;
function einblendung(text, ms) {
  const m = $('#einblendung'); if (!m) return;
  m.textContent = text; m.hidden = false;
  clearTimeout(einblendungTimer); einblendungTimer = setTimeout(() => { m.hidden = true; }, ms);
}
$('#einblendung').addEventListener('click', () => { $('#einblendung').hidden = true; if (geraet?.status === 'frei') zeige('s-gesendet'); });
const MINI_ZEICHEN = {
  sprache: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  foto: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  dok: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
};
function mini(art, zahl, beschreibung) {
  const m = document.createElement('span'); m.className = 'mini'; m.setAttribute('role', 'img'); m.setAttribute('aria-label', beschreibung); m.title = beschreibung;
  m.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + MINI_ZEICHEN[art] + '</svg>';        // nur feste Zeichen, nie Text von außen
  if (zahl) m.append(zahl);
  return m;
}

// ---------- Freigaben (nur Niklas) ----------
$('#b-freigaben').addEventListener('click', () => zeige('s-freigaben'));
$('#b-zurueck-freigaben').addEventListener('click', () => history.back());

async function ladeFreigaben() {
  let r;
  try { r = await kasten.verwaltung(geraet.token); }
  catch { meldung('Freigaben brauchen Netz.'); return; }
  const wartende = $('#wartende'); wartende.replaceChildren();
  for (const g of r.geraete.filter(g => g.status === 'wartet')) {
    const k = document.createElement('div'); k.className = 'wartet-karte';
    k.innerHTML = '<span class="ueberschrift">Wartet auf Freigabe</span><div><b></b><div class="klein"></div></div><div class="zwei"><button type="button" class="knopf haupt">Freigeben</button><button type="button" class="knopf neben">Ablehnen</button></div>';
    k.querySelector('b').textContent = g.name;
    k.querySelector('.klein').textContent = (g.rolle === 'station' ? 'Station · ' : '') + 'Code ' + g.code + ' · ' + zeitText(g.seit);      // bei einer Station (A055) steht es dabei
    const [ja, nein] = k.querySelectorAll('button');
    ja.addEventListener('click', async () => { await aktion(() => kasten.freigeben(geraet.token, g.id, true)); });
    nein.addEventListener('click', async () => { await aktion(() => kasten.freigeben(geraet.token, g.id, false)); });
    wartende.appendChild(k);
  }
  const box = $('#mitglieder'); box.replaceChildren();
  for (const g of r.geraete.filter(g => g.status === 'frei')) {
    const m = document.createElement('div'); m.className = 'mitglied';
    const s = document.createElement('span');
    const b = document.createElement('b'); b.textContent = g.name;
    const k = document.createElement('span'); k.className = 'klein';
    const du = g.id === geraet.id;
    k.textContent = du ? 'Du · verwaltet die Freigaben' : (g.rolle === 'station' ? 'Station · ' : '') + 'frei seit ' + new Date(g.seit).toLocaleDateString('de-DE');
    if (g.rolle === 'station') m.dataset.rolle = 'station';
    s.append(b, k); m.appendChild(s);
    if (!du) {
      const sp = document.createElement('button'); sp.type = 'button'; sp.className = 'knopf neben klein'; sp.textContent = 'Sperren';
      sp.addEventListener('click', async () => { if (confirm(g.name + ' sperren? Das Handy kann dann nichts mehr senden.')) await aktion(() => kasten.sperren(geraet.token, g.id)); });
      m.appendChild(sp);
    }
    box.appendChild(m);
  }
  $('#freigaben-punkt').hidden = !r.geraete.some(g => g.status === 'wartet');
}
async function aktion(fn) {
  try { await fn(); await ladeFreigaben(); } catch { meldung('Das ging nicht. Hast du Netz?'); }
}

// Einladen: ein Mitglied (wie bisher) oder eine Station (A055). Was eine Station sieht und darf, stellt Niklas danach am Laptop ein (Zentrale → Geräte).
// Kennt der Briefkasten noch keine Stationen, käme ein Code für ein Mitglied zurück (ohne die Angabe „station“): der wird nie als Stations-Code gezeigt.
async function einladungZeigen(rolle) {
  try {
    const r = await kasten.einladen(geraet.token, rolle);
    if (rolle === 'station' && r.rolle !== 'station') { meldung('Der Briefkasten kann noch keine Station einladen. Bitte Claude Bescheid geben.', 6000); return; }
    $('#einladung-code').textContent = r.code;
    $('#einladung-art').textContent = (rolle === 'station' ? 'Für eine Station · ' : '') + '7 Tage gültig · nur einmal nutzbar';
    $('#einladung').hidden = false;
  } catch { meldung('Neuer Code braucht Netz.'); }
}
$('#b-code-neu').addEventListener('click', () => einladungZeigen('mitglied'));
$('#b-code-station').addEventListener('click', () => einladungZeigen('station'));
$('#b-teilen').addEventListener('click', async () => {
  const code = $('#einladung-code').textContent;
  const text = 'Hof-App: ' + location.origin + location.pathname + '\nÖffnen, dann „Zum Startbildschirm hinzufügen“. Einladungscode: ' + code;
  if (navigator.share) { try { await navigator.share({ title: 'Hof-App', text }); } catch {} }
  else { try { await navigator.clipboard.writeText(text); meldung('Kopiert – jetzt z. B. in WhatsApp einfügen.'); } catch { meldung(code); } }
});

// ---------- Post (Knöpfe) ----------
$('#b-post').addEventListener('click', () => zeige('s-post'));
$('#b-post-zeichen').addEventListener('click', () => zeige('s-post'));
$('#b-zurueck-post').addEventListener('click', () => history.back());
$('#b-post-neu').addEventListener('click', () => { postNichtBereitBis = 0; postHolen(); });

// ---------- Echt | Test ----------
// Der Schalter steht auf dem Startbildschirm (nur für Geräte, die ihn sehen dürfen); im Test-Modus liegt ein oranges Band über jedem
// Bildschirm, und der Sendeknopf ist orange. Der Modus bleibt auf diesem Gerät gemerkt (Standard: Echt).
// A038: den Schalter gibt es nur in der Testebene (localhost), nie auf der echten Adresse (js/modus.js)
const testSchalterDa = () => !istStation() && testSchalterErlaubt(config, geraet, location.hostname);      // eine Station (A055) hat ihn nie: sie sendet nur an Echt
function modusSetzen(neu, { merken = true } = {}) {
  modus = testSchalterDa() ? normModus(neu) : ECHT;            // ohne Schalter (die echte Adresse) gilt immer Echt – auch bei einem alten Merker
  if (merken && testSchalterDa()) schreibModus(modus);
  modusAnzeigen();
}
function modusAnzeigen() {
  const test = modus === TEST;
  document.body.classList.toggle('ist-test', test);
  $('#test-banner').hidden = !test;
  $('#modus-schalter').hidden = !testSchalterDa();
  document.body.classList.toggle('mit-schalter', testSchalterDa());       // styles.css: so viel Platz nimmt der Startbildschirm für das Mikrofon ab
  $('#m-echt').setAttribute('aria-pressed', String(!test));
  $('#m-test').setAttribute('aria-pressed', String(test));
  $('#b-senden').classList.toggle('test', test);
  $('#senden-text').textContent = test ? TEXTE.sendenTest : TEXTE.senden;
  document.title = test ? 'Hof-App (TEST)' : 'Hof-App';
  bandHoehe();
  funktionenAnzeigen();
  startHinweis();
  postAnzeigen();
  zeichneListen();                                            // der Verlauf zeigt nur Nachrichten des gewählten Modus
}
// Wie hoch das orange Band gerade ist (sein Text bricht auf schmalen Handys um): so viel weniger Platz hat der Bildschirm darunter (styles.css: --band).
function bandHoehe() {
  const b = $('#test-banner');
  document.documentElement.style.setProperty('--band', (b && !b.hidden ? Math.ceil(b.getBoundingClientRect().height) : 0) + 'px');
}
addEventListener('resize', bandHoehe);
$('#m-echt').addEventListener('click', () => { modusSetzen(ECHT); postHolen(); });
$('#m-test').addEventListener('click', () => {
  modusSetzen(TEST);
  if (modus === TEST && !schluesselFuer(config, TEST)) meldung(TEXTE.keinSchluessel.test, 6000);
  postHolen();
});
$('#b-zu-echt').addEventListener('click', () => { modusSetzen(ECHT); postHolen(); });

// ---------- Neue Funktionen (erst nur im Test) ----------
// funktionen.json sagt je Funktion "test" oder "alle" (js/funktionen.js). Wer die Datei nicht holen kann, behält den bisherigen Stand;
// ohne Stand gilt überall "test": im echten Betrieb erscheint dann nichts Neues.
function funktionAktiv(name) { return funktionSichtbar(funktionen, name, modus); }
function funktionenAnzeigen() {
  funktionenAnwenden(document, funktionen, modus);
  bereichAnzeigen();
  navAnzeigen();
  if (aktuell === 's-uebersicht' || aktuell === 's-bestellung' || aktuell === 's-bereich' || aktuell === 's-scan') { const ziel = document.getElementById(aktuell); if (ziel && !funktionAktiv(ziel.dataset.funktion)) zeige('s-start'); }
  if (ANZEIGE && geraet?.status === 'frei' && aktuell !== anzeigeZiel()) zeige(anzeigeZiel(), { verlauf: false });
  if (!ANZEIGE && stationFrei()) {                                        // Station: gilt die Übersicht (wieder), steht sie da; ihre Knöpfe richten sich auch nach den Funktionen (Scanner)
    if (aktuell === 's-anzeige-aus' && funktionAktiv('uebersicht')) zeige('s-uebersicht', { verlauf: false });
    else if (aktuell === 's-uebersicht') uebersichtZeichnen();
  }
}
let funktionenGeladen = 0;
async function funktionenLaden() {
  funktionenGeladen = Date.now();
  const neu = await ladeFunktionen();
  if (neu) { funktionen = neu; funktionenAnzeigen(); startHinweis(); postAnzeigen(); postHolen(); zeichneListen(); }
}
// Wer die App lange offen hat, bekommt eine neue Freigabe spätestens nach 10 Minuten (beim Zurückkehren in die App).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - funktionenGeladen > 10 * 60 * 1000) funktionenLaden();
});

// ---------- Post: Rückfragen vom Laptop ----------
// Der Laptop schickt offene Rückfragen verschlüsselt und beglaubigt an die Verwalter-Handys (nur wer dafür freigegeben ist, siehe funktionen.json:
// „rueckfragen“; die Änderungsliste des Hof-Dienstes erst mit „aenderungen“). Hier werden sie geholt (js/post.js), angezeigt (js/post-ansicht.js) und
// beantwortet: Die Antwort geht als beglaubigte Nachricht durch die normale Warteschlange an den Laptop. Die erste Antwort gilt – egal ob sie hier,
// in der Zentrale oder am Laptop kam; was der Laptop meldet, zeigt dieses Handy an.
let postStand = neuerStand();
let postLaeuft = false;
let postFehler = '';                 // '' | 'netz' | 'nicht_bereit' | 'fehler'
let postNichtBereitBis = 0;
let postZuletzt = 0;
let postZeichnung = '';              // woran erkannt wird, ob sich die Anzeige ändern muss (damit angefangene Eingaben nicht verloren gehen)
const postEntwuerfe = new Map();

const postAktiv = () => !!geraet && geraet.status === 'frei' && geraet.rolle === 'admin' && funktionAktiv('rueckfragen');
// Eine Station (A055) holt auf demselben Weg nur den Stand der Übersicht (und fragt ihn an wie ein Verwalter-Handy): keine Rückfragen, kein „Für dich“, keine Quittungen, keine Karten.
const stationAktiv = () => stationFrei() && funktionAktiv('rueckfragen');
const holenAktiv = () => postAktiv() || stationAktiv();
const aenderungenAktiv = () => funktionAktiv('aenderungen');
const dingeAktiv = () => funktionAktiv('fuer_dich');

async function postLaden() { try { postStand = normStand(await einstellung.hole(STAND_NAME)); } catch { postStand = neuerStand(); } }
async function postSpeichern(stand) { try { await einstellung.setze(STAND_NAME, stand); } catch { /* beim nächsten Mal */ } }
async function privaterSchluessel() {
  try { const paar = await einstellung.hole('geraete-schluessel'); return paar && paar.privateKey ? paar.privateKey : null; } catch { return null; }
}

async function postHolen() {
  if (postLaeuft || !holenAktiv() || !navigator.onLine || Date.now() < postNichtBereitBis) return;
  const privatKey = await privaterSchluessel();
  if (!privatKey) return;
  postLaeuft = true;
  try {
    const r = await postHolenLogik({
      kasten, geraet, config, privatKey, stand: postStand, speichern: postSpeichern, test: modus === TEST,
      arten: stationFrei() ? ['uebersicht', 'uebersicht_grund'] : null,                             // eine Station nimmt nur die Übersicht an
      dateiSpeichern: (key, bytes) => einstellung.setze(dateiSchluessel(key), bytes),           // das PDF eines „Für dich“-Eintrags
      dateiLoeschen: key => einstellung.loesche(dateiSchluessel(key)),
    });
    if (r.schluesselFehlt) {                                   // dieses Handy hat dem Briefkasten noch keinen öffentlichen Schlüssel gegeben: nachtragen
      const oeff = await geraeteSchluessel();
      if (oeff) await kasten.schluesselSetzen(geraet.token, oeff, modus === TEST).catch(() => {});
    }
    postFehler = ''; postZuletzt = Date.now();
    if (r.quittungen || r.bestaetigungen) zeichneListen();     // neue Quittungen und Karten stehen unter den gesendeten Nachrichten
    if (r.bestaetigungen) karteAnkuendigen();
    if (r.uebersicht) { if (!ueFragt) ueStatus = ''; if (aktuell === 's-uebersicht') uebersichtZeichnen(); }
  } catch (err) {
    const code = err instanceof BriefkastenFehler ? err.code : '';
    if (code === 'aktion') { postFehler = 'nicht_bereit'; postNichtBereitBis = Date.now() + 10 * 60 * 1000; }      // der Briefkasten kennt das noch nicht
    else if (code === 'netz') postFehler = 'netz';
    else if (code === 'bremse') postNichtBereitBis = Date.now() + 60 * 1000;
    else postFehler = 'fehler';
  } finally { postLaeuft = false; postAnzeigen(); }
}

function postAnzeigen() {
  const warten = sichtbareFragen(postStand, modus, aenderungenAktiv()).filter(f => !(f.meine && f.meine.stand === f.kopf.stand)).length;
  const dinge = sichtbareDinge(postStand, modus, dingeAktiv()).length;
  const zaehler = $('#post-zaehler');
  zaehler.textContent = String(warten + dinge); zaehler.hidden = !(warten + dinge);
  const teile = [];
  if (warten) teile.push(warten === 1 ? '1 Frage wartet auf dich' : warten + ' Fragen warten auf dich');
  if (dinge) teile.push(dinge === 1 ? '1 Sache für dich' : dinge + ' Sachen für dich');
  $('#post-untertitel').textContent = teile.length ? teile.join(' · ') : 'Keine offenen Fragen';
  const verwalter = geraet?.rolle === 'admin';
  $('#b-post').hidden = !verwalter || !(warten + dinge);                // die Karte nur, wenn etwas wartet …
  $('#b-post-zeichen').hidden = !verwalter || !!(warten + dinge);        // … sonst das kleine Zeichen oben neben dem Personen-Symbol
  $('#b-uebersicht').hidden = !verwalter;                                // Übersicht neben dem Mikrofon: nur ohne Leiste (mit Leiste blendet styles.css sie aus; ohne Funktion „uebersicht“ ebenso)
  navAnzeigen();                                                         // Leiste: Eintrag „Post“ und die Zahl der offenen Fragen
  if (aktuell === 's-post') postZeichnen();
}

async function postZeichnen(erzwingen = false) {
  const status = new Map();
  try { for (const n of await nachrichten.alle()) if (n.art === 'antwort') status.set(n.id, n.status); } catch { /* ohne Status */ }
  const zeigen = sichtbareFragen(postStand, modus, aenderungenAktiv());
  const ctx = {
    stand: postStand, modus, aenderungenAktiv: aenderungenAktiv(), dingeAktiv: dingeAktiv(), entwuerfe: postEntwuerfe, status, beiAntwort: postAntworten, beiDing: postDing,
    zeit: iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : zeitText(d.getTime()); },
    hinweis: postFehler === 'nicht_bereit' ? (modus === TEST ? 'Der Test-Briefkasten kann das noch nicht. Bitte Claude Bescheid geben.' : 'Der Briefkasten kann das noch nicht.')
      : postFehler === 'netz' ? 'Kein Netz – die Liste ist vom letzten Mal.' : postFehler === 'fehler' ? 'Das Aktualisieren hat nicht geklappt. Gleich noch ein Versuch.' : '',
    echtOffen: modus === TEST ? sichtbareFragen(postStand, ECHT, aenderungenAktiv()).length : 0,
    zuletzt: postZuletzt ? 'Zuletzt aktualisiert: ' + zeitText(postZuletzt) : '',
  };
  const signatur = JSON.stringify([modus, ctx.aenderungenAktiv, ctx.dingeAktiv, ctx.hinweis, ctx.echtOffen, [...status],
    zeigen.map(f => [f.instanz, f.id, f.kopf.stand, f.meine && f.meine.id]),
    sichtbareDinge(postStand, modus, ctx.dingeAktiv).map(d => [d.instanz, d.id, d.kopf]),                      // der ganze Kopf: zwei Fassungen in derselben Sekunde unterscheiden sich nur im Inhalt
    postErledigte(postStand, modus).map(f => [f.instanz, f.id, f.zustand, f.erledigt.antwort, f.erledigt.gesehen, f.meine && f.meine.id])]);
  if (!erzwingen && signatur === postZeichnung) { $('#post-stand').textContent = ctx.zuletzt; return; }
  postZeichnung = signatur;
  zeichnePost($('#s-post'), ctx);
}

// „Für dich“: das PDF öffnen oder den Eintrag mit „Erledigt“ wegräumen (auch das PDF auf dem Handy). Auf dem Laptop bleibt alles, wie es ist.
async function postDing(aktion, d) {
  const key = schluesselVon(d.instanz, d.id);
  if (aktion === 'oeffnen') {
    let bytes = null;
    try { bytes = await einstellung.hole(dateiSchluessel(key)); } catch { bytes = null; }
    if (!bytes || !bytes.length) { meldung('Das PDF ist auf diesem Handy nicht mehr da. Es liegt am Laptop.', 6000); return; }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (!window.open(url, '_blank')) {                          // Popup gesperrt (oder eine App ohne Tabs): als Datei anbieten
      const a = document.createElement('a');
      a.href = url; a.download = (d.kopf.datei && d.kopf.datei.name) || 'dokument.pdf';
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    return;
  }
  if (aktion === 'erledigt') {
    delete postStand.dinge[key];
    try { await einstellung.loesche(dateiSchluessel(key)); } catch { /* bleibt höchstens liegen */ }
    await postSpeichern(postStand);
    postAnzeigen();
    postZeichnen(true);
  }
}

// Eine Antwort bauen (beglaubigt, nur für den Laptop dieser Instanz verschlüsselt) und in die Warteschlange legen.
async function postAntworten(f, antwort) {
  const key = schluesselVon(f.instanz, f.id);
  if (!schluesselFuer(config, f.instanz)) { meldung(TEXTE.keinSchluessel[f.instanz], 6000); return false; }
  const privatKey = await privaterSchluessel();
  if (!privatKey) { meldung('Dieses Handy kann gerade nicht antworten (Schlüssel fehlt). Bitte Claude Bescheid geben.', 6000); return false; }
  try {
    const r = await antwortBauen({ frage: f, antwort, geraet, config, privatKey });
    await nachrichten.speichere({
      id: r.id, erstellt: Date.now(), status: 'wartet', ziel: r.instanz, art: 'antwort', frage: key,
      vorschau: 'Antwort: ' + r.meine.text, sprache: 0, fotos: 0, doks: 0,
      umschlag: new Blob([r.umschlag], { type: 'application/octet-stream' }),
    });
    const jetzt = postStand.fragen[key];                        // die Rückfrage kann sich unterdessen geändert haben (neue Fassung): dann gilt die Antwort nicht mehr dafür
    if (jetzt && jetzt.kopf && jetzt.kopf.stand === f.kopf.stand) jetzt.meine = r.meine;
    await postSpeichern(postStand);
    postEntwuerfe.delete(key);
    postAnzeigen();
    await postausgang();
    postZeichnen(true);
    return true;
  } catch (err) {
    console.error(err);
    meldung('Die Antwort ging nicht. Bitte nochmal versuchen.', 5000);
    return false;
  }
}

// ---------- Übersicht (Funktion „uebersicht“) ----------
// Der Laptop schickt den Stand nur auf Anfrage: „Aktualisieren“ sendet eine kleine beglaubigte Anfrage, der Laptop baut den Stand aus seinen Quellen und
// schickt ihn zurück (meist nach wenigen Sekunden). Der zuletzt bekannte Stand bleibt im Handy und ist auch ohne Netz da. Es gibt keine ständige Abfrage.
let ueReiter = 'lager';                // im Anzeige-Modus bleibt es dabei
let ueSuche = '';
let ueHofWahl = '';                // das angetippte Gebäude im Reiter „Hof“ (leer = die Kacheln)
let ueStatus = '';                 // Satz zum letzten Fragen (leer = alles gut)
let ueFragt = false;
// A040: Die Übersicht holt selbst. Beim Öffnen fragt die App den Laptop von selbst (nicht öfter als alle 15 Sekunden; der Laptop bremst ohnehin je Handy), beim Wechsel auf einen
// Reiter nur, wenn der Stand älter als 5 Minuten ist. „Aktualisieren“ bleibt. Kommt nach 60 Sekunden nichts, sagt die App es; kann der Laptop nicht bauen, schickt er den Grund.
const UE_WARTEN_MS = 60000;
const UE_ALT_MS = 5 * 60 * 1000;
const UE_ABSTAND_MS = 15000;
let ueLetzteFrage = 0;
let bestellWahl = null;            // die angetippte Bestellung (Einzelheiten vom Laptop) – die Karte „Bestellung“
const BAU_CODES = ['fehlt', 'zeit', 'fehler', 'format'];          // bei diesen Gründen hat der Laptop gebaut und es ging schief: der Satz bekommt einen Vorspann
// Wie alt der Stand ist, zählt ab dem Moment, in dem DIESES Handy ihn bekommen hat (nicht nach der Uhr des Laptops: die Uhren beider Geräte müssen nicht übereinstimmen).
const standAlter = () => { const u = postStand && postStand.uebersicht ? postStand.uebersicht[normModus(modus)] : null; return u && Number.isFinite(u.gesehen) ? Date.now() - u.gesehen : Infinity; };
function uebersichtAuto(wann) {
  if (wann === 'zurueck' || ANZEIGE || ueFragt || !geraet || geraet.status !== 'frei' || !holenAktiv() || !funktionAktiv('uebersicht')) return;
  if (Date.now() - ueLetzteFrage < UE_ABSTAND_MS) return;
  if (wann === 'reiter' && standAlter() < UE_ALT_MS) return;
  uebersichtAktualisieren();
}
function bestellungOeffnen(d) { bestellWahl = d; zeige('s-bestellung'); }
function bestellungZeichnen() { zeichneBestellung($('#bestellung-inhalt'), bestellWahl); }
// Station (A055): die Knöpfe ihrer Handgriffe über den Reitern. sicht = ihr Profil (oder null: keine Station – dann steht keiner da). Ein Scanner-Knopf steht nur da,
// wenn es den Scanner überhaupt gibt (funktionen.json); „Sprechen“, „Schreiben“ und „Foto, Anhang“ gehören zum Handgriff „sprechen“.
function stationKnoepfe(sicht) {
  let einer = false;
  for (const b of $$('#st-griffe .st-griff')) {
    const griff = b.dataset.griff;
    const da = !!sicht && sicht.handgriffe.includes(griff) && (griff === 'sprechen' || scannerAktiv());
    b.hidden = !da;
    einer = einer || da;
  }
  $('#st-griffe').hidden = !einer;
}
const STATION_OHNE_REITER = 'Zum Ansehen ist für dieses Gerät nichts eingestellt.';
const STATION_HOF_FEHLT = 'Die Hof-Karte ist noch nicht da. Tippe oben auf „Aktualisieren“.';      // das Profil nennt nur den Reiter „Hof“ – und der kommt (wie auf jedem Handy) erst mit einem frischen Stand
const STATION_LEER = 'Hier steht gerade nichts.';
function uebersichtZeichnen() {
  const sicht = stationFrei() ? stationSicht() : null;                         // Station: nur die Reiter und Handgriffe ihres Profils (null = Verwalter-Handy: alles wie bisher)
  if (sicht && sicht.satz && ueStatus === sicht.satz) ueStatus = '';            // der Satz des Laptops („… noch nichts eingestellt“) steht dann schon groß auf der Seite
  const kopf = sicht && sicht.satz ? null : uebersichtFuer(postStand, modus);   // eine Station ohne Profil zeigt nichts – auch keinen älteren Stand
  const leiste = $('#ue-reiter');
  const links = leiste.scrollLeft;
  const mitHof = funktionAktiv('hof') && !!(kopf && kopf.hof && kopf.hof.karte === 'ok');       // den Reiter „Hof“ gibt es nur mit Freigabe und nur, wenn der Laptop eine Hof-Karte geschickt hat
  const nur = sicht ? sicht.reiter.filter(name => name !== 'hof' || mitHof) : null;
  if (nur && !nur.includes(ueReiter)) { ueReiter = nur[0] || ''; ueHofWahl = ''; }
  if (!nur && ueReiter === 'hof' && !mitHof) ueReiter = 'lager';
  zeichneReiter(leiste, ueReiter, name => { if (!ANZEIGE) { ueReiter = name; ueHofWahl = ''; uebersichtZeichnen(); uebersichtAuto('reiter'); } }, mitHof, nur);
  leiste.scrollLeft = links;
  const ohneReiter = !!nur && !nur.length;
  leiste.hidden = ohneReiter;
  $('#ue-such').hidden = ohneReiter;
  stationKnoepfe(sicht);
  if (ohneReiter) {                                                              // Station ohne Reiter: ein Satz statt der Tabellen (der des Laptops, wenn er einen geschickt hat)
    const satz = document.createElement('p');
    satz.className = 'ue-hinweis st-satz';
    satz.textContent = sicht.satz || (sicht.reiter.length ? STATION_HOF_FEHLT : STATION_OHNE_REITER);
    $('#ue-seite').replaceChildren(satz);
  } else {
    zeichneInhalt($('#ue-seite'), kopf, ueReiter, ueSuche, ueHofWahl, id => { ueHofWahl = id; uebersichtZeichnen(); }, ANZEIGE ? null : bestellungOeffnen, kartenKontext());
    if (sicht && !sicht.handgriffe.includes('sprechen')) for (const p of $$('#ue-seite .ue-leer-satz')) p.textContent = STATION_LEER;      // ohne „sprechen“ keine Aufforderung „Sag z. B. …“
  }
  const stand = kopf ? standText(kopf.stand) : '';
  $('#ue-stand').textContent = ueFragt ? (kopf ? stand + ' · wird geholt …' : 'Stand wird geholt …') : ueStatus ? ueStatus + (kopf ? ' ' + stand : '') : kopf ? stand : 'Noch kein Stand.';
  $('#b-ue-neu').classList.toggle('dreht', ueFragt);
  $('#b-ue-neu').disabled = ueFragt;
}
async function uebersichtAktualisieren() {
  if (ueFragt || !geraet) return;
  if (!holenAktiv() || !funktionAktiv('uebersicht')) return;
  const ziel = modus;                                                       // gefragt wird den Laptop des Modus, in dem man gerade ist
  if (!navigator.onLine) { ueStatus = 'Kein Netz – das ist der letzte Stand.'; uebersichtZeichnen(); return; }
  const privatKey = await privaterSchluessel();
  if (!privatKey || !schluesselFuer(config, ziel)) { ueStatus = 'Dieses Handy kann gerade nicht fragen. Bitte Claude Bescheid geben.'; uebersichtZeichnen(); return; }
  ueFragt = true; ueStatus = ''; ueLetzteFrage = Date.now(); uebersichtZeichnen();
  try {
    const r = await uebersichtFrageBauen({ instanz: ziel, geraet, config, privatKey });
    await kasten.senden(geraet.token, r.id, new Blob([r.umschlag], { type: 'application/octet-stream' }), ziel);
    const ende = Date.now() + UE_WARTEN_MS;
    while (Date.now() < ende) {
      await new Promise(ok => setTimeout(ok, 1200));
      await postHolen();
      const k = uebersichtFuer(postStand, ziel);
      if (k && k.frage === r.id) { ueStatus = ''; return; }
      const g = uebersichtGrundFuer(postStand, ziel);                       // der Laptop sagt, warum er keinen Stand schickt
      if (g && g.frage === r.id) { ueStatus = (BAU_CODES.includes(g.code) ? 'Der Laptop konnte die Übersicht gerade nicht bauen: ' : '') + g.grund; return; }
    }
    ueStatus = 'Der Laptop antwortet nicht – ist er an?';
  } catch (err) {
    const code = err instanceof BriefkastenFehler ? err.code : '';
    ueStatus = testBlockiert(ziel, code) ? TEXTE.testNichtBereit : code === 'netz' ? 'Kein Netz – das ist der letzte Stand.'
      : code === 'bremse' ? 'Bitte kurz warten und noch einmal tippen.' : 'Das Fragen ging nicht.';
  } finally { ueFragt = false; uebersichtZeichnen(); }
}
// ---------- Die Hof-Karte am Handy bearbeiten (Funktion „hofkarte_bearbeiten“, A037) ----------
// Dieselbe Hof-Karte wie am Laptop (Reiter „Hof“ in der Übersicht): Namen ändern, Platz setzen, Neues ergänzen, Eigenes ausblenden – und Maschinen antippen,
// umbenennen, entfernen, wieder aufnehmen. Das Handy schreibt nie selbst: Jede Änderung ist ein kleiner beglaubigter Auftrag an den Laptop (nur Verwalter-Handys);
// der Laptop prüft, führt aus und schickt den neuen Stand mit dem Ergebnis zurück. Ein Knopf ist gesperrt, solange ein Auftrag unterwegs ist (kein doppeltes Tippen).
const KARTE_WARTEN_MS = 90000;
const kz = { ansicht: 'kacheln', standort: '', fenster: null, wahl: '', modus: '', marke: null, laeuft: false, meldung: null, maschWahl: '', maschFrage: '' };
const karteAktiv = () => !ANZEIGE && !!geraet && geraet.status === 'frei' && geraet.rolle === 'admin' && funktionAktiv('hofkarte_bearbeiten') && funktionAktiv('hof')
  && funktionAktiv('uebersicht') && funktionAktiv('rueckfragen');
function kartenKontext() {
  if (!karteAktiv()) return null;
  const neu = () => uebersichtZeichnen();
  return {
    get ansicht() { return kz.ansicht; }, get standort() { return kz.standort; }, get wahl() { return kz.wahl; }, get modus() { return kz.modus; },        // der Zustand wird bei jedem Zugriff frisch gelesen (der Tipp auf die Karte zeichnet nicht neu)
    get marke() { return kz.marke; }, get laeuft() { return kz.laeuft; }, get meldung() { return kz.meldung; },
    get fenster() { return kz.fenster; }, setzeFenster: f => { kz.fenster = f; },                        // A050: Ausschnitt der gemeinsamen Karte (verschieben, zoomen); bleibt beim Neuzeichnen
    setzeAnsicht: a => { kz.ansicht = a; kz.modus = ''; kz.marke = null; kz.meldung = null; neu(); },
    setzeStandort: id => { kz.standort = id; kz.fenster = null; kz.wahl = ''; kz.modus = ''; kz.marke = null; neu(); },
    waehle: (id, modus) => { kz.wahl = id; kz.modus = modus || ''; kz.marke = null; kz.meldung = null; neu(); },
    setzeModus: m => { kz.modus = m; kz.marke = null; kz.meldung = null; neu(); },
    setzeMarke: (x, y, standort) => { kz.marke = { x, y, standort: standort || '' }; },
    sende: (aktion, parameter) => karteSenden(aktion, parameter),
    infos: id => { ueHofWahl = id; neu(); },
    maschSpringen: id => { kz.maschWahl = id; kz.maschFrage = ''; ueReiter = 'masch'; ueHofWahl = ''; neu(); },
    masch: { get wahl() { return kz.maschWahl; }, get frage() { return kz.maschFrage; }, get laeuft() { return kz.laeuft; },
             waehle: id => { kz.maschWahl = id; kz.maschFrage = ''; neu(); }, fragen: id => { kz.maschFrage = id; neu(); }, sende: (a, p) => karteSenden(a, p) },
  };
}
// Schickt einen Auftrag und wartet auf das Ergebnis (der Laptop antwortet mit einem frischen Stand, der die Kennung des Auftrags trägt). Gibt { ok, text } zurück.
async function karteSenden(aktion, parameter) {
  if (kz.laeuft) return { ok: false, text: 'Es läuft schon ein Auftrag. Bitte einen Moment warten.' };
  const fertig = (ok, text) => { kz.meldung = { ok, text }; ueStatus = text; return { ok, text }; };
  if (!karteAktiv() || !postAktiv()) return fertig(false, 'Dieses Handy darf die Hof-Karte nicht ändern.');
  const ziel = modus;
  if (!navigator.onLine) return fertig(false, 'Kein Netz – es wurde nichts geändert.');
  const privatKey = await privaterSchluessel();
  if (!privatKey || !schluesselFuer(config, ziel)) return fertig(false, 'Dieses Handy kann gerade nicht senden. Bitte Claude Bescheid geben.');
  kz.laeuft = true; kz.meldung = null; uebersichtZeichnen();
  let erg;
  try {
    const r = await karteAuftragBauen({ aktion, parameter, instanz: ziel, geraet, config, privatKey });
    await kasten.senden(geraet.token, r.id, new Blob([r.umschlag], { type: 'application/octet-stream' }), ziel);
    const ende = Date.now() + KARTE_WARTEN_MS;
    erg = null;
    while (Date.now() < ende && !erg) {
      await new Promise(ok => setTimeout(ok, 1200));
      await postHolen();
      const k = uebersichtFuer(postStand, ziel);
      if (k && k.frage === r.id) erg = k.ergebnis ? { ok: k.ergebnis.ok, text: k.ergebnis.text } : { ok: true, text: 'Erledigt.' };
      const g = uebersichtGrundFuer(postStand, ziel);
      if (!erg && g && g.frage === r.id) erg = { ok: true, text: g.grund };
    }
    if (!erg) erg = { ok: false, text: 'Der Laptop antwortet nicht – ist er an? Der Auftrag liegt im Briefkasten und wird ausgeführt, sobald der Laptop wieder da ist.' };
  } catch (err) {
    const code = err instanceof BriefkastenFehler ? err.code : '';
    erg = { ok: false, text: testBlockiert(ziel, code) ? TEXTE.testNichtBereit : code === 'netz' ? 'Kein Netz – es wurde nichts geändert.' : code === 'bremse' ? 'Bitte kurz warten und noch einmal tippen.' : 'Das Senden ging nicht.' };
  } finally { kz.laeuft = false; }
  if (erg.ok) {
    if (aktion === 'platz' || aktion === 'neu') { kz.modus = ''; kz.marke = null; if (aktion === 'neu') kz.wahl = ''; }
    if (aktion === 'maschine_entfernen' || aktion === 'maschine_aufnehmen') { kz.maschFrage = ''; kz.maschWahl = ''; }
    if (aktion === 'maschine_umbenennen') kz.maschFrage = '';
  }
  fertig(erg.ok, erg.text);
  uebersichtZeichnen();
  return erg;
}
$('#b-zurueck-uebersicht').addEventListener('click', () => history.back());
$('#b-ue-neu').addEventListener('click', () => uebersichtAktualisieren());
$('#ue-such').addEventListener('input', e => {
  ueSuche = e.target.value;
  if (stationFrei()) { uebersichtZeichnen(); return; }                          // Station: immer über ihr Profil zeichnen
  zeichneInhalt($('#ue-seite'), uebersichtFuer(postStand, modus), ueReiter, ueSuche, ueHofWahl, id => { ueHofWahl = id; uebersichtZeichnen(); }, ANZEIGE ? null : bestellungOeffnen, kartenKontext());
});
$('#b-zurueck-bestellung').addEventListener('click', () => history.back());

// ---------- Kacheln (Funktion „kacheln“) ----------
// Eine schmale Zeile über dem Mikrofon; die acht Kacheln stehen auf einem eigenen Bildschirm (auf kleinen Handys ist auf dem Startbildschirm kein Platz dafür).
// Die gewählte Kachel geht mit der nächsten Nachricht als Feld `bereich` mit; ohne Kachel ist alles wie bisher.
const kachelnAktiv = () => funktionAktiv('kacheln');
const scannerAktiv = () => funktionAktiv('scanner') && funktionAktiv('kacheln');
function bereichAnzeigen() {
  const b = kachelnAktiv() ? bereichVon(entwurf.bereich) : null;
  const knopf = $('#b-bereich');
  knopf.classList.toggle('gewaehlt', !!b);
  knopf.setAttribute('aria-label', b ? 'Bereich: ' + b.name + ' – ändern' : 'Bereich wählen');
  knopf.style.color = b ? b.farbe : '';
  const rund = $('#bereich-symbol');
  if (b) rund.replaceChildren(bereichSymbol(b.wert));
  else rund.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/></svg>';        // fester Text aus diesem Programm
  const p = $('#pruef-bereich');
  p.textContent = b ? 'Bereich: ' + b.name : '';
  p.hidden = !b;
  const scanKnopf = scannerAktiv() && !!b && istScanBereich(b.wert);                    // „Scannen“ gibt es nur bei Wareneingang, Verkauf und Inventur
  $('#b-scannen').hidden = !scanKnopf;
  document.body.classList.toggle('mit-scan', scanKnopf);                                 // styles.css: der Startbildschirm gibt dem Knopf Platz
  startHinweis();
}
function bereichZeichnen() {
  zeichneKacheln($('#kachel-gitter'), kachelnAktiv() ? entwurf.bereich : '', wert => {
    entwurf.bereich = wert;
    entwurfMerken();
    bereichAnzeigen();
    history.back();
  });
}
$('#b-bereich').addEventListener('click', () => zeige('s-bereich'));
$('#b-ohne-bereich').addEventListener('click', () => { entwurf.bereich = ''; entwurfMerken(); bereichAnzeigen(); history.back(); });
$('#b-zurueck-bereich').addEventListener('click', () => history.back());

// ---------- Scannen (Funktion „scanner“) ----------
// Barcode oder QR-Code lesen, Menge/Charge/MHD eintragen; „Fertig“ macht aus allen Zeilen EINE Nachricht (Prüfen → Senden wie immer, Ende-zu-Ende verschlüsselt).
// Die Kamera geht erst nach Tippen auf „Scannen“ an; das Bild bleibt im Handy. Artikelnamen kommen aus dem Warenlager der Übersicht (nur Verwalter-Handys).
const scan = baueScan($('#s-scan'), {
  liste: () => { const u = uebersichtFuer(postStand, modus); return u && u.tabs && u.tabs.lager && Array.isArray(u.tabs.lager.scan) ? u.tabs.lager.scan : null; },
  beiFertig: (bereich, text) => {
    entwurf.bereich = bereich;
    entwurf.text = [entwurf.text.trim(), text].filter(Boolean).join('\n');
    scan.leeren();
    zeigePruefen(true);
  },
  beiZurueck: () => history.back(),
  meldung: t => meldung(t),
});
$('#b-scannen').addEventListener('click', () => zeige('s-scan'));

// ---------- Untere Leiste und Menü „Mehr“ (Funktion „untere_leiste“, A038) ----------
// Start · Übersicht · [Sprechen] · Post · Mehr – höchstens fünf Einträge, fest am unteren Rand. Ein Eintrag, dessen Funktion aus ist (oder den dieses Handy
// nicht braucht, z. B. Post auf einem Mitglieds-Handy), fehlt. Alles Seltene steht im Menü „Mehr“. Die Zurück-Taste des Handys schließt ein offenes Blatt
// bzw. geht zum vorigen Reiter (jedes Blatt und jeder Reiter ist ein Eintrag im Verlauf des Browsers).
const NAV_BILDSCHIRME = ['s-start', 's-uebersicht', 's-bestellung', 's-post', 's-gesendet', 's-hilfe'];       // dort steht die Leiste; beim Sprechen, Prüfen, Scannen usw. nicht
const NAV_ZIEL = { 's-start': 'nav-start', 's-gesendet': 'nav-start', 's-uebersicht': 'nav-uebersicht', 's-bestellung': 'nav-uebersicht', 's-post': 'nav-post', 's-hilfe': 'nav-mehr' };
let offenesBlatt = null;              // 'mehr' | 'fab-blatt' | null
let blattOffenSeit = 0;
// Die Leiste ist die Oberfläche selbst, keine Vorschau: sie steht nur bei „alle“ (bei „test“ und ohne Eintrag sieht die App aus wie vorher – auch im Test-Modus der Testebene).
function leisteDa() { return !ANZEIGE && !!geraet && geraet.status === 'frei' && funktionen.untere_leiste === 'alle' && NAV_BILDSCHIRME.includes(aktuell); }
function navAnzeigen() {
  const nav = $('#nav'); if (!nav) return;
  const da = leisteDa();
  nav.hidden = !da;
  document.body.classList.toggle('mit-leiste', da);
  const verwalter = geraet?.rolle === 'admin';
  const station = stationFrei();                                             // Station (A055): die Leiste zeigt nur, was sie hat – die Übersicht und, mit dem Handgriff „sprechen“, den Sprechknopf
  document.body.classList.toggle('station', station);                        // styles.css: kein „Zurück“ in der Übersicht, die Einträge der Leiste teilen sich die Breite
  $('#nav-start').hidden = station;
  $('#nav-uebersicht').hidden = !verwalter && !station;                      // …und ohne Funktion „uebersicht“ blendet styles.css ihn aus
  $('#nav-post').hidden = !verwalter;                                        // …ebenso ohne „rueckfragen“
  $('#nav-mehr').hidden = station;
  $('.nav-mitte').hidden = station && !stationDarf('sprechen');
  const zahl = Number($('#post-zaehler').textContent) || 0;
  const abz = $('#nav-abzeichen'); abz.textContent = String(zahl); abz.hidden = !zahl;
  $('#nav-post').setAttribute('aria-label', zahl ? 'Post – ' + zahl + (zahl === 1 ? ' wartet' : ' warten') : 'Post');
  const aktiv = (offenesBlatt === 'mehr') ? 'nav-mehr' : NAV_ZIEL[aktuell];
  for (const b of $$('.nav-punkt')) { if (b.id === aktiv) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
}
function blattOeffnen(id) {
  if (offenesBlatt) return;
  if (id === 'mehr') mehrZeichnen(); else fabBlattZeichnen();
  offenesBlatt = id; blattOffenSeit = Date.now();
  history.pushState({ s: aktuell, blatt: id }, '');
  $('#' + id).hidden = false;
  navAnzeigen();
}
function blaetterSchliessen() {                // ohne den Verlauf anzufassen (nach „Zurück“ oder bevor man woanders hinführt)
  offenesBlatt = null;
  $('#mehr').hidden = true; $('#fab-blatt').hidden = true;
  navAnzeigen();
}
function blattZuMitZurueck() { if (offenesBlatt) history.back(); }          // popstate schließt dann
// Von der Leiste oder aus dem Menü zu einem Bildschirm: war ein Blatt offen, ersetzt der neue Bildschirm dessen Eintrag im Verlauf (ein Zurück geht dann zum vorigen Reiter).
function geheZu(id) {
  const ersetzen = !!offenesBlatt;
  blaetterSchliessen();
  if (id === aktuell && !ersetzen) return;
  zeige(id, { verlauf: !ersetzen });
  if (ersetzen) history.replaceState({ s: aktuell }, '');
}
function mehrZeichnen() {
  const verwalter = geraet?.rolle === 'admin';
  $('#mehr-hof').hidden = !(verwalter && funktionAktiv('hof') && funktionAktiv('uebersicht'));
  $('#mehr-scanner').hidden = !scannerAktiv();
  $('#mehr-aenderungen').hidden = !(verwalter && funktionAktiv('aenderungen') && funktionAktiv('rueckfragen'));
  $('#mehr-freigaben').hidden = !verwalter;
}
function fabBlattZeichnen() { $('#fab-scannen').hidden = !scannerAktiv() || stationFrei(); }      // eine Station scannt nur über die Knöpfe ihrer Handgriffe (feste Art)
function scannenOeffnen() {
  if (!scannerAktiv() || stationFrei()) return;
  if (istScanBereich(entwurf.bereich)) { geheZu('s-scan'); return; }
  geheZu('s-bereich');
  meldung('Wähle zuerst den Bereich: Wareneingang, Verkauf oder Inventur.', 5000);
}
$('#b-uebersicht').addEventListener('click', () => zeige('s-uebersicht'));
$('#nav-start').addEventListener('click', () => geheZu('s-start'));
$('#nav-uebersicht').addEventListener('click', () => geheZu('s-uebersicht'));
$('#nav-post').addEventListener('click', () => geheZu('s-post'));
$('#nav-mehr').addEventListener('click', () => { if (offenesBlatt === 'mehr') blattZuMitZurueck(); else blattOeffnen('mehr'); });
for (const id of ['#b-mehr-zu', '#b-mehr-abbrechen', '#b-fab-zu', '#b-fab-abbrechen']) {
  $(id).addEventListener('click', () => { if (Date.now() - blattOffenSeit > 400) blattZuMitZurueck(); });          // kurz nach dem Öffnen (Finger noch auf dem Knopf) zählt ein Tippen nicht
}
$('#mehr-hof').addEventListener('click', () => {
  ueReiter = 'hof'; ueHofWahl = '';
  geheZu('s-uebersicht');
  if (ueReiter !== 'hof') meldung('Die Hof-Karte ist noch nicht da – in der Übersicht oben auf „Aktualisieren“ tippen.', 6000);
});
$('#mehr-scanner').addEventListener('click', scannenOeffnen);
$('#mehr-aenderungen').addEventListener('click', () => geheZu('s-post'));
$('#mehr-freigaben').addEventListener('click', () => geheZu('s-freigaben'));
$('#mehr-hilfe').addEventListener('click', () => geheZu('s-hilfe'));
$('#b-zurueck-hilfe').addEventListener('click', () => history.back());
// Sprechknopf in der Mitte: Antippen nimmt sofort auf (wie der große Knopf auf dem Start), langes Drücken öffnet Foto / Scannen / Tippen.
const FAB_LANG_MS = 550;
let fabTimer = null, fabLang = false;
const fab = $('#nav-sprechen');
fab.addEventListener('pointerdown', () => {
  fabLang = false; clearTimeout(fabTimer);
  fabTimer = setTimeout(() => { fabLang = true; blattOeffnen('fab-blatt'); }, FAB_LANG_MS);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) fab.addEventListener(ev, () => clearTimeout(fabTimer));
fab.addEventListener('contextmenu', e => e.preventDefault());
fab.addEventListener('click', () => {
  if (fabLang) { fabLang = false; return; }
  if (offenesBlatt) return;
  sprechenStarten(false);
});
$('#fab-foto').addEventListener('click', () => { blaetterSchliessen(); history.back(); setTimeout(() => $('#in-kamera').click(), 0); });
$('#fab-tippen').addEventListener('click', () => {
  const ersetzen = !!offenesBlatt;
  blaetterSchliessen();
  if (!freiErlaubt()) return;
  entwurf = { ...neuerEntwurf(), anhaenge: entwurf.anhaenge, text: entwurf.text, bereich: entwurf.bereich };
  zeigePruefen(false);
  if (ersetzen) history.replaceState({ s: 's-pruefen' }, '');
  $('#hof-text').focus();
});
$('#fab-scannen').addEventListener('click', scannenOeffnen);

// ---------- Station: die Knöpfe der Handgriffe (A055) ----------
// „Inventur“, „Wareneingang“, „Verkauf“ öffnen den Scanner in genau dieser Art (eine andere lässt sich dort nicht wählen: die Kacheln gibt es auf einer Station nicht).
// „Fertig“ führt wie überall über Prüfen zum Senden; danach steht wieder die Übersicht da. „Sprechen“, „Schreiben“ und „Foto, Anhang“ gibt es nur mit dem Handgriff „sprechen“.
// Ein Entwurf gehört auf einer Station zu genau einem Handgriff (ohne Bereich = freie Nachricht). Liegt noch einer da, geht es zuerst dorthin (senden, leeren oder
// verwerfen) – nur eine freie Nachricht lässt sich weiterschreiben. So mischt sich nichts (jede Scanner-Nachricht hat genau eine Art und einen Kopf), und nichts geht verloren.
function stationBeginnen(griff) {
  if (!stationFrei() || !stationDarf(griff)) return false;
  const bereich = griff === 'sprechen' ? '' : griff;
  const offen = !!(entwurf.text.trim() || entwurf.audio || entwurf.anhaenge.length);
  if (offen && !(bereich === '' && entwurf.bereich === '')) {
    zeigePruefen(false);
    meldung('Hier liegt noch ein Entwurf. Bitte erst senden oder ' + (freiErlaubt() ? 'den Text leeren.' : 'verwerfen.'), 6000);
    return false;
  }
  if (entwurf.bereich !== bereich) { entwurf.bereich = bereich; entwurfMerken(true); }
  return true;
}
function stationScannen(art) { if (scannerAktiv() && stationBeginnen(art)) zeige('s-scan'); }
$('#st-inventur').addEventListener('click', () => stationScannen('inventur'));
$('#st-wareneingang').addEventListener('click', () => stationScannen('wareneingang'));
$('#st-verkauf').addEventListener('click', () => stationScannen('verkauf'));
$('#st-sprechen').addEventListener('click', () => { if (stationFrei()) sprechenStarten(false); });
$('#st-schreiben').addEventListener('click', () => {
  if (!stationBeginnen('sprechen')) return;
  zeigePruefen(false);                                   // ein angefangener freier Text steht dort noch und lässt sich weiterschreiben
  $('#hof-text').focus();
});
$('#st-anhang').addEventListener('click', () => { if (stationBeginnen('sprechen')) blattAuf(); });
// ---------- Hilfen ----------
function dauerText(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function zeitText(ms) {
  const d = new Date(ms), h = new Date();
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === h.toDateString() ? uhr : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + uhr;
}
function endung(typ) { return typ.includes('mp4') ? 'm4a' : typ.includes('ogg') ? 'ogg' : 'webm'; }

function startHinweis() {
  const h = $('#start-hinweis');
  const gewaehlt = funktionAktiv('kacheln') ? bereichVon(entwurf.bereich) : null;
  if (gewaehlt) h.textContent = 'Bereich: ' + gewaehlt.name + ' – jetzt sprechen oder schreiben.';
  else if (cloudAktiv()) h.textContent = 'Nach dem Sprechen steht der Text gleich da.';
  else if (config.live_text !== 'handy' || !liveTextMoeglich) h.textContent = HINWEIS_KEIN_LIVETEXT;
  else h.textContent = 'Der Text erscheint, während du sprichst.';
}

// Für Tests
window.hofApp = {
  postausgang, quittungenHolen, nachrichten, zeichneListen, modus: () => modus, funktion: funktionAktiv, funktionenLaden, funktionen: () => ({ ...funktionen }),
  post: { holen: postHolen, stand: () => JSON.parse(JSON.stringify(postStand)), zeichnen: postZeichnen },
  karte: { sende: karteSenden, zustand: () => ({ ...kz }), aktiv: karteAktiv },
  uebersicht: { aktualisieren: uebersichtAktualisieren, fragt: () => ueFragt, status: () => ueStatus, bestellung: () => bestellWahl,
                  gesehenSetzen: ms => { const u = postStand.uebersicht && postStand.uebersicht[normModus(modus)]; if (u) u.gesehen = ms; } },        // (nur für Tests: den Stand „alt“ machen)
  bereich: () => entwurf.bereich,
  scan: { code: t => scan.code(t), zustand: () => scan.zustand(), entwurf: () => ({ text: entwurf.text, bereich: entwurf.bereich }) },
  sprache: { cloudAktiv, pauseBis: () => cloudPauseBis, offen: () => erkennungOffen },
  station: { frei: stationFrei, sicht: () => stationSicht(), rolle: () => (geraet ? geraet.rolle : ''), nimmtAuf: () => !!aufnahme },
};

starten();
