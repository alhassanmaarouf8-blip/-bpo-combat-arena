import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { defaultProfile } from './store.js';
import { BEHAVIORAL_QUESTIONS, BPO_SCREENING_QUESTIONS, CS_SCENARIOS,
  INTERVIEW_PROMPT_CONTRACT_VERSION, interviewPromptId } from './scenarios.js';
import { serviceRecoveryEvidence } from './scoring/serviceRecoveryEvidence.js';
import { validatedTransferProofs } from './scoring/transferProofs.js';
import { listeningDifficultyContract } from './listeningEvidence.js';
import { analyzeVacancyDeterministically, buildVacancyDraft, emptyVacancyState,
  preparePastedVacancy } from './vacancyTargetCore.js';
import { acknowledgeEvent, answerSalmaQuestion, coachCueForDrill,
  canonicalCoachDirective, deriveSalmaPrescription, measurementForSkill, normalizeSalmaCoachState, publicSalmaCoach, recordDrillOutcome,
  prescriptionDoseProgress, publicListeningRetest, publicSpeakingRetest, recordMeaningfulRetest, salmaCoachCapabilities, salmaCoachFlags,
  salmaCoachBrainGate, salmaRetestTarget, safeIntervention, syncSalmaCoach, updatePreferences } from './salmaCoachCore.js';

