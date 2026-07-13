/**
 * salmaVoice.js — ONE brain for every word Salma speaks aloud.
 *
 * Masri is fail-closed. Written Arabic alone is not approval: production requires native review of
 * both the exact line and its frozen audio asset. Until that pack exists, Salma speaks German.
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

// ── Live "is Salma speaking" signal ────────────────────────────────────────────────
// Every word she says goes through salmaModel/salmaSpeak → playNative. We broadcast the
// Real playback start/end lets any <SalmaPortrait> show an honest speaking ring.
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
// Real audio level (0..1) drives only the speaking ring, never a fake mouth layer.
const levelSubs = new Set();
export function emitSalmaLevel(v) { levelSubs.forEach((fn) => { try { fn(v); } catch { /* ignore */ } }); }
export function subscribeSalmaLevel(fn) { levelSubs.add(fn); return () => levelSubs.delete(fn); }
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
  const text = real
    .map((it) => salmaLine(it.key, 'de', it.slots || {}))
    .filter(Boolean).join(' … ');
  return { text, ar: false };
}

/**
 * She MODELS a dynamic German phrase (e.g. the LanguageTool-verified corrected fragment of the
 * candidate's own sentence) in her German voice — the teacher's "listen and repeat" move.
 * salma:true keeps it working from second zero of a fresh account.
 */
export function salmaModel({ apiUrl, token, text, onStart, onError, onEnd }) {
  const cb = withSpeakingSignal({ onStart, onError, onEnd });
  return playNative({ apiUrl, token, text, voice: SALMA_VOICE_DE, salma: true, onLevel: emitSalmaLevel, ...cb });
}

/**
 * Speak reviewed German salmaCopy items. Masri ships only as a separate frozen asset pack.
 */
export function salmaSpeak({ apiUrl, token, items, dePrefix, onStart, onError, onEnd }) {
  const { text } = composeSalmaSpoken(items);
  const spoken = [dePrefix, text].filter(Boolean).join(' … ');
  if (!spoken) { try { onEnd?.(); } catch { /* ignore */ } return () => {}; }
  // salma:true = the server-side plan-gate exemption for her own fixed lines: her voice must work
  // from second zero of a fresh account (the trial clock only starts at the first interview).
  const cb = withSpeakingSignal({ onStart, onError, onEnd });
  return playNative({ apiUrl, token, text: spoken, voice: SALMA_VOICE_DE, salma: true, onLevel: emitSalmaLevel, ...cb });
}
