import grundConfig from './config.js';
import { einstellung, nachrichten, aufraeumen } from './js/speicher.js';
import { briefkastenFuer, normCode, BriefkastenFehler } from './js/briefkasten.js';
import { packen, verschluesseln, fotoVerkleinern } from './js/paket.js';
import { Aufnahme, liveTextMoeglich } from './js/sprache.js';

// ---------- Einstellungen ----------
const config = { live_text: 'handy', ...grundConfig };
const lokal = ['localhost', '127.0.0.1'].includes(location.hostname);
const q = new URLSearchParams(location.search);
if (lokal && q.has('attrappe')) {
  config.attrappe = true;
  if (q.get('schluessel')) config.laptopSchluessel = q.get('schluessel');
}
const kasten = briefkastenFuer(config);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let geraet = null;          // {token, id, rolle, status, name}
let entwurf = neuerEntwurf();
let aufnahme = null;
let liveTextAus = false; // auf diesem Handy gehen Erkennung und Aufnahme nicht zusammen -> Aufnahme hat Vorrang
const HINWEIS_KEIN_LIVETEXT = 'Live-Text auf diesem Handy nicht verfügbar – die Aufnahme wird später abgeschrieben.';
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
  if (aktuell === 's-aufnahme' && id !== 's-aufnahme' && aufnahme) { aufnahme.abbrechen(); aufnahme = null; }
  $$('.screen').forEach(s => { s.hidden = s.id !== id; });
  aktuell = id;
  if (verlauf) history.pushState({ s: id }, '');
  window.scrollTo(0, 0);
  if (id === 's-start' || id === 's-gesendet') zeichneListen();
  if (id === 's-freigaben') ladeFreigaben();
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
  const gespeichert = await einstellung.hole('entwurf');
  if (gespeichert) entwurf = { ...neuerEntwurf(), ...gespeichert };
  if (await einstellung.hole('livetext-aus')) liveTextAus = true;
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
  zeige('s-aufnahme');
  aufnahme = new Aufnahme({
    liveText: config.live_text === 'handy' && !liveTextAus,
    beiText: (fest, vor) => {
      $('#live-fest').textContent = [vorher, fest].filter(Boolean).join(' ') + (vor ? ' ' : '');
      $('#live-vorlaeufig').textContent = vor;
      const m = $('.mitschrift'); m.scrollTop = m.scrollHeight;
    },
    beiPegel: p => { const jetzt = performance.now(); if (jetzt - (pegel._t || 0) < 80) return; pegel._t = jetzt; const b = pegel.firstChild; pegel.appendChild(b); b.style.height = Math.max(6, p * 52) + 'px'; },
    beiProblem: art => {
      if (art === 'kein-livetext') meldung(HINWEIS_KEIN_LIVETEXT, 5000);
      if (art === 'livetext-netz') meldung('Live-Text braucht Netz – die Aufnahme wird später abgeschrieben.', 5000);
      if (art === 'aufnahme') meldung('Tonaufnahme geht nicht, nur Live-Text.', 4000);
    },
  });
  try { await aufnahme.starten(); }
  catch {
    aufnahme = null;
    meldung('Bitte das Mikrofon erlauben (Schloss-Symbol oben in der Adresszeile).', 6000);
    history.back();
    return;
  }
  const t0 = Date.now();
  $('#uhr').textContent = '0:00';
  clearInterval(uhrTimer);
  uhrTimer = setInterval(() => {
    if (!aufnahme) return clearInterval(uhrTimer);
    const s = Math.round((Date.now() - t0) / 1000);
    $('#uhr').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 250);
}

$('#b-fertig').addEventListener('click', async () => {
  if (!aufnahme) return;
  const a = aufnahme; aufnahme = null; clearInterval(uhrTimer);
  $('#b-fertig').disabled = true;
  const r = await a.beenden();
  $('#b-fertig').disabled = false;
  if (r.stummeAufnahme) {
    // Erkennung hat das Mikrofon belegt, die Aufnahme ist leer: ab jetzt nur noch aufnehmen.
    liveTextAus = true; einstellung.setze('livetext-aus', true);
    r.audio = null;
    meldung('Auf diesem Handy gehen Live-Text und Aufnahme nicht zusammen. Ab jetzt wird nur aufgenommen.', 7000);
  }
  entwurf.text = [entwurf.text.trim(), r.text].filter(Boolean).join(' ');
  if (r.audio) {
    // Bei "Nochmal sprechen" kommt eine zweite Aufnahme dazu; die erste bleibt als Anhang erhalten.
    if (entwurf.audio) entwurf.anhaenge.push(new File([entwurf.audio], 'sprache-1.' + endung(entwurf.audio.type), { type: entwurf.audio.type }));
    entwurf.audio = r.audio; entwurf.audioDauer = r.dauer;
  }
  zeigePruefen(true);
});
$('#b-abbrechen').addEventListener('click', () => { if (aufnahme) { aufnahme.abbrechen(); aufnahme = null; } history.back(); });

