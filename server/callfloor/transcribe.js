/**
 * callfloor/transcribe.js — Mode 2's own STT: Groq Whisper (whisper-large-v3-turbo, de), with
 * every audio second logged to ai_usage_events. Mode 1's transcription helpers are not exported,
 * so this is a deliberate small duplicate (RULE ZERO beats DRY across the mode boundary).
 */

import { recordAiUsage } from './usage.js';
import { PRICEBOOK } from './pricebook.config.js';

const STT_MODEL = () => process.env.CALLFLOOR_STT_MODEL || 'whisper-large-v3-turbo';

/** WAV (PCM16 mono 24 kHz, 44-byte header — the ClipRecorder format) duration in seconds. */
export function wavDurationSec(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 44) return 0;
  return (buffer.length - 44) / 2 / 24000;
}

/** → { text, durationSec }. Throws on provider failure (caller decides the honest fallback). */
export async function transcribeCallTurn(buffer, { userId = 'system', mime = 'audio/wav' } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('no_stt_key');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), 'turn.wav');
  form.append('model', STT_MODEL());
  form.append('language', 'de');
  form.append('temperature', '0');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  if (!res.ok) throw new Error(`stt ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  const durationSec = wavDurationSec(buffer);

  const rate = PRICEBOOK['groq:whisper-large-v3-turbo'];
  await recordAiUsage({
    userId, feature: 'callfloor-stt', provider: 'groq', model: STT_MODEL(),
    unitType: 'seconds', unitsIn: durationSec, unitsOut: 0,
    usdActual: (durationSec / 3600) * rate.actual.perHour,
    usdList:   (durationSec / 3600) * rate.list.perHour,
    measured: true,
  });
  return { text: String(data.text || '').trim(), durationSec };
}

export default { transcribeCallTurn, wavDurationSec };
