import { createHash, randomBytes } from 'crypto';

const ATTEMPT_LIMIT = 120;
const ACTIVE_TTL_MS = 30 * 60 * 1000;
const STALE_PLAYBACK_MS = 90 * 1000;
const MATCHED_RETEST_DELAY_MS = 24 * 60 * 60 * 1000;
const TRANSFER_RETEST_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const PACKET_SIZE = 5;
const SKILLS = new Set(['listen-clear', 'listen-phone']);
const MIN_PLAYBACK_FLOOR_MS = 600;
const MIN_PLAYBACK_CEILING_MS = 12_000;
const FASTEST_PLAUSIBLE_WORDS_PER_SECOND = 6;
const EVIDENCE_VERSION = 2;
const CYCLE_HISTORY_PER_SKILL = 12;
const PHASES = new Set(['baseline_candidate', 'practice', 'matched', 'transfer']);
const RETEST_PHASES = new Set(['matched', 'transfer']);

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function evidenceRef(attemptId) {
  return sha256(attemptId).slice(0, 12);
}

function safeAccountBinding(accountId) {
  const id = String(accountId || '').trim().slice(0, 120);
  return id ? sha256(`listening-account-v2:${id}`) : null;
}

function safeLevelKey(value) {
  return ['A1', 'A2', 'B1', 'B2', 'C1'].includes(value) ? value : 'B1';
}

export function listeningDifficultyContract(skillId, levelKey, baseRate) {
  if (!SKILLS.has(skillId)) return null;
  const level = safeLevelKey(levelKey);
  const rate = Number.isFinite(Number(baseRate)) ? Math.max(0.5, Math.min(1.5, Number(baseRate))) : 1;
  return Object.freeze({
    version: EVIDENCE_VERSION,
    levelKey: level,
    baseRate: Number(rate.toFixed(2)),
    challengeKey: sha256(JSON.stringify({ version: EVIDENCE_VERSION, skillId, level, rate: Number(rate.toFixed(2)) })).slice(0, 16),
  });
}

function fail(code, status = 409) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function finiteTime(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

/**
 * Conservative server-owned lower bound for a real playback. It is intentionally much shorter
 * than natural German speech so normal browser/audio timing jitter cannot reject an honest play,
 * while a same-tick `completed:true` claim can never become listening evidence. The browser never
 * supplies this duration; task issuance derives it from the server-known source text and rate.
 */
export function minimumListeningPlaybackMs(audioText, playbackRate = 1) {
  const words = String(audioText || '').trim().split(/\s+/u).filter(Boolean).length;
  const rate = Number.isFinite(Number(playbackRate))
    ? Math.max(0.5, Math.min(2, Number(playbackRate))) : 1;
  const estimate = words > 0
    ? Math.floor((words / (FASTEST_PLAUSIBLE_WORDS_PER_SECOND * rate)) * 1000)
    : MIN_PLAYBACK_FLOOR_MS;
  return Math.max(MIN_PLAYBACK_FLOOR_MS, Math.min(MIN_PLAYBACK_CEILING_MS, estimate));
}

function minimumPlaybackForItem(item) {
  const stored = Number(item?.minimumPlaybackMs);
  if (Number.isFinite(stored)) {
    return Math.max(MIN_PLAYBACK_FLOOR_MS, Math.min(MIN_PLAYBACK_CEILING_MS, Math.round(stored)));
  }
  // Compatibility for an already-issued task from before the duration contract. It remains usable
  // after one small server-time floor, but can no longer be completed in the same tick.
  return MIN_PLAYBACK_FLOOR_MS;
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
  const evidenceVersion = Number(row.evidenceVersion) === EVIDENCE_VERSION ? EVIDENCE_VERSION : 1;
  const phase = evidenceVersion === EVIDENCE_VERSION && PHASES.has(row.phase) ? row.phase : null;
  const accountBinding = evidenceVersion === EVIDENCE_VERSION && /^[a-f0-9]{64}$/u.test(row.accountBinding || '')
    ? row.accountBinding : null;
  const prescriptionId = evidenceVersion === EVIDENCE_VERSION && /^[a-f0-9]{16}$/u.test(row.prescriptionId || '')
    ? row.prescriptionId : null;
  const packetId = evidenceVersion === EVIDENCE_VERSION && /^[a-f0-9]{16}$/u.test(row.packetId || '')
    ? row.packetId : null;
  const packetIndex = evidenceVersion === EVIDENCE_VERSION && Number.isInteger(row.packetIndex)
    && row.packetIndex >= 0 && row.packetIndex < PACKET_SIZE ? row.packetIndex : null;
  const challengeKey = evidenceVersion === EVIDENCE_VERSION && /^[a-f0-9]{16}$/u.test(row.challengeKey || '')
    ? row.challengeKey : null;
  const levelKey = evidenceVersion === EVIDENCE_VERSION ? safeLevelKey(row.levelKey) : null;
  const baseRate = evidenceVersion === EVIDENCE_VERSION && Number.isFinite(Number(row.baseRate))
    ? Math.max(0.5, Math.min(1.5, Number(row.baseRate))) : null;
  const eligibleAt = evidenceVersion === EVIDENCE_VERSION ? finiteTime(row.eligibleAt) : null;
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
    evidenceVersion, accountBinding, prescriptionId, packetId, packetIndex, phase, challengeKey, levelKey, baseRate,
    eligibleAt,
    issuedAt,
    gradedAt,
  };
}

