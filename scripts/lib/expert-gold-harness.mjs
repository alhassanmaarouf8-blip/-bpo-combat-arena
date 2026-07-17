import crypto from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { listeningBaselineSnapshot, listeningMasteryEvidence } from '../../server/listeningEvidence.js';
import { salmaDrillProtocol } from '../../server/salmaCoachCore.js';
import { reliableSpeakingSessions, speakingMeasurementForSkill } from '../../server/scoring/speakingMeasurement.js';
import { validatedTransferProofs } from '../../server/scoring/transferProofs.js';

export const EXPERT_GOLD_SCHEMA_VERSION = 2;
const SPLITS = new Set(['owner_smoke', 'synthetic_smoke', 'calibration', 'development', 'holdout']);
const LEVELS = new Set(['a2', 'b1', 'b2', 'pseudo_c1']);
const EVIDENCE_STATES = new Set(['sufficient', 'insufficient', 'conflicting']);
const RETEST_RESULTS = new Set(['pass', 'fail', 'insufficient', 'not_available']);
const DOSE_RESULTS = new Set(['appropriate', 'too_weak', 'too_heavy', 'unsupported', 'not_available']);
const SALMA_RESULTS = new Set(['grounded', 'partially_grounded', 'misleading', 'unavailable']);
const APP_DECISIONS = new Set(['selected', 'not_selected', 'abstain']);
const DRILLS = new Set(['druck-leiter', 'srs', 'flow-drill', 'shadowing', 'satzbau-schmiede',
  'sag-es-richtig', 'hoer-check', 'interview']);
const BOTTLENECKS = new Set(['handle-clear-request', 'sie-register', 'deescalate', 'fluency-interrupt',
  'no-freeze-expected', 'pronunciation-phone', 'word-order-sub', 'dativ-akkusativ', 'konjunktiv-2',
  'listen-clear', 'listen-phone', 'other_observable', 'none', 'insufficient']);
const SCALE_IDS = Object.freeze(['comprehensibility', 'grammar_control', 'fluency', 'lexical_range',
  'task_fulfillment', 'register', 'interaction_handling']);
const PRIVATE_KEY_PATTERN = /(?:transcript|raw|email|phone|name|employer|session(?:id)?|audio(?:data)?|cv|url)/iu;
const MEDIA_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(?:wav|mp3|m4a|ogg)$/u;
const COACH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.txt$/u;
const PROFILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.json$/u;
const OPAQUE_ID = /^[a-zA-Z0-9_-]{3,100}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

const ANALYTIC_ANCHORS = Object.freeze({
  0: 'No usable observable performance for this scale despite otherwise sufficient evidence.',
  1: 'Frequent breakdowns materially obstruct the task or require repeated repair.',
  2: 'Functional in simple moments but inconsistent, effortful, or fragile under the frozen task pressure.',
  3: 'Consistently functional and clear for the frozen task with only minor non-blocking lapses.',
  4: 'Robust, precise, and independently sustained on both expected and pressured material.',
});
const ABSTENTION_CONDITIONS = Object.freeze(['too_few_bound_opportunities', 'unreliable_or_interrupted_capture',
  'wrong_modality', 'duplicate_or_reused_evidence', 'conflicting_reliable_opportunities', 'stale_or_unbound_evidence']);
const EVIDENCE_ANCHORS = Object.freeze({
  sufficient: 'All frozen opportunities are independent, bound, usable, and support an observable judgment.',
  insufficient: 'The frozen opportunity count, modality, capture quality, or binding is inadequate.',
  conflicting: 'Reliable opportunities point in materially different directions; abstain rather than average them away.',
});
const JUDGMENT_ANCHORS = Object.freeze({
  dose: Object.freeze({ appropriate: 'Exact dose is proportionate to the observed bottleneck and evidence strength.',
    too_weak: 'Dose is unlikely to create enough correct productions.', too_heavy: 'Dose adds unjustified burden.',
    unsupported: 'Evidence does not justify this dose.', not_available: 'No dose may be judged.' }),
  salma: Object.freeze({ grounded: 'Every claim and action follows from visible frozen evidence.',
    partially_grounded: 'Useful core, but at least one detail exceeds the evidence.',
    misleading: 'Could send the learner toward a wrong bottleneck, drill, dose, or mastery belief.',
    unavailable: 'No Salma artifact is present.' }),
  transfer: Object.freeze({ pass: 'Meets the frozen gate on independent material.', fail: 'Usable evidence misses the gate.',
    insufficient: 'Retest evidence cannot support a judgment.', not_available: 'No retest artifact is present.' }),
});

function protocol({ protocolId, criterionId, skillId, modality = 'spoken', roleType = 'customer_service',
  stageId, threshold, direction = 'higher', requiredOpportunities = 2, validDrills, scaleIds, successGateId }) {
  const dose = salmaDrillProtocol(validDrills[0]);
  if (!dose) throw new Error(`Protocol ${protocolId} references an unknown production drill`);
  return Object.freeze({ schemaVersion: EXPERT_GOLD_SCHEMA_VERSION, protocolId, criterionId, skillId,
    modality, roleType, stageId, threshold, direction, requiredOpportunities,
    eligibleLevels: Object.freeze(['a2', 'b1', 'b2', 'pseudo_c1']),
    validDrills: Object.freeze([...validDrills]), scaleIds: Object.freeze([...scaleIds]), successGateId,
    rubricVersion: 'expert-gold-analytic-v1', analyticAnchors: ANALYTIC_ANCHORS,
    evidenceAnchors: EVIDENCE_ANCHORS, judgmentAnchors: JUDGMENT_ANCHORS,
    validAbstentionConditions: ABSTENTION_CONDITIONS,
    retestRequirements: Object.freeze({ matched: 'same_skill_new_bound_content',
      novelPressure: 'same_skill_new_context_and_pressure', masteryRequiresBoth: true }),
    dose: Object.freeze({ repetitions: dose.repetitions, durationSeconds: dose.durationSeconds,
      minimumSpacingMinutes: dose.minimumSpacingMinutes }) });
}

