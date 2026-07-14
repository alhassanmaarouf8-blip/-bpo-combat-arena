import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from './store.js';
import { CS_SCENARIOS } from './scenarios.js';
import { serviceRecoveryEvidence } from './scoring/serviceRecoveryEvidence.js';
import { acknowledgeEvent, answerSalmaQuestion, cairoDay, coachCueForDrill, consumeQuestion,
  deriveSalmaPrescription, measurementForSkill, normalizeSalmaCoachState, publicSalmaCoach, recordDrillOutcome,
  publicListeningRetest, publicSpeakingRetest, recordMeaningfulRetest, salmaCoachCapabilities, salmaCoachFlags,
  salmaRetestTarget, safeIntervention, updatePreferences } from './salmaCoachCore.js';

function account(plan = 'free') {
  return { id: 'acct-1', emailVerifiedAt: 1, roles: [], subscription: { plan } };
}
function reliableSession(value) {
  return { sessionId: value?.sessionId || `session-${value?.date}`, targetRoleType: value?.targetRoleType || 'customer_service',
    scenarioId: value?.scenarioId || 'customer-general-a', ...value,
    evidenceQuality: { version: 1, words: 120, completeTurns: 5, truncatedTurns: 0,
    stageCoverage: 2, prescriptionEligible: true, highConfidence: false } };
}
function recoveryFields(date) {
  const context = { sessionId: `session_${date}`, targetId: null, roleType: 'customer_service',
    scenarioId: CS_SCENARIOS[0].id, observedAt: date };
  const evidence = serviceRecoveryEvidence([
    'Das tut mir wirklich leid, und ich kann Ihren \u00c4rger gut nachvollziehen.',
    'Ich k\u00fcmmere mich pers\u00f6nlich um Ihren Fall und dokumentiere ihn jetzt sorgf\u00e4ltig.',
  ], context);
  const stored = Object.fromEntries(['version', 'criterionId', 'criterionVersion', 'binding', 'roleType',
    'scenarioId', 'targetId', 'sessionId', 'observedAt', 'contradicted', 'observedSteps', 'totalSteps',
    'turnCount', 'wordCount'].map((key) => [key, evidence[key]]));
  return { sessionId: context.sessionId, targetRoleType: context.roleType, scenarioId: context.scenarioId,
    deescalation: evidence.score, deescalationEvidence: stored };
}
function measuredProfile(sessionCount = 1) {
  const p = defaultProfile('acct-1');
  p.sessions = Array.from({ length: sessionCount }, (_, i) => {
    const date = 1_700_000_000_000 + i;
    return reliableSession({ date, ...recoveryFields(date), bossId: 'yasmin', verdict: 'review',
    wpm: 95, fluency: 52, fillers: 6, grammarRules: [{ rule: 'x', count: 4 }], subClauseRate: 0.2,
    vocabDiversity: 0.5,
    giveUpRate: 0.1, intelligibility: 0.75, latencyS: 3 });
  });
  return p;
}

test('feature flags fail closed and beta is account allowlisted', () => {
  assert.equal(salmaCoachFlags({}, account()).enabled, false);
  assert.equal(salmaCoachFlags({ SALMA_COACH_MODE: 'garbage' }, account()).mode, 'off');
  assert.equal(salmaCoachFlags({ SALMA_COACH_MODE: 'beta', SALMA_COACH_BETA_ACCOUNT_IDS: 'other' }, account()).enabled, false);
  assert.equal(salmaCoachFlags({ SALMA_COACH_MODE: 'beta', SALMA_COACH_BETA_ACCOUNT_IDS: 'acct-1' }, account()).enabled, true);
  const flags = salmaCoachFlags({ SALMA_COACH_MODE: 'on', SALMA_COACH_AI_ENABLED: 'true', SALMA_COACH_VOICE_ENABLED: 'true' }, account());
  assert.equal(flags.aiEnabled, true); assert.equal(flags.voiceEnabled, true);
});

