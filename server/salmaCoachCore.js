import { createHash } from 'crypto';
import { planOf, trialActive } from './auth.js';
import { buildSnapshot } from './brain/adapter.js';
import { decide } from './brain/engine.js';
import { archiveListeningCycle, listeningBaselineSnapshot, listeningEvidence, listeningEvidenceSummary,
  listeningRetestEvidence } from './listeningEvidence.js';
import { hireReadinessFor } from './hireReadiness.js';
import { SERVICE_RECOVERY_CRITERION_ID, serviceRecoveryScoreFromSession } from './scoring/serviceRecoveryEvidence.js';
import { reliableSpeakingSessions, speakingMeasurementForSkill, speakingTaskContractForSession } from './scoring/speakingMeasurement.js';
import { validatedTransferProofs } from './scoring/transferProofs.js';
import { availableInterviewPromptIds, scenarioSupportsRole } from './scenarios.js';
import { dueVacancyMilestone, isLiveVacancyMilestone, normalizeVacancyState, vacancyFlagsFor } from './vacancyTargetCore.js';
import { missionNextAction } from './missionControlCore.js';
import { governedMissionControlFlagsFor } from './missionControlGovernance.js';

const MODES = new Set(['off', 'beta', 'on']);
const WINDOWS = new Set(['morning', 'afternoon', 'evening']);
const LANGUAGES = new Set(['de']);
const DRILLS = new Set(['satzbau-schmiede', 'sag-es-richtig', 'flow-drill', 'hoer-check', 'shadowing', 'druck-leiter', 'srs']);
const CRITERION_IDS = new Set(['sustained_pace', 'grammar_control', 'speech_recognition_proxy', SERVICE_RECOVERY_CRITERION_ID,
  'complete_response', 'response_latency', 'filler_dependence', 'connected_answer_structure', 'lexical_range_proxy']);
// These criterion-to-skill pairs share one exact observable metric. Other criteria may still guide
// a conservative BrainGuide drill, but cannot create a personalized dose or later claim improvement
// through a different proxy metric.
const EXACT_CRITERION_SKILLS = Object.freeze({
  speech_recognition_proxy: 'pronunciation-phone',
  [SERVICE_RECOVERY_CRITERION_ID]: 'deescalate',
  complete_response: 'no-freeze-expected',
});
const SPEAKING_MATCHED_RETEST_DELAY_MS = 24 * 60 * 60 * 1000;
const SPEAKING_TRANSFER_RETEST_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const PROTOCOLS = Object.freeze({
  'satzbau-schmiede': { repetitions: 6, durationSeconds: 600, minimumSpacingMinutes: 240, successGate: 'Jeden verfehlten Satz später zweimal korrekt bilden.' },
  'sag-es-richtig': { repetitions: 8, durationSeconds: 600, minimumSpacingMinutes: 240, successGate: 'Jeden verfehlten Satz in zwei getrennten Versuchen korrekt produzieren.' },
  'flow-drill': { repetitions: 3, durationSeconds: 195, minimumSpacingMinutes: 360, successGate: 'Den vollständigen 90-/60-/45-Sekunden-Satz ohne Abbruch abschließen.' },
  'hoer-check': { repetitions: 5, durationSeconds: 600, minimumSpacingMinutes: 240, successGate: 'Mindestens vier von fünf Aufgaben korrekt lösen; jede Aufgabe höchstens zweimal hören.' },
  shadowing: { repetitions: 4, durationSeconds: 480, minimumSpacingMinutes: 240, successGate: 'Jeden verfehlten Satz in zwei getrennten Versuchen erfolgreich nachsprechen.' },
  'druck-leiter': { repetitions: 5, durationSeconds: 600, minimumSpacingMinutes: 240, successGate: 'Die verfehlte Antwort üben, bevor dieselbe Stufe erneut versucht wird.' },
  srs: { repetitions: 8, durationSeconds: 600, minimumSpacingMinutes: 240, successGate: 'Jeden verfehlten Satz in zwei getrennten Versuchen korrekt produzieren.' },
});
const SKILL_LABELS = Object.freeze({
  'word-order-sub': 'Satzstellung', 'dativ-akkusativ': 'Dativ und Akkusativ', 'konjunktiv-2': 'Konjunktiv II',
  'fluency-interrupt': 'flüssiges Sprechen unter Zeitdruck', 'listen-phone': 'Hörverstehen am Telefon',
  'listen-clear': 'Hörverstehen', deescalate: 'Deeskalation', 'no-freeze-expected': 'Antworten unter Druck',
  'pronunciation-phone': 'Verständlichkeit am Telefon', 'self-intro': 'Selbstvorstellung',
});
const IMPROVEMENT_METRICS = Object.freeze({
  'word-order-sub': { key: 'grammar_errors', label: 'Satzstellungsfehler', unit: 'Fehler', direction: 'lower', minimumDelta: 1 },
  'dativ-akkusativ': { key: 'grammar_errors', label: 'Dativ-/Akkusativfehler', unit: 'Fehler', direction: 'lower', minimumDelta: 1 },
  'konjunktiv-2': { key: 'grammar_errors', label: 'Konjunktiv-II-Fehler', unit: 'Fehler', direction: 'lower', minimumDelta: 1 },
  'fluency-interrupt': { key: 'fluency_score', label: 'Sprechfluss unter Druck', unit: 'Punkte', direction: 'higher', minimumDelta: 5 },
  deescalate: { key: 'deescalation_score', label: 'Deeskalation', unit: 'Punkte', direction: 'higher', minimumDelta: 5 },
  'no-freeze-expected': { key: 'response_continuity', label: 'Antwortkontinuität', unit: 'Punkte', direction: 'higher', minimumDelta: 5 },
  'pronunciation-phone': { key: 'intelligibility_score', label: 'Verständlichkeit am Telefon', unit: 'Punkte', direction: 'higher', minimumDelta: 3 },
  'listen-clear': { key: 'listening_accuracy', label: 'Hörverständnis beim ersten Hören', unit: 'Prozent', direction: 'higher', minimumDelta: 10 },
  'listen-phone': { key: 'listening_accuracy', label: 'Hörverständnis am Telefon', unit: 'Prozent', direction: 'higher', minimumDelta: 10 },
});
const RETEST_DOSSIERS = Object.freeze({
  'word-order-sub': {
    matched: 'Verbendstellung in Nebensätzen mit weil, dass oder wenn',
    transfer: 'Verbendstellung in einer neuen unerwarteten Kundensituation mit anderen weil-, dass- oder wenn-Fragen',
  },
  'dativ-akkusativ': {
    matched: 'sichere Dativ- und Akkusativformen in vollständigen Antworten',
    transfer: 'Dativ und Akkusativ in einer neuen Reklamations- oder Kontowechsel-Situation mit unbekannten Details',
  },
  'konjunktiv-2': {
    matched: 'höfliche und hypothetische Antworten mit Konjunktiv II',
    transfer: 'Konjunktiv II in einer neuen Kulanz- oder Eskalationssituation ohne wiederholte Musterfrage',
  },
  'fluency-interrupt': {
    matched: 'flüssiges Weiterantworten nach einer natürlichen Unterbrechung',
    transfer: 'flüssiges Weiterantworten nach einer unerwarteten Unterbrechung in einem neuen Kundenszenario',
  },
  deescalate: {
    matched: 'ruhige Deeskalation eines verärgerten Kunden mit einer konkreten Lösung',
    transfer: 'Deeskalation eines neuen Kundentyps mit anderem Einwand, anderer Ursache und neuer Lösungsgrenze',
  },
  'no-freeze-expected': {
    matched: 'eine vollständige Antwort unter unerwartetem Nachfragen statt Abbruch',
    transfer: 'eine vollständige Antwort auf ein neues unerwartetes Nachfragen in einer anderen Interviewphase',
  },
  'pronunciation-phone': {
    matched: 'klar verständliche vollständige Sätze in einer Telefonsituation',
    transfer: 'klar verständliche Sätze mit neuen Namen, Zahlen und Fachwörtern in einer anderen Telefonsituation',
  },
});

function boundedString(value, max = 80) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function hash(value, length) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length); }

function roundMetric(value) { return Math.round(Number(value) * 10) / 10; }
function metricForSkill(skillId) { return Object.hasOwn(IMPROVEMENT_METRICS, skillId) ? IMPROVEMENT_METRICS[skillId] : null; }
export function measurementForSkill(profile, skillId, { sessionId = null } = {}) {
  const metric = metricForSkill(skillId);
  if (!metric) return null;
  if (metric.key === 'listening_accuracy') {
    const summary = listeningEvidenceSummary(profile, skillId);
    if (!summary) return null;
    return { metricKey: metric.key, value: roundMetric(summary.accuracy * 100), measuredAt: summary.measuredAt,
      evidenceId: hash({ skillId, evidenceIds: summary.evidenceIds }, 12) };
  }
  return speakingMeasurementForSkill(profile, skillId, { sessionId });
}