const SPEAKING_SCALES = SCALE_IDS;
const LISTENING_SCALES = ['comprehensibility', 'task_fulfillment'];
const PROTOCOL_LIST = [
  protocol({ protocolId: 'clear-request-handling-v1', criterionId: 'handle-clear-request', skillId: 'handle-clear-request',
    stageId: 'customer_roleplay', threshold: 75, validDrills: ['druck-leiter'], scaleIds: SPEAKING_SCALES,
    successGateId: 'all_three_ordered_acts' }),
  protocol({ protocolId: 'service-recovery-v1', criterionId: 'service_recovery_structure', skillId: 'deescalate',
    stageId: 'customer_roleplay', threshold: 67, validDrills: ['druck-leiter'], scaleIds: SPEAKING_SCALES,
    successGateId: 'recovery_structure_complete' }),
  protocol({ protocolId: 'professional-register-v1', criterionId: 'formal_register', skillId: 'sie-register',
    stageId: 'customer_roleplay', threshold: 75, validDrills: ['srs'], scaleIds: SPEAKING_SCALES,
    successGateId: 'formal_register_consistent' }),
  protocol({ protocolId: 'response-continuity-v1', criterionId: 'complete_response', skillId: 'no-freeze-expected',
    stageId: 'pressure_followup', threshold: 80, validDrills: ['druck-leiter'], scaleIds: SPEAKING_SCALES,
    successGateId: 'complete_response_under_pressure' }),
  protocol({ protocolId: 'sustained-pace-v1', criterionId: 'sustained_pace', skillId: 'fluency-interrupt',
    stageId: 'spoken_interview', threshold: 90, validDrills: ['flow-drill'], scaleIds: SPEAKING_SCALES,
    successGateId: 'complete_90_60_45_set' }),
  protocol({ protocolId: 'phone-intelligibility-v1', criterionId: 'speech_recognition_proxy', skillId: 'pronunciation-phone',
    stageId: 'phone_roleplay', threshold: 80, validDrills: ['shadowing'], scaleIds: SPEAKING_SCALES,
    successGateId: 'intelligible_new_phone_content' }),
  protocol({ protocolId: 'grammar-word-order-v1', criterionId: 'grammar_control', skillId: 'word-order-sub',
    stageId: 'spoken_interview', threshold: 8, direction: 'lower', validDrills: ['satzbau-schmiede'],
    scaleIds: SPEAKING_SCALES, successGateId: 'two_separated_correct_productions' }),
  protocol({ protocolId: 'grammar-case-v1', criterionId: 'grammar_control', skillId: 'dativ-akkusativ',
    stageId: 'spoken_interview', threshold: 8, direction: 'lower', validDrills: ['sag-es-richtig'],
    scaleIds: SPEAKING_SCALES, successGateId: 'two_separated_correct_productions' }),
  protocol({ protocolId: 'grammar-konjunktiv-v1', criterionId: 'grammar_control', skillId: 'konjunktiv-2',
    stageId: 'spoken_interview', threshold: 8, direction: 'lower', validDrills: ['sag-es-richtig'],
    scaleIds: SPEAKING_SCALES, successGateId: 'two_separated_correct_productions' }),
  protocol({ protocolId: 'listening-clear-v1', criterionId: 'listening_clear', skillId: 'listen-clear', modality: 'listening',
    stageId: 'listening_packet', threshold: 80, requiredOpportunities: 5, validDrills: ['hoer-check'],
    scaleIds: LISTENING_SCALES, successGateId: 'four_of_five_with_replay_limit' }),
  protocol({ protocolId: 'listening-phone-v1', criterionId: 'listening_phone', skillId: 'listen-phone', modality: 'listening',
    stageId: 'phone_listening_packet', threshold: 80, requiredOpportunities: 5, validDrills: ['hoer-check'],
    scaleIds: LISTENING_SCALES, successGateId: 'four_of_five_and_three_first_play' }),
];

export const EXPERT_GOLD_PROTOCOLS = Object.freeze(Object.fromEntries(PROTOCOL_LIST.map((item) => [item.protocolId, item])));
export function expertGoldProtocol(protocolId) { return Object.hasOwn(EXPERT_GOLD_PROTOCOLS, protocolId)
  ? EXPERT_GOLD_PROTOCOLS[protocolId] : null; }

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}
function noPrivateKeys(value, at = 'input') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEY_PATTERN.test(key)) throw new Error(`${at}.${key} is forbidden private study data`);
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`${at}.${key} is a forbidden object key`);
    noPrivateKeys(child, `${at}.${key}`);
  }
}
function noPrototypeKeys(value, at = 'artifact') {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`${at}.${key} is a forbidden object key`);
    noPrototypeKeys(value[key], `${at}.${key}`);
  }
}
function finiteScore(value, label, max = 100) {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`${label} must be between 0 and ${max}`);
  return Math.round(value * 10) / 10;
}
function safeDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error(`${label} must be YYYY-MM-DD`);
  return value;
}
function safeArtifact(value, pattern, label, required = true) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || !pattern.test(value) || value.includes('..')) throw new Error(`${label} is not a safe opaque artifact`);
  return value;
}

function profileId(profile, label) {
  const id = typeof profile?.userId === 'string' ? profile.userId.trim() : '';
  if (!id || id.length > 120) throw new Error(`${label} lacks a bounded immutable account id`);
  return id;
}
function activePrescription(profile, skillId) {
  const value = profile?.salmaCoach?.activePrescription;
  if (!value || value.skillId !== skillId || !DRILLS.has(value.drillId)) return null;
  const ints = ['repetitions', 'durationSeconds', 'minimumSpacingMinutes'];
  if (ints.some((key) => !Number.isInteger(value[key]) || value[key] < 1)) return null;
  return { drillId: value.drillId, repetitions: value.repetitions, durationSeconds: value.durationSeconds,
    minimumSpacingMinutes: value.minimumSpacingMinutes, successGateId: String(value.successGate || '').slice(0, 120) || null };
}
function failed(protocol, value) { return protocol.direction === 'lower' ? value > protocol.threshold : value < protocol.threshold; }

