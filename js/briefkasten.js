// Verbindung zum Briefkasten (Supabase-Funktion "briefkasten").
// Alle Aufrufe gehen an EINE Funktion; das Gerät weist sich mit seinem Geräte-Schlüssel aus.
// Für Tests gibt es eine Attrappe, die alles im Browser behält.

export class BriefkastenFehler extends Error {
  constructor(code, text) { super(text || code); this.code = code; }
}

export function briefkastenFuer(config) {
  if (config.attrappe) return new Attrappe();
  return new Echt(config.funktionUrl, config.oeffentlicherSchluessel, config.testFunktionUrl);
}

class Echt {
  constructor(url, anonSchluessel, testUrl = '') { this.url = url; this.anon = anonSchluessel; this.testUrl = typeof testUrl === 'string' ? testUrl.trim() : ''; }

  kopf(aktion, token) {
    const kopf = { 'x-hof-aktion': aktion };
    if (this.anon) { kopf.apikey = this.anon; kopf.authorization = 'Bearer ' + this.anon; }
    if (token) kopf['x-hof-token'] = token;
    return kopf;
  }

  async rufe(aktion, daten = {}, token, koerper, url = this.url) {
    const kopf = this.kopf(aktion, token);
    let body;
    if (koerper) {
      kopf['content-type'] = 'application/octet-stream';
      kopf['x-hof-daten'] = encodeURIComponent(JSON.stringify(daten));
      body = koerper;
    } else {
      kopf['content-type'] = 'application/json';
      body = JSON.stringify(daten);
    }
    let r;
    try { r = await fetch(url, { method: 'POST', headers: kopf, body }); }
    catch { throw new BriefkastenFehler('netz', 'Kein Netz'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new BriefkastenFehler(j.fehler || 'server', j.text);
    return j;
  }

  // Antwort als rohe Bytes (ein verschlüsselter Umschlag)
  async rufeRoh(aktion, daten = {}, token, url = this.url) {
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { ...this.kopf(aktion, token), 'content-type': 'application/json' }, body: JSON.stringify(daten) }); }
    catch { throw new BriefkastenFehler('netz', 'Kein Netz'); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new BriefkastenFehler(j.fehler || 'server', j.text); }
    return new Uint8Array(await r.arrayBuffer());
  }

  // Rückfragen vom Laptop (neue Aktionen). Solange sie nur in der Test-Fassung des Briefkastens laufen, geht der Test-Modus dorthin
  // (testFunktionUrl in config.js); danach steht dort nichts mehr und alles läuft über die eine Funktion.
  ziel(test) { return test && this.testUrl ? this.testUrl : this.url; }
  antwortenListe(token, test = false) { return this.rufe('antworten_liste', {}, token, undefined, this.ziel(test)); }
  antwortHolen(token, id, test = false) { return this.rufeRoh('antwort_holen', { id }, token, this.ziel(test)); }
  antwortQuittieren(token, id, test = false) { return this.rufe('antwort_quittieren', { id }, token, undefined, this.ziel(test)); }
  schluesselSetzen(token, schluessel, test = false) { return this.rufe('schluessel_setzen', { schluessel }, token, undefined, this.ziel(test)); }

  anmelden(code, name, schluessel) { return this.rufe('anmelden', { code, name, schluessel }); }
  status(token) { return this.rufe('status', {}, token); }
  senden(token, id, umschlag, ziel = 'echt') { return this.rufe('senden', { id, ziel }, token, umschlag); }
  quittungen(token, ids) { return this.rufe('quittungen', { ids }, token); }
  verwaltung(token) { return this.rufe('verwaltung', {}, token); }
  einladen(token) { return this.rufe('einladen', {}, token); }
  freigeben(token, geraet, ja) { return this.rufe('freigeben', { geraet, ja }, token); }
  sperren(token, geraet) { return this.rufe('sperren', { geraet }, token); }
}