function normalizeMeasurement(value, skillId) {
  const metric = metricForSkill(skillId);
  if (!metric || value?.metricKey !== metric.key || !Number.isFinite(value?.value) || !Number.isFinite(value?.measuredAt)
    || !/^[a-f0-9]{12}$/u.test(value?.evidenceId || '')) return null;
  return { metricKey: metric.key, value: roundMetric(value.value), measuredAt: Number(value.measuredAt), evidenceId: value.evidenceId,
    sourceSessionId: boundedString(value.sourceSessionId, 100) || null,
    contextId: /^[a-f0-9]{12}$/u.test(value.contextId || '') ? value.contextId : null,
    noveltyId: /^[a-f0-9]{12}$/u.test(value.noveltyId || '') ? value.noveltyId : null };
}

function normalizeImprovementProof(value) {
  const skillId = boundedString(value?.skillId, 60); const metric = metricForSkill(skillId);
  if (!metric || !/^[a-f0-9]{16}$/u.test(value?.id || '') || !/^[a-f0-9]{16}$/u.test(value?.prescriptionId || '')
    || !['improved', 'held', 'regressed'].includes(value?.status) || !Number.isFinite(value?.before)
    || !Number.isFinite(value?.after) || !Number.isFinite(value?.verifiedAt)) return null;
  const phase = value.phase === 'transfer' ? 'transfer' : 'matched';
  const contextId = /^[a-f0-9]{12}$/u.test(value.contextId || '') ? value.contextId : null;
  const noveltyId = /^[a-f0-9]{12}$/u.test(value.noveltyId || '') ? value.noveltyId : null;
  const comparedContextId = /^[a-f0-9]{12}$/u.test(value.comparedContextId || '') ? value.comparedContextId : null;
  const comparedNoveltyId = /^[a-f0-9]{12}$/u.test(value.comparedNoveltyId || '') ? value.comparedNoveltyId : null;
  if (phase === 'transfer' && (!contextId || !noveltyId || !comparedContextId || !comparedNoveltyId
    || contextId === comparedContextId || noveltyId === comparedNoveltyId)) return null;
  return { id: value.id, prescriptionId: value.prescriptionId, skillId, metricKey: metric.key,
    before: roundMetric(value.before), after: roundMetric(value.after), status: value.status,
    phase, verifiedAt: Number(value.verifiedAt), measuredAt: Number(value.measuredAt) || Number(value.verifiedAt),
    measurementEvidenceId: /^[a-f0-9]{12}$/u.test(value.measurementEvidenceId || '') ? value.measurementEvidenceId : null,
    retestSessionId: boundedString(value.retestSessionId, 100) || null,
    baselineSessionId: boundedString(value.baselineSessionId, 100) || null,
    baselineMeasurementEvidenceId: /^[a-f0-9]{12}$/u.test(value.baselineMeasurementEvidenceId || '')
      ? value.baselineMeasurementEvidenceId : null,
    comparedValue: Number.isFinite(value.comparedValue) ? roundMetric(value.comparedValue) : null,
    comparedMeasurementEvidenceId: /^[a-f0-9]{12}$/u.test(value.comparedMeasurementEvidenceId || '')
      ? value.comparedMeasurementEvidenceId : null,
    comparedRetestSessionId: boundedString(value.comparedRetestSessionId, 100) || null,
    comparedProofId: /^[a-f0-9]{16}$/u.test(value.comparedProofId || '') ? value.comparedProofId : null,
    contextId, noveltyId, comparedContextId, comparedNoveltyId };
}

function publicImprovementProof(value) {
  const proof = normalizeImprovementProof(value); if (!proof) return null;
  const metric = metricForSkill(proof.skillId);
  return { id: proof.id, skillId: proof.skillId, skillLabel: SKILL_LABELS[proof.skillId] || proof.skillId,
    metricLabel: metric.label, unit: metric.unit, direction: metric.direction,
    before: proof.before, after: proof.after, delta: roundMetric(proof.after - proof.before),
    phase: proof.phase, status: proof.status, verifiedAt: proof.verifiedAt };
}

export function publicListeningRetest(profile, skillId, state = null) {
  if (!['listen-clear', 'listen-phone'].includes(skillId)) return null;
  const normalized = normalizeSalmaCoachState(state);
  const prescription = normalized.activePrescription;
  const proof = listeningRetestEvidence(profile, skillId, { prescription });
  const trainingComplete = prescription?.skillId === skillId
    && (normalized.coachState.completedBlocks[prescription.id] || 0) === prescription.blocks;
  const safeSummary = (summary) => summary ? {
    sampleSize: summary.sampleSize,
    accuracy: roundMetric(summary.accuracy * 100),
    firstPlayAccuracy: roundMetric(summary.firstPlayAccuracy * 100),
    replayRate: roundMetric(summary.replayRate * 100),
    measuredAt: summary.measuredAt,
  } : null;
  return {
    skillId,
    trainingComplete,
    phase: proof.phase,
    outcome: proof.outcome,
    completed: proof.completed,
    required: proof.required,
    nextEligibleAt: proof.nextEligibleAt,
    baseline: safeSummary(proof.baseline),
    matched: safeSummary(proof.matched),
    transfer: safeSummary(proof.transfer),
  };
}

function speakingRetestState(state, now = Date.now()) {
  const normalized = normalizeSalmaCoachState(state); const prescription = normalized.activePrescription;
  if (!prescription || !prescription.baseline || !metricForSkill(prescription.skillId)
    || !Object.hasOwn(RETEST_DOSSIERS, prescription.skillId)) return null;
  const drill = normalized.coachState.repeatedErrorCounts[prescription.id];
  if ((normalized.coachState.completedBlocks[prescription.id] || 0) !== prescription.blocks
    || !Number.isFinite(drill?.completedAt)) return null;
  const proofs = normalized.coachState.improvementHistory.filter((proof) => proof.prescriptionId === prescription.id);
  const matched = proofs.find((proof) => proof.phase === 'matched') || null;
  const transfer = proofs.find((proof) => proof.phase === 'transfer') || null;
  if (transfer) return { phase: 'complete', nextEligibleAt: null, prescription, matched, transfer };
  if (matched) {
    if (matched.status !== 'improved') return { phase: 'complete', nextEligibleAt: null, prescription, matched, transfer: null };
    return { phase: 'transfer', nextEligibleAt: matched.verifiedAt + SPEAKING_TRANSFER_RETEST_DELAY_MS,
      eligible: now >= matched.verifiedAt + SPEAKING_TRANSFER_RETEST_DELAY_MS, prescription, matched, transfer: null };
  }
  return { phase: 'matched', nextEligibleAt: drill.completedAt + SPEAKING_MATCHED_RETEST_DELAY_MS,
    eligible: now >= drill.completedAt + SPEAKING_MATCHED_RETEST_DELAY_MS, prescription, matched: null, transfer: null };
}

export function publicSpeakingRetest(state, now = Date.now()) {
  const proof = speakingRetestState(state, now);
  if (!proof) return null;
  return { skillId: proof.prescription.skillId, phase: proof.phase, nextEligibleAt: proof.nextEligibleAt,
    matched: publicImprovementProof(proof.matched), transfer: publicImprovementProof(proof.transfer) };
}

// BrainGuide and Salma must expose the same next action. A matching drill event is only an
// observation; it does not finish the prescribed dose. This gate turns the durable tutor state into
// one copy-free decision input so the brain cannot announce a live retest after the first good rep,
// or reopen a completed block while its delayed retest is not eligible yet.
export function salmaCoachBrainGate(state, profile, now = Date.now()) {
  const normalized = normalizeSalmaCoachState(state);
  const prescription = normalized.activePrescription;
  if (!prescription) return null;
  const completedBlocks = normalized.coachState.completedBlocks[prescription.id] || 0;
  if (completedBlocks < prescription.blocks) {
    const nextEligibleAt = completedBlocks > 0 ? Number(prescription.nextEligibleAt) || null : null;
    const spacingActive = Number.isFinite(nextEligibleAt) && now < nextEligibleAt;
    return { skillId: prescription.skillId, drillId: prescription.drillId,
      status: spacingActive ? 'wait' : 'practice', action: spacingActive ? 'wait' : 'drill',
      phase: spacingActive ? 'dose_spacing' : `practice_block_${completedBlocks + 1}`,
      nextEligibleAt: spacingActive ? nextEligibleAt : null };
  }
  if (prescription.skillId === 'listen-clear' || prescription.skillId === 'listen-phone') {
    const proof = listeningRetestEvidence(profile, prescription.skillId, { prescription });
    if (proof.phase === 'complete' || proof.phase === 'failed') return null;
    if (proof.phase === 'baseline' || proof.phase === 'dose') {
      return { skillId: prescription.skillId, drillId: prescription.drillId,
        status: 'practice', action: 'drill', phase: proof.phase, nextEligibleAt: null };
    }
    const eligible = Number.isFinite(proof.nextEligibleAt) && now >= proof.nextEligibleAt;
    return { skillId: prescription.skillId, drillId: prescription.drillId,
      status: eligible ? 'retest' : 'wait', action: eligible ? 'drill' : 'wait',
      phase: proof.phase, nextEligibleAt: proof.nextEligibleAt };
  }
  const retest = speakingRetestState(normalized, now);
  if (!retest) {
    return { skillId: prescription.skillId, drillId: prescription.drillId,
      status: 'practice', action: 'drill', phase: 'practice', nextEligibleAt: null };
  }
  if (retest.phase === 'complete') return null;
  const exactTarget = retest.eligible ? salmaRetestTarget(normalized, profile, now) : null;
  return { skillId: prescription.skillId, drillId: prescription.drillId,
    status: retest.eligible ? 'retest' : 'wait', action: retest.eligible ? 'interview' : 'wait',
    phase: retest.eligible && !exactTarget ? 'rebaseline' : retest.phase, nextEligibleAt: retest.nextEligibleAt };
}