export function deriveExpertGoldAppDecision(protocolId, baselineProfile, finalProfile = null, { asOf = Date.now() } = {}) {
  const protocol = expertGoldProtocol(protocolId);
  if (!protocol) throw new Error('Unknown expert-gold protocol');
  const owner = profileId(baselineProfile, 'Baseline profile');
  if (finalProfile && profileId(finalProfile, 'Final profile') !== owner) throw new Error('Baseline and final profiles must belong to one account');
  let measurements = [];
  if (protocol.modality === 'spoken') {
    const eligible = reliableSpeakingSessions(baselineProfile).filter((session) => session?.targetRoleType === protocol.roleType);
    measurements = eligible.map((session) => speakingMeasurementForSkill(baselineProfile, protocol.skillId,
      { sessionId: session.sessionId })).filter(Boolean);
  } else {
    const baseline = listeningBaselineSnapshot(baselineProfile, protocol.skillId);
    if (baseline?.baseline) measurements = [baseline.baseline];
  }
  const uniqueEvidence = new Set(measurements.map((item) => item.evidenceId));
  const required = protocol.modality === 'spoken' ? protocol.requiredOpportunities : 1;
  const evidenceCount = uniqueEvidence.size === measurements.length ? measurements.length : 0;
  const deficits = measurements.map((item) => failed(protocol, item.value));
  const evidenceQuality = evidenceCount !== required ? 'insufficient'
    : deficits.some(Boolean) && deficits.some((item) => !item) ? 'conflicting' : 'reliable';
  const decision = evidenceQuality !== 'reliable' ? 'abstain' : deficits.every(Boolean) ? 'selected' : 'not_selected';
  const prescription = decision === 'selected' ? activePrescription(baselineProfile, protocol.skillId) : null;
  let masteryClaimed = false;
  if (finalProfile && protocol.modality === 'spoken') {
    masteryClaimed = validatedTransferProofs(finalProfile, asOf).some((proof) => proof.skillId === protocol.skillId);
  } else if (finalProfile && protocol.modality === 'listening') {
    const mastery = listeningMasteryEvidence(finalProfile);
    masteryClaimed = protocol.skillId === 'listen-clear' ? !!mastery.clear : !!mastery.phone;
  }
  const observedScore = measurements.length
    ? Math.round((measurements.reduce((sum, item) => sum + item.value, 0) / measurements.length) * 10) / 10 : null;
  const decisionBinding = sha256(JSON.stringify({ schemaVersion: EXPERT_GOLD_SCHEMA_VERSION, protocolId,
    owner: sha256(`expert-gold:${owner}`), evidence: [...uniqueEvidence].sort(), decision, prescription, masteryClaimed }));
  return Object.freeze({ decision, criterionId: decision === 'selected' ? protocol.skillId : null,
    evidenceCount, evidenceQuality, observedScore, prescription, masteryClaimed, decisionBinding });
}

async function loadJsonArtifact(base, artifact, label) {
  const candidate = path.resolve(base, artifact);
  if (path.dirname(candidate) !== base) throw new Error(`${label} must be a direct child of the study directory`);
  const stat = await lstat(candidate).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 10 * 1024 * 1024
    || await realpath(candidate) !== candidate) throw new Error(`${label} is missing, linked, oversized, or non-canonical`);
  let parsed;
  try { parsed = JSON.parse(await readFile(candidate, 'utf8')); } catch { throw new Error(`${label} is not valid JSON`); }
  noPrototypeKeys(parsed, label);
  profileId(parsed, label);
  return parsed;
}

export async function loadExpertGoldProfiles(input, baseDirectory) {
  const base = await realpath(path.resolve(baseDirectory));
  const artifacts = new Set();
  for (const [index, item] of input.cases.entries()) {
    artifacts.add(safeArtifact(item.baselineProfileArtifact, PROFILE_PATTERN, `cases[${index}].baselineProfileArtifact`));
    if (item.finalProfileArtifact) artifacts.add(safeArtifact(item.finalProfileArtifact, PROFILE_PATTERN, `cases[${index}].finalProfileArtifact`));
  }
  const profiles = new Map();
  for (const artifact of artifacts) profiles.set(artifact, await loadJsonArtifact(base, artifact, `Profile ${artifact}`));
  return profiles;
}