// ---- Attrappe: spielt den Briefkasten im Browser nach (localStorage) ----
const AK = 'hof-attrappe';
class Attrappe {
  lies() {
    try { return JSON.parse(localStorage.getItem(AK)) || null; } catch { return null; }
  }
  schreib(z) { localStorage.setItem(AK, JSON.stringify(z)); }
  zustand() {
    let z = this.lies();
    if (!z) {
      z = { geraete: [], einladungen: [{ code: 'ADM-1N1', rolle: 'admin', bis: Date.now() + 7 * 864e5, benutzt: false }], sendungen: {} };
      this.schreib(z);
    }
    return z;
  }
  async warte() {
    await new Promise(r => setTimeout(r, 40));
    if (localStorage.getItem(AK + '-offline') === '1') throw new BriefkastenFehler('netz', 'Kein Netz');
  }
  geraet(z, token) {
    const g = z.geraete.find(g => g.token === token);
    if (!g) throw new BriefkastenFehler('unbekannt', 'Gerät unbekannt');
    return g;
  }
  admin(z, token) {
    const g = this.geraet(z, token);
    if (g.rolle !== 'admin' || g.status !== 'frei') throw new BriefkastenFehler('verboten', 'Nur für Niklas');
    return g;
  }
  async anmelden(code, name, schluessel) {
    await this.warte();
    const z = this.zustand();
    code = normCode(code);
    const e = z.einladungen.find(e => e.code === code && !e.benutzt && e.bis > Date.now());
    if (!e) throw new BriefkastenFehler('code', 'Code ungültig');
    e.benutzt = true;
    const g = { id: zufall(8), token: zufall(24), name, rolle: e.rolle, code, schluessel, status: e.rolle === 'admin' ? 'frei' : 'wartet', seit: Date.now() };
    z.geraete.push(g);
    this.schreib(z);
    return { token: g.token, geraet: g.id, rolle: g.rolle, status: g.status };
  }
  async status(token) {
    await this.warte();
    const g = this.geraet(this.zustand(), token);
    return { status: g.status, rolle: g.rolle, name: g.name };
  }
  async senden(token, id, umschlag, ziel = 'echt') {
    await this.warte();
    const z = this.zustand();
    const g = this.geraet(z, token);
    if (g.status !== 'frei') throw new BriefkastenFehler('nicht_frei', 'Noch nicht freigegeben');
    const roh = new Uint8Array(await new Blob([umschlag]).arrayBuffer());
    if (!z.sendungen[id]) z.sendungen[id] = { von: g.id, groesse: roh.length, abgeholt: false, umschlag: bytesZuB64(roh), zeit: Date.now(), ziel };
    this.schreib(z);
    return { ok: true };
  }
  async quittungen(token, ids) {
    await this.warte();
    const z = this.zustand();
    this.geraet(z, token);
    return { abgeholt: ids.filter(id => z.sendungen[id]?.abgeholt) };
  }
  async verwaltung(token) {
    await this.warte();
    const z = this.zustand();
    this.admin(z, token);
    return { geraete: z.geraete.filter(g => g.rolle !== 'laptop' && g.status !== 'gesperrt').map(({ token, ...g }) => g) };
  }
  async einladen(token) {
    await this.warte();
    const z = this.zustand();
    this.admin(z, token);
    let code; do { code = neuerCode(); } while (z.einladungen.some(e => e.code === code));
    z.einladungen.push({ code, rolle: 'mitglied', bis: Date.now() + 7 * 864e5, benutzt: false });
    this.schreib(z);
    return { code, bis: Date.now() + 7 * 864e5 };
  }
  async freigeben(token, geraet, ja) {
    await this.warte();
    const z = this.zustand();
    this.admin(z, token);
    const g = z.geraete.find(g => g.id === geraet);
    if (g) { g.status = ja ? 'frei' : 'gesperrt'; g.seit = Date.now(); }
    this.schreib(z);
    return { ok: true };
  }
  async sperren(token, geraet) { return this.freigeben(token, geraet, false); }

  // Rückfragen vom Laptop: in der Attrappe liegen sie in z.antworten ({id, instanz, umschlag als Base64}); zum Ausprobieren im Browser.
  async antwortenListe(token) {
    await this.warte();
    const z = this.zustand();
    const g = this.geraet(z, token);
    return { hat_schluessel: !!g.schluessel, antworten: (z.antworten || []).filter(a => a.an === g.id && !a.abgeholt).map(({ id, instanz }) => ({ id, instanz, groesse: 1 })) };
  }
  async antwortHolen(token, id) {
    await this.warte();
    const z = this.zustand();
    const g = this.geraet(z, token);
    const a = (z.antworten || []).find(x => x.id === id && x.an === g.id && !x.abgeholt);
    if (!a) throw new BriefkastenFehler('fehlt', 'nicht da');
    return Uint8Array.from(atob(a.umschlag), c => c.charCodeAt(0));
  }
  async antwortQuittieren(token, id) {
    await this.warte();
    const z = this.zustand();
    const g = this.geraet(z, token);
    const a = (z.antworten || []).find(x => x.id === id && x.an === g.id);
    if (a) { a.abgeholt = true; a.umschlag = null; this.schreib(z); }
    return { ok: true };
  }
  async schluesselSetzen(token, schluessel) {
    await this.warte();
    const z = this.zustand();
    const g = this.geraet(z, token);
    if (g.schluessel && g.schluessel !== schluessel) throw new BriefkastenFehler('schluessel_vorhanden', 'schon vorhanden');
    g.schluessel = schluessel;
    this.schreib(z);
    return { ok: true };
  }
}

const ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O, 1/I
export function neuerCode() {
  const z = crypto.getRandomValues(new Uint8Array(6));
  const s = [...z].map(b => ZEICHEN[b % ZEICHEN.length]).join('');
  return s.slice(0, 3) + '-' + s.slice(3);
}
export function normCode(c) {
  const s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 6 ? s.slice(0, 3) + '-' + s.slice(3) : s;
}
function zufall(n) { return [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join(''); }
function bytesZuB64(b) { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }
