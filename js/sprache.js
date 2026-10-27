// Sprechen: Live-Text über die Spracherkennung des Handys. Klappt die nicht, nimmt die App stattdessen auf.
//
// Warum nicht beides gleichzeitig? Auf vielen Android-Handys kann immer nur EINES das Mikrofon haben:
// Hält die Tonaufnahme es fest, bekommt die Spracherkennung keinen Ton (Fehler "audio-capture" oder
// einfach kein Ergebnis) – und der Live-Text bleibt aus. Darum:
//   1. Zuerst läuft NUR die Spracherkennung (satzweise, startet sich selbst neu). Kein Zugriff aufs Mikrofon
//      daneben. Die Anzeige "hört zu" kommt aus den Ereignissen der Erkennung.
//   2. Fällt sie aus (gibt es nicht, gesperrt, kein Netz, liefert nichts), wird sie beendet und ERST DANACH
//      die Tonaufnahme gestartet. Schon erkannter Text bleibt erhalten. Den Rest schreibt der Laptop ab.

const Erkenner = window.SpeechRecognition || window.webkitSpeechRecognition;
export const liveTextMoeglich = !!Erkenner;

const FRIST_SPRACHE_OHNE_TEXT = 6000; // Sprache wird gehört, aber so lange kommt kein Text heraus -> umschalten
const FRIST_SPAETER = 15000;          // dasselbe, nachdem die Erkennung schon geliefert hat (Lärm im Stall): mehr Geduld
const FRIST_GAR_NICHTS = 12000;       // so lange noch gar kein Text erkannt (auch keine Sprache gehört) -> umschalten
const NETZ_VERSUCHE = 2;              // bei Netzfehlern so oft neu versuchen, dann umschalten
const MIK_FREI_PAUSE = 300;           // kurze Pause, bis das Handy das Mikrofon nach der Erkennung wirklich freigegeben hat

export class Aufnahme {
  // beiText(fest, vorlaeufig)  neuer Text
  // beiPegel(0..1)             Ausschlag der Anzeige (echter Pegel bei Aufnahme, sonst "hört zu" aus den Ereignissen)
  // beiWechsel(grund)          Live-Text geht nicht, es wird stattdessen aufgenommen (grund: netz | fehlt | aus | stumm | ...)
  // beiProblem(art)            'mikrofon' (nicht erlaubt) oder 'aufnahme' (geht nicht): es läuft gar nichts mehr
  constructor({ beiText, beiPegel, beiProblem, beiWechsel, liveText = true }) {
    this.liveTextGewuenscht = liveText;
    this.beiText = beiText; this.beiPegel = beiPegel || (() => {});
    this.beiProblem = beiProblem || (() => {}); this.beiWechsel = beiWechsel || (() => {});
    this.fest = ''; this.satzFest = ''; this.vorlaeufig = '';
    this.laeuft = false; this.modus = null; // 'livetext' | 'wechsel' | 'aufnahme'
    this.teile = []; this.start = 0; this.aufnahmeStart = 0;
    this.erkenner = null; this.erkennerAktiv = false; this.wechsel = null;
    this.ergebnisse = 0; this.netzFehler = 0; this.captureFehler = 0; this.schnelleEnden = 0; this.neustartIn = 0;
    this.hoerSumme = 0; this.hoertSeit = 0; this.letzteAktivitaet = 0; this.pegelWert = 0;
    this.textVorWechsel = false;
    this.sicht = () => this.sichtbarkeit();
  }

  async starten() {
    this.laeuft = true; this.start = this.wachStart = Date.now();
    document.addEventListener('visibilitychange', this.sicht);
    if (this.liveTextGewuenscht && Erkenner && navigator.onLine !== false) {
      this.modus = 'livetext';
      this.wachhundStarten(); this.pegelSpielStarten();
      this.erkennerStarten(); // gleich hier, solange der Fingertipp noch zählt; kein Mikrofon-Zugriff daneben
      return;
    }
    // Live-Text geht von vornherein nicht (oder kein Netz): gleich aufnehmen
    this.modus = 'aufnahme';
    this.beiWechsel(!this.liveTextGewuenscht ? 'aus' : !Erkenner ? 'fehlt' : 'netz');
    try { await this.aufnahmeStarten(); }
    catch (e) { this.laeuft = false; this.aufraeumen(); throw e; }
  }