export function salmaRetestTarget(state, profile, now = Date.now()) {
  const normalized = normalizeSalmaCoachState(state); const prescription = normalized.activePrescription;
  const retest = speakingRetestState(normalized, now);
  if (!retest || retest.phase === 'complete' || !retest.eligible) return null;
  const grammarName = profile?.weakLog?.[prescription.skillId]?.ltName;
  const dossiers = Object.hasOwn(RETEST_DOSSIERS, prescription.skillId) ? RETEST_DOSSIERS[prescription.skillId] : null;
  const dossier = dossiers?.[retest.phase] || null;
  if (!dossier) return null;
  const baselineSessionId = boundedString(prescription.baseline?.sourceSessionId, 100);
  const baselineSession = reliableSpeakingSessions(profile)
    .find((session) => boundedString(session?.sessionId, 100) === baselineSessionId);
  const baselineTask = speakingTaskContractForSession(baselineSession);
  const baselineMeasurement = measurementForSkill(profile, prescription.skillId, { sessionId: baselineSessionId });
  if (!baselineSession || !baselineTask || !baselineMeasurement?.contextId || !baselineMeasurement?.noveltyId
    || baselineMeasurement.contextId !== prescription.baseline?.contextId
    || baselineMeasurement.noveltyId !== prescription.baseline?.noveltyId) return null;
  const matchedSessionId = boundedString(retest.matched?.retestSessionId, 100);
  const matchedSession = retest.phase === 'transfer'
    ? reliableSpeakingSessions(profile).find((session) => boundedString(session?.sessionId, 100) === matchedSessionId) : null;
  const matchedTask = retest.phase === 'transfer' ? speakingTaskContractForSession(matchedSession) : null;
  const matchedMeasurement = retest.phase === 'transfer'
    ? measurementForSkill(profile, prescription.skillId, { sessionId: matchedSessionId }) : null;
  if (retest.phase === 'transfer' && (!matchedSession || !matchedTask
    || !matchedMeasurement?.contextId || !matchedMeasurement?.noveltyId
    || matchedMeasurement.contextId !== retest.matched?.contextId
    || matchedMeasurement.noveltyId !== retest.matched?.noveltyId)) return null;
  const scenarioId = baselineTask.scenarioId;
  const matchedScenarioId = matchedTask?.scenarioId || '';
  const roleType = baselineTask.roleType;
  if (!scenarioId || !roleType || !scenarioSupportsRole(scenarioId, roleType)) return null;
  const excludedBehavioralPromptIds = retest.phase === 'transfer'
    ? [...new Set([baselineTask.behavioralPromptId, matchedTask?.behavioralPromptId].filter(Boolean))] : [];
  const excludedScreeningPromptIds = retest.phase === 'transfer'
    ? [...new Set([baselineTask.screeningPromptId, matchedTask?.screeningPromptId].filter(Boolean))] : [];
  if (retest.phase === 'transfer'
    && (!availableInterviewPromptIds('behavioral', baselineTask.levelId, excludedBehavioralPromptIds).length
      || !availableInterviewPromptIds('screening', baselineTask.levelId, excludedScreeningPromptIds).length)) return null;
  return { prescriptionId: prescription.id, skillId: prescription.skillId,
    phase: retest.phase,
    dossier,
    context: {
      bossId: baselineTask.bossId,
      levelId: baselineTask.levelId,
      roleType,
      scenarioId,
      industryKey: baselineTask.industryKey,
      targetId: baselineTask.targetId,
      contentSeed: baselineTask.contentSeed,
      forcedMood: baselineTask.mood,
      replayContext: baselineTask.replayContext,
      forcedBehavioralPromptId: retest.phase === 'matched' ? baselineTask.behavioralPromptId : null,
      excludedBehavioralPromptIds,
      forcedScreeningPromptId: retest.phase === 'matched' ? baselineTask.screeningPromptId : null,
      excludedScreeningPromptIds,
      forcedScenarioId: retest.phase === 'matched' ? scenarioId : null,
      excludedScenarioIds: retest.phase === 'transfer'
        ? [...new Set([scenarioId, matchedScenarioId].filter(Boolean))] : [],
    },
    grammarRule: ['word-order-sub', 'dativ-akkusativ', 'konjunktiv-2'].includes(prescription.skillId)
      ? boundedString(grammarName, 180) || null : null };
}

export function salmaCoachFlags(env = process.env, account = null) {
  const rawMode = boundedString(env.SALMA_COACH_MODE, 10).toLowerCase();
  const mode = MODES.has(rawMode) ? rawMode : 'off';
  const betaIds = new Set(boundedString(env.SALMA_COACH_BETA_ACCOUNT_IDS, 4000).split(',').map((v) => v.trim()).filter(Boolean));
  const betaAllowed = !!account?.id && (betaIds.has(String(account.id)) || account?.roles?.includes('admin'));
  const enabled = mode === 'on' || (mode === 'beta' && betaAllowed);
  return Object.freeze({ mode, enabled, aiEnabled: enabled && env.SALMA_COACH_AI_ENABLED === 'true',
    voiceEnabled: enabled && env.SALMA_COACH_VOICE_ENABLED === 'true',
    masriPackVersion: enabled ? boundedString(env.SALMA_MASRI_PACK_VERSION, 40) || null : null });
}

export function salmaCoachCapabilities(account) {
  const trial = trialActive(account); const plan = planOf(account); const depth = trial ? 'elite' : plan;
  return Object.freeze({ plan, trial, dailyQuestions: depth === 'elite' ? 60 : depth === 'basic' ? 30 : 3,
    fullTutor: depth === 'basic' || depth === 'elite', vacancyCoaching: depth === 'elite', urgentMode: depth === 'elite' });
}

function normalizeStoredPrescription(value) {
  if (!value || typeof value !== 'object' || !/^[a-f0-9]{16}$/u.test(value.id || '') || !DRILLS.has(value.drillId)) return null;
  const rawCycle = value.listeningCycle;
  const listeningCycle = rawCycle && Number(rawCycle.version) === 2
    && /^[a-f0-9]{64}$/u.test(rawCycle.accountBinding || '')
    && /^[a-f0-9]{16}$/u.test(rawCycle.challengeKey || '')
    && Array.isArray(rawCycle.baselineEvidenceIds)
    && rawCycle.baselineEvidenceIds.length === 5
    && rawCycle.baselineEvidenceIds.every((id) => /^[a-f0-9]{12}$/u.test(id))
    ? { version: 2, accountBinding: rawCycle.accountBinding, challengeKey: rawCycle.challengeKey,
      levelKey: ['A1', 'A2', 'B1', 'B2', 'C1'].includes(rawCycle.levelKey) ? rawCycle.levelKey : 'B1',
      baseRate: Math.max(0.5, Math.min(1.5, Number(rawCycle.baseRate) || 1)),
      baselineEvidenceIds: [...rawCycle.baselineEvidenceIds],
      baselineMeasuredAt: Number(rawCycle.baselineMeasuredAt) || null,
      doseCompletedAt: Number(rawCycle.doseCompletedAt) || null,
      matchedEligibleAt: Number(rawCycle.matchedEligibleAt) || null } : null;
  return { id: value.id, evidenceIds: Array.isArray(value.evidenceIds) ? value.evidenceIds.filter((v) => /^[a-f0-9]{12}$/u.test(v)).slice(0, 5) : [],
    skillId: boundedString(value.skillId, 60), drillId: value.drillId, blocks: Math.max(1, Math.min(2, Number(value.blocks) || 1)),
    repetitions: Math.max(1, Math.min(8, Number(value.repetitions) || 1)), durationSeconds: Math.max(60, Math.min(1800, Number(value.durationSeconds) || 300)),
    timesPerDay: Math.max(1, Math.min(2, Number(value.timesPerDay) || 1)), minimumSpacingMinutes: Math.max(0, Math.min(720, Number(value.minimumSpacingMinutes) || 0)),
    successGate: boundedString(value.successGate, 180), assignedAt: Number(value.assignedAt) || Date.now(), nextEligibleAt: Number(value.nextEligibleAt) || null,
    evidenceConfidence: value.evidenceConfidence === 'high' ? 'high' : 'low',
    criterionId: CRITERION_IDS.has(value.criterionId) ? value.criterionId : null,
    baseline: normalizeMeasurement(value.baseline, boundedString(value.skillId, 60)), listeningCycle };
}

