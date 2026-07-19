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

// F-2: rate-aware voiced-ms for RAW PCM16 stream chunks (no WAV header) — the live interview
// streams 24 kHz (Deepgram path) or 16 kHz (Gemini path) mono PCM. Same 20 ms window + RMS floor
// as voicedDurationMs above. Windows never span chunk boundaries, so a partial tail window is
// dropped — a slight UNDERCOUNT, the conservative direction for a trust gate.
export function voicedMsInPcm16(buffer, sampleRate) {
  try {
    if (!Buffer.isBuffer(buffer) || !Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
    const win = Math.max(1, Math.round(sampleRate * 0.02));
    const nSamples = buffer.length >> 1;
    if (nSamples < win) return 0;
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
    let voiced = 0;
    for (let i = 0; i + win <= nSamples; i += win) {
      let sum = 0;
      for (let j = 0; j < win; j++) { const s = view.getInt16((i + j) << 1, true); sum += s * s; }
      if (Math.sqrt(sum / win) >= FLOOR) voiced++;
    }
    return Math.round(voiced * (win / sampleRate) * 1000);
  } catch { return 0; }
}
