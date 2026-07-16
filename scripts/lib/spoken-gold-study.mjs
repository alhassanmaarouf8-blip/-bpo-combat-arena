import crypto from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  SPEAKING_MATCHED_RETEST_DELAY_MS,
  SPEAKING_TRANSFER_RETEST_DELAY_MS,
  salmaDrillProtocol,
} from '../../server/salmaCoachCore.js';
import {
  speakingMeasurementForSkill,
  speakingTaskContractForSession,
} from '../../server/scoring/speakingMeasurement.js';
import { validatedTransferProofs } from '../../server/scoring/transferProofs.js';

export const STUDY_SCHEMA_VERSION = 1;
export const STUDY_PROTOCOL_ID = 'clear-request-handling-v1';
export const STUDY_CRITERION_ID = 'handle-clear-request';

const SPLITS = new Set(['owner_smoke', 'calibration', 'development', 'holdout']);
const LEVELS = new Set(['a2', 'b1', 'b2']);
const EVIDENCE_STATES = new Set(['sufficient', 'insufficient', 'conflicting']);
const RETEST_RESULTS = new Set(['pass', 'fail', 'insufficient', 'not_available']);
const APP_DECISIONS = new Set(['selected', 'not_selected', 'abstain']);
const APP_EVIDENCE_QUALITY = new Set(['reliable', 'insufficient', 'conflicting']);
const BOTTLENECKS = new Set([
  'handle-clear-request', 'sie-register', 'deescalate', 'fluency-interrupt',
  'no-freeze-expected', 'pronunciation-phone', 'word-order-sub',
  'dativ-akkusativ', 'konjunktiv-2', 'listen-phone', 'other_observable',
  'none', 'insufficient',
]);
const DRILLS = new Set([
  'druck-leiter', 'srs', 'flow-drill', 'shadowing', 'satzbau-schmiede',
  'sag-es-richtig', 'hoer-check', 'interview',
]);
const PRIVATE_KEY_PATTERN = /(?:transcript|raw|email|phone|name|employer|session(?:id)?|audio(?:data)?|cv|url)/iu;
const ARTIFACT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(?:wav|mp3|m4a|ogg)$/u;
const PROFILE_ARTIFACT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.json$/u;
const OPAQUE_ID_PATTERN = /^[a-zA-Z0-9_-]{3,100}$/u;
const PROFILE_MAX_BYTES = 10 * 1024 * 1024;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FROZEN_DRILL_ID = 'druck-leiter';
const FROZEN_SUCCESS_GATE_ID = 'all_three_ordered_acts';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function assertNoPrivateKeys(value, path = 'input') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEY_PATTERN.test(key)) throw new Error(`${path}.${key} is forbidden private study data`);
    if (child && typeof child === 'object') assertNoPrivateKeys(child, `${path}.${key}`);
  }
}

function assertNoPrototypeKeys(value, sourcePath = 'profile', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error(`${sourcePath} contains a cyclic object graph`);
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) throw new Error(`${sourcePath} contains a forbidden object key`);
    assertNoPrototypeKeys(value[key], `${sourcePath}.${key}`, seen);
  }
  seen.delete(value);
}

function finiteScore(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${label} must be between 0 and 100`);
  return Math.round(value * 10) / 10;
}

function positiveInteger(value, label, max = 100_000) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${label} must be a bounded positive integer`);
  return value;
}

function safeArtifact(value, label, required = true) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || !ARTIFACT_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`${label} must be an opaque relative media filename`);
  }
  return value;
}

function safeProfileArtifact(value, label, required = true) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || !PROFILE_ARTIFACT_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`${label} must be an opaque relative JSON filename`);
  }
  return value;
}