/** One authoritative decision assembler shared by BrainGuide and Salma's public view. */
export function canonicalCoachDirective(profile, account, { now = Date.now(), coachFlags = null } = {}) {
  const snapshot = buildSnapshot(profile, now);
  const vacancyFlags = vacancyFlagsFor(account);
  const vacancyState = vacancyFlags.enabled ? normalizeVacancyState(profile?.vacancyTarget) : null;
  let vacancyDue = vacancyState?.active ? dueVacancyMilestone(vacancyState.active, now) : null;
  if (!vacancyFlags.fullPlan && vacancyDue?.id !== vacancyState?.active?.schedule?.[0]?.id) vacancyDue = null;
  const safeDue = vacancyDue ? {
    id: vacancyDue.id,
    title: vacancyDue.title,
    objective: vacancyDue.objective,
    scheduledDate: vacancyDue.scheduledDate,
    liveRequired: isLiveVacancyMilestone(vacancyDue.id),
  } : null;
  const missionDue = missionNextAction(profile, account, { flags: governedMissionControlFlagsFor(account) });
  const effectiveCoachFlags = coachFlags || salmaCoachFlags(process.env, account);
  const coachGate = effectiveCoachFlags.enabled ? salmaCoachBrainGate(profile?.salmaCoach, profile, now) : null;
  return decide({ ...snapshot, vacancyDue: safeDue, missionDue, coachGate });
}

function normalizeBlockProgress(value, index) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const repairDebt = row.repairDebt && typeof row.repairDebt === 'object' && !Array.isArray(row.repairDebt)
    ? Object.fromEntries(Object.entries(row.repairDebt)
      .filter(([taskHash, debt]) => /^[a-f0-9]{16}$/u.test(taskHash) && debt && typeof debt === 'object')
      .slice(-16).map(([taskHash, debt]) => [taskHash, {
        remaining: Math.max(0, Math.min(2, Number(debt.remaining) || 0)),
        lastAt: Number(debt.lastAt) || null,
      }]).filter(([, debt]) => debt.remaining > 0)) : {};
  return {
    index,
    attempts: Math.max(0, Math.min(100, Number(row.attempts) || 0)),
    correct: Math.max(0, Math.min(100, Number(row.correct) || 0)),
    failures: Math.max(0, Math.min(100, Number(row.failures) || 0)),
    recentOutcomes: Array.isArray(row.recentOutcomes)
      ? row.recentOutcomes.filter((item) => typeof item === 'boolean').slice(-8) : [],
    lastAt: Number(row.lastAt) || null,
    completedAt: Number(row.completedAt) || null,
    eventIds: Array.isArray(row.eventIds)
      ? [...new Set(row.eventIds.filter((id) => /^[a-f0-9]{16}$/u.test(id)))].slice(-100) : [],
    repairDebt,
  };
}

function aggregateBlockProgress(blocks, requiredBlocks) {
  const safeBlocks = blocks.slice(0, requiredBlocks);
  const completed = safeBlocks.filter((block) => Number.isFinite(block.completedAt)).length;
  return {
    attempts: safeBlocks.reduce((sum, block) => sum + block.attempts, 0),
    correct: safeBlocks.reduce((sum, block) => sum + block.correct, 0),
    failures: safeBlocks.reduce((sum, block) => sum + block.failures, 0),
    recentOutcomes: safeBlocks.flatMap((block) => block.recentOutcomes).slice(-8),
    lastAt: safeBlocks.reduce((latest, block) => Math.max(latest || 0, block.lastAt || 0), 0) || null,
    completedAt: completed === requiredBlocks
      ? safeBlocks.reduce((latest, block) => Math.max(latest || 0, block.completedAt || 0), 0) || null
      : null,
    blockProgress: safeBlocks,
    seenEventIds: [...new Set(safeBlocks.flatMap((block) => block.eventIds))].slice(-200),
  };
}

export function normalizeSalmaCoachState(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const pref = raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {};
  const coach = raw.coachState && typeof raw.coachState === 'object' ? raw.coachState : {};
  const storedCompletedBlocks = coach.completedBlocks && typeof coach.completedBlocks === 'object' && !Array.isArray(coach.completedBlocks)
    ? Object.fromEntries(Object.entries(coach.completedBlocks).filter(([k, v]) => /^[a-f0-9]{16}$/u.test(k) && Number.isInteger(v) && v >= 0 && v <= 8).slice(-20)) : {};
  const repeatedErrorCounts = coach.repeatedErrorCounts && typeof coach.repeatedErrorCounts === 'object' && !Array.isArray(coach.repeatedErrorCounts)
    ? Object.fromEntries(Object.entries(coach.repeatedErrorCounts).filter(([k, v]) => /^[a-f0-9]{16}$/u.test(k) && v && typeof v === 'object')
      .slice(-20).map(([k, v]) => {
        const explicit = Array.isArray(v.blockProgress)
          ? v.blockProgress.slice(0, 2).map((block, index) => normalizeBlockProgress(block, index)) : [];
        // v3 stored one aggregate row and could only ever prove one completed block. Preserve that
        // evidence as block one, but never manufacture a second block from an inflated counter.
        const legacy = explicit.length ? explicit : [normalizeBlockProgress(v, 0)];
        const requiredBlocks = Math.max(1, Math.min(2, Number(raw.activePrescription?.id === k
          ? raw.activePrescription?.blocks : legacy.length) || 1));
        while (legacy.length < requiredBlocks) legacy.push(normalizeBlockProgress(null, legacy.length));
        return [k, aggregateBlockProgress(legacy, requiredBlocks)];
      })) : {};
  const completedBlocks = {};
  for (const [id, row] of Object.entries(repeatedErrorCounts)) {
    const modeled = row.blockProgress.filter((block) => Number.isFinite(block.completedAt)).length;
    completedBlocks[id] = Math.min(modeled, Math.max(0, storedCompletedBlocks[id] || modeled));
  }
  const improvementHistory = Array.isArray(coach.improvementHistory)
    ? coach.improvementHistory.map(normalizeImprovementProof).filter(Boolean).slice(-12) : [];
  const lastHandledEventId = /^[a-f0-9]{16}$/u.test(coach.lastHandledEventId || '') ? coach.lastHandledEventId : null;
  const acknowledgedEventIds = Array.isArray(coach.acknowledgedEventIds)
    ? [...new Set(coach.acknowledgedEventIds.filter((id) => /^[a-f0-9]{16}$/u.test(id)))].slice(-24) : [];
  if (lastHandledEventId && !acknowledgedEventIds.includes(lastHandledEventId)) acknowledgedEventIds.push(lastHandledEventId);
  return { version: 3, preferences: { dailyMinutes: [5, 10, 20].includes(Number(pref.dailyMinutes)) ? Number(pref.dailyMinutes) : 10,
    preferredWindows: Array.isArray(pref.preferredWindows) ? [...new Set(pref.preferredWindows.filter((v) => WINDOWS.has(v)))].slice(0, 3) : [],
    languageSupport: LANGUAGES.has(pref.languageSupport) ? pref.languageSupport : 'de', autoSpeak: pref.autoSpeak === true, muted: pref.muted === true },
    activePrescription: normalizeStoredPrescription(raw.activePrescription), coachState: {
      lastHandledEventId, acknowledgedEventIds: acknowledgedEventIds.slice(-24),
      repeatedErrorCounts, completedBlocks, lastRetestSessionId: boundedString(coach.lastRetestSessionId, 100) || null,
      improvementHistory,
      questionUsage: { day: /^\d{4}-\d{2}-\d{2}$/u.test(coach.questionUsage?.day || '') ? coach.questionUsage.day : '',
        count: Number.isInteger(coach.questionUsage?.count) ? Math.max(0, Math.min(100, coach.questionUsage.count)) : 0 } } };
}

function recentReliableSessions(profile, now) {
  return reliableSpeakingSessions(profile).filter((session) => {
    const observedAt = Number(session?.date) || 0;
    return observedAt > 0 && now - observedAt >= 0 && now - observedAt <= 14 * 24 * 60 * 60 * 1000;
  }).sort((a, b) => Number(a?.date || 0) - Number(b?.date || 0));
}
function sessionEvidenceIds(profile, skillId, now) {
  const sessions = recentReliableSessions(profile, now);
  if (skillId === 'deescalate') {
    const latest = [...sessions].reverse().find((session) => serviceRecoveryScoreFromSession(session) != null);
    if (!latest) return [];
    const targetId = latest.vacancyTargetId ?? null;
    return sessions.filter((session) => (session.vacancyTargetId ?? null) === targetId
      && serviceRecoveryScoreFromSession(session) != null)
      .slice(-2).map((session) => hash({ skillId, binding: session.deescalationEvidence.binding }, 12));
  }
  return sessions.slice(-2).map((session) => hash({ date: session?.date || 0, bossId: session?.bossId || '',
    verdict: session?.verdict || '', limitingSkill: session?.hireReadiness?.limitingSkill || session?.limitingSkill || '' }, 12));
}
function evidenceOccurrences(profile, skillId, now) {
  if (skillId === 'listen-clear' || skillId === 'listen-phone') {
    return new Set(listeningEvidence(profile, skillId).map((row) => row.issuedAt)).size;
  }
  const sessions = recentReliableSessions(profile, now);
  if (skillId === 'deescalate') {
    const latest = [...sessions].reverse().find((session) => serviceRecoveryScoreFromSession(session) != null);
    if (!latest) return 0;
    const targetId = latest.vacancyTargetId ?? null;
    return Math.min(2, sessions.filter((session) => (session.vacancyTargetId ?? null) === targetId
      && serviceRecoveryScoreFromSession(session) != null).length);
  }
  const counts = profile?.weakLog?.[skillId]?.errCounts;
  const reliableDates = new Set(sessions.map((session) => Number(session?.date)).filter(Boolean));
  if (Array.isArray(counts)) return counts.filter((row) => Number(row?.count) > 0 && reliableDates.has(Number(row?.date))).length;
  return Math.min(2, reliableDates.size);
}

