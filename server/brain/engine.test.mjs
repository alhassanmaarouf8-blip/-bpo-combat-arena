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
  const d = decide({ sessionCount: 5, masteredSkills: entryAndBelow, verifiedMasteredSkills: entryAndBelow });
  assert.equal(d.state, 'APPLY');
  assert.equal(d.prescription.action, 'apply');
});

test('engine: provisional legacy mastery can guide navigation but never authorizes APPLY', () => {
  const entryAndBelow = SKILLS.filter((s) => s.tier !== 'premium').map((s) => s.id);
  const d = decide({ sessionCount: 5, masteredSkills: entryAndBelow, verifiedMasteredSkills: [] });
  assert.notEqual(d.state, 'APPLY');
  assert.equal(d.tier.applyNow, false);
  assert.equal(d.journey.entryDone, 0);
});

test('engine: aha exposes only a validated delayed transfer measurement', () => {
  const verifiedImprovement = { skillId: 'fluency-interrupt', metricKey: 'fluency_score', before: 52, after: 61,
    direction: 'higher', phase: 'transfer' };
  const d = decide({ sessionCount: 3, masteredSkills: SKILLS.filter(s=>s.layer===0).map(s=>s.id), verifiedImprovement });
  assert.deepEqual(d.aha, verifiedImprovement);
});

test('engine: legacy error drops and matched-only retests cannot produce an aha', () => {
  const weakLog = { 'konjunktiv-2': { errCounts: [{ count: 4 }, { count: 1 }], drills: [{ drill: 'sag-es-richtig' }] } };
  const d = decide({ sessionCount: 3, weakLog, lastTargetRuleId: 'konjunktiv-2' });
  assert.equal(d.aha, null);
  const matched = decide({ sessionCount: 3, verifiedImprovement: { skillId: 'konjunktiv-2', metricKey: 'grammar_errors',
    before: 4, after: 1, direction: 'lower', phase: 'matched' } });
  assert.equal(matched.aha, null);
});

test('engine: global regression vetoes a local celebration (honesty)', () => {
  const d = decide({ sessionCount: 3, verifiedImprovement: { skillId: 'konjunktiv-2', metricKey: 'grammar_errors',
    before: 4, after: 1, direction: 'lower', phase: 'transfer' }, globalRegressed: true });
  assert.equal(d.aha, null);
});

test('engine: spoofed metrics, prototype keys and wrong-way changes fail closed', () => {
  const base = { sessionCount: 3, verifiedImprovement: { skillId: 'fluency-interrupt', metricKey: 'fluency_score',
    before: 60, after: 50, direction: 'higher', phase: 'transfer' } };
  assert.equal(decide(base).aha, null);
  assert.equal(decide({ ...base, verifiedImprovement: { ...base.verifiedImprovement, skillId: '__proto__', before: 50, after: 60 } }).aha, null);
  assert.equal(decide({ ...base, verifiedImprovement: { ...base.verifiedImprovement, metricKey: '__proto__', before: 50, after: 60 } }).aha, null);
  assert.equal(decide({ ...base, verifiedImprovement: { ...base.verifiedImprovement, direction: 'lower', before: 50, after: 60 } }).aha, null);
});

test('engine: every directive carries a journey the UI can reflect, and it advances with mastery', () => {
  const layer0 = SKILLS.filter((s) => s.layer === 0).map((s) => s.id);
  const d0 = decide({ sessionCount: 2, masteredSkills: [], verifiedMasteredSkills: [] });
  const dMore = decide({ sessionCount: 2, masteredSkills: layer0, verifiedMasteredSkills: layer0 });
  assert.ok(d0.journey && typeof d0.journey.pctToApply === 'number');
  assert.ok(d0.journey.stepsToApply > 0);
  assert.ok(dMore.journey.entryDone > d0.journey.entryDone);      // advancing skills advances the journey
  assert.ok(dMore.journey.pctToApply >= d0.journey.pctToApply);
});