function activePrescription(profile) {
  const value = profile?.salmaCoach?.activePrescription;
  if (!value || typeof value !== 'object' || !/^[a-f0-9]{16}$/u.test(value.id || '')
    || !SKILLS.has(value.skillId) || value.drillId !== 'hoer-check') return null;
  const cycle = value.listeningCycle;
  if (!cycle || Number(cycle.version) !== EVIDENCE_VERSION
    || !/^[a-f0-9]{64}$/u.test(cycle.accountBinding || '')
    || !/^[a-f0-9]{16}$/u.test(cycle.challengeKey || '')
    || !Array.isArray(cycle.baselineEvidenceIds) || cycle.baselineEvidenceIds.length !== PACKET_SIZE
    || cycle.baselineEvidenceIds.some((id) => !/^[a-f0-9]{12}$/u.test(id))) return null;
  return value;
}

function completedDoseBlocks(profile, prescription) {
  const value = profile?.salmaCoach?.coachState?.completedBlocks?.[prescription?.id];
  return Number.isInteger(value) ? Math.max(0, Math.min(2, value)) : 0;
}

function exactPhasePacket(attempts, prescription, phase, eligibleAt) {
  const cycle = prescription.listeningCycle;
  const packetId = sha256(`listening-packet-v2:${prescription.id}:${phase}:${cycle.challengeKey}`).slice(0, 16);
  const rows = attempts.filter((row) => row.evidenceVersion === EVIDENCE_VERSION
    && row.accountBinding === cycle.accountBinding
    && row.prescriptionId === prescription.id
    && row.skillId === prescription.skillId
    && row.phase === phase
    && row.packetId === packetId
    && row.challengeKey === cycle.challengeKey
    && row.eligibleAt === eligibleAt
    && row.issuedAt >= eligibleAt);
  const byIndex = new Map();
  for (const row of rows) {
    if (row.packetIndex === null || byIndex.has(row.packetIndex)) return { packetId, rows: [], invalid: true };
    byIndex.set(row.packetIndex, row);
  }
  const ordered = Array.from({ length: PACKET_SIZE }, (_, index) => byIndex.get(index)).filter(Boolean);
  if (ordered.length < PACKET_SIZE) return { packetId, rows: ordered, invalid: false };
  if (new Set(ordered.map((row) => row.attemptId)).size !== PACKET_SIZE
    || new Set(ordered.map((row) => row.itemHash)).size !== PACKET_SIZE) return { packetId, rows: [], invalid: true };
  return { packetId, rows: ordered, invalid: false };
}

function ensureAttemptOwner(profile, item) {
  if (Number(item?.evidenceVersion) !== EVIDENCE_VERSION) return;
  const expected = safeAccountBinding(profile?.userId);
  if (!expected || item.accountBinding !== expected) fail('listening_attempt_owner_mismatch', 403);
}

