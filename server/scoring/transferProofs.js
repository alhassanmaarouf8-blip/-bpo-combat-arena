import { SKILL_BY_ID } from '../brain/skillGraph.js';
import { SPEAKING_METRIC_BY_SKILL, speakingMeasurementForSkill } from './speakingMeasurement.js';

export const TRANSFER_PROOF_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const TRANSFER_METRIC_BY_SKILL = SPEAKING_METRIC_BY_SKILL;

function measurementMatches(measurement, { value, evidenceId, sessionId, contextId = null, noveltyId = null } = {}) {
  return !!measurement && measurement.value === Number(value) && measurement.evidenceId === evidenceId
    && measurement.sourceSessionId === sessionId
    && (contextId === null || measurement.contextId === contextId)
    && (noveltyId === null || measurement.noveltyId === noveltyId);
}

/** Validate durable transfer proofs before they may affect readiness or confidence. */
export function validatedTransferProofs(profile, now = Date.now()) {
  const history = Array.isArray(profile?.salmaCoach?.coachState?.improvementHistory)
    ? profile.salmaCoach.coachState.improvementHistory : [];
  return history.flatMap((proof) => {
    const skillId = typeof proof?.skillId === 'string' ? proof.skillId : '';
    const metric = Object.hasOwn(TRANSFER_METRIC_BY_SKILL, skillId) ? TRANSFER_METRIC_BY_SKILL[skillId] : null;
    const before = Number(proof?.before); const after = Number(proof?.after); const verifiedAt = Number(proof?.verifiedAt);
    const contextId = typeof proof?.contextId === 'string' ? proof.contextId : '';
    const noveltyId = typeof proof?.noveltyId === 'string' ? proof.noveltyId : '';
    const comparedContextId = typeof proof?.comparedContextId === 'string' ? proof.comparedContextId : '';
    const comparedNoveltyId = typeof proof?.comparedNoveltyId === 'string' ? proof.comparedNoveltyId : '';
    const baselineSessionId = typeof proof?.baselineSessionId === 'string' ? proof.baselineSessionId : '';
    const baselineEvidenceId = typeof proof?.baselineMeasurementEvidenceId === 'string'
      ? proof.baselineMeasurementEvidenceId : '';
    const comparedSessionId = typeof proof?.comparedRetestSessionId === 'string' ? proof.comparedRetestSessionId : '';
    const comparedEvidenceId = typeof proof?.comparedMeasurementEvidenceId === 'string'
      ? proof.comparedMeasurementEvidenceId : '';
    const comparedValue = Number(proof?.comparedValue);
    const delta = metric?.direction === 'higher' ? after - before : before - after;
    const matchedRegression = metric?.direction === 'higher' ? comparedValue - after : after - comparedValue;
    const valuesAreBounded = before >= 0 && after >= 0
      && (metric?.metricKey === 'grammar_errors' || (before <= 100 && after <= 100));
    if (!metric || !Object.hasOwn(SKILL_BY_ID, skillId) || proof?.phase !== 'transfer' || proof?.status !== 'improved'
      || proof?.metricKey !== metric.metricKey || !/^[a-f0-9]{16}$/u.test(proof?.id || '')
      || !/^[a-f0-9]{16}$/u.test(proof?.prescriptionId || '')
      || !/^[a-f0-9]{12}$/u.test(proof?.measurementEvidenceId || '')
      || !/^[a-f0-9]{12}$/u.test(contextId) || !/^[a-f0-9]{12}$/u.test(noveltyId)
      || !/^[a-f0-9]{12}$/u.test(comparedContextId) || !/^[a-f0-9]{12}$/u.test(comparedNoveltyId)
      || contextId === comparedContextId || noveltyId === comparedNoveltyId
      || typeof proof?.retestSessionId !== 'string' || !proof.retestSessionId.trim() || proof.retestSessionId.length > 100
      || !baselineSessionId || baselineSessionId.length > 100 || !/^[a-f0-9]{12}$/u.test(baselineEvidenceId)
      || !comparedSessionId || comparedSessionId.length > 100 || !/^[a-f0-9]{12}$/u.test(comparedEvidenceId)
      || !/^[a-f0-9]{16}$/u.test(proof?.comparedProofId || '') || !Number.isFinite(comparedValue)
      || !Number.isFinite(before) || !Number.isFinite(after) || !valuesAreBounded
      || !Number.isFinite(verifiedAt) || verifiedAt <= 0 || verifiedAt > now + 300_000
      || now - verifiedAt > TRANSFER_PROOF_MAX_AGE_MS || delta < metric.minimumDelta
      || matchedRegression > metric.minimumDelta) return [];

    const baseline = speakingMeasurementForSkill(profile, skillId, { sessionId: baselineSessionId });
    const matched = speakingMeasurementForSkill(profile, skillId, { sessionId: comparedSessionId });
    const transfer = speakingMeasurementForSkill(profile, skillId, { sessionId: proof.retestSessionId });
    const matchedProof = history.find((candidate) => candidate?.id === proof.comparedProofId
      && candidate?.prescriptionId === proof.prescriptionId && candidate?.phase === 'matched'
      && candidate?.status === 'improved' && candidate?.retestSessionId === comparedSessionId);
    if (!measurementMatches(baseline, { value: before, evidenceId: baselineEvidenceId, sessionId: baselineSessionId })
      || !measurementMatches(matched, { value: comparedValue, evidenceId: comparedEvidenceId,
        sessionId: comparedSessionId, contextId: comparedContextId, noveltyId: comparedNoveltyId })
      || !measurementMatches(transfer, { value: after, evidenceId: proof.measurementEvidenceId,
        sessionId: proof.retestSessionId, contextId, noveltyId })
      || !matchedProof || Number(matchedProof.before) !== before || Number(matchedProof.after) !== comparedValue
      || matchedProof.measurementEvidenceId !== comparedEvidenceId
      || matchedProof.baselineSessionId !== baselineSessionId
      || matchedProof.baselineMeasurementEvidenceId !== baselineEvidenceId
      || matched.contextId !== baseline.contextId || matched.noveltyId !== baseline.noveltyId
      || transfer.contextId === baseline.contextId || transfer.noveltyId === baseline.noveltyId
      || baseline.measuredAt >= matched.measuredAt || matched.measuredAt >= transfer.measuredAt
      || Number(proof?.measuredAt) !== transfer.measuredAt || verifiedAt < transfer.measuredAt) return [];
    return [{ skillId, metricKey: metric.metricKey, before, after, direction: metric.direction,
      phase: 'transfer', verifiedAt }];
  });
}

export default { validatedTransferProofs, TRANSFER_METRIC_BY_SKILL, TRANSFER_PROOF_MAX_AGE_MS };