function resolvedSupportMeasurements(profile, skillId, sessionIds, acceptsMeasurement = () => true) {
  if (!Array.isArray(sessionIds) || sessionIds.length < 1) return null;
  const ids = sessionIds.map((sessionId) => boundedString(sessionId, 100));
  if (ids.some((sessionId) => !sessionId) || new Set(ids).size !== ids.length) return null;
  const measurements = ids.map((sessionId) => measurementForSkill(profile, skillId, { sessionId }));
  if (measurements.some((measurement, index) => !measurement
    || measurement.sourceSessionId !== ids[index] || !acceptsMeasurement(measurement))) return null;
  if (new Set(measurements.map((measurement) => measurement.evidenceId)).size !== measurements.length) return null;
  return measurements;
}

export function deriveSalmaPrescription(profile, { now = Date.now(), dailyMinutes = 10 } = {}) {
  const snapshot = buildSnapshot(profile, now); const directive = decide(snapshot);
  const drillId = directive?.prescription?.action === 'drill' ? directive.prescription.drill : null;
  const skillId = directive?.prescription?.skillId || directive?.target?.skillId || '';
  if (!DRILLS.has(drillId) || !skillId || snapshot.sessionCount < 1) return { directive, prescription: null };
  const criterionId = CRITERION_IDS.has(directive?.prescription?.criterionId) ? directive.prescription.criterionId : null;
  const exactGrammarForecast = snapshot.limitingCriterionId === 'grammar_control'
    && snapshot.limitingGrammarRuleId === skillId;
  const grammarMeasurements = exactGrammarForecast
    ? resolvedSupportMeasurements(profile, skillId, snapshot.limitingGrammarEvidenceSessionIds,
      (measurement) => measurement.value > 8)
    : [];
  if (exactGrammarForecast && !grammarMeasurements?.length) return { directive, prescription: null };
  const exactCriterionForecast = criterionId && criterionId !== 'grammar_control'
    && skillId !== 'listen-clear' && skillId !== 'listen-phone';
  if (exactCriterionForecast && EXACT_CRITERION_SKILLS[criterionId] !== skillId) {
    return { directive, prescription: null };
  }
  const criterionMeasurements = exactCriterionForecast
    ? resolvedSupportMeasurements(profile, skillId, snapshot.limitingEvidenceSessionIds)
    : [];
  if (exactCriterionForecast && !criterionMeasurements?.length) return { directive, prescription: null };
  const protocol = PROTOCOLS[drillId];
  const occurrences = exactGrammarForecast
    ? Math.min(2, grammarMeasurements.length)
    : exactCriterionForecast
      ? Math.min(2, criterionMeasurements.length)
    : evidenceOccurrences(profile, skillId, now);
  const listeningRows = skillId === 'listen-clear' || skillId === 'listen-phone' ? listeningEvidence(profile, skillId) : [];
  const listeningCycle = drillId === 'hoer-check' ? listeningBaselineSnapshot(profile, skillId) : null;
  if (drillId === 'hoer-check' && !listeningCycle) return { directive, prescription: null };
  const durationSeconds = Math.min(protocol.durationSeconds, Math.max(300, [5, 10, 20].includes(Number(dailyMinutes)) ? Number(dailyMinutes) * 60 : 600));
  const conflictCount = exactGrammarForecast
    ? Number(snapshot.limitingGrammarEvidenceConflictCount) || 0
    : exactCriterionForecast ? Number(snapshot.limitingEvidenceConflictCount) || 0 : 0;
  const blocks = occurrences >= 2 && conflictCount === 0 && Number(dailyMinutes) >= 20 ? 2 : 1;
  const evidenceIds = listeningCycle?.baselineEvidenceIds || (listeningRows.length
    ? listeningRows.slice(-5).map((row) => hash(row.attemptId, 12))
    : grammarMeasurements.length ? grammarMeasurements.map((measurement) => measurement.evidenceId)
    : criterionMeasurements.length ? criterionMeasurements.map((measurement) => measurement.evidenceId)
    : sessionEvidenceIds(profile, skillId, now));
  if (!evidenceIds.length) return { directive, prescription: null };
  const baseline = listeningCycle?.baseline || grammarMeasurements.at(-1)
    || criterionMeasurements.at(-1) || measurementForSkill(profile, skillId);
  if (!baseline) return { directive, prescription: null };
  if (!listeningCycle && (!baseline.contextId || !baseline.noveltyId || !baseline.sourceSessionId)) {
    return { directive, prescription: null };
  }
  const evidenceConfidence = directive.confidence === 'high' && occurrences >= 2 && conflictCount === 0 ? 'high' : 'low';
  const identity = { evidenceIds, skillId, drillId, blocks, repetitions: protocol.repetitions, durationSeconds,
    minimumSpacingMinutes: protocol.minimumSpacingMinutes, successGate: protocol.successGate, evidenceConfidence, criterionId,
    listeningCycle: listeningCycle ? { version: listeningCycle.version, challengeKey: listeningCycle.challengeKey,
      baselineEvidenceIds: listeningCycle.baselineEvidenceIds } : null };
  return { directive, prescription: { id: hash(identity, 16), evidenceIds, skillId, drillId, blocks, repetitions: protocol.repetitions,
    durationSeconds, timesPerDay: blocks, minimumSpacingMinutes: protocol.minimumSpacingMinutes, successGate: protocol.successGate,
    assignedAt: now, nextEligibleAt: blocks > 1 ? now + protocol.minimumSpacingMinutes * 60_000 : null,
    evidenceConfidence, criterionId, baseline, listeningCycle } };
}

export function syncSalmaCoach(profile, { now = Date.now() } = {}) {
  archiveListeningCycle(profile, now);
  const state = normalizeSalmaCoachState(profile?.salmaCoach);
  const completedDoseBlocks = state.activePrescription
    ? state.coachState.completedBlocks[state.activePrescription.id] || 0 : 0;
  // Once block one of a multi-block dose is complete, preserve that evidence-bound prescription
  // through its spacing gate and block two. Re-deriving here could silently replace the contract and
  // let the same practice satisfy a different forecast.
  if (state.activePrescription && completedDoseBlocks > 0 && completedDoseBlocks < state.activePrescription.blocks) {
    profile.salmaCoach = state;
    return { state, directive: decide(buildSnapshot(profile, now)) };
  }
  if (state.activePrescription?.listeningCycle
    && (state.activePrescription.skillId === 'listen-clear' || state.activePrescription.skillId === 'listen-phone')) {
    const proof = listeningRetestEvidence(profile, state.activePrescription.skillId,
      { prescription: state.activePrescription });
    if (proof.phase !== 'complete' && proof.phase !== 'failed') {
      profile.salmaCoach = state;
      return { state, directive: decide(buildSnapshot(profile, now)) };
    }
  }
  const activeRetest = speakingRetestState(state, now);
  if (activeRetest && activeRetest.phase !== 'complete') {
    const exactTarget = activeRetest.eligible ? salmaRetestTarget(state, profile, now) : null;
    if (!activeRetest.eligible || exactTarget) {
      profile.salmaCoach = state;
      return { state, directive: decide(buildSnapshot(profile, now)) };
    }
    // A legacy or corrupt baseline cannot be replayed honestly. Retire it rather than trapping the
    // learner in an endless fake "matched" loop; the latest reliable diagnostic may create a fresh,
    // fully bound prescription below.
    state.activePrescription = null;
  }
  const { directive, prescription } = deriveSalmaPrescription(profile, { now, dailyMinutes: state.preferences.dailyMinutes });
  if (prescription && state.activePrescription?.id === prescription.id) { prescription.assignedAt = state.activePrescription.assignedAt; prescription.nextEligibleAt = state.activePrescription.nextEligibleAt; }
  state.activePrescription = prescription; profile.salmaCoach = state; return { state, directive };
}

function drillEventIdentity(prescription, event, blockIndex, now) {
  if (/^[a-f0-9]{16}$/u.test(event?.eventId || '')) return event.eventId;
  return hash({ prescriptionId: prescription.id, blockIndex, drill: event?.drill,
    taskHash: /^[a-f0-9]{16}$/u.test(event?.taskHash || '') ? event.taskHash : null,
    correct: event?.correct === true ? true : event?.correct === false ? false : null,
    froze: event?.froze === true, completedSet: event?.completedSet === true,
    at: Number(event?.at) || now }, 16);
}

