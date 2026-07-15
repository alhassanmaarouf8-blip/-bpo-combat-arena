import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { archiveListeningCycle, beginListeningPlayback, commitListeningGrade, finishListeningPlayback,
  listeningBaselineSnapshot, listeningDifficultyContract, listeningEvidenceSummary,
  listeningIssuanceBinding, listeningMasteryEvidence, listeningRetestEvidence,
  markListeningMediaDelivered, minimumListeningPlaybackMs, resolveListeningMedia } from './listeningEvidence.js';

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

const digest = (value, length = 64) => createHash('sha256').update(String(value)).digest('hex').slice(0, length);
const accountBinding = (id) => digest(`listening-account-v2:${id}`);
const packetId = (prescriptionId, phase, challengeKey) => digest(`listening-packet-v2:${prescriptionId}:${phase}:${challengeKey}`, 16);
const evidenceRef = (attemptId) => digest(attemptId, 12);

function v2CycleProfile({ skillId = 'listen-clear', start = 1_800_000_000_000, matchedCorrect = true,
  transferCorrect = true, includeMatched = false, includeTransfer = false } = {}) {
  const userId = 'acct-listening-v2';
  const owner = accountBinding(userId);
  const challenge = listeningDifficultyContract(skillId, 'B1', 1);
  const prescriptionId = '0123456789abcdef';
  const makeRows = (phase, offset, baseId, correct) => Array.from({ length: 5 }, (_, index) => ({
    attemptId: (baseId + index).toString(16).padStart(24, '0'),
    itemHash: (baseId + index).toString(16).padStart(64, '0'),
    skillId, kind: skillId === 'listen-clear' ? 'verstehen' : 'detail', type: skillId === 'listen-clear' ? null : 'nummer',
    correct, plays: 1, playbackRate: 1, baseRate: 1, responseLatencyMs: 900,
    evidenceVersion: 2, accountBinding: owner, prescriptionId: phase === 'baseline_candidate' ? null : prescriptionId,
    packetId: phase === 'baseline_candidate' ? digest(`baseline:${baseId}`, 16) : packetId(prescriptionId, phase, challenge.challengeKey),
    packetIndex: index, phase, challengeKey: challenge.challengeKey, levelKey: 'B1',
    eligibleAt: start + offset, issuedAt: start + offset + index * 1_000, gradedAt: start + offset + index * 1_000 + 500,
  }));
  const baseline = makeRows('baseline_candidate', 0, 100, true);
  const doseCompletedAt = start + 60_000;
  const matchedAt = doseCompletedAt + 24 * 60 * 60 * 1000;
  const matched = makeRows('matched', matchedAt - start, 200, matchedCorrect);
  const transferAt = matched.at(-1).gradedAt + 7 * 24 * 60 * 60 * 1000;
  const transfer = makeRows('transfer', transferAt - start, 300, transferCorrect);
  const listeningAttempts = [...baseline, ...(includeMatched ? matched : []), ...(includeTransfer ? transfer : [])];
  return { userId, listeningAttempts, salmaCoach: { activePrescription: {
    id: prescriptionId, skillId, drillId: 'hoer-check', blocks: 1,
    listeningCycle: { version: 2, accountBinding: owner, challengeKey: challenge.challengeKey,
      levelKey: 'B1', baseRate: 1, baselineEvidenceIds: baseline.map((row) => evidenceRef(row.attemptId)),
      baselineMeasuredAt: baseline.at(-1).gradedAt, doseCompletedAt, matchedEligibleAt: matchedAt },
  }, coachState: { completedBlocks: { [prescriptionId]: 1 } } } };
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
  assert.equal(listeningRetestEvidence(profile, 'listen-clear').phase, 'baseline',
    'unbound measurement can diagnose but never open a mastery cycle');
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

test('reordered storage cannot change an immutable v2 cycle packet', () => {
  const profile = v2CycleProfile({ includeMatched: true, includeTransfer: true });
  const chronological = [...profile.listeningAttempts];
  profile.listeningAttempts.reverse();
  const proof = listeningRetestEvidence(profile, 'listen-clear');
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

test('mastery requires the exact prescription-bound matched and seven-day novel transfer packets', () => {
  const profile = v2CycleProfile();
  let proof = listeningRetestEvidence(profile, 'listen-clear');
  assert.equal(proof.phase, 'matched');
  assert.equal(proof.completed, 0);
  profile.listeningAttempts.push(...v2CycleProfile({ includeMatched: true }).listeningAttempts.slice(5));
  proof = listeningRetestEvidence(profile, 'listen-clear');
  assert.equal(proof.phase, 'transfer');
  assert.equal(listeningMasteryEvidence(profile).clear, null);
  profile.listeningAttempts.push(...v2CycleProfile({ includeMatched: true, includeTransfer: true }).listeningAttempts.slice(10));
  proof = listeningRetestEvidence(profile, 'listen-clear');
  assert.equal(proof.phase, 'complete');
  assert.ok(listeningMasteryEvidence(profile).clear);
});

test('opaque playback cannot complete from elapsed time without exact media redemption', () => {
  const start = 1_800_000_001_000;
  const profile = profileWithAttempt();
  profile.listeningActive.item.mediaProofRequired = true;
  profile.listeningActive.item.minimumPlaybackMs = 600;
  const play = beginListeningPlayback(profile, 'item', start);

  assert.throws(() => finishListeningPlayback(profile, 'item', {
    playNumber: play.playNumber, completed: true, now: start + 600,
  }), (error) => error.code === 'listening_media_required');
  assert.throws(() => commitListeningGrade(profile, 'item', {
    correct: true, now: start + 601,
  }), (error) => error.code === 'listening_playback_required');
  assert.equal(profile.listeningAttempts.length, 0);

  const playInstanceId = profile.listeningActive.item.playInstanceId;
  assert.throws(() => markListeningMediaDelivered(profile, {
    itemId: 'item', playNumber: play.playNumber, playInstanceId: 'f'.repeat(24), now: start + 1,
  }), (error) => error.code === 'listening_media_not_authorized');
  assert.deepEqual(markListeningMediaDelivered(profile, {
    itemId: 'item', playNumber: play.playNumber, playInstanceId, now: start + 2,
  }), { delivered: true, replayed: false });
  assert.deepEqual(markListeningMediaDelivered(profile, {
    itemId: 'item', playNumber: play.playNumber, playInstanceId, now: start + 3,
  }), { delivered: true, replayed: true });
  assert.deepEqual(finishListeningPlayback(profile, 'item', {
    playNumber: play.playNumber, completed: true, now: start + 600,
  }), { completed: true, playNumber: 1 });
  assert.equal(commitListeningGrade(profile, 'item', {
    correct: true, now: start + 601,
  }).replayed, false);
});

test('cross-account, wrong-prescription, practice, and mixed packets never satisfy a retest', () => {
  const profile = v2CycleProfile({ includeMatched: true });
  const matched = profile.listeningAttempts.slice(5);
  matched[0].accountBinding = accountBinding('another-account');
  matched[1].prescriptionId = 'fedcba9876543210';
  matched[2].phase = 'practice';
  matched[3].packetId = 'a'.repeat(16);
  assert.equal(listeningRetestEvidence(profile, 'listen-clear').phase, 'matched');
  assert.equal(listeningRetestEvidence(profile, 'listen-clear').completed, 1);
  assert.equal(listeningMasteryEvidence(profile).clear, null);
});

test('a failed matched packet closes the cycle and can never unlock transfer', () => {
  const profile = v2CycleProfile({ includeMatched: true, includeTransfer: true, matchedCorrect: false });
  const proof = listeningRetestEvidence(profile, 'listen-clear');
  assert.equal(proof.phase, 'failed');
  assert.equal(proof.outcome, 'threshold_missed');
  assert.equal(proof.transfer, null);
  assert.equal(listeningMasteryEvidence(profile).clear, null);
  assert.equal(listeningMasteryEvidence(profile).clearMeasured, true);
});

test('v2 baseline snapshot and issuance are owner-, difficulty-, phase-, and index-bound', () => {
  const profile = v2CycleProfile();
  profile.salmaCoach = null;
  const baseline = listeningBaselineSnapshot(profile, 'listen-clear');
  assert.equal(baseline.baselineEvidenceIds.length, 5);
  assert.equal(baseline.levelKey, 'B1');
  const unbound = listeningIssuanceBinding(profile, 'listen-clear', {
    accountId: profile.userId, levelKey: 'B1', baseRate: 1, slot: 0, now: 1_900_000_000_000,
  });
  assert.equal(unbound.phase, 'baseline_candidate');
  assert.equal(unbound.accountBinding, accountBinding(profile.userId));

  const active = v2CycleProfile();
  const issued = listeningIssuanceBinding(active, 'listen-clear', {
    accountId: active.userId, levelKey: 'B1', baseRate: 1, slot: 2,
    now: active.salmaCoach.activePrescription.listeningCycle.matchedEligibleAt,
  });
  assert.equal(issued.phase, 'matched');
  assert.equal(issued.packetIndex, 2);
  assert.equal(issued.prescriptionId, active.salmaCoach.activePrescription.id);
});

test('opaque listening media resolves only for the fresh owner-bound active play', () => {
  const start = 1_800_000_001_000;
  const profile = profileWithAttempt();
  profile.userId = 'acct-media';
  Object.assign(profile.listeningActive.item, {
    evidenceVersion: 2, accountBinding: accountBinding(profile.userId), skillId: 'listen-clear',
    phase: 'baseline_candidate', packetId: 'a'.repeat(16), packetIndex: 0,
    challengeKey: 'b'.repeat(16), levelKey: 'B1', baseRate: 1, eligibleAt: start,
    ttsText: 'Die Kundin nennt eine Bestellnummer.', voice: 'aura-2-lara-de', minimumPlaybackMs: 600,
  });
  const play = beginListeningPlayback(profile, 'item', start);
  assert.deepEqual(resolveListeningMedia(profile, 'item', play.playNumber, start + 1), {
    text: 'Die Kundin nennt eine Bestellnummer.', voice: 'aura-2-lara-de',
  });
  assert.throws(() => resolveListeningMedia(profile, 'item', play.playNumber + 1, start + 1),
    (error) => error.code === 'listening_media_not_authorized');
  profile.listeningActive.item.accountBinding = accountBinding('attacker');
  assert.throws(() => resolveListeningMedia(profile, 'item', play.playNumber, start + 1),
    (error) => error.code === 'listening_attempt_owner_mismatch');
});

test('completed transfer mastery survives prescription replacement and a later failed cycle demotes it', () => {
  const passed = v2CycleProfile({ includeMatched: true, includeTransfer: true });
  const archivedPass = archiveListeningCycle(passed);
  assert.equal(archivedPass.status, 'passed');
  passed.salmaCoach.activePrescription = null;
  assert.ok(listeningMasteryEvidence(passed).clear, 'archived transfer proof remains authoritative after coach sync');

  const failed = v2CycleProfile({ start: 1_900_000_000_000, includeMatched: true, matchedCorrect: false });
  failed.listeningCycleHistory = passed.listeningCycleHistory;
  const archivedFail = archiveListeningCycle(failed);
  assert.equal(archivedFail.status, 'failed');
  failed.salmaCoach.activePrescription = null;
  assert.equal(listeningMasteryEvidence(failed).clear, null, 'the latest adjudicated cycle can demote earlier mastery');
  assert.equal(listeningMasteryEvidence(failed).clearMeasured, true);
});

test('busy practice history cannot evict the exact baseline or transfer packets', () => {
  const profile = v2CycleProfile({ includeMatched: true, includeTransfer: true });
  const template = profile.listeningAttempts[0];
  const latest = profile.listeningAttempts.at(-1).gradedAt;
  const noise = Array.from({ length: 60 }, (_, index) => ({
    ...template,
    attemptId: (10_000 + index).toString(16).padStart(24, '0'),
    itemHash: (10_000 + index).toString(16).padStart(64, '0'),
    prescriptionId: profile.salmaCoach.activePrescription.id,
    phase: 'practice',
    packetId: digest(`practice-noise-${index}`, 16),
    packetIndex: index % 5,
    eligibleAt: latest + index * 1_000,
    issuedAt: latest + index * 1_000,
    gradedAt: latest + index * 1_000 + 500,
  }));
  profile.listeningAttempts.push(...noise);
  assert.equal(listeningRetestEvidence(profile, 'listen-clear').phase, 'complete');
  assert.ok(listeningMasteryEvidence(profile).clear);
});

test('the bounded attempt store preserves an active baseline and matched packet through the seven-day wait', () => {
  const profile = v2CycleProfile({ includeMatched: true });
  const prescription = profile.salmaCoach.activePrescription;
  const template = profile.listeningAttempts[0];
  const afterMatched = profile.listeningAttempts.at(-1).gradedAt + 10_000;
  for (let index = 0; index < 121; index += 1) {
    const issuedAt = afterMatched + index * 5_000;
    profile.listeningActive = { item: {
      ...template,
      attemptId: (20_000 + index).toString(16).padStart(24, '0'),
      itemHash: (20_000 + index).toString(16).padStart(64, '0'),
      prescriptionId: prescription.id,
      phase: 'practice',
      packetId: digest(`bounded-practice-${index}`, 16),
      packetIndex: index % 5,
      eligibleAt: issuedAt,
      issuedAt,
      maxPlays: 2,
      playCount: 0,
      playStartedAt: null,
      playCompletedAt: null,
      minimumPlaybackMs: 600,
      gradeResult: null,
    } };
    const play = beginListeningPlayback(profile, 'item', issuedAt + 1_000);
    finishListeningPlayback(profile, 'item', {
      playNumber: play.playNumber, completed: true, now: issuedAt + 1_600,
    });
    commitListeningGrade(profile, 'item', { correct: true, now: issuedAt + 2_000 });
  }
  assert.equal(profile.listeningAttempts.length, 120);
  const proof = listeningRetestEvidence(profile, 'listen-clear');
  assert.equal(proof.phase, 'transfer');
  assert.deepEqual(proof.baseline.evidenceIds.length, 5);
  assert.deepEqual(proof.matched.evidenceIds.length, 5);
});

test('bounded archive activity in one listening skill cannot erase mastery in the other skill', () => {
  const phone = v2CycleProfile({ skillId: 'listen-phone', includeMatched: true, includeTransfer: true });
  archiveListeningCycle(phone);
  let history = phone.listeningCycleHistory;
  let latest = phone;
  for (let index = 0; index < 12; index += 1) {
    latest = v2CycleProfile({
      skillId: 'listen-clear',
      start: 1_900_000_000_000 + index * 20 * 24 * 60 * 60 * 1000,
      includeMatched: true,
      matchedCorrect: false,
    });
    latest.listeningCycleHistory = history;
    archiveListeningCycle(latest);
    history = latest.listeningCycleHistory;
  }
  latest.salmaCoach.activePrescription = null;
  assert.equal(latest.listeningCycleHistory.length, 13);
  assert.equal(latest.listeningCycleHistory.filter((row) => row.skillId === 'listen-clear').length, 12);
  assert.equal(latest.listeningCycleHistory.filter((row) => row.skillId === 'listen-phone').length, 1);
  assert.ok(listeningMasteryEvidence(latest).phone);
});

test('partial retest issuance fills the lowest unused packet indexes after reload', () => {
  const profile = v2CycleProfile({ includeMatched: true });
  profile.listeningAttempts = [...profile.listeningAttempts.slice(0, 5), profile.listeningAttempts[5], profile.listeningAttempts[7]];
  const now = profile.salmaCoach.activePrescription.listeningCycle.matchedEligibleAt;
  const first = listeningIssuanceBinding(profile, 'listen-clear', {
    accountId: profile.userId, levelKey: 'B1', baseRate: 1, slot: 0, now,
  });
  const second = listeningIssuanceBinding(profile, 'listen-clear', {
    accountId: profile.userId, levelKey: 'B1', baseRate: 1, slot: 1, now,
  });
  assert.equal(first.phase, 'matched');
  assert.equal(first.packetIndex, 1);
  assert.equal(second.packetIndex, 3);
});