  // ---------- Live-Text ----------
  erkennerStarten() {
    if (!this.laeuft || this.modus !== 'livetext' || this.erkennerAktiv) return;
    if (document.visibilityState === 'hidden') return; // im Hintergrund nicht; kommt die App zurück, geht es weiter
    let r;
    try { r = new Erkenner(); } catch { this.zuAufnahme('start'); return; } // kaputte Erkennung (z. B. manche WebViews)
    r.lang = 'de-DE'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    const gilt = () => this.erkenner === r; // Ereignisse eines abgelösten Erkenners ignorieren
    const sitzung = { start: Date.now(), zeichen: false }; // zeichen: die Erkennung hat sich irgendwie gemeldet
    const hoerEnde = () => { if (this.hoertSeit) { this.hoerSumme += Date.now() - this.hoertSeit; this.hoertSeit = 0; } };
    r.onaudiostart = () => { if (gilt()) sitzung.zeichen = true; };
    r.onsoundstart = () => { if (gilt()) { sitzung.zeichen = true; this.aktiv(); } };
    r.onspeechstart = () => {
      if (!gilt()) return;
      sitzung.zeichen = true; this.aktiv();
      if (!this.hoertSeit) this.hoertSeit = Date.now();
    };
    r.onspeechend = () => { if (gilt()) hoerEnde(); };
    r.onresult = ev => {
      if (!gilt()) return;
      let fest = '', vor = '';
      for (let i = 0; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) fest += t; else vor += t;
      }
      sitzung.zeichen = true;
      if (!(fest + vor).trim()) return; // leeres Ergebnis: schon erkannten Text nicht überschreiben
      this.satzFest = fest; this.vorlaeufig = vor;
      // die Erkennung liefert: Fehlerzähler und Wartezeit zurück auf null
      this.ergebnisse++; this.netzFehler = 0; this.captureFehler = 0; this.schnelleEnden = 0;
      this.hoerSumme = 0; if (this.hoertSeit) this.hoertSeit = Date.now();
      this.aktiv();
      this.melden();
    };
    r.onerror = ev => {
      if (!gilt() || document.visibilityState === 'hidden') return; // im Hintergrund gibt Android das Mikrofon ab
      const f = ev && ev.error;
      if (f === 'not-allowed' || f === 'service-not-allowed' || f === 'language-not-supported') this.zuAufnahme(f);
      else if (f === 'audio-capture') { if (++this.captureFehler > 1) this.zuAufnahme(f); else this.neustartIn = 400; }
      else if (f === 'network') { if (++this.netzFehler > NETZ_VERSUCHE) this.zuAufnahme('netz'); }
      // 'no-speech' und 'aborted': nichts tun, onend startet den nächsten Satz
    };
    r.onend = () => {
      if (!gilt()) return;
      this.erkennerAktiv = false; hoerEnde();
      this.uebernehmeSatz();
      if (!this.laeuft || this.modus !== 'livetext') return;
      // Endet die Erkennung immer wieder sofort und ohne jedes Lebenszeichen: aufgeben statt endlos neu zu starten
      this.schnelleEnden = !sitzung.zeichen && Date.now() - sitzung.start < 400 ? this.schnelleEnden + 1 : 0;
      if (this.schnelleEnden >= 5) { this.zuAufnahme('ausfall'); return; }
      const warte = this.neustartIn || 150; this.neustartIn = 0;
      clearTimeout(this.neustartTimer);
      this.neustartTimer = setTimeout(() => this.erkennerStarten(), warte);
    };
    this.erkenner = r; this.erkennerAktiv = true;
    try { r.start(); } catch { this.erkennerAktiv = false; this.zuAufnahme('start'); }
  }

  uebernehmeSatz() {
    const s = (this.satzFest || this.vorlaeufig || '').trim();
    if (s) this.fest = verbinde(this.fest, s);
    this.satzFest = ''; this.vorlaeufig = '';
    this.melden();
  }

  melden() {
    const zwischen = (this.satzFest || '') + (this.vorlaeufig ? ' ' + this.vorlaeufig : '');
    this.beiText(this.fest, zwischen.trim());
  }

  textBisher() { return (this.fest + ' ' + (this.satzFest || this.vorlaeufig || '')).trim(); }

  // Kommt die App aus dem Hintergrund zurück: Fristen neu zählen und die Erkennung wieder anwerfen.
  sichtbarkeit() {
    if (!this.laeuft || document.visibilityState !== 'visible') return;
    this.wachStart = Date.now();
    if (this.modus === 'livetext' && !this.erkennerAktiv) { clearTimeout(this.neustartTimer); this.erkennerStarten(); }
  }

  // Meldet sich die Erkennung nicht (kein Text trotz Sprache, oder gar nichts), geht es auf Aufnahme über.
  wachhundStarten() {
    this.wachhund = setInterval(() => {
      if (!this.laeuft || this.modus !== 'livetext' || document.visibilityState === 'hidden') return;
      const jetzt = Date.now();
      const gehoert = this.hoerSumme + (this.hoertSeit ? jetzt - this.hoertSeit : 0);
      if (gehoert >= (this.ergebnisse ? FRIST_SPAETER : FRIST_SPRACHE_OHNE_TEXT)) this.zuAufnahme('stumm');
      else if (!this.ergebnisse && jetzt - this.wachStart >= FRIST_GAR_NICHTS) this.zuAufnahme('stumm');
    }, 500);
  }

  // "Hört zu": echten Pegel gibt es hier nicht (das Mikrofon gehört der Erkennung), also kommt der Ausschlag
  // aus ihren Ereignissen (Ton, Sprache, neuer Text). Ohne Ereignisse bleibt die Anzeige ruhig.
  pegelSpielStarten() {
    this.pegelTimer = setInterval(() => {
      if (this.modus !== 'livetext') return;
      const hoert = this.hoertSeit || Date.now() - this.letzteAktivitaet < 700;
      this.pegelWert = hoert ? 0.5 * this.pegelWert + 0.5 * (0.25 + 0.75 * Math.random()) : this.pegelWert * 0.6;
      this.beiPegel(Math.max(0.02, this.pegelWert));
    }, 90);
  }
  aktiv() { this.letzteAktivitaet = Date.now(); }

  // ---------- Umschalten auf reine Aufnahme ----------
  zuAufnahme(grund) {
    if (!this.laeuft || this.modus !== 'livetext') return this.wechsel;
    this.modus = 'wechsel';
    this.timerStoppen();
    this.wechsel = (async () => {
      try {
        await this.erkennerLoesen(grund === 'stumm'); // Text sichern, Erkennung beenden, warten bis das Mikrofon frei ist
        if (!this.laeuft) return;
        this.modus = 'aufnahme';
        this.beiWechsel(grund);
        await this.aufnahmeStarten();
      } catch (e) {
        if (this.laeuft) this.beiProblem(e && e.message === 'mikrofon' ? 'mikrofon' : 'aufnahme');
      }
    })();
    return this.wechsel;
  }

  // sanft: mit stop() statt abort() beenden, damit die Erkennung noch ausgibt, was sie schon gehört hat
  // (nützlich, wenn sie nur "hängt" und nicht kaputt ist). Sonst ist sie schon ausgefallen: abbrechen.
  erkennerLoesen(sanft) {
    const r = this.erkenner;
    clearTimeout(this.neustartTimer);
    const sichern = () => { this.uebernehmeSatz(); this.textVorWechsel = !!this.fest.trim(); }; // Zwischentext nicht verlieren
    if (!r || !this.erkennerAktiv) { this.erkenner = null; this.erkennerAktiv = false; sichern(); return Promise.resolve(); }
    return new Promise(ok => {
      let fertig = false;
      const weiter = () => {
        if (fertig) return; fertig = true; clearTimeout(t);
        this.erkenner = null; this.erkennerAktiv = false; sichern();
        setTimeout(ok, MIK_FREI_PAUSE);
      };
      const t = setTimeout(weiter, sanft ? 2000 : 1200); // spätestens dann weiter, auch wenn "end" nie kommt
      if (!sanft) r.onaudiostart = r.onsoundstart = r.onspeechstart = r.onspeechend = r.onresult = r.onerror = null;
      r.onend = weiter;
      try { if (sanft) r.stop(); else r.abort(); } catch { weiter(); }
    });
  }

  // Beendet die Erkennung und wartet, bis der letzte Satz angekommen ist (stop() liefert ihn noch).
  erkennerAnhalten() {
    const r = this.erkenner;
    if (!r || !this.erkennerAktiv) { this.erkenner = null; return Promise.resolve(); }
    return new Promise(ok => {
      const fertig = () => { clearTimeout(t); this.erkennerAktiv = false; this.erkenner = null; ok(); };
      const t = setTimeout(fertig, 2000);
      r.onend = fertig;
      try { r.stop(); } catch { fertig(); }
    });
  }

  // ---------- Tonaufnahme ----------
  // Wirft Error('mikrofon'), wenn das Mikrofon nicht erlaubt ist, sonst Error('aufnahme').
  async aufnahmeStarten() {
    let strom;
    try {
      strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      throw new Error(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'mikrofon' : 'aufnahme');
    }
    if (!this.laeuft) { strom.getTracks().forEach(t => t.stop()); return; } // inzwischen beendet oder abgebrochen
    try {
      const typ = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(t => window.MediaRecorder?.isTypeSupported?.(t));
      const rekorder = new MediaRecorder(strom, typ ? { mimeType: typ, audioBitsPerSecond: 32000 } : undefined);
      rekorder.ondataavailable = e => { if (e.data.size) this.teile.push(e.data); };
      rekorder.start(1000);
      this.strom = strom; this.rekorder = rekorder; this.aufnahmeStart = Date.now();
    } catch {
      strom.getTracks().forEach(t => t.stop());
      throw new Error('aufnahme');
    }
    this.pegelStarten();
  }

  pegelStarten() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC();
      const quelle = this.ac.createMediaStreamSource(this.strom);
      const an = this.ac.createAnalyser(); an.fftSize = 512;
      quelle.connect(an);
      const puffer = new Uint8Array(an.fftSize);
      const schritt = () => {
        if (!this.laeuft) return;
        an.getByteTimeDomainData(puffer);
        let s = 0; for (const v of puffer) s += (v - 128) ** 2;
        const rms = Math.sqrt(s / puffer.length);
        this.beiPegel(Math.min(1, rms / 40));
        this.raf = requestAnimationFrame(schritt);
      };
      schritt();
    } catch { /* ohne Pegel */ }
  }

  dauer() { return Math.round((Date.now() - this.start) / 1000); }

  async beenden() {
    const dauer = this.dauer();
    this.laeuft = false;
    this.timerStoppen();
    try {
      if (this.wechsel) { try { await this.wechsel; } catch { /* schon gemeldet */ } }
      await this.erkennerAnhalten();
      this.uebernehmeSatz();
      let audio = null, audioDauer = 0;
      if (this.rekorder && this.rekorder.state !== 'inactive') {
        audioDauer = Math.max(1, Math.round((Date.now() - this.aufnahmeStart) / 1000));
        // Kommt "stop" nie an (kommt auf manchen Geräten vor), nach 4 s mit dem weitermachen, was da ist
        await new Promise(r => { this.rekorder.onstop = r; this.rekorder.stop(); setTimeout(r, 4000); });
        const typ = this.rekorder.mimeType || 'audio/webm';
        if (this.teile.length) audio = new Blob(this.teile, { type: typ });
      }
      // teilweise: ein Teil steht schon als Text da, der Rest nur in der Aufnahme
      return { text: this.fest.trim(), audio, dauer, audioDauer: audio ? audioDauer : 0, teilweise: !!(audio && this.textVorWechsel) };
    } finally {
      this.aufraeumen(); // Mikrofon wird in jedem Fall freigegeben, auch wenn oben etwas schiefgeht
    }
  }

  abbrechen() {
    this.laeuft = false;
    this.timerStoppen();
    const r = this.erkenner; this.erkenner = null;
    if (r) {
      r.onaudiostart = r.onsoundstart = r.onspeechstart = r.onspeechend = r.onresult = r.onerror = r.onend = null;
      try { r.abort(); } catch {}
    }
    this.erkennerAktiv = false;
    if (this.rekorder && this.rekorder.state !== 'inactive') { try { this.rekorder.stop(); } catch {} }
    this.aufraeumen();
  }

  timerStoppen() {
    clearInterval(this.wachhund); clearInterval(this.pegelTimer); clearTimeout(this.neustartTimer);
    cancelAnimationFrame(this.raf);
  }

  aufraeumen() {
    this.timerStoppen();
    document.removeEventListener('visibilitychange', this.sicht);
    this.strom?.getTracks().forEach(t => t.stop());
    this.ac?.close?.().catch(() => {});
  }
}

function verbinde(a, b) {
  if (!a) return gross(b);
  const endeSatz = /[.!?]$/.test(a);
  return a + (endeSatz ? ' ' + gross(b) : ' ' + b);
}
function gross(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