test('entitlements expose 3/30/60 questions without changing plan truth', () => {
  assert.equal(salmaCoachCapabilities(account('free')).dailyQuestions, 3);
  assert.equal(salmaCoachCapabilities(account('basic')).dailyQuestions, 30);
  assert.equal(salmaCoachCapabilities(account('elite')).dailyQuestions, 60);
});

test('prescription is evidence-hashed, idempotent and respects a five-minute budget', () => {
  const p = measuredProfile(1);
  const a = deriveSalmaPrescription(p, { now: 1_700_000_001_000, dailyMinutes: 5 }).prescription;
  const b = deriveSalmaPrescription(p, { now: 1_700_000_002_000, dailyMinutes: 5 }).prescription;
  assert.ok(a); assert.equal(a.id, b.id); assert.equal(a.durationSeconds <= 300, true);
  assert.equal(a.timesPerDay, 1); assert.equal(a.evidenceIds.length, 1);
});

test('thin evidence produces no confident prescription', () => {
  const result = deriveSalmaPrescription(defaultProfile('acct-1'), { now: 1_800_000_000_000 });
  assert.equal(result.prescription, null); assert.equal(result.directive.state, 'NEW');
});

test('stale speaking evidence cannot create a new personal prescription', () => {
  const p = measuredProfile(1);
  const result = deriveSalmaPrescription(p, { now: 1_700_000_000_000 + 15 * 24 * 60 * 60 * 1000 });
  assert.equal(result.prescription, null);
});

test('a short persisted practice session cannot become Salma diagnostic evidence', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [{ date: 1_800_000_000_000, bossId: 'yasmin', answers: 1, words: 12,
    fluency: 99, deescalation: 1, giveUpRate: 0, intelligibility: 1 }];
  assert.equal(measurementForSkill(p, 'fluency-interrupt'), null);
  assert.equal(deriveSalmaPrescription(p, { now: 1_800_000_001_000 }).prescription, null);
  assert.equal(publicSalmaCoach(p, account('basic'), { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false })
    .interviewRisk.state, 'measure_first');
});

test('preferences are strict and Masri cannot be selected before approval', () => {
  const state = updatePreferences(null, { dailyMinutes: 20, preferredWindows: ['morning'], autoSpeak: true });
  assert.equal(state.preferences.dailyMinutes, 20); assert.deepEqual(state.preferences.preferredWindows, ['morning']);
  assert.throws(() => updatePreferences(state, { languageSupport: 'ar' }), /language_not_approved/u);
  assert.throws(() => updatePreferences(state, { unknown: true }), /invalid_preferences/u);
});

test('new intervention disappears after idempotent acknowledgement', () => {
  const state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'word-order-sub', drillId: 'satzbau-schmiede',
    blocks: 1, repetitions: 6, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240,
    successGate: 'Zweimal korrekt.', assignedAt: 1, nextEligibleAt: null };
  assert.equal(safeIntervention(state).id, state.activePrescription.id);
  const acked = acknowledgeEvent(state, state.activePrescription.id);
  assert.equal(safeIntervention(acked), null);
  assert.equal(acknowledgeEvent(acked, state.activePrescription.id).coachState.lastHandledEventId, state.activePrescription.id);
});

test('a one-session signal is prescribed as a hypothesis, never spoken as a confirmed bottleneck', () => {
  const p = measuredProfile(1);
  const { directive, prescription } = deriveSalmaPrescription(p, { now: 1_700_000_001_000 });
  assert.equal(directive.confidence, 'low');
  assert.equal(prescription.evidenceConfidence, 'low');
  const state = normalizeSalmaCoachState({ activePrescription: prescription });
  const intervention = safeIntervention(state);
  assert.match(intervention.text, /ersten zuverlässigen Hinweis/u);
  assert.doesNotMatch(intervention.text, /Dein Engpass ist/u);
});