// ---------- Prüfen ----------
function zeigePruefen(ersetzen) {
  $('#hof-text').value = entwurf.text;
  entwurfMerken(true);
  const az = $('#audio-zeile');
  az.hidden = !entwurf.audio;
  $('#audio-label').textContent = 'Sprachaufnahme · ' + dauerText(entwurf.audioDauer) + ' · geht mit';
  zeichneAnhaenge();
  if (ersetzen) { history.replaceState({ s: 's-pruefen' }, ''); zeige('s-pruefen', { verlauf: false }); }
  else zeige('s-pruefen');
}
$('#hof-text').addEventListener('input', e => { entwurf.text = e.target.value; entwurfMerken(); });
$('#b-zurueck-pruefen').addEventListener('click', () => history.back());

let spieler;
$('#b-play').addEventListener('click', () => {
  if (!entwurf.audio) return;
  if (spieler && !spieler.paused) { spieler.pause(); return; }
  spieler = new Audio(URL.createObjectURL(entwurf.audio)); spieler.play().catch(() => {});
});
$('#b-audio-weg').addEventListener('click', () => { entwurf.audio = null; entwurf.audioDauer = 0; $('#audio-zeile').hidden = true; entwurfMerken(); });

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
  entwurf.text = $('#hof-text').value.trim();
  if (!entwurf.text && !entwurf.audio && !entwurf.anhaenge.length) { meldung('Es gibt noch nichts zu senden.'); return; }
  if (!config.laptopSchluessel) { meldung('Die App ist noch nicht fertig eingerichtet (Laptop-Schlüssel fehlt).', 6000); return; }
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
    const klar = await packen({ id, von: geraet.name, geraet: geraet.id, erstellt: new Date(erstellt).toISOString(), text: entwurf.text, sprachDauer: entwurf.audioDauer || 0 }, dateien);
    const umschlag = await verschluesseln(klar, config.laptopSchluessel);
    const fotos = dateien.filter(d => d.art === 'foto').length;
    const doks = dateien.filter(d => d.art === 'dokument').length;
    await nachrichten.speichere({
      id, erstellt, status: 'wartet',
      vorschau: entwurf.text || (fotos ? 'Foto' : doks ? 'Dokument' : 'Sprachnachricht'),
      sprache: entwurf.audioDauer || 0, fotos, doks,
      umschlag: new Blob([umschlag], { type: 'application/octet-stream' }),
    });
    entwurf = neuerEntwurf();
    clearTimeout(entwurfTimer);
    await einstellung.loesche('entwurf');
    $('#erfolg-titel').textContent = 'Wird gesendet …';
    $('#erfolg-text').textContent = 'Holt der Laptop sie ab, erscheinen zwei Haken.';
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
async function postausgang() {
  if (sendetGerade || !geraet || geraet.status !== 'frei') return;
  sendetGerade = true;
  try {
    const offen = (await nachrichten.alle()).filter(n => n.status === 'wartet').reverse();
    for (const n of offen) {
      try {
        await kasten.senden(geraet.token, n.id, n.umschlag);
        await nachrichten.aendere(n.id, { status: 'gesendet', umschlag: null, gesendet: Date.now() });
      } catch (err) {
        if (err instanceof BriefkastenFehler && (err.code === 'nicht_frei' || err.code === 'unbekannt')) {
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
  if (hintergrundLaeuft) return;
  hintergrundLaeuft = true;
  aufraeumen().catch(() => {});
  const runde = () => { if (document.visibilityState === 'visible') { postausgang(); quittungenHolen(); freigabenPunkt(); } };
  runde();
  setInterval(runde, 20000);
  document.addEventListener('visibilitychange', runde);
}

// ---------- Listen ----------
async function zeichneListen() {
  const alle = await nachrichten.alle();
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

// ---------- Hilfen ----------
function dauerText(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function zeitText(ms) {
  const d = new Date(ms), h = new Date();
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === h.toDateString() ? uhr : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + uhr;
}
function endung(typ) { return typ.includes('mp4') ? 'm4a' : typ.includes('ogg') ? 'ogg' : 'webm'; }

function startHinweis() {
  if (config.live_text !== 'handy' || !liveTextMoeglich || liveTextAus) $('#start-hinweis').textContent = HINWEIS_KEIN_LIVETEXT;
}

// Für Tests
window.hofApp = { postausgang, quittungenHolen, nachrichten };

starten();
