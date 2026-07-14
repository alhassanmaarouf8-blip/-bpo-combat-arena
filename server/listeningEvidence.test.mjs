import test from 'node:test';
import assert from 'node:assert/strict';
import { beginListeningPlayback, commitListeningGrade, finishListeningPlayback,
  listeningEvidenceSummary, listeningMasteryEvidence, listeningRetestEvidence } from './listeningEvidence.js';

function profileWithAttempt({ id = 'a'.repeat(24), kind = 'verstehen', issuedAt = 1_800_000_000_000,
  type = 'nummer', playbackRate = 1, itemHash = null } = {}) {
  return { listeningActive: { item: { attemptId: id, itemHash, kind, type, issuedAt, maxPlays: 2, playCount: 0,
    playStartedAt: null, playCompletedAt: null, playbackRate, gradeResult: null } }, listeningAttempts: [] };
}

function complete(profile, { correct = true, now = 1_800_000_001_000 } = {}) {
  const play = beginListeningPlayback(profile, 'item', now);
  finishListeningPlayback(profile, 'item', { playNumber: play.playNumber, completed: true, now: now + 1_000 });
  return commitListeningGrade(profile, 'item', { correct, now: now + 2_500 });
}

test('listening evidence requires a completed server-issued playback', () => {
  const profile = profileWithAttempt();
  assert.throws(() => commitListeningGrade(profile, 'item', { correct: true, now: 1_800_000_001_000 }),
    (error) => error.code === 'listening_playback_required');
  const play = beginListeningPlayback(profile, 'item', 1_800_000_001_000);
  assert.throws(() => commitListeningGrade(profile, 'item', { correct: true, now: 1_800_000_001_500 }),
    (error) => error.code === 'listening_playback_required');
  finishListeningPlayback(profile, 'item', { playNumber: play.playNumber, completed: true, now: 1_800_000_002_000 });
  const result = commitListeningGrade(profile, 'item', { correct: true, now: 1_800_000_003_500 });
  assert.equal(result.replayed, false);
  assert.deepEqual(profile.listeningAttempts.map((row) => [row.correct, row.plays, row.responseLatencyMs]), [[true, 1, 1500]]);
});

test('double submit is idempotent and cannot inflate accuracy', () => {
  const profile = profileWithAttempt();
  const first = complete(profile, { correct: false });
  const replay = commitListeningGrade(profile, 'item', { correct: true, now: 1_800_000_010_000 });
  assert.equal(first.correct, false);
  assert.equal(replay.correct, false);
  assert.equal(replay.replayed, true);
  assert.equal(profile.listeningAttempts.length, 1);
});

test('failed audio is not counted and the two-play limit is server enforced', () => {
  const profile = profileWithAttempt();
  let play = beginListeningPlayback(profile, 'item', 1_800_000_001_000);
  finishListeningPlayback(profile, 'item', { playNumber: play.playNumber, completed: false, now: 1_800_000_001_500 });
  assert.equal(profile.listeningActive.item.playCount, 0);
  play = beginListeningPlayback(profile, 'item', 1_800_000_002_000);
  finishListeningPlayback(profile, 'item', { playNumber: play.playNumber, completed: true, now: 1_800_000_002_500 });
  play = beginListeningPlayback(profile, 'item', 1_800_000_003_000);
  finishListeningPlayback(profile, 'item', { playNumber: play.playNumber, completed: true, now: 1_800_000_003_500 });
  assert.throws(() => beginListeningPlayback(profile, 'item', 1_800_000_004_000),
    (error) => error.code === 'listening_replay_limit');
});