function safeCase(value, profiles, participantSplits, participantAccounts, accountOwners, seenArtifacts, frozenAt) {
  exactKeys(value, ['baselineArtifacts', 'baselineProfileArtifact', 'captureBindingAttested', 'consentAttested',
    'consentVersion', 'deleteBy', 'finalProfileArtifact', 'levelBand', 'matchedArtifact', 'novelArtifact',
    'participantId', 'protocolId', 'salmaArtifact', 'split'], 'Expert-gold case');
  const protocol = expertGoldProtocol(value.protocolId);
  if (!protocol || !OPAQUE_ID.test(value.participantId || '') || !SPLITS.has(value.split) || !LEVELS.has(value.levelBand)) {
    throw new Error('Expert-gold case has an unknown protocol, participant, split, or level');
  }
  if (value.consentAttested !== true || value.consentVersion !== 'expert-gold-v2' || value.captureBindingAttested !== true) {
    throw new Error('Every expert-gold case requires versioned consent and capture binding');
  }
  const previousSplit = participantSplits.get(value.participantId);
  if (previousSplit && previousSplit !== value.split) throw new Error('A participant cannot cross study splits');
  participantSplits.set(value.participantId, value.split);
  const baselineArtifacts = Array.isArray(value.baselineArtifacts) ? value.baselineArtifacts.map((item, index) =>
    safeArtifact(item, MEDIA_PATTERN, `baselineArtifacts[${index}]`)) : [];
  if (baselineArtifacts.length !== (protocol.modality === 'spoken' ? protocol.requiredOpportunities : 1)) {
    throw new Error(`Protocol ${protocol.protocolId} requires ${protocol.modality === 'spoken' ? protocol.requiredOpportunities : 1} baseline artifact(s)`);
  }
  const matchedArtifact = safeArtifact(value.matchedArtifact, MEDIA_PATTERN, 'matchedArtifact', false);
  const novelArtifact = safeArtifact(value.novelArtifact, MEDIA_PATTERN, 'novelArtifact', false);
  const salmaArtifact = safeArtifact(value.salmaArtifact, COACH_PATTERN, 'salmaArtifact', false);
  for (const artifact of [...baselineArtifacts, matchedArtifact, novelArtifact, salmaArtifact].filter(Boolean)) {
    if (seenArtifacts.has(artifact)) throw new Error('Evidence artifacts cannot be reused across cases');
    seenArtifacts.add(artifact);
  }
  const baselineProfileArtifact = safeArtifact(value.baselineProfileArtifact, PROFILE_PATTERN, 'baselineProfileArtifact');
  const finalProfileArtifact = safeArtifact(value.finalProfileArtifact, PROFILE_PATTERN, 'finalProfileArtifact', false);
  const baseline = profiles.get(baselineProfileArtifact);
  const final = finalProfileArtifact ? profiles.get(finalProfileArtifact) : null;
  if (!baseline || (finalProfileArtifact && !final)) throw new Error('Verified private profile snapshots are required');
  const accountHash = sha256(`expert-gold-account:${profileId(baseline, 'Baseline profile')}`);
  const priorAccount = participantAccounts.get(value.participantId);
  if (priorAccount && priorAccount !== accountHash) throw new Error('One participant cannot use multiple accounts');
  participantAccounts.set(value.participantId, accountHash);
  const existing = accountOwners.get(accountHash);
  if (existing && existing !== value.participantId) throw new Error('One account cannot represent multiple participants');
  accountOwners.set(accountHash, value.participantId);
  if (final && profileId(final, 'Final profile') !== profileId(baseline, 'Baseline profile')) throw new Error('Baseline and final profiles must match');
  return { protocol, participantId: value.participantId, split: value.split, levelBand: value.levelBand,
    deleteBy: safeDate(value.deleteBy, 'deleteBy'), baselineArtifacts, matchedArtifact, novelArtifact, salmaArtifact,
    profileHashes: { baseline: sha256(JSON.stringify(baseline)), final: final ? sha256(JSON.stringify(final)) : null },
    appDecision: deriveExpertGoldAppDecision(protocol.protocolId, baseline, final, { asOf: frozenAt }) };
}

async function artifactHash(base, artifact) {
  const candidate = path.resolve(base, artifact);
  if (path.dirname(candidate) !== base) throw new Error('Evidence artifact escaped the study directory');
  const stat = await lstat(candidate).catch(() => null);
  const isCoach = artifact.endsWith('.txt');
  const min = isCoach ? 1 : 512; const max = isCoach ? 64 * 1024 : 100 * 1024 * 1024;
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < min || stat.size > max || await realpath(candidate) !== candidate) {
    throw new Error(`Evidence artifact is missing, linked, oversized, or non-canonical: ${artifact}`);
  }
  const data = await readFile(candidate);
  if (!isCoach) {
    const extension = path.extname(artifact).toLowerCase();
    const valid = extension === '.wav' ? data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WAVE'
      : extension === '.ogg' ? data.subarray(0, 4).toString('ascii') === 'OggS'
      : extension === '.m4a' ? data.subarray(4, 8).toString('ascii') === 'ftyp'
      : extension === '.mp3' ? data.subarray(0, 3).toString('ascii') === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) : false;
    if (!valid) throw new Error(`Evidence media header does not match: ${artifact}`);
  }
  return sha256(data);
}

