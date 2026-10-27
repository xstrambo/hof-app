// Paket bauen und verschlüsseln.
// Klartext:  "HOF1" | u32 Kopf-Länge | Kopf (JSON) | Dateien hintereinander
// Umschlag:  "HOFE" | 0x01 | 65 Byte Einmal-Schlüssel (P-256, roh) | 12 Byte IV | AES-GCM-Chiffrat
// Schlüssel: ECDH(Einmal-Schlüssel, Laptop-Schlüssel) -> HKDF-SHA256(salt = Einmal-Schlüssel, info = "hof-app v1") -> AES-256-GCM
// Nur der Laptop hat den passenden privaten Schlüssel. Der Briefkasten sieht nur Rauschen.

const enc = new TextEncoder();
const INFO = enc.encode('hof-app v1');

function b64ToBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function packen(kopf, dateien) {
  // dateien: [{name, typ, art, daten: Uint8Array}]
  const meta = { ...kopf, dateien: dateien.map(d => ({ name: d.name, typ: d.typ, art: d.art, groesse: d.daten.byteLength })) };
  const kopfBytes = enc.encode(JSON.stringify(meta));
  const gesamt = 8 + kopfBytes.length + dateien.reduce((s, d) => s + d.daten.byteLength, 0);
  const out = new Uint8Array(gesamt);
  out.set(enc.encode('HOF1'), 0);
  new DataView(out.buffer).setUint32(4, kopfBytes.length);
  out.set(kopfBytes, 8);
  let pos = 8 + kopfBytes.length;
  for (const d of dateien) { out.set(d.daten, pos); pos += d.daten.byteLength; }
  return out;
}

