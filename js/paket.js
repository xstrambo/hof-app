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
