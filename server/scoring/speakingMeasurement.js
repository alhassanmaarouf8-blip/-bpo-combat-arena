import { createHash } from 'crypto';
import { serviceRecoveryScoreFromSession } from './serviceRecoveryEvidence.js';

export const SPEAKING_METRIC_BY_SKILL = Object.freeze({
  'word-order-sub': { metricKey: 'grammar_errors', direction: 'lower', minimumDelta: 1 },
  'dativ-akkusativ': { metricKey: 'grammar_errors', direction: 'lower', minimumDelta: 1 },
  'konjunktiv-2': { metricKey: 'grammar_errors', direction: 'lower', minimumDelta: 1 },
  'fluency-interrupt': { metricKey: 'fluency_score', direction: 'higher', minimumDelta: 5 },
  deescalate: { metricKey: 'deescalation_score', direction: 'higher', minimumDelta: 5 },
  'no-freeze-expected': { metricKey: 'response_continuity', direction: 'higher', minimumDelta: 5 },
  'pronunciation-phone': { metricKey: 'intelligibility_score', direction: 'higher', minimumDelta: 3 },
});

export const EVIDENCE_CONTRACT_VERSION = 2;
const MINIMUM_GRAMMAR_WORDS = 80;

function boundedString(value, max = 100) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function hash(value, length = 12) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}
function roundMetric(value) { return Math.round(Number(value) * 10) / 10; }

function evidenceVersion(session) {
  return Number(session?.evidenceQuality?.version) || 0;
}

export function eligibleSpeakingWords(session) {
  const explicit = Number(session?.evidenceQuality?.eligibleWords);
  const compatible = Number(session?.evidenceQuality?.words) || Number(session?.words);
  const hasExplicit = !!session?.evidenceQuality
    && Object.hasOwn(session.evidenceQuality, 'eligibleWords');
  const words = hasExplicit ? explicit : compatible;
  return Number.isFinite(words) && words > 0 ? Math.floor(words) : 0;
}

export function reliableSpeakingSessions(profile) {
  const sessions = Array.isArray(profile?.sessions) ? [...profile.sessions] : [];
  // Migration is intentionally fail-closed. v1 packets may remain visible as history but can no
  // longer authorize a new measurement or transfer proof after Evidence Contract v2 ships.
  return sessions
    .filter((session) => evidenceVersion(session) === EVIDENCE_CONTRACT_VERSION
      && session?.evidenceQuality?.prescriptionEligible === true)
    .sort((a, b) => Number(a?.date || 0) - Number(b?.date || 0));
}

export function speakingContextForSession(session) {
  const scenarioId = boundedString(session?.scenarioId, 80);
  const roleType = boundedString(session?.targetRoleType, 40);
  if (!scenarioId || !roleType) return null;
  const bossId = boundedString(session?.bossId, 40);
  const industryKey = boundedString(session?.targetIndustry, 40);
  const targetId = boundedString(session?.vacancyTargetId, 100);
  return {
    contextId: hash({ bossId, roleType, scenarioId, industryKey, targetId }),
    noveltyId: hash({ roleType, scenarioId }),
  };
}

export function speakingMeasurementForSkill(profile, skillId, { sessionId = null } = {}) {
  const metric = Object.hasOwn(SPEAKING_METRIC_BY_SKILL, skillId) ? SPEAKING_METRIC_BY_SKILL[skillId] : null;
  if (!metric) return null;
  const requestedSessionId = boundedString(sessionId, 100);
  const sessions = reliableSpeakingSessions(profile)
    .filter((session) => !requestedSessionId || boundedString(session?.sessionId, 100) === requestedSessionId);
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    let value = null;
    let measurementBinding = null;
    if (metric.metricKey === 'grammar_errors' && session?.grammarMeasured === true && Array.isArray(session?.grammarRules)) {
      const eligibleWords = eligibleSpeakingWords(session);
      if (eligibleWords < MINIMUM_GRAMMAR_WORDS) continue;
      const rawErrorCount = session.grammarRules.filter((row) => row?.ruleId === skillId)
        .reduce((sum, row) => sum + Math.max(0, Number(row?.count) || 0), 0);
      value = (rawErrorCount / eligibleWords) * 100;
      measurementBinding = { rawErrorCount, eligibleWords, unit: 'errors_per_100_eligible_words' };
    } else if (metric.metricKey === 'fluency_score' && Number.isFinite(session?.fluency)) {
      value = Math.max(0, Math.min(100, Number(session.fluency)));
    } else if (metric.metricKey === 'deescalation_score') {
      const score = serviceRecoveryScoreFromSession(session);
      if (score != null) value = score * 100;
    } else if (metric.metricKey === 'response_continuity' && Number.isFinite(session?.giveUpRate)) {
      value = Math.max(0, Math.min(100, (1 - Number(session.giveUpRate)) * 100));
    } else if (metric.metricKey === 'intelligibility_score' && Number.isFinite(session?.intelligibility)) {
      value = Math.max(0, Math.min(100, Number(session.intelligibility) * 100));
    }
    if (value === null) continue;
    const measuredAt = Number(session?.date) || 0;
    if (!measuredAt) continue;
    const evidenceId = metric.metricKey === 'deescalation_score' && typeof session?.deescalationEvidence?.binding === 'string'
      ? hash({ skillId, binding: session.deescalationEvidence.binding })
      : metric.metricKey === 'grammar_errors'
        ? hash({ skillId, metricKey: metric.metricKey, measuredAt, bossId: session?.bossId || '',
          contractVersion: evidenceVersion(session), measurementBinding })
        : hash({ skillId, metricKey: metric.metricKey, measuredAt, bossId: session?.bossId || '' });
    const sourceSessionId = boundedString(session?.sessionId, 100) || null;
    const context = speakingContextForSession(session);
    return { metricKey: metric.metricKey, value: roundMetric(value), measuredAt, evidenceId,
      sourceSessionId, contextId: context?.contextId || null, noveltyId: context?.noveltyId || null };
  }
  return null;
}

export default { reliableSpeakingSessions, speakingContextForSession, speakingMeasurementForSkill,
  eligibleSpeakingWords, EVIDENCE_CONTRACT_VERSION, SPEAKING_METRIC_BY_SKILL };
