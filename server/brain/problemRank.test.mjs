/**
 * problemRank.test.mjs — pins the v2 Phase 2 CHOOSE layer: the elite-teacher triage is
 * deterministic, impact-first (global beats local regardless of raw counts), evidence-floored
 * (slip ≠ system), and readiness-aware. Plus: the engine's grammar branch actually CONSUMES the
 * ranking (a computed-but-never-read ranking is foot-gun #40).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankProblems, impactTierOf, probeTarget } from './problemRank.js';
import { decide } from './engine.js';

const sessions = (...counts) => ({ errCounts: counts.map((count) => ({ count })) });

test('impact taxonomy: verb position is global (3), case/register strain (2), unknown defaults local (1)', () => {
  assert.equal(impactTierOf('word-order-sub'), 3);
  assert.equal(impactTierOf('praesens-perfekt'), 3);
  assert.equal(impactTierOf('dativ-akkusativ'), 2);
  assert.equal(impactTierOf('konjunktiv-2'), 2);
  assert.equal(impactTierOf('some-unknown-lt-rule'), 1, 'unknown class must never be promoted by guesswork');
});

test('determinism: same weakLog twice → deep-equal ranking', () => {
  const weakLog = { 'dativ-akkusativ': sessions(3, 2), 'word-order-sub': sessions(1, 1) };
  assert.deepEqual(rankProblems({ weakLog }), rankProblems({ weakLog }));
});

test('THE ELITE-TEACHER CALL: 2 verb-position sessions outrank 5 dative errors (impact before count)', () => {
  const ranked = rankProblems({ weakLog: {
    'dativ-akkusativ': sessions(3, 2),      // 5 errors across 2 sessions — local-ish
    'word-order-sub':  sessions(1, 1),      // 2 errors across 2 sessions — breaks understanding
  }, masteredSkills: ['praesens-perfekt'] });
  assert.equal(ranked[0].ruleId, 'word-order-sub');
  assert.equal(ranked[0].tier, 3);
  assert.equal(ranked[1].ruleId, 'dativ-akkusativ');
});

test('slip ≠ system: a single errorful session never enters the ranking', () => {
  const ranked = rankProblems({ weakLog: {
    'word-order-sub': sessions(4),          // one bad day, even with 4 errors
    'dativ-akkusativ': sessions(1, 1),      // a pattern
  } });
  assert.deepEqual(ranked.map((r) => r.ruleId), ['dativ-akkusativ']);
});

test('mastered problems leave the ranking; readiness reflects the skill graph prerequisites', () => {
  const weakLog = { 'konjunktiv-2': sessions(2, 2), 'unknown-rule': sessions(1, 1) };
  const ranked = rankProblems({ weakLog, masteredSkills: [] });
  const kj = ranked.find((r) => r.ruleId === 'konjunktiv-2');
  assert.equal(kj.ready, false, 'konjunktiv-2 requires word-order-sub first — not ready');
  assert.equal(ranked.find((r) => r.ruleId === 'unknown-rule').ready, true, 'no known gate → rankable now');
  const readyRanked = rankProblems({ weakLog, masteredSkills: ['word-order-sub'] });
  assert.equal(readyRanked.find((r) => r.ruleId === 'konjunktiv-2').ready, true);
  assert.deepEqual(rankProblems({ weakLog, masteredSkills: ['konjunktiv-2', 'unknown-rule'] }), [],
    'mastered → no longer a problem');
});

test('ENGINE CONSUMES THE RANKING (#40): grammar target follows impact, not worst raw count', () => {
  const foundation = ['self-intro', 'praesens-perfekt', 'core-vocab', 'listen-clear'];
  const d = decide({ sessionCount: 3, masteredSkills: foundation, limitingSkill: 'grammar',
    weakLog: {
      'dativ-akkusativ': { errCounts: [{ count: 5 }, { count: 4 }] },   // louder
      'word-order-sub':  { errCounts: [{ count: 1 }, { count: 1 }] },   // deadlier
    } });
  assert.equal(d.target.skillId, 'word-order-sub', 'the deadlier problem wins, not the louder one');
  assert.equal(d.prescription.drill, 'satzbau-schmiede');
  assert.equal(d.ranked[0].ruleId, 'word-order-sub');
});

test('engine: below the ranking floor the historical worst-by-last-count behavior survives', () => {
  const foundation = ['self-intro', 'praesens-perfekt', 'core-vocab', 'listen-clear'];
  const d = decide({ sessionCount: 3, masteredSkills: foundation, limitingSkill: 'grammar',
    weakLog: { 'dativ-akkusativ': { errCounts: [{ count: 3 }] } } });    // one session only
  assert.equal(d.target.skillId, 'dativ-akkusativ', 'single-session observation still beats drilling the unobserved');
});

test('probeTarget (AKTE unification): impact wins, readiness ignored, ltName surfaces, floor shared', () => {
  assert.equal(probeTarget({}), null, 'no evidence → no ranked verdict (legacy fallback speaks)');
  assert.equal(probeTarget({ 'word-order-sub': sessions(4) }), null, 'one session stays below the floor');
  const weakLog = {
    // konjunktiv-2 is NOT ready (word-order-sub unmastered) — the probe must ignore that:
    // a re-test is not a prescription. Tier 2 beats the unknown tier-1 rule despite ready flags.
    'konjunktiv-2': { ...sessions(1, 1), ltName: 'Konjunktiv II' },
    'lt:DE_AGREEMENT': { ...sessions(3, 3), ltName: 'Evtl. passen Wörter grammatisch nicht zusammen.' },
  };
  const probe = probeTarget(weakLog);
  assert.equal(probe.ruleId, 'konjunktiv-2', 'tier 2 outranks the unknown-class rule regardless of counts/readiness');
  assert.equal(probe.name, 'Konjunktiv II', 'the display name comes from the weakLog ltName');
  assert.equal(probeTarget({ 'some-rule': sessions(2, 2) }).name, 'some-rule', 'missing ltName falls back to the id');
});

test('OWNER CASE 07-19: interview done + corrections due + gates unmeasured → the app LEADS to sag-es-richtig, never the measure dead-end', () => {
  const d = decide({ sessionCount: 1, srsDueCount: 44, unmeasuredGates: ['intelligibility', 'wpm'] });
  assert.equal(d.state, 'POST_FIGHT');
  assert.equal(d.prescription.action, 'drill');
  assert.equal(d.prescription.drill, 'sag-es-richtig', 'the prescription is his OWN recorded errors, spoken aloud');
  assert.equal(d.confidence, 'low', 'no diagnosis is asserted');
  assert.deepEqual(d.measure, ['intelligibility', 'wpm'], 'the honest measure list stays visible (D4)');
});

test('engine: with NOTHING due the MEASURE state is unchanged (the interim step never invents work)', () => {
  const d = decide({ sessionCount: 1, srsDueCount: 0, unmeasuredGates: ['intelligibility'] });
  assert.equal(d.state, 'MEASURE');
  assert.equal(d.prescription.action, 'measure');
});

test('engine: every directive carries the ranked list (cold start included, honestly empty)', () => {
  const cold = decide({ sessionCount: 0 });
  assert.deepEqual(cold.ranked, []);
  const played = decide({ sessionCount: 3, masteredSkills: ['self-intro', 'praesens-perfekt', 'core-vocab', 'listen-clear'],
    limitingSkill: 'grammar', weakLog: { 'word-order-sub': { errCounts: [{ count: 2 }, { count: 1 }] } } });
  assert.ok(Array.isArray(played.ranked) && played.ranked.length === 1);
  assert.equal(played.ranked[0].sessionsWith, 2);
  assert.equal(played.ranked[0].occurrences, 3);
});