function boundedAttemptsWithActiveCycle(profile, attempts) {
  const prescription = activePrescription(profile);
  if (!prescription) return attempts.slice(-ATTEMPT_LIMIT);
  const cycle = prescription.listeningCycle;
  const baselineRefs = new Set(cycle.baselineEvidenceIds);
  const protectedRows = [];
  const protectedIds = new Set();
  const protect = (row) => {
    if (!row || protectedIds.has(row.attemptId)) return;
    protectedIds.add(row.attemptId);
    protectedRows.push(row);
  };
  for (const row of attempts) {
    if (row.evidenceVersion === EVIDENCE_VERSION
      && row.accountBinding === cycle.accountBinding
      && row.skillId === prescription.skillId
      && row.challengeKey === cycle.challengeKey
      && baselineRefs.has(evidenceRef(row.attemptId))) protect(row);
  }
  for (const phase of RETEST_PHASES) {
    const packetId = sha256(`listening-packet-v2:${prescription.id}:${phase}:${cycle.challengeKey}`).slice(0, 16);
    const phaseRows = attempts.filter((row) => row.evidenceVersion === EVIDENCE_VERSION
      && row.accountBinding === cycle.accountBinding
      && row.prescriptionId === prescription.id
      && row.skillId === prescription.skillId
      && row.challengeKey === cycle.challengeKey
      && row.phase === phase
      && row.packetId === packetId).slice(-PACKET_SIZE);
    phaseRows.forEach(protect);
  }
  const recentCapacity = Math.max(0, ATTEMPT_LIMIT - protectedRows.length);
  const recent = attempts.filter((row) => !protectedIds.has(row.attemptId)).slice(-recentCapacity);
  return [...protectedRows, ...recent]
    .sort((a, b) => a.issuedAt - b.issuedAt || a.gradedAt - b.gradedAt || a.attemptId.localeCompare(b.attemptId));
}

export function beginListeningPlayback(profile, itemId, now = Date.now()) {
  const { item } = activeItem(profile, itemId);
  ensureAttemptOwner(profile, item);
  ensureFresh(item, now);
  if (item.gradeResult) fail('listening_attempt_already_graded');
  const startedAt = finiteTime(item.playStartedAt);
  if (startedAt && !finiteTime(item.playCompletedAt)) {
    if (now - startedAt < STALE_PLAYBACK_MS) fail('listening_playback_in_progress');
    item.playCount = Math.max(0, (Number(item.playCount) || 0) - 1);
    item.playStartedAt = null;
    item.playInstanceId = null;
    item.mediaDeliveredAt = null;
    item.mediaDeliveredPlayInstanceId = null;
  }
  const maxPlays = Math.max(1, Math.min(2, Number(item.maxPlays) || 2));
  const playCount = Math.max(0, Number(item.playCount) || 0);
  if (playCount >= maxPlays) fail('listening_replay_limit');
  item.playCount = playCount + 1;
  item.playStartedAt = now;
  item.playInstanceId = randomBytes(12).toString('hex');
  item.playCompletedAt = null;
  item.mediaDeliveredAt = null;
  item.mediaDeliveredPlayInstanceId = null;
  return { playNumber: item.playCount, maxPlays };
}

export function finishListeningPlayback(profile, itemId, { playNumber, completed = true, now = Date.now() } = {}) {
  const { item } = activeItem(profile, itemId);
  ensureAttemptOwner(profile, item);
  ensureFresh(item, now);
  if (item.gradeResult) return { completed: false, alreadyGraded: true };
  if (!Number.isInteger(playNumber) || playNumber !== item.playCount || !finiteTime(item.playStartedAt)) {
    fail('listening_playback_mismatch');
  }
  if (completed !== true) {
    item.playCount = Math.max(0, item.playCount - 1);
    item.playStartedAt = null;
    item.playInstanceId = null;
    item.playCompletedAt = null;
    item.mediaDeliveredAt = null;
    item.mediaDeliveredPlayInstanceId = null;
    return { completed: false, playNumber };
  }
  if (now < item.playStartedAt) fail('listening_playback_mismatch');
  if (now - item.playStartedAt < minimumPlaybackForItem(item)) {
    fail('listening_playback_too_short');
  }
  if (item.mediaProofRequired === true) {
    const deliveredAt = finiteTime(item.mediaDeliveredAt);
    if (!/^[a-f0-9]{24}$/u.test(item.playInstanceId || '')
      || item.mediaDeliveredPlayInstanceId !== item.playInstanceId
      || !deliveredAt || deliveredAt < item.playStartedAt || deliveredAt > now) {
      fail('listening_media_required');
    }
  }
  item.playCompletedAt = now;
  return { completed: true, playNumber };
}