export async function buildExpertGoldStudy(input, { profiles, baseDirectory } = {}) {
  noPrivateKeys(input);
  exactKeys(input, ['appVersion', 'cases', 'frozenAt', 'schemaVersion'], 'Expert-gold input');
  if (input.schemaVersion !== EXPERT_GOLD_SCHEMA_VERSION || !/^[a-f0-9]{7,40}$/u.test(input.appVersion || '')
    || Number.isNaN(Date.parse(input.frozenAt)) || !Array.isArray(input.cases) || !input.cases.length
    || !(profiles instanceof Map) || !baseDirectory) throw new Error('Expert-gold input is incomplete or unsupported');
  const base = await realpath(path.resolve(baseDirectory));
  const participantSplits = new Map(); const participantAccounts = new Map();
  const accountOwners = new Map(); const seenArtifacts = new Set();
  const frozenAt = Date.parse(input.frozenAt);
  const cases = input.cases.map((item) => safeCase(item, profiles, participantSplits,
    participantAccounts, accountOwners, seenArtifacts, frozenAt));
  const caseKeys = new Set();
  for (const item of cases) {
    const key = `${item.participantId}|${item.protocol.protocolId}`;
    if (caseKeys.has(key)) throw new Error('A participant may appear only once per frozen protocol');
    caseKeys.add(key);
  }
  const hashes = new Map();
  for (const artifact of seenArtifacts) hashes.set(artifact, await artifactHash(base, artifact));
  const rows = cases.map((item, index) => ({ item, reviewId: `eg_${String(index + 1).padStart(4, '0')}_${sha256(`${item.protocol.protocolId}|${item.participantId}`).slice(0, 10)}` }));
  const protocolIndex = Object.fromEntries([...new Set(cases.map((item) => item.protocol.protocolId))].sort()
    .map((id) => [id, expertGoldProtocol(id)]));
  const pack = { schemaVersion: EXPERT_GOLD_SCHEMA_VERSION, appVersion: input.appVersion, frozenAt: input.frozenAt,
    protocols: protocolIndex, items: rows.map(({ item, reviewId }) => ({ reviewId, protocolId: item.protocol.protocolId,
      levelBand: item.levelBand, baselineArtifacts: item.baselineArtifacts, matchedArtifact: item.matchedArtifact,
      novelArtifact: item.novelArtifact, salmaArtifact: item.salmaArtifact })) };
  const key = { schemaVersion: EXPERT_GOLD_SCHEMA_VERSION, appVersion: input.appVersion, frozenAt: input.frozenAt,
    packHash: sha256(JSON.stringify(pack)), items: rows.map(({ item, reviewId }) => ({ reviewId,
      participantHash: sha256(`expert-gold-participant:${item.participantId}`), split: item.split, deleteBy: item.deleteBy,
      profileHashes: item.profileHashes,
      artifactHashes: Object.fromEntries([...item.baselineArtifacts, item.matchedArtifact, item.novelArtifact, item.salmaArtifact]
        .filter(Boolean).map((artifact) => [artifact, hashes.get(artifact)])), appDecision: item.appDecision })) };
  const review = { schemaVersion: EXPERT_GOLD_SCHEMA_VERSION, reviewerId: '', qualificationAttested: false,
    independentReviewAttested: false, verdicts: pack.items.map((item) => ({ reviewId: item.reviewId,
      evidenceState: null, analyticScores: Object.fromEntries(pack.protocols[item.protocolId].scaleIds.map((id) => [id, null])),
      topBottleneckId: null, secondaryBottleneckIds: [], acceptableDrillIds: [], doseAppropriateness: null,
      salmaGrounding: item.salmaArtifact ? null : 'unavailable', matchedResult: item.matchedArtifact ? null : 'not_available',
      novelResult: item.novelArtifact ? null : 'not_available', reviewerNote: '' })) };
  return Object.freeze({ pack, key, reviewTemplate: review });
}

function packIndex(pack) {
  if (pack?.schemaVersion !== EXPERT_GOLD_SCHEMA_VERSION || !Array.isArray(pack.items) || !pack.protocols) throw new Error('Invalid expert-gold pack');
  const index = new Map();
  for (const item of pack.items) {
    if (!OPAQUE_ID.test(item.reviewId || '') || index.has(item.reviewId) || !expertGoldProtocol(item.protocolId)) throw new Error('Invalid or duplicate expert-gold item');
    index.set(item.reviewId, item);
  }
  return index;
}
function safeStringSet(value, allowed, label, max = 8) {
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length || value.some((item) => !allowed.has(item))) {
    throw new Error(`${label} contains duplicates or unknown values`);
  }
  return [...value].sort();
}
export function validateExpertReview(pack, review) {
  exactKeys(review, ['independentReviewAttested', 'qualificationAttested', 'reviewerId', 'schemaVersion', 'verdicts'], 'Expert review');
  if (review.schemaVersion !== EXPERT_GOLD_SCHEMA_VERSION || !OPAQUE_ID.test(review.reviewerId || '')
    || review.qualificationAttested !== true || review.independentReviewAttested !== true || !Array.isArray(review.verdicts)) {
    throw new Error('Two complete qualified independent reviews are required');
  }
  const index = packIndex(pack); const verdicts = new Map();
  for (const verdict of review.verdicts) {
    exactKeys(verdict, ['acceptableDrillIds', 'analyticScores', 'doseAppropriateness', 'evidenceState', 'matchedResult',
      'novelResult', 'reviewId', 'reviewerNote', 'salmaGrounding', 'secondaryBottleneckIds', 'topBottleneckId'], 'Expert verdict');
    const item = index.get(verdict.reviewId); const protocol = item && expertGoldProtocol(item.protocolId);
    if (!item || verdicts.has(verdict.reviewId) || !EVIDENCE_STATES.has(verdict.evidenceState)
      || !BOTTLENECKS.has(verdict.topBottleneckId) || !DOSE_RESULTS.has(verdict.doseAppropriateness)
      || !SALMA_RESULTS.has(verdict.salmaGrounding) || !RETEST_RESULTS.has(verdict.matchedResult)
      || !RETEST_RESULTS.has(verdict.novelResult) || typeof verdict.reviewerNote !== 'string' || verdict.reviewerNote.length > 500) {
      throw new Error('Expert verdict is invalid, duplicate, or incomplete');
    }
    exactKeys(verdict.analyticScores, protocol.scaleIds, 'Analytic scores');
    const scores = Object.fromEntries(protocol.scaleIds.map((id) => [id, verdict.analyticScores[id] == null ? null
      : finiteScore(verdict.analyticScores[id], `analyticScores.${id}`, 4)]));
    const secondaries = safeStringSet(verdict.secondaryBottleneckIds, BOTTLENECKS, 'secondaryBottleneckIds', 2);
    const drills = safeStringSet(verdict.acceptableDrillIds, new Set(protocol.validDrills), 'acceptableDrillIds');
    if (verdict.evidenceState === 'sufficient') {
      if (verdict.topBottleneckId === 'insufficient' || Object.values(scores).some((score) => score == null)) throw new Error('Sufficient evidence requires complete scores and a bottleneck');
    } else if (verdict.topBottleneckId !== 'insufficient' || secondaries.length || drills.length
      || Object.values(scores).some((score) => score != null) || verdict.doseAppropriateness !== 'not_available') {
      throw new Error('Insufficient or conflicting evidence must abstain from scores, bottleneck, drill, and dose');
    }
    if ((!item.salmaArtifact && verdict.salmaGrounding !== 'unavailable')
      || (!item.matchedArtifact && verdict.matchedResult !== 'not_available')
      || (!item.novelArtifact && verdict.novelResult !== 'not_available')) throw new Error('Verdict contradicts artifact availability');
    verdicts.set(verdict.reviewId, { ...verdict, analyticScores: scores,
      secondaryBottleneckIds: secondaries, acceptableDrillIds: drills });
  }
  if (verdicts.size !== index.size) throw new Error('Expert review is incomplete');
  return { reviewerId: review.reviewerId, verdicts, index };
}

