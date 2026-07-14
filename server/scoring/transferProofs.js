import { SKILL_BY_ID } from '../brain/skillGraph.js';

export const TRANSFER_PROOF_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const TRANSFER_METRIC_BY_SKILL = Object.freeze({
  'word-order-sub': { metricKey: 'grammar_errors', direction: 'lower', minimumDelta: 1 },
  'dativ-akkusativ': { metricKey: 'grammar_errors', direction: 'lower', minimumDelta: 1 },
  'konjunktiv-2': { metricKey: 'grammar_errors', direction: 'lower', minimumDelta: 1 },
  'fluency-interrupt': { metricKey: 'fluency_score', direction: 'higher', minimumDelta: 5 },
  deescalate: { metricKey: 'deescalation_score', direction: 'higher', minimumDelta: 5 },
  'no-freeze-expected': { metricKey: 'response_continuity', direction: 'higher', minimumDelta: 5 },
  'pronunciation-phone': { metricKey: 'intelligibility_score', direction: 'higher', minimumDelta: 3 },
});

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
    const delta = metric?.direction === 'higher' ? after - before : before - after;
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
      || !Number.isFinite(before) || !Number.isFinite(after) || !valuesAreBounded
      || !Number.isFinite(verifiedAt) || verifiedAt <= 0 || verifiedAt > now + 300_000
      || now - verifiedAt > TRANSFER_PROOF_MAX_AGE_MS || delta < metric.minimumDelta) return [];
    return [{ skillId, metricKey: metric.metricKey, before, after, direction: metric.direction,
      phase: 'transfer', verifiedAt }];
  });
}

export default { validatedTransferProofs, TRANSFER_METRIC_BY_SKILL, TRANSFER_PROOF_MAX_AGE_MS };
