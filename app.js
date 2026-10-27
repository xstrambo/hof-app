import grundConfig from './config.js';
import { einstellung, nachrichten, aufraeumen } from './js/speicher.js';
import { briefkastenFuer, normCode, BriefkastenFehler } from './js/briefkasten.js';
import { packen, verschluesseln, fotoVerkleinern } from './js/paket.js';
import { Aufnahme, liveTextMoeglich } from './js/sprache.js';
import { ECHT, TEST, lesModus, schreibModus, wirksamerModus, testErlaubt, schluesselFuer, zielVon, testBlockiert, TEXTE } from './js/modus.js';
import { ladeFunktionen, sichtbar as funktionSichtbar, anwenden as funktionenAnwenden } from './js/funktionen.js';
import { neuerStand, normStand, STAND_NAME, holen as postHolenLogik, antwortBauen, erledigte as postErledigte, schluesselVon } from './js/post.js';
import { zeichnePost, sichtbareFragen } from './js/post-ansicht.js';
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

function neuerEntwurf() { return { text: '', audio: null, audioDauer: 0, anhaenge: [] }; }
// Eingegebenes geht nie verloren: der ganze Entwurf (Text, Aufnahme, Anhänge) liegt im Handy.
let entwurfTimer;
function entwurfMerken(sofort) {
  clearTimeout(entwurfTimer);
  const tu = () => einstellung.setze('entwurf', entwurf).catch(() => {});
  if (sofort) return tu();
  entwurfTimer = setTimeout(tu, 400);
}

// ---------- Bildschirme ----------
function zeige(id, { verlauf = true } = {}) {
  const ziel = document.getElementById(id);
  if (ziel?.dataset.funktion && !funktionAktiv(ziel.dataset.funktion)) id = 's-start';   // Bildschirm einer noch nicht freigegebenen Funktion: nie zeigen
  if (aktuell === 's-aufnahme' && id !== 's-aufnahme' && aufnahme) { aufnahme.abbrechen(); aufnahme = null; }
  $$('.screen').forEach(s => { s.hidden = s.id !== id; });
  aktuell = id;
  if (verlauf) history.pushState({ s: id }, '');
  window.scrollTo(0, 0);
  if (id === 's-start' || id === 's-gesendet') zeichneListen();
  if (id === 's-start') startHinweis();                       // der Hinweis hängt davon ab, ob die Cloud-Erkennung gerade pausiert
  if (id === 's-freigaben') ladeFreigaben();
  if (id === 's-post') { postZeichnen(true); postHolen(); }
}
window.addEventListener('popstate', e => {
  blattZu();
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
  if ('serviceWorker' in navigator && !config.attrappe) navigator.serviceWorker.register('sw.js').catch(() => {});
  netzAnzeigen();
  geraet = await einstellung.hole('geraet');
  await postLaden();
  modusSetzen(lesModus(), { merken: false });
  funktionenLaden();
  const gespeichert = await einstellung.hole('entwurf');
  if (gespeichert) entwurf = { ...neuerEntwurf(), ...gespeichert };
  // Alte Fassungen haben hier gemerkt "Live-Text geht auf diesem Handy nicht" und ihn für immer abgeschaltet.
  // Jetzt wird jedes Mal zuerst Live-Text versucht und bei Bedarf automatisch umgeschaltet: Merker wegräumen.
  einstellung.loesche('livetext-aus').catch(() => {});
  startHinweis();
  if (!geraet) return zeige('s-zugang', { verlauf: false });
  setzeName();
  if (geraet.status !== 'frei') return wartenAuf();
  history.replaceState({ s: 's-start' }, '');
  zeige('s-start', { verlauf: false });
  hintergrund();
  // Angefangener Entwurf? Dann gleich dort weitermachen.
  if (entwurf.text.trim() || entwurf.audio || entwurf.anhaenge.length) { zeigePruefen(false); meldung('Dein angefangener Entwurf ist noch da.'); }
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
  if (!nochmal) { entwurf = { ...neuerEntwurf(), anhaenge: entwurf.anhaenge, text: entwurf.text }; }
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
function blattAuf() { $('#blatt').hidden = false; }
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
    if (!dateien.length) return;
    for (const f of dateien) entwurf.anhaenge.push(f.type.startsWith('image/') ? await fotoVerkleinern(f) : f);
    entwurfMerken(true);
    if (aktuell === 's-pruefen') zeichneAnhaenge(); else zeigePruefen(false);
  });
}

$('#f-schnell').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#schnell-text').value.trim();
  if (!t) return;
  entwurf = { ...neuerEntwurf(), anhaenge: entwurf.anhaenge, text: [entwurf.text.trim(), t].filter(Boolean).join(' ') };
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
    const klar = await packen({ id, von: geraet.name, geraet: geraet.id, erstellt: new Date(erstellt).toISOString(), text: entwurf.text, sprachDauer: entwurf.audioDauer || 0, ziel }, dateien);
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
    await postausgang();
    const n = await nachrichten.hole(id);
    if (n?.status === 'wartet') {
      $('#erfolg-titel').textContent = 'Gespeichert';
      $('#erfolg-text').textContent = 'Kein Netz – geht automatisch raus, sobald Empfang da ist.';
      $('.erfolg').classList.add('offline');
    } else {
      $('#erfolg-titel').textContent = 'Gesendet';
    }
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
}