export async function verschluesseln(klartext, laptopSchluesselB64) {
  const laptopRoh = b64ToBytes(laptopSchluesselB64);
  if (laptopRoh.length !== 65 || laptopRoh[0] !== 4) throw new Error('Laptop-Schlüssel ungültig');
  const laptop = await crypto.subtle.importKey('raw', laptopRoh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const einmal = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const einmalRoh = new Uint8Array(await crypto.subtle.exportKey('raw', einmal.publicKey));
  const geteilt = await crypto.subtle.deriveBits({ name: 'ECDH', public: laptop }, einmal.privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', geteilt, 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: einmalRoh, info: INFO },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, klartext));
  const out = new Uint8Array(4 + 1 + 65 + 12 + ct.length);
  out.set(enc.encode('HOFE'), 0);
  out[4] = 1;
  out.set(einmalRoh, 5);
  out.set(iv, 70);
  out.set(ct, 82);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Post vom Laptop (Rückfragen) lesen und Antworten beglaubigen – Gegenstück zu hofpaket.py.
//
// Alles ist Ende-zu-Ende verschlüsselt UND beglaubigt. Der Umschlag ist wie oben, aber der Empfänger ist jetzt das HANDY: Der Laptop
// verschlüsselt für den öffentlichen Schlüssel dieses Handys (er liegt im Briefkasten), und nur das Handy hat den privaten.
// Die Beglaubigung ("HOF2") zeigt, dass die Nachricht wirklich vom Laptop kommt (bzw. wirklich von diesem Handy): Ein HMAC-SHA256 über
// den ganzen Klartext, mit einem Schlüssel, den nur Laptop und Handy aus ihren festen Schlüsseln berechnen können (ECDH, dann HKDF –
// je Richtung ein anderer Schlüssel, damit man eine Nachricht nicht in die andere Richtung zurückspielen kann).
//   Klartext beglaubigt:  "HOF2" | u32 Kopf-Länge | Kopf (JSON) | Dateien | 32 Byte HMAC-SHA256 über alles davor
//   Schlüssel:            HKDF-SHA256(ECDH(eigener fester Schlüssel, fester Schlüssel der Gegenseite), salt = "hof-app",
//                                     info = "hof-app mac v1 " + "l2h" (Laptop an Handy) | "h2l" (Handy an Laptop))
// Der Briefkasten sieht nur Rauschen und kann weder etwas lesen noch etwas unterschieben.
// ---------------------------------------------------------------------------------------------------------------------------
export const L2H = 'l2h';
export const H2L = 'h2l';
const MAC_SALT = enc.encode('hof-app');
const MAC_INFO = 'hof-app mac v1 ';
const MAC_LAENGE = 32;
const dec = new TextDecoder('utf-8', { fatal: true });

export function bytesZuB64(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export { b64ToBytes };

function vorne(bytes, text) {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
}

async function oeffentlichImportieren(b64) {
  const roh = b64ToBytes(b64);
  if (roh.length !== 65 || roh[0] !== 4) throw new Error('Schlüssel ungültig');
  return crypto.subtle.importKey('raw', roh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

// Umschlag öffnen: mit dem privaten Schlüssel dieses Handys (CryptoKey, ECDH, deriveBits).
export async function entschluesseln(umschlag, privatKey) {
  if (umschlag.length < 82 + 16 || !vorne(umschlag, 'HOFE') || umschlag[4] !== 1) throw new Error('kein Hof-App-Umschlag');
  const einmalRoh = umschlag.slice(5, 70);
  const iv = umschlag.slice(70, 82);
  const einmal = await crypto.subtle.importKey('raw', einmalRoh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const geteilt = await crypto.subtle.deriveBits({ name: 'ECDH', public: einmal }, privatKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', geteilt, 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: einmalRoh, info: INFO }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, umschlag.slice(82)));
}

// Der Beglaubigungsschlüssel (HMAC) für eine Richtung: L2H = vom Laptop zum Handy, H2L = vom Handy zum Laptop.
export async function macSchluessel(privatKey, fremderOeffentlichB64, richtung) {
  if (richtung !== L2H && richtung !== H2L) throw new Error('unbekannte Richtung');
  const fremd = await oeffentlichImportieren(fremderOeffentlichB64);
  const geteilt = await crypto.subtle.deriveBits({ name: 'ECDH', public: fremd }, privatKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', geteilt, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: MAC_SALT, info: enc.encode(MAC_INFO + richtung) }, hkdf,
    { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
}

// Aus dem Klartext von packen() (HOF1) die beglaubigte Fassung (HOF2) machen.
export async function beglaubigen(klartextHof1, macKey) {
  if (!vorne(klartextHof1, 'HOF1')) throw new Error('unbekanntes Paketformat');
  const koerper = klartextHof1.slice();
  koerper.set(enc.encode('HOF2'), 0);
  const marke = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, koerper));
  const aus = new Uint8Array(koerper.length + marke.length);
  aus.set(koerper, 0);
  aus.set(marke, koerper.length);
  return aus;
}

// Beglaubigung prüfen. Gibt den Klartext in der Form von packen() (HOF1) zurück, den auspacken() liest – oder wirft einen Fehler.
export async function beglaubigtOeffnen(klartextHof2, macKey) {
  if (klartextHof2.length < 8 + MAC_LAENGE || !vorne(klartextHof2, 'HOF2')) throw new Error('keine beglaubigte Post');
  const koerper = klartextHof2.subarray(0, klartextHof2.length - MAC_LAENGE);
  const marke = klartextHof2.subarray(klartextHof2.length - MAC_LAENGE);
  if (!(await crypto.subtle.verify('HMAC', macKey, marke, koerper))) throw new Error('Beglaubigung stimmt nicht');
  const hof1 = koerper.slice();
  hof1.set(enc.encode('HOF1'), 0);
  return hof1;
}

// Gegenstück zu packen(): { kopf, dateien: [{name, typ, art, groesse, daten}] }
export function auspacken(klartext) {
  if (klartext.length < 8 || !vorne(klartext, 'HOF1')) throw new Error('unbekanntes Paketformat');
  const laenge = new DataView(klartext.buffer, klartext.byteOffset, klartext.byteLength).getUint32(4);
  if (8 + laenge > klartext.length) throw new Error('Paketlänge stimmt nicht');
  const kopf = JSON.parse(dec.decode(klartext.subarray(8, 8 + laenge)));
  if (!kopf || typeof kopf !== 'object' || Array.isArray(kopf)) throw new Error('Kopf unlesbar');
  let pos = 8 + laenge;
  const dateien = [];
  for (const meta of Array.isArray(kopf.dateien) ? kopf.dateien : []) {
    const n = meta && Number.isInteger(meta.groesse) ? meta.groesse : -1;
    if (n < 0 || pos + n > klartext.length) throw new Error('Paketlänge stimmt nicht');
    dateien.push({ ...meta, daten: klartext.slice(pos, pos + n) });
    pos += n;
  }
  if (pos !== klartext.length) throw new Error('Paketlänge stimmt nicht');
  return { kopf, dateien };
}

// Fotos verkleinern, damit sie auch bei schwachem Netz durchgehen.
export async function fotoVerkleinern(datei, maxKante = 2000, qualitaet = 0.85) {
  try {
    const bild = await createImageBitmap(datei, { imageOrientation: 'from-image' });
    const f = Math.min(1, maxKante / Math.max(bild.width, bild.height));
    if (f === 1 && datei.size < 1.5e6) { bild.close?.(); return datei; }
    const c = document.createElement('canvas');
    c.width = Math.round(bild.width * f); c.height = Math.round(bild.height * f);
    c.getContext('2d').drawImage(bild, 0, 0, c.width, c.height);
    bild.close?.();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', qualitaet));
    if (!blob || blob.size >= datei.size) return datei;
    const name = datei.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch { return datei; }
}