function account(plan = 'free') {
  return { id: 'acct-1', emailVerifiedAt: 1, roles: [], subscription: { plan } };
}
const digest = (value, length = 64) => createHash('sha256').update(String(value)).digest('hex').slice(0, length);
function listeningV2Attempt(profile, index, correct = true, start = 1_800_000_000_000) {
  const challenge = listeningDifficultyContract('listen-clear', 'B1', 1);
  return {
    attemptId: (index + 1).toString(16).padStart(24, '0'), skillId: 'listen-clear', kind: 'verstehen', type: null,
    itemHash: (index + 1).toString(16).padStart(64, '0'), correct, plays: 1, playbackRate: 1, baseRate: 1,
    responseLatencyMs: 1200, issuedAt: start + index * 10_000, gradedAt: start + index * 10_000 + 5_000,
    evidenceVersion: 2, accountBinding: digest(`listening-account-v2:${profile.userId}`),
    prescriptionId: null, packetId: 'a'.repeat(16), packetIndex: index, phase: 'baseline_candidate',
    challengeKey: challenge.challengeKey, levelKey: 'B1', eligibleAt: start,
  };
}
function speakingTaskContract(value = {}) {
  const levelId = value.level || 'a2-b1';
  return {
    version: 1,
    promptContractVersion: INTERVIEW_PROMPT_CONTRACT_VERSION,
    assessmentMode: 'diagnostic',
    levelId,
    bossId: value.bossId || 'yasmin',
    roleType: value.targetRoleType || 'customer_service',
    scenarioId: value.scenarioId || CS_SCENARIOS[0].id,
    behavioralPromptId: value.behavioralPromptId
      || interviewPromptId('behavioral', BEHAVIORAL_QUESTIONS[0], levelId),
    screeningPromptId: value.screeningPromptId
      || interviewPromptId('screening', BPO_SCREENING_QUESTIONS[0], levelId),
    industryKey: value.targetIndustry || null,
    targetId: value.vacancyTargetId || null,
    contentSeed: value.contentSeed || 'stable-comparison-seed',
    mood: value.mood || 'neutral',
    replayContext: value.replayContext || { dossier: '', memory: '', focusTitle: '' },
  };
}
function reliableSession(value = {}) {
  const session = { sessionId: value.sessionId || `session-${value.date}`, level: value.level || 'a2-b1',
    bossId: value.bossId || 'yasmin', targetRoleType: value.targetRoleType || 'customer_service',
    scenarioId: value.scenarioId || CS_SCENARIOS[0].id, ...value,
    evidenceQuality: { version: 2, words: 120, eligibleWords: 120, completeTurns: 5, truncatedTurns: 0,
    stageCoverage: 2, prescriptionEligible: true, highConfidence: false } };
  if (value.speakingTaskContract !== null) {
    session.speakingTaskContract = value.speakingTaskContract || speakingTaskContract(session);
  }
  return session;
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
function setPassingRecoveryEvidence(session) {
  const context = { sessionId: session.sessionId, targetId: session.vacancyTargetId ?? null,
    roleType: session.targetRoleType, scenarioId: session.scenarioId, observedAt: session.date };
  const evidence = serviceRecoveryEvidence([
    'Das tut mir wirklich leid, und ich kann Ihren \u00c4rger gut nachvollziehen.',
    'Ich k\u00fcmmere mich pers\u00f6nlich um Ihren Fall und dokumentiere ihn jetzt sorgf\u00e4ltig.',
    'Ich melde mich heute mit einer konkreten L\u00f6sung bei Ihnen.',
  ], context);
  const stored = Object.fromEntries(['version', 'criterionId', 'criterionVersion', 'binding', 'roleType',
    'scenarioId', 'targetId', 'sessionId', 'observedAt', 'contradicted', 'observedSteps', 'totalSteps',
    'turnCount', 'wordCount'].map((key) => [key, evidence[key]]));
  session.deescalation = evidence.score;
  session.deescalationEvidence = stored;
  return session;
}
function setCompleteResponseEvidence(session, giveUpRate) {
  setPassingRecoveryEvidence(session);
  session.wpm = 110;
  session.fluency = 90;
  session.fillers = 1;
  session.grammarMeasured = true;
  session.grammarRules = [];
  session.subClauseRate = 0.3;
  session.vocabDiversity = 0.6;
  session.intelligibility = 0.9;
  session.latencyS = 2;
  session.giveUpRate = giveUpRate;
  return session;
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

function reliableGrammarSession(date, sessionId, grammarRules) {
  const context = { sessionId, targetId: null, roleType: 'customer_service',
    scenarioId: CS_SCENARIOS[0].id, observedAt: date };
  const recovery = serviceRecoveryEvidence([
    'Das tut mir wirklich leid, und ich kann die schwierige Situation sehr gut verstehen.',
    'Ich k\u00fcmmere mich jetzt um Ihren Fall und dokumentiere alle wichtigen Angaben. Ich melde mich morgen bei Ihnen.',
  ], context);
  const storedRecovery = Object.fromEntries(['version', 'criterionId', 'criterionVersion', 'binding',
    'roleType', 'scenarioId', 'targetId', 'sessionId', 'observedAt', 'contradicted', 'observedSteps',
    'totalSteps', 'turnCount', 'wordCount'].map((key) => [key, recovery[key]]));
  return reliableSession({ date, sessionId, targetRoleType: 'customer_service', targetIndustry: 'telecom',
    scenarioId: CS_SCENARIOS[0].id, bossId: 'yasmin', verdict: 'review', wpm: 120, fluency: 75,
    fillers: 2, grammarMeasured: true, grammarRules, subClauseRate: 0.3, vocabDiversity: 0.6,
    giveUpRate: 0.1, intelligibility: 0.9, latencyS: 3, deescalation: recovery.score,
    deescalationEvidence: storedRecovery });
}

test('feature flags fail closed and beta is account allowlisted', () => {
  assert.equal(salmaCoachFlags({}, account()).enabled, false);
  assert.equal(salmaCoachFlags({ SALMA_COACH_MODE: 'garbage' }, account()).mode, 'off');
  assert.equal(salmaCoachFlags({ SALMA_COACH_MODE: 'beta', SALMA_COACH_BETA_ACCOUNT_IDS: 'other' }, account()).enabled, false);
  assert.equal(salmaCoachFlags({ SALMA_COACH_MODE: 'beta', SALMA_COACH_BETA_ACCOUNT_IDS: 'acct-1' }, account()).enabled, true);
  const flags = salmaCoachFlags({ SALMA_COACH_MODE: 'on', SALMA_COACH_AI_ENABLED: 'true', SALMA_COACH_VOICE_ENABLED: 'true' }, account());
  assert.equal(flags.aiEnabled, true); assert.equal(flags.voiceEnabled, true);
});

test('every plan can ask the personal tutor without an artificial daily quota', () => {
  for (const plan of ['free', 'basic', 'elite']) {
    const capabilities = salmaCoachCapabilities(account(plan));
    assert.equal(capabilities.questionsUnlimited, true);
    assert.equal(Object.hasOwn(capabilities, 'dailyQuestions'), false);
  }
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
  const enabled = publicSalmaCoach(p, account('basic'), { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false });
  assert.equal(enabled.interviewRisk.state, 'measure_first');
  assert.equal(enabled.diagnosticTruth.state, 'measure_first');
  assert.equal(enabled.diagnosticTruth.causeStatus, 'not_established');
  const disabled = publicSalmaCoach(p, account('basic'), { mode: 'off', enabled: false, aiEnabled: false, voiceEnabled: false });
  assert.equal(disabled.diagnosticTruth, null, 'feature-off accounts must not receive a new public contract');
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
  assert.ok(prescription || directive.prescription?.action === 'measure',
    'the first reliable interview must produce a trackable contract, never a dead-end drill');
  assert.equal(prescription.evidenceConfidence, 'low');
  const state = normalizeSalmaCoachState({ activePrescription: prescription });
  const intervention = safeIntervention(state);
  assert.match(intervention.text, /ersten zuverlässigen Hinweis/u);
  assert.doesNotMatch(intervention.text, /Dein Engpass ist/u);
});

test('the same reliable risk across two sessions earns a spaced second block and high-evidence wording', () => {
  const p = measuredProfile(2);
  for (const session of p.sessions) setCompleteResponseEvidence(session, 0.5);
  const now = 1_700_000_010_000;
  const { directive, prescription } = deriveSalmaPrescription(p, { now, dailyMinutes: 20 });
  assert.equal(directive.confidence, 'high', JSON.stringify(directive));
  assert.equal(directive.target?.criterionId, 'complete_response');
  assert.equal(prescription.skillId, 'no-freeze-expected');
  assert.equal(prescription.evidenceConfidence, 'high');
  assert.equal(prescription.blocks, 2);
  assert.equal(prescription.timesPerDay, 2);
  assert.equal(prescription.nextEligibleAt, now + prescription.minimumSpacingMinutes * 60_000);
  assert.match(safeIntervention(normalizeSalmaCoachState({ activePrescription: prescription })).text,
    /wiederholter zuverlässiger Evidenz/u);
});

test('a deficit from another interview archetype cannot increase the current personalized dose', () => {
  const p = measuredProfile(2);
  for (const session of p.sessions) setCompleteResponseEvidence(session, 0.5);
  p.sessions[0].scenarioId = 'foreign-archetype';
  const result = deriveSalmaPrescription(p, { now: 1_700_000_010_000, dailyMinutes: 20 });
  assert.equal(result.directive.target?.criterionId, 'complete_response');
  assert.equal(result.directive.confidence, 'low');
  assert.equal(result.prescription?.blocks, 1);
  assert.deepEqual(result.prescription?.evidenceIds,
    [measurementForSkill(p, 'no-freeze-expected', { sessionId: p.sessions[1].sessionId }).evidenceId]);
});

test('a support packet without an immutable session id cannot increase confidence or dose', () => {
  const p = measuredProfile(2);
  for (const session of p.sessions) setCompleteResponseEvidence(session, 0.5);
  delete p.sessions[0].sessionId;
  const result = deriveSalmaPrescription(p, { now: 1_700_000_010_000, dailyMinutes: 20 });
  const expected = measurementForSkill(p, 'no-freeze-expected', { sessionId: p.sessions[1].sessionId });
  assert.equal(result.directive.confidence, 'low');
  assert.equal(result.prescription?.evidenceConfidence, 'low');
  assert.equal(result.prescription?.blocks, 1);
  assert.deepEqual(result.prescription?.evidenceIds, [expected.evidenceId]);
});

test('two support ids that resolve to one evidence packet fail closed instead of doubling the dose', () => {
  const p = measuredProfile(2);
  for (const session of p.sessions) setCompleteResponseEvidence(session, 0.5);
  p.sessions[1].date = p.sessions[0].date;
  const first = measurementForSkill(p, 'no-freeze-expected', { sessionId: p.sessions[0].sessionId });
  const second = measurementForSkill(p, 'no-freeze-expected', { sessionId: p.sessions[1].sessionId });
  assert.equal(first.evidenceId, second.evidenceId, 'fixture must represent one non-independent evidence packet');
  const result = deriveSalmaPrescription(p, { now: 1_700_000_010_000, dailyMinutes: 20 });
  assert.equal(result.directive.confidence, 'high');
  assert.equal(result.prescription, null);
});

test('a same-archetype passing observation vetoes the second daily dose and is excluded from evidence', () => {
  const p = measuredProfile(3);
  setCompleteResponseEvidence(p.sessions[0], 0.5);
  setCompleteResponseEvidence(p.sessions[1], 0);
  setCompleteResponseEvidence(p.sessions[2], 0.5);
  const result = deriveSalmaPrescription(p, { now: 1_700_000_010_000, dailyMinutes: 20 });
  const supportIds = [p.sessions[0], p.sessions[2]]
    .map((session) => measurementForSkill(p, 'no-freeze-expected', { sessionId: session.sessionId }).evidenceId);
  const passingId = measurementForSkill(p, 'no-freeze-expected', { sessionId: p.sessions[1].sessionId }).evidenceId;
  assert.equal(result.directive.confidence, 'low');
  assert.equal(result.prescription?.blocks, 1);
  assert.deepEqual(result.prescription?.evidenceIds, supportIds);
  assert.equal(result.prescription?.evidenceIds.includes(passingId), false);
});

test('a speaking-intelligibility signal cannot be prescribed as a listening improvement', () => {
  const p = measuredProfile(2);
  for (const session of p.sessions) {
    setPassingRecoveryEvidence(session);
    session.wpm = 100;
    session.intelligibility = 0.7;
  }
  const result = deriveSalmaPrescription(p, { now: 1_700_000_010_000, dailyMinutes: 20 });
  assert.equal(result.directive.target?.criterionId, 'speech_recognition_proxy');
  assert.deepEqual(result.directive.prescription, {
    action: 'measure', signal: 'intelligibility', criterionId: 'speech_recognition_proxy',
  });
  assert.equal(result.prescription, null, 'speaking intelligibility cannot borrow a listening baseline');
});

test('uncalibrated criteria cannot claim improvement through a different skill proxy or trap the learner in MEASURE', () => {
  const p = measuredProfile(2);
  for (const session of p.sessions) {
    session.wpm = 100;
    session.intelligibility = 0.9;
    session.latencyS = 7;
    session.giveUpRate = 0;
  }
  const latency = deriveSalmaPrescription(p, { now: 1_700_000_010_000, dailyMinutes: 20 });
  assert.equal(latency.directive.target?.criterionId, undefined);
  assert.notEqual(latency.directive.state, 'MEASURE');
  assert.equal(latency.prescription?.criterionId ?? null, null,
    'latency must not be relabeled as answer-continuity improvement');

  for (const session of p.sessions) {
    session.latencyS = 2;
    session.fillers = 20;
    session.fluency = 95;
  }
  const fillers = deriveSalmaPrescription(p, { now: 1_700_000_010_000, dailyMinutes: 20 });
  assert.equal(fillers.directive.target?.criterionId, undefined);
  assert.notEqual(fillers.directive.state, 'MEASURE');
  assert.equal(fillers.prescription?.criterionId ?? null, null,
    'filler dependence must not be relabeled as generic fluency improvement');
});

test('every actionable forecast yields an exact prescription and uncalibrated criteria stay non-actionable', () => {
  const supported = deriveSalmaPrescription(measuredProfile(2), { now: 1_700_000_010_000, dailyMinutes: 10 });
  assert.ok(supported.prescription);
  assert.equal(supported.directive.prescription.action, 'drill');
  assert.equal(supported.prescription.baseline.metricKey, 'wpm');

  const unsupportedProfile = measuredProfile(1);
  unsupportedProfile.sessions[0].wpm = 100;
  unsupportedProfile.sessions[0].intelligibility = 0.9;
  unsupportedProfile.sessions[0].latencyS = 7;
  unsupportedProfile.sessions[0].giveUpRate = 0;
  const unsupported = deriveSalmaPrescription(unsupportedProfile,
    { now: 1_700_000_010_000, dailyMinutes: 10 });
  assert.notEqual(unsupported.directive.state, 'MEASURE');
  assert.equal(unsupported.directive.target?.criterionId, undefined);
  assert.equal(unsupported.prescription?.criterionId ?? null, null);
});

test('uncalibrated-criterion suppression is Salma-gated and preserves legacy flag-off identity', () => {
  const p = measuredProfile(1);
  p.sessions[0].wpm = 100;
  p.sessions[0].intelligibility = 0.9;
  p.sessions[0].latencyS = 7;
  p.sessions[0].giveUpRate = 0;
  const now = 1_700_000_010_000;
  const off = canonicalCoachDirective(p, account('basic'), {
    now, coachFlags: { mode: 'off', enabled: false, aiEnabled: false, voiceEnabled: false },
  });
  assert.equal(off.prescription.action, 'drill');
  assert.equal(off.prescription.criterionId, 'response_latency');

  const on = canonicalCoachDirective(p, account('basic'), {
    now, coachFlags: { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false },
  });
  assert.notEqual(on.state, 'MEASURE');
  assert.equal(on.prescription.criterionId, undefined);
});

test('a broad grammar forecast prescribes only the exact rule supported by the current reliable archetype', () => {
  const p = defaultProfile('acct-1');
  const now = 1_800_000_000_000;
  p.sessions = [
    reliableGrammarSession(now - 1_000, 'grammar-current-1', [{ ruleId: 'dativ-akkusativ', count: 12 }]),
    reliableGrammarSession(now, 'grammar-current-2', [{ ruleId: 'dativ-akkusativ', count: 12 }]),
  ];
  p.weakLog = {
    'word-order-sub': { ruleId: 'word-order-sub', errCounts: [
      { date: now - 100_000, count: 99 }, { date: now - 90_000, count: 98 },
    ], drills: [] },
    'dativ-akkusativ': { ruleId: 'dativ-akkusativ', errCounts: [
      { date: now - 1_000, count: 12 }, { date: now, count: 12 },
    ], drills: [] },
  };

  const result = deriveSalmaPrescription(p, { now: now + 1_000, dailyMinutes: 20 });
  assert.equal(result.directive.target?.criterionId, 'grammar_control');
  assert.equal(result.directive.confidence, 'high');
  assert.equal(result.prescription?.skillId, 'dativ-akkusativ');
  assert.equal(result.prescription?.baseline?.metricKey, 'grammar_errors');
  assert.equal(result.prescription?.baseline?.value, 10);
});

test('a broad grammar deficit with no exact-rule deficit fails closed instead of prescribing a zero-error rule', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [0, 1].map((index) => reliableGrammarSession(
    1_800_000_000_000 + index,
    `split-grammar-${index}`,
    [
      { ruleId: 'word-order-sub', count: 6 },
      { ruleId: 'dativ-akkusativ', count: 6 },
    ],
  ));
  p.weakLog = {
    'konjunktiv-2': { ruleId: 'konjunktiv-2', errCounts: [{ count: 99 }, { count: 98 }], drills: [] },
  };

  const result = deriveSalmaPrescription(p, { now: 1_800_000_001_000, dailyMinutes: 20 });
  assert.equal(result.directive.target, null);
  assert.equal(result.prescription, null);
});

test('unrelated or stale Spoken Review cards cannot complete an exact grammar prescription', () => {
  const assignedAt = 1_800_000_000_000;
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'konjunktiv-2',
    drillId: 'sag-es-richtig', blocks: 1, repetitions: 8, durationSeconds: 600, timesPerDay: 1,
    minimumSpacingMinutes: 240, successGate: 'Zweimal korrekt.', assignedAt, nextEligibleAt: null };
  const event = (skillId, verifiedAt) => ({ drill: 'sag-es-richtig', correct: true, verified: true,
    verifiedAt, prescriptionId: state.activePrescription.id, skillId, phase: 'practice',
    taskHash: 'abcdefabcdefabcd' });

  state = recordDrillOutcome(state, { drill: 'sag-es-richtig', correct: true }, assignedAt + 1);
  state = recordDrillOutcome(state, event('konjunktiv-2', assignedAt - 1), assignedAt + 2);
  for (let index = 0; index < 8; index += 1) {
    state = recordDrillOutcome(state, event('dativ-akkusativ', assignedAt + 10 + index), assignedAt + 10 + index);
  }
  assert.equal(state.coachState.completedBlocks[state.activePrescription.id], undefined);
  for (let index = 0; index < 8; index += 1) {
    state = recordDrillOutcome(state, event('konjunktiv-2', assignedAt + 100 + index), assignedAt + 100 + index);
  }
  assert.equal(state.coachState.completedBlocks[state.activePrescription.id], 1);
});