// ---------- Listen ----------
async function zeichneListen() {
  const alle = (await nachrichten.alle()).filter(n => n.art !== 'antwort');     // Antworten auf Rückfragen stehen in der Post, nicht hier
  fuelle($('#liste-start'), alle.slice(0, 3));
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  fuelle($('#liste-gesendet'), alle.filter(n => n.erstellt >= heute.getTime() || n.status === 'wartet').slice(0, 6));
}

function fuelle(box, liste) {
  box.replaceChildren();
  if (!liste.length) { const l = document.createElement('div'); l.className = 'leer'; l.textContent = 'Noch nichts gesendet.'; box.appendChild(l); return; }
  for (const n of liste) {
    const e = document.createElement('div'); e.className = 'eintrag'; e.dataset.id = n.id; e.dataset.status = n.status;
    const t = document.createElement('span'); t.className = 'eintrag-text'; t.textContent = n.vorschau; e.appendChild(t);
    const fuss = document.createElement('div'); fuss.className = 'eintrag-fuss';
    if (zielVon(n) === TEST) { const c = chip('Test'); c.classList.add('test'); fuss.appendChild(c); }
    if (n.sprache) fuss.appendChild(chip('Sprache ' + dauerText(n.sprache)));
    if (n.fotos) fuss.appendChild(chip(n.fotos === 1 ? '1 Foto' : n.fotos + ' Fotos'));
    if (n.doks) fuss.appendChild(chip(n.doks === 1 ? '1 Dokument' : n.doks + ' Dokumente'));
    const z = document.createElement('span'); z.className = 'zeit';
    const st = document.createElement('span'); st.className = 'st st-' + n.status; st.setAttribute('role', 'img');
    st.setAttribute('aria-label', { wartet: 'Wartet auf Netz', gesendet: 'Gesendet', abgeholt: 'Im BetriebsBrain angekommen' }[n.status]);
    if (n.status === 'wartet') { z.classList.add('wartet'); z.append('wartet auf Netz', st); }
    else z.append(zeitText(n.erstellt), st);
    fuss.appendChild(z);
    e.appendChild(fuss);
    box.appendChild(e);
  }
}
function chip(t) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = t; return c; }

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
    k.querySelector('.klein').textContent = 'Code ' + g.code + ' · ' + zeitText(g.seit);
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
    k.textContent = du ? 'Du · verwaltet die Freigaben' : 'frei seit ' + new Date(g.seit).toLocaleDateString('de-DE');
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

$('#b-code-neu').addEventListener('click', async () => {
  try {
    const r = await kasten.einladen(geraet.token);
    $('#einladung-code').textContent = r.code; $('#einladung').hidden = false;
  } catch { meldung('Neuer Code braucht Netz.'); }
});
$('#b-teilen').addEventListener('click', async () => {
  const code = $('#einladung-code').textContent;
  const text = 'Hof-App: ' + location.origin + location.pathname + '\nÖffnen, dann „Zum Startbildschirm hinzufügen“. Einladungscode: ' + code;
  if (navigator.share) { try { await navigator.share({ title: 'Hof-App', text }); } catch {} }
  else { try { await navigator.clipboard.writeText(text); meldung('Kopiert – jetzt z. B. in WhatsApp einfügen.'); } catch { meldung(code); } }
});

// ---------- Post (Knöpfe) ----------
$('#b-post').addEventListener('click', () => zeige('s-post'));
$('#b-zurueck-post').addEventListener('click', () => history.back());
$('#b-post-neu').addEventListener('click', () => { postNichtBereitBis = 0; postHolen(); });