function storeSeenEvent(row, blockIndex, eventId) {
  const target = row.blockProgress[blockIndex];
  if (target && !target.eventIds.includes(eventId)) target.eventIds = [...target.eventIds, eventId].slice(-100);
}

export function recordDrillOutcome(state, event, now = Date.now()) {
  const next = normalizeSalmaCoachState(state); const p = next.activePrescription;
  const completedSet = event?.completedSet === true && p?.drillId === 'flow-drill';
  if (!p || event?.drill !== p.drillId || (event.correct !== true && event.correct !== false && event.froze !== true && !completedSet)) return next;
  // Spoken Review contains many unrelated vocabulary and grammar cards under one drill name. Only
  // a server-graded card for the exact active prescription may advance its dose; drill-name equality
  // alone would let unrelated practice manufacture completion.
  if (p.drillId === 'sag-es-richtig' && (event?.verified !== true
    || event?.prescriptionId !== p.id || event?.skillId !== p.skillId || event?.phase !== 'practice'
    || !/^[a-f0-9]{16}$/u.test(event?.taskHash || '')
    || !Number.isFinite(event?.verifiedAt) || event.verifiedAt < p.assignedAt || event.verifiedAt > now + 5_000)) return next;
  if (p.drillId === 'hoer-check' && (event?.prescriptionId !== p.id || event?.skillId !== p.skillId
    || event?.phase !== 'practice')) return next;
  const requiredBlocks = p.blocks;
  const completedBlocks = next.coachState.completedBlocks[p.id] || 0;
  if (completedBlocks >= requiredBlocks) return next;
  const row = next.coachState.repeatedErrorCounts[p.id] || aggregateBlockProgress(
    Array.from({ length: requiredBlocks }, (_, index) => normalizeBlockProgress(null, index)), requiredBlocks);
  while (row.blockProgress.length < requiredBlocks) row.blockProgress.push(normalizeBlockProgress(null, row.blockProgress.length));
  const blockIndex = completedBlocks;
  const current = row.blockProgress[blockIndex];
  const eventId = drillEventIdentity(p, event, blockIndex, now);
  if (row.seenEventIds.includes(eventId) || current.eventIds.includes(eventId)) return next;
  // A stale/out-of-order event and every event before block two's spacing boundary are permanently
  // consumed without credit. Replaying either later must never convert it into valid evidence.
  const priorCompletedAt = blockIndex > 0 ? row.blockProgress[blockIndex - 1]?.completedAt : null;
  const nextBlockEligibleAt = blockIndex > 0 && Number.isFinite(priorCompletedAt)
    ? priorCompletedAt + p.minimumSpacingMinutes * 60_000 : null;
  if (now < p.assignedAt || (Number.isFinite(current.lastAt) && now <= current.lastAt)
    || (Number.isFinite(nextBlockEligibleAt) && now < nextBlockEligibleAt)) {
    storeSeenEvent(row, blockIndex, eventId);
    next.coachState.repeatedErrorCounts[p.id] = aggregateBlockProgress(row.blockProgress, requiredBlocks);
    return next;
  }
  const failed = event.correct === false || event.froze === true;
  const credit = completedSet ? p.repetitions : 1;
  current.attempts += credit;
  current.correct += failed ? 0 : credit;
  current.failures += failed ? 1 : 0;
  if (p.drillId === 'sag-es-richtig') {
    const taskHash = event.taskHash;
    if (failed) current.repairDebt[taskHash] = { remaining: 2, lastAt: now };
    else if (current.repairDebt[taskHash]?.remaining > 0) {
      const remaining = current.repairDebt[taskHash].remaining - 1;
      if (remaining > 0) current.repairDebt[taskHash] = { remaining, lastAt: now };
      else delete current.repairDebt[taskHash];
    }
  }
  current.recentOutcomes = p.drillId === 'hoer-check'
    ? [...current.recentOutcomes, !failed].slice(-p.repetitions) : current.recentOutcomes;
  current.lastAt = now;
  current.eventIds = [...current.eventIds, eventId].slice(-100);
  const requiredCorrect = Math.min(24, p.repetitions + current.failures * 2);
  const listeningBlockPassed = p.drillId === 'hoer-check' && current.recentOutcomes.length === p.repetitions
    && current.recentOutcomes.filter(Boolean).length >= 4;
  const repairsCleared = p.drillId !== 'sag-es-richtig' || Object.keys(current.repairDebt).length === 0;
  if (listeningBlockPassed || (p.drillId !== 'hoer-check' && current.correct >= requiredCorrect && repairsCleared)) {
    current.completedAt ||= now;
    next.coachState.completedBlocks[p.id] = blockIndex + 1;
    p.nextEligibleAt = blockIndex + 1 < requiredBlocks
      ? current.completedAt + p.minimumSpacingMinutes * 60_000 : null;
    if (p.drillId === 'hoer-check' && p.listeningCycle && blockIndex + 1 === requiredBlocks) {
      p.listeningCycle.doseCompletedAt ||= current.completedAt;
      p.listeningCycle.matchedEligibleAt ||= current.completedAt + 24 * 60 * 60 * 1000;
    }
  }
  next.coachState.repeatedErrorCounts[p.id] = aggregateBlockProgress(row.blockProgress, requiredBlocks);
  return next;
}

export function prescriptionDoseProgress(state) {
  const normalized = normalizeSalmaCoachState(state);
  const prescription = normalized.activePrescription;
  if (!prescription) return null;
  const completedBlocks = normalized.coachState.completedBlocks[prescription.id] || 0;
  const row = normalized.coachState.repeatedErrorCounts[prescription.id];
  const block = row?.blockProgress?.[Math.min(completedBlocks, prescription.blocks - 1)] || null;
  const requiredCorrect = Math.min(24, prescription.repetitions + (block?.failures || 0) * 2);
  return {
    prescriptionId: prescription.id,
    skillId: prescription.skillId,
    drillId: prescription.drillId,
    completed: completedBlocks >= prescription.blocks,
    completedBlocks,
    blocks: prescription.blocks,
    correct: block?.correct || 0,
    requiredCorrect,
    remainingRepetitions: completedBlocks >= prescription.blocks
      ? 0 : Math.max(0, requiredCorrect - (block?.correct || 0)),
    repairsRemaining: block ? Object.values(block.repairDebt || {})
      .reduce((sum, debt) => sum + (Number(debt.remaining) || 0), 0) : 0,
  };
}

export function recordMeaningfulRetest(state, profile, { sessionId, skillId, phase, now = Date.now() } = {}) {
  const next = normalizeSalmaCoachState(state); const prescription = next.activePrescription;
  const safeId = boundedString(sessionId, 100);
  if (!safeId || !prescription || prescription.skillId !== skillId || !prescription.baseline
    || (next.coachState.completedBlocks[prescription.id] || 0) !== prescription.blocks) return next;
  if (next.coachState.improvementHistory.some((proof) => proof.retestSessionId === safeId)) return next;
  const expected = speakingRetestState(next, now);
  if (!expected || expected.phase === 'complete' || expected.eligible !== true || phase !== expected.phase) return next;
  // Bind the score to the exact server-recorded fight that requested closure. A newer unrelated
  // session must never be substituted merely because it is last in the profile.
  const followup = measurementForSkill(profile, skillId, { sessionId: safeId });
  if (!followup || followup.sourceSessionId !== safeId) return next;
  const previousMeasurement = expected.phase === 'transfer' && expected.matched
    ? { value: expected.matched.after, measuredAt: expected.matched.measuredAt,
      evidenceId: expected.matched.measurementEvidenceId, sourceSessionId: expected.matched.retestSessionId }
    : prescription.baseline;
  if (followup.measuredAt <= previousMeasurement.measuredAt
    || (previousMeasurement.evidenceId && followup.evidenceId === previousMeasurement.evidenceId)) return next;
  const comparedContextId = expected.phase === 'transfer' ? expected.matched?.contextId : prescription.baseline?.contextId;
  const comparedNoveltyId = expected.phase === 'transfer' ? expected.matched?.noveltyId : prescription.baseline?.noveltyId;
  const baselineContextId = prescription.baseline?.contextId;
  const baselineNoveltyId = prescription.baseline?.noveltyId;
  if (!followup.contextId || !followup.noveltyId || !baselineContextId || !baselineNoveltyId) return next;
  if (expected.phase === 'matched'
    && (followup.contextId !== baselineContextId || followup.noveltyId !== baselineNoveltyId)) return next;
  if (expected.phase === 'transfer' && (!comparedContextId || !comparedNoveltyId
    || followup.contextId === comparedContextId || followup.noveltyId === comparedNoveltyId
    || followup.contextId === baselineContextId || followup.noveltyId === baselineNoveltyId)) return next;
  const metric = metricForSkill(skillId); const rawDelta = followup.value - prescription.baseline.value;
  const signedImprovement = metric.direction === 'higher' ? rawDelta : -rawDelta;
  const matchedRegression = expected.phase === 'transfer'
    ? (metric.direction === 'higher' ? previousMeasurement.value - followup.value : followup.value - previousMeasurement.value)
    : 0;
  const status = expected.phase === 'transfer' && matchedRegression > metric.minimumDelta ? 'regressed'
    : signedImprovement >= metric.minimumDelta ? 'improved'
    : signedImprovement <= -metric.minimumDelta ? 'regressed' : 'held';
  const proof = normalizeImprovementProof({
    id: hash({ prescriptionId: prescription.id, skillId, before: prescription.baseline.value,
      after: followup.value, retestSessionId: safeId, phase: expected.phase,
      contextId: followup.contextId, noveltyId: followup.noveltyId,
      comparedContextId, comparedNoveltyId, comparedMeasurementEvidenceId: previousMeasurement.evidenceId }, 16),
    prescriptionId: prescription.id, skillId, before: prescription.baseline.value, after: followup.value,
    phase: expected.phase, status, verifiedAt: now, measuredAt: followup.measuredAt,
    measurementEvidenceId: followup.evidenceId, retestSessionId: safeId,
    baselineSessionId: prescription.baseline.sourceSessionId,
    baselineMeasurementEvidenceId: prescription.baseline.evidenceId,
    comparedValue: previousMeasurement.value,
    comparedMeasurementEvidenceId: previousMeasurement.evidenceId,
    comparedRetestSessionId: previousMeasurement.sourceSessionId,
    comparedProofId: expected.phase === 'transfer' ? expected.matched?.id : null,
    contextId: followup.contextId, noveltyId: followup.noveltyId,
    comparedContextId, comparedNoveltyId,
  });
  next.coachState.lastRetestSessionId = safeId;
  next.coachState.improvementHistory = [...next.coachState.improvementHistory, proof].filter(Boolean).slice(-12);
  return next;
}

