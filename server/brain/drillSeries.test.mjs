/**
 * drillSeries.test.mjs — pins the drill-prescription doctrine (docs/drill-prescription-doctrine.md)
 * to behavior. Every K-rule the series layer is responsible for gets a permanent test; the engine
 * integration pins the scope guards (criterion-driven and coach-dose paths stay untouched).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SERIES, seriesFor, seriesProgress } from './drillSeries.mjs';
import { decide } from './engine.js';

// ————— ladder shape (K1 produce-only, K4 stage order, K6 converge on the interview) —————

test('doctrine K1/K4: every series is production-only and climbs A → B → C in order', () => {
  const RECEPTIVE = new Set(['hoer-check', 'srs']);           // recognition/receptive surfaces
  const ORDER = { A: 0, B: 1, C: 2 };
  for (const [ruleId, steps] of Object.entries(SERIES)) {
    assert.ok(steps.length >= 3, `${ruleId}: a series is a SERIES, not a single drill`);
    assert.equal(steps[0].stage, 'A', `${ruleId}: noticing comes first (Schmidt)`);
    assert.equal(steps[0].drill, 'finde-den-fehler', `${ruleId}: stage A is the own-error hunt`);
    assert.equal(steps[steps.length - 1].stage, 'C', `${ruleId}: the last drill stage automatizes`);
    assert.equal(steps[steps.length - 1].drill, 'sag-es-richtig-tempo',
      `${ruleId}: automatization is timed spoken production (K6)`);
    for (const step of steps) {
      assert.ok(!RECEPTIVE.has(step.drill), `${ruleId}: ${step.drill} is receptive — violates K1`);
      assert.ok(step.completions >= 1);
    }
    const stages = steps.map((s) => ORDER[s.stage]);
    for (let i = 1; i < stages.length; i++) {
      assert.ok(stages[i] >= stages[i - 1], `${ruleId}: stage order regressed at step ${i}`);
    }
  }
});

test('cross-pin: the spokenReview mode variants record exactly the drill ids the series counts', () => {
  // The ladder advances by counting weakLog drill events by id. If the mode→id mapping in
  // spokenReview.js drifts (rename, typo), stages silently stop completing — pin intent: the
  // MODE_DRILL symbol maps find/tempo to the series' own drill ids AND feeds the recorded event.
  const src = readFileSync(fileURLToPath(new URL('../spokenReview.js', import.meta.url)), 'utf8');
  assert.match(src, /MODE_DRILL\s*=\s*Object\.freeze\(\{[^}]*find:\s*'finde-den-fehler'[^}]*tempo:\s*'sag-es-richtig-tempo'[^}]*\}\)/);
  assert.match(src, /drill:\s*mode\s*\?\s*MODE_DRILL\[mode\]/, 'the recorded event must use the mode drill id');
  const variantIds = new Set(['finde-den-fehler', 'sag-es-richtig-tempo']);
  const usedVariants = new Set(Object.values(SERIES).flat().map((s) => s.drill).filter((d) => variantIds.has(d)));
  assert.deepEqual([...usedVariants].sort(), [...variantIds].sort(), 'every variant the series uses is recordable');
});

test('series exist for every canonical ranked grammar rule; unknown rules honestly have none', () => {
  for (const id of ['word-order-sub', 'praesens-perfekt', 'dativ-akkusativ', 'konjunktiv-2']) {
    assert.ok(seriesFor(id), `${id} needs a series`);
  }
  assert.equal(seriesFor('lt:KOMMA_REGEL'), null);
  assert.equal(seriesProgress('lt:KOMMA_REGEL', {}), null);
});

// ————— stage derivation (K4 stage-matched, K8 gates) —————

const LOG = (drills, errCounts = [{ date: 1, count: 3 }, { date: 2, count: 2 }]) =>
  ({ 'word-order-sub': { errCounts, drills } });

test('fresh problem → stage A (finde-den-fehler), honest step count includes the transfer stage', () => {
  const s = seriesProgress('word-order-sub', LOG([]));
  assert.equal(s.current.drill, 'finde-den-fehler');
  assert.equal(s.currentIndex, 0);
  assert.equal(s.totalSteps, SERIES['word-order-sub'].length + 1);   // + D transfer
  assert.equal(s.transferReady, false);
});

test('completing a stage advances exactly one gate (K4)', () => {
  const s = seriesProgress('word-order-sub', LOG([{ at: 10, drill: 'finde-den-fehler', correct: true }]));
  assert.equal(s.current.drill, 'satzbau-schmiede');
  assert.equal(s.completedSteps, 1);
});

test('an explicit failed rep never advances a stage (K8 success gate)', () => {
  const s = seriesProgress('word-order-sub', LOG([{ at: 10, drill: 'finde-den-fehler', correct: false }]));
  assert.equal(s.current.drill, 'finde-den-fehler');
});

test('historic reps count for their own stage but never skip the noticing gate', () => {
  const sag = Array.from({ length: 10 }, (_, i) => ({ at: 10 + i, drill: 'sag-es-richtig', correct: true }));
  const before = seriesProgress('word-order-sub', LOG(sag));
  assert.equal(before.current.drill, 'finde-den-fehler');            // A still first
  const after = seriesProgress('word-order-sub',
    LOG([...sag, { at: 30, drill: 'finde-den-fehler', correct: true },
      { at: 31, drill: 'satzbau-schmiede' }, { at: 32, drill: 'satzbau-schmiede' }]));
  assert.equal(after.current.drill, 'sag-es-richtig-tempo');         // sag stage already evidenced
});

const FULL_LADDER = [
  { at: 10, drill: 'finde-den-fehler', correct: true },
  { at: 11, drill: 'satzbau-schmiede' }, { at: 12, drill: 'satzbau-schmiede' },
  { at: 13, drill: 'sag-es-richtig', correct: true }, { at: 14, drill: 'sag-es-richtig', correct: true },
  { at: 15, drill: 'sag-es-richtig', correct: true },
  { at: 16, drill: 'sag-es-richtig-tempo', correct: true }, { at: 17, drill: 'sag-es-richtig-tempo', correct: true },
  { at: 18, drill: 'sag-es-richtig-tempo', correct: true },
];

test('complete ladder → transferReady: the next step is the disguised interview probe (D)', () => {
  const s = seriesProgress('word-order-sub', LOG(FULL_LADDER));
  assert.equal(s.transferReady, true);
  assert.equal(s.current, null);
  assert.equal(s.completedSteps, SERIES['word-order-sub'].length);
});

test('K8 regression: errors in a LATER interview re-open automatization; only post-failure reps count', () => {
  const errs = [{ date: 1, count: 3 }, { date: 2, count: 2 }, { date: 100, count: 2 }];
  const regressed = seriesProgress('word-order-sub', LOG(FULL_LADDER, errs));
  assert.equal(regressed.transferReady, false);
  assert.equal(regressed.regressed, true);
  assert.equal(regressed.current.drill, 'sag-es-richtig-tempo');
  const repaired = seriesProgress('word-order-sub', LOG([...FULL_LADDER,
    { at: 101, drill: 'sag-es-richtig-tempo', correct: true }, { at: 102, drill: 'sag-es-richtig-tempo', correct: true },
    { at: 103, drill: 'sag-es-richtig-tempo', correct: true }], errs));
  assert.equal(repaired.transferReady, true);
});

test('an error-free interview after the ladder does NOT regress the series', () => {
  const errs = [{ date: 1, count: 3 }, { date: 2, count: 2 }, { date: 100, count: 0 }];
  const s = seriesProgress('word-order-sub', LOG(FULL_LADDER, errs));
  assert.equal(s.transferReady, true);
  assert.equal(s.regressed, false);
});

// ————— engine integration (the prescription actually follows the series) —————

const SNAP = (weakLog, extra = {}) => ({
  masteredSkills: ['praesens-perfekt', 'self-intro', 'core-vocab', 'listen-clear'],
  weakLog, limitingSkill: 'grammar', sessionCount: 3, srsDueCount: 0,
  unmeasuredGates: [], daysSinceActive: 0, ...extra,
});

test('engine: ranked grammar problem is prescribed its series stage, not the static graph drill', () => {
  const d = decide(SNAP(LOG([])));
  assert.equal(d.prescription.action, 'drill');
  assert.equal(d.prescription.drill, 'finde-den-fehler');            // was: satzbau-schmiede (static)
  assert.equal(d.prescription.skillId, 'word-order-sub');
  assert.deepEqual(d.prescription.seriesStage, { stage: 'A', step: 1, of: 5 });
  assert.equal(d.state, 'POST_FIGHT');
});

test('engine: completed ladder → READY interview with stage D (the disguised transfer retest)', () => {
  const d = decide(SNAP(LOG(FULL_LADDER)));
  assert.equal(d.state, 'READY');
  assert.equal(d.prescription.action, 'interview');
  assert.deepEqual(d.prescription.seriesStage, { stage: 'D', step: 5, of: 5 });
});

test('engine scope guard: a criterion-driven grammar forecast keeps its exact-rule machinery', () => {
  const d = decide(SNAP(LOG([]), {
    limitingCriterionId: 'grammar_control', limitingGrammarRuleId: 'word-order-sub',
    limitingGrammarEvidenceCount: 2, limitingGrammarEvidenceConflictCount: 0,
  }));
  assert.equal(d.prescription.seriesStage, undefined);               // series must NOT hijack doses
  assert.equal(d.prescription.criterionId, 'grammar_control');
});

test('engine scope guard: an active coach dose on the target outranks the series', () => {
  const d = decide(SNAP(LOG([]), {
    coachGate: { skillId: 'word-order-sub', drillId: 'satzbau-schmiede', status: 'practice',
      action: 'drill', phase: 'practice', nextEligibleAt: null },
  }));
  assert.equal(d.prescription.seriesStage, undefined);
  assert.equal(d.prescription.drill, 'satzbau-schmiede');
});

test('engine: a rule without a series keeps the legacy static-drill fallback (no dead ends)', () => {
  // fluency path: no grammar ranking, criterion maps to a non-series skill
  const d = decide({ masteredSkills: ['self-intro', 'praesens-perfekt', 'core-vocab', 'listen-clear',
    'no-freeze-expected'], weakLog: {}, limitingSkill: 'fluency', sessionCount: 3, srsDueCount: 0,
  unmeasuredGates: [], daysSinceActive: 0 });
  assert.equal(d.prescription.action, 'drill');
  assert.ok(d.prescription.drill, 'a drill is still prescribed');
  assert.equal(d.prescription.seriesStage, undefined);
});
