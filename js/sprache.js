// Sprechen: Live-Text über die Spracherkennung des Handys + Tonaufnahme als Sicherheit.
// Die Spracherkennung läuft satzweise und startet sich selbst neu, solange die Aufnahme läuft
// (robuster auf Android als der Dauer-Modus, der dort Text doppelt liefert).

const Erkenner = window.SpeechRecognition || window.webkitSpeechRecognition;
export const liveTextMoeglich = !!Erkenner;

export class Aufnahme {
  constructor({ beiText, beiPegel, beiProblem, liveText = true }) {
    this.liveTextGewuenscht = liveText; this.maxPegel = 0;
    this.beiText = beiText; this.beiPegel = beiPegel; this.beiProblem = beiProblem || (() => {});
    this.fest = ''; this.vorlaeufig = ''; this.laeuft = false; this.teile = []; this.start = 0;
  }

  async starten() {
    this.laeuft = true; this.start = Date.now();
    // 1) Tonaufnahme
    try {
      this.strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const typ = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(t => window.MediaRecorder?.isTypeSupported?.(t));
      this.rekorder = new MediaRecorder(this.strom, typ ? { mimeType: typ, audioBitsPerSecond: 32000 } : undefined);
      this.rekorder.ondataavailable = e => { if (e.data.size) this.teile.push(e.data); };
      this.rekorder.start(1000);
      this.pegelStarten();
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { this.laeuft = false; throw new Error('mikrofon'); }
      this.beiProblem('aufnahme');
    }
    // 2) Live-Text
    if (!this.liveTextGewuenscht) return;
    if (Erkenner) this.erkennerStarten(); else this.beiProblem('kein-livetext');
  }

  erkennerStarten() {
    if (!this.laeuft) return;
    const r = new Erkenner();
    r.lang = 'de-DE'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = ev => {
      let fest = '', vor = '';
      for (let i = 0; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) fest += t; else vor += t;
      }
      this.satzFest = fest; this.vorlaeufig = vor;
      this.melden();
    };
    r.onerror = ev => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { this.erkennerAus = true; this.beiProblem('kein-livetext'); }
      else if (ev.error === 'audio-capture') { this.erkennerAus = true; this.beiProblem('kein-livetext'); }
      else if (ev.error === 'network') { this.netzFehler = (this.netzFehler || 0) + 1; if (this.netzFehler > 2) { this.erkennerAus = true; this.beiProblem('livetext-netz'); } }
    };
    r.onend = () => {
      this.uebernehmeSatz();
      if (this.laeuft && !this.erkennerAus) setTimeout(() => this.erkennerStarten(), 150);
    };
    this.erkenner = r;
    try { r.start(); } catch { /* läuft schon */ }
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
        if (this.ac.state === 'running') this.acLief = true;
        if (rms > this.maxPegel) this.maxPegel = rms;
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
    cancelAnimationFrame(this.raf);
    if (this.erkenner) { try { this.erkenner.stop(); } catch {} }
    // kurz warten, damit der letzte Satz noch ankommt
    await new Promise(r => setTimeout(r, 600));
    this.uebernehmeSatz();
    let audio = null;
    if (this.rekorder && this.rekorder.state !== 'inactive') {
      await new Promise(r => { this.rekorder.onstop = r; this.rekorder.stop(); });
      const typ = this.rekorder.mimeType || 'audio/webm';
      if (this.teile.length) audio = new Blob(this.teile, { type: typ });
    }
    this.aufraeumen();
    // Manche Android-Handys geben das Mikrofon nur der Erkennung: dann ist die Aufnahme stumm.
    const stummeAufnahme = !!(this.erkenner && this.fest.trim() && this.acLief && dauer >= 2 && this.maxPegel < 0.5);
    return { text: this.fest.trim(), audio, dauer, stummeAufnahme };
  }

  abbrechen() {
    this.laeuft = false;
    cancelAnimationFrame(this.raf);
    if (this.erkenner) { try { this.erkenner.abort(); } catch {} }
    if (this.rekorder && this.rekorder.state !== 'inactive') { try { this.rekorder.stop(); } catch {} }
    this.aufraeumen();
  }

  aufraeumen() {
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