function nominalKappa(a, b, weights = false) {
  if (!a.length || a.length !== b.length) return null;
  const labels = [...new Set([...a, ...b])].sort((x, y) => Number(x) - Number(y));
  const observed = a.reduce((sum, value, index) => sum + (weights ? 1 - ((Number(value) - Number(b[index])) ** 2) / 16 : value === b[index] ? 1 : 0), 0) / a.length;
  const expected = labels.reduce((sum, left) => labels.reduce((inner, right) => {
    const pA = a.filter((value) => value === left).length / a.length;
    const pB = b.filter((value) => value === right).length / b.length;
    const agreement = weights ? 1 - ((Number(left) - Number(right)) ** 2) / 16 : left === right ? 1 : 0;
    return inner + pA * pB * agreement;
  }, 0), 0);
  return { n: a.length, observedAgreement: observed, expectedAgreement: expected,
    kappa: expected === 1 ? null : (observed - expected) / (1 - expected) };
}
function numericAgreement(a, b) {
  if (!a.length || a.length !== b.length) return null;
  const mae = a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
  const pairs = a.map((value, index) => [value, b[index]]); const all = pairs.flat();
  const mean = all.reduce((sum, value) => sum + value, 0) / all.length;
  const subjectMeans = pairs.map(([x, y]) => (x + y) / 2);
  const ssSubjects = 2 * subjectMeans.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const raterMeans = [a.reduce((s, v) => s + v, 0) / a.length, b.reduce((s, v) => s + v, 0) / b.length];
  const ssRaters = a.length * raterMeans.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const ssTotal = all.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const ssError = Math.max(0, ssTotal - ssSubjects - ssRaters);
  const msSubjects = a.length > 1 ? ssSubjects / (a.length - 1) : 0;
  const msRaters = ssRaters; const msError = a.length > 1 ? ssError / (a.length - 1) : 0;
  const denominator = msSubjects + msError + (2 * (msRaters - msError) / a.length);
  return { n: a.length, mae, iccA1: denominator ? (msSubjects - msError) / denominator : null };
}
function fingerprint(value) { return JSON.stringify({ evidenceState: value.evidenceState, analyticScores: value.analyticScores,
  topBottleneckId: value.topBottleneckId, secondaryBottleneckIds: value.secondaryBottleneckIds,
  acceptableDrillIds: value.acceptableDrillIds, doseAppropriateness: value.doseAppropriateness,
  salmaGrounding: value.salmaGrounding, matchedResult: value.matchedResult, novelResult: value.novelResult }); }

export function compareExpertReviews(pack, reviewA, reviewB) {
  const a = validateExpertReview(pack, reviewA); const b = validateExpertReview(pack, reviewB);
  if (a.reviewerId === b.reviewerId) throw new Error('Two distinct independent reviewers are required');
  const ids = [...a.index.keys()]; const disagreements = ids.filter((id) => fingerprint(a.verdicts.get(id)) !== fingerprint(b.verdicts.get(id)));
  const analytic = {};
  for (const scaleId of SCALE_IDS) {
    const rows = ids.map((id) => [a.verdicts.get(id).analyticScores[scaleId], b.verdicts.get(id).analyticScores[scaleId]])
      .filter(([left, right]) => left != null && right != null);
    analytic[scaleId] = { weightedKappa: nominalKappa(rows.map((row) => row[0]), rows.map((row) => row[1]), true),
      numeric: numericAgreement(rows.map((row) => row[0]), rows.map((row) => row[1])) };
  }
  return { reviewed: ids.length, agreements: ids.length - disagreements.length, disagreements: disagreements.length,
    evidenceState: nominalKappa(ids.map((id) => a.verdicts.get(id).evidenceState), ids.map((id) => b.verdicts.get(id).evidenceState)),
    topBottleneck: nominalKappa(ids.map((id) => a.verdicts.get(id).topBottleneckId), ids.map((id) => b.verdicts.get(id).topBottleneckId)),
    acceptableDrills: nominalKappa(ids.map((id) => a.verdicts.get(id).acceptableDrillIds.join('|')),
      ids.map((id) => b.verdicts.get(id).acceptableDrillIds.join('|'))),
    doseAppropriateness: nominalKappa(ids.map((id) => a.verdicts.get(id).doseAppropriateness),
      ids.map((id) => b.verdicts.get(id).doseAppropriateness)),
    salmaGrounding: nominalKappa(ids.map((id) => a.verdicts.get(id).salmaGrounding),
      ids.map((id) => b.verdicts.get(id).salmaGrounding)),
    matchedRetest: nominalKappa(ids.map((id) => a.verdicts.get(id).matchedResult),
      ids.map((id) => b.verdicts.get(id).matchedResult)),
    novelTransfer: nominalKappa(ids.map((id) => a.verdicts.get(id).novelResult),
      ids.map((id) => b.verdicts.get(id).novelResult)),
    analytic, disagreementItems: disagreements.map((reviewId) => ({ reviewId,
      item: a.index.get(reviewId), verdictA: a.verdicts.get(reviewId), verdictB: b.verdicts.get(reviewId) })) };
}

