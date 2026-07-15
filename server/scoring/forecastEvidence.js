import { createHash } from 'node:crypto';
import { serviceRecoveryScoreFromSession, SERVICE_RECOVERY_CRITERION_ID } from './serviceRecoveryEvidence.js';
import { eligibleSpeakingWords, reliableSpeakingSessions } from './speakingMeasurement.js';

export const FORECAST_EVIDENCE_FRESHNESS_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PUBLIC_COUNT = 20;

function boundedString(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function archetypeParts(session) {
  return {
    roleType: boundedString(session?.targetRoleType, 40) || 'customer_service',
    industryKey: boundedString(session?.targetIndustry, 40) || 'general',
    vacancyTargetId: boundedString(session?.vacancyTargetId, 100) || 'generic',
    scenarioId: boundedString(session?.scenarioId, 80) || 'generic',
    bossId: boundedString(session?.bossId, 40) || 'professional_interviewer',
  };
}

function archetypeBinding(session) {
  return createHash('sha256').update(JSON.stringify(archetypeParts(session))).digest('hex').slice(0, 12);
}

/**
 * Return null when the criterion was not measured. `deficit` is evaluated against the exact
 * internal reference exposed by the rejection forecast, never against broad completion or score.
 */
export function forecastCriterionObservation(session, criterionId) {
  const words = eligibleSpeakingWords(session);
  if (criterionId === 'sustained_pace') {
    return Number.isFinite(session?.wpm) && Number(session.wpm) > 0
      ? { deficit: Number(session.wpm) < 90 } : null;
  }
  if (criterionId === 'grammar_control') {
    if (session?.grammarMeasured !== true || !Array.isArray(session?.grammarRules) || words < 80) return null;
    const errors = session.grammarRules.reduce((sum, row) => sum + Math.max(0, Number(row?.count) || 0), 0);
    return { deficit: (errors / words) * 100 > 8 };
  }
  if (criterionId === 'speech_recognition_proxy') {
    return Number.isFinite(session?.intelligibility)
      ? { deficit: Number(session.intelligibility) < 0.8 } : null;
  }
  if (criterionId === SERVICE_RECOVERY_CRITERION_ID) {
    const score = serviceRecoveryScoreFromSession(session);
    return score == null ? null : { deficit: score < (2 / 3) };
  }
  if (criterionId === 'complete_response') {
    return Number.isFinite(session?.giveUpRate)
      ? { deficit: Number(session.giveUpRate) > 0.2 } : null;
  }
  if (criterionId === 'response_latency') {
    return Number.isFinite(session?.latencyS)
      ? { deficit: Number(session.latencyS) > 4 } : null;
  }
  if (criterionId === 'filler_dependence') {
    return Number.isFinite(session?.fillers) && words >= 80
      ? { deficit: (Math.max(0, Number(session.fillers)) / words) * 100 > 10 } : null;
  }
  if (criterionId === 'connected_answer_structure') {
    return Number.isFinite(session?.subClauseRate)
      ? { deficit: Number(session.subClauseRate) < 0.2 } : null;
  }
  if (criterionId === 'lexical_range_proxy') {
    return Number.isFinite(session?.vocabDiversity)
      ? { deficit: Number(session.vocabDiversity) < 0.45 } : null;
  }
  return null;
}

/**
 * Criterion confidence is local to one exact interview archetype. A fresh pass is contradictory
 * evidence and deliberately vetoes "high", even when the same window also contains two failures.
 */
export function forecastEvidenceSummary(profile, criterionId, referenceSession, now = Date.now()) {
  const referenceBinding = referenceSession ? archetypeBinding(referenceSession) : null;
  const referenceObservation = referenceSession
    ? forecastCriterionObservation(referenceSession, criterionId) : null;
  if (!criterionId || !referenceBinding || !referenceObservation) {
    return Object.freeze({ confidence: 'insufficient', supportCount: 0, conflictCount: 0,
      referenceDeficit: false, expiresAt: null });
  }

  let supportCount = 0;
  let conflictCount = 0;
  let latestSupportAt = 0;
  for (const session of reliableSpeakingSessions(profile)) {
    const observedAt = Number(session?.date) || 0;
    const age = now - observedAt;
    if (observedAt <= 0 || age < 0 || age > FORECAST_EVIDENCE_FRESHNESS_MS
      || archetypeBinding(session) !== referenceBinding) continue;
    const observation = forecastCriterionObservation(session, criterionId);
    if (!observation) continue;
    if (observation.deficit) {
      supportCount += 1;
      latestSupportAt = Math.max(latestSupportAt, observedAt);
    } else {
      conflictCount += 1;
    }
  }
  supportCount = Math.min(MAX_PUBLIC_COUNT, supportCount);
  conflictCount = Math.min(MAX_PUBLIC_COUNT, conflictCount);
  const referenceDeficit = referenceObservation.deficit === true;
  const confidence = referenceDeficit && supportCount >= 2 && conflictCount === 0
    ? 'high' : referenceDeficit && supportCount >= 1 ? 'medium' : 'insufficient';
  return Object.freeze({ confidence, supportCount, conflictCount, referenceDeficit,
    expiresAt: latestSupportAt ? latestSupportAt + FORECAST_EVIDENCE_FRESHNESS_MS : null });
}

export default { FORECAST_EVIDENCE_FRESHNESS_MS, forecastCriterionObservation, forecastEvidenceSummary };
