import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSalmaCoachState, salmaCoachEventId } from './salmaCoachCore.js';
import { targetedSpokenReviewQueue } from './spokenReview.js';

const ACCOUNT_ID = 'spoken-target-owner';
const PRESCRIPTION_ID = '0123456789abcdef';

function coachState(repetitions = 2) {
  const state = normalizeSalmaCoachState(null);
  state.activePrescription = {
    id: PRESCRIPTION_ID,
    evidenceIds: ['evidence-1'],
    skillId: 'konjunktiv-2',
    drillId: 'sag-es-richtig',
    blocks: 1,
    repetitions,
    durationSeconds: 600,
    timesPerDay: 1,
    minimumSpacingMinutes: 240,
    successGate: 'Zweimal korrekt.',
    assignedAt: 1_800_000_000_000,
    nextEligibleAt: null,
  };
  return state;
}

function grammarItem(id, content, due = 0, mastered = false) {
  return { id, type: 'grammar', content, example: { wrong: 'Falscher Satz.' },
    due, mastered, reps: 0, lapses: 0, stage: 0 };
}

test('an exact prescription excludes unrelated cards and survives SRS due/mastery changes', () => {
  const profile = { srs: [
    grammarItem('unrelated', 'Dativ oder Akkusativ', 0),
    grammarItem('target', 'Konjunktiv fehlt', Number.MAX_SAFE_INTEGER, true),
  ] };
  const result = targetedSpokenReviewQueue(profile, coachState(2), ACCOUNT_ID);
  assert.equal(result.prescription.targeted, true);
  assert.equal(result.prescription.missingTarget, false);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.id), ['target', 'target']);
  assert.ok(result.items.every((item) => item.prescribed === true));
});

test('an exact prescription fails honestly when no matching verified error card exists', () => {
  const profile = { srs: [grammarItem('unrelated', 'Dativ oder Akkusativ')] };
  const result = targetedSpokenReviewQueue(profile, coachState(3), ACCOUNT_ID);
  assert.deepEqual(result.items, []);
  assert.equal(result.prescription.missingTarget, true);
  assert.equal(result.prescription.remainingRepetitions, 3);
});

test('a failed sentence is queued for its own two repairs before other matching cards', () => {
  const profile = { srs: [
    grammarItem('other-target', 'Konjunktiv II fehlt', 0),
    grammarItem('failed-target', 'Konjunktiv fehlt', 10),
  ] };
  const state = coachState(4);
  const taskHash = salmaCoachEventId({ accountId: ACCOUNT_ID, itemId: 'failed-target',
    itemType: 'grammar', skillId: 'konjunktiv-2' });
  state.coachState.repeatedErrorCounts[PRESCRIPTION_ID] = { blockProgress: [{
    index: 0, attempts: 1, correct: 0, failures: 1, recentOutcomes: [], lastAt: 1,
    completedAt: null, eventIds: [], repairDebt: { [taskHash]: { remaining: 2, lastAt: 1 } },
  }] };
  const result = targetedSpokenReviewQueue(profile, state, ACCOUNT_ID);
  assert.deepEqual(result.items.slice(0, 2).map((item) => item.id), ['failed-target', 'failed-target']);
  assert.equal(result.prescription.repairsRemaining, 2);
});
