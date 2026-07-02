/**
 * geminiAudio.js — PCM resampling for the Gemini Live bridge.
 *
 * The browser mic (ClipRecorder) captures PCM16 mono @24 kHz — the rate the Deepgram $0 path wants.
 * Gemini Live's input contract is PCM16 mono @16 kHz. Forwarding the 24 kHz bytes tagged as 16 kHz
 * (the latent bug in the half-wired integration) makes Gemini hear everything ~1.5× too fast / wrong
 * pitch. We downsample 24 kHz → 16 kHz (a 3:2 ratio) with linear interpolation before forwarding.
 *
 * Speech energy above 8 kHz is negligible, so decimation without a steep anti-alias filter is fine
 * for this path; linear interpolation keeps it cheap ($0, per-chunk, on the hot audio path).
 */

const IN_RATE  = 24000;
const OUT_RATE = 16000;

/**
 * Downsample a Buffer of PCM16 mono little-endian samples from 24 kHz to 16 kHz.
 * @param {Buffer} buf  PCM16 LE @24kHz
 * @returns {Buffer}    PCM16 LE @16kHz  (length ≈ input * 2/3)
 */
export function downsamplePcm24to16(buf) {
  if (!buf || buf.length < 2) return Buffer.alloc(0);
  const inSamples  = buf.length >> 1;                       // 2 bytes per Int16 sample
  const outSamples = Math.floor(inSamples * OUT_RATE / IN_RATE);
  const out = Buffer.allocUnsafe(outSamples * 2);
  const step = IN_RATE / OUT_RATE;                          // 1.5 source samples per output sample
  for (let i = 0; i < outSamples; i++) {
    const srcPos = i * step;
    const j = Math.floor(srcPos);
    const frac = srcPos - j;
    const s0 = buf.readInt16LE(j * 2);
    const s1 = (j + 1 < inSamples) ? buf.readInt16LE((j + 1) * 2) : s0;
    let v = Math.round(s0 + (s1 - s0) * frac);              // linear interpolation between neighbours
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    out.writeInt16LE(v, i * 2);
  }
  return out;
}

export default { downsamplePcm24to16 };
