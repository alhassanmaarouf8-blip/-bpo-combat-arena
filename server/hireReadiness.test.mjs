/**
 * hireReadiness.test.mjs — textFeatures() is now load-bearing for TWO features (the hire-readiness
 * diagnostic AND, as of 2026-07-02, Flow-Drill's structural-complexity signal) but had zero test
 * coverage. Covers the honest <20-word gate (never fabricate a rate from too little text) and
 * real subordinate-clause detection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hireReadinessFor, textFeatures } from './hireReadiness.js';
import { CS_SCENARIOS } from './scenarios.js';
import { serviceRecoveryEvidence } from './scoring/serviceRecoveryEvidence.js';

const RECOVERY_TURNS = Object.freeze({
  1: Object.freeze([
    'Das tut mir wirklich leid, und ich kann Ihren \u00c4rger gut nachvollziehen.',
    'Ich habe Ihre Angaben vollst\u00e4ndig aufgenommen und h\u00f6re Ihnen weiterhin aufmerksam zu.',
  ]),
  3: Object.freeze([
    'Das tut mir wirklich leid, und ich kann Ihren \u00c4rger gut nachvollziehen.',
    'Ich k\u00fcmmere mich pers\u00f6nlich um Ihren Fall. Als N\u00e4chstes werde ich die Lieferung pr\u00fcfen und melde mich morgen.',
  ]),
});

function recoveryFields(date, observedSteps = 3) {
  const context = { sessionId: `session_${date}`, targetId: null, roleType: 'customer_service',
    scenarioId: CS_SCENARIOS[0].id, observedAt: date };
  const evidence = serviceRecoveryEvidence(RECOVERY_TURNS[observedSteps], context);
  const stored = Object.fromEntries(['version', 'criterionId', 'criterionVersion', 'binding', 'roleType',
    'scenarioId', 'targetId', 'sessionId', 'observedAt', 'contradicted', 'observedSteps', 'totalSteps',
    'turnCount', 'wordCount'].map((key) => [key, evidence[key]]));
  return { sessionId: context.sessionId, targetRoleType: context.roleType, scenarioId: context.scenarioId,
    deescalation: evidence.score, deescalationEvidence: stored };
}

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
    date: 1, ...recoveryFields(1, 3), wpm: 120, fillers: 2, words: 120, grammarMeasured: true, grammarRules: [], subClauseRate: 0.3,
    vocabDiversity: 0.5,
    giveUpRate: 0.1, intelligibility: 0.4, latencyS: 2,
    evidenceQuality: { version: 1, words: 120, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.equal(result.hireReady, null, 'internal simulation evidence cannot claim an employer outcome');
  assert.equal(result.simulationReady, null, 'one session can never authorize a high-confidence readiness state');
  assert.equal(result.limitingSkill, 'intelligibility');
  assert.deepEqual(result.interviewRisk, { state: 'observed_risk', confidence: 'medium', limitingSkill: 'intelligibility' });
  assert.equal(result.rejectionForecast.state, 'observed_simulation_risk');
  assert.equal(result.rejectionForecast.criterion.criterionId, 'speech_recognition_proxy');
  assert.equal(result.rejectionForecast.calibration, 'internal_simulation_reference_only');
});

test('grammar and fillers are normalized per 100 reliable spoken words', () => {
  const result = hireReadinessFor({ sessions: [{
    date: 10, ...recoveryFields(10, 3), bossId: 'tarek', targetIndustry: 'telecom', targetRoleType: 'technical_support', scenarioId: 'telecom-portierung',
    wpm: 125, words: 200, fillers: 24, grammarMeasured: true,
    grammarRules: [{ ruleId: 'word-order-sub', count: 20 }], subClauseRate: 0.4, vocabDiversity: 0.6,
    giveUpRate: 0.05, intelligibility: 0.9, latencyS: 2,
    evidenceQuality: { version: 1, words: 200, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.equal(result.limitingSkill, 'grammar');
  assert.ok(result.note.includes('deescalation'), 'customer-service evidence must be ignored for technical support');
  assert.equal(result.rejectionForecast.criterion.observed, 10);
  assert.deepEqual(result.rejectionForecast.target, {
    roleType: 'technical_support', industryKey: 'telecom', bossArchetype: 'kpi_pressure',
    scenarioId: 'telecom-portierung', source: 'industry_snapshot', current: false,
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
    date: 10, ...recoveryFields(10, 1), wpm: 125, words: 160, fillers: 2, grammarMeasured: true, grammarRules: [],
    subClauseRate: 0.4, vocabDiversity: 0.6,
    giveUpRate: 0.05, intelligibility: 0.9, latencyS: 2,
    evidenceQuality: { version: 1, words: 160, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.equal(result.limitingSkill, 'deescalation');
  assert.deepEqual(result.rejectionForecast.criterion, { stageId: 'customer_roleplay',
    criterionId: 'service_recovery_structure', targetRoleType: 'customer_service', scenarioId: CS_SCENARIOS[0].id,
    observed: 1, reference: 2,
    direction: 'at_least', unit: 'recovery_steps_out_of_3' });
});

test('retention fails closed until its own validated criterion exists', () => {
  const result = hireReadinessFor({ sessions: [{
    date: 11, targetRoleType: 'retention', scenarioId: 'telecom-kuendigung', wpm: 125, words: 160,
    fillers: 2, grammarMeasured: true, grammarRules: [], subClauseRate: 0.4, vocabDiversity: 0.6,
    deescalation: 1 / 3,
    deescalationEvidence: { version: 2, criterionId: 'service_recovery_structure', roleType: 'retention' },
    giveUpRate: 0.05, intelligibility: 0.9, latencyS: 2,
    evidenceQuality: { version: 1, words: 160, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.ok(result.note.includes('deescalation'));
  assert.notEqual(result.rejectionForecast.criterion?.criterionId, 'service_recovery_structure');
});

test('the newest reliable session wins even when storage order is scrambled', () => {
  const old = { date: 1_700_000_000_000, wpm: 70, words: 120, fillers: 2,
    grammarMeasured: true, grammarRules: [], subClauseRate: 0.3, vocabDiversity: 0.5,
    giveUpRate: 0.1, intelligibility: 0.9, latencyS: 2,
    evidenceQuality: { version: 1, words: 120, prescriptionEligible: true } };
  const newest = { ...old, date: old.date + 10_000, wpm: 130, intelligibility: 0.35 };
  const result = hireReadinessFor({ sessions: [newest, old] }, newest.date + 1000);
  assert.equal(result.limitingSkill, 'intelligibility');
  assert.equal(result.rejectionForecast.criterion.observed, 35);
});

test('old evidence and deleted vacancy targets are historical, never current target forecasts', () => {
  const now = 1_800_000_000_000;
  const session = { date: now - 15 * 24 * 60 * 60 * 1000, vacancyTargetId: 'vacancy_old',
    targetRoleType: 'technical_support', targetIndustry: 'telecom', scenarioId: 'telecom-portierung',
    wpm: 120, words: 120, fillers: 2, grammarMeasured: true, grammarRules: [], subClauseRate: 0.3,
    vocabDiversity: 0.5, giveUpRate: 0.1, intelligibility: 0.4, latencyS: 2,
    evidenceQuality: { version: 1, words: 120, prescriptionEligible: true } };
  const stale = hireReadinessFor({ sessions: [session], vacancyTarget: { active: { id: 'vacancy_old' } } }, now);
  assert.equal(stale.rejectionForecast.state, 'historical_only');
  assert.equal(stale.rejectionForecast.freshness, 'historical');
  const deleted = hireReadinessFor({ sessions: [{ ...session, date: now - 1000 }], vacancyTarget: { active: null } }, now);
  assert.equal(deleted.rejectionForecast.state, 'historical_only');
  assert.equal(deleted.rejectionForecast.target.current, false);
});

test('high criterion confidence requires a validated recent transfer proof', () => {
  const now = 1_800_000_000_000;
  const session = { date: now - 1000, wpm: 120, words: 120, fillers: 2,
    grammarMeasured: true, grammarRules: [], subClauseRate: 0.3, vocabDiversity: 0.5,
    giveUpRate: 0.1, intelligibility: 0.4, latencyS: 2,
    evidenceQuality: { version: 1, words: 120, prescriptionEligible: true, highConfidence: true } };
  const transfer = { id: '1111111111111111', prescriptionId: '2222222222222222',
    measurementEvidenceId: '333333333333', retestSessionId: 'transfer-session',
    skillId: 'pronunciation-phone', metricKey: 'intelligibility_score', phase: 'transfer', status: 'improved',
    before: 60, after: 70, verifiedAt: now - 500 };
  const result = hireReadinessFor({ sessions: [session], salmaCoach: { coachState: { improvementHistory: [transfer] } } }, now);
  assert.equal(result.interviewRisk.confidence, 'high');
  assert.equal(result.rejectionForecast.confidence, 'high');
  const expired = hireReadinessFor({ sessions: [session], salmaCoach: { coachState: {
    improvementHistory: [{ ...transfer, verifiedAt: now - 91 * 24 * 60 * 60 * 1000 }] } } }, now);
  assert.equal(expired.interviewRisk.confidence, 'medium');
  const targetedSession = { ...session, vacancyTargetId: 'vacancy_now' };
  const targeted = hireReadinessFor({ sessions: [targetedSession], vacancyTarget: { active: { id: 'vacancy_now' } },
    salmaCoach: { coachState: { improvementHistory: [transfer] } } }, now);
  assert.equal(targeted.rejectionForecast.target.current, true);
  assert.equal(targeted.rejectionForecast.confidence, 'medium',
  'a generic transfer proof cannot elevate an exact vacancy forecast without a target binding');
});
