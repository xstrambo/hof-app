// Die Kamera als Scanner (Funktion „scanner“). Die Kamera geht erst an, wenn jemand auf „Scannen“ tippt; das Bild bleibt im Handy und wird nie
// gesendet oder gespeichert – nur der gelesene Code geht weiter.
//
// Zwei Wege, einen Code zu lesen:
//   1. BarcodeDetector des Browsers (Android/Chrome): schnell, nichts nachzuladen.
//   2. Wo es ihn nicht gibt (iPhone/Safari, ältere Browser): die kleine Bibliothek ZXing, die mit der App geliefert wird
//      (vendor/zxing/zxing.min.js, Apache-2.0, vom eigenen Server der App – nichts von fremden Servern).
// Erkannt werden EAN-13, EAN-8, UPC-A, Code 128 / GS1-128, QR und DataMatrix.

export const FORMATE = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code', 'data_matrix'];
export const ZXING_URL = 'vendor/zxing/zxing.min.js';

const ZX_FORMATE = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'QR_CODE', 'DATA_MATRIX'];

export const kameraMoeglich = () => !!(globalThis.navigator && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');

// Ein Bild (Graustufen, 0–255 je Punkt) mit ZXing lesen. Gibt den Text zurück oder null, wenn kein Code zu sehen ist. Reine Rechenarbeit – darum
// auch ohne Kamera zu prüfen (test/zxing.test.mjs, Szenario s82).
export function dekodiereGrau(ZX, grau, breite, hoehe) {
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, ZX_FORMATE.map(f => ZX.BarcodeFormat[f]));
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  const leser = new ZX.MultiFormatReader();
  leser.setHints(hints);
  try {
    const quelle = new ZX.RGBLuminanceSource(grau, breite, hoehe);
    return leser.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(quelle))).getText();
  } catch { return null; }                 // „nichts gefunden“ ist hier der Normalfall
}

let zxingGeladen = null;
// Die Bibliothek bei Bedarf laden (ein <script> vom eigenen Server). Gibt das Objekt ZXing zurück oder wirft einen Fehler.
export function ladeZxing() {
  if (globalThis.ZXing) return Promise.resolve(globalThis.ZXing);
  if (!zxingGeladen) {
    zxingGeladen = new Promise((ok, fehler) => {
      const s = document.createElement('script');
      s.src = ZXING_URL;
      s.onload = () => (globalThis.ZXing ? ok(globalThis.ZXing) : fehler(new Error('zxing')));
      s.onerror = () => { zxingGeladen = null; fehler(new Error('zxing')); };
      document.head.append(s);
    });
  }
  return zxingGeladen;
}

// Welcher Weg gilt hier? 'detector' | 'zxing'
export async function wegWaehlen() {
  try {
    if ('BarcodeDetector' in globalThis && typeof BarcodeDetector.getSupportedFormats === 'function') {
      const da = await BarcodeDetector.getSupportedFormats();
      if (['ean_13', 'qr_code'].every(f => da.includes(f))) return { weg: 'detector', formate: FORMATE.filter(f => da.includes(f)) };
    }
  } catch { /* dann ZXing */ }
  return { weg: 'zxing', formate: FORMATE };
}

// Startet die Kamera im <video>-Element und ruft beiCode(text) für jeden gelesenen Code. Gibt ein Objekt zurück:
//   pause(), weiter(), stop() (Kamera aus), weg (welcher Weg gilt).
// Wirft einen Fehler mit .code = 'verweigert' | 'keine' | 'fehler'.
export async function starten(video, beiCode, { abstandMs = 160 } = {}) {
  if (!kameraMoeglich()) { const e = new Error('keine'); e.code = 'keine'; throw e; }
  let strom;
  try {
    strom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (err) {
    const e = new Error('kamera'); e.code = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'verweigert' : (err && err.name === 'NotFoundError' ? 'keine' : 'fehler'); throw e;
  }
  video.srcObject = strom;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  try { await video.play(); } catch { /* der Browser startet es von allein */ }
  const { weg, formate } = await wegWaehlen();
  let detektor = null, ZX = null;
  try {
    if (weg === 'detector') detektor = new BarcodeDetector({ formats: formate });
    else ZX = await ladeZxing();
  } catch {
    strom.getTracks().forEach(t => t.stop());
    const e = new Error('zxing'); e.code = 'fehler'; throw e;
  }
  const leinwand = document.createElement('canvas');
  const ctx = leinwand.getContext('2d', { willReadFrequently: true });
  let laeuft = true, pausiert = false, timer = 0, zuletzt = '', zuletztZeit = 0;
  async function runde() {
    if (!laeuft) return;
    if (!pausiert && video.readyState >= 2 && video.videoWidth) {
      let text = null;
      try {
        if (detektor) {
          const r = await detektor.detect(video);
          if (r && r.length && r[0].rawValue) text = r[0].rawValue;
        } else {
          const b = Math.min(video.videoWidth, 1280), h = Math.round(video.videoHeight * b / video.videoWidth);
          leinwand.width = b; leinwand.height = h;
          ctx.drawImage(video, 0, 0, b, h);
          const px = ctx.getImageData(0, 0, b, h).data, grau = new Uint8ClampedArray(b * h);
          for (let i = 0, j = 0; i < px.length; i += 4, j++) grau[j] = (306 * px[i] + 601 * px[i + 1] + 117 * px[i + 2] + 512) >> 10;
          text = dekodiereGrau(ZX, grau, b, h);
        }
      } catch { /* ein Bild, das nicht ging: das nächste */ }
      const jetzt = Date.now();
      if (text && !(text === zuletzt && jetzt - zuletztZeit < 2000)) {
        zuletzt = text; zuletztZeit = jetzt;
        if (laeuft && !pausiert) beiCode(text);
      }
    }
    if (laeuft) timer = setTimeout(runde, abstandMs);
  }
  timer = setTimeout(runde, abstandMs);
  return {
    weg,
    pause() { pausiert = true; },
    weiter() { pausiert = false; zuletzt = ''; },
    stop() {
      laeuft = false; clearTimeout(timer);
      strom.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    },
  };
}
