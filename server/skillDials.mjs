/**
 * skillDials.mjs — the 6-dial profile of the Diagnose-Interview (v2 Phase 1 slice 3).
 *
 * Six dials, every one computed DETERMINISTICALLY from the candidate's own answers — the LLM
 * converses and summarizes elsewhere; it never touches a dial. Every dial carries its evidence
 * (how many answers / words it rests on) and fails HONEST: below its floor it is `measurable:false`
 * with a machine `reason`, never a guessed number (D4 / honest-when-thin, the 1202867 clamp class).
 *
 * Copy-free by law (bottleneck-doctrine rule 4): this module emits keys, levels, metrics and
 * reasons — ALL learner-facing German/Arabic renders in the client.
 *
 * Dials:
 *   fluency    — speech rate (voice answers only; typed cannot prove fluency)
 *   vocab      — lexical variety (type-token ratio over enough words)
 *   grammar    — verified spoken-grammar errors per 100 words (LanguageTool count, uncapped;
 *                caller supplies the count so this module stays pure/offline-testable)
 *   structures — subordinate-clause density (complex German attempted, not just chunks)
 *   stability  — did quality HOLD as the adaptive ladder climbed (needs ramp qids)
 *   pronunciation — NEVER measured here. Text cannot judge sound, and no pronunciation claim
 *                ships before the external gold study (07-17 validation program). Pinned by test.
 */
import { RAMP_QUESTIONS, measureAnswer, classifyCoping } from './assessmentRamp.mjs';

const TIER_OF = new Map(RAMP_QUESTIONS.map((q) => [q.id, q.tier]));

// Routing/display thresholds — they pick a coarse band for DISPLAY next to the raw metric
// (the raw number is always shown to the learner, so the band can never hide the truth).
const BANDS = {
  fluency:    (wpm) => (wpm < 70 ? 0 : wpm <= 110 ? 1 : 2),
  vocab:      (ttr) => (ttr < 0.45 ? 0 : ttr <= 0.6 ? 1 : 2),
  grammar:    (e100) => (e100 > 6 ? 0 : e100 > 2 ? 1 : 2),
  structures: (s100) => (s100 < 1 ? 0 : s100 <= 3 ? 1 : 2),
  stability:  (hold) => (hold < 0.4 ? 0 : hold < 0.75 ? 1 : 2),
};

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * computeDials({ answers, grammarErrors }) → [ ...6 dials ]
 * answers: [{ qid?, transcript, durationMs?, inputMode }] in asked order.
 * grammarErrors: verified LT error count over ALL answers, or null when LT was unavailable.
 * Dial: { key, measurable, level 0-2|null, metric:{...}|null, evidence:{answers,words,...}, reason|null }
 */
export function computeDials({ answers = [], grammarErrors = null } = {}) {
  const measured = answers.map((a) => ({ ...a, m: measureAnswer(a) }));
  const words = measured.reduce((s, a) => s + a.m.wordCount, 0);
  const evidence = { answers: measured.length, words };

  // fluency — voice answers with a real duration only
  const voiced = measured.filter((a) => a.inputMode === 'voice' && (a.durationMs || 0) >= 2000);
  const voicedWords = voiced.reduce((s, a) => s + a.m.wordCount, 0);
  const voicedMs = voiced.reduce((s, a) => s + a.durationMs, 0);
  let fluency;
  if (measured.length && voiced.length === 0) {
    fluency = { key: 'fluency', measurable: false, level: null, metric: null, evidence, reason: 'typed_only' };
  } else if (voiced.length < 2 || voicedWords < 20 || voicedMs < 8000) {
    fluency = { key: 'fluency', measurable: false, level: null, metric: null, evidence, reason: 'thin' };
  } else {
    const wpm = Math.round(voicedWords / (voicedMs / 60000));
    fluency = { key: 'fluency', measurable: true, level: BANDS.fluency(wpm), metric: { wpm },
      evidence: { ...evidence, voicedAnswers: voiced.length }, reason: null };
  }

  // vocab — lexical variety over enough material
  let vocab;
  if (words < 40) {
    vocab = { key: 'vocab', measurable: false, level: null, metric: null, evidence, reason: 'thin' };
  } else {
    const all = measured.flatMap((a) => (String(a.transcript || '').match(/\p{L}+/gu) || []).map((w) => w.toLowerCase()));
    const unique = new Set(all).size;
    const ttr = round1((unique / all.length) * 100) / 100;
    vocab = { key: 'vocab', measurable: true, level: BANDS.vocab(ttr), metric: { ttr, uniqueWords: unique }, evidence, reason: null };
  }

  // grammar — verified error density; unmeasured when the checker was unavailable (never guess)
  let grammar;
  if (grammarErrors == null || words < 40) {
    grammar = { key: 'grammar', measurable: false, level: null, metric: null, evidence,
      reason: grammarErrors == null ? 'checker_unavailable' : 'thin' };
  } else {
    const errorsPer100w = round1((grammarErrors / words) * 100);
    grammar = { key: 'grammar', measurable: true, level: BANDS.grammar(errorsPer100w),
      metric: { errorsPer100w, errors: grammarErrors }, evidence, reason: null };
  }

  // structures — subordinate clauses attempted per 100 words
  let structures;
  if (measured.length < 3 || words < 40) {
    structures = { key: 'structures', measurable: false, level: null, metric: null, evidence, reason: 'thin' };
  } else {
    const subord = measured.reduce((s, a) => s + a.m.subordCount, 0);
    const subordPer100w = round1((subord / words) * 100);
    structures = { key: 'structures', measurable: true, level: BANDS.structures(subordPer100w),
      metric: { subordPer100w, subordClauses: subord }, evidence, reason: null };
  }

  // stability — quality holding as the ladder climbed; only an adaptive run can prove it
  const tiered = measured.filter((a) => TIER_OF.has(a.qid)).map((a) => ({ ...a, tier: TIER_OF.get(a.qid) }));
  const upper = tiered.filter((a) => a.tier >= 1);
  let stability;
  if (tiered.length !== measured.length || measured.length === 0) {
    stability = { key: 'stability', measurable: false, level: null, metric: null, evidence, reason: 'not_adaptive' };
  } else if (upper.length < 2) {
    stability = { key: 'stability', measurable: false, level: null, metric: null, evidence, reason: 'thin' };
  } else {
    const held = upper.filter((a) => classifyCoping(a.m, a.tier) !== 'weak').length;
    const holdRate = round1(held / upper.length);
    stability = { key: 'stability', measurable: true, level: BANDS.stability(holdRate),
      metric: { holdRate, upperAnswers: upper.length, maxTier: Math.max(...tiered.map((a) => a.tier)) },
      evidence, reason: null };
  }

  // pronunciation — text cannot judge sound; nothing ships before the external gold study.
  const pronunciation = { key: 'pronunciation', measurable: false, level: null, metric: null, evidence, reason: 'unvalidated' };

  return [fluency, vocab, grammar, structures, stability, pronunciation];
}
