import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEHAVIORAL_QUESTIONS, BPO_SCREENING_QUESTIONS, CS_SCENARIOS,
  INTERVIEW_PROMPT_CONTRACT_VERSION, interviewPromptId } from '../scenarios.js';
import { reliableSpeakingSessions, speakingContextForSession, speakingMeasurementForSkill } from './speakingMeasurement.js';

const NOW = 1_700_000_000_000;

function grammarSession({ sessionId, date, version = 2, eligibleWords, count, eligible = true,
  taskOverrides = {}, omitTaskContract = false }) {
  const session = {
    sessionId,
    date,
    level: 'a2-b1',
    bossId: 'yasmin',
    targetRoleType: 'customer_service',
    targetIndustry: 'telecom',
    scenarioId: CS_SCENARIOS[0].id,
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
  if (!omitTaskContract) session.speakingTaskContract = {
    version: 1,
    promptContractVersion: INTERVIEW_PROMPT_CONTRACT_VERSION,
    assessmentMode: 'diagnostic',
    levelId: session.level,
    bossId: session.bossId,
    roleType: session.targetRoleType,
    scenarioId: session.scenarioId,
    behavioralPromptId: interviewPromptId('behavioral', BEHAVIORAL_QUESTIONS[0], session.level),
    screeningPromptId: interviewPromptId('screening', BPO_SCREENING_QUESTIONS[0], session.level),
    industryKey: session.targetIndustry,
    targetId: null,
    contentSeed: 'stable-comparison-seed',
    mood: 'neutral',
    replayContext: { dossier: '', memory: '', focusTitle: '' },
    ...taskOverrides,
  };
  return session;
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

test('speaking measurement: sustained pace is bound to exact WPM, never the composite fluency score', () => {
  const measured = grammarSession({ sessionId: 'pace', date: NOW, eligibleWords: 120, count: 0 });
  measured.wpm = 72;
  measured.fluency = 99;
  const result = speakingMeasurementForSkill({ sessions: [measured] }, 'fluency-interrupt');
  assert.equal(result.metricKey, 'wpm');
  assert.equal(result.value, 72);

  const proxyOnly = grammarSession({ sessionId: 'proxy-only', date: NOW + 1, eligibleWords: 120, count: 0 });
  proxyOnly.fluency = 99;
  assert.equal(speakingMeasurementForSkill({ sessions: [proxyOnly] }, 'fluency-interrupt'), null,
    'a high composite fluency score cannot manufacture a sustained-pace baseline');
});

test('speaking task identity fails closed for legacy, client-revanche and stale prompt contracts', () => {
  const legacy = grammarSession({ sessionId: 'legacy-task', date: NOW, eligibleWords: 120, count: 2,
    omitTaskContract: true });
  const revanche = grammarSession({ sessionId: 'revanche-task', date: NOW, eligibleWords: 120, count: 2,
    taskOverrides: { assessmentMode: 'revanche' } });
  const stale = grammarSession({ sessionId: 'stale-task', date: NOW, eligibleWords: 120, count: 2,
    taskOverrides: { promptContractVersion: INTERVIEW_PROMPT_CONTRACT_VERSION + 1 } });
  const unknownBoss = grammarSession({ sessionId: 'unknown-boss-task', date: NOW, eligibleWords: 120, count: 2,
    taskOverrides: { bossId: 'prototype-boss' } });
  const mismatchedLevel = grammarSession({ sessionId: 'mismatched-level-task', date: NOW, eligibleWords: 120, count: 2,
    taskOverrides: { levelId: 'b2' } });
  assert.equal(speakingContextForSession(legacy), null);
  assert.equal(speakingContextForSession(revanche), null);
  assert.equal(speakingContextForSession(stale), null);
  assert.equal(speakingContextForSession(unknownBoss), null);
  assert.equal(speakingContextForSession(mismatchedLevel), null);
});

test('speaking task identity binds the whole task and ignores the transport session id', () => {
  const baseline = grammarSession({ sessionId: 'baseline-task', date: NOW, eligibleWords: 120, count: 2 });
  const replay = grammarSession({ sessionId: 'replay-task', date: NOW + 1, eligibleWords: 120, count: 1 });
  assert.deepEqual(speakingContextForSession(replay), speakingContextForSession(baseline),
    'an exact replay has stable task identity even though its session id changed');

  for (const taskOverrides of [
    { contentSeed: 'different-style-seed' },
    { mood: 'sharp-monday' },
    { replayContext: { dossier: 'different', memory: '', focusTitle: '' } },
    { behavioralPromptId: interviewPromptId('behavioral', BEHAVIORAL_QUESTIONS[1], 'a2-b1') },
    { screeningPromptId: interviewPromptId('screening', BPO_SCREENING_QUESTIONS[1], 'a2-b1') },
  ]) {
    const changed = grammarSession({ sessionId: `changed-${JSON.stringify(taskOverrides)}`, date: NOW + 2,
      eligibleWords: 120, count: 1, taskOverrides });
    assert.notEqual(speakingContextForSession(changed)?.contextId,
      speakingContextForSession(baseline)?.contextId);
  }
});
