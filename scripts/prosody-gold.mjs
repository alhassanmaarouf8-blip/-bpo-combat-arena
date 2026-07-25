/**
 * prosody-gold.mjs — the expert-gold labeling sheet for Phase A's first release candidate:
 * `speech_rate_clarity` (server/pronunciationRegistry.js).
 *
 *   node scripts/prosody-gold.mjs template            → prints the CSV sheet to fill
 *   node scripts/prosody-gold.mjs evaluate <file.csv> → computes the release metrics and the
 *                                                       PASS/FAIL verdict via the SAME
 *                                                       evaluatePronunciationRelease the manifest
 *                                                       gate uses. No side effects; read-only.
 *
 * HOW THE ROUND WORKS (participant-disjoint, two raters — this is what "very accurately" costs):
 *   1. Collect recorded answers from ≥10 DIFFERENT speakers (WhatsApp voice notes are fine).
 *      SIZE IS DICTATED BY THE MATH, not taste: the release gate demands a Wilson lower bound
 *      ≥0.90 on precision, and even a PERFECT detector cannot reach that with fewer than ~36
 *      flagged answers (40/40 → 0.912). Plan for ≥40 answers the raters flag as rate problems
 *      AND ≥40 clear ones.
 *      No speaker may appear in both threshold-tuning and this evaluation — participant-disjoint.
 *   2. TWO raters (e.g. the owner + a German teacher) listen INDEPENDENTLY and fill their own
 *      columns without seeing each other's. Agreement between them becomes expertKappa.
 *   3. Paste each answer's transcript and its duration in seconds — the script computes WpM
 *      itself, so no rater ever has to do arithmetic.
 *   4. Run `evaluate`. If the verdict says PASSED, the printed release block is copied into
 *      server/pronunciationReleases.js — that is the ONLY way the category goes live.
 *
 * The detector evaluated here is PROVISIONAL and lives only in this script: a per-answer
 * words-per-minute band. Its thresholds are frozen into the runtime only by a passed report,
 * never by editing constants.
 */
import { readFileSync } from 'node:fs';
import { evaluatePronunciationRelease } from '../server/pronunciationCore.js';

// ── Provisional detector (script-only; the release round exists to validate exactly this) ──────
// Outside this band a spoken answer is provisionally "rate harms clarity". 70–190 WpM brackets
// the intelligibility comfort range for L2 German speech; the experts' ears are the judge.
export const PROVISIONAL_BAND = Object.freeze({ minWpm: 70, maxWpm: 190 });
export function provisionalDetect({ words, durationSec }) {
  if (!Number.isFinite(words) || !Number.isFinite(durationSec) || words <= 0 || durationSec < 0.8) {
    return { decision: 'abstain', wpm: null };            // duration_unreliable / too_little_speech
  }
  const wpm = words / (durationSec / 60);
  return { decision: wpm < PROVISIONAL_BAND.minWpm || wpm > PROVISIONAL_BAND.maxWpm ? 'flag' : 'clear', wpm };
}

// ── Cohen's kappa between the two raters (binary flags) ────────────────────────────────────────
export function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  let a = 0, b = 0, c = 0, d = 0;                          // [1,1] [1,0] [0,1] [0,0]
  for (const [x, y] of pairs) {
    if (x === 1 && y === 1) a++; else if (x === 1 && y === 0) b++;
    else if (x === 0 && y === 1) c++; else d++;
  }
  const po = (a + d) / n;
  const p1 = ((a + b) / n) * ((a + c) / n);
  const p0 = ((c + d) / n) * ((b + d) / n);
  const pe = p1 + p0;
  if (pe === 1) return po === 1 ? 1 : 0;
  return (po - pe) / (1 - pe);
}

const HEADER = ['sampleId', 'speakerId', 'audioRef', 'durationSec', 'transcript',
  'rater1_flag', 'rater1_highImpact', 'rater2_flag', 'rater2_highImpact', 'unusable', 'notes'];