test('engine: a weakness with <2 sessions of evidence is LOW confidence (no over-claiming)', () => {
  const d = decide({ sessionCount: 1, masteredSkills: SKILLS.filter(s=>s.layer===0).map(s=>s.id),
    limitingSkill: 'grammar', weakLog: { 'dativ-akkusativ': { errCounts: [{ count: 3 }] } } });
  assert.equal(d.confidence, 'low');
});

test('engine: exact forecast criteria select the aligned skill path, never an unrelated frontier item', () => {
  const foundation = ['self-intro', 'praesens-perfekt', 'core-vocab', 'listen-clear'];
  const filler = decide({ sessionCount: 3, masteredSkills: [...foundation, 'no-freeze-expected'],
    limitingSkill: 'confidence', limitingCriterionId: 'filler_dependence' });
  assert.equal(filler.target.skillId, 'fluency-interrupt');
  assert.equal(filler.prescription.criterionId, 'filler_dependence');

  const lexical = decide({ sessionCount: 3, masteredSkills: [], limitingSkill: 'complexity',
    limitingCriterionId: 'lexical_range_proxy' });
  assert.equal(lexical.target.skillId, 'core-vocab');

  const lockedPhone = decide({ sessionCount: 3, masteredSkills: [], limitingSkill: 'intelligibility',
    limitingCriterionId: 'speech_recognition_proxy' });
  assert.equal(lockedPhone.target.skillId, 'listen-clear');
});

test('engine: repeated reliable criterion evidence raises confidence without requiring a grammar weakLog', () => {
  const foundation = ['self-intro', 'praesens-perfekt', 'core-vocab', 'listen-clear', 'no-freeze-expected'];
  const one = decide({ sessionCount: 1, masteredSkills: foundation, limitingSkill: 'fluency',
    limitingCriterionId: 'sustained_pace', limitingEvidenceCount: 1 });
  const repeated = decide({ sessionCount: 2, masteredSkills: foundation, limitingSkill: 'fluency',
    limitingCriterionId: 'sustained_pace', limitingEvidenceCount: 2 });
  assert.equal(one.confidence, 'low');
  assert.equal(repeated.confidence, 'high');
  assert.equal(repeated.target.skillId, 'fluency-interrupt');
});

test('engine: a due vacancy step becomes the one next action after the honest cold-start assessment', () => {
  const vacancyDue = {
    id:'day_3_evidence', title:'Relevante STAR-Geschichte', objective:'Formuliere einen Beleg.',
    scheduledDate:'2026-07-13', liveRequired:false,
  };
  const cold = decide({ sessionCount:0, vacancyDue });
  assert.equal(cold.prescription.action, 'assessment');
  const active = decide({ sessionCount:1, vacancyDue });
  assert.equal(active.state, 'VACANCY_PREP');
  assert.deepEqual(active.prescription, { action:'vacancy', milestoneId:'day_3_evidence', title:vacancyDue.title,
    objective:vacancyDue.objective, scheduledDate:'2026-07-13', liveRequired:false });
});

test('engine: Mission Control is one copy-free next action and never outranks interview preparation', () => {
  const missionDue = { step:'pack', opportunityId:'opp_123', employer:'must-not-leak' };
  const mission = decide({ sessionCount:2, missionDue });
  assert.equal(mission.state, 'MISSION_CONTROL');
  assert.deepEqual(mission.prescription, { action:'mission', step:'pack', opportunityId:'opp_123' });
  assert.equal(JSON.stringify(mission).includes('must-not-leak'), false);

  const vacancyDue = { id:'day_6_mock', title:'Probeinterview', objective:'Drucktest', scheduledDate:'2026-07-13' };
  const interviewFirst = decide({ sessionCount:2, missionDue, vacancyDue });
  assert.equal(interviewFirst.prescription.action, 'vacancy');
});

test('engine: unknown Mission Control steps fail closed into the legacy policy', () => {
  const legacy = decide({ sessionCount:2, missionDue:{ step:'__proto__', opportunityId:'bad/id' } });
  assert.notEqual(legacy.state, 'MISSION_CONTROL');
});
