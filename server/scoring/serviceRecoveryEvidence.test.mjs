import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceRecoveryEvidence, serviceRecoveryEvidenceFromUtterances,
  serviceRecoveryScoreFromSession } from './serviceRecoveryEvidence.js';

test('broad combat qualities cannot manufacture service-recovery evidence', () => {
  const evidence = serviceRecoveryEvidence([
    'Ich spreche fließend Deutsch und kann meine lange Antwort mit vielen Details gut strukturieren.',
    'Außerdem habe ich viel Erfahrung im Kundenservice und arbeite sehr gern professionell im Team.',
  ]);
  assert.equal(evidence.eligible, true);
  assert.equal(evidence.observedSteps, 0);
  assert.equal(evidence.score, 0);
});

test('the proxy counts three distinct observable recovery steps, not repeated phrases', () => {
  const evidence = serviceRecoveryEvidence([
    'Das tut mir wirklich leid, und ich kann Ihren Ärger gut nachvollziehen. Ich kann Ihren Ärger gut nachvollziehen.',
    'Ich kümmere mich persönlich um Ihren Fall. Als Nächstes werde ich die Lieferung prüfen und melde mich morgen.',
  ]);
  assert.deepEqual(evidence.signals, { empathy: true, ownership: true, nextStep: true });
  assert.equal(evidence.observedSteps, 3);
  assert.equal(evidence.score, 1);
});

test('thin roleplay evidence fails closed even when all phrases are present', () => {
  const evidence = serviceRecoveryEvidence([
    'Das tut mir leid. Ich kümmere mich und werde mich morgen melden.',
  ]);
  assert.equal(evidence.eligible, false);
  assert.equal(evidence.score, null);
});

test('typed, cut-off, low-confidence, and non-roleplay turns cannot become spoken evidence', () => {
  const useful = 'Das tut mir wirklich leid. Ich kümmere mich persönlich um Ihren Fall und werde mich morgen melden.';
  const evidence = serviceRecoveryEvidenceFromUtterances([
    { stage: 2, durationMs: 0, text: useful, lowConf: [] },
    { stage: 2, durationMs: 4000, text: 'Das tut mir leid und ich wollte nur', lowConf: [] },
    { stage: 2, durationMs: 4000, text: useful, lowConf: ['kümmere'] },
    { stage: 1, durationMs: 4000, text: useful, lowConf: [] },
  ]);
  assert.equal(evidence.eligible, false);
  assert.equal(evidence.turnCount, 0);
});

test('customer-service structure cannot be relabeled as evidence for unsupported vacancy roles', () => {
  const turns = [
    { stage: 2, durationMs: 4000, text: 'Das tut mir wirklich leid und ich kann Ihren Ärger gut nachvollziehen.', lowConf: [] },
    { stage: 2, durationMs: 4000, text: 'Ich kümmere mich persönlich darum und werde mich morgen bei Ihnen melden.', lowConf: [] },
  ];
  for (const roleType of ['technical_support', 'sales', 'backoffice', '__proto__']) {
    const evidence = serviceRecoveryEvidenceFromUtterances(turns, roleType);
    assert.equal(evidence.eligible, false);
    assert.equal(evidence.score, null);
    assert.equal(evidence.roleType, null);
  }
  assert.equal(serviceRecoveryEvidenceFromUtterances(turns, 'retention').roleType, 'retention');
});

test('persisted score is derived only from strictly valid bounded evidence', () => {
  const valid = { targetRoleType: 'customer_service', deescalation: 1,
    deescalationEvidence: { version: 1, criterionId: 'service_recovery_structure', roleType: 'customer_service',
    observedSteps: 2, totalSteps: 3, turnCount: 2, wordCount: 40 } };
  assert.equal(serviceRecoveryScoreFromSession(valid), 2 / 3);
  assert.equal(serviceRecoveryScoreFromSession({ ...valid, deescalationEvidence: { ...valid.deescalationEvidence, observedSteps: 4 } }), null);
  assert.equal(serviceRecoveryScoreFromSession({ ...valid, targetRoleType: 'technical_support' }), null);
  assert.equal(serviceRecoveryScoreFromSession({ ...valid, deescalationEvidence: { ...valid.deescalationEvidence, roleType: 'retention' } }), null);
  assert.equal(serviceRecoveryScoreFromSession({ deescalation: 1 }), null, 'legacy broad combat score is not trusted');
});
