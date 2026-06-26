/**
 * audioGuard.js — the honest "did they ACTUALLY speak?" gate.
 *
 * Whisper/Deepgram HALLUCINATE plausible text from silence or noise. Scoring that = fake feedback
 * (the worst thing this app can do). Every audio-scored feature must reject clips with no real voiced
 * speech BEFORE transcribing/scoring. Input is the WAV the client records (PCM16, 24 kHz mono, 44-byte
 * RIFF header — see clipRecorder.js). Pure measurement, no model.
 */
const RATE = 24000, WIN = 480, FLOOR = 0.012 * 32768;   // 20 ms windows; RMS floor ~ matches client VAD onset

// Milliseconds of ACTUAL voiced audio in the clip (RMS energy above the floor). 0 = silence/noise.
export function voicedDurationMs(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length <= 44 + WIN * 2) return 0;
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
    const nSamples = (buffer.length - 44) >> 1;
    let voiced = 0;
    for (let i = 0; i + WIN <= nSamples; i += WIN) {
      let sum = 0;
      for (let j = 0; j < WIN; j++) { const s = view.getInt16(44 + ((i + j) << 1), true); sum += s * s; }
      if (Math.sqrt(sum / WIN) >= FLOOR) voiced++;
    }
    return Math.round(voiced * (WIN / RATE) * 1000);
  } catch { return 0; }
}

// At least ~0.6 s of real voiced audio = a genuine attempt. Below that → silence/noise; never score it.
export function hasRealSpeech(buffer, minMs = 600) {
  return voicedDurationMs(buffer) >= minMs;
}