test('a failed Spoken Review card must itself receive two later correct productions', () => {
  const assignedAt = 1_800_000_000_000;
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'konjunktiv-2',
    drillId: 'sag-es-richtig', blocks: 1, repetitions: 2, durationSeconds: 600, timesPerDay: 1,
    minimumSpacingMinutes: 240, successGate: 'Zweimal korrekt.', assignedAt, nextEligibleAt: null };
  const event = (taskHash, correct, at) => ({ drill: 'sag-es-richtig', correct, verified: true,
    verifiedAt: at, prescriptionId: state.activePrescription.id, skillId: 'konjunktiv-2', phase: 'practice', taskHash });
  state = recordDrillOutcome(state, event('aaaaaaaaaaaaaaaa', false, assignedAt + 1), assignedAt + 1);
  for (let index = 0; index < 4; index += 1) {
    const at = assignedAt + 10 + index;
    state = recordDrillOutcome(state, event('bbbbbbbbbbbbbbbb', true, at), at);
  }
  assert.equal(prescriptionDoseProgress(state).completed, false);
  assert.equal(prescriptionDoseProgress(state).repairsRemaining, 2);
  for (let index = 0; index < 2; index += 1) {
    const at = assignedAt + 100 + index;
    state = recordDrillOutcome(state, event('aaaaaaaaaaaaaaaa', true, at), at);
  }
  assert.equal(prescriptionDoseProgress(state).completed, true);
  assert.equal(prescriptionDoseProgress(state).repairsRemaining, 0);
});

