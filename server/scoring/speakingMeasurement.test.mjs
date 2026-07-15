import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reliableSpeakingSessions, speakingMeasurementForSkill } from './speakingMeasurement.js';

const NOW = 1_700_000_000_000;

function grammarSession({ sessionId, date, version = 2, eligibleWords, count, eligible = true }) {
  return {
    sessionId,
    date,
    bossId: 'yasmin',
    targetRoleType: 'customer_service',
    targetIndustry: 'telecom',
    scenarioId: 'billing-dispute',
    grammarMeasured: true,
    grammarRules: [
      { ruleId: 'word-order-sub', count },
      { ruleId: 'dativ-akkusativ', count: 99 },
    ],
    evidenceQuality: {
      version,
      eligibleWords,
      words: eligibleWords,
      prescriptionEligible: eligible,
    },
  };
}

test('speaking measurement: exact-rule grammar is normalized per 100 eligible words', () => {
  const sessions = [
    grammarSession({ sessionId: 'baseline', date: NOW - 1_000, eligibleWords: 200, count: 4 }),
    grammarSession({ sessionId: 'matched', date: NOW, eligibleWords: 80, count: 3 }),
  ];
  const profile = { sessions };
  const baseline = speakingMeasurementForSkill(profile, 'word-order-sub', { sessionId: 'baseline' });
  const matched = speakingMeasurementForSkill(profile, 'word-order-sub', { sessionId: 'matched' });

  assert.equal(baseline.value, 2);
  assert.equal(matched.value, 3.8);
  assert.ok(matched.value > baseline.value,
    'three errors in 80 eligible words is a regression from four in 200, despite the lower raw count');
  assert.notEqual(matched.evidenceId, baseline.evidenceId);
});

test('speaking measurement: thin grammar exposure cannot authorize a comparison', () => {
  const profile = { sessions: [
    grammarSession({ sessionId: 'thin', date: NOW, eligibleWords: 79, count: 0 }),
  ] };
  assert.equal(speakingMeasurementForSkill(profile, 'word-order-sub', { sessionId: 'thin' }), null);
});

test('speaking measurement: v2 is the only authority for new measurements', () => {
  const v1 = grammarSession({ sessionId: 'legacy', date: NOW - 2_000, version: 1, eligibleWords: 120, count: 1 });
  const v2 = grammarSession({ sessionId: 'current', date: NOW - 1_000, version: 2, eligibleWords: 120, count: 2 });
  const rejectedV2 = grammarSession({ sessionId: 'rejected', date: NOW, version: 2,
    eligibleWords: 120, count: 0, eligible: false });
  const profile = { sessions: [v1, v2, rejectedV2] };

  assert.deepEqual(reliableSpeakingSessions(profile).map((session) => session.sessionId), ['current']);
  assert.equal(speakingMeasurementForSkill(profile, 'word-order-sub', { sessionId: 'legacy' }), null);
  assert.equal(speakingMeasurementForSkill(profile, 'word-order-sub', { sessionId: 'rejected' }), null);
  assert.equal(speakingMeasurementForSkill(profile, 'word-order-sub', { sessionId: 'current' }).value, 1.7);

  const rejectedMigration = { sessions: [v1, rejectedV2] };
  assert.deepEqual(reliableSpeakingSessions(rejectedMigration), [],
    'an ineligible v2 packet cannot silently reopen legacy authority');
  assert.equal(speakingMeasurementForSkill(rejectedMigration, 'word-order-sub'), null);
});

test('speaking measurement: v1-only profiles remain historical and cannot create new mastery', () => {
  const profile = { sessions: [
    grammarSession({ sessionId: 'legacy', date: NOW, version: 1, eligibleWords: 100, count: 2 }),
  ] };
  assert.equal(speakingMeasurementForSkill(profile, 'word-order-sub'), null);
});