test('the same reliable risk across two sessions earns a spaced second block and high-evidence wording', () => {
  const p = measuredProfile(2);
  const now = 1_700_000_010_000;
  const { directive, prescription } = deriveSalmaPrescription(p, { now, dailyMinutes: 20 });
  assert.equal(directive.confidence, 'high');
  assert.equal(prescription.evidenceConfidence, 'high');
  assert.equal(prescription.blocks, 2);
  assert.equal(prescription.timesPerDay, 2);
  assert.equal(prescription.nextEligibleAt, now + prescription.minimumSpacingMinutes * 60_000);
  assert.match(safeIntervention(normalizeSalmaCoachState({ activePrescription: prescription })).text,
    /wiederholter zuverlässiger Evidenz/u);
});

test('proof then prescription acknowledgements cannot oscillate forever', () => {
  const state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '1111111111111111', evidenceIds: [], skillId: 'word-order-sub', drillId: 'satzbau-schmiede',
    blocks: 1, repetitions: 6, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240,
    successGate: 'Zweimal korrekt.', assignedAt: 200, nextEligibleAt: null, baseline: null };
  state.coachState.improvementHistory = [{ id: '2222222222222222', prescriptionId: '3333333333333333', skillId: 'word-order-sub',
    metricKey: 'grammar_errors', before: 4, after: 1, status: 'improved', verifiedAt: 100, retestSessionId: 'live-1' }];
  assert.equal(safeIntervention(state).id, '2222222222222222');
  const proofAcked = acknowledgeEvent(state, '2222222222222222');
  assert.equal(safeIntervention(proofAcked).id, '1111111111111111');
  const prescriptionAcked = acknowledgeEvent(proofAcked, '1111111111111111');
  assert.equal(safeIntervention(prescriptionAcked), null);
  prescriptionAcked.activePrescription = { ...prescriptionAcked.activePrescription, id: '4444444444444444' };
  assert.equal(safeIntervention(prescriptionAcked).id, '4444444444444444');
  const replacementAcked = acknowledgeEvent(prescriptionAcked, '4444444444444444');
  assert.equal(safeIntervention(replacementAcked), null);
  assert.deepEqual(replacementAcked.coachState.acknowledgedEventIds,
    ['2222222222222222', '1111111111111111', '4444444444444444']);
});

test('questions are transient, bounded by Cairo day and grounded in prescription', () => {
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'word-order-sub', drillId: 'satzbau-schmiede', blocks: 1,
    repetitions: 6, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240, successGate: 'Zweimal korrekt.', assignedAt: 1, nextEligibleAt: null };
  const now = Date.parse('2026-07-14T08:00:00Z');
  state = consumeQuestion(state, 1, now); assert.equal(state.coachState.questionUsage.day, cairoDay(now));
  assert.throws(() => consumeQuestion(state, 1, now), /question_limit_reached/u);
  const reply = answerSalmaQuestion('Warum soll ich das machen?', { screen: 'home' }, state);
  assert.match(reply.answer, /Satzstellung/u); assert.equal(Object.hasOwn(state, 'question'), false);
});

test('between-attempt cue is emitted only for a real failed drill outcome', () => {
  assert.equal(coachCueForDrill({ drill: 'shadowing', correct: true, eventId: '0123456789abcdef' }), null);
  assert.equal(coachCueForDrill({ drill: 'shadowing', eventId: '0123456789abcdef' }), null);
  const cue = coachCueForDrill({ drill: 'shadowing', correct: false, eventId: '0123456789abcdef' });
  assert.equal(cue.kind, 'between_attempts'); assert.equal(cue.maxAutomaticSpeech, 2);
  assert.equal(coachCueForDrill({ drill: 'unknown', correct: false, eventId: '0123456789abcdef' }), null);
});