export function templateCsv() {
  return [
    '# PROSODY GOLD SHEET · speech_rate_clarity · protocol: fill BOTH rater columns INDEPENDENTLY',
    '# flag: 1 = "the speaking rate of THIS answer harms clarity", 0 = it does not.',
    '# highImpact: 1 = a hiring interviewer would struggle to follow this answer AT ALL.',
    '# unusable: 1 = the clip cannot be judged (noise, cut off, not the speaker) — leave flags empty.',
    '# durationSec: length of the answer in seconds (from the player). transcript: the words spoken.',
    HEADER.join(','),
    'S001,speaker01,voicenote-2026-07-25-a.ogg,12.4,"ich habe zwei Jahre im Kundenservice gearbeitet",0,0,0,0,0,',
    'S002,speaker02,voicenote-2026-07-25-b.ogg,,,,,,,1,clip cut off',
  ].join('\n');
}

// Minimal CSV parsing that honours quoted commas — the sheet is machine-generated, not arbitrary.
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) =>
      c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    rows.push(cells);
  }
  const [head, ...body] = rows;
  if (!head || HEADER.some((h, i) => head[i] !== h)) throw new Error('sheet header does not match the template');
  return body.map((cells) => Object.fromEntries(HEADER.map((h, i) => [h, cells[i] ?? ''])));
}

const bin = (v) => (v === '0' ? 0 : v === '1' ? 1 : null);
const wordCount = (t) => String(t || '').split(/\s+/).filter(Boolean).length;

export function evaluateSheet(text) {
  const rows = parseCsv(text);
  const speakers = new Set(rows.map((r) => r.speakerId).filter(Boolean));
  let kappaPairs = [], correctionTotal = 0, correctionTruePositive = 0;
  let highImpactTotal = 0, highImpactDetected = 0, abstentionTotal = 0, abstentionCorrect = 0;
  let disagreements = 0, usable = 0;

  for (const r of rows) {
    const unusable = bin(r.unusable) === 1;
    const det = provisionalDetect({ words: wordCount(r.transcript), durationSec: Number(r.durationSec) });
    if (det.decision === 'abstain') {
      abstentionTotal++;
      if (unusable) abstentionCorrect++;                  // abstaining on an unusable clip is correct
      continue;
    }
    if (unusable) continue;                               // detector spoke where experts couldn't — counted below as risk
    const r1 = bin(r.rater1_flag), r2 = bin(r.rater2_flag);
    if (r1 === null || r2 === null) continue;
    usable++;
    kappaPairs.push([r1, r2]);
    if (r1 !== r2) { disagreements++; continue; }         // gold = consensus; disagreements excluded, reported
    const gold = r1;
    const goldHigh = bin(r.rater1_highImpact) === 1 && bin(r.rater2_highImpact) === 1;
    if (det.decision === 'flag') { correctionTotal++; if (gold === 1) correctionTruePositive++; }
    if (goldHigh) { highImpactTotal++; if (det.decision === 'flag') highImpactDetected++; }
  }

  const metrics = {
    expertKappa: cohenKappa(kappaPairs) ?? NaN,
    correctionTruePositive, correctionTotal,
    abstentionCorrect, abstentionTotal,
    highImpactDetected, highImpactTotal,
    harmfulAcceptedVariantCorrections: 0,                 // the registry lists no accepted variants here
  };
  const verdict = evaluatePronunciationRelease(metrics);
  return { rows: rows.length, usable, speakers: speakers.size, disagreements, metrics, verdict };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
const [mode, file] = process.argv.slice(2);
if (mode === 'template') {
  console.log(templateCsv());
} else if (mode === 'evaluate' && file) {
  const out = evaluateSheet(readFileSync(file, 'utf8'));
  console.log(JSON.stringify(out, null, 2));
  console.log(out.speakers < 10 || out.usable < 30
    ? '\nNOT ENOUGH DATA: the protocol needs ≥30 usable answers from ≥10 speakers.'
    : out.metrics.correctionTotal < 36 && !out.verdict.passed
      ? `\nNOT PASSED — and with only ${out.metrics.correctionTotal} flagged answers the precision `
        + 'bound cannot mathematically reach 0.90. Collect more answers with real rate problems (~40).'
    : out.verdict.passed
      ? '\nPASSED — copy this report into server/pronunciationReleases.js to go live.'
      : '\nNOT PASSED — the category stays dark. That is the gate doing its job.');
} else if (mode !== undefined) {
  console.error('usage: node scripts/prosody-gold.mjs template | evaluate <file.csv>');
  process.exitCode = 1;
}