test('two-block dosing models each block separately and consumes duplicate or early events without credit', () => {
  const start = 1_800_000_000_000;
  const spacing = 360 * 60_000;
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: start, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[0].id, wpm: 70, fluency: 50, grammarRules: [] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 2, repetitions: 3, durationSeconds: 195, timesPerDay: 2, minimumSpacingMinutes: 360,
    successGate: 'Set abschließen.', assignedAt: start, nextEligibleAt: start + spacing,
    baseline: measurementForSkill(p, 'fluency-interrupt') };

  const blockOneAt = start + 1_000;
  state = recordDrillOutcome(state, { eventId: '1111111111111111', drill: 'flow-drill', completedSet: true }, blockOneAt);
  assert.equal(state.coachState.completedBlocks[state.activePrescription.id], 1);
  assert.equal(state.coachState.repeatedErrorCounts[state.activePrescription.id].blockProgress[0].correct, 3);
  assert.equal(state.coachState.repeatedErrorCounts[state.activePrescription.id].blockProgress[1].correct, 0);
  assert.equal(state.activePrescription.nextEligibleAt, blockOneAt + spacing,
    'spacing begins when block one actually completes, not when it was assigned');
  assert.deepEqual(salmaCoachBrainGate(state, p, blockOneAt + spacing - 1), {
    skillId: 'fluency-interrupt', drillId: 'flow-drill', status: 'wait', action: 'wait',
    phase: 'dose_spacing', nextEligibleAt: blockOneAt + spacing,
  });

  const duplicate = recordDrillOutcome(state,
    { eventId: '1111111111111111', drill: 'flow-drill', completedSet: true }, blockOneAt + spacing + 1);
  assert.equal(duplicate.coachState.repeatedErrorCounts[state.activePrescription.id].blockProgress[1].attempts, 0,
    'the block-one event cannot be replayed into block two');
  state = recordDrillOutcome(duplicate,
    { eventId: '2222222222222222', drill: 'flow-drill', completedSet: true }, blockOneAt + spacing - 1);
  assert.equal(state.coachState.repeatedErrorCounts[state.activePrescription.id].blockProgress[1].attempts, 0,
    'an early block-two event is consumed without evidence credit');
  state = recordDrillOutcome(state,
    { eventId: '2222222222222222', drill: 'flow-drill', completedSet: true }, blockOneAt + spacing + 1);
  assert.equal(state.coachState.repeatedErrorCounts[state.activePrescription.id].blockProgress[1].attempts, 0,
    'replaying the previously early event after the boundary remains invalid');

  const blockTwoAt = blockOneAt + spacing + 2;
  state = recordDrillOutcome(state,
    { eventId: '3333333333333333', drill: 'flow-drill', completedSet: true }, blockTwoAt);
  assert.equal(state.coachState.completedBlocks[state.activePrescription.id], 2);
  assert.deepEqual(state.coachState.repeatedErrorCounts[state.activePrescription.id].blockProgress.map((block) => block.correct), [3, 3]);
  assert.equal(state.coachState.repeatedErrorCounts[state.activePrescription.id].completedAt, blockTwoAt);
  const wait = salmaCoachBrainGate(state, p, blockTwoAt + 1);
  assert.equal(wait.status, 'wait');
  assert.equal(wait.phase, 'matched');
});