test('a drill nomination closes only through a newer skill-matched live retest', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: 1_800_000_000_000, bossId: 'yasmin', grammarMeasured: true,
    grammarRules: [{ ruleId: 'word-order-sub', count: 4 }] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'word-order-sub', drillId: 'satzbau-schmiede',
    blocks: 1, repetitions: 6, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240,
    successGate: 'Zweimal korrekt.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'word-order-sub') };
  const drill = state.activePrescription.drillId;
  state = recordDrillOutcome(state, { drill, correct: false }, 1_800_000_000_100);
  for (let i = 0; i < state.activePrescription.repetitions + 2; i += 1) {
    state = recordDrillOutcome(state, { drill, correct: true }, 1_800_000_000_200 + i);
  }
  assert.equal(state.coachState.completedBlocks[state.activePrescription.id], 1);
  assert.equal(state.coachState.lastRetestSessionId, null);
  p.sessions.push(reliableSession({ sessionId: 'session-verified', date: 1_800_100_000_000, bossId: 'yasmin', grammarMeasured: true,
    grammarRules: [{ ruleId: 'word-order-sub', count: 1 }] }));
  p.sessions.push(reliableSession({ sessionId: 'unrelated-later', date: 1_800_100_000_050, bossId: 'yasmin', grammarMeasured: true,
    scenarioId: 'customer-general-b', grammarRules: [{ ruleId: 'word-order-sub', count: 0 }] }));
  const wrongSkill = recordMeaningfulRetest(state, p, { sessionId: 'wrong-skill', skillId: 'deescalate', phase: 'matched', now: 1_800_100_000_100 });
  assert.equal(wrongSkill.coachState.lastRetestSessionId, null);
  state = recordMeaningfulRetest(state, p, { sessionId: 'session-verified', skillId: 'word-order-sub', phase: 'matched', now: 1_800_100_000_100 });
  assert.equal(state.coachState.lastRetestSessionId, 'session-verified');
  assert.deepEqual(state.coachState.improvementHistory.map((proof) => [proof.before, proof.after, proof.status]), [[4, 1, 'improved']]);
  assert.notEqual(state.coachState.improvementHistory[0].measurementEvidenceId,
    measurementForSkill(p, 'word-order-sub', { sessionId: 'unrelated-later' }).evidenceId,
    'the requested retest cannot borrow a newer unrelated session');
  const duplicate = recordMeaningfulRetest(state, p, { sessionId: 'session-verified', skillId: 'word-order-sub', phase: 'matched', now: 1_800_100_000_200 });
  assert.equal(duplicate.coachState.improvementHistory.length, 1);
});

test('retest targeting requires completed practice and exposes only curated text', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ date: 1_800_000_000_000, bossId: 'yasmin', fluency: 52, grammarRules: [] })];
  const state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 1, repetitions: 3, durationSeconds: 195, timesPerDay: 1, minimumSpacingMinutes: 360,
    successGate: 'Set abschließen.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'fluency-interrupt') };
  assert.equal(salmaRetestTarget(state, p), null);
  const completed = recordDrillOutcome(state, { drill: 'flow-drill', completedSet: true }, 1_800_000_000_200);
  const target = salmaRetestTarget(completed, p, 1_800_100_000_000);
  assert.equal(target.skillId, 'fluency-interrupt');
  assert.match(target.dossier, /Unterbrechung/u);
  assert.equal(JSON.stringify(target).includes('user'), false);
});

