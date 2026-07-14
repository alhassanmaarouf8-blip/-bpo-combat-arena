import { createHash } from 'crypto';
import { planOf, trialActive } from './auth.js';
import { buildSnapshot } from './brain/adapter.js';
import { decide } from './brain/engine.js';
import { listeningEvidence, listeningEvidenceSummary } from './listeningEvidence.js';
import { hireReadinessFor } from './hireReadiness.js';

const MODES = new Set(['off', 'beta', 'on']);
const WINDOWS = new Set(['morning', 'afternoon', 'evening']);
const LANGUAGES = new Set(['de']);
const DRILLS = new Set(['satzbau-schmiede', 'sag-es-richtig', 'flow-drill', 'hoer-check', 'shadowing', 'druck-leiter', 'srs']);
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
  'word-order-sub': 'Verbendstellung in Nebensätzen mit weil, dass oder wenn',
  'dativ-akkusativ': 'sichere Dativ- und Akkusativformen in vollständigen Antworten',
  'konjunktiv-2': 'höfliche und hypothetische Antworten mit Konjunktiv II',
  'fluency-interrupt': 'flüssiges Weiterantworten nach einer natürlichen Unterbrechung',
  deescalate: 'ruhige Deeskalation eines verärgerten Kunden mit einer konkreten Lösung',
  'no-freeze-expected': 'eine vollständige Antwort unter unerwartetem Nachfragen statt Abbruch',
  'pronunciation-phone': 'klar verständliche vollständige Sätze in einer Telefonsituation',
});

function boundedString(value, max = 80) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function hash(value, length) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length); }

function roundMetric(value) { return Math.round(Number(value) * 10) / 10; }
function metricForSkill(skillId) { return Object.hasOwn(IMPROVEMENT_METRICS, skillId) ? IMPROVEMENT_METRICS[skillId] : null; }
function reliableSpeakingSessions(profile) {
  return (Array.isArray(profile?.sessions) ? profile.sessions : []).filter((session) => (
    session?.evidenceQuality?.version === 1 && session.evidenceQuality.prescriptionEligible === true
  ));
}

export function measurementForSkill(profile, skillId) {
  const metric = metricForSkill(skillId);
  if (!metric) return null;
  if (metric.key === 'listening_accuracy') {
    const summary = listeningEvidenceSummary(profile, skillId);
    if (!summary) return null;
    return { metricKey: metric.key, value: roundMetric(summary.accuracy * 100), measuredAt: summary.measuredAt,
      evidenceId: hash({ skillId, evidenceIds: summary.evidenceIds }, 12) };
  }
  const sessions = reliableSpeakingSessions(profile);
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    let value = null;
    if (metric.key === 'grammar_errors' && session?.grammarMeasured === true && Array.isArray(session?.grammarRules)) {
      value = session.grammarRules
        .filter((row) => row?.ruleId === skillId)
        .reduce((sum, row) => sum + Math.max(0, Number(row?.count) || 0), 0);
    } else if (metric.key === 'fluency_score' && Number.isFinite(session?.fluency)) {
      value = Math.max(0, Math.min(100, Number(session.fluency)));
    } else if (metric.key === 'deescalation_score' && Number.isFinite(session?.deescalation)) {
      value = Math.max(0, Math.min(100, Number(session.deescalation) * 100));
    } else if (metric.key === 'response_continuity' && Number.isFinite(session?.giveUpRate)) {
      value = Math.max(0, Math.min(100, (1 - Number(session.giveUpRate)) * 100));
    } else if (metric.key === 'intelligibility_score' && Number.isFinite(session?.intelligibility)) {
      value = Math.max(0, Math.min(100, Number(session.intelligibility) * 100));
    }
    if (value === null) continue;
    const measuredAt = Number(session?.date) || 0;
    if (!measuredAt) continue;
    return { metricKey: metric.key, value: roundMetric(value), measuredAt,
      evidenceId: hash({ skillId, metricKey: metric.key, measuredAt, bossId: session?.bossId || '' }, 12) };
  }
  return null;
}