test('inflated legacy counters and a partial two-block dose cannot authorize a retest', () => {
  const start = 1_800_000_000_000;
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: start, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[0].id, wpm: 70, fluency: 50, grammarRules: [] })];
  const raw = { activePrescription: { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 2, repetitions: 3, durationSeconds: 195, timesPerDay: 2, minimumSpacingMinutes: 360,
    successGate: 'Set abschließen.', assignedAt: start, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'fluency-interrupt') }, coachState: {
    completedBlocks: { '0123456789abcdef': 2 },
    repeatedErrorCounts: { '0123456789abcdef': { attempts: 3, correct: 3, failures: 0,
      lastAt: start + 1_000, completedAt: start + 1_000 } },
  } };
  const state = normalizeSalmaCoachState(raw);
  assert.equal(state.coachState.completedBlocks['0123456789abcdef'], 1,
    'a legacy aggregate can prove only the first modeled block');
  assert.equal(publicSpeakingRetest(state, start + 10 * 24 * 60 * 60 * 1000), null);
  const result = recordMeaningfulRetest(state, p, {
    sessionId: 'too-early', skillId: 'fluency-interrupt', phase: 'matched', now: start + 10 * 24 * 60 * 60 * 1000,
  });
  assert.equal(result.coachState.improvementHistory.length, 0);
});

test('public Salma brain action is the canonical coach-gated BrainGuide action', () => {
  const start = 1_800_000_000_000;
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: start, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[0].id, wpm: 70, fluency: 50, grammarRules: [] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 2, repetitions: 3, durationSeconds: 195, timesPerDay: 2, minimumSpacingMinutes: 360,
    successGate: 'Set abschließen.', assignedAt: start, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'fluency-interrupt') };
  state = recordDrillOutcome(state, { eventId: '1111111111111111', drill: 'flow-drill', completedSet: true }, start + 1_000);
  p.salmaCoach = state;
  const now = start + 2_000;
  const flags = { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false };
  const canonical = canonicalCoachDirective(p, account('basic'), { now, coachFlags: flags });
  const view = publicSalmaCoach(p, account('basic'),
    flags, { now });
  assert.deepEqual(view.brain, { state: canonical.state, action: canonical.prescription.action });
});