test('speaking mastery requires a delayed matched retest and a later novel transfer scenario', () => {
  const start = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: start, bossId: 'yasmin', scenarioId: 'customer-general-a',
    fluency: 50, grammarRules: [] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 1, repetitions: 3, durationSeconds: 195, timesPerDay: 1, minimumSpacingMinutes: 360,
    successGate: 'Set abschließen.', assignedAt: start + 100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'fluency-interrupt') };
  state = recordDrillOutcome(state, { drill: 'flow-drill', completedSet: true }, start + 200);
  assert.equal(salmaRetestTarget(state, p, start + day - 1), null);
  let target = salmaRetestTarget(state, p, start + day + 201);
  assert.equal(target.phase, 'matched');

  p.sessions.push(reliableSession({ sessionId: 'matched-live', date: start + day + 250, bossId: 'yasmin',
    scenarioId: 'customer-general-a', fluency: 60, grammarRules: [] }));
  state = recordMeaningfulRetest(state, p, { sessionId: 'matched-live', skillId: 'fluency-interrupt',
    phase: 'matched', now: start + day + 300 });
  assert.equal(state.coachState.improvementHistory[0].phase, 'matched');
  assert.equal(publicSpeakingRetest(state, start + day + 300).phase, 'transfer');
  assert.equal(salmaRetestTarget(state, p, start + 8 * day), null);

  target = salmaRetestTarget(state, p, start + 8 * day + 301);
  assert.equal(target.phase, 'transfer');
  assert.match(target.dossier, /neuen Kundenszenario/u);
  p.sessions.push(reliableSession({ sessionId: 'same-scenario-transfer', date: start + 8 * day + 350, bossId: 'tarek',
    scenarioId: 'customer-general-a', fluency: 58, grammarRules: [] }));
  const repeated = recordMeaningfulRetest(state, p, { sessionId: 'same-scenario-transfer', skillId: 'fluency-interrupt',
    phase: 'transfer', now: start + 8 * day + 375 });
  assert.equal(repeated.coachState.improvementHistory.length, 1,
    'a different fight and interviewer with the same roleplay problem is not transfer');
  p.sessions.push(reliableSession({ sessionId: 'transfer-live', date: start + 8 * day + 390, bossId: 'yasmin',
    scenarioId: 'customer-general-b', fluency: 58, grammarRules: [] }));
  state = recordMeaningfulRetest(state, p, { sessionId: 'transfer-live', skillId: 'fluency-interrupt',
    phase: 'transfer', now: start + 8 * day + 400 });
  assert.deepEqual(state.coachState.improvementHistory.map((proof) => [proof.phase, proof.status]),
    [['matched', 'improved'], ['transfer', 'improved']]);
  assert.equal(publicSpeakingRetest(state, start + 8 * day + 400).phase, 'complete');
  p.salmaCoach = state;
  const view = publicSalmaCoach(p, account('basic'), { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false });
  assert.equal(view.progress.masteryConfirmed, true);
  assert.equal(view.progress.verifiedRetest.phase, 'transfer');
});

test('public coach returns a bounded visible before/after proof without internal evidence ids', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: 1_800_000_000_000, bossId: 'yasmin', grammarMeasured: true,
    grammarRules: [{ ruleId: 'word-order-sub', count: 3 }] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: ['fedcba987654'], skillId: 'word-order-sub', drillId: 'satzbau-schmiede',
    blocks: 1, repetitions: 6, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240,
    successGate: 'Zweimal korrekt.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'word-order-sub') };
  for (let i = 0; i < 6; i += 1) state = recordDrillOutcome(state, { drill: 'satzbau-schmiede', correct: true }, 1_800_000_000_200 + i);
  p.sessions.push(reliableSession({ sessionId: 'live-2', date: 1_800_100_000_000, bossId: 'yasmin', grammarMeasured: true,
    grammarRules: [{ ruleId: 'word-order-sub', count: 1 }] }));
  p.salmaCoach = recordMeaningfulRetest(state, p, { sessionId: 'live-2', skillId: 'word-order-sub', phase: 'matched', now: 1_800_100_000_100 });
  const view = publicSalmaCoach(p, account('basic'), { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false });
  assert.equal(['observed_risk', 'no_single_risk_observed'].includes(view.interviewRisk.state), true);
  assert.equal(view.progress.verifiedRetest.status, 'improved');
  assert.deepEqual([view.progress.verifiedRetest.before, view.progress.verifiedRetest.after], [3, 1]);
  assert.equal(JSON.stringify(view).includes('live-2'), false);
  assert.equal(JSON.stringify(view.activePrescription).includes('fedcba987654'), false);
});

