/**
 * transcriptGuard.js — deterministic filters for hallucinated or echoed "user" turns on the
 * Gemini Live path.
 *
 * Field evidence (owner transcript, 2026-07-10): committed DU lines contained
 *   - Telugu script that is phonetically GERMAN ("ఆడిషన్ ఆన్ ఫార్మ్…" ≈ "…an Form …") — Gemini's
 *     input transcriber mis-detects the language of echo/noise and writes the words in the wrong
 *     alphabet;
 *   - "Hallo. Hallo. Hallo. Hallo. Hallo." — the classic ASR repeat-loop hallucination on noise;
 *   - the boss's own sentence attributed to DU — speaker echo the browser AEC couldn't fully
 *     cancel, re-transcribed as the candidate.
 * Every one of these was SCORED as a learner answer — a direct feedback-accuracy violation
 * (never grade the learner on a turn the machine mis-heard).
 *
 * All rules are deliberately conservative: a genuine answer must never be dropped. When in doubt,
 * KEEP the turn — a false "garbage" verdict silently deletes a human's real move.
 */

const strip = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Fraction of alphabetic characters that are Latin script (German incl. umlauts is Latin). */
export function latinFraction(text) {
  let latin = 0, letters = 0;
  for (const ch of String(text)) {
    if (/\p{L}/u.test(ch)) {
      letters++;
      if (/\p{Script=Latin}/u.test(ch)) latin++;
    }
  }
  return letters ? latin / letters : 1; // no letters at all → other rules decide
}

/** "Hallo. Hallo. Hallo. Hallo." — ≥4 tokens but ≤2 distinct ones is a hallucination loop,
 *  not speech. "Nein nein nein" (3 tokens) stays: a human says that. */
export function isRepeatLoop(text) {
  const toks = strip(text).split(' ').filter(Boolean);
  if (toks.length < 4) return false;
  return new Set(toks).size <= 2;
}

/** Speaker-echo detector: the "user" turn is a verbatim fragment of the boss's own last line
 *  (normalized containment ONLY — a human clarifying rephrases, reorders, or appends words, and
 *  must never be filtered; AEC residue echoes verbatim). */
export function isBossEcho(text, lastBossLine) {
  if (!lastBossLine) return false;
  const u = strip(text);
  const b = strip(lastBossLine);
  if (!u || u.length < 12) return false; // tiny fragments are judged by the other rules
  return b.includes(u);
}

/**
 * The one verdict the websocket bridge asks for, applied to a COMMITTED whole turn.
 * @returns {{ garbage: boolean, reason: string|null }}
 */
export function isGarbageUserTurn(text, lastBossLine) {
  const t = String(text || '').trim();
  if (!t) return { garbage: true, reason: 'empty' };
  if (latinFraction(t) < 0.5) return { garbage: true, reason: 'wrong_script' };
  if (isRepeatLoop(t)) return { garbage: true, reason: 'repeat_loop' };
  if (isBossEcho(t, lastBossLine)) return { garbage: true, reason: 'boss_echo' };
  return { garbage: false, reason: null };
}

export default { latinFraction, isRepeatLoop, isBossEcho, isGarbageUserTurn };