test('a due vacancy action hides an unfinished Salma drill and dose-spacing intervention from the public coach', () => {
  const start = 1_800_000_000_000;
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'vacancy-priority-baseline', date: start, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[0].id, wpm: 70, fluency: 50, grammarRules: [] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 2, repetitions: 3, durationSeconds: 195, timesPerDay: 2, minimumSpacingMinutes: 360,
    successGate: 'Set abschlie\u00dfen.', assignedAt: start, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'fluency-interrupt') };
  state = recordDrillOutcome(state,
    { eventId: 'vacancy-priority-block-one', drill: 'flow-drill', completedSet: true }, start + 1_000);
  p.salmaCoach = state;

  const source = preparePastedVacancy(`German Customer Service Agent vacancy. Full-time customer support
    for an e-commerce account. Requirements include German B1, complaint handling, documentation,
    flexible shift availability, and customer-service experience.`);
  const draft = buildVacancyDraft({ source, analysis: analyzeVacancyDeterministically(source), now: start });
  p.vacancyTarget = { ...emptyVacancyState(), active: { ...draft, status: 'active' } };

  const previousMode = process.env.VACANCY_MODE;
  process.env.VACANCY_MODE = 'on';
  try {
    const flags = { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false };
    const view = publicSalmaCoach(p, account('basic'), flags, { now: start + 2_000 });
    assert.deepEqual(view.brain, { state: 'VACANCY_PREP', action: 'vacancy' });
    assert.equal(view.activePrescription, null);
    assert.equal(view.intervention, null);
    assert.equal(view.progress, null);
    assert.equal(view.speakingRetest, null);
    assert.equal(p.salmaCoach.activePrescription.id, '0123456789abcdef',
      'canonical priority hides but does not destroy the durable tutor cycle');
  } finally {
    if (previousMode === undefined) delete process.env.VACANCY_MODE;
    else process.env.VACANCY_MODE = previousMode;
  }
});

test('BrainGuide gate requires the whole dose, then the delayed live-retest window', () => {
  const start = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: start, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[0].id, wpm: 70, fluency: 50, grammarRules: [] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 1, repetitions: 3, durationSeconds: 195, timesPerDay: 1, minimumSpacingMinutes: 360,
    successGate: 'Set abschließen.', assignedAt: start + 100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'fluency-interrupt') };

  assert.deepEqual(salmaCoachBrainGate(state, p, start + 200), {
    skillId: 'fluency-interrupt', drillId: 'flow-drill', status: 'practice', action: 'drill',
    phase: 'practice_block_1', nextEligibleAt: null,
  });
  state = recordDrillOutcome(state, { drill: 'flow-drill', correct: true }, start + 250);
  assert.equal(salmaCoachBrainGate(state, p, start + 300).status, 'practice',
    'one good attempt cannot unlock the proof interview');
  state = recordDrillOutcome(state, { drill: 'flow-drill', completedSet: true }, start + 400);
  const waiting = salmaCoachBrainGate(state, p, start + 500);
  assert.equal(waiting.status, 'wait');
  assert.equal(waiting.action, 'wait');
  assert.equal(waiting.nextEligibleAt, start + 400 + day);
  assert.match(safeIntervention(state, start + 500).nextAction, /Kairo/u);
  const ready = salmaCoachBrainGate(state, p, start + 400 + day);
  assert.equal(ready.status, 'retest');
  assert.equal(ready.action, 'interview');
  assert.match(safeIntervention(state, start + 400 + day).nextAction, /Live-Interview/u);
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

test('questions are transient and grounded in the active prescription', () => {
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'word-order-sub', drillId: 'satzbau-schmiede', blocks: 1,
    repetitions: 6, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240, successGate: 'Zweimal korrekt.', assignedAt: 1, nextEligibleAt: null };
  const reply = answerSalmaQuestion('Warum soll ich das machen?', { screen: 'home' }, state);
  assert.match(reply.answer, /Satzstellung/u); assert.equal(Object.hasOwn(state, 'question'), false);
  assert.equal(Object.hasOwn(state.coachState, 'questionUsage'), false);
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
    scenarioId: CS_SCENARIOS[1].id, grammarRules: [{ ruleId: 'word-order-sub', count: 0 }] }));
  const wrongSkill = recordMeaningfulRetest(state, p, { sessionId: 'wrong-skill', skillId: 'deescalate', phase: 'matched', now: 1_800_100_000_100 });
  assert.equal(wrongSkill.coachState.lastRetestSessionId, null);
  state = recordMeaningfulRetest(state, p, { sessionId: 'session-verified', skillId: 'word-order-sub', phase: 'matched', now: 1_800_100_000_100 });
  assert.equal(state.coachState.lastRetestSessionId, 'session-verified');
  assert.deepEqual(state.coachState.improvementHistory.map((proof) => [proof.before, proof.after, proof.status]), [[3.3, 0.8, 'improved']]);
  assert.notEqual(state.coachState.improvementHistory[0].measurementEvidenceId,
    measurementForSkill(p, 'word-order-sub', { sessionId: 'unrelated-later' }).evidenceId,
    'the requested retest cannot borrow a newer unrelated session');
  const duplicate = recordMeaningfulRetest(state, p, { sessionId: 'session-verified', skillId: 'word-order-sub', phase: 'matched', now: 1_800_100_000_200 });
  assert.equal(duplicate.coachState.improvementHistory.length, 1);
});

