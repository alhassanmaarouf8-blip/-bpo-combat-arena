import { createHash } from 'crypto';
import { serviceRecoveryScoreFromSession } from './serviceRecoveryEvidence.js';
import { INTERVIEW_PROMPT_CONTRACT_VERSION, interviewPromptById, scenarioSupportsRole } from '../scenarios.js';
import { BOSS_LADDER } from '../progression.js';

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
export const SPEAKING_TASK_CONTRACT_VERSION = 1;
const MINIMUM_GRAMMAR_WORDS = 80;

function boundedString(value, max = 100) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function hash(value, length = 12) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}
function roundMetric(value) { return Math.round(Number(value) * 10) / 10; }
const TASK_LEVELS = new Set(['a2-b1', 'b2', 'c1']);
const TASK_MOODS = new Set(['sharp-monday', 'neutral', 'tired-friday']);
const TASK_BOSS_IDS = new Set(BOSS_LADDER.map((boss) => boss.id));

function safeReplayContext(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    dossier: boundedString(source.dossier, 800),
    memory: boundedString(source.memory, 1600),
    focusTitle: boundedString(source.focusTitle, 160),
  };
}

export function createSpeakingTaskContract(value) {
  const source = value && typeof value === 'object' ? value : {};
  const version = Number(source.version);
  const promptContractVersion = Number(source.promptContractVersion);
  const levelId = boundedString(source.levelId, 20);
  const bossId = boundedString(source.bossId, 40);
  const roleType = boundedString(source.roleType, 40);
  const scenarioId = boundedString(source.scenarioId, 80);
  const behavioralPromptId = boundedString(source.behavioralPromptId, 24);
  const screeningPromptId = boundedString(source.screeningPromptId, 24);
  const contentSeed = boundedString(source.contentSeed, 100);
  const mood = boundedString(source.mood, 40);
  const assessmentMode = boundedString(source.assessmentMode, 20);
  if (version !== SPEAKING_TASK_CONTRACT_VERSION
    || promptContractVersion !== INTERVIEW_PROMPT_CONTRACT_VERSION
    || assessmentMode !== 'diagnostic' || !TASK_LEVELS.has(levelId) || !TASK_BOSS_IDS.has(bossId) || !roleType
    || !scenarioId || !scenarioSupportsRole(scenarioId, roleType) || !contentSeed || !TASK_MOODS.has(mood)
    || !interviewPromptById('behavioral', behavioralPromptId, levelId)
    || !interviewPromptById('screening', screeningPromptId, levelId)) return null;
  return Object.freeze({
    version,
    promptContractVersion,
    assessmentMode,
    levelId,
    bossId,
    roleType,
    scenarioId,
    behavioralPromptId,
    screeningPromptId,
    industryKey: boundedString(source.industryKey, 40) || null,
    targetId: boundedString(source.targetId, 100) || null,
    contentSeed,
    mood,
    replayContext: safeReplayContext(source.replayContext),
  });
}

export function speakingTaskContractForSession(session) {
  const contract = createSpeakingTaskContract(session?.speakingTaskContract);
  if (!contract) return null;
  // The contract is server-owned, but these legacy summary fields remain useful to the rest of the
  // product. A disagreement is corruption, not a second source of truth.
  if (boundedString(session?.bossId, 40) !== contract.bossId
    || boundedString(session?.level, 20) !== contract.levelId
    || boundedString(session?.targetRoleType, 40) !== contract.roleType
    || boundedString(session?.scenarioId, 80) !== contract.scenarioId
    || (boundedString(session?.targetIndustry, 40) || null) !== contract.industryKey
    || (boundedString(session?.vacancyTargetId, 100) || null) !== contract.targetId) return null;
  return contract;
}

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
  const task = speakingTaskContractForSession(session);
  if (!task) return null;
  const replayContextHash = hash(task.replayContext, 16);
  return {
    contextId: hash({ version: task.version, promptContractVersion: task.promptContractVersion,
      levelId: task.levelId, bossId: task.bossId, roleType: task.roleType, scenarioId: task.scenarioId,
      behavioralPromptId: task.behavioralPromptId, screeningPromptId: task.screeningPromptId,
      industryKey: task.industryKey, targetId: task.targetId, contentSeed: task.contentSeed,
      mood: task.mood, replayContextHash }),
    noveltyId: hash({ promptContractVersion: task.promptContractVersion, roleType: task.roleType,
      behavioralPromptId: task.behavioralPromptId, screeningPromptId: task.screeningPromptId,
      scenarioId: task.scenarioId }),
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
  speakingTaskContractForSession, createSpeakingTaskContract, eligibleSpeakingWords,
  EVIDENCE_CONTRACT_VERSION, SPEAKING_TASK_CONTRACT_VERSION, SPEAKING_METRIC_BY_SKILL };