test('verified retests report held and regressed honestly instead of manufacturing improvement', () => {
  const build = (after) => {
    const p = defaultProfile('acct-1');
    p.sessions = [reliableSession({ sessionId: 'baseline-live', date: 1_800_000_000_000, bossId: 'yasmin',
      fluency: 50, grammarRules: [] })];
    let state = normalizeSalmaCoachState(null);
    state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
      blocks: 1, repetitions: 3, durationSeconds: 195, timesPerDay: 1, minimumSpacingMinutes: 360,
      successGate: 'Set abschließen.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
      baseline: measurementForSkill(p, 'fluency-interrupt') };
    state = recordDrillOutcome(state, { drill: 'flow-drill', completedSet: true }, 1_800_000_000_200);
    p.sessions.push(reliableSession({ sessionId: `live-${after}`, date: 1_800_100_000_000, bossId: 'yasmin',
      fluency: after, grammarRules: [] }));
    return recordMeaningfulRetest(state, p, { sessionId: `live-${after}`, skillId: 'fluency-interrupt', phase: 'matched', now: 1_800_100_000_100 })
      .coachState.improvementHistory[0].status;
  };
  assert.equal(build(53), 'held');
  assert.equal(build(42), 'regressed');
  assert.equal(build(58), 'improved');
});

test('an unavailable grammar checker can never manufacture a zero-error improvement', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: 1_800_000_000_000, bossId: 'yasmin', grammarMeasured: true,
    grammarRules: [{ ruleId: 'word-order-sub', count: 4 }] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'word-order-sub', drillId: 'satzbau-schmiede',
    blocks: 1, repetitions: 6, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240,
    successGate: 'Zweimal korrekt.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'word-order-sub') };
  for (let i = 0; i < 6; i += 1) state = recordDrillOutcome(state, { drill: 'satzbau-schmiede', correct: true }, 1_800_000_000_200 + i);
  p.sessions.push({ sessionId: 'unmeasured', date: 1_800_100_000_000, bossId: 'yasmin', targetRoleType: 'customer_service',
    scenarioId: 'customer-general-a', grammarMeasured: false, grammarRules: [] });
  const result = recordMeaningfulRetest(state, p, { sessionId: 'unmeasured', skillId: 'word-order-sub', phase: 'matched', now: 1_800_100_000_100 });
  assert.equal(result.coachState.improvementHistory.length, 0);
  assert.equal(result.coachState.lastRetestSessionId, null);
  assert.equal(measurementForSkill(p, 'constructor'), null);
});

test('listening measurement requires five unique server-issued attempts', () => {
  const p = defaultProfile('acct-1');
  const attempt = (index, correct = true) => ({
    attemptId: (index + 1).toString(16).padStart(24, '0'), skillId: 'listen-clear', kind: 'verstehen', type: null,
    itemHash: (index + 1).toString(16).padStart(64, '0'),
    correct, plays: 1, playbackRate: 1, responseLatencyMs: 1200,
    issuedAt: 1_800_000_000_000 + index * 10_000, gradedAt: 1_800_000_005_000 + index * 10_000,
  });
  p.listeningAttempts = [attempt(0), attempt(1), attempt(2), attempt(3)];
  assert.equal(measurementForSkill(p, 'listen-clear'), null);
  p.listeningAttempts.push(attempt(4, false));
  const measured = measurementForSkill(p, 'listen-clear');
  assert.equal(measured.metricKey, 'listening_accuracy');
  assert.equal(measured.value, 80);
  assert.match(measured.evidenceId, /^[a-f0-9]{12}$/u);
  const retest = publicListeningRetest(p, 'listen-clear');
  assert.equal(retest.phase, 'matched');
  assert.equal(JSON.stringify(retest).includes('evidenceId'), false);
});

test('preference booleans reject ambiguous values', () => {
  assert.throws(() => updatePreferences(null, { autoSpeak: 'true' }), /invalid_auto_speak/u);
  assert.throws(() => updatePreferences(null, { muted: 1 }), /invalid_muted/u);
});
