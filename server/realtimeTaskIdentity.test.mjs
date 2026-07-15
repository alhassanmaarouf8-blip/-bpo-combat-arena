import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeClient } from './realtimeClient.js';

const noop = () => {};
function makeClient(overrides = {}) {
  return new RealtimeClient({
    sessionId: 'baseline-runtime-session',
    bossId: 'yasmin',
    level: 'a2-b1',
    dossier: 'server-known context',
    memory: 'bounded memory',
    focusTitle: 'Interviewtraining',
    recent: { behavioral: [], screening: [], cs: [] },
    onBossSpeech: noop,
    onBossEarly: noop,
    ...overrides,
  });
}

test('matched runtime replays the full task while preserving persona and voice fields', () => {
  const baseline = makeClient();
  const task = baseline.taskIdentity;
  const matched = makeClient({
    sessionId: 'new-transport-session',
    recent: {
      behavioral: [baseline.picks.behavioral.id],
      screening: [baseline.picks.screening.id],
      cs: [baseline.picks.cs.id],
    },
    contentSeed: task.contentSeed,
    forcedMood: task.mood,
    forcedBehavioralPromptId: task.behavioralPromptId,
    forcedScreeningPromptId: task.screeningPromptId,
    forcedScenarioId: task.scenarioId,
    retestProbe: 'Prüfe, ob die Antwort auch unter Unterbrechung vollständig bleibt.',
  });

  assert.deepEqual(matched.taskIdentity, baseline.taskIdentity);
  for (const key of ['bossId', 'displayName', 'voice', 'elevenVoice', 'forcefulness']) {
    assert.equal(matched.sessionInfo[key], baseline.sessionInfo[key], `${key} must not change`);
  }
  assert.match(matched._session.instructions, /VERDECKTER WIEDERHOLUNGSTEST/u);
  assert.doesNotMatch(matched.sessionInfo.behavioral, /VERDECKTER WIEDERHOLUNGSTEST/u);
});

test('transfer runtime holds difficulty and persona constant while changing actual content', () => {
  const baseline = makeClient();
  const task = baseline.taskIdentity;
  const transfer = makeClient({
    sessionId: 'transfer-transport-session',
    contentSeed: task.contentSeed,
    forcedMood: task.mood,
    excludedBehavioralPromptIds: [task.behavioralPromptId],
    excludedScreeningPromptIds: [task.screeningPromptId],
    excludedScenarioIds: [task.scenarioId],
  });

  assert.equal(transfer.taskIdentity.levelId, task.levelId);
  assert.equal(transfer.taskIdentity.contentSeed, task.contentSeed);
  assert.equal(transfer.taskIdentity.mood, task.mood);
  assert.notEqual(transfer.taskIdentity.behavioralPromptId, task.behavioralPromptId);
  assert.notEqual(transfer.taskIdentity.screeningPromptId, task.screeningPromptId);
  assert.notEqual(transfer.taskIdentity.scenarioId, task.scenarioId);
  for (const key of ['bossId', 'displayName', 'voice', 'elevenVoice', 'forcefulness']) {
    assert.equal(transfer.sessionInfo[key], baseline.sessionInfo[key], `${key} must not change`);
  }
});
