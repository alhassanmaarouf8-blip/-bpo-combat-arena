/**
 * salmaVoice.js — ONE brain for every word Salma speaks aloud.
 *
 * The voice rule (owner order 2026-07-12, "full Egyptian masri"): the moment the owner has
 * authored a line's masri (salmaCopy `ar` filled), Salma SPEAKS masri — in BOTH UI languages.
 * She is the Egyptian recruiter; masri is her voice, German is the training room's. While a
 * line's `ar` is still empty she speaks the German original in her native Aura voice, so she
 * is never silent just because a row isn't filled yet.
 *
 * 'salma-masri' is a server voice id: /api/tts-stream routes it to Gemini-TTS steered to Cairo
 * masri (the engine the owner's own ear picked on the Sara compare page) and caches the clip
 * like every other fixed line — replays are instant and free.
 *
 * An utterance = a list of {key, slots, arSlots?}. It goes masri only when EVERY key in it has
 * owner masri (no mid-sentence language flips); `arSlots` lets a caller pass Arabic slot values
 * (e.g. recommendedFocus.ar) for the masri rendering of the same line.
 */
import { playNative } from './nativeVoice.js';
import { SALMA_COPY, salmaLine } from './salmaCopy.js';

export const SALMA_VOICE_DE = 'aura-2-kara-de';
export const SALMA_VOICE_AR = 'salma-masri';

export function composeSalmaSpoken(items) {
  const real = (items || []).filter((it) => it && SALMA_COPY[it.key]);
  const ar = real.length > 0 && real.every((it) => SALMA_COPY[it.key].ar);
  const text = real
    .map((it) => salmaLine(it.key, ar ? 'ar' : 'de', (ar && it.arSlots) || it.slots || {}))
    .filter(Boolean).join(' … ');
  return { text, ar };
}

/**
 * Speak salmaCopy items (masri-first). Returns playNative's stop(). `dePrefix` is an optional
 * German sentence (e.g. the brain directive) prepended ONLY on the German path — it has no masri
 * twin, and gluing German prose into a masri utterance would flip languages mid-breath.
 */
export function salmaSpeak({ apiUrl, token, items, dePrefix, onStart, onError, onEnd }) {
  const { text, ar } = composeSalmaSpoken(items);
  const spoken = ar ? text : [dePrefix, text].filter(Boolean).join(' … ');
  if (!spoken) { try { onEnd?.(); } catch { /* ignore */ } return () => {}; }
  // salma:true = the server-side plan-gate exemption for her own fixed lines: her voice must work
  // from second zero of a fresh account (the trial clock only starts at the first interview).
  return playNative({ apiUrl, token, text: spoken, voice: ar ? SALMA_VOICE_AR : SALMA_VOICE_DE, salma: true, onStart, onError, onEnd });
}