export function commitListeningGrade(profile, itemId, { correct, now = Date.now() } = {}) {
  const { item } = activeItem(profile, itemId);
  ensureAttemptOwner(profile, item);
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
    evidenceVersion: item.evidenceVersion,
    accountBinding: item.accountBinding,
    prescriptionId: item.prescriptionId,
    packetId: item.packetId,
    packetIndex: item.packetIndex,
    phase: item.phase,
    challengeKey: item.challengeKey,
    levelKey: item.levelKey,
    baseRate: item.baseRate,
    eligibleAt: item.eligibleAt,
    issuedAt: item.issuedAt,
    gradedAt: now,
  });
  if (!evidence) fail('listening_evidence_invalid', 500);
  const existing = Array.isArray(profile.listeningAttempts) ? profile.listeningAttempts.map(safeAttempt).filter(Boolean) : [];
  if (!existing.some((row) => row.attemptId === evidence.attemptId)) existing.push(evidence);
  profile.listeningAttempts = boundedAttemptsWithActiveCycle(profile, existing);
  item.gradeResult = { correct, gradedAt: now, attemptId: item.attemptId };
  return { ...item.gradeResult, replayed: false };
}

export function resolveListeningMedia(profile, itemId, playNumber, now = Date.now()) {
  const { key, item } = activeItem(profile, itemId);
  ensureAttemptOwner(profile, item);
  ensureFresh(item, now);
  if (item.gradeResult || !Number.isInteger(playNumber) || playNumber !== item.playCount
    || !finiteTime(item.playStartedAt) || finiteTime(item.playCompletedAt)) fail('listening_media_not_authorized', 409);
  const text = String(item.ttsText || '').trim().slice(0, 600);
  const voice = typeof item.voice === 'string' ? item.voice.slice(0, 40) : '';
  if (!text || !voice) fail('listening_media_not_found', 404);
  if (item.mediaProofRequired === true && !/^[a-f0-9]{24}$/u.test(item.playInstanceId || '')) {
    fail('listening_media_not_authorized', 409);
  }
  return {
    text,
    voice,
    ...(item.mediaProofRequired === true ? { deliveryRef: {
      itemId: key.slice(0, 120), playNumber, playInstanceId: item.playInstanceId,
    } } : {}),
  };
}

/**
 * Persist only an opaque, bounded receipt that the exact active play's one-use media ticket reached
 * the audio route. No source text, URL, ticket, audio, or response body is stored.
 */
export function markListeningMediaDelivered(profile, {
  itemId, playNumber, playInstanceId, now = Date.now(),
} = {}) {
  const { item } = activeItem(profile, itemId);
  ensureAttemptOwner(profile, item);
  ensureFresh(item, now);
  if (item.mediaProofRequired !== true || item.gradeResult
    || !Number.isInteger(playNumber) || playNumber !== item.playCount
    || !/^[a-f0-9]{24}$/u.test(playInstanceId || '')
    || playInstanceId !== item.playInstanceId
    || !finiteTime(item.playStartedAt) || finiteTime(item.playCompletedAt)) {
    fail('listening_media_not_authorized', 409);
  }
  const existingAt = finiteTime(item.mediaDeliveredAt);
  if (existingAt && item.mediaDeliveredPlayInstanceId === playInstanceId) {
    return { delivered: true, replayed: true };
  }
  if (now < item.playStartedAt) fail('listening_media_not_authorized', 409);
  item.mediaDeliveredAt = now;
  item.mediaDeliveredPlayInstanceId = playInstanceId;
  return { delivered: true, replayed: false };
}

