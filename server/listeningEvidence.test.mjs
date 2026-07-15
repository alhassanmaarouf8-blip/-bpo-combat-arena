import test from 'node:test';
import assert from 'node:assert/strict';
import { beginListeningPlayback, commitListeningGrade, finishListeningPlayback,
  listeningEvidenceSummary, listeningMasteryEvidence, listeningRetestEvidence,
  minimumListeningPlaybackMs } from './listeningEvidence.js';

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

test('minimum playback duration is server-derived, rate-aware, and bounded', () => {
  const text = 'Die Kundin nennt heute eine neue Bestellnummer und bittet um eine schnelle Bestätigung.';
  const normal = minimumListeningPlaybackMs(text, 1);
  const faster = minimumListeningPlaybackMs(text, 1.7);
  assert.ok(normal > faster);
  assert.ok(faster >= 600);
  assert.equal(minimumListeningPlaybackMs('', 99), 600);
  assert.equal(minimumListeningPlaybackMs(Array(1_000).fill('Wort').join(' '), 0.5), 12_000);
});

test('same-tick, too-early, and forged client timing cannot complete playback', () => {
  const start = 1_800_000_001_000;
  const profile = profileWithAttempt();
  profile.listeningActive.item.minimumPlaybackMs = 2_000;
  const play = beginListeningPlayback(profile, 'item', start);
  for (const now of [start, start + 1_999]) {
    assert.throws(() => finishListeningPlayback(profile, 'item', {
      playNumber: play.playNumber,
      completed: true,
      now,
      durationMs: 999_999,
      playedMs: 999_999,
    }), (error) => error.code === 'listening_playback_too_short');
    assert.equal(profile.listeningActive.item.playCompletedAt, null);
    assert.equal(profile.listeningAttempts.length, 0);
  }
  assert.throws(() => commitListeningGrade(profile, 'item', { correct: true, now: start + 1_999 }),
    (error) => error.code === 'listening_playback_required');
  assert.deepEqual(finishListeningPlayback(profile, 'item', {
    playNumber: play.playNumber, completed: true, now: start + 2_000,
  }), { completed: true, playNumber: 1 });
});

test('failed audio dual-callback order never leaves a verified playback', () => {
  const start = 1_800_000_001_000;
  const trueThenFalse = profileWithAttempt();
  trueThenFalse.listeningActive.item.minimumPlaybackMs = 1_500;
  let play = beginListeningPlayback(trueThenFalse, 'item', start);
  assert.throws(() => finishListeningPlayback(trueThenFalse, 'item', {
    playNumber: play.playNumber, completed: true, now: start,
  }), (error) => error.code === 'listening_playback_too_short');
  finishListeningPlayback(trueThenFalse, 'item', {
    playNumber: play.playNumber, completed: false, now: start + 1,
  });
  assert.equal(trueThenFalse.listeningActive.item.playCompletedAt, null);
  assert.throws(() => commitListeningGrade(trueThenFalse, 'item', { correct: true, now: start + 2 }),
    (error) => error.code === 'listening_playback_required');

  const falseThenTrue = profileWithAttempt({ id: 'b'.repeat(24) });
  falseThenTrue.listeningActive.item.minimumPlaybackMs = 1_500;
  play = beginListeningPlayback(falseThenTrue, 'item', start);
  finishListeningPlayback(falseThenTrue, 'item', {
    playNumber: play.playNumber, completed: false, now: start + 1,
  });
  assert.throws(() => finishListeningPlayback(falseThenTrue, 'item', {
    playNumber: play.playNumber, completed: true, now: start + 2_000,
  }), (error) => error.code === 'listening_playback_mismatch');
  assert.equal(falseThenTrue.listeningActive.item.playCompletedAt, null);
  assert.equal(falseThenTrue.listeningAttempts.length, 0);
});

