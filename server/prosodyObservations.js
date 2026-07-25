/**
 * prosodyObservations.js — RAW prosody observations from a finished live interview.
 *
 * Phase A of the tone-feedback plan (owner-approved 2026-07-25). This module COMPUTES and STORES
 * only; nothing here is learner-facing. The two targeted registry categories
 * (`speech_rate_clarity`, `excessive_pausing` — server/pronunciationRegistry.js) stay DARK until
 * a participant-disjoint expert-gold report passes evaluatePronunciationRelease() and enters
 * server/pronunciationReleases.js. Until then these numbers exist so that (a) the release
 * evaluation has real production distributions to be validated against, and (b) the debrief can
 * light up the moment a release lands, with zero further plumbing.
 *
 * Discipline (feedback-accuracy-doctrine + pronunciationCore):
 *  - deterministic arithmetic over what Deepgram/the session ALREADY measured — no model calls;
 *  - observations, never judgements: no thresholds that claim "too slow/too hesitant" live here.
 *    A number becomes a claim only behind a passed release, and the phrasing belongs to that step;
 *  - abstain honestly: too little speech → null, mirroring the registry's abstainWhen guards
 *    ('too_little_speech', 'duration_unreliable').
 */

// Below these floors the numbers stop being about the speaker and start being noise.
const MIN_ANSWERS = 3;             // fewer spoken answers than this → abstain entirely
const MIN_ANSWER_MS = 800;         // an utterance shorter than this is a fragment, not an answer
const MAX_SANE_MS = 5 * 60 * 1000; // longer than this is a capture glitch, not speech

function saneAnswer(u) {
  return u && typeof u === 'object'
    && Number.isFinite(u.durationMs) && u.durationMs >= MIN_ANSWER_MS && u.durationMs <= MAX_SANE_MS
    && Number.isFinite(u.words) && u.words > 0;
}

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * @param {Array<{words:number,durationMs:number}>} utterances — ctx.utterances of one session
 * @returns {object|null} frozen raw observations, or null (= honest abstention)
 */
export function observeProsody(utterances) {
  if (!Array.isArray(utterances)) return null;
  const answers = utterances.filter(saneAnswer);
  if (answers.length < MIN_ANSWERS) return null;   // abstain: too_little_speech

  const durationsSec = answers.map((u) => u.durationMs / 1000);
  const wpms = answers.map((u) => (u.words / (u.durationMs / 60000)));
  const totalSec = durationsSec.reduce((a, b) => a + b, 0);
  const totalWords = answers.reduce((a, u) => a + u.words, 0);
  const sorted = [...durationsSec].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // Coefficient of variation of per-answer speech rate — the raw signal behind
  // speech_rate_clarity ("rate is erratic") without asserting that it IS erratic.
  const meanWpm = wpms.reduce((a, b) => a + b, 0) / wpms.length;
  const sd = Math.sqrt(wpms.reduce((a, w) => a + (w - meanWpm) ** 2, 0) / wpms.length);

  return Object.freeze({
    version: 1,
    answers: answers.length,
    totalSpeakingSec: round1(totalSec),
    meanAnswerSec: round1(totalSec / answers.length),
    medianAnswerSec: round1(median),
    shortestAnswerSec: round1(sorted[0]),
    longestAnswerSec: round1(sorted[sorted.length - 1]),
    overallWpm: round1(totalWords / (totalSec / 60)),
    meanAnswerWpm: round1(meanWpm),
    wpmSpread: round1(sd),                       // raw dispersion, unit: WpM
    // Fragments are counted, not judged: how many utterances fell below the answer floor.
    fragmentsDiscarded: utterances.length - answers.length,
  });
}

export default { observeProsody };
