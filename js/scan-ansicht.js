// Der Scanner-Bildschirm (Funktion „scanner“): Kamera, Felder zum Artikel, Liste der Zeilen, „Fertig“.
// Gezeichnet wird ausschließlich mit textContent, nie mit HTML. Die Rechnerei steht in gs1.js und scanzeilen.js, die Kamera in scanner.js.
import { liesCode } from './gs1.js';
import { GRUENDE, SCAN_BEREICHE, MAX_ZEILEN, artikelFinden, datumDe, mengeLesen, mengeText, nachrichtText, scanZeile, vorbelegen } from './scanzeilen.js';
import { starten as kameraStarten, kameraMoeglich } from './scanner.js';

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}

function feld(beschriftung, eingabe, id) {
  const l = el('label', 'scan-feld');
  l.append(el('span', 'scan-etikett', beschriftung), eingabe);
  if (id) eingabe.id = id;
  return l;
}

// wurzel: das <section id="s-scan">. optionen:
//   liste()            -> die Artikelliste vom Laptop (scanListe) oder null
//   beiFertig(bereich, text)   Fertig gedrückt: die Nachricht ist gebaut
//   beiZurueck()       Zurück gedrückt
//   meldung(text)      kurze Meldung unten
export function baueScan(wurzel, optionen) {
  const o = optionen;
  const z = { bereich: '', art: '', zeilen: [], aktuell: null, kamera: null, weg: '', status: '' };

  // ---- Aufbau ----
  const kopf = el('div', 'zurueck-kopf');
  const zurueck = el('button', 'knopf-icon'); zurueck.type = 'button'; zurueck.id = 'b-zurueck-scan'; zurueck.setAttribute('aria-label', 'Zurück');
  zurueck.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';    // festes Zeichen aus diesem Programm
  const titel = el('h1', '', 'Scannen');
  kopf.append(zurueck, titel);

  const inhalt = el('div', 'scan-inhalt');
  const kameraBox = el('div', 'scan-kamera');
  const video = el('video', 'scan-video'); video.setAttribute('playsinline', 'true'); video.muted = true;
  const rahmen = el('div', 'scan-rahmen'); rahmen.setAttribute('aria-hidden', 'true');
  kameraBox.append(video, rahmen);
  const statusP = el('p', 'scan-status leise'); statusP.setAttribute('role', 'status'); statusP.setAttribute('aria-live', 'polite');
  const kameraKnopf = el('button', 'knopf neben klein scan-kamera-knopf', 'Kamera starten'); kameraKnopf.type = 'button'; kameraKnopf.id = 'b-scan-kamera';
  const handFeld = el('input'); handFeld.type = 'text'; handFeld.inputMode = 'numeric'; handFeld.autocomplete = 'off'; handFeld.placeholder = 'Nummer unter dem Strichcode'; handFeld.id = 'scan-hand';
  const handKnopf = el('button', 'knopf neben klein', 'Übernehmen'); handKnopf.type = 'button'; handKnopf.id = 'b-scan-hand';
  const handZeile = el('div', 'scan-hand'); handZeile.append(handFeld, handKnopf);

  // Formular zum gerade gelesenen Artikel
  const karte = el('div', 'karte scan-karte'); karte.hidden = true; karte.id = 'scan-karte';
  const kName = el('b', 'scan-name'); kName.id = 'scan-name';
  const kCode = el('span', 'leise klein'); kCode.id = 'scan-code';
  const kHinweise = el('div', 'scan-hinweise'); kHinweise.id = 'scan-hinweise';
  const mengeEin = el('input'); mengeEin.type = 'text'; mengeEin.inputMode = 'decimal'; mengeEin.autocomplete = 'off';
  const mengeEinheit = el('span', 'scan-einheit');
  const mengeBox = el('div', 'scan-menge'); mengeBox.append(mengeEin, mengeEinheit);
  const mengeFeld = el('label', 'scan-feld'); const mengeEtikett = el('span', 'scan-etikett', 'Menge'); mengeFeld.append(mengeEtikett, mengeBox); mengeEin.id = 'scan-menge';
  const chargeEin = el('input'); chargeEin.type = 'text'; chargeEin.autocomplete = 'off'; chargeEin.maxLength = 30;
  const chargeFeld = feld('Charge', chargeEin, 'scan-charge');
  const mhdEin = el('input'); mhdEin.type = 'date';
  const mhdFeld = feld('MHD', mhdEin, 'scan-mhd');
  const grundSel = el('select'); for (const g of GRUENDE) { const op = el('option', '', g); op.value = g; grundSel.append(op); }
  const grundFeld = feld('Grund', grundSel, 'scan-grund');
  const chargeSel = el('select');
  const chargeSelFeld = feld('Charge (älteste zuerst)', chargeSel, 'scan-charge-wahl');
  const naechster = el('button', 'knopf haupt', 'Nächster Artikel'); naechster.type = 'button'; naechster.id = 'b-scan-weiter';
  const verwerfen = el('button', 'knopf neben klein', 'Verwerfen'); verwerfen.type = 'button'; verwerfen.id = 'b-scan-verwerfen';
  karte.append(kName, kCode, kHinweise, mengeFeld, chargeFeld, mhdFeld, grundFeld, chargeSelFeld, naechster, verwerfen);

  const listeKopf = el('span', 'ueberschrift', 'Bisher gescannt'); listeKopf.hidden = true;
  const listeBox = el('div', 'liste scan-liste'); listeBox.id = 'scan-liste';
  inhalt.append(kameraBox, statusP, kameraKnopf, handZeile, karte, listeKopf, listeBox);

  const fuss = el('div', 'knopf-stapel');
  const fertig = el('button', 'knopf haupt gross', 'Fertig'); fertig.type = 'button'; fertig.id = 'b-scan-fertig';
  fuss.append(fertig);
  wurzel.replaceChildren(kopf, inhalt, el('div', 'fuellung'), fuss);

  // ---- Hilfen ----
  const setStatus = t => { z.status = t; statusP.textContent = t; };
  const artikelListe = () => { try { return o.liste() || []; } catch { return []; } };
  const art = () => (SCAN_BEREICHE[z.bereich] || {}).art || '';

  function listeZeichnen() {
    listeBox.replaceChildren();
    listeKopf.hidden = !z.zeilen.length;
    z.zeilen.forEach((zeile, i) => {
      const r = el('div', 'eintrag scan-zeile');
      r.append(el('span', 'scan-zeile-text', zeile.replace(/^Scan: /, '')));
      const weg = el('button', 'link-knopf', 'entfernen'); weg.type = 'button';
      weg.addEventListener('click', () => { z.zeilen.splice(i, 1); listeZeichnen(); fertigZeigen(); });
      r.append(weg);
      listeBox.append(r);
    });
  }
  function fertigZeigen() {
    const n = z.zeilen.length + (z.aktuell && formularZeile() ? 1 : 0);
    fertig.textContent = n ? `Fertig (${n} ${n === 1 ? 'Zeile' : 'Zeilen'})` : 'Fertig';
    fertig.disabled = n === 0;
  }

  function formularZeile() {
    const a = z.aktuell;
    if (!a) return '';
    const menge = mengeLesen(mengeEin.value);
    if (menge === null) return '';
    return scanZeile(art(), {
      code: a.code, name: a.name, menge, einheit: a.einheit,
      charge: z.art === 'abgang' ? chargeSel.value : chargeEin.value,
      mhd: mhdEin.value, grund: grundSel.value,
    });
  }

  function formularZeigen(gelesen, artikel) {
    const v = vorbelegen(art(), artikel, gelesen);
    z.aktuell = { code: gelesen.code, name: v.name, einheit: v.einheit, gelesen, artikel };
    kName.textContent = v.name || 'Artikel noch nicht in der Liste';
    kCode.textContent = 'Code ' + gelesen.code + (artikel ? ' · Nr. ' + artikel.s : '');
    kHinweise.replaceChildren();
    const hinweise = [...v.hinweise, ...(gelesen.fehler || [])];
    if (!artikel) hinweise.push(artikelListe().length ? 'Diesen Code kenne ich noch nicht. Der Laptop fragt Niklas, welcher Artikel es ist.' : 'Die App kennt die Artikel noch nicht (Übersicht aktualisieren). Der Laptop ordnet den Code zu.');
    for (const h of hinweise) kHinweise.append(el('p', 'scan-hinweis', h));
    mengeEtikett.textContent = z.art === 'inventur' ? 'Gezählt' : 'Menge';
    mengeEin.value = v.menge; mengeEinheit.textContent = v.einheit;
    chargeEin.value = v.charge; mhdEin.value = v.mhd;
    chargeFeld.hidden = z.art !== 'eingang';
    mhdFeld.hidden = z.art !== 'eingang';
    grundFeld.hidden = z.art !== 'abgang';
    chargeSelFeld.hidden = z.art !== 'abgang';
    if (z.art === 'abgang') {
      chargeSel.replaceChildren();
      for (const c of v.chargenAuswahl) {
        const op = el('option', '', c.c + (c.m ? ' · MHD ' + datumDe(c.m) : '') + (c.q ? ' · ' + mengeText(c.q) + (v.einheit ? ' ' + v.einheit : '') : ''));
        op.value = c.c; chargeSel.append(op);
      }
      const keine = el('option', '', 'ohne Charge'); keine.value = ''; chargeSel.append(keine);
      chargeSel.value = v.charge;
    }
    karte.hidden = false;
    inhaltsCheck();
    fertigZeigen();
    mengeEin.focus({ preventScroll: false });
  }
  const inhaltsCheck = () => { naechster.disabled = !(z.aktuell && formularZeile() !== ''); };

  function codeAnnehmen(text) {
    if (!z.bereich) return;
    const g = liesCode(text);
    if (z.kamera) z.kamera.pause();
    if (!g.ok) {
      setStatus((g.fehler[0] || 'Der Code ist nicht lesbar.') + ' Bitte noch einmal scannen.');
      if (z.kamera) setTimeout(() => z.kamera && z.kamera.weiter(), 1200);
      return;
    }
    if (z.zeilen.length >= MAX_ZEILEN) { setStatus('Das sind genug Zeilen für eine Nachricht. Bitte „Fertig“ tippen.'); return; }
    setStatus('Code gelesen.');
    formularZeigen(g, artikelFinden(artikelListe(), g));
  }

  function zeileUebernehmen() {
    const zeile = formularZeile();
    if (!zeile) return false;
    z.zeilen.push(zeile);
    z.aktuell = null; karte.hidden = true;
    listeZeichnen(); fertigZeigen(); inhaltsCheck();
    return true;
  }

  async function kameraAn() {
    if (z.kamera) return;
    kameraKnopf.hidden = true;
    if (!kameraMoeglich()) { setStatus('Dieses Handy oder dieser Browser erlaubt keine Kamera hier. Tippe die Nummer unter dem Strichcode ein.'); kameraKnopf.hidden = false; return; }
    setStatus('Kamera wird gestartet …');
    try {
      z.kamera = await kameraStarten(video, codeAnnehmen);
      z.weg = z.kamera.weg;
      setStatus('Halte die Kamera auf den Strichcode oder QR-Code.');
      kameraBox.classList.add('an');
    } catch (e) {
      z.kamera = null;
      setStatus(e && e.code === 'verweigert' ? 'Die Kamera ist nicht erlaubt. Erlaube sie in den Einstellungen des Browsers oder tippe die Nummer ein.'
        : e && e.code === 'keine' ? 'Keine Kamera gefunden. Tippe die Nummer unter dem Strichcode ein.' : 'Die Kamera ging nicht an. Tippe die Nummer ein oder versuche es noch einmal.');
      kameraKnopf.hidden = false;
    }
  }
  function kameraAus() {
    if (z.kamera) { z.kamera.stop(); z.kamera = null; }
    kameraBox.classList.remove('an');
  }

  // ---- Ereignisse ----
  zurueck.addEventListener('click', () => o.beiZurueck());
  kameraKnopf.addEventListener('click', kameraAn);
  handKnopf.addEventListener('click', () => { const t = handFeld.value.trim(); if (t) { handFeld.value = ''; codeAnnehmen(t); } });
  handFeld.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handKnopf.click(); } });
  for (const e of [mengeEin, chargeEin, mhdEin, grundSel, chargeSel]) { e.addEventListener('input', () => { inhaltsCheck(); fertigZeigen(); }); e.addEventListener('change', () => { inhaltsCheck(); fertigZeigen(); }); }
  naechster.addEventListener('click', () => {
    if (!zeileUebernehmen()) { o.meldung('Bitte eine Menge eintragen.'); return; }
    setStatus('Nächsten Artikel scannen.');
    if (z.kamera) z.kamera.weiter();
  });
  verwerfen.addEventListener('click', () => {
    z.aktuell = null; karte.hidden = true; fertigZeigen(); inhaltsCheck();
    setStatus('Verworfen. Nächsten Artikel scannen.');
    if (z.kamera) z.kamera.weiter();
  });
  fertig.addEventListener('click', () => {
    if (z.aktuell && !zeileUebernehmen()) { o.meldung('Bitte eine Menge eintragen – oder „Verwerfen“.'); return; }
    const text = nachrichtText(z.bereich, z.zeilen);
    if (!text) { o.meldung('Es gibt noch nichts zu senden.'); return; }
    const bereich = z.bereich;
    kameraAus();
    o.beiFertig(bereich, text);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !wurzel.hidden) { kameraAus(); kameraKnopf.hidden = false; setStatus('Die Kamera ist aus. Tippe auf „Kamera starten“.'); } });

  return {
    // Der Bildschirm geht auf (jemand hat „Scannen“ getippt = die Kamera darf an).
    oeffnen(bereich) {
      if (!SCAN_BEREICHE[bereich]) return false;
      if (z.bereich !== bereich) { z.zeilen = []; z.aktuell = null; karte.hidden = true; }
      z.bereich = bereich; z.art = SCAN_BEREICHE[bereich].art;
      titel.textContent = 'Scannen: ' + SCAN_BEREICHE[bereich].name;
      listeZeichnen(); fertigZeigen(); inhaltsCheck();
      kameraKnopf.hidden = false;
      setStatus('');
      kameraAn();
      return true;
    },
    schliessen() { kameraAus(); },
    // Neu anfangen (nach dem Senden)
    leeren() { z.zeilen = []; z.aktuell = null; karte.hidden = true; listeZeichnen(); fertigZeigen(); },
    // Für Tests: einen Code so behandeln, als hätte die Kamera ihn gelesen
    code: codeAnnehmen,
    zustand: () => ({ bereich: z.bereich, zeilen: [...z.zeilen], formular: !karte.hidden, weg: z.weg, status: z.status, kamera: !!z.kamera }),
  };
}