test('measurement uses unique bounded attempts and exposes replay dependence separately', () => {
  const profile = { listeningAttempts: [] };
  for (let i = 0; i < 5; i += 1) {
    const row = profileWithAttempt({ id: i.toString(16).padStart(24, '0'), itemHash: i.toString(16).padStart(64, '0'),
      issuedAt: 1_800_000_000_000 + i * 10_000 });
    const playOne = beginListeningPlayback(row, 'item', row.listeningActive.item.issuedAt + 1_000);
    finishListeningPlayback(row, 'item', { playNumber: playOne.playNumber, completed: true, now: row.listeningActive.item.issuedAt + 2_000 });
    if (i >= 3) {
      const playTwo = beginListeningPlayback(row, 'item', row.listeningActive.item.issuedAt + 3_000);
      finishListeningPlayback(row, 'item', { playNumber: playTwo.playNumber, completed: true, now: row.listeningActive.item.issuedAt + 4_000 });
    }
    commitListeningGrade(row, 'item', { correct: i !== 4, now: row.listeningActive.item.issuedAt + 5_000 });
    profile.listeningAttempts.push(...row.listeningAttempts);
  }
  profile.listeningAttempts.push(profile.listeningAttempts[0]);
  const summary = listeningEvidenceSummary(profile, 'listen-clear');
  assert.equal(summary.sampleSize, 5);
  assert.equal(summary.accuracy, 0.8);
  assert.equal(summary.firstPlayAccuracy, 0.6);
  assert.equal(summary.replayRate, 0.4);
  assert.equal(listeningMasteryEvidence(profile).clear, null, 'one packet measures the baseline but cannot prove transfer');
  assert.equal(listeningRetestEvidence(profile, 'listen-clear').phase, 'matched');
});

test('the same content under a new attempt id counts only once', () => {
  const itemHash = 'b'.repeat(64);
  const profile = { listeningAttempts: [] };
  for (let i = 0; i < 5; i += 1) {
    const row = profileWithAttempt({
      id: (i + 40).toString(16).padStart(24, '0'), itemHash,
      issuedAt: 1_800_000_000_000 + i * 10_000,
    });
    complete(row, { now: row.listeningActive.item.issuedAt + 1_000 });
    profile.listeningAttempts.push(...row.listeningAttempts);
  }
  assert.equal(listeningEvidenceSummary(profile, 'listen-clear'), null);
});

test('phone mastery fails closed when correct answers depend on replays', () => {
  const profile = { listeningAttempts: Array.from({ length: 5 }, (_, index) => ({
    attemptId: (index + 20).toString(16).padStart(24, '0'), skillId: 'listen-phone', kind: 'detail', type: 'nummer',
    correct: true, plays: 2, playbackRate: 1.2, responseLatencyMs: 1200,
    issuedAt: 1_800_000_000_000 + index * 10_000, gradedAt: 1_800_000_005_000 + index * 10_000,
  })) };
  assert.equal(listeningEvidenceSummary(profile, 'listen-phone').accuracy, 1);
  assert.equal(listeningMasteryEvidence(profile).phone, null);
});

test('mastery requires a delayed matched packet and a seven-day novel transfer packet', () => {
  const start = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const rows = [];
  const packet = (offset, baseId) => Array.from({ length: 5 }, (_, index) => ({
    attemptId: (baseId + index).toString(16).padStart(24, '0'),
    itemHash: (baseId + index).toString(16).padStart(64, '0'),
    skillId: 'listen-clear', kind: 'verstehen', type: null, correct: true, plays: 1,
    playbackRate: 1.1, responseLatencyMs: 1200,
    issuedAt: start + offset + index * 1000, gradedAt: start + offset + index * 1000 + 500,
  }));
  rows.push(...packet(0, 100));
  rows.push(...packet(day - 10_000, 200));
  let proof = listeningRetestEvidence({ listeningAttempts: rows }, 'listen-clear');
  assert.equal(proof.phase, 'matched', 'same-day practice cannot satisfy the delayed matched retest');

  rows.push(...packet(day + 10_000, 300));
  proof = listeningRetestEvidence({ listeningAttempts: rows }, 'listen-clear');
  assert.equal(proof.phase, 'transfer');
  assert.equal(listeningMasteryEvidence({ listeningAttempts: rows }).clear, null);

  rows.push(...packet(8 * day + 20_000, 400));
  proof = listeningRetestEvidence({ listeningAttempts: rows }, 'listen-clear');
  assert.equal(proof.phase, 'complete');
  assert.ok(listeningMasteryEvidence({ listeningAttempts: rows }).clear);
});
