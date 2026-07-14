const ATTEMPT_LIMIT = 120;
const ACTIVE_TTL_MS = 30 * 60 * 1000;
const STALE_PLAYBACK_MS = 90 * 1000;
const SKILLS = new Set(['listen-clear', 'listen-phone']);

function fail(code, status = 409) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function finiteTime(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function activeItem(profile, itemId) {
  const key = String(itemId || '');
  const item = profile?.listeningActive?.[key];
  if (!item || typeof item !== 'object' || !/^[a-f0-9]{24}$/u.test(item.attemptId || '')) {
    fail('listening_attempt_not_found', 404);
  }
  return { key, item };
}

function ensureFresh(item, now) {
  const issuedAt = finiteTime(item.issuedAt);
  if (!issuedAt || now - issuedAt > ACTIVE_TTL_MS) fail('listening_attempt_expired', 410);
}

function safeAttempt(row) {
  if (!row || typeof row !== 'object' || !/^[a-f0-9]{24}$/u.test(row.attemptId || '')
    || !SKILLS.has(row.skillId) || typeof row.correct !== 'boolean') return null;
  const gradedAt = finiteTime(row.gradedAt);
  const issuedAt = finiteTime(row.issuedAt);
  if (!gradedAt || !issuedAt || gradedAt < issuedAt) return null;
  return {
    attemptId: row.attemptId,
    itemHash: /^[a-f0-9]{64}$/u.test(row.itemHash || '') ? row.itemHash : null,
    skillId: row.skillId,
    kind: row.kind === 'verstehen' ? 'verstehen' : 'detail',
    type: typeof row.type === 'string' ? row.type.slice(0, 24) : null,
    correct: row.correct,
    plays: Math.max(1, Math.min(2, Number(row.plays) || 1)),
    playbackRate: Math.max(0.5, Math.min(2, Number(row.playbackRate) || 1)),
    responseLatencyMs: Number.isFinite(Number(row.responseLatencyMs))
      ? Math.max(0, Math.min(10 * 60 * 1000, Number(row.responseLatencyMs))) : null,
    issuedAt,
    gradedAt,
  };
}

export function beginListeningPlayback(profile, itemId, now = Date.now()) {
  const { item } = activeItem(profile, itemId);
  ensureFresh(item, now);
  if (item.gradeResult) fail('listening_attempt_already_graded');
  const startedAt = finiteTime(item.playStartedAt);
  if (startedAt && !finiteTime(item.playCompletedAt)) {
    if (now - startedAt < STALE_PLAYBACK_MS) fail('listening_playback_in_progress');
    item.playCount = Math.max(0, (Number(item.playCount) || 0) - 1);
    item.playStartedAt = null;
  }
  const maxPlays = Math.max(1, Math.min(2, Number(item.maxPlays) || 2));
  const playCount = Math.max(0, Number(item.playCount) || 0);
  if (playCount >= maxPlays) fail('listening_replay_limit');
  item.playCount = playCount + 1;
  item.playStartedAt = now;
  item.playCompletedAt = null;
  return { playNumber: item.playCount, maxPlays };
}

export function finishListeningPlayback(profile, itemId, { playNumber, completed = true, now = Date.now() } = {}) {
  const { item } = activeItem(profile, itemId);
  ensureFresh(item, now);
  if (item.gradeResult) return { completed: false, alreadyGraded: true };
  if (!Number.isInteger(playNumber) || playNumber !== item.playCount || !finiteTime(item.playStartedAt)) {
    fail('listening_playback_mismatch');
  }
  if (completed !== true) {
    item.playCount = Math.max(0, item.playCount - 1);
    item.playStartedAt = null;
    item.playCompletedAt = null;
    return { completed: false, playNumber };
  }
  if (now < item.playStartedAt) fail('listening_playback_mismatch');
  item.playCompletedAt = now;
  return { completed: true, playNumber };
}

export function commitListeningGrade(profile, itemId, { correct, now = Date.now() } = {}) {
  const { item } = activeItem(profile, itemId);
  ensureFresh(item, now);
  if (item.gradeResult && typeof item.gradeResult.correct === 'boolean') {
    return { ...item.gradeResult, replayed: true };
  }
  if (typeof correct !== 'boolean') fail('listening_grade_invalid', 400);
  const completedAt = finiteTime(item.playCompletedAt);
  if (!completedAt || completedAt < finiteTime(item.playStartedAt)) fail('listening_playback_required');
  const kind = item.kind === 'verstehen' ? 'verstehen' : 'detail';
  const skillId = kind === 'verstehen' ? 'listen-clear' : 'listen-phone';
  const evidence = safeAttempt({
    attemptId: item.attemptId,
    itemHash: item.itemHash,
    skillId,
    kind,
    type: item.type,
    correct,
    plays: item.playCount,
    playbackRate: item.playbackRate,
    responseLatencyMs: now - completedAt,
    issuedAt: item.issuedAt,
    gradedAt: now,
  });
  if (!evidence) fail('listening_evidence_invalid', 500);
  const existing = Array.isArray(profile.listeningAttempts) ? profile.listeningAttempts.map(safeAttempt).filter(Boolean) : [];
  if (!existing.some((row) => row.attemptId === evidence.attemptId)) existing.push(evidence);
  profile.listeningAttempts = existing.slice(-ATTEMPT_LIMIT);
  item.gradeResult = { correct, gradedAt: now, attemptId: item.attemptId };
  return { ...item.gradeResult, replayed: false };
}

export function listeningEvidence(profile, skillId, { limit = 10 } = {}) {
  if (!SKILLS.has(skillId)) return [];
  const seenAttempts = new Set();
  const seenContent = new Set();
  return (Array.isArray(profile?.listeningAttempts) ? profile.listeningAttempts : [])
    .map(safeAttempt).filter(Boolean).filter((row) => {
      if (row.skillId !== skillId || seenAttempts.has(row.attemptId)) return false;
      if (row.itemHash && seenContent.has(row.itemHash)) return false;
      seenAttempts.add(row.attemptId);
      if (row.itemHash) seenContent.add(row.itemHash);
      return true;
    }).slice(-Math.max(1, Math.min(30, Number(limit) || 10)));
}

export function listeningEvidenceSummary(profile, skillId, { minimumAttempts = 5, limit = 10 } = {}) {
  const attempts = listeningEvidence(profile, skillId, { limit });
  if (attempts.length < minimumAttempts) return null;
  const correct = attempts.filter((row) => row.correct).length;
  const firstPlayCorrect = attempts.filter((row) => row.correct && row.plays === 1).length;
  const extraReplays = attempts.reduce((sum, row) => sum + Math.max(0, row.plays - 1), 0);
  const latencies = attempts.map((row) => row.responseLatencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(latencies.length / 2);
  const medianLatencyMs = latencies.length
    ? (latencies.length % 2 ? latencies[middle] : Math.round((latencies[middle - 1] + latencies[middle]) / 2)) : null;
  return {
    skillId,
    sampleSize: attempts.length,
    accuracy: correct / attempts.length,
    firstPlayAccuracy: firstPlayCorrect / attempts.length,
    replayRate: extraReplays / attempts.length,
    medianLatencyMs,
    measuredAt: attempts.at(-1).gradedAt,
    evidenceIds: attempts.map((row) => row.attemptId),
  };
}

export function listeningMasteryEvidence(profile) {
  const clear = listeningEvidenceSummary(profile, 'listen-clear');
  const phone = listeningEvidenceSummary(profile, 'listen-phone');
  return {
    clear: clear && clear.accuracy >= 0.8 && clear.replayRate <= 0.4 ? clear : null,
    phone: phone && phone.accuracy >= 0.8 && phone.firstPlayAccuracy >= 0.6 && phone.replayRate <= 0.4 ? phone : null,
    clearMeasured: !!clear,
    phoneMeasured: !!phone,
    hasVerifiedAttempts: (Array.isArray(profile?.listeningAttempts) ? profile.listeningAttempts : []).some((row) => safeAttempt(row)),
  };
}
