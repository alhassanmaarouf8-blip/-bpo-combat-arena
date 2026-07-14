/**
 * hireReadiness.test.mjs — textFeatures() is now load-bearing for TWO features (the hire-readiness
 * diagnostic AND, as of 2026-07-02, Flow-Drill's structural-complexity signal) but had zero test
 * coverage. Covers the honest <20-word gate (never fabricate a rate from too little text) and
 * real subordinate-clause detection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hireReadinessFor, textFeatures } from './hireReadiness.js';

test('textFeatures: under 20 words returns null rates (honest gate, no fabricated signal)', () => {
  const f = textFeatures('Ich habe drei Jahre Erfahrung im Kundenservice.');
  assert.equal(f.subClauseRate, null);
  assert.equal(f.vocabDiversity, null);
  assert.ok(f.wordCount < 20);
});

test('textFeatures: a long, subordinate-clause-rich answer gets a real, non-zero rate', () => {
  const text = 'Ich habe drei Jahre Erfahrung im Kundenservice gesammelt, weil ich schon immer gerne '
    + 'mit Menschen gearbeitet habe, und ich glaube, dass ich sehr gut zuhören kann, wenn ein Kunde '
    + 'ein Problem hat, das schnell gelöst werden muss.';
  const f = textFeatures(text);
  assert.ok(f.wordCount >= 20);
  assert.ok(f.subClauseRate > 0, `expected subClauseRate > 0, got ${f.subClauseRate}`);
});

test('textFeatures: a long answer with NO subordinate clauses gets a rate near zero', () => {
  const text = 'Ich bin Ahmed. Ich habe drei Jahre Erfahrung. Ich arbeite gerne im Team. Ich bin '
    + 'pünktlich. Ich lerne schnell neue Dinge. Ich helfe gerne anderen Kollegen im Büro jeden Tag.';
  const f = textFeatures(text);
  assert.ok(f.wordCount >= 20);
  assert.equal(f.subClauseRate, 0);
});

test('textFeatures: vocabDiversity is bounded to [0.2, 0.8] even for extreme repetition', () => {
  const repeated = Array(25).fill('immer').join(' ');
  const f = textFeatures(repeated);
  assert.ok(f.vocabDiversity >= 0.2 && f.vocabDiversity <= 0.8);
});

test('hire readiness refuses perfect-looking metrics from a thin session', () => {
  const result = hireReadinessFor({ assessmentResult: { estimatedLevel: 'B1' }, sessions: [{
    date: 1, answers: 1, words: 12, wpm: 150, fillers: 0, grammarRules: [], subClauseRate: 1,
    vocabDiversity: 0.8, deescalation: 1, giveUpRate: 0, intelligibility: 1, latencyS: 0.5,
  }] });
  assert.equal(result.hireReady, null);
  assert.equal(result.limitingSkill, null);
  assert.deepEqual(result.interviewRisk, { state: 'measure_first', confidence: 'insufficient', limitingSkill: null });
});

test('hire readiness names only an observed risk from a reliable packet', () => {
  const result = hireReadinessFor({ sessions: [{
    date: 1, targetRoleType: 'customer_service', wpm: 120, fillers: 2, words: 120, grammarMeasured: true, grammarRules: [], subClauseRate: 0.3,
    vocabDiversity: 0.5, deescalation: 1,
    deescalationEvidence: { version: 1, criterionId: 'service_recovery_structure', roleType: 'customer_service', observedSteps: 3,
      totalSteps: 3, turnCount: 3, wordCount: 70 },
    giveUpRate: 0.1, intelligibility: 0.4, latencyS: 2,
    evidenceQuality: { version: 1, words: 120, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.equal(result.hireReady, null, 'internal simulation evidence cannot claim an employer outcome');
  assert.equal(result.simulationReady, false);
  assert.equal(result.limitingSkill, 'intelligibility');
  assert.deepEqual(result.interviewRisk, { state: 'observed_risk', confidence: 'high', limitingSkill: 'intelligibility' });
  assert.equal(result.rejectionForecast.state, 'observed_simulation_risk');
  assert.equal(result.rejectionForecast.criterion.criterionId, 'speech_recognition_proxy');
  assert.equal(result.rejectionForecast.calibration, 'internal_simulation_reference_only');
});

test('grammar and fillers are normalized per 100 reliable spoken words', () => {
  const result = hireReadinessFor({ sessions: [{
    date: 10, bossId: 'tarek', targetIndustry: 'telecom', targetRoleType: 'technical_support', scenarioId: 'telecom-router-1',
    wpm: 125, words: 200, fillers: 24, grammarMeasured: true,
    grammarRules: [{ ruleId: 'word-order-sub', count: 20 }], subClauseRate: 0.4, vocabDiversity: 0.6,
    deescalation: 1,
    deescalationEvidence: { version: 1, criterionId: 'service_recovery_structure', roleType: 'customer_service', observedSteps: 3,
      totalSteps: 3, turnCount: 3, wordCount: 70 },
    giveUpRate: 0.05, intelligibility: 0.9, latencyS: 2,
    evidenceQuality: { version: 1, words: 200, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.equal(result.limitingSkill, 'grammar');
  assert.ok(result.note.includes('deescalation'), 'customer-service evidence must be ignored for technical support');
  assert.equal(result.rejectionForecast.criterion.observed, 10);
  assert.deepEqual(result.rejectionForecast.target, {
    roleType: 'technical_support', industryKey: 'telecom', bossArchetype: 'kpi_pressure',
    scenarioId: 'telecom-router-1', source: 'industry_snapshot',
  });
});

test('unavailable grammar analysis cannot manufacture a zero-error measurement', () => {
  const result = hireReadinessFor({ sessions: [{
    date: 10, wpm: 125, words: 200, fillers: 2, grammarMeasured: false, grammarRules: [],
    subClauseRate: 0.4, vocabDiversity: 0.6, deescalation: 0.8, giveUpRate: 0.05, intelligibility: 0.9, latencyS: 2,
    evidenceQuality: { version: 1, words: 200, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.ok(result.note.includes('errPer100'));
  assert.notEqual(result.limitingSkill, 'grammar');
  assert.equal(result.simulationReady, null);
});

test('a broad legacy combat score cannot become service-recovery evidence', () => {
  const result = hireReadinessFor({ sessions: [{
    date: 10, wpm: 120, words: 160, fillers: 2, grammarMeasured: true, grammarRules: [],
    subClauseRate: 0.4, vocabDiversity: 0.6, deescalation: 1, giveUpRate: 0.05, intelligibility: 0.9, latencyS: 2,
    evidenceQuality: { version: 1, words: 160, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.ok(result.note.includes('deescalation'));
  assert.equal(result.measuredSignals, 8);
  assert.notEqual(result.limitingSkill, 'deescalation');
});

test('forecast reports exact observed recovery steps rather than a generic combat percentage', () => {
  const result = hireReadinessFor({ sessions: [{
    date: 10, targetRoleType: 'customer_service', wpm: 125, words: 160, fillers: 2, grammarMeasured: true, grammarRules: [],
    subClauseRate: 0.4, vocabDiversity: 0.6, deescalation: 1 / 3,
    deescalationEvidence: { version: 1, criterionId: 'service_recovery_structure', roleType: 'customer_service', observedSteps: 1,
      totalSteps: 3, turnCount: 3, wordCount: 70 },
    giveUpRate: 0.05, intelligibility: 0.9, latencyS: 2,
    evidenceQuality: { version: 1, words: 160, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.equal(result.limitingSkill, 'deescalation');
  assert.deepEqual(result.rejectionForecast.criterion, { stageId: 'customer_roleplay',
    criterionId: 'service_recovery_structure', targetRoleType: 'customer_service', observed: 1, reference: 2,
    direction: 'at_least', unit: 'recovery_steps_out_of_3' });
});

test('retention forecast keeps the exact snapshotted role and scenario criterion', () => {
  const result = hireReadinessFor({ sessions: [{
    date: 11, targetRoleType: 'retention', scenarioId: 'telecom-kuendigung', wpm: 125, words: 160,
    fillers: 2, grammarMeasured: true, grammarRules: [], subClauseRate: 0.4, vocabDiversity: 0.6,
    deescalation: 1 / 3,
    deescalationEvidence: { version: 1, criterionId: 'service_recovery_structure', roleType: 'retention',
      observedSteps: 1, totalSteps: 3, turnCount: 3, wordCount: 70 },
    giveUpRate: 0.05, intelligibility: 0.9, latencyS: 2,
    evidenceQuality: { version: 1, words: 160, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.deepEqual(result.rejectionForecast.criterion, {
    stageId: 'retention_roleplay', criterionId: 'service_recovery_structure',
    targetRoleType: 'retention', scenarioId: 'telecom-kuendigung', observed: 1, reference: 2,
    direction: 'at_least', unit: 'recovery_steps_out_of_3',
  });
});
