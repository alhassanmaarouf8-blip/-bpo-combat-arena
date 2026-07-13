import { createHash } from 'crypto';
import { planOf, trialActive } from './auth.js';
import { buildSnapshot } from './brain/adapter.js';
import { decide } from './brain/engine.js';

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

function boundedString(value, max = 80) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function hash(value, length) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length); }

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
    successGate: boundedString(value.successGate, 180), assignedAt: Number(value.assignedAt) || Date.now(), nextEligibleAt: Number(value.nextEligibleAt) || null };
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
  return { version: 1, preferences: { dailyMinutes: [5, 10, 20].includes(Number(pref.dailyMinutes)) ? Number(pref.dailyMinutes) : 10,
    preferredWindows: Array.isArray(pref.preferredWindows) ? [...new Set(pref.preferredWindows.filter((v) => WINDOWS.has(v)))].slice(0, 3) : [],
    languageSupport: LANGUAGES.has(pref.languageSupport) ? pref.languageSupport : 'de', autoSpeak: pref.autoSpeak === true, muted: pref.muted === true },
    activePrescription: normalizeStoredPrescription(raw.activePrescription), coachState: {
      lastHandledEventId: /^[a-f0-9]{16}$/u.test(coach.lastHandledEventId || '') ? coach.lastHandledEventId : null,
      repeatedErrorCounts, completedBlocks, lastRetestSessionId: boundedString(coach.lastRetestSessionId, 100) || null,
      questionUsage: { day: /^\d{4}-\d{2}-\d{2}$/u.test(coach.questionUsage?.day || '') ? coach.questionUsage.day : '',
        count: Number.isInteger(coach.questionUsage?.count) ? Math.max(0, Math.min(100, coach.questionUsage.count)) : 0 } } };
}

function sessionEvidenceIds(profile) {
  return (profile?.sessions || []).slice(-2).map((s) => hash({ date: s?.date || 0, bossId: s?.bossId || '', verdict: s?.verdict || '', limitingSkill: s?.hireReadiness?.limitingSkill || s?.limitingSkill || '' }, 12));
}
function evidenceOccurrences(profile, skillId) {
  const counts = profile?.weakLog?.[skillId]?.errCounts;
  if (Array.isArray(counts)) return counts.filter((row) => Number(row?.count) > 0).length;
  return Math.min(2, Array.isArray(profile?.sessions) ? profile.sessions.length : 0);
}

export function deriveSalmaPrescription(profile, { now = Date.now(), dailyMinutes = 10 } = {}) {
  const snapshot = buildSnapshot(profile, now); const directive = decide(snapshot);
  const drillId = directive?.prescription?.action === 'drill' ? directive.prescription.drill : null;
  const skillId = directive?.prescription?.skillId || directive?.target?.skillId || '';
  if (!DRILLS.has(drillId) || !skillId || snapshot.sessionCount < 1) return { directive, prescription: null };
  const protocol = PROTOCOLS[drillId]; const occurrences = evidenceOccurrences(profile, skillId);
  const durationSeconds = Math.min(protocol.durationSeconds, Math.max(300, [5, 10, 20].includes(Number(dailyMinutes)) ? Number(dailyMinutes) * 60 : 600));
  const blocks = occurrences >= 2 && Number(dailyMinutes) >= 20 ? 2 : 1; const evidenceIds = sessionEvidenceIds(profile);
  const identity = { evidenceIds, skillId, drillId, blocks, repetitions: protocol.repetitions, durationSeconds, minimumSpacingMinutes: protocol.minimumSpacingMinutes, successGate: protocol.successGate };
  return { directive, prescription: { id: hash(identity, 16), evidenceIds, skillId, drillId, blocks, repetitions: protocol.repetitions,
    durationSeconds, timesPerDay: blocks, minimumSpacingMinutes: protocol.minimumSpacingMinutes, successGate: protocol.successGate,
    assignedAt: now, nextEligibleAt: blocks > 1 ? now + protocol.minimumSpacingMinutes * 60_000 : null } };
}