export function createExpertDisagreementPack(pack, reviewA, reviewB) {
  const compared = compareExpertReviews(pack, reviewA, reviewB);
  return { schemaVersion: EXPERT_GOLD_SCHEMA_VERSION, adjudicatorId: '', qualificationAttested: false,
    items: compared.disagreementItems.map(({ reviewId, item, verdictA, verdictB }) => ({ reviewId,
      protocolId: item.protocolId, levelBand: item.levelBand, baselineArtifacts: item.baselineArtifacts,
      matchedArtifact: item.matchedArtifact, novelArtifact: item.novelArtifact, salmaArtifact: item.salmaArtifact,
      verdictA, verdictB, finalVerdict: null, rationale: '' })) };
}

function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return null; const p = successes / total; const d = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / d;
  const spread = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d;
  return { lower: Math.max(0, center - spread), upper: Math.min(1, center + spread) };
}
function proportion(successes, total) { return { successes, total, rate: total ? successes / total : null, wilson95: wilson(successes, total) }; }

function validateHiddenKey(pack, key) {
  const index = packIndex(pack);
  if (key?.schemaVersion !== EXPERT_GOLD_SCHEMA_VERSION || key.packHash !== sha256(JSON.stringify(pack))
    || !Array.isArray(key.items) || key.items.length !== index.size) throw new Error('Hidden key does not match the frozen pack');
  const hidden = new Map();
  for (const item of key.items) {
    if (!index.has(item.reviewId) || hidden.has(item.reviewId) || !HASH.test(item.participantHash || '')
      || !SPLITS.has(item.split) || !APP_DECISIONS.has(item.appDecision?.decision)
      || !HASH.test(item.appDecision?.decisionBinding || '') || !item.artifactHashes
      || !HASH.test(item.profileHashes?.baseline || '')
      || (item.profileHashes?.final != null && !HASH.test(item.profileHashes.final))
      || Object.values(item.artifactHashes).some((hash) => !HASH.test(hash))) throw new Error('Hidden key contains invalid evidence');
    hidden.set(item.reviewId, item);
  }
  return hidden;
}
function resolvedVerdicts(pack, reviewA, reviewB, adjudication) {
  const compared = compareExpertReviews(pack, reviewA, reviewB); const a = validateExpertReview(pack, reviewA);
  if (adjudication?.schemaVersion !== EXPERT_GOLD_SCHEMA_VERSION || !OPAQUE_ID.test(adjudication.adjudicatorId || '')
    || [reviewA.reviewerId, reviewB.reviewerId].includes(adjudication.adjudicatorId)
    || adjudication.qualificationAttested !== true || !Array.isArray(adjudication.items)) {
    throw new Error('A distinct qualified adjudicator is required');
  }
  const expected = new Set(compared.disagreementItems.map((item) => item.reviewId)); const resolved = new Map();
  for (const row of adjudication.items) {
    if (!expected.has(row.reviewId) || resolved.has(row.reviewId) || !row.finalVerdict
      || typeof row.rationale !== 'string' || !row.rationale.trim() || row.rationale.length > 500) throw new Error('Adjudication is unexpected, duplicate, or incomplete');
    const pseudo = { schemaVersion: EXPERT_GOLD_SCHEMA_VERSION, reviewerId: 'final_adjudicator', qualificationAttested: true,
      independentReviewAttested: true, verdicts: [{ reviewId: row.reviewId, reviewerNote: '', ...row.finalVerdict }] };
    resolved.set(row.reviewId, validateExpertReview({ ...pack, items: [a.index.get(row.reviewId)] }, pseudo).verdicts.get(row.reviewId));
  }
  if (resolved.size !== expected.size) throw new Error('Adjudication is incomplete');
  const final = new Map();
  for (const id of a.index.keys()) final.set(id, expected.has(id) ? resolved.get(id) : a.verdicts.get(id));
  return { final, compared };
}

