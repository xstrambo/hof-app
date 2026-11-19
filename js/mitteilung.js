// Mitteilung aufs Handy, wenn eine Anmeldung bestätigt werden soll (A064, Stufe 2, Funktion „anmelde_mitteilung“). Logik ohne Oberfläche.
// Der Laptop schickt die Mitteilung selbst an den Mitteilungs-Dienst dieses Handys (Web Push); der Briefkasten im Netz ist nicht beteiligt.
//  - Der Laptop schickt dem Handy seinen öffentlichen Schlüssel für Mitteilungen (beglaubigte Nachricht „mitteilung_schluessel“, nichts Geheimes). Er landet im Stand (stand.mitteilung).
//  - „Mitteilungen einschalten“: Das Handy fragt die Erlaubnis, meldet im Service-Worker ein Abo mit diesem Schlüssel an und schickt das Abo (Adresse des Dienstes und zwei
//    öffentliche Angaben) als beglaubigte Nachricht „mitteilung_abo“ an den Laptop – derselbe Weg wie „anmelde_handy“. „Ausschalten“ meldet das Abo ab.
import { macSchluessel, packen, beglaubigen, verschluesseln, H2L } from './paket.js';
import { normModus, schluesselFuer } from './modus.js';
import { b64u, b64uLesen } from './anmelden.js';

export const MITTEILUNG_SCHLUESSEL = 'mitteilung_schluessel';
export const MITTEILUNG_ABO = 'mitteilung_abo';
const B64U = /^[A-Za-z0-9_-]+$/;
const SCHLUESSEL_ZEICHEN = 87;               // 65 Byte (unkomprimierter P-256-Punkt) als Base64 für Adressen
const WARTEN_MS = 5000;

const istObjekt = x => x !== null && typeof x === 'object' && !Array.isArray(x);

// Der Schlüssel des Laptops: genau 65 Byte, beginnend mit 0x04 – sonst gilt die Nachricht nicht.
export function mitteilungSchluesselKopf(k) {
  if (!istObjekt(k) || k.art !== MITTEILUNG_SCHLUESSEL) return null;
  const s = k.schluessel;
  if (typeof s !== 'string' || s.length !== SCHLUESSEL_ZEICHEN || !B64U.test(s)) return null;
  try { if (b64uLesen(s).length !== 65 || b64uLesen(s)[0] !== 4) return null; } catch { return null; }
  return { art: MITTEILUNG_SCHLUESSEL, schluessel: s };
}

// In den Stand einarbeiten (aus post.js, `anwenden`). Je Instanz der letzte Schlüssel.
export function mitteilungAnwenden(stand, instanz, rohKopf, jetzt = Date.now()) {
  const k = mitteilungSchluesselKopf(rohKopf);
  if (!k) return 'ungueltig';
  if (!istObjekt(stand.mitteilung)) stand.mitteilung = {};
  stand.mitteilung[normModus(instanz)] = { schluessel: k.schluessel, gesehen: jetzt };
  return 'mitteilung';
}

// Beim Laden des Standes (aus post.js, `normStand`): nur gültige Einträge für Echt und Test übernehmen.
export function mitteilungNormieren(roh, aus) {
  if (!istObjekt(roh && roh.mitteilung)) return;
  for (const [k, m] of Object.entries(roh.mitteilung)) {
    if ((k !== 'echt' && k !== 'test') || !istObjekt(m)) continue;
    const g = mitteilungSchluesselKopf({ art: MITTEILUNG_SCHLUESSEL, schluessel: m.schluessel });
    if (g) { if (!istObjekt(aus.mitteilung)) aus.mitteilung = {}; aus.mitteilung[k] = { schluessel: g.schluessel, gesehen: Number.isFinite(m.gesehen) ? m.gesehen : Date.now() }; }
  }
}

export function mitteilungSchluesselFuer(stand, instanz) {
  const m = stand && istObjekt(stand.mitteilung) ? stand.mitteilung[normModus(instanz)] : null;
  return m && typeof m.schluessel === 'string' ? m.schluessel : '';
}

