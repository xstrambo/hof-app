// Eine Aufnahme als WAV (16 kHz, mono, 16 Bit) – das Format, das jede Spracherkennung versteht.
// Wozu: Das Handy nimmt als WebM/Opus (Android) oder MP4/AAC (iPhone) auf. Nimmt die Cloud-Erkennung eines dieser Formate nicht an, rechnet die App die
// Aufnahme um und schickt sie noch einmal (js/erkennung.js). Eine Aufnahme von 3 Minuten wird so etwa 5,8 MB groß, darum nur im Notfall.
// Alles läuft im Handy; nichts verlässt es auf diesem Weg.

export const RATE = 16000;

// 16-Bit-WAV aus Messwerten zwischen -1 und 1 (mono)
export function wavVon(pcm, rate = RATE) {
  const n = pcm.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}

export const istWav = blob => /wav/i.test(String((blob && blob.type) || ''));

// Eine Aufnahme (Blob) dekodieren, auf 16 kHz und einen Kanal bringen und als WAV zurückgeben. Wirft, wenn der Browser das nicht kann.
export async function alsWav(blob) {
  const Kontext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Kontext) throw new Error('keine Audio-Umwandlung');
  const dekoder = new Kontext(1, 1, RATE);                              // dekodiert und rechnet dabei auf 16 kHz um
  const roh = await blob.arrayBuffer();
  const buf = await new Promise((ok, nein) => { const p = dekoder.decodeAudioData(roh, ok, nein); if (p && p.then) p.then(ok, nein); });
  const kanaele = Math.max(1, buf.numberOfChannels), n = buf.length, mono = new Float32Array(n);
  for (let c = 0; c < kanaele; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / kanaele; }
  return wavVon(mono, buf.sampleRate || RATE);
}