export function salmaCoachEventId(value) { return hash(value, 16); }

export function safeIntervention(state, now = Date.now(), profile = null) {
  const p = state?.activePrescription;
  const history = state?.coachState?.improvementHistory || [];
  const latestProofCandidate = publicImprovementProof(history[history.length - 1]);
  const transferIsValid = !latestProofCandidate || latestProofCandidate.phase !== 'transfer'
    || latestProofCandidate.status !== 'improved' || !profile
    || validatedTransferProofs(profile, now).some((proof) => proof.skillId === latestProofCandidate.skillId
      && proof.verifiedAt === latestProofCandidate.verifiedAt);
  const latestProof = transferIsValid ? latestProofCandidate : null;
  const acknowledged = new Set([...(state?.coachState?.acknowledgedEventIds || []), state?.coachState?.lastHandledEventId].filter(Boolean));
  if (latestProof && !acknowledged.has(latestProof.id)) {
    const result = latestProof.status === 'improved' && latestProof.phase === 'transfer'
      ? 'Die Verbesserung hat auch in einer neuen Transfersituation gehalten.'
      : latestProof.status === 'improved' ? 'Die Verbesserung ist im passenden Vergleichstest bestätigt; der spätere Transfer steht noch aus.'
      : latestProof.status === 'regressed' ? 'Der Retest war schwächer; ich passe deinen nächsten Schritt an.'
        : 'Der Retest hielt das Niveau; wir trainieren den Engpass gezielter weiter.';
    return { id: latestProof.id, kind: 'verified_retest',
      text: `${latestProof.skillLabel}: ${latestProof.before} → ${latestProof.after} ${latestProof.unit}. ${result}`,
      nextAction: 'BrainGuide hat aus diesem Retest bereits den nächsten höchsten Hebel gewählt.', speakable: true };
  }
  const doseGate = p && (!['listen-clear', 'listen-phone'].includes(p.skillId) || profile)
    ? salmaCoachBrainGate(state, profile, now) : null;
  if (p && doseGate?.phase === 'dose_spacing') {
    const id = hash({ prescriptionId: p.id, phase: doseGate.phase, nextEligibleAt: doseGate.nextEligibleAt }, 16);
    if (acknowledged.has(id)) return null;
    const when = new Intl.DateTimeFormat('de-DE', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(doseGate.nextEligibleAt));
    return { id, kind: 'dose_spacing', text: `Block 1 von ${p.blocks} ist abgeschlossen.`,
      nextAction: `Block 2 beginnt frühestens am ${when} Uhr (Kairo). Frühere Wiederholungen zählen nicht zum zweiten Block.`,
      speakable: true };
  }
  if (p && doseGate?.phase === 'practice_block_2') {
    const id = hash({ prescriptionId: p.id, phase: doseGate.phase }, 16);
    if (acknowledged.has(id)) return null;
    return { id, kind: 'dose_ready', text: `Block 2 von ${p.blocks} ist jetzt fällig.`,
      nextAction: `Mache erneut ${p.repetitions} Wiederholungen im ${p.drillId}. Erst danach beginnt das Retest-Fenster.`,
      speakable: true };
  }
  const listeningGate = p && ['listen-clear', 'listen-phone'].includes(p.skillId) && profile
    ? salmaCoachBrainGate(state, profile, now) : null;
  if (p && listeningGate && listeningGate.status !== 'practice') {
    const kind = listeningGate.status === 'retest' ? 'retest_ready' : 'retest_wait';
    const id = hash({ prescriptionId: p.id, phase: listeningGate.phase, kind,
      nextEligibleAt: listeningGate.nextEligibleAt }, 16);
    if (acknowledged.has(id)) return null;
    if (listeningGate.status === 'retest') {
      return { id, kind, text: 'Dein verzögerter Hörvergleich ist jetzt fällig.',
        nextAction: 'Öffne den Hör-Check. Nur fünf neue servergeprüfte Aufgaben zählen als Retest.', speakable: true };
    }
    const when = new Intl.DateTimeFormat('de-DE', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(listeningGate.nextEligibleAt));
    return { id, kind, text: 'Dein Hör-Trainingsblock ist vollständig abgeschlossen.',
      nextAction: `Der nächste gültige Hör-Retest beginnt frühestens am ${when} Uhr (Kairo). Frühere Aufgaben sind Übung, kein Nachweis.`,
      speakable: true };
  }
  const retest = speakingRetestState(state, now);
  if (p && retest && retest.phase !== 'complete') {
    const kind = retest.eligible ? 'retest_ready' : 'retest_wait';
    const id = hash({ prescriptionId: p.id, phase: retest.phase, kind, nextEligibleAt: retest.nextEligibleAt }, 16);
    if (acknowledged.has(id)) return null;
    if (retest.eligible) {
      const transfer = retest.phase === 'transfer';
      return { id, kind,
        text: transfer ? 'Dein verzögerter Transfer-Retest ist jetzt fällig.'
          : 'Dein passender Live-Vergleichstest ist jetzt fällig.',
        nextAction: transfer
          ? 'Starte das Live-Interview. Es prüft dieselbe Mikrofähigkeit in einer neuen Situation.'
          : 'Starte das Live-Interview. Erst diese servergespeicherte Leistung kann den Trainingsblock bestätigen.',
        speakable: true };
    }
    const when = new Intl.DateTimeFormat('de-DE', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(retest.nextEligibleAt));
    return { id, kind, text: 'Dein Trainingsblock ist vollständig abgeschlossen.',
      nextAction: `Der nächste gültige Live-Retest beginnt frühestens am ${when} Uhr (Kairo). Bis dahin zählt ein Interview als freie Übung, nicht als Nachweis.`,
      speakable: true };
  }
  if (!p || acknowledged.has(p.id)) return null;
  const evidenceText = p.evidenceConfidence === 'high'
    ? `Aus wiederholter zuverlässiger Evidenz hat BrainGuide ${SKILL_LABELS[p.skillId] || p.skillId} als nächsten Trainingsschritt gewählt.`
    : `Aus einem ersten zuverlässigen Hinweis hat BrainGuide ${SKILL_LABELS[p.skillId] || p.skillId} als Mess- und Trainingsschritt gewählt; der Retest prüft, ob sich das Muster bestätigt.`;
  return { id: p.id, kind: 'prescription', text: `${evidenceText} Mache jetzt ${p.repetitions} Wiederholungen im ${p.drillId}.`,
    nextAction: `Arbeite ${Math.ceil(p.durationSeconds / 60)} Minuten. Fertig ist der Block erst, wenn: ${p.successGate}`, speakable: true };
}

function directiveOwnsPrescription(directive, prescription, flags) {
  if (flags?.enabled !== true || !prescription) return false;
  const action = directive?.prescription?.action;
  const skillMatches = directive?.prescription?.skillId === prescription.skillId;
  if (!skillMatches || !['drill', 'wait', 'interview'].includes(action)) return false;
  return action !== 'drill' || directive.prescription.drill === prescription.drillId;
}