export function listeningEvidence(profile, skillId, { limit = 10 } = {}) {
  if (!SKILLS.has(skillId)) return [];
  const seenAttempts = new Set();
  const seenContent = new Set();
  return (Array.isArray(profile?.listeningAttempts) ? profile.listeningAttempts : [])
    .map(safeAttempt).filter(Boolean)
    .sort((a, b) => a.issuedAt - b.issuedAt || a.gradedAt - b.gradedAt || a.attemptId.localeCompare(b.attemptId))
    .filter((row) => {
      if (row.skillId !== skillId || seenAttempts.has(row.attemptId)) return false;
      if (row.itemHash && seenContent.has(row.itemHash)) return false;
      seenAttempts.add(row.attemptId);
      if (row.itemHash) seenContent.add(row.itemHash);
      return true;
    }).slice(-Math.max(1, Math.min(ATTEMPT_LIMIT, Number(limit) || 10)));
}

export function listeningEvidenceSummary(profile, skillId, { minimumAttempts = 5, limit = 10 } = {}) {
  const attempts = listeningEvidence(profile, skillId, { limit });
  if (attempts.length < minimumAttempts) return null;
  return summarizeAttempts(attempts);
}

function summarizeAttempts(attempts) {
  const correct = attempts.filter((row) => row.correct).length;
  const firstPlayCorrect = attempts.filter((row) => row.correct && row.plays === 1).length;
  const extraReplays = attempts.reduce((sum, row) => sum + Math.max(0, row.plays - 1), 0);
  const latencies = attempts.map((row) => row.responseLatencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(latencies.length / 2);
  const medianLatencyMs = latencies.length
    ? (latencies.length % 2 ? latencies[middle] : Math.round((latencies[middle - 1] + latencies[middle]) / 2)) : null;
  return {
    skillId: attempts[0]?.skillId || null,
    sampleSize: attempts.length,
    accuracy: correct / attempts.length,
    firstPlayAccuracy: firstPlayCorrect / attempts.length,
    replayRate: extraReplays / attempts.length,
    medianLatencyMs,
    measuredAt: attempts.at(-1).gradedAt,
    evidenceIds: attempts.map((row) => row.attemptId),
  };
}

export function listeningBaselineSnapshot(profile, skillId) {
  if (!SKILLS.has(skillId)) return null;
  const accountBinding = safeAccountBinding(profile?.userId);
  if (!accountBinding) return null;
  const candidates = listeningEvidence(profile, skillId, { limit: ATTEMPT_LIMIT })
    .filter((row) => row.evidenceVersion === EVIDENCE_VERSION
      && (row.phase === 'baseline_candidate' || RETEST_PHASES.has(row.phase))
      && row.accountBinding === accountBinding && row.itemHash && row.challengeKey);
  const groups = new Map();
  for (const row of candidates) {
    const group = groups.get(row.challengeKey) || [];
    group.push(row); groups.set(row.challengeKey, group);
  }
  const complete = [...groups.values()].filter((rows) => rows.length >= PACKET_SIZE)
    .map((rows) => rows.slice(-PACKET_SIZE))
    .sort((a, b) => b.at(-1).gradedAt - a.at(-1).gradedAt)[0];
  if (!complete) return null;
  const levelKey = complete[0].levelKey;
  if (!levelKey || complete.some((row) => row.levelKey !== levelKey)) return null;
  const baseRate = Number(complete[0].baseRate);
  if (!Number.isFinite(baseRate) || complete.some((row) => row.baseRate !== baseRate)) return null;
  const summary = summarizeAttempts(complete);
  const baselineEvidenceIds = complete.map((row) => evidenceRef(row.attemptId));
  return {
    version: EVIDENCE_VERSION,
    accountBinding,
    challengeKey: complete[0].challengeKey,
    levelKey,
    baseRate,
    baselineEvidenceIds,
    baselineMeasuredAt: complete.at(-1).gradedAt,
    baseline: { metricKey: 'listening_accuracy', value: Math.round(summary.accuracy * 1000) / 10,
      evidenceId: sha256(JSON.stringify({ skillId, baselineEvidenceIds })).slice(0, 12),
      measuredAt: summary.measuredAt },
    doseCompletedAt: null,
    matchedEligibleAt: null,
  };
}

function normalizedCyclePrescription(profile, supplied) {
  const prescription = supplied || activePrescription(profile);
  if (!prescription || !SKILLS.has(prescription.skillId)) return null;
  const cycle = prescription.listeningCycle;
  const expectedOwner = safeAccountBinding(profile?.userId);
  if (!cycle || Number(cycle.version) !== EVIDENCE_VERSION || cycle.accountBinding !== expectedOwner
    || !/^[a-f0-9]{16}$/u.test(cycle.challengeKey || '')
    || !Array.isArray(cycle.baselineEvidenceIds) || cycle.baselineEvidenceIds.length !== PACKET_SIZE) return null;
  return prescription;
}

export function listeningRetestEvidence(profile, skillId, { prescription: supplied = null } = {}) {
  const prescription = normalizedCyclePrescription(profile, supplied);
  const empty = { phase: 'baseline', outcome: 'pending', nextEligibleAt: null,
    completed: 0, required: PACKET_SIZE, baseline: null, matched: null, transfer: null };
  if (!prescription || prescription.skillId !== skillId) return empty;
  const cycle = prescription.listeningCycle;
  const attempts = listeningEvidence(profile, skillId, { limit: ATTEMPT_LIMIT }).filter((row) => row.itemHash);
  const baselineRows = attempts.filter((row) => cycle.baselineEvidenceIds.includes(evidenceRef(row.attemptId)));
  if (baselineRows.length !== PACKET_SIZE || new Set(baselineRows.map((row) => row.itemHash)).size !== PACKET_SIZE
    || baselineRows.some((row) => row.accountBinding !== cycle.accountBinding
      || row.challengeKey !== cycle.challengeKey
      || (row.phase !== 'baseline_candidate' && !RETEST_PHASES.has(row.phase)))) return empty;
  const baseline = summarizeAttempts(baselineRows);
  const doseCompletedAt = finiteTime(cycle.doseCompletedAt);
  const matchedEligibleAt = finiteTime(cycle.matchedEligibleAt)
    || (doseCompletedAt ? doseCompletedAt + MATCHED_RETEST_DELAY_MS : null);
  if (!matchedEligibleAt) return { ...empty, phase: 'dose', baseline };
  const matchedPacket = exactPhasePacket(attempts, prescription, 'matched', matchedEligibleAt);
  if (matchedPacket.invalid) return { ...empty, phase: 'failed', outcome: 'invalid_packet', baseline };
  if (matchedPacket.rows.length < PACKET_SIZE) return { ...empty, phase: 'matched', baseline,
    nextEligibleAt: matchedEligibleAt, completed: matchedPacket.rows.length };
  const matched = summarizeAttempts(matchedPacket.rows);
  if (!packetPasses(matched, skillId)) return { ...empty, phase: 'failed', outcome: 'threshold_missed', baseline, matched,
    completed: PACKET_SIZE };
  const transferEligibleAt = matched.measuredAt + TRANSFER_RETEST_DELAY_MS;
  const transferPacket = exactPhasePacket(attempts, prescription, 'transfer', transferEligibleAt);
  if (transferPacket.invalid) return { ...empty, phase: 'failed', outcome: 'invalid_packet', baseline, matched };
  const priorContent = new Set([...baselineRows, ...matchedPacket.rows].map((row) => row.itemHash));
  if (transferPacket.rows.some((row) => priorContent.has(row.itemHash))) {
    return { ...empty, phase: 'failed', outcome: 'non_novel_transfer', baseline, matched };
  }
  if (transferPacket.rows.length < PACKET_SIZE) return { ...empty, phase: 'transfer', baseline, matched,
    nextEligibleAt: transferEligibleAt, completed: transferPacket.rows.length };
  const transfer = summarizeAttempts(transferPacket.rows);
  if (!packetPasses(transfer, skillId)) return { ...empty, phase: 'failed', outcome: 'threshold_missed', baseline, matched, transfer,
    completed: PACKET_SIZE };
  return { ...empty, phase: 'complete', outcome: 'passed', baseline, matched, transfer,
    completed: PACKET_SIZE, nextEligibleAt: null };
}

export function listeningIssuanceBinding(profile, skillId, { accountId, levelKey, baseRate, slot = 0, now = Date.now() } = {}) {
  const accountBinding = safeAccountBinding(accountId);
  const challenge = listeningDifficultyContract(skillId, levelKey, baseRate);
  if (!accountBinding || !challenge) return null;
  const prescription = activePrescription(profile);
  const base = { evidenceVersion: EVIDENCE_VERSION, accountBinding, skillId,
    levelKey: challenge.levelKey, baseRate: challenge.baseRate, challengeKey: challenge.challengeKey, eligibleAt: now };
  if (!prescription || prescription.skillId !== skillId || prescription.listeningCycle?.accountBinding !== accountBinding
    || prescription.listeningCycle?.challengeKey !== challenge.challengeKey) {
    return { ...base, phase: 'baseline_candidate', prescriptionId: null,
      packetId: sha256(`baseline:${accountBinding}:${skillId}:${now}`).slice(0, 16), packetIndex: Math.max(0, Math.min(4, slot)) };
  }
  const completed = completedDoseBlocks(profile, prescription);
  const proof = listeningRetestEvidence(profile, skillId, { prescription });
  let phase = 'practice';
  let eligibleAt = now;
  if (completed >= Number(prescription.blocks || 1) && proof.phase === 'matched'
    && Number.isFinite(proof.nextEligibleAt) && now >= proof.nextEligibleAt) {
    phase = 'matched'; eligibleAt = proof.nextEligibleAt;
  } else if (completed >= Number(prescription.blocks || 1) && proof.phase === 'transfer'
    && Number.isFinite(proof.nextEligibleAt) && now >= proof.nextEligibleAt) {
    phase = 'transfer'; eligibleAt = proof.nextEligibleAt;
  }
  if (!RETEST_PHASES.has(phase)) return { ...base, phase, prescriptionId: prescription.id,
    packetId: sha256(`practice:${prescription.id}:${now}`).slice(0, 16), packetIndex: Math.max(0, Math.min(4, slot)) };
  const packetId = sha256(`listening-packet-v2:${prescription.id}:${phase}:${challenge.challengeKey}`).slice(0, 16);
  const used = new Set(listeningEvidence(profile, skillId, { limit: ATTEMPT_LIMIT })
    .filter((row) => row.prescriptionId === prescription.id && row.phase === phase && row.packetId === packetId)
    .map((row) => row.packetIndex).filter((index) => Number.isInteger(index)));
  const available = Array.from({ length: PACKET_SIZE }, (_, index) => index).filter((index) => !used.has(index));
  const packetIndex = available[Math.max(0, Number(slot) || 0)];
  if (!Number.isInteger(packetIndex)) return { ...base, phase: 'practice', prescriptionId: prescription.id,
    packetId: sha256(`overflow:${prescription.id}:${phase}:${now}`).slice(0, 16), packetIndex: Math.min(4, slot) };
  return { ...base, phase, prescriptionId: prescription.id, packetId, packetIndex, eligibleAt };
}

function packetPasses(summary, skillId) {
  if (!summary || summary.accuracy < 0.8 || summary.replayRate > 0.4) return false;
  return skillId !== 'listen-phone' || summary.firstPlayAccuracy >= 0.6;
}

function safeArchivedSummary(value, skillId) {
  if (!value || typeof value !== 'object' || value.skillId !== skillId
    || !Number.isInteger(value.sampleSize) || value.sampleSize !== PACKET_SIZE) return null;
  const bounded = (input) => Number.isFinite(Number(input)) ? Math.max(0, Math.min(1, Number(input))) : null;
  const accuracy = bounded(value.accuracy);
  const firstPlayAccuracy = bounded(value.firstPlayAccuracy);
  const replayRate = bounded(value.replayRate);
  const measuredAt = finiteTime(value.measuredAt);
  if (accuracy === null || firstPlayAccuracy === null || replayRate === null || !measuredAt) return null;
  return { skillId, sampleSize: PACKET_SIZE, accuracy, firstPlayAccuracy, replayRate,
    medianLatencyMs: Number.isFinite(Number(value.medianLatencyMs)) ? Math.max(0, Number(value.medianLatencyMs)) : null,
    measuredAt, evidenceIds: [] };
}

function archivedCycles(profile, skillId) {
  const owner = safeAccountBinding(profile?.userId);
  return (Array.isArray(profile?.listeningCycleHistory) ? profile.listeningCycleHistory : [])
    .filter((row) => row && typeof row === 'object' && row.version === EVIDENCE_VERSION
      && row.accountBinding === owner && row.skillId === skillId
      && /^[a-f0-9]{16}$/u.test(row.id || '') && /^[a-f0-9]{16}$/u.test(row.prescriptionId || '')
      && (row.status === 'passed' || row.status === 'failed') && finiteTime(row.verifiedAt))
    .map((row) => ({ ...row, matched: safeArchivedSummary(row.matched, skillId),
      transfer: safeArchivedSummary(row.transfer, skillId) }))
    .filter((row) => row.matched && (row.status !== 'passed' || row.transfer))
    .sort((a, b) => a.verifiedAt - b.verifiedAt).slice(-12);
}

export function archiveListeningCycle(profile, now = Date.now()) {
  const prescription = activePrescription(profile);
  if (!prescription) return null;
  const proof = listeningRetestEvidence(profile, prescription.skillId, { prescription });
  if (proof.phase !== 'complete' && proof.phase !== 'failed') return null;
  const status = proof.phase === 'complete' ? 'passed' : 'failed';
  const verifiedAt = proof.transfer?.measuredAt || proof.matched?.measuredAt || now;
  const id = sha256(JSON.stringify({ prescriptionId: prescription.id, status, verifiedAt,
    outcome: proof.outcome })).slice(0, 16);
  const row = { version: EVIDENCE_VERSION, id, prescriptionId: prescription.id,
    accountBinding: prescription.listeningCycle.accountBinding, skillId: prescription.skillId,
    challengeKey: prescription.listeningCycle.challengeKey, status, outcome: proof.outcome,
    verifiedAt, matched: safeArchivedSummary(proof.matched, prescription.skillId),
    transfer: safeArchivedSummary(proof.transfer, prescription.skillId) };
  const history = Array.isArray(profile.listeningCycleHistory) ? profile.listeningCycleHistory : [];
  const nextHistory = [...history.filter((item) => item?.id !== id), row];
  profile.listeningCycleHistory = [...SKILLS]
    .flatMap((skillId) => nextHistory.filter((item) => item?.skillId === skillId).slice(-CYCLE_HISTORY_PER_SKILL))
    .sort((a, b) => Number(a?.verifiedAt || 0) - Number(b?.verifiedAt || 0));
  return row;
}

function latestAdjudicatedProof(profile, skillId) {
  const archived = archivedCycles(profile, skillId);
  const prescription = activePrescription(profile);
  if (prescription?.skillId === skillId) {
    const active = listeningRetestEvidence(profile, skillId, { prescription });
    if (active.phase === 'complete' || active.phase === 'failed') {
      archived.push({ status: active.phase === 'complete' ? 'passed' : 'failed', outcome: active.outcome,
        verifiedAt: active.transfer?.measuredAt || active.matched?.measuredAt || 0,
        matched: active.matched, transfer: active.transfer });
    }
  }
  return archived.sort((a, b) => a.verifiedAt - b.verifiedAt).at(-1) || null;
}

export function listeningMasteryEvidence(profile) {
  const clearProof = latestAdjudicatedProof(profile, 'listen-clear');
  const phoneProof = latestAdjudicatedProof(profile, 'listen-phone');
  const clearAdjudicated = !!clearProof;
  const phoneAdjudicated = !!phoneProof;
  const clear = clearProof?.status === 'passed' && packetPasses(clearProof.matched, 'listen-clear')
    && packetPasses(clearProof.transfer, 'listen-clear') ? clearProof.transfer : null;
  const phone = phoneProof?.status === 'passed' && packetPasses(phoneProof.matched, 'listen-phone')
    && packetPasses(phoneProof.transfer, 'listen-phone') ? phoneProof.transfer : null;
  return {
    clear,
    phone,
    clearMeasured: clearAdjudicated,
    phoneMeasured: phoneAdjudicated,
    clearProof,
    phoneProof,
    hasVerifiedAttempts: (Array.isArray(profile?.listeningAttempts) ? profile.listeningAttempts : []).some((row) => safeAttempt(row)),
  };
}