function normalizeMeasurement(value, skillId) {
  const metric = metricForSkill(skillId);
  if (!metric || value?.metricKey !== metric.key || !Number.isFinite(value?.value) || !Number.isFinite(value?.measuredAt)
    || !/^[a-f0-9]{12}$/u.test(value?.evidenceId || '')) return null;
  return { metricKey: metric.key, value: roundMetric(value.value), measuredAt: Number(value.measuredAt), evidenceId: value.evidenceId };
}

function normalizeImprovementProof(value) {
  const skillId = boundedString(value?.skillId, 60); const metric = metricForSkill(skillId);
  if (!metric || !/^[a-f0-9]{16}$/u.test(value?.id || '') || !/^[a-f0-9]{16}$/u.test(value?.prescriptionId || '')
    || !['improved', 'held', 'regressed'].includes(value?.status) || !Number.isFinite(value?.before)
    || !Number.isFinite(value?.after) || !Number.isFinite(value?.verifiedAt)) return null;
  return { id: value.id, prescriptionId: value.prescriptionId, skillId, metricKey: metric.key,
    before: roundMetric(value.before), after: roundMetric(value.after), status: value.status,
    verifiedAt: Number(value.verifiedAt), retestSessionId: boundedString(value.retestSessionId, 100) || null };
}

function publicImprovementProof(value) {
  const proof = normalizeImprovementProof(value); if (!proof) return null;
  const metric = metricForSkill(proof.skillId);
  return { id: proof.id, skillId: proof.skillId, skillLabel: SKILL_LABELS[proof.skillId] || proof.skillId,
    metricLabel: metric.label, unit: metric.unit, direction: metric.direction,
    before: proof.before, after: proof.after, delta: roundMetric(proof.after - proof.before),
    status: proof.status, verifiedAt: proof.verifiedAt };
}