export function publicSalmaCoach(profile, account, flags, { now = Date.now() } = {}) {
  const { state } = syncSalmaCoach(profile, { now }); const capabilities = salmaCoachCapabilities(account);
  // This exact assembler also backs GET /api/brain. Salma may explain its action, but she must
  // never expose an independently recomputed directive as a competing next step.
  const directive = canonicalCoachDirective(profile, account, { now, coachFlags: flags });
  const readiness = hireReadinessFor(profile);
  const interviewRisk = readiness.interviewRisk;
  const entitledPrescription = capabilities.fullTutor ? state.activePrescription
    : state.activePrescription && { ...state.activePrescription, blocks: 1, timesPerDay: 1, nextEligibleAt: null };
  // Keep the durable tutor cycle for later, but expose it only while BrainGuide's canonical action
  // is that exact cycle. Vacancy, Mission Control, measurement, and other priorities must never be
  // accompanied by a competing drill, spacing notice, or retest card.
  const limited = directiveOwnsPrescription(directive, entitledPrescription, flags)
    ? entitledPrescription : null;
  const attempt = limited ? state.coachState.repeatedErrorCounts[limited.id] : null;
  const history = state.coachState.improvementHistory || [];
  const verifiedRetest = publicImprovementProof(history[history.length - 1]);
  const verifiedMasteredSkills = new Set(validatedTransferProofs(profile, now).map((proof) => proof.skillId));
  const masteryConfirmed = !!verifiedRetest && verifiedRetest.phase === 'transfer'
    && verifiedRetest.status === 'improved' && verifiedMasteredSkills.has(verifiedRetest.skillId);
  const completedBlocks = limited ? Math.min(limited.blocks, state.coachState.completedBlocks[limited.id] || 0) : 0;
  const progress = limited ? { successfulRepetitions: limited.drillId === 'hoer-check'
      ? (attempt?.blockProgress || []).slice(0, limited.blocks).reduce((sum, block) => sum + block.recentOutcomes.filter(Boolean).length, 0)
      : attempt?.correct || 0,
    requiredSuccessfulRepetitions: limited.drillId === 'hoer-check'
      ? 4 * limited.blocks : Math.min(48, limited.repetitions * limited.blocks + (attempt?.failures || 0) * 2),
    completedBlocks, requiredBlocks: limited.blocks,
    nextBlockEligibleAt: completedBlocks > 0 && completedBlocks < limited.blocks ? limited.nextEligibleAt : null,
    blockNominatedComplete: completedBlocks === limited.blocks,
    masteryConfirmed,
    verifiedRetest } : (verifiedRetest ? { successfulRepetitions: 0, requiredSuccessfulRepetitions: 0,
      blockNominatedComplete: false, masteryConfirmed,
      verifiedRetest } : null);
  const publicPrescription = limited ? {
    id: limited.id, skillId: limited.skillId, drillId: limited.drillId, blocks: limited.blocks,
    repetitions: limited.repetitions, durationSeconds: limited.durationSeconds, timesPerDay: limited.timesPerDay,
    minimumSpacingMinutes: limited.minimumSpacingMinutes, successGate: limited.successGate,
    assignedAt: limited.assignedAt, nextEligibleAt: limited.nextEligibleAt,
    evidenceConfidence: limited.evidenceConfidence, criterionId: limited.criterionId,
    baseline: limited.baseline ? { metricKey: limited.baseline.metricKey, value: limited.baseline.value, measuredAt: limited.baseline.measuredAt } : null,
  } : null;
  const listeningRetest = publicListeningRetest(profile, limited?.skillId, state);
  const publicState = { ...state, activePrescription: limited };
  const speakingRetest = publicSpeakingRetest(publicState, now);
  return { feature: { mode: flags.mode, enabled: flags.enabled, aiEnabled: flags.aiEnabled, voiceEnabled: flags.voiceEnabled, masriAvailable: false }, capabilities,
    interviewRisk,
    rejectionForecast: readiness.rejectionForecast,
    listeningRetest,
    speakingRetest,
    preferences: state.preferences, activePrescription: publicPrescription,
    intervention: safeIntervention(publicState, now, profile),
    progress, brain: { state: directive?.state || 'NEW', action: directive?.prescription?.action || 'assessment' } };
}

export function updatePreferences(state, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('invalid_preferences'), { code: 400 });
  const allowed = new Set(['dailyMinutes', 'preferredWindows', 'languageSupport', 'autoSpeak', 'muted']);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw Object.assign(new Error('invalid_preferences'), { code: 400 });
  const next = normalizeSalmaCoachState(state);
  if (Object.hasOwn(input, 'dailyMinutes')) { if (![5, 10, 20].includes(Number(input.dailyMinutes))) throw Object.assign(new Error('invalid_daily_minutes'), { code: 400 }); next.preferences.dailyMinutes = Number(input.dailyMinutes); }
  if (Object.hasOwn(input, 'preferredWindows')) { if (!Array.isArray(input.preferredWindows) || input.preferredWindows.some((v) => !WINDOWS.has(v))) throw Object.assign(new Error('invalid_preferred_windows'), { code: 400 }); next.preferences.preferredWindows = [...new Set(input.preferredWindows)].slice(0, 3); }
  if (Object.hasOwn(input, 'languageSupport')) { if (!LANGUAGES.has(input.languageSupport)) throw Object.assign(new Error('language_not_approved'), { code: 409 }); next.preferences.languageSupport = input.languageSupport; }
  if (Object.hasOwn(input, 'autoSpeak')) { if (typeof input.autoSpeak !== 'boolean') throw Object.assign(new Error('invalid_auto_speak'), { code: 400 }); next.preferences.autoSpeak = input.autoSpeak; }
  if (Object.hasOwn(input, 'muted')) { if (typeof input.muted !== 'boolean') throw Object.assign(new Error('invalid_muted'), { code: 400 }); next.preferences.muted = input.muted; }
  return next;
}

export function cairoDay(now = Date.now()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); }
export function consumeQuestion(state, limit, now = Date.now()) {
  const next = normalizeSalmaCoachState(state); const day = cairoDay(now);
  const usage = next.coachState.questionUsage.day === day ? next.coachState.questionUsage : { day, count: 0 };
  if (usage.count >= limit) throw Object.assign(new Error('question_limit_reached'), { code: 429 });
  next.coachState.questionUsage = { day, count: usage.count + 1 }; return next;
}

export function answerSalmaQuestion(question, context, state) {
  const text = boundedString(question, 400).replace(/[\u202A-\u202E\u2066-\u2069]/gu, ' ');
  if (text.length < 2) throw Object.assign(new Error('question_required'), { code: 400 });
  const p = state?.activePrescription;
  if (!p) return { answer: 'Ich habe noch nicht genug verlässliche Daten für eine persönliche Diagnose. Führe zuerst das nächste Diagnose-Interview vollständig durch.', source: 'deterministic' };
  const lower = text.toLocaleLowerCase('de-DE'); const skill = SKILL_LABELS[p.skillId] || p.skillId;
  if (/warum|weshalb|wieso/u.test(lower)) return { answer: `Du hast dieses Training bekommen, weil ${skill} in deiner letzten verlässlichen Messung der begrenzende Faktor war. Mache jetzt genau den verordneten Block; erst das nächste Live-Interview bestätigt die Verbesserung.`, source: 'deterministic' };
  if (/wie oft|wiederholung|dauer|wie lange|wann/u.test(lower)) return { answer: `Mache ${p.repetitions} Wiederholungen in ungefähr ${Math.ceil(p.durationSeconds / 60)} Minuten. ${p.timesPerDay > 1 ? `Der zweite Block beginnt frühestens nach ${Math.round(p.minimumSpacingMinutes / 60)} Stunden.` : 'Heute reicht ein vollständiger Block.'}`, source: 'deterministic' };
  if (/fertig|bestanden|geschafft|erfolg/u.test(lower)) return { answer: `Dieser Übungsblock ist fertig, wenn: ${p.successGate} Beherrscht ist die Fähigkeit erst, wenn sie danach in einem vollständigen Live-Interview hält.`, source: 'deterministic' };
  return { answer: `Das Training ${boundedString(context?.drillId, 40) || p.drillId} übt gezielt ${skill}. Führe jetzt die nächste Wiederholung aus, korrigiere nur den ersten klaren Fehler und wiederhole sie dann sauber.`, source: 'deterministic' };
}

export function acknowledgeEvent(state, eventId) {
  const next = normalizeSalmaCoachState(state);
  if (!/^[a-f0-9]{16}$/u.test(eventId || '')) throw Object.assign(new Error('invalid_event_id'), { code: 400 });
  next.coachState.lastHandledEventId = eventId;
  next.coachState.acknowledgedEventIds = [...next.coachState.acknowledgedEventIds.filter((id) => id !== eventId), eventId].slice(-24);
  return next;
}
export function coachCueForDrill({ drill, correct, froze, eventId }) {
  const verifiedFailure = correct === false || froze === true;
  if (!DRILLS.has(drill) || !/^[a-f0-9]{16}$/u.test(eventId || '') || !verifiedFailure) return null;
  return { id: hash({ eventId, drill, correct: correct === true, froze: froze === true }, 16), kind: 'between_attempts',
    text: froze === true ? 'Stoppe kurz. Formuliere nur den ersten vollständigen Satz und versuche dieselbe Stufe erneut.' : 'Korrigiere nur den ersten klaren Fehler und produziere dieselbe Antwort noch einmal vollständig.', maxAutomaticSpeech: 2 };
}