test('repeated early completion claims cannot create a grade or listening mastery', () => {
  const start = 1_800_000_001_000;
  const profile = { listeningActive: {}, listeningAttempts: [] };
  for (let index = 0; index < 15; index += 1) {
    const key = `item-${index}`;
    profile.listeningActive[key] = {
      attemptId: (index + 100).toString(16).padStart(24, '0'),
      itemHash: (index + 100).toString(16).padStart(64, '0'),
      kind: 'verstehen', type: null, issuedAt: start, maxPlays: 2, playCount: 0,
      playStartedAt: null, playCompletedAt: null, playbackRate: 1,
      minimumPlaybackMs: 1_000, gradeResult: null,
    };
    const play = beginListeningPlayback(profile, key, start + index);
    assert.throws(() => finishListeningPlayback(profile, key, {
      playNumber: play.playNumber, completed: true, now: start + index,
    }), (error) => error.code === 'listening_playback_too_short');
    assert.throws(() => commitListeningGrade(profile, key, { correct: true, now: start + index + 1 }),
      (error) => error.code === 'listening_playback_required');
  }
  assert.equal(profile.listeningAttempts.length, 0);
  assert.equal(listeningMasteryEvidence(profile).clear, null);
});

test('legacy active items remain usable after the compatibility floor', () => {
  const start = 1_800_000_001_000;
  const profile = profileWithAttempt();
  assert.equal(Object.hasOwn(profile.listeningActive.item, 'minimumPlaybackMs'), false);
  const play = beginListeningPlayback(profile, 'item', start);
  assert.throws(() => finishListeningPlayback(profile, 'item', {
    playNumber: play.playNumber, completed: true, now: start + 599,
  }), (error) => error.code === 'listening_playback_too_short');
  assert.deepEqual(finishListeningPlayback(profile, 'item', {
    playNumber: play.playNumber, completed: true, now: start + 600,
  }), { completed: true, playNumber: 1 });
  assert.equal(commitListeningGrade(profile, 'item', { correct: true, now: start + 601 }).replayed, false);
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
  finishListeningPlayback(profile, 'item', { playNumber: play.playNumber, completed: true, now: 1_800_000_002_600 });
  play = beginListeningPlayback(profile, 'item', 1_800_000_003_000);
  finishListeningPlayback(profile, 'item', { playNumber: play.playNumber, completed: true, now: 1_800_000_003_600 });
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

test('reordered storage is normalized chronologically before packets are adjudicated', () => {
  const start = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const packet = (offset, baseId) => Array.from({ length: 5 }, (_, index) => ({
    attemptId: (baseId + index).toString(16).padStart(24, '0'),
    itemHash: (baseId + index).toString(16).padStart(64, '0'),
    skillId: 'listen-clear', kind: 'verstehen', type: null, correct: true, plays: 1,
    playbackRate: 1, responseLatencyMs: 900,
    issuedAt: start + offset + index * 1000, gradedAt: start + offset + index * 1000 + 500,
  }));
  const chronological = [...packet(0, 500), ...packet(day + 10_000, 600), ...packet(8 * day + 20_000, 700)];
  const shuffled = [...chronological].sort((a, b) => b.issuedAt - a.issuedAt);
  const proof = listeningRetestEvidence({ listeningAttempts: shuffled }, 'listen-clear');
  assert.equal(proof.phase, 'complete');
  assert.equal(proof.baseline.measuredAt, chronological[4].gradedAt);
  assert.equal(proof.matched.measuredAt, chronological[9].gradedAt);
  assert.equal(proof.transfer.measuredAt, chronological[14].gradedAt);
});

test('unfingerprinted legacy rows can measure but can never prove transfer mastery', () => {
  const start = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const rows = Array.from({ length: 15 }, (_, index) => ({
    attemptId: (800 + index).toString(16).padStart(24, '0'),
    skillId: 'listen-clear', kind: 'verstehen', type: null, correct: true, plays: 1,
    playbackRate: 1, responseLatencyMs: 1000,
    issuedAt: start + (index < 5 ? index * 1000 : index < 10 ? day + index * 1000 : 8 * day + index * 1000),
    gradedAt: start + (index < 5 ? index * 1000 : index < 10 ? day + index * 1000 : 8 * day + index * 1000) + 500,
  }));
  const profile = { listeningAttempts: rows };
  assert.equal(listeningEvidenceSummary(profile, 'listen-clear').accuracy, 1);
  assert.equal(listeningRetestEvidence(profile, 'listen-clear').phase, 'baseline');
  assert.equal(listeningMasteryEvidence(profile).clear, null);
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