export function finalizeExpertGoldStudy(pack, key, reviewA, reviewB, adjudication) {
  const hidden = validateHiddenKey(pack, key); const { final, compared } = resolvedVerdicts(pack, reviewA, reviewB, adjudication);
  const evaluable = [...hidden.entries()].filter(([, item]) => !['owner_smoke', 'synthetic_smoke'].includes(item.split));
  const index = packIndex(pack);
  const score = (entries) => {
    const counters = { sufficientTP: 0, sufficientFN: 0, insufficientTN: 0, insufficientFP: 0,
    abstentionCorrect: 0, abstentionTotal: 0, bottleneckCorrect: 0, bottleneckTotal: 0, top2Correct: 0,
    drillCorrect: 0, drillTotal: 0, doseCorrect: 0, doseTotal: 0, salmaGrounded: 0, salmaTotal: 0,
    matchedCorrect: 0, matchedTotal: 0, novelCorrect: 0, novelTotal: 0, invalidMastery: 0 };
    const harmful = new Set();
    for (const [id, hiddenItem] of entries) {
    const truth = final.get(id); const app = hiddenItem.appDecision; const appSufficient = app.decision !== 'abstain';
    if (truth.evidenceState === 'sufficient') appSufficient ? counters.sufficientTP++ : counters.sufficientFN++;
    else appSufficient ? counters.insufficientFP++ : counters.insufficientTN++;
    if (truth.evidenceState !== 'sufficient') {
      counters.abstentionTotal++; if (!appSufficient) counters.abstentionCorrect++; else harmful.add(id);
    } else if (truth.topBottleneckId !== 'none') {
      counters.bottleneckTotal++;
      if (app.criterionId === truth.topBottleneckId) counters.bottleneckCorrect++; else if (app.decision === 'selected') harmful.add(id);
      if ([truth.topBottleneckId, ...truth.secondaryBottleneckIds].includes(app.criterionId)) counters.top2Correct++;
      if (app.decision === 'selected') {
        const protocol = expertGoldProtocol(index.get(id).protocolId);
        counters.drillTotal++;
        if (app.prescription && truth.acceptableDrillIds.includes(app.prescription.drillId)) counters.drillCorrect++; else harmful.add(id);
        counters.doseTotal++;
        const doseMatches = app.prescription
          && app.prescription.repetitions === protocol.dose.repetitions
          && app.prescription.durationSeconds === protocol.dose.durationSeconds
          && app.prescription.minimumSpacingMinutes === protocol.dose.minimumSpacingMinutes;
        if (truth.doseAppropriateness === 'appropriate' && doseMatches) counters.doseCorrect++; else harmful.add(id);
      }
    }
    if (truth.salmaGrounding !== 'unavailable') {
      counters.salmaTotal++; if (truth.salmaGrounding === 'grounded') counters.salmaGrounded++;
      else if (truth.salmaGrounding === 'misleading') harmful.add(id);
    }
    if (truth.matchedResult !== 'not_available' && truth.matchedResult !== 'insufficient') {
      counters.matchedTotal++; if ((truth.matchedResult === 'pass') === app.masteryClaimed) counters.matchedCorrect++;
    }
    if (truth.novelResult !== 'not_available' && truth.novelResult !== 'insufficient') {
      counters.novelTotal++; if ((truth.novelResult === 'pass') === app.masteryClaimed) counters.novelCorrect++;
    }
    if (app.masteryClaimed && !(truth.matchedResult === 'pass' && truth.novelResult === 'pass')) counters.invalidMastery++;
    }
    const participantCount = new Set(entries.map(([, item]) => item.participantHash)).size;
    return { participantCount, caseCount: entries.length,
    evidenceSufficiencySensitivity: proportion(counters.sufficientTP, counters.sufficientTP + counters.sufficientFN),
    evidenceSufficiencySpecificity: proportion(counters.insufficientTN, counters.insufficientTN + counters.insufficientFP),
    correctAbstention: proportion(counters.abstentionCorrect, counters.abstentionTotal),
    top1BottleneckAgreement: proportion(counters.bottleneckCorrect, counters.bottleneckTotal),
    top2BottleneckCoverage: proportion(counters.top2Correct, counters.bottleneckTotal),
    drillAppropriateness: proportion(counters.drillCorrect, counters.drillTotal),
    doseAppropriateness: proportion(counters.doseCorrect, counters.doseTotal),
    salmaGroundedExplanation: proportion(counters.salmaGrounded, counters.salmaTotal),
    matchedRetestAgreement: proportion(counters.matchedCorrect, counters.matchedTotal),
    novelTransferAgreement: proportion(counters.novelCorrect, counters.novelTotal),
      harmfulMisdirectionCount: harmful.size, invalidMasteryClaimCount: counters.invalidMastery };
  };
  const metric = score(evaluable); const participantCount = metric.participantCount;
  const gates = { correctAbstentionAtLeast95: metric.correctAbstention.rate != null && metric.correctAbstention.rate >= 0.95,
    top1BottleneckAtLeast80: metric.top1BottleneckAgreement.rate != null && metric.top1BottleneckAgreement.rate >= 0.8,
    drillAppropriatenessAtLeast80: metric.drillAppropriateness.rate != null && metric.drillAppropriateness.rate >= 0.8,
    salmaGroundedAtLeast90: metric.salmaGroundedExplanation.rate != null && metric.salmaGroundedExplanation.rate >= 0.9,
    zeroHarmfulMisdirection: metric.harmfulMisdirectionCount === 0,
    zeroInvalidMasteryClaims: metric.invalidMasteryClaimCount === 0 };
  const by = (selector) => Object.fromEntries([...new Set(evaluable.map(([id]) => selector(index.get(id))))].sort()
    .map((slice) => [slice, score(evaluable.filter(([id]) => selector(index.get(id)) === slice))]));
  const protocolSlices = by((item) => item.protocolId);
  const perProtocolMinimumMet = Object.keys(pack.protocols).every((protocolId) =>
    (protocolSlices[protocolId]?.participantCount || 0) >= 10);
  const publicValidationEligible = participantCount >= 30 && perProtocolMinimumMet;
  const status = !publicValidationEligible ? 'pilot-evidence-only'
    : Object.values(gates).every(Boolean) ? 'release-gates-measured-and-passed' : 'release-gates-not-passed';
  return Object.freeze({ schemaVersion: EXPERT_GOLD_SCHEMA_VERSION, status, appVersion: pack.appVersion,
    frozenAt: pack.frozenAt, containsRawAudioOrTranscript: false, reviewerIdentityStored: false,
    interRater: Object.fromEntries(Object.entries(compared).filter(([keyName]) => keyName !== 'disagreementItems')),
    appComparison: { targetParticipantCount: participantCount, publicValidationEligible,
      minimumParticipantsPerFrozenProtocol: 10, ...metric,
      slices: { level: by((item) => item.levelBand), protocol: protocolSlices,
        modality: by((item) => expertGoldProtocol(item.protocolId).modality),
        criterion: by((item) => expertGoldProtocol(item.protocolId).criterionId),
        taskArchetype: by((item) => expertGoldProtocol(item.protocolId).stageId) } },
    smoke: { caseCount: hidden.size - evaluable.length, excludedFromAccuracyClaims: true }, releaseGates: gates });
}

export function verifyFrozenExpertGoldStudy(input, rebuilt, suppliedPack, suppliedKey) {
  if (!isDeepStrictEqual(rebuilt.pack, suppliedPack) || !isDeepStrictEqual(rebuilt.key, suppliedKey)) {
    throw new Error('Expert-gold pack or hidden key does not match re-derived authoritative evidence');
  }
  return true;
}

export default { EXPERT_GOLD_PROTOCOLS, expertGoldProtocol, deriveExpertGoldAppDecision, loadExpertGoldProfiles,
  buildExpertGoldStudy, validateExpertReview, compareExpertReviews, createExpertDisagreementPack,
  finalizeExpertGoldStudy, verifyFrozenExpertGoldStudy };
