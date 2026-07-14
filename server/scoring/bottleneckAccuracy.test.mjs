/**
 * bottleneckAccuracy.test.mjs — GROUND-TRUTH CORPUS + REGRESS-GUARD for the BOTTLENECK picker.
 *
 * topL1Pattern() is the deterministic authority that names a learner's #1 spoken-error pattern from a
 * transcript — it drives what the app tells them to DRILL. Naming the WRONG pattern sends every user to
 * practice the wrong thing; inventing one from clean speech destroys trust. This locks it behind the
 * Compounding Accuracy Engine (the "Bottleneck / priorityFix" row of the generalization map).
 *
 * (The user-facing priorityFix SENTENCE is LLM-authored prose — a candidate generator, not lockable;
 * it must be DERIVED from this deterministic bottleneck. Only the deterministic picker is the authority.)
 *
 * THE RATCHET (invariants enforced here):
 *   1. ZERO-HARM — HARD FAIL, count MUST be 0:
 *        (a) MISDIRECT:    a set with a clear dominant pattern K returns a DIFFERENT non-null pattern
 *                          (would send the user to drill the wrong weakness).
 *        (b) HALLUCINATE:  clean speech, or a single below-threshold slip, returns a non-null pattern
 *                          (invents a weakness that isn't there). topL1Pattern needs ≥2 to name one.
 *   2. RATCHET — recall (dominant pattern correctly named) pinned to a floor that only rises.
 *
 * Every labeled set below was VERIFIED against detectL1Patterns before committing. Append real
 * confirmed sessions forever. Run: node --test server/scoring/bottleneckAccuracy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { topL1Pattern } from './l1Errors.js';

const U = (...lines) => lines.map((text) => ({ text }));
// verified-firing components (see grammarAccuracy corpus + empirical checks):
const VF1 = 'Ich komme später, weil ich habe keine Zeit.';
const VF2 = 'Ich weiß, dass er kann gut Deutsch.';
const VF3 = 'Ich denke, dass ich bin die richtige Person.';
const VF4 = 'Wenn ich habe Zeit, rufe ich Sie an.';
const G1  = 'Ich habe die Problem gelöst.';
const G2  = 'Das war eine Problem für mich.';
const C1  = 'Der Kunde war zufrieden mit der Lösung.';
const C2  = 'Ich habe drei Jahre im Kundenservice gearbeitet.';
const C3  = 'Ich arbeite gern im Team und lerne schnell.';

// { u: utterances, top: expected dominant key, or null = must name NOTHING }
const CORPUS = [
  // ── dominant verb-final (the #1 Arabic-L1 wall) ──
  { u: U(VF1, VF2, VF3, C1), top: 'verb-final' },
  { u: U(VF1, VF2),          top: 'verb-final' },
  { u: U(VF1, VF2, VF3, VF4), top: 'verb-final' },
  // ── MISDIRECT guards: verb-final dominates a minority gender slip → must NOT name article-gender ──
  { u: U(VF1, VF2, VF3, G1), top: 'verb-final' },
  // ── dominant article-gender ──
  { u: U(G1, G2),            top: 'article-gender' },
  // ── MISDIRECT guard: gender dominates a minority verb-final slip → must NOT name verb-final ──
  { u: U(G1, G2, VF1),       top: 'article-gender' },
  // ── HALLUCINATE guards: nothing to name ──
  { u: U(C1, C2, C3),        top: null },                       // clean speech
  { u: U(VF1, C1),           top: null },                       // ONE slip (count 1 < 2) → name nothing
  { u: U(G1, C1, C2),        top: null },                       // ONE gender slip → name nothing
  { u: U(),                  top: null },                       // no speech at all
];

const RECALL_FLOOR = 0.80;   // ratchets UP as the corpus / detectors grow. Never lower.

test('ZERO-HARM — never name the WRONG bottleneck, never INVENT one (HARD, must be 0)', () => {
  const misdirect = [], hallucinate = [];
  for (const c of CORPUS) {
    const key = topL1Pattern(c.u)?.key ?? null;
    if (c.top !== null && key !== null && key !== c.top) misdirect.push(`want ${c.top} → got ${key} on [${c.u.map((x) => x.text.slice(0, 24)).join(' | ')}]`);
    if (c.top === null && key !== null)                  hallucinate.push(`invented ${key} on [${c.u.map((x) => x.text.slice(0, 24)).join(' | ')}]`);
  }
  assert.equal(misdirect.length, 0,   `MISDIRECT — named a non-dominant weakness (would drill the wrong thing):\n  ${misdirect.join('\n  ')}`);
  assert.equal(hallucinate.length, 0, `HALLUCINATE — named a weakness that isn't there:\n  ${hallucinate.join('\n  ')}`);
});

test('RATCHET — dominant bottleneck correctly named (recall floor must not regress)', () => {
  const keyed = CORPUS.filter((c) => c.top !== null);
  const hit = keyed.filter((c) => (topL1Pattern(c.u)?.key ?? null) === c.top).length;
  const recall = keyed.length ? hit / keyed.length : 1;
  const harmful = CORPUS.filter((c) => {
    const actual = topL1Pattern(c.u)?.key ?? null;
    return (c.top === null && actual !== null) || (c.top !== null && actual !== null && actual !== c.top);
  }).length;
  console.log(`\n[bottleneck-accuracy] zero-harm ${harmful} harmful outputs across ${CORPUS.length} cases · recall ${(recall * 100).toFixed(0)}% (${hit}/${keyed.length})`);
  const miss = keyed.filter((c) => (topL1Pattern(c.u)?.key ?? null) !== c.top).map((c) => `want ${c.top} got ${topL1Pattern(c.u)?.key ?? 'null'}`);
  if (miss.length) console.log('  gaps: ' + miss.join(' | '));
  assert.ok(recall >= RECALL_FLOOR, `bottleneck recall ${(recall * 100).toFixed(0)}% fell below floor ${RECALL_FLOOR * 100}%`);
});
