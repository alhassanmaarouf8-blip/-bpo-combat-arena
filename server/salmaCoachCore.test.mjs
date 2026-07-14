import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from './store.js';
import { acknowledgeEvent, answerSalmaQuestion, cairoDay, coachCueForDrill, consumeQuestion,
  deriveSalmaPrescription, measurementForSkill, normalizeSalmaCoachState, publicSalmaCoach, recordDrillOutcome,
  recordMeaningfulRetest, salmaCoachCapabilities, salmaCoachFlags, salmaRetestTarget, safeIntervention, updatePreferences } from './salmaCoachCore.js';

function account(plan = 'free') {
  return { id: 'acct-1', emailVerifiedAt: 1, roles: [], subscription: { plan } };
}
function measuredProfile(sessionCount = 1) {
  const p = defaultProfile('acct-1');
  p.sessions = Array.from({ length: sessionCount }, (_, i) => ({ date: 1_700_000_000_000 + i, bossId: 'yasmin', verdict: 'review',
    wpm: 95, fillers: 6, grammarRules: [{ rule: 'x', count: 4 }], subClauseRate: 0.2,
    vocabDiversity: 0.5, deescalation: 0.55, giveUpRate: 0.1, intelligibility: 0.75, latencyS: 3 }));
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
  const a = deriveSalmaPrescription(p, { now: 1_800_000_000_000, dailyMinutes: 5 }).prescription;
  const b = deriveSalmaPrescription(p, { now: 1_900_000_000_000, dailyMinutes: 5 }).prescription;
  assert.ok(a); assert.equal(a.id, b.id); assert.equal(a.durationSeconds <= 300, true);
  assert.equal(a.timesPerDay, 1); assert.equal(a.evidenceIds.length, 1);
});

test('thin evidence produces no confident prescription', () => {
  const result = deriveSalmaPrescription(defaultProfile('acct-1'), { now: 1_800_000_000_000 });
  assert.equal(result.prescription, null); assert.equal(result.directive.state, 'NEW');
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
  p.sessions = [{ date: 1_800_000_000_000, bossId: 'yasmin', grammarMeasured: true, grammarRules: [{ ruleId: 'word-order-sub', count: 4 }] }];
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
  p.sessions.push({ date: 1_800_100_000_000, bossId: 'yasmin', grammarMeasured: true, grammarRules: [{ ruleId: 'word-order-sub', count: 1 }] });
  const wrongSkill = recordMeaningfulRetest(state, p, { sessionId: 'wrong-skill', skillId: 'deescalate', now: 1_800_100_000_100 });
  assert.equal(wrongSkill.coachState.lastRetestSessionId, null);
  state = recordMeaningfulRetest(state, p, { sessionId: 'session-verified', skillId: 'word-order-sub', now: 1_800_100_000_100 });
  assert.equal(state.coachState.lastRetestSessionId, 'session-verified');
  assert.deepEqual(state.coachState.improvementHistory.map((proof) => [proof.before, proof.after, proof.status]), [[4, 1, 'improved']]);
  const duplicate = recordMeaningfulRetest(state, p, { sessionId: 'session-verified', skillId: 'word-order-sub', now: 1_800_100_000_200 });
  assert.equal(duplicate.coachState.improvementHistory.length, 1);
});

test('retest targeting requires completed practice and exposes only curated text', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [{ date: 1_800_000_000_000, bossId: 'yasmin', fluency: 52, grammarRules: [] }];
  const state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
    blocks: 1, repetitions: 3, durationSeconds: 195, timesPerDay: 1, minimumSpacingMinutes: 360,
    successGate: 'Set abschließen.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'fluency-interrupt') };
  assert.equal(salmaRetestTarget(state, p), null);
  const completed = recordDrillOutcome(state, { drill: 'flow-drill', completedSet: true }, 1_800_000_000_200);
  const target = salmaRetestTarget(completed, p);
  assert.equal(target.skillId, 'fluency-interrupt');
  assert.match(target.dossier, /Unterbrechung/u);
  assert.equal(JSON.stringify(target).includes('user'), false);
});