test('retest targeting requires completed practice and exposes only curated text', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ date: 1_800_000_000_000, bossId: 'yasmin', wpm: 72, fluency: 52, grammarRules: [] })];
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
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: start, bossId: 'yasmin', scenarioId: CS_SCENARIOS[0].id,
    wpm: 70, fluency: 50, grammarRules: [] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 1, repetitions: 3, durationSeconds: 195, timesPerDay: 1, minimumSpacingMinutes: 360,
    successGate: 'Set abschließen.', assignedAt: start + 100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'fluency-interrupt') };
  state = recordDrillOutcome(state, { drill: 'flow-drill', completedSet: true }, start + 200);
  assert.equal(salmaRetestTarget(state, p, start + day - 1), null);
  let target = salmaRetestTarget(state, p, start + day + 201);
  assert.equal(target.phase, 'matched');
  assert.equal(target.context.forcedScenarioId, CS_SCENARIOS[0].id);
  assert.equal(target.context.bossId, 'yasmin');
  assert.equal(target.context.forcedBehavioralPromptId,
    interviewPromptId('behavioral', BEHAVIORAL_QUESTIONS[0], 'a2-b1'));
  assert.equal(target.context.forcedScreeningPromptId,
    interviewPromptId('screening', BPO_SCREENING_QUESTIONS[0], 'a2-b1'));
  assert.equal(target.context.contentSeed, 'stable-comparison-seed');
  assert.equal(target.context.forcedMood, 'neutral');

  p.sessions.push(reliableSession({ sessionId: 'wrong-matched-context', date: start + day + 225, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[1].id, wpm: 80, fluency: 61, grammarRules: [] }));
  const wrongMatched = recordMeaningfulRetest(state, p, { sessionId: 'wrong-matched-context',
    skillId: 'fluency-interrupt', phase: 'matched', now: start + day + 240 });
  assert.equal(wrongMatched.coachState.improvementHistory.length, 0,
    'a rotated scenario cannot masquerade as the matched comparison');

  p.sessions.push(reliableSession({ sessionId: 'matched-live', date: start + day + 250, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[0].id, wpm: 80, fluency: 60, grammarRules: [] }));
  state = recordMeaningfulRetest(state, p, { sessionId: 'matched-live', skillId: 'fluency-interrupt',
    phase: 'matched', now: start + day + 300 });
  assert.equal(state.coachState.improvementHistory[0].phase, 'matched');
  assert.equal(publicSpeakingRetest(state, start + day + 300).phase, 'transfer');
  assert.equal(salmaRetestTarget(state, p, start + 8 * day), null);

  target = salmaRetestTarget(state, p, start + 8 * day + 301);
  assert.equal(target.phase, 'transfer');
  assert.match(target.dossier, /neuen Kundenszenario/u);
  assert.deepEqual(target.context.excludedScenarioIds, [CS_SCENARIOS[0].id]);
  assert.deepEqual(target.context.excludedBehavioralPromptIds,
    [interviewPromptId('behavioral', BEHAVIORAL_QUESTIONS[0], 'a2-b1')]);
  assert.deepEqual(target.context.excludedScreeningPromptIds,
    [interviewPromptId('screening', BPO_SCREENING_QUESTIONS[0], 'a2-b1')]);
  p.sessions.push(reliableSession({ sessionId: 'same-scenario-transfer', date: start + 8 * day + 350, bossId: 'tarek',
    scenarioId: CS_SCENARIOS[0].id, wpm: 82, fluency: 58, grammarRules: [] }));
  const repeated = recordMeaningfulRetest(state, p, { sessionId: 'same-scenario-transfer', skillId: 'fluency-interrupt',
    phase: 'transfer', now: start + 8 * day + 375 });
  assert.equal(repeated.coachState.improvementHistory.length, 1,
    'a different fight and interviewer with the same roleplay problem is not transfer');
  p.sessions.push(reliableSession({ sessionId: 'transfer-live', date: start + 8 * day + 390, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[1].id, wpm: 85, fluency: 58, grammarRules: [] }));
  state = recordMeaningfulRetest(state, p, { sessionId: 'transfer-live', skillId: 'fluency-interrupt',
    phase: 'transfer', now: start + 8 * day + 400 });
  assert.deepEqual(state.coachState.improvementHistory.map((proof) => [proof.phase, proof.status]),
    [['matched', 'improved'], ['transfer', 'improved']]);
  assert.equal(publicSpeakingRetest(state, start + 8 * day + 400).phase, 'complete');
  p.salmaCoach = state;
  assert.equal(validatedTransferProofs(p, start + 8 * day + 400).length, 1,
    'the delayed transfer is reconciled to its exact baseline, matched and transfer sessions');
  assert.equal(validatedTransferProofs({ ...p, sessions: [] }, start + 8 * day + 400).length, 0,
    'a copied proof without its server-recorded session chain is not mastery evidence');
  const copied = structuredClone(p); copied.sessions = [];
  const copiedView = publicSalmaCoach(copied, account('basic'),
    { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false }, { now: start + 8 * day + 400 });
  assert.equal(copiedView.progress.masteryConfirmed, false,
    'the learner UI cannot celebrate a copied proof that readiness rejects');
  const view = publicSalmaCoach(p, account('basic'), { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false },
    { now: start + 8 * day + 400 });
  assert.equal(view.progress.masteryConfirmed, true);
  assert.equal(view.progress.verifiedRetest.phase, 'transfer');
});

test('a novel transfer that collapses from the matched result cannot become mastery', () => {
  const start = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const p = defaultProfile('acct-1');
  p.sessions = [reliableSession({ sessionId: 'baseline-live', date: start, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[0].id, wpm: 70, fluency: 50, grammarRules: [] })];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 1, repetitions: 3, durationSeconds: 195, timesPerDay: 1, minimumSpacingMinutes: 360,
    successGate: 'Set abschließen.', assignedAt: start + 100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'fluency-interrupt') };
  state = recordDrillOutcome(state, { drill: 'flow-drill', completedSet: true }, start + 200);
  p.sessions.push(reliableSession({ sessionId: 'matched-live', date: start + day + 250, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[0].id, wpm: 100, fluency: 90, grammarRules: [] }));
  state = recordMeaningfulRetest(state, p, { sessionId: 'matched-live', skillId: 'fluency-interrupt',
    phase: 'matched', now: start + day + 300 });
  p.sessions.push(reliableSession({ sessionId: 'transfer-live', date: start + 8 * day + 390, bossId: 'yasmin',
    scenarioId: CS_SCENARIOS[1].id, wpm: 75, fluency: 55, grammarRules: [] }));
  state = recordMeaningfulRetest(state, p, { sessionId: 'transfer-live', skillId: 'fluency-interrupt',
    phase: 'transfer', now: start + 8 * day + 400 });
  assert.deepEqual(state.coachState.improvementHistory.map((proof) => [proof.phase, proof.status]),
    [['matched', 'improved'], ['transfer', 'regressed']]);
  p.salmaCoach = state;
  assert.equal(validatedTransferProofs(p, start + 8 * day + 400).length, 0);
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
  assert.deepEqual([view.progress.verifiedRetest.before, view.progress.verifiedRetest.after], [2.5, 0.8]);
  assert.equal(JSON.stringify(view).includes('live-2'), false);
  assert.equal(JSON.stringify(view.activePrescription).includes('fedcba987654'), false);
});

