import test from 'node:test';
import assert from 'node:assert/strict';
import { CS_SCENARIOS } from '../scenarios.js';
import { serviceRecoveryEvidence, serviceRecoveryEvidenceFromUtterances,
  serviceRecoveryScoreFromSession } from './serviceRecoveryEvidence.js';

const baseContext = Object.freeze({
  sessionId: 'session_1', targetId: null, roleType: 'customer_service',
  scenarioId: CS_SCENARIOS[0].id, observedAt: 1_700_000_000_000,
});
const completeTurns = Object.freeze([
  'Das tut mir wirklich leid, und ich kann Ihren \u00c4rger gut nachvollziehen.',
  'Ich k\u00fcmmere mich pers\u00f6nlich um Ihren Fall. Als N\u00e4chstes werde ich die Lieferung pr\u00fcfen und melde mich morgen.',
]);

function storedEvidence(evidence) {
  const keys = ['version', 'criterionId', 'criterionVersion', 'binding', 'roleType', 'scenarioId',
    'targetId', 'sessionId', 'observedAt', 'contradicted', 'observedSteps', 'totalSteps', 'turnCount', 'wordCount'];
  return Object.fromEntries(keys.map((key) => [key, evidence[key]]));
}

function sessionFor(evidence, overrides = {}) {
  return {
    date: baseContext.observedAt, sessionId: baseContext.sessionId,
    targetRoleType: baseContext.roleType, scenarioId: baseContext.scenarioId,
    deescalation: evidence.score, deescalationEvidence: storedEvidence(evidence), ...overrides,
  };
}

test('broad combat qualities cannot manufacture service-recovery evidence', () => {
  const evidence = serviceRecoveryEvidence([
    'Ich spreche flie\u00dfend Deutsch und kann meine lange Antwort mit vielen Details gut strukturieren.',
    'Au\u00dferdem habe ich viel Erfahrung im Kundenservice und arbeite sehr gern professionell im Team.',
  ], baseContext);
  assert.equal(evidence.eligible, true);
  assert.equal(evidence.observedSteps, 0);
  assert.equal(evidence.score, 0);
});

test('the proxy requires three distinct observable recovery steps in the approved order', () => {
  const evidence = serviceRecoveryEvidence(completeTurns, baseContext);
  assert.deepEqual(evidence.signals, { empathy: true, ownership: true, nextStep: true });
  assert.equal(evidence.observedSteps, 3);
  assert.equal(evidence.score, 1);

  const wrongOrder = serviceRecoveryEvidence([
    'Als N\u00e4chstes werde ich die Lieferung pr\u00fcfen. Das tut mir wirklich leid und ich verstehe Ihren \u00c4rger.',
    'Ich k\u00fcmmere mich pers\u00f6nlich um Ihren Fall und dokumentiere das jetzt.',
  ], baseContext);
  assert.equal(wrongOrder.signals.nextStep, false);
  assert.ok(wrongOrder.score < 1);
});

test('negation, refusal, and vague promises can never earn recovery credit', () => {
  for (const phrase of [
    'Ich verstehe Ihren \u00c4rger, aber ich \u00fcbernehme keine Verantwortung. Wir werden nichts tun.',
    'Das tut mir wirklich leid. Das ist nicht unser Problem, und Sie sind selbst schuld.',
    'Ich kann Ihren \u00c4rger nachvollziehen. Ich k\u00fcmmere mich gar nicht darum. Wir werden nicht pr\u00fcfen.',
  ]) {
    const evidence = serviceRecoveryEvidence([phrase, 'Ich m\u00f6chte dazu keine weitere konkrete Zusage machen.'], baseContext);
    assert.equal(evidence.eligible, true);
    assert.equal(evidence.contradicted, true);
    assert.equal(evidence.observedSteps, 0);
    assert.equal(evidence.score, 0);
  }
});

test('thin roleplay evidence fails closed even when all phrases are present', () => {
  const evidence = serviceRecoveryEvidence([
    'Das tut mir leid. Ich k\u00fcmmere mich und werde mich morgen melden.',
  ], baseContext);
  assert.equal(evidence.eligible, false);
  assert.equal(evidence.score, null);
});

test('typed, cut-off, low-confidence, and non-roleplay turns cannot become spoken evidence', () => {
  const useful = 'Das tut mir wirklich leid. Ich k\u00fcmmere mich pers\u00f6nlich um Ihren Fall und melde mich morgen.';
  const evidence = serviceRecoveryEvidenceFromUtterances([
    { stage: 2, durationMs: 0, text: useful, lowConf: [] },
    { stage: 2, durationMs: 4000, text: 'Das tut mir leid und ich wollte nur', lowConf: [] },
    { stage: 2, durationMs: 4000, text: useful, lowConf: ['kuemmere'] },
    { stage: 1, durationMs: 4000, text: useful, lowConf: [] },
  ], baseContext);
  assert.equal(evidence.eligible, false);
  assert.equal(evidence.turnCount, 0);
});

test('retention and unsupported roles fail closed until their own criterion exists', () => {
  const turns = completeTurns.map((text) => ({ stage: 2, durationMs: 4000, text, lowConf: [] }));
  for (const roleType of ['retention', 'technical_support', 'sales', 'backoffice', '__proto__']) {
    const evidence = serviceRecoveryEvidenceFromUtterances(turns, { ...baseContext, roleType });
    assert.equal(evidence.eligible, false);
    assert.equal(evidence.score, null);
    assert.equal(evidence.roleType, null);
  }
});

test('persisted score requires an exact immutable session-target-role-scenario binding', () => {
  const evidence = serviceRecoveryEvidence(completeTurns, baseContext);
  const valid = sessionFor(evidence);
  assert.equal(serviceRecoveryScoreFromSession(valid), 1);
  for (const changed of [
    { sessionId: 'session_2' },
    { date: baseContext.observedAt + 1 },
    { targetRoleType: 'technical_support' },
    { scenarioId: CS_SCENARIOS[1].id },
    { vacancyTargetId: 'vac_changed' },
  ]) assert.equal(serviceRecoveryScoreFromSession({ ...valid, ...changed }), null);
  assert.equal(serviceRecoveryScoreFromSession({ ...valid,
    deescalationEvidence: { ...valid.deescalationEvidence, observedSteps: 2 } }), null,
  'an in-range score mutation must also break the payload binding');
  assert.equal(serviceRecoveryScoreFromSession({ deescalation: 1 }), null, 'legacy broad combat score is not trusted');
});

test('a bound contradiction remains valid zero evidence after persistence', () => {
  const context = { ...baseContext, sessionId: 'session_contradiction', observedAt: baseContext.observedAt + 1 };
  const evidence = serviceRecoveryEvidence([
    'Das tut mir wirklich leid und ich kann Ihren \u00c4rger gut nachvollziehen.',
    'Aber das ist nicht unser Problem und wir werden nichts tun oder pr\u00fcfen.',
  ], context);
  assert.equal(evidence.eligible, true);
  assert.equal(evidence.contradicted, true);
  assert.equal(evidence.score, 0);
  const stored = sessionFor(evidence, { date: context.observedAt, sessionId: context.sessionId });
  assert.equal(serviceRecoveryScoreFromSession(stored), 0);
  assert.equal(serviceRecoveryScoreFromSession({ ...stored,
    deescalationEvidence: { ...stored.deescalationEvidence, contradicted: false } }), null);
});