function safeProfileSnapshot(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain one server profile object`);
  }
  assertNoPrototypeKeys(value, label);
  const userId = typeof value.userId === 'string' ? value.userId.trim() : '';
  if (!userId || userId.length > 120) throw new Error(`${label} lacks a bounded immutable account id`);
  return value;
}

function safeDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error(`${label} must be YYYY-MM-DD`);
  return value;
}

function safePrescription(value) {
  exactKeys(value, ['dailyFrequency', 'drillId', 'durationSeconds', 'matchedRetestAfterMinutes',
    'minimumSpacingMinutes', 'novelRetestAfterMinutes', 'repetitions', 'successGateId'], 'App prescription');
  if (!DRILLS.has(value.drillId)) throw new Error('App prescription contains an unknown drill');
  if (!OPAQUE_ID_PATTERN.test(value.successGateId || '')) throw new Error('App prescription success gate must be an opaque enum ID');
  const prescription = {
    drillId: value.drillId,
    repetitions: positiveInteger(value.repetitions, 'repetitions', 100),
    durationSeconds: positiveInteger(value.durationSeconds, 'durationSeconds', 7_200),
    dailyFrequency: positiveInteger(value.dailyFrequency, 'dailyFrequency', 10),
    minimumSpacingMinutes: positiveInteger(value.minimumSpacingMinutes, 'minimumSpacingMinutes', 10_080),
    matchedRetestAfterMinutes: positiveInteger(value.matchedRetestAfterMinutes, 'matchedRetestAfterMinutes', 43_200),
    novelRetestAfterMinutes: positiveInteger(value.novelRetestAfterMinutes, 'novelRetestAfterMinutes', 100_800),
    successGateId: value.successGateId,
  };
  if (prescription.matchedRetestAfterMinutes < prescription.minimumSpacingMinutes
    || prescription.novelRetestAfterMinutes <= prescription.matchedRetestAfterMinutes) {
    throw new Error('Retests must preserve spacing and novel-after-matched ordering');
  }
  return Object.freeze(prescription);
}

function safeAppDecision(value) {
  exactKeys(value, ['criterionId', 'decision', 'decisionBinding', 'evidenceCount', 'evidenceQuality',
    'masteryClaimed', 'observedScore', 'prescription'], 'App decision');
  if (!APP_DECISIONS.has(value.decision) || !APP_EVIDENCE_QUALITY.has(value.evidenceQuality)) {
    throw new Error('App decision contains an unknown state');
  }
  if (!/^[a-f0-9]{64}$/u.test(value.decisionBinding || '')) {
    throw new Error('App decision lacks a derived server-evidence binding');
  }
  const evidenceCount = Number.isInteger(value.evidenceCount) && value.evidenceCount >= 0 && value.evidenceCount <= 20
    ? value.evidenceCount : null;
  if (evidenceCount == null) throw new Error('App evidenceCount must be an integer from 0 to 20');
  const selected = value.decision === 'selected';
  if (selected && (value.criterionId !== STUDY_CRITERION_ID || value.evidenceQuality !== 'reliable'
    || evidenceCount < 2 || !value.prescription)) {
    throw new Error('A selected bottleneck requires two reliable opportunities and a complete prescription');
  }
  if (!selected && (value.criterionId !== null || value.prescription !== null)) {
    throw new Error('Only a selected bottleneck may carry a criterion or prescription');
  }
  if (value.decision === 'abstain' && value.evidenceQuality === 'reliable') {
    throw new Error('Reliable evidence must use selected or not_selected, not abstain');
  }
  if (value.decision !== 'abstain' && value.evidenceQuality !== 'reliable') {
    throw new Error('Insufficient or conflicting app evidence must abstain');
  }
  if (typeof value.masteryClaimed !== 'boolean') throw new Error('masteryClaimed must be boolean');
  if (selected && value.observedScore == null) throw new Error('A selected bottleneck requires an observed score');
  if (!selected && value.observedScore !== null) throw new Error('A non-selected decision cannot carry an observed score');
  return Object.freeze({
    decision: value.decision,
    criterionId: value.criterionId,
    evidenceCount,
    evidenceQuality: value.evidenceQuality,
    observedScore: selected ? finiteScore(value.observedScore, 'observedScore') : null,
    prescription: selected ? safePrescription(value.prescription) : null,
    masteryClaimed: value.masteryClaimed === true,
    decisionBinding: value.decisionBinding,
  });
}

function safeProtocol(value) {
  exactKeys(value, ['archetypeId', 'criterionId', 'evidenceContractVersion', 'failureThreshold',
    'frozenAt', 'minimumReliableOpportunities', 'protocolId', 'stageId'], 'Study protocol');
  if (value.protocolId !== STUDY_PROTOCOL_ID || value.criterionId !== STUDY_CRITERION_ID
    || value.archetypeId !== 'clear_customer_request' || value.stageId !== 'customer_roleplay'
    || value.evidenceContractVersion !== 2 || value.minimumReliableOpportunities !== 2
    || value.failureThreshold !== 75 || Number.isNaN(Date.parse(value.frozenAt))) {
    throw new Error('Study protocol does not match the frozen clear-request contract');
  }
  return Object.freeze({ ...value });
}

function frozenPrescription() {
  const protocol = salmaDrillProtocol(FROZEN_DRILL_ID);
  if (!protocol || protocol.repetitions !== 5 || protocol.durationSeconds !== 600
    || protocol.minimumSpacingMinutes !== 240) {
    throw new Error('Production Salma protocol drifted from the frozen spoken-study prescription');
  }
  return safePrescription({
    drillId: FROZEN_DRILL_ID,
    repetitions: protocol.repetitions,
    durationSeconds: protocol.durationSeconds,
    dailyFrequency: 1,
    minimumSpacingMinutes: protocol.minimumSpacingMinutes,
    matchedRetestAfterMinutes: SPEAKING_MATCHED_RETEST_DELAY_MS / 60_000,
    novelRetestAfterMinutes: SPEAKING_TRANSFER_RETEST_DELAY_MS / 60_000,
    successGateId: FROZEN_SUCCESS_GATE_ID,
  });
}

function chronologicalCustomerServiceSessions(profile) {
  return (Array.isArray(profile?.sessions) ? profile.sessions : [])
    .filter((session) => session?.targetRoleType === 'customer_service'
      && typeof session?.sessionId === 'string' && session.sessionId.trim()
      && typeof session?.scenarioId === 'string' && session.scenarioId.trim())
    .sort((a, b) => Number(a?.date || 0) - Number(b?.date || 0));
}

function sameMeasurement(left, right) {
  return !!left && !!right && left.metricKey === right.metricKey && left.value === right.value
    && left.measuredAt === right.measuredAt && left.evidenceId === right.evidenceId
    && left.sourceSessionId === right.sourceSessionId && left.contextId === right.contextId
    && left.noveltyId === right.noveltyId;
}

function finalEvidenceNow(profile) {
  const sessionDates = (Array.isArray(profile?.sessions) ? profile.sessions : [])
    .map((session) => Number(session?.date) || 0);
  const proofDates = (Array.isArray(profile?.salmaCoach?.coachState?.improvementHistory)
    ? profile.salmaCoach.coachState.improvementHistory : [])
    .map((proof) => Number(proof?.verifiedAt) || 0);
  return Math.max(1, ...sessionDates, ...proofDates);
}

/**
 * Derive the hidden app verdict from the exact persisted server profile. The study operator can
 * choose media filenames and consent metadata, but cannot type a score, diagnosis, dose, or mastery
 * claim. Two baseline opportunities are frozen; corrupted, duplicated, mixed, or untrusted evidence
 * abstains. A mastery flag can only come from the production matched-plus-novel proof validator.
 */
export function deriveSpokenGoldAppDecision(baselineValue, finalValue = null) {
  const baselineProfile = safeProfileSnapshot(baselineValue, 'Baseline profile');
  const finalProfile = finalValue == null ? null : safeProfileSnapshot(finalValue, 'Final profile');
  if (finalProfile && finalProfile.userId !== baselineProfile.userId) {
    throw new Error('Baseline and final profiles must belong to the same immutable account');
  }
  const candidateSessions = chronologicalCustomerServiceSessions(baselineProfile);
  if (candidateSessions.length !== 2) {
    throw new Error('The frozen study requires exactly two customer-service baseline opportunities');
  }
  const distinctSessionIds = new Set(candidateSessions.map((session) => session.sessionId));
  const measurements = candidateSessions.map((session) => {
    const task = speakingTaskContractForSession(session);
    if (!task || task.roleType !== 'customer_service') return null;
    return speakingMeasurementForSkill(baselineProfile, STUDY_CRITERION_ID, { sessionId: session.sessionId });
  });
  const usable = measurements.filter(Boolean);
  const uniqueEvidence = new Set(usable.map((measurement) => measurement.evidenceId));
  const evidenceCount = distinctSessionIds.size === 2 && uniqueEvidence.size === usable.length
    ? usable.length : Math.min(1, uniqueEvidence.size);
  const deficits = usable.map((measurement) => measurement.value < 75);
  const evidenceQuality = evidenceCount < 2 ? 'insufficient'
    : deficits.some(Boolean) && deficits.some((value) => !value) ? 'conflicting' : 'reliable';
  const selected = evidenceQuality === 'reliable' && deficits.every(Boolean);
  const decision = evidenceQuality !== 'reliable' ? 'abstain' : selected ? 'selected' : 'not_selected';
  const prescription = selected ? frozenPrescription() : null;
  const observedScore = selected
    ? Math.round((usable.reduce((sum, measurement) => sum + measurement.value, 0) / usable.length) * 10) / 10
    : null;

  let transferProofs = [];
  if (finalProfile) {
    for (const measurement of usable) {
      const preserved = speakingMeasurementForSkill(finalProfile, STUDY_CRITERION_ID,
        { sessionId: measurement.sourceSessionId });
      if (!sameMeasurement(measurement, preserved)) {
        throw new Error('Final profile does not preserve the bound baseline measurement');
      }
    }
    transferProofs = validatedTransferProofs(finalProfile, finalEvidenceNow(finalProfile))
      .filter((proof) => proof.skillId === STUDY_CRITERION_ID);
  }
  const masteryClaimed = transferProofs.length > 0;
  const decisionBinding = sha256(JSON.stringify({
    schemaVersion: STUDY_SCHEMA_VERSION,
    protocolId: STUDY_PROTOCOL_ID,
    accountBinding: sha256(`${STUDY_PROTOCOL_ID}|${baselineProfile.userId}`),
    evidence: usable.map((measurement) => ({
      evidenceId: measurement.evidenceId,
      value: measurement.value,
      measuredAt: measurement.measuredAt,
      contextId: measurement.contextId,
      noveltyId: measurement.noveltyId,
    })),
    evidenceCount,
    evidenceQuality,
    decision,
    observedScore,
    prescription,
    transferProofs,
  }));
  return safeAppDecision({
    decision,
    criterionId: selected ? STUDY_CRITERION_ID : null,
    evidenceCount,
    evidenceQuality,
    observedScore,
    prescription,
    masteryClaimed,
    decisionBinding,
  });
}

function safeCase(value, participantSplit, accountParticipants, profileSnapshots) {
  exactKeys(value, ['baselineArtifacts', 'baselineProfileArtifact', 'consentAttested', 'consentVersion',
    'captureBindingAttested', 'deleteBy', 'finalProfileArtifact', 'levelBand', 'matchedArtifact',
    'novelArtifact', 'participantId', 'split'], 'Study case');
  if (!OPAQUE_ID_PATTERN.test(value.participantId || '')) throw new Error('participantId must be an opaque identifier');
  if (!SPLITS.has(value.split) || !LEVELS.has(value.levelBand)) throw new Error('Study case has an unknown split or level');
  if (value.consentAttested !== true || value.consentVersion !== 'spoken-gold-v1') {
    throw new Error('Every study case requires explicit versioned consent');
  }
  if (value.captureBindingAttested !== true) {
    throw new Error('Every study case must attest that blinded media matches the exact server snapshots');
  }
  const existingSplit = participantSplit.get(value.participantId);
  if (existingSplit) {
    if (existingSplit !== value.split) throw new Error('A participant cannot cross study splits');
    throw new Error('A participant can appear only once in the frozen criterion study');
  }
  participantSplit.set(value.participantId, value.split);
  if (!Array.isArray(value.baselineArtifacts) || value.baselineArtifacts.length !== 2) {
    throw new Error('Exactly two reliable baseline opportunities are required');
  }
  const artifacts = value.baselineArtifacts.map((item, index) => safeArtifact(item, `baselineArtifacts[${index}]`));
  if (new Set(artifacts).size !== artifacts.length) throw new Error('Baseline artifacts must be unique');
  const baselineProfileArtifact = safeProfileArtifact(value.baselineProfileArtifact, 'baselineProfileArtifact');
  const finalProfileArtifact = safeProfileArtifact(value.finalProfileArtifact, 'finalProfileArtifact', false);
  const baselineProfile = profileSnapshots?.get(baselineProfileArtifact);
  const finalProfile = finalProfileArtifact ? profileSnapshots?.get(finalProfileArtifact) : null;
  if (!baselineProfile || finalProfileArtifact && !finalProfile) {
    throw new Error('Every profile artifact must resolve to a verified private server snapshot');
  }
  const accountHash = sha256(`${STUDY_PROTOCOL_ID}|${baselineProfile.userId}`);
  const existingParticipant = accountParticipants.get(accountHash);
  if (existingParticipant && existingParticipant !== value.participantId) {
    throw new Error('One immutable account cannot represent multiple study participants');
  }
  accountParticipants.set(accountHash, value.participantId);
  if ((value.matchedArtifact || value.novelArtifact) && !finalProfileArtifact) {
    throw new Error('Retest media requires a final server profile snapshot');
  }
  return Object.freeze({
    participantId: value.participantId,
    split: value.split,
    levelBand: value.levelBand,
    consentVersion: value.consentVersion,
    deleteBy: safeDate(value.deleteBy, 'deleteBy'),
    baselineArtifacts: Object.freeze(artifacts),
    matchedArtifact: safeArtifact(value.matchedArtifact, 'matchedArtifact', false),
    novelArtifact: safeArtifact(value.novelArtifact, 'novelArtifact', false),
    appDecision: deriveSpokenGoldAppDecision(baselineProfile, finalProfile),
  });
}

export function buildSpokenGoldStudy(input, { profileSnapshots } = {}) {
  assertNoPrivateKeys(input);
  exactKeys(input, ['cases', 'protocol', 'schemaVersion'], 'Study input');
  if (input.schemaVersion !== STUDY_SCHEMA_VERSION) throw new Error('Unsupported study schema version');
  const protocol = safeProtocol(input.protocol);
  if (!Array.isArray(input.cases) || !input.cases.length) throw new Error('Study input contains no cases');
  const participantSplit = new Map();
  const accountParticipants = new Map();
  const seenArtifacts = new Set();
  if (!(profileSnapshots instanceof Map)) throw new Error('Verified private profile snapshots are required');
  const cases = input.cases.map((item) => safeCase(item, participantSplit, accountParticipants, profileSnapshots));
  const frozenDay = Date.parse(protocol.frozenAt.slice(0, 10));
  for (const item of cases) {
    const retentionDays = (Date.parse(`${item.deleteBy}T00:00:00Z`) - frozenDay) / 86_400_000;
    if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 90) {
      throw new Error('Every media deletion date must be 1-90 days after protocol freeze');
    }
    for (const artifact of [...item.baselineArtifacts, item.matchedArtifact, item.novelArtifact].filter(Boolean)) {
      if (seenArtifacts.has(artifact)) throw new Error('Media artifacts cannot be reused across cases');
      seenArtifacts.add(artifact);
    }
  }
  const items = cases.map((item, index) => {
    const reviewId = `case_${String(index + 1).padStart(3, '0')}_${sha256(`${protocol.protocolId}|${item.participantId}|${index}`).slice(0, 8)}`;
    return { item, reviewId };
  });
  const pack = {
    schemaVersion: STUDY_SCHEMA_VERSION,
    protocol: {
      protocolId: protocol.protocolId,
      criterionId: protocol.criterionId,
      archetypeId: protocol.archetypeId,
      stageId: protocol.stageId,
      failureThreshold: protocol.failureThreshold,
      minimumReliableOpportunities: protocol.minimumReliableOpportunities,
      evidenceContractVersion: protocol.evidenceContractVersion,
      rubric: {
        requiredOrderedActs: ['confirm_or_clarify_request', 'take_ownership_or_action', 'state_concrete_next_step'],
        abstainWhen: ['unreliable_capture', 'interrupted_or_truncated', 'fewer_than_two_opportunities', 'conflicting_evidence'],
      },
    },
    items: items.map(({ item, reviewId }) => ({
      reviewId,
      levelBand: item.levelBand,
      baselineArtifacts: [...item.baselineArtifacts],
      matchedArtifact: item.matchedArtifact,
      novelArtifact: item.novelArtifact,
    })),
  };
  const key = {
    schemaVersion: STUDY_SCHEMA_VERSION,
    protocolId: protocol.protocolId,
    frozenAt: protocol.frozenAt,
    items: items.map(({ item, reviewId }) => ({
      reviewId,
      participantHash: sha256(`${protocol.protocolId}|${item.participantId}`),
      split: item.split,
      deleteBy: item.deleteBy,
      appDecision: item.appDecision,
    })),
  };
  const reviewTemplate = {
    schemaVersion: STUDY_SCHEMA_VERSION,
    reviewerId: '',
    qualificationAttested: false,
    independentReviewAttested: false,
    verdicts: pack.items.map((item) => ({
      reviewId: item.reviewId,
      evidenceState: null,
      topBottleneckId: null,
      acceptableDrillIds: [],
      matchedResult: item.matchedArtifact ? null : 'not_available',
      novelResult: item.novelArtifact ? null : 'not_available',
      reviewerNote: '',
    })),
  };
  return Object.freeze({ pack, key, reviewTemplate });
}

/** Re-derive every hidden app verdict before final scoring; edited packs or keys fail closed. */
export function verifySpokenGoldStudyProvenance(input, profileSnapshots, pack, key) {
  const rebuilt = buildSpokenGoldStudy(input, { profileSnapshots });
  if (!isDeepStrictEqual(pack, rebuilt.pack)) {
    throw new Error('Blinded spoken-study pack does not match the original private evidence manifest');
  }
  if (!isDeepStrictEqual(key, rebuilt.key)) {
    throw new Error('Hidden spoken-study key does not match the re-derived server evidence');
  }
  return Object.freeze({ pack: rebuilt.pack, key: rebuilt.key });
}

function blindIndex(pack) {
  exactKeys(pack, ['items', 'protocol', 'schemaVersion'], 'Blinded study pack');
  if (pack.schemaVersion !== STUDY_SCHEMA_VERSION || pack.protocol?.protocolId !== STUDY_PROTOCOL_ID
    || pack.protocol?.criterionId !== STUDY_CRITERION_ID || !Array.isArray(pack.items)) {
    throw new Error('Blinded study pack does not match the frozen protocol');
  }
  const index = new Map();
  for (const item of pack.items) {
    exactKeys(item, ['baselineArtifacts', 'levelBand', 'matchedArtifact', 'novelArtifact', 'reviewId'], 'Blinded case');
    if (!OPAQUE_ID_PATTERN.test(item.reviewId || '') || index.has(item.reviewId) || !LEVELS.has(item.levelBand)
      || !Array.isArray(item.baselineArtifacts) || item.baselineArtifacts.length !== 2) {
      throw new Error('Blinded study pack contains an invalid or duplicate case');
    }
    item.baselineArtifacts.forEach((artifact, artifactIndex) => safeArtifact(artifact, `baselineArtifacts[${artifactIndex}]`));
    safeArtifact(item.matchedArtifact, 'matchedArtifact', false);
    safeArtifact(item.novelArtifact, 'novelArtifact', false);
    index.set(item.reviewId, item);
  }
  if (!index.size) throw new Error('Blinded study pack contains no cases');
  return index;
}

/** Load private server snapshots without copying their fields into any generated artifact. */
export async function loadStudyProfileSnapshots(input, baseDirectory) {
  assertNoPrivateKeys(input);
  if (!input || typeof input !== 'object' || !Array.isArray(input.cases) || !input.cases.length) {
    throw new Error('Study input contains no cases');
  }
  const artifacts = input.cases.flatMap((item, index) => [
    safeProfileArtifact(item?.baselineProfileArtifact, `cases[${index}].baselineProfileArtifact`),
    safeProfileArtifact(item?.finalProfileArtifact, `cases[${index}].finalProfileArtifact`, false),
  ].filter(Boolean));
  if (new Set(artifacts).size !== artifacts.length) {
    throw new Error('Private profile snapshots cannot be reused across study cases or phases');
  }
  const base = await realpath(path.resolve(baseDirectory));
  const snapshots = new Map();
  for (const artifact of artifacts) {
    const candidate = path.resolve(base, artifact);
    if (path.dirname(candidate) !== base) {
      throw new Error('Private profile snapshots must remain direct children of the study directory');
    }
    const stat = await lstat(candidate).catch(() => null);
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > PROFILE_MAX_BYTES) {
      throw new Error(`Private profile snapshot is missing, linked, or outside the 2B-10MB bound: ${artifact}`);
    }
    if (await realpath(candidate) !== candidate) {
      throw new Error(`Private profile snapshot path is not canonical: ${artifact}`);
    }
    let parsed;
    try {
      parsed = JSON.parse((await readFile(candidate)).toString('utf8'));
    } catch {
      throw new Error(`Private profile snapshot is not valid JSON: ${artifact}`);
    }
    snapshots.set(artifact, safeProfileSnapshot(parsed, `Private profile ${artifact}`));
  }
  return snapshots;
}

function hasExpectedMediaHeader(extension, header) {
  if (extension === '.wav') return header.subarray(0, 4).toString('ascii') === 'RIFF'
    && header.subarray(8, 12).toString('ascii') === 'WAVE';
  if (extension === '.ogg') return header.subarray(0, 4).toString('ascii') === 'OggS';
  if (extension === '.m4a') return header.subarray(4, 8).toString('ascii') === 'ftyp';
  if (extension === '.mp3') return header.subarray(0, 3).toString('ascii') === 'ID3'
    || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
  return false;
}

export async function verifyStudyMediaFiles(pack, baseDirectory) {
  const index = blindIndex(pack);
  const base = await realpath(path.resolve(baseDirectory));
  const artifacts = new Set([...index.values()].flatMap((item) => [
    ...item.baselineArtifacts, item.matchedArtifact, item.novelArtifact,
  ]).filter(Boolean));
  for (const artifact of artifacts) {
    const candidate = path.resolve(base, artifact);
    if (path.dirname(candidate) !== base) throw new Error('Study media must remain direct children of the private study directory');
    const stat = await lstat(candidate).catch(() => null);
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size < 512 || stat.size > 100 * 1024 * 1024) {
      throw new Error(`Study media is missing, linked, or outside the 512B-100MB bound: ${artifact}`);
    }
    if (await realpath(candidate) !== candidate) throw new Error(`Study media path is not canonical: ${artifact}`);
    const handle = await open(candidate, 'r');
    try {
      const header = Buffer.alloc(12);
      await handle.read(header, 0, header.length, 0);
      if (!hasExpectedMediaHeader(path.extname(artifact).toLocaleLowerCase('en-US'), header)) {
        throw new Error(`Study media header does not match its declared format: ${artifact}`);
      }
    } finally {
      await handle.close();
    }
  }
  return Object.freeze({ verifiedFiles: artifacts.size });
}

function safeDrillIds(value) {
  if (!Array.isArray(value) || value.length > DRILLS.size) throw new Error('acceptableDrillIds must be a bounded array');
  const unique = [...new Set(value)];
  if (unique.length !== value.length || unique.some((item) => !DRILLS.has(item))) throw new Error('acceptableDrillIds contains duplicates or unknown drills');
  return unique.sort();
}

export function validateIndependentSpokenReview(pack, review) {
  exactKeys(review, ['independentReviewAttested', 'qualificationAttested', 'reviewerId', 'schemaVersion', 'verdicts'], 'Spoken review');
  if (review.schemaVersion !== STUDY_SCHEMA_VERSION || !OPAQUE_ID_PATTERN.test(review.reviewerId || '')
    || review.qualificationAttested !== true || review.independentReviewAttested !== true
    || !Array.isArray(review.verdicts)) {
    throw new Error('A complete qualified independent spoken review is required');
  }
  const index = blindIndex(pack);
  const verdicts = new Map();
  for (const verdict of review.verdicts) {
    exactKeys(verdict, ['acceptableDrillIds', 'evidenceState', 'matchedResult', 'novelResult',
      'reviewId', 'reviewerNote', 'topBottleneckId'], 'Spoken verdict');
    if (!index.has(verdict.reviewId) || verdicts.has(verdict.reviewId)
      || !EVIDENCE_STATES.has(verdict.evidenceState) || !BOTTLENECKS.has(verdict.topBottleneckId)
      || !RETEST_RESULTS.has(verdict.matchedResult) || !RETEST_RESULTS.has(verdict.novelResult)
      || typeof verdict.reviewerNote !== 'string' || verdict.reviewerNote.length > 500) {
      throw new Error('Spoken verdict is invalid, duplicated, or incomplete');
    }
    const drills = safeDrillIds(verdict.acceptableDrillIds);
    const item = index.get(verdict.reviewId);
    if (verdict.evidenceState === 'sufficient') {
      if (verdict.topBottleneckId === 'insufficient') throw new Error('Sufficient evidence requires a bounded bottleneck verdict');
    } else if (verdict.topBottleneckId !== 'insufficient' || drills.length) {
      throw new Error('Insufficient or conflicting evidence must abstain from bottleneck and drill choice');
    }
    if ((!item.matchedArtifact && verdict.matchedResult !== 'not_available')
      || (item.matchedArtifact && verdict.matchedResult === 'not_available')
      || (!item.novelArtifact && verdict.novelResult !== 'not_available')
      || (item.novelArtifact && verdict.novelResult === 'not_available')) {
      throw new Error('Retest verdict does not match the frozen artifact availability');
    }
    verdicts.set(verdict.reviewId, Object.freeze({ ...verdict, acceptableDrillIds: drills }));
  }
  if (verdicts.size !== index.size) throw new Error(`Spoken review is incomplete: expected ${index.size}, received ${verdicts.size}`);
  return Object.freeze({ reviewerId: review.reviewerId, verdicts, index });
}

function nominalAgreement(valuesA, valuesB) {
  if (!valuesA.length || valuesA.length !== valuesB.length) return null;
  const labels = [...new Set([...valuesA, ...valuesB])];
  const observed = valuesA.reduce((count, value, index) => count + (value === valuesB[index] ? 1 : 0), 0) / valuesA.length;
  const expected = labels.reduce((sum, label) => {
    const pA = valuesA.filter((value) => value === label).length / valuesA.length;
    const pB = valuesB.filter((value) => value === label).length / valuesB.length;
    return sum + (pA * pB);
  }, 0);
  return { n: valuesA.length, observedAgreement: observed, expectedAgreement: expected,
    cohenKappa: expected === 1 ? null : (observed - expected) / (1 - expected) };
}

function verdictFingerprint(verdict) {
  return JSON.stringify({
    evidenceState: verdict.evidenceState,
    topBottleneckId: verdict.topBottleneckId,
    acceptableDrillIds: verdict.acceptableDrillIds,
    matchedResult: verdict.matchedResult,
    novelResult: verdict.novelResult,
  });
}

export function summarizeSpokenInterRater(pack, reviewA, reviewB) {
  const a = validateIndependentSpokenReview(pack, reviewA);
  const b = validateIndependentSpokenReview(pack, reviewB);
  if (a.reviewerId === b.reviewerId) throw new Error('Two distinct independent reviewers are required');
  const ids = [...a.index.keys()];
  const disagreements = ids.filter((reviewId) => verdictFingerprint(a.verdicts.get(reviewId)) !== verdictFingerprint(b.verdicts.get(reviewId)));
  const sufficientIds = ids.filter((reviewId) => a.verdicts.get(reviewId).evidenceState === 'sufficient'
    && b.verdicts.get(reviewId).evidenceState === 'sufficient');
  const matchedIds = ids.filter((reviewId) => a.verdicts.get(reviewId).matchedResult !== 'not_available'
    && b.verdicts.get(reviewId).matchedResult !== 'not_available');
  const novelIds = ids.filter((reviewId) => a.verdicts.get(reviewId).novelResult !== 'not_available'
    && b.verdicts.get(reviewId).novelResult !== 'not_available');
  return Object.freeze({
    reviewed: ids.length,
    agreements: ids.length - disagreements.length,
    disagreements: disagreements.length,
    evidenceState: nominalAgreement(ids.map((id) => a.verdicts.get(id).evidenceState), ids.map((id) => b.verdicts.get(id).evidenceState)),
    topBottleneck: nominalAgreement(sufficientIds.map((id) => a.verdicts.get(id).topBottleneckId), sufficientIds.map((id) => b.verdicts.get(id).topBottleneckId)),
    matchedRetest: nominalAgreement(matchedIds.map((id) => a.verdicts.get(id).matchedResult), matchedIds.map((id) => b.verdicts.get(id).matchedResult)),
    novelRetest: nominalAgreement(novelIds.map((id) => a.verdicts.get(id).novelResult), novelIds.map((id) => b.verdicts.get(id).novelResult)),
    disagreementItems: disagreements.map((reviewId) => ({
      reviewId,
      verdictA: a.verdicts.get(reviewId),
      verdictB: b.verdicts.get(reviewId),
    })),
  });
}

export function createSpokenDisagreementTemplate(pack, reviewA, reviewB) {
  const summary = summarizeSpokenInterRater(pack, reviewA, reviewB);
  const index = blindIndex(pack);
  return {
    schemaVersion: STUDY_SCHEMA_VERSION,
    adjudicatorId: '',
    qualificationAttested: false,
    items: summary.disagreementItems.map((item) => ({
      ...index.get(item.reviewId),
      verdictA: item.verdictA,
      verdictB: item.verdictB,
      finalVerdict: null,
      rationale: '',
    })),
  };
}

function safeFinalVerdict(value, frozenItem) {
  exactKeys(value, ['acceptableDrillIds', 'evidenceState', 'matchedResult', 'novelResult', 'topBottleneckId'], 'Final spoken verdict');
  const pseudoReview = {
    schemaVersion: STUDY_SCHEMA_VERSION,
    reviewerId: 'final_reviewer', qualificationAttested: true, independentReviewAttested: true,
    verdicts: [{ reviewId: frozenItem.reviewId, reviewerNote: '', ...value }],
  };
  const pseudoPack = { schemaVersion: STUDY_SCHEMA_VERSION, protocol: {
    protocolId: STUDY_PROTOCOL_ID, criterionId: STUDY_CRITERION_ID,
  }, items: [frozenItem] };
  return validateIndependentSpokenReview(pseudoPack, pseudoReview).verdicts.get(frozenItem.reviewId);
}

function divide(numerator, denominator) { return denominator ? numerator / denominator : null; }

function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return null;
  const p = successes / total;
  const denominator = 1 + ((z * z) / total);
  const center = (p + ((z * z) / (2 * total))) / denominator;
  const spread = (z * Math.sqrt(((p * (1 - p)) / total) + ((z * z) / (4 * total * total)))) / denominator;
  return { lower: Math.max(0, center - spread), upper: Math.min(1, center + spread) };
}

function proportion(successes, total) {
  return { successes, total, rate: divide(successes, total), wilson95: wilson(successes, total) };
}

function validateKey(pack, key) {
  exactKeys(key, ['frozenAt', 'items', 'protocolId', 'schemaVersion'], 'Hidden study key');
  const packIndex = blindIndex(pack);
  if (key.schemaVersion !== STUDY_SCHEMA_VERSION || key.protocolId !== STUDY_PROTOCOL_ID
    || Number.isNaN(Date.parse(key.frozenAt)) || !Array.isArray(key.items) || key.items.length !== packIndex.size) {
    throw new Error('Hidden study key does not match the frozen protocol');
  }
  const index = new Map();
  const participantSplits = new Map();
  for (const item of key.items) {
    exactKeys(item, ['appDecision', 'deleteBy', 'participantHash', 'reviewId', 'split'], 'Hidden study case');
    if (!packIndex.has(item.reviewId) || index.has(item.reviewId) || !/^[a-f0-9]{64}$/u.test(item.participantHash || '')
      || !SPLITS.has(item.split)) throw new Error('Hidden study case is invalid or duplicated');
    const previous = participantSplits.get(item.participantHash);
    if (previous && previous !== item.split) throw new Error('A participant cannot cross study splits');
    participantSplits.set(item.participantHash, item.split);
    safeDate(item.deleteBy, 'deleteBy');
    index.set(item.reviewId, { ...item, appDecision: safeAppDecision(item.appDecision) });
  }
  if (index.size !== packIndex.size) throw new Error('Hidden study key is incomplete');
  return index;
}

export function finalizeSpokenGoldStudy(pack, key, reviewA, reviewB, resolution) {
  const interRater = summarizeSpokenInterRater(pack, reviewA, reviewB);
  const a = validateIndependentSpokenReview(pack, reviewA);
  const b = validateIndependentSpokenReview(pack, reviewB);
  const hidden = validateKey(pack, key);
  exactKeys(resolution, ['adjudicatorId', 'items', 'qualificationAttested', 'schemaVersion'], 'Spoken adjudication');
  if (resolution.schemaVersion !== STUDY_SCHEMA_VERSION || !OPAQUE_ID_PATTERN.test(resolution.adjudicatorId || '')
    || resolution.qualificationAttested !== true || !Array.isArray(resolution.items)) {
    throw new Error('Qualified final spoken adjudication must be explicitly attested');
  }
  const disagreementIds = new Set(interRater.disagreementItems.map((item) => item.reviewId));
  const resolved = new Map();
  for (const item of resolution.items) {
    exactKeys(item, ['finalVerdict', 'rationale', 'reviewId'], 'Spoken adjudication item');
    if (!disagreementIds.has(item.reviewId) || resolved.has(item.reviewId)
      || typeof item.rationale !== 'string' || !item.rationale.trim() || item.rationale.length > 500) {
      throw new Error('Spoken adjudication item is unexpected, duplicated, or lacks rationale');
    }
    resolved.set(item.reviewId, safeFinalVerdict(item.finalVerdict, a.index.get(item.reviewId)));
  }
  if (resolved.size !== disagreementIds.size) throw new Error(`Spoken adjudication is incomplete: expected ${disagreementIds.size}, received ${resolved.size}`);
  const finalVerdicts = new Map();
  for (const reviewId of a.index.keys()) {
    finalVerdicts.set(reviewId, disagreementIds.has(reviewId) ? resolved.get(reviewId) : a.verdicts.get(reviewId));
  }
  const evaluable = [...hidden.entries()].filter(([, item]) => item.split !== 'owner_smoke');
  const smoke = [...hidden.values()].filter((item) => item.split === 'owner_smoke');
  let abstentionCorrect = 0; let abstentionTotal = 0;
  let bottleneckCorrect = 0; let bottleneckTotal = 0;
  let prescriptionCorrect = 0; let prescriptionTotal = 0;
  const harmfulMisdirectionCases = new Set(); let invalidMasteryClaimCount = 0;
  let matchedPass = 0; let matchedTotal = 0; let novelPass = 0; let novelTotal = 0;
  for (const [reviewId, item] of evaluable) {
    const truth = finalVerdicts.get(reviewId);
    const app = item.appDecision;
    if (truth.evidenceState !== 'sufficient') {
      abstentionTotal += 1;
      if (app.decision === 'abstain') abstentionCorrect += 1;
      else harmfulMisdirectionCases.add(reviewId);
    } else {
      if (truth.topBottleneckId !== 'none') {
        bottleneckTotal += 1;
        if (app.decision === 'selected' && app.criterionId === truth.topBottleneckId) bottleneckCorrect += 1;
        else if (app.decision === 'selected') harmfulMisdirectionCases.add(reviewId);
      }
      if (app.decision === 'selected') {
        prescriptionTotal += 1;
        if (truth.acceptableDrillIds.includes(app.prescription.drillId)) prescriptionCorrect += 1;
        else harmfulMisdirectionCases.add(reviewId);
      }
    }
    if (truth.matchedResult !== 'not_available' && truth.matchedResult !== 'insufficient') {
      matchedTotal += 1;
      if (truth.matchedResult === 'pass') matchedPass += 1;
    }
    if (truth.novelResult !== 'not_available' && truth.novelResult !== 'insufficient') {
      novelTotal += 1;
      if (truth.novelResult === 'pass') novelPass += 1;
    }
    if (app.masteryClaimed && !(truth.matchedResult === 'pass' && truth.novelResult === 'pass')) invalidMasteryClaimCount += 1;
  }
  const participantCount = new Set(evaluable.map(([, item]) => item.participantHash)).size;
  const packIndex = blindIndex(pack);
  const splitCounts = Object.fromEntries([...SPLITS].map((split) => [split,
    new Set([...hidden.values()].filter((item) => item.split === split).map((item) => item.participantHash)).size]));
  const levelCounts = Object.fromEntries([...LEVELS].map((levelBand) => [levelBand,
    new Set(evaluable.filter(([reviewId]) => packIndex.get(reviewId).levelBand === levelBand)
      .map(([, item]) => item.participantHash)).size]));
  const harmfulMisdirectionCount = harmfulMisdirectionCases.size;
  const correctAbstention = proportion(abstentionCorrect, abstentionTotal);
  const bottleneckAgreement = proportion(bottleneckCorrect, bottleneckTotal);
  const prescriptionAgreement = proportion(prescriptionCorrect, prescriptionTotal);
  const betaGates = {
    atLeastFiveTargetParticipants: participantCount >= 5,
    frozenParticipantSplitComplete: splitCounts.calibration >= 3
      && splitCounts.development >= 1 && splitCounts.holdout >= 1,
    correctAbstentionAtLeast95: correctAbstention.rate !== null && correctAbstention.rate >= 0.95,
    bottleneckAgreementAtLeast80: bottleneckAgreement.rate !== null && bottleneckAgreement.rate >= 0.8,
    prescriptionAgreementAtLeast80: prescriptionAgreement.rate !== null && prescriptionAgreement.rate >= 0.8,
    zeroHarmfulMisdirection: harmfulMisdirectionCount === 0,
    zeroInvalidMasteryClaims: invalidMasteryClaimCount === 0,
  };
  return Object.freeze({
    schemaVersion: STUDY_SCHEMA_VERSION,
    status: Object.values(betaGates).every(Boolean) ? 'beta-gates-measured-and-passed' : 'beta-gates-not-yet-passed',
    protocolId: STUDY_PROTOCOL_ID,
    criterionId: STUDY_CRITERION_ID,
    modality: 'server_recorded_spoken',
    archetypeId: 'clear_customer_request',
    stageId: 'customer_roleplay',
    containsRawAudioOrTranscript: false,
    reviewerIdentityStored: false,
    interRater: Object.fromEntries(Object.entries(interRater).filter(([keyName]) => keyName !== 'disagreementItems')),
    appComparison: {
      targetParticipantCount: participantCount,
      splitParticipantCounts: splitCounts,
      levelParticipantCounts: levelCounts,
      correctAbstention,
      bottleneckAgreement,
      prescriptionAgreement,
      harmfulMisdirectionCount,
      invalidMasteryClaimCount,
      matchedTransfer: proportion(matchedPass, matchedTotal),
      novelTransfer: proportion(novelPass, novelTotal),
    },
    ownerSmoke: { caseCount: smoke.length, excludedFromAccuracyClaims: true },
    betaGates,
  });
}

export default {
  buildSpokenGoldStudy, deriveSpokenGoldAppDecision, loadStudyProfileSnapshots,
  verifySpokenGoldStudyProvenance,
  validateIndependentSpokenReview, summarizeSpokenInterRater,
  createSpokenDisagreementTemplate, finalizeSpokenGoldStudy, verifyStudyMediaFiles,
};