// ---------- Echt | Test ----------
// Der Schalter steht auf dem Startbildschirm (nur für Geräte, die ihn sehen dürfen); im Test-Modus liegt ein oranges Band über jedem
// Bildschirm, und der Sendeknopf ist orange. Der Modus bleibt auf diesem Gerät gemerkt (Standard: Echt).
function modusSetzen(neu, { merken = true } = {}) {
  modus = wirksamerModus(neu, config, geraet);
  if (merken && testErlaubt(config, geraet)) schreibModus(modus);
  modusAnzeigen();
}
function modusAnzeigen() {
  const test = modus === TEST;
  document.body.classList.toggle('ist-test', test);
  $('#test-banner').hidden = !test;
  $('#modus-schalter').hidden = !testErlaubt(config, geraet);
  $('#m-echt').setAttribute('aria-pressed', String(!test));
  $('#m-test').setAttribute('aria-pressed', String(test));
  $('#b-senden').classList.toggle('test', test);
  $('#senden-text').textContent = test ? TEXTE.sendenTest : TEXTE.senden;
  document.title = test ? 'Hof-App (TEST)' : 'Hof-App';
  funktionenAnzeigen();
  startHinweis();
  postAnzeigen();
}
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
function funktionenAnzeigen() { funktionenAnwenden(document, funktionen, modus); }
let funktionenGeladen = 0;
async function funktionenLaden() {
  funktionenGeladen = Date.now();
  const neu = await ladeFunktionen();
  if (neu) { funktionen = neu; funktionenAnzeigen(); startHinweis(); postAnzeigen(); postHolen(); }
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
const aenderungenAktiv = () => funktionAktiv('aenderungen');

async function postLaden() { try { postStand = normStand(await einstellung.hole(STAND_NAME)); } catch { postStand = neuerStand(); } }
async function postSpeichern(stand) { try { await einstellung.setze(STAND_NAME, stand); } catch { /* beim nächsten Mal */ } }
async function privaterSchluessel() {
  try { const paar = await einstellung.hole('geraete-schluessel'); return paar && paar.privateKey ? paar.privateKey : null; } catch { return null; }
}

async function postHolen() {
  if (postLaeuft || !postAktiv() || !navigator.onLine || Date.now() < postNichtBereitBis) return;
  const privatKey = await privaterSchluessel();
  if (!privatKey) return;
  postLaeuft = true;
  try {
    const r = await postHolenLogik({ kasten, geraet, config, privatKey, stand: postStand, speichern: postSpeichern, test: modus === TEST });
    if (r.schluesselFehlt) {                                   // dieses Handy hat dem Briefkasten noch keinen öffentlichen Schlüssel gegeben: nachtragen
      const oeff = await geraeteSchluessel();
      if (oeff) await kasten.schluesselSetzen(geraet.token, oeff, modus === TEST).catch(() => {});
    }
    postFehler = ''; postZuletzt = Date.now();
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
  const zaehler = $('#post-zaehler');
  zaehler.textContent = String(warten); zaehler.hidden = !warten;
  $('#post-untertitel').textContent = warten ? (warten === 1 ? '1 Frage wartet auf dich' : warten + ' Fragen warten auf dich') : 'Keine offenen Fragen';
  $('#b-post').hidden = geraet?.rolle !== 'admin';
  if (aktuell === 's-post') postZeichnen();
}

async function postZeichnen(erzwingen = false) {
  const status = new Map();
  try { for (const n of await nachrichten.alle()) if (n.art === 'antwort') status.set(n.id, n.status); } catch { /* ohne Status */ }
  const zeigen = sichtbareFragen(postStand, modus, aenderungenAktiv());
  const ctx = {
    stand: postStand, modus, aenderungenAktiv: aenderungenAktiv(), entwuerfe: postEntwuerfe, status, beiAntwort: postAntworten,
    zeit: iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : zeitText(d.getTime()); },
    hinweis: postFehler === 'nicht_bereit' ? (modus === TEST ? 'Der Test-Briefkasten kann das noch nicht. Bitte Claude Bescheid geben.' : 'Der Briefkasten kann das noch nicht.')
      : postFehler === 'netz' ? 'Kein Netz – die Liste ist vom letzten Mal.' : postFehler === 'fehler' ? 'Das Aktualisieren hat nicht geklappt. Gleich noch ein Versuch.' : '',
    echtOffen: modus === TEST ? sichtbareFragen(postStand, ECHT, aenderungenAktiv()).length : 0,
    zuletzt: postZuletzt ? 'Zuletzt aktualisiert: ' + zeitText(postZuletzt) : '',
  };
  const signatur = JSON.stringify([modus, ctx.aenderungenAktiv, ctx.hinweis, ctx.echtOffen, [...status],
    zeigen.map(f => [f.instanz, f.id, f.kopf.stand, f.meine && f.meine.id]),
    postErledigte(postStand, modus).map(f => [f.instanz, f.id, f.zustand, f.erledigt.antwort, f.erledigt.gesehen, f.meine && f.meine.id])]);
  if (!erzwingen && signatur === postZeichnung) { $('#post-stand').textContent = ctx.zuletzt; return; }
  postZeichnung = signatur;
  zeichnePost($('#s-post'), ctx);
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
  if (cloudAktiv()) h.textContent = 'Nach dem Sprechen steht der Text gleich da.';
  else if (config.live_text !== 'handy' || !liveTextMoeglich) h.textContent = HINWEIS_KEIN_LIVETEXT;
  else h.textContent = 'Der Text erscheint, während du sprichst.';
}

// Für Tests
window.hofApp = {
  postausgang, quittungenHolen, nachrichten, modus: () => modus, funktion: funktionAktiv, funktionenLaden, funktionen: () => ({ ...funktionen }),
  post: { holen: postHolen, stand: () => JSON.parse(JSON.stringify(postStand)), zeichnen: postZeichnen },
  sprache: { cloudAktiv, pauseBis: () => cloudPauseBis, offen: () => erkennungOffen },
};

starten();