export function syncSalmaCoach(profile, { now = Date.now() } = {}) {
  const state = normalizeSalmaCoachState(profile?.salmaCoach);
  const { directive, prescription } = deriveSalmaPrescription(profile, { now, dailyMinutes: state.preferences.dailyMinutes });
  if (prescription && state.activePrescription?.id === prescription.id) { prescription.assignedAt = state.activePrescription.assignedAt; prescription.nextEligibleAt = state.activePrescription.nextEligibleAt; }
  state.activePrescription = prescription; profile.salmaCoach = state; return { state, directive };
}

export function recordDrillOutcome(state, event, now = Date.now()) {
  const next = normalizeSalmaCoachState(state); const p = next.activePrescription;
  if (!p || event?.drill !== p.drillId || (event.correct !== true && event.correct !== false && event.froze !== true)) return next;
  const previous = next.coachState.repeatedErrorCounts[p.id] || { attempts: 0, correct: 0, failures: 0, lastAt: null };
  const failed = event.correct === false || event.froze === true;
  const row = { attempts: previous.attempts + 1, correct: previous.correct + (failed ? 0 : 1),
    failures: previous.failures + (failed ? 1 : 0), lastAt: now };
  next.coachState.repeatedErrorCounts[p.id] = row;
  const requiredCorrect = Math.min(24, p.repetitions + row.failures * 2);
  if (row.correct >= requiredCorrect) next.coachState.completedBlocks[p.id] = Math.max(1, next.coachState.completedBlocks[p.id] || 0);
  return next;
}

export function recordMeaningfulRetest(state, sessionId) {
  const next = normalizeSalmaCoachState(state);
  const safeId = boundedString(sessionId, 100);
  if (safeId) next.coachState.lastRetestSessionId = safeId;
  return next;
}

export function salmaCoachEventId(value) { return hash(value, 16); }

export function safeIntervention(state) {
  const p = state?.activePrescription; if (!p || state?.coachState?.lastHandledEventId === p.id) return null;
  return { id: p.id, kind: 'prescription', text: `Dein Engpass ist ${SKILL_LABELS[p.skillId] || p.skillId}. Mache jetzt ${p.repetitions} Wiederholungen im ${p.drillId}.`,
    nextAction: `Arbeite ${Math.ceil(p.durationSeconds / 60)} Minuten. Fertig ist der Block erst, wenn: ${p.successGate}`, speakable: true };
}

export function publicSalmaCoach(profile, account, flags) {
  const { state, directive } = syncSalmaCoach(profile); const capabilities = salmaCoachCapabilities(account);
  const limited = capabilities.fullTutor ? state.activePrescription : state.activePrescription && { ...state.activePrescription, blocks: 1, timesPerDay: 1, nextEligibleAt: null };
  const attempt = limited ? state.coachState.repeatedErrorCounts[limited.id] : null;
  const progress = limited ? { successfulRepetitions: attempt?.correct || 0,
    requiredSuccessfulRepetitions: Math.min(24, limited.repetitions + (attempt?.failures || 0) * 2),
    blockNominatedComplete: (state.coachState.completedBlocks[limited.id] || 0) > 0,
    masteryConfirmed: false } : null;
  return { feature: { mode: flags.mode, enabled: flags.enabled, aiEnabled: flags.aiEnabled, voiceEnabled: flags.voiceEnabled, masriAvailable: false }, capabilities,
    preferences: state.preferences, activePrescription: limited, intervention: safeIntervention({ ...state, activePrescription: limited }),
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

export function acknowledgeEvent(state, eventId) { const next = normalizeSalmaCoachState(state); if (!/^[a-f0-9]{16}$/u.test(eventId || '')) throw Object.assign(new Error('invalid_event_id'), { code: 400 }); next.coachState.lastHandledEventId = eventId; return next; }
export function coachCueForDrill({ drill, correct, froze, eventId }) {
  const verifiedFailure = correct === false || froze === true;
  if (!DRILLS.has(drill) || !/^[a-f0-9]{16}$/u.test(eventId || '') || !verifiedFailure) return null;
  return { id: hash({ eventId, drill, correct: correct === true, froze: froze === true }, 16), kind: 'between_attempts',
    text: froze === true ? 'Stoppe kurz. Formuliere nur den ersten vollständigen Satz und versuche dieselbe Stufe erneut.' : 'Korrigiere nur den ersten klaren Fehler und produziere dieselbe Antwort noch einmal vollständig.', maxAutomaticSpeech: 2 };
}
