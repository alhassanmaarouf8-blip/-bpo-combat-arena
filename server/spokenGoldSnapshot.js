/**
 * Build the smallest private server snapshot needed by the frozen spoken gold study.
 *
 * This deliberately excludes account/contact data, push subscriptions, free-form feedback,
 * vacancy data, payment state and every unrelated profile field. The study derivation reads only
 * immutable account identity, bounded server-recorded session evidence and Salma's bounded
 * transfer-proof state.
 */

const SESSION_KEYS = Object.freeze([
  'date',
  'sessionId',
  'level',
  'bossId',
  'targetRoleType',
  'scenarioId',
  'targetIndustry',
  'vacancyTargetId',
  'speakingTaskContract',
  'evidenceQuality',
  'wpm',
  'giveUpRate',
  'intelligibility',
  'deescalationEvidence',
  'entryInteractionEvidence',
  'grammarMeasured',
  'grammarRules',
]);

const LISTENING_ATTEMPT_KEYS = Object.freeze([
  'attemptId', 'itemHash', 'skillId', 'kind', 'type', 'correct', 'plays', 'playbackRate',
  'responseLatencyMs', 'evidenceVersion', 'accountBinding', 'prescriptionId', 'packetId',
  'packetIndex', 'phase', 'challengeKey', 'levelKey', 'baseRate', 'eligibleAt', 'issuedAt', 'gradedAt',
]);

const LISTENING_CYCLE_KEYS = Object.freeze([
  'version', 'id', 'prescriptionId', 'accountBinding', 'skillId', 'challengeKey', 'status',
  'outcome', 'verifiedAt', 'matched', 'transfer',
]);
const LISTENING_SUMMARY_KEYS = Object.freeze([
  'skillId', 'sampleSize', 'accuracy', 'firstPlayAccuracy', 'replayRate', 'medianLatencyMs', 'measuredAt', 'evidenceIds',
]);
const PRESCRIPTION_KEYS = Object.freeze([
  'id', 'evidenceIds', 'skillId', 'drillId', 'blocks', 'repetitions', 'durationSeconds', 'timesPerDay',
  'minimumSpacingMinutes', 'successGate', 'assignedAt', 'nextEligibleAt', 'listeningCycle',
]);
const PRESCRIPTION_CYCLE_KEYS = Object.freeze([
  'version', 'accountBinding', 'challengeKey', 'levelKey', 'baseRate', 'baselineEvidenceIds',
  'baselineMeasuredAt', 'doseCompletedAt', 'matchedEligibleAt',
]);
const PROOF_KEYS = Object.freeze([
  'id', 'prescriptionId', 'skillId', 'metricKey', 'before', 'after', 'phase', 'status', 'verifiedAt',
  'measuredAt', 'measurementEvidenceId', 'retestSessionId', 'baselineSessionId',
  'baselineMeasurementEvidenceId', 'comparedValue', 'comparedMeasurementEvidenceId',
  'comparedRetestSessionId', 'comparedProofId', 'contextId', 'noveltyId', 'comparedContextId', 'comparedNoveltyId',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedAccountId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 120) throw new Error('Profile lacks a bounded immutable account id');
  return id;
}

function projectSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const projected = {};
  for (const key of SESSION_KEYS) {
    if (Object.hasOwn(value, key)) projected[key] = value[key];
  }
  return projected;
}

function project(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function projectListeningCycle(value) {
  const row = project(value, LISTENING_CYCLE_KEYS);
  if (!row) return null;
  if (row.matched) row.matched = project(row.matched, LISTENING_SUMMARY_KEYS);
  if (row.transfer) row.transfer = project(row.transfer, LISTENING_SUMMARY_KEYS);
  return row;
}

function projectSalmaCoach(value) {
  const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const activePrescription = project(state.activePrescription, PRESCRIPTION_KEYS);
  if (activePrescription?.listeningCycle) {
    activePrescription.listeningCycle = project(activePrescription.listeningCycle, PRESCRIPTION_CYCLE_KEYS);
  }
  const improvementHistory = Array.isArray(state.coachState?.improvementHistory)
    ? state.coachState.improvementHistory.map((row) => project(row, PROOF_KEYS)).filter(Boolean)
    : [];
  return { version: Number.isInteger(state.version) ? state.version : 3,
    activePrescription, coachState: { improvementHistory } };
}

export function buildSpokenGoldProfileSnapshot(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('Profile must be an object');
  }
  const sessions = Array.isArray(profile.sessions)
    ? profile.sessions.map(projectSession).filter(Boolean)
    : [];
  const salmaCoach = projectSalmaCoach(profile.salmaCoach);
  const listeningAttempts = Array.isArray(profile.listeningAttempts)
    ? profile.listeningAttempts.map((row) => project(row, LISTENING_ATTEMPT_KEYS)).filter(Boolean)
    : [];
  const listeningCycleHistory = Array.isArray(profile.listeningCycleHistory)
    ? profile.listeningCycleHistory.map(projectListeningCycle).filter(Boolean)
    : [];
  return cloneJson({
    userId: boundedAccountId(profile.userId),
    sessions,
    listeningAttempts,
    listeningCycleHistory,
    salmaCoach,
  });
}

export default { buildSpokenGoldProfileSnapshot };
