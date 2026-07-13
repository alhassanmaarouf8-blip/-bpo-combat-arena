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

// Salma's German = Gemini (warm, human, normalized), NOT Deepgram Aura-2 (owner ear 07-12:
// "robotic, low, unhuman"). Same Kore voice as her masri → ONE Salma across both languages.
// Server routes 'salma-de' → geminiGermanTTS; 'salma-masri' → geminiMasriTTS.
export const SALMA_VOICE_DE = 'salma-de';
export const SALMA_VOICE_AR = 'salma-masri';

// ── Live "is Salma speaking" signal ────────────────────────────────────────────────
// Every word she says goes through salmaModel/salmaSpeak → playNative. We broadcast the
// real playback start/end so ANY <SalmaPortrait> on screen moves her mouth exactly while
// her audio plays — no per-call-site wiring. Ref-counted so overlapping utterances behave.
const speakingSubs = new Set();
let speakingCount = 0;
function emitSpeaking() {
  const v = speakingCount > 0;
  speakingSubs.forEach((fn) => { try { fn(v); } catch { /* ignore */ } });
}
export function subscribeSalmaSpeaking(fn) {
  speakingSubs.add(fn);
  try { fn(speakingCount > 0); } catch { /* ignore */ }
  return () => speakingSubs.delete(fn);
}
// Wrap a caller's callbacks so start/end (or error) flip the shared signal exactly once.
function withSpeakingSignal({ onStart, onError, onEnd } = {}) {
  let started = false, done = false;
  const finish = () => { if (started && !done) { done = true; speakingCount = Math.max(0, speakingCount - 1); emitSpeaking(); } };
  return {
    onStart: () => { if (!started) { started = true; speakingCount++; emitSpeaking(); } try { onStart?.(); } catch { /* ignore */ } },
    onError: (e) => { finish(); try { onError?.(e); } catch { /* ignore */ } },
    onEnd: () => { finish(); try { onEnd?.(); } catch { /* ignore */ } },
  };
}

export function composeSalmaSpoken(items) {
  const real = (items || []).filter((it) => it && SALMA_COPY[it.key]);
  const ar = real.length > 0 && real.every((it) => SALMA_COPY[it.key].ar);
  const text = real
    .map((it) => salmaLine(it.key, ar ? 'ar' : 'de', (ar && it.arSlots) || it.slots || {}))
    .filter(Boolean).join(' … ');
  return { text, ar };
}

/**
 * She MODELS a dynamic German phrase (e.g. the LanguageTool-verified corrected fragment of the
 * candidate's own sentence) in her German voice — the teacher's "listen and repeat" move.
 * salma:true keeps it working from second zero of a fresh account.
 */
export function salmaModel({ apiUrl, token, text, onStart, onError, onEnd }) {
  const cb = withSpeakingSignal({ onStart, onError, onEnd });
  return playNative({ apiUrl, token, text, voice: SALMA_VOICE_DE, salma: true, ...cb });
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
  const cb = withSpeakingSignal({ onStart, onError, onEnd });
  return playNative({ apiUrl, token, text: spoken, voice: ar ? SALMA_VOICE_AR : SALMA_VOICE_DE, salma: true, ...cb });
}