test('verified retests report held and regressed honestly instead of manufacturing improvement', () => {
  const build = (after) => {
    const p = defaultProfile('acct-1');
    p.sessions = [reliableSession({ sessionId: 'baseline-live', date: 1_800_000_000_000, bossId: 'yasmin',
      wpm: 50, fluency: 50, grammarRules: [] })];
    let state = normalizeSalmaCoachState(null);
    state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
      blocks: 1, repetitions: 3, durationSeconds: 195, timesPerDay: 1, minimumSpacingMinutes: 360,
      successGate: 'Set abschließen.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
      baseline: measurementForSkill(p, 'fluency-interrupt') };
    state = recordDrillOutcome(state, { drill: 'flow-drill', completedSet: true }, 1_800_000_000_200);
    p.sessions.push(reliableSession({ sessionId: `live-${after}`, date: 1_800_100_000_000, bossId: 'yasmin',
      wpm: after, fluency: after, grammarRules: [] }));
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
    scenarioId: CS_SCENARIOS[0].id, grammarMeasured: false, grammarRules: [] });
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
  assert.equal(retest.phase, 'baseline', 'measurement alone cannot impersonate an active retest cycle');
  assert.equal(JSON.stringify(retest).includes('evidenceId'), false);
});

test('failed listening dose keeps practice active; 4/5 unlocks one consistent delayed retest', () => {
  const start = 1_800_000_000_000;
  const p = defaultProfile('acct-1');
  p.listeningAttempts = Array.from({ length: 5 }, (_, index) => listeningV2Attempt(p, index, false, start));
  const challenge = listeningDifficultyContract('listen-clear', 'B1', 1);
  const owner = digest(`listening-account-v2:${p.userId}`);
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'listen-clear', drillId: 'hoer-check',
    blocks: 1, repetitions: 5, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240,
    successGate: 'Mindestens vier von fünf.', assignedAt: start, nextEligibleAt: null,
    listeningCycle: { version: 2, accountBinding: owner, challengeKey: challenge.challengeKey,
      levelKey: 'B1', baseRate: 1, baselineEvidenceIds: p.listeningAttempts.map((row) => digest(row.attemptId, 12)),
      baselineMeasuredAt: p.listeningAttempts.at(-1).gradedAt, doseCompletedAt: null, matchedEligibleAt: null } };
  const event = (correct) => ({ drill: 'hoer-check', correct, prescriptionId: state.activePrescription.id,
    skillId: 'listen-clear', phase: 'practice' });
  for (let index = 0; index < 5; index += 1) {
    state = recordDrillOutcome(state, event(false), start + index + 1);
  }
  assert.equal(salmaCoachBrainGate(state, p, start + 60_000).status, 'practice');
  assert.match(safeIntervention(state, start + 60_000, p).nextAction, /vier von fünf/u);
  assert.equal(publicListeningRetest(p, 'listen-clear', state).trainingComplete, false);

  const passing = [true, true, true, true, false];
  for (let index = 0; index < passing.length; index += 1) {
    state = recordDrillOutcome(state, event(passing[index]), start + 60_000 + index);
  }
  const gate = salmaCoachBrainGate(state, p, start + 120_000);
  assert.equal(gate.status, 'wait');
  assert.equal(gate.action, 'wait');
  assert.match(safeIntervention(state, start + 120_000, p).nextAction, /frühestens/u);
  assert.equal(publicListeningRetest(p, 'listen-clear', state).trainingComplete, true);
});

test('reload and unrelated listening grades cannot replace or credit an active v2 prescription', () => {
  const start = 1_800_000_000_000;
  const p = defaultProfile('acct-1');
  p.listeningAttempts = Array.from({ length: 5 }, (_, index) => listeningV2Attempt(p, index, true, start));
  const challenge = listeningDifficultyContract('listen-clear', 'B1', 1);
  const id = '0123456789abcdef';
  p.salmaCoach = normalizeSalmaCoachState({ activePrescription: {
    id, evidenceIds: p.listeningAttempts.map((row) => digest(row.attemptId, 12)), skillId: 'listen-clear', drillId: 'hoer-check',
    blocks: 1, repetitions: 5, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240,
    successGate: 'Mindestens vier von fünf.', assignedAt: start, nextEligibleAt: null,
    listeningCycle: { version: 2, accountBinding: digest(`listening-account-v2:${p.userId}`),
      challengeKey: challenge.challengeKey, levelKey: 'B1', baseRate: 1,
      baselineEvidenceIds: p.listeningAttempts.map((row) => digest(row.attemptId, 12)),
      baselineMeasuredAt: p.listeningAttempts.at(-1).gradedAt, doseCompletedAt: null, matchedEligibleAt: null },
  } });
  const afterReload = syncSalmaCoach(p, { now: start + 100_000 }).state;
  assert.equal(afterReload.activePrescription.id, id);
  const wrongSkill = recordDrillOutcome(afterReload, { drill: 'hoer-check', correct: true,
    prescriptionId: id, skillId: 'listen-phone', phase: 'practice' }, start + 100_001);
  assert.equal(wrongSkill.coachState.repeatedErrorCounts[id], undefined);
  const unbound = recordDrillOutcome(afterReload, { drill: 'hoer-check', correct: true }, start + 100_002);
  assert.equal(unbound.coachState.repeatedErrorCounts[id], undefined);
});

test('preference booleans reject ambiguous values', () => {
  assert.throws(() => updatePreferences(null, { autoSpeak: 'true' }), /invalid_auto_speak/u);
  assert.throws(() => updatePreferences(null, { muted: 1 }), /invalid_muted/u);
});