// Kann dieses Handy Mitteilungen bekommen? (Service-Worker, Web Push und Benachrichtigungen)
export function kannMitteilung(fenster = globalThis) {
  const nav = fenster.navigator;
  return !!(nav && 'serviceWorker' in nav && 'PushManager' in fenster && 'Notification' in fenster);
}

async function registrierung(fenster = globalThis) {
  const warten = new Promise((_, nein) => setTimeout(() => nein(new Error('kein Dienst')), WARTEN_MS));
  return Promise.race([fenster.navigator.serviceWorker.ready, warten]);
}

const gleich = (a, b) => {
  const x = new Uint8Array(a || []), y = new Uint8Array(b || []);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// Das jetzige Abo dieses Handys (oder null).
export async function mitteilungAboLesen(fenster = globalThis) {
  try { return await (await registrierung(fenster)).pushManager.getSubscription(); } catch { return null; }
}

// Einschalten: Erlaubnis fragen (nur nach einem Fingertipp), Abo mit dem Schlüssel des Laptops anmelden. Zurück: Adresse und die zwei öffentlichen Angaben des Abos.
// Wirft 'abgelehnt' (Erlaubnis verweigert) oder einen anderen Fehler (kein Dienst, Netz).
export async function mitteilungAnmelden(schluessel, fenster = globalThis) {
  if (!mitteilungSchluesselKopf({ art: MITTEILUNG_SCHLUESSEL, schluessel })) throw new Error('kein Schlüssel');
  const erlaubnis = fenster.Notification.permission === 'granted' ? 'granted' : await fenster.Notification.requestPermission();
  if (erlaubnis !== 'granted') throw new Error('abgelehnt');
  const reg = await registrierung(fenster);
  const wunsch = b64uLesen(schluessel);
  let abo = await reg.pushManager.getSubscription();
  if (abo && !gleich(abo.options && abo.options.applicationServerKey, wunsch)) { await abo.unsubscribe(); abo = null; }   // ein Abo mit einem anderen Schlüssel taugt nicht
  if (!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wunsch });
  const p256dh = abo.getKey('p256dh'), auth = abo.getKey('auth');
  if (!abo.endpoint || !p256dh || !auth) throw new Error('Abo unvollständig');
  return { adresse: abo.endpoint, p256dh: b64u(p256dh), auth: b64u(auth) };
}

// Ausschalten: das Abo beim Dienst abmelden. Zurück: ob es eines gab.
export async function mitteilungAbmelden(fenster = globalThis) {
  const abo = await mitteilungAboLesen(fenster);
  if (!abo) return false;
  try { await abo.unsubscribe(); } catch { /* der Laptop löscht das Abo ohnehin, sobald der Dienst 404/410 meldet */ }
  return true;
}

// Die beglaubigte Meldung an den Laptop: aktion 'an' (mit abo) oder 'aus'. Nichts Geheimes: Gerätename, Kennung, Schlüssel des Laptops und die öffentlichen Angaben des Abos.
export async function mitteilungAboBauen({ aktion, abo, schluessel, instanz, geraet, config, privatKey, jetzt = new Date() }) {
  instanz = normModus(instanz);
  const laptop = schluesselFuer(config, instanz);
  if (!laptop) throw new Error('kein Schlüssel');
  if (aktion !== 'an' && aktion !== 'aus') throw new Error('unbekannte Aktion');
  const kopf = { art: MITTEILUNG_ABO, id: crypto.randomUUID(), ziel: instanz, von: geraet.name, geraet: geraet.id, erstellt: jetzt.toISOString(), aktion, schluessel };
  if (aktion === 'an') {
    if (!abo || typeof abo.adresse !== 'string' || !abo.adresse || abo.adresse.length > 1000 || !B64U.test(abo.p256dh || '') || !B64U.test(abo.auth || '')) throw new Error('Abo unbrauchbar');
    Object.assign(kopf, { adresse: abo.adresse, p256dh: abo.p256dh, auth: abo.auth });
  }
  const mac = await macSchluessel(privatKey, laptop, H2L);
  const klar = await packen(kopf, []);
  return { id: kopf.id, umschlag: await verschluesseln(await beglaubigen(klar, mac), laptop), instanz };
}