export function salmaRetestTarget(state, profile) {
  const normalized = normalizeSalmaCoachState(state); const prescription = normalized.activePrescription;
  if (!prescription || !prescription.baseline || !metricForSkill(prescription.skillId)
    || !(normalized.coachState.completedBlocks[prescription.id] > 0)) return null;
  const grammarName = profile?.weakLog?.[prescription.skillId]?.ltName;
  const dossier = Object.hasOwn(RETEST_DOSSIERS, prescription.skillId) ? RETEST_DOSSIERS[prescription.skillId] : null;
  if (!dossier) return null;
  return { prescriptionId: prescription.id, skillId: prescription.skillId,
    dossier,
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
  return { id: value.id, evidenceIds: Array.isArray(value.evidenceIds) ? value.evidenceIds.filter((v) => /^[a-f0-9]{12}$/u.test(v)).slice(0, 4) : [],
    skillId: boundedString(value.skillId, 60), drillId: value.drillId, blocks: Math.max(1, Math.min(2, Number(value.blocks) || 1)),
    repetitions: Math.max(1, Math.min(8, Number(value.repetitions) || 1)), durationSeconds: Math.max(60, Math.min(1800, Number(value.durationSeconds) || 300)),
    timesPerDay: Math.max(1, Math.min(2, Number(value.timesPerDay) || 1)), minimumSpacingMinutes: Math.max(0, Math.min(720, Number(value.minimumSpacingMinutes) || 0)),
    successGate: boundedString(value.successGate, 180), assignedAt: Number(value.assignedAt) || Date.now(), nextEligibleAt: Number(value.nextEligibleAt) || null,
    baseline: normalizeMeasurement(value.baseline, boundedString(value.skillId, 60)) };
}

export function normalizeSalmaCoachState(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const pref = raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {};
  const coach = raw.coachState && typeof raw.coachState === 'object' ? raw.coachState : {};
  const completedBlocks = coach.completedBlocks && typeof coach.completedBlocks === 'object' && !Array.isArray(coach.completedBlocks)
    ? Object.fromEntries(Object.entries(coach.completedBlocks).filter(([k, v]) => /^[a-f0-9]{16}$/u.test(k) && Number.isInteger(v) && v >= 0 && v <= 8).slice(-20)) : {};
  const repeatedErrorCounts = coach.repeatedErrorCounts && typeof coach.repeatedErrorCounts === 'object' && !Array.isArray(coach.repeatedErrorCounts)
    ? Object.fromEntries(Object.entries(coach.repeatedErrorCounts).filter(([k, v]) => /^[a-f0-9]{16}$/u.test(k) && v && typeof v === 'object')
      .slice(-20).map(([k, v]) => [k, { attempts: Math.max(0, Math.min(100, Number(v.attempts) || 0)),
        correct: Math.max(0, Math.min(100, Number(v.correct) || 0)), failures: Math.max(0, Math.min(100, Number(v.failures) || 0)),
        lastAt: Number(v.lastAt) || null }])) : {};
  const improvementHistory = Array.isArray(coach.improvementHistory)
    ? coach.improvementHistory.map(normalizeImprovementProof).filter(Boolean).slice(-12) : [];
  const lastHandledEventId = /^[a-f0-9]{16}$/u.test(coach.lastHandledEventId || '') ? coach.lastHandledEventId : null;
  const acknowledgedEventIds = Array.isArray(coach.acknowledgedEventIds)
    ? [...new Set(coach.acknowledgedEventIds.filter((id) => /^[a-f0-9]{16}$/u.test(id)))].slice(-24) : [];
  if (lastHandledEventId && !acknowledgedEventIds.includes(lastHandledEventId)) acknowledgedEventIds.push(lastHandledEventId);
  return { version: 2, preferences: { dailyMinutes: [5, 10, 20].includes(Number(pref.dailyMinutes)) ? Number(pref.dailyMinutes) : 10,
    preferredWindows: Array.isArray(pref.preferredWindows) ? [...new Set(pref.preferredWindows.filter((v) => WINDOWS.has(v)))].slice(0, 3) : [],
    languageSupport: LANGUAGES.has(pref.languageSupport) ? pref.languageSupport : 'de', autoSpeak: pref.autoSpeak === true, muted: pref.muted === true },
    activePrescription: normalizeStoredPrescription(raw.activePrescription), coachState: {
      lastHandledEventId, acknowledgedEventIds: acknowledgedEventIds.slice(-24),
      repeatedErrorCounts, completedBlocks, lastRetestSessionId: boundedString(coach.lastRetestSessionId, 100) || null,
      improvementHistory,
      questionUsage: { day: /^\d{4}-\d{2}-\d{2}$/u.test(coach.questionUsage?.day || '') ? coach.questionUsage.day : '',
        count: Number.isInteger(coach.questionUsage?.count) ? Math.max(0, Math.min(100, coach.questionUsage.count)) : 0 } } };
}

function sessionEvidenceIds(profile) {
  return reliableSpeakingSessions(profile).slice(-2).map((s) => hash({ date: s?.date || 0, bossId: s?.bossId || '', verdict: s?.verdict || '', limitingSkill: s?.hireReadiness?.limitingSkill || s?.limitingSkill || '' }, 12));
}
function evidenceOccurrences(profile, skillId) {
  if (skillId === 'listen-clear' || skillId === 'listen-phone') {
    return new Set(listeningEvidence(profile, skillId).map((row) => row.issuedAt)).size;
  }
  const counts = profile?.weakLog?.[skillId]?.errCounts;
  const reliableDates = new Set(reliableSpeakingSessions(profile).map((session) => Number(session?.date)).filter(Boolean));
  if (Array.isArray(counts)) return counts.filter((row) => Number(row?.count) > 0 && reliableDates.has(Number(row?.date))).length;
  return Math.min(2, reliableDates.size);
}

export function deriveSalmaPrescription(profile, { now = Date.now(), dailyMinutes = 10 } = {}) {
  const snapshot = buildSnapshot(profile, now); const directive = decide(snapshot);
  const drillId = directive?.prescription?.action === 'drill' ? directive.prescription.drill : null;
  const skillId = directive?.prescription?.skillId || directive?.target?.skillId || '';
  if (!DRILLS.has(drillId) || !skillId || snapshot.sessionCount < 1) return { directive, prescription: null };
  const protocol = PROTOCOLS[drillId]; const occurrences = evidenceOccurrences(profile, skillId);
  const listeningRows = skillId === 'listen-clear' || skillId === 'listen-phone' ? listeningEvidence(profile, skillId) : [];
  if (drillId === 'hoer-check' && listeningRows.length < 5) return { directive, prescription: null };
  const durationSeconds = Math.min(protocol.durationSeconds, Math.max(300, [5, 10, 20].includes(Number(dailyMinutes)) ? Number(dailyMinutes) * 60 : 600));
  const blocks = occurrences >= 2 && Number(dailyMinutes) >= 20 ? 2 : 1;
  const evidenceIds = listeningRows.length
    ? listeningRows.slice(-4).map((row) => hash(row.attemptId, 12)) : sessionEvidenceIds(profile);
  const baseline = measurementForSkill(profile, skillId);
  if (!baseline) return { directive, prescription: null };
  const identity = { evidenceIds, skillId, drillId, blocks, repetitions: protocol.repetitions, durationSeconds, minimumSpacingMinutes: protocol.minimumSpacingMinutes, successGate: protocol.successGate };
  return { directive, prescription: { id: hash(identity, 16), evidenceIds, skillId, drillId, blocks, repetitions: protocol.repetitions,
    durationSeconds, timesPerDay: blocks, minimumSpacingMinutes: protocol.minimumSpacingMinutes, successGate: protocol.successGate,
    assignedAt: now, nextEligibleAt: blocks > 1 ? now + protocol.minimumSpacingMinutes * 60_000 : null, baseline } };
}

export function syncSalmaCoach(profile, { now = Date.now() } = {}) {
  const state = normalizeSalmaCoachState(profile?.salmaCoach);
  const { directive, prescription } = deriveSalmaPrescription(profile, { now, dailyMinutes: state.preferences.dailyMinutes });
  if (prescription && state.activePrescription?.id === prescription.id) { prescription.assignedAt = state.activePrescription.assignedAt; prescription.nextEligibleAt = state.activePrescription.nextEligibleAt; }
  state.activePrescription = prescription; profile.salmaCoach = state; return { state, directive };
}

export function recordDrillOutcome(state, event, now = Date.now()) {
  const next = normalizeSalmaCoachState(state); const p = next.activePrescription;
  const completedSet = event?.completedSet === true && p?.drillId === 'flow-drill';
  if (!p || event?.drill !== p.drillId || (event.correct !== true && event.correct !== false && event.froze !== true && !completedSet)) return next;
  const previous = next.coachState.repeatedErrorCounts[p.id] || { attempts: 0, correct: 0, failures: 0, lastAt: null };
  const failed = event.correct === false || event.froze === true;
  const credit = completedSet ? p.repetitions : 1;
  const row = { attempts: previous.attempts + credit, correct: previous.correct + (failed ? 0 : credit),
    failures: previous.failures + (failed ? 1 : 0), lastAt: now };
  next.coachState.repeatedErrorCounts[p.id] = row;
  const requiredCorrect = Math.min(24, p.repetitions + row.failures * 2);
  if (row.correct >= requiredCorrect) next.coachState.completedBlocks[p.id] = Math.max(1, next.coachState.completedBlocks[p.id] || 0);
  return next;
}

export function recordMeaningfulRetest(state, profile, { sessionId, skillId, now = Date.now() } = {}) {
  const next = normalizeSalmaCoachState(state); const prescription = next.activePrescription;
  const safeId = boundedString(sessionId, 100);
  if (!safeId || !prescription || prescription.skillId !== skillId || !prescription.baseline
    || !(next.coachState.completedBlocks[prescription.id] > 0)) return next;
  if (next.coachState.improvementHistory.some((proof) => proof.retestSessionId === safeId)) return next;
  const followup = measurementForSkill(profile, skillId);
  if (!followup || followup.measuredAt <= prescription.baseline.measuredAt
    || followup.evidenceId === prescription.baseline.evidenceId) return next;
  const metric = metricForSkill(skillId); const rawDelta = followup.value - prescription.baseline.value;
  const signedImprovement = metric.direction === 'higher' ? rawDelta : -rawDelta;
  const status = signedImprovement >= metric.minimumDelta ? 'improved'
    : signedImprovement <= -metric.minimumDelta ? 'regressed' : 'held';
  const proof = normalizeImprovementProof({
    id: hash({ prescriptionId: prescription.id, skillId, before: prescription.baseline.value,
      after: followup.value, retestSessionId: safeId }, 16),
    prescriptionId: prescription.id, skillId, before: prescription.baseline.value, after: followup.value,
    status, verifiedAt: now, retestSessionId: safeId,
  });
  next.coachState.lastRetestSessionId = safeId;
  next.coachState.improvementHistory = [...next.coachState.improvementHistory, proof].filter(Boolean).slice(-12);
  return next;
}

export function salmaCoachEventId(value) { return hash(value, 16); }

export function safeIntervention(state) {
  const p = state?.activePrescription;
  const history = state?.coachState?.improvementHistory || [];
  const latestProof = publicImprovementProof(history[history.length - 1]);
  const acknowledged = new Set([...(state?.coachState?.acknowledgedEventIds || []), state?.coachState?.lastHandledEventId].filter(Boolean));
  if (latestProof && !acknowledged.has(latestProof.id)) {
    const result = latestProof.status === 'improved' ? 'Die Verbesserung ist bestätigt.'
      : latestProof.status === 'regressed' ? 'Der Retest war schwächer; ich passe deinen nächsten Schritt an.'
        : 'Der Retest hielt das Niveau; wir trainieren den Engpass gezielter weiter.';
    return { id: latestProof.id, kind: 'verified_retest',
      text: `${latestProof.skillLabel}: ${latestProof.before} → ${latestProof.after} ${latestProof.unit}. ${result}`,
      nextAction: 'BrainGuide hat aus diesem Retest bereits den nächsten höchsten Hebel gewählt.', speakable: true };
  }
  if (!p || acknowledged.has(p.id)) return null;
  return { id: p.id, kind: 'prescription', text: `Dein Engpass ist ${SKILL_LABELS[p.skillId] || p.skillId}. Mache jetzt ${p.repetitions} Wiederholungen im ${p.drillId}.`,
    nextAction: `Arbeite ${Math.ceil(p.durationSeconds / 60)} Minuten. Fertig ist der Block erst, wenn: ${p.successGate}`, speakable: true };
}

export function publicSalmaCoach(profile, account, flags) {
  const { state, directive } = syncSalmaCoach(profile); const capabilities = salmaCoachCapabilities(account);
  const interviewRisk = hireReadinessFor(profile).interviewRisk;
  const limited = capabilities.fullTutor ? state.activePrescription : state.activePrescription && { ...state.activePrescription, blocks: 1, timesPerDay: 1, nextEligibleAt: null };
  const attempt = limited ? state.coachState.repeatedErrorCounts[limited.id] : null;
  const history = state.coachState.improvementHistory || [];
  const verifiedRetest = publicImprovementProof(history[history.length - 1]);
  const progress = limited ? { successfulRepetitions: attempt?.correct || 0,
    requiredSuccessfulRepetitions: Math.min(24, limited.repetitions + (attempt?.failures || 0) * 2),
    blockNominatedComplete: (state.coachState.completedBlocks[limited.id] || 0) > 0,
    masteryConfirmed: verifiedRetest?.status === 'improved' && history[history.length - 1]?.prescriptionId === limited.id,
    verifiedRetest } : (verifiedRetest ? { successfulRepetitions: 0, requiredSuccessfulRepetitions: 0,
      blockNominatedComplete: false, masteryConfirmed: false, verifiedRetest } : null);
  const publicPrescription = limited ? {
    id: limited.id, skillId: limited.skillId, drillId: limited.drillId, blocks: limited.blocks,
    repetitions: limited.repetitions, durationSeconds: limited.durationSeconds, timesPerDay: limited.timesPerDay,
    minimumSpacingMinutes: limited.minimumSpacingMinutes, successGate: limited.successGate,
    assignedAt: limited.assignedAt, nextEligibleAt: limited.nextEligibleAt,
    baseline: limited.baseline ? { metricKey: limited.baseline.metricKey, value: limited.baseline.value, measuredAt: limited.baseline.measuredAt } : null,
  } : null;
  return { feature: { mode: flags.mode, enabled: flags.enabled, aiEnabled: flags.aiEnabled, voiceEnabled: flags.voiceEnabled, masriAvailable: false }, capabilities,
    interviewRisk,
    preferences: state.preferences, activePrescription: publicPrescription, intervention: safeIntervention({ ...state, activePrescription: limited }),
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
