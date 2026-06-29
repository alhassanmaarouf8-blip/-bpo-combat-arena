// Brain engine proof — run with `node --test server/brain/engine.test.mjs`. Pure, deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eloUpdate, expectedScore } from './elo.js';
import { bktUpdate, bktPredict, masteryFromHistory, BKT_DEFAULTS } from './bkt.js';
import { frontier, tierStatus, SKILLS } from './skillGraph.js';
import { decide } from './engine.js';

test('elo: success vs an equal-rated item raises ability, lowers item difficulty', () => {
  const r = eloUpdate({ ability: 1200, difficulty: 1200, outcome: 1 });
  assert.ok(r.ability > 1200);
  assert.ok(r.difficulty < 1200);
  assert.equal(expectedScore(1200, 1200), 0.5);
});

test('elo: repeated wins converge ability upward (monotone)', () => {
  let s = { ability: 1000, difficulty: 1400, abilityN: 0, difficultyN: 0 };
  let prev = s.ability;
  for (let i = 0; i < 10; i++) { s = eloUpdate({ ...s, outcome: 1 }); assert.ok(s.ability >= prev); prev = s.ability; }
  assert.ok(s.ability > 1000);
});

test('bkt: mastery rises with correct answers, falls with wrong; predict in [0,1]', () => {
  const up = bktUpdate(0.3, true);
  const down = bktUpdate(0.3, false);
  assert.ok(up > down);
  const p = bktPredict(0.5);
  assert.ok(p >= 0 && p <= 1);
  assert.ok(masteryFromHistory([true, true, true]) > masteryFromHistory([false, false, false], BKT_DEFAULTS));
});

test('skillGraph: frontier only exposes skills whose prereqs are all mastered', () => {
  const none = frontier(new Set());
  assert.ok(none.every((s) => s.layer === 0));           // with nothing mastered, only Layer 0 is open
  assert.ok(none.length > 0);
  const layer0 = SKILLS.filter((s) => s.layer === 0).map((s) => s.id);
  const fr = frontier(new Set(layer0));
  assert.ok(fr.some((s) => s.id === 'dativ-akkusativ'));  // a Layer-1 skill unlocks once L0 is mastered
  assert.ok(!fr.some((s) => s.id === 'angry-c1'));        // a Layer-3 skill stays locked
});

test('skillGraph: clearing all entry-tier skills sets applyNow', () => {
  const entryAndBelow = SKILLS.filter((s) => s.tier !== 'premium').map((s) => s.id);
  const t = tierStatus(new Set(entryAndBelow));
  assert.equal(t.applyNow, true);
  assert.ok(t.cleared.includes('entry'));
});

test('engine: cold-start → NEW, low confidence, no causal aha', () => {
  const d = decide({ sessionCount: 0 });
  assert.equal(d.state, 'NEW');
  assert.equal(d.confidence, 'low');
  assert.equal(d.aha, null);
  assert.equal(d.prescription.action, 'assessment');
});

test('engine: an unmeasured hire-gating signal → MEASURE it, do not guess', () => {
  const d = decide({ sessionCount: 3, unmeasuredGates: ['intelligibility'] });
  assert.equal(d.state, 'MEASURE');
  assert.equal(d.prescription.action, 'measure');
  assert.equal(d.prescription.signal, 'intelligibility');
});

test('engine: entry tier cleared → APPLY (stop drilling, start placing)', () => {
  const entryAndBelow = SKILLS.filter((s) => s.tier !== 'premium').map((s) => s.id);
  const d = decide({ sessionCount: 5, masteredSkills: entryAndBelow });
  assert.equal(d.state, 'APPLY');
  assert.equal(d.prescription.action, 'apply');
});

test('engine: aha fires ONLY on a confirmed closed loop (drilled + sustained drop)', () => {
  const weakLog = { 'konjunktiv-2': { ruleId: 'konjunktiv-2', errCounts: [{ count: 4 }, { count: 1 }], drills: [{ drill: 'sag-es-richtig' }] } };
  const d = decide({ sessionCount: 3, masteredSkills: SKILLS.filter(s=>s.layer===0).map(s=>s.id), weakLog, lastTargetRuleId: 'konjunktiv-2' });
  assert.deepEqual(d.aha, { ruleId: 'konjunktiv-2', before: 4, after: 1 });
});

test('engine: NO aha when there was no drill (improvement unattributed)', () => {
  const weakLog = { 'konjunktiv-2': { errCounts: [{ count: 4 }, { count: 1 }], drills: [] } };
  const d = decide({ sessionCount: 3, weakLog, lastTargetRuleId: 'konjunktiv-2' });
  assert.equal(d.aha, null);
});

test('engine: global regression vetoes a local celebration (honesty)', () => {
  const weakLog = { 'konjunktiv-2': { errCounts: [{ count: 4 }, { count: 1 }], drills: [{ drill: 'x' }] } };
  const d = decide({ sessionCount: 3, weakLog, lastTargetRuleId: 'konjunktiv-2', globalRegressed: true });
  assert.equal(d.aha, null);
});

test('engine: a weakness with <2 sessions of evidence is LOW confidence (no over-claiming)', () => {
  const d = decide({ sessionCount: 1, masteredSkills: SKILLS.filter(s=>s.layer===0).map(s=>s.id),
    limitingSkill: 'grammar', weakLog: { 'dativ-akkusativ': { errCounts: [{ count: 3 }] } } });
  assert.equal(d.confidence, 'low');
});