test('public coach returns a bounded visible before/after proof without internal evidence ids', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [{ date: 1_800_000_000_000, bossId: 'yasmin', grammarMeasured: true, grammarRules: [{ ruleId: 'word-order-sub', count: 3 }] }];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: ['0123456789ab'], skillId: 'word-order-sub', drillId: 'satzbau-schmiede',
    blocks: 1, repetitions: 6, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240,
    successGate: 'Zweimal korrekt.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'word-order-sub') };
  for (let i = 0; i < 6; i += 1) state = recordDrillOutcome(state, { drill: 'satzbau-schmiede', correct: true }, 1_800_000_000_200 + i);
  p.sessions.push({ date: 1_800_100_000_000, bossId: 'yasmin', grammarMeasured: true, grammarRules: [{ ruleId: 'word-order-sub', count: 1 }] });
  p.salmaCoach = recordMeaningfulRetest(state, p, { sessionId: 'live-2', skillId: 'word-order-sub', now: 1_800_100_000_100 });
  const view = publicSalmaCoach(p, account('basic'), { mode: 'on', enabled: true, aiEnabled: false, voiceEnabled: false });
  assert.equal(view.progress.verifiedRetest.status, 'improved');
  assert.deepEqual([view.progress.verifiedRetest.before, view.progress.verifiedRetest.after], [3, 1]);
  assert.equal(JSON.stringify(view).includes('live-2'), false);
  assert.equal(JSON.stringify(view.activePrescription).includes('0123456789ab'), false);
});

test('verified retests report held and regressed honestly instead of manufacturing improvement', () => {
  const build = (after) => {
    const p = defaultProfile('acct-1');
    p.sessions = [{ date: 1_800_000_000_000, bossId: 'yasmin', fluency: 50, grammarRules: [] }];
    let state = normalizeSalmaCoachState(null);
    state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'fluency-interrupt', drillId: 'flow-drill',
      blocks: 1, repetitions: 3, durationSeconds: 195, timesPerDay: 1, minimumSpacingMinutes: 360,
      successGate: 'Set abschließen.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
      baseline: measurementForSkill(p, 'fluency-interrupt') };
    state = recordDrillOutcome(state, { drill: 'flow-drill', completedSet: true }, 1_800_000_000_200);
    p.sessions.push({ date: 1_800_100_000_000, bossId: 'yasmin', fluency: after, grammarRules: [] });
    return recordMeaningfulRetest(state, p, { sessionId: `live-${after}`, skillId: 'fluency-interrupt', now: 1_800_100_000_100 })
      .coachState.improvementHistory[0].status;
  };
  assert.equal(build(53), 'held');
  assert.equal(build(42), 'regressed');
  assert.equal(build(58), 'improved');
});

test('an unavailable grammar checker can never manufacture a zero-error improvement', () => {
  const p = defaultProfile('acct-1');
  p.sessions = [{ date: 1_800_000_000_000, bossId: 'yasmin', grammarMeasured: true,
    grammarRules: [{ ruleId: 'word-order-sub', count: 4 }] }];
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = { id: '0123456789abcdef', evidenceIds: [], skillId: 'word-order-sub', drillId: 'satzbau-schmiede',
    blocks: 1, repetitions: 6, durationSeconds: 600, timesPerDay: 1, minimumSpacingMinutes: 240,
    successGate: 'Zweimal korrekt.', assignedAt: 1_800_000_000_100, nextEligibleAt: null,
    baseline: measurementForSkill(p, 'word-order-sub') };
  for (let i = 0; i < 6; i += 1) state = recordDrillOutcome(state, { drill: 'satzbau-schmiede', correct: true }, 1_800_000_000_200 + i);
  p.sessions.push({ date: 1_800_100_000_000, bossId: 'yasmin', grammarMeasured: false, grammarRules: [] });
  const result = recordMeaningfulRetest(state, p, { sessionId: 'unmeasured', skillId: 'word-order-sub', now: 1_800_100_000_100 });
  assert.equal(result.coachState.improvementHistory.length, 0);
  assert.equal(result.coachState.lastRetestSessionId, null);
  assert.equal(measurementForSkill(p, 'constructor'), null);
});

test('preference booleans reject ambiguous values', () => {
  assert.throws(() => updatePreferences(null, { autoSpeak: 'true' }), /invalid_auto_speak/u);
  assert.throws(() => updatePreferences(null, { muted: 1 }), /invalid_muted/u);
});
