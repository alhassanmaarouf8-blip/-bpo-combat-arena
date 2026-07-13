import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from './store.js';
import { acknowledgeEvent, answerSalmaQuestion, cairoDay, coachCueForDrill, consumeQuestion,
  deriveSalmaPrescription, normalizeSalmaCoachState, recordDrillOutcome, recordMeaningfulRetest, salmaCoachCapabilities, salmaCoachFlags,
  safeIntervention, updatePreferences } from './salmaCoachCore.js';

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

test('drill work is nominated but never declared mastered without a live retest', () => {
  const p = measuredProfile(1);
  let state = normalizeSalmaCoachState(null);
  state.activePrescription = deriveSalmaPrescription(p, { now: 1_800_000_000_000, dailyMinutes: 10 }).prescription;
  const drill = state.activePrescription.drillId;
  state = recordDrillOutcome(state, { drill, correct: false }, 1_800_000_000_100);
  for (let i = 0; i < state.activePrescription.repetitions + 2; i += 1) {
    state = recordDrillOutcome(state, { drill, correct: true }, 1_800_000_000_200 + i);
  }
  assert.equal(state.coachState.completedBlocks[state.activePrescription.id], 1);
  assert.equal(state.coachState.lastRetestSessionId, null);
  state = recordMeaningfulRetest(state, 'session-verified');
  assert.equal(state.coachState.lastRetestSessionId, 'session-verified');
});

test('preference booleans reject ambiguous values', () => {
  assert.throws(() => updatePreferences(null, { autoSpeak: 'true' }), /invalid_auto_speak/u);
  assert.throws(() => updatePreferences(null, { muted: 1 }), /invalid_muted/u);
});
