/**
 * store.js
 * Per-user progress persistence. JSON file per user under server/data/users/.
 * This is the single seam Phase 6 will swap for a real multi-tenant DB — the rest of
 * the app only touches loadUser()/saveUser(), never the storage details.
 */
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync }                 from 'fs';
import path                           from 'path';
import { fileURLToPath }              from 'url';
import { dbEnabled, kvGet, kvSet, kvDel } from './db.js';
import { levelFor } from './progression.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'users');
const cache    = new Map();
const NS       = 'profile';   // durable-store namespace for per-user profiles
const saveTails = new Map();
const mutationTails = new Map();
const UNTRUSTED_SESSION_XP_MIGRATION = 1;

export function repairExplicitlyUntrustedSessionXp(profile) {
  const migrations = profile?.integrityMigrations && typeof profile.integrityMigrations === 'object'
    ? profile.integrityMigrations : {};
  if (Number(migrations.untrustedSessionXp) >= UNTRUSTED_SESSION_XP_MIGRATION) return false;
  const sessions = Array.isArray(profile?.sessions) ? profile.sessions : [];
  const wronglyAwarded = sessions.reduce((sum, session) => session?.evidenceQuality?.eligible === false
    ? sum + Math.max(0, Number(session?.xpGained) || 0) : sum, 0);
  if (wronglyAwarded > 0) {
    profile.xp = Math.max(0, (Number(profile.xp) || 0) - wronglyAwarded);
    profile.level = levelFor(profile.xp);
    profile.sessions = sessions.map((session) => session?.evidenceQuality?.eligible === false
      ? { ...session, xpGained: 0, progressExcludedReason: 'untrusted_speech_evidence' }
      : session);
  }
  profile.integrityMigrations = { ...migrations, untrustedSessionXp: UNTRUSTED_SESSION_XP_MIGRATION };
  return true;
}

function safeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'anon';
}

export function defaultProfile(userId) {
  return {
    userId,
    createdAt:      Date.now(),
    level:          1,
    xp:             0,
    sessions:       [],   // [{ date, level, bossId, fluency, wpm, fillers, c1Hits, ... }]
    srs:            [],   // spaced-repetition items (see srs.js)
    vocabLearned:   [],   // distinct strong vocab the user has actually produced
    masteredRules:  [],   // grammar rules cleared through the SRS schedule
    bossesDefeated: [],
    maxRankTier:    0,    // highest interview-readiness rank ever earned; current form remains separate
    assessmentUsed:   false, // free intelligent assessment is once-per-account ever
    assessmentResult: null,  // the stored verdict (level/blockers/strengths/focus)
    recommendations:  [],    // Trainingslager: ordered lesson recommendations (refreshed per fight)
    lessonsCompleted: [],    // Trainingslager (legacy grammar lessons): ruleIds passed
    lagerDone:        [],    // Trainingslager (tiered): station ids "section:tier" completed (never-repeat)
    lessonDays:       [],    // Trainingslager: Cairo day-keys with a lesson done (streak credit)
    dailyDays:        [],    // Daily-drill Cairo day-keys (streak credit — unified practice streak)
    lastCompletedLesson: null, // Trainingslager: ruleId of the most recent lesson (fight focus)
    recommendedCounted:  [], // Trainingslager: ruleIds already counted in the global recommend stat
    neuEinstufungPrompted: false, // Trainingslager: one-time "monthly re-assessment" prompt shown?
    liveUsage:        { day: '', sec: 0 }, // live-interview seconds used today (Cairo day-key)
    usageDays:        {},  // DURABLE per-day live seconds { 'YYYY-MM-DD': sec } — liveUsage resets daily, this does NOT (engagement analytics: days-active + minutes-each)
    firstSessionTrace: null, // one bounded owner-only first-interview trace; never audio, transcript, IP, or email
    pushSub:          null, // Web Push subscription {endpoint,keys} for daily practice reminders (push.js)
    drillsSeen:       {},  // per-drill seen-id sets → never-repeat for every standalone drill
    recentErrors:     [],  // top error labels from the last session (cross-session boss memory)
    lastTopics:       [],  // salient words the candidate SAID last session (claim-ledger) → content memory ("Sie erwähnten letztes Mal …")
    // PLACEMENT — the ONE outcome that defines the mission: did this student get hired into a
    // German-speaking BPO role? status: none|applying|interviewing|offer|hired|not_hired.
    // history is the audit trail; lastPromptedAt throttles the "any job news?" nudge to weekly.
    listeningAttempts: [], // bounded server-issued evidence; never raw answers, prompts, or audio
    placement: { status: 'none', employer: '', role: '', updatedAt: null, history: [], lastPromptedAt: null },
    // Frozen pre-interview simulation forecasts linked to later real outcomes. This state stores
    // bounded metrics and enums only—never transcripts, audio, recruiter text, or causal claims.
    outcomeCalibration: { version: 1, activeForecast: null, records: [] },
    targetIndustry: null,  // Ziel-Stelle: INDUSTRIES key (scenarios.js) the candidate is applying for, or null
    // "Meine eigenen Fragen": the confirmed set of interview questions the candidate uploaded/edited,
    // injected into buildSessionScript so the interview asks THESE. Only the confirmed text lives here
    // — never the raw uploaded images. One active set (a new upload replaces it). See customQuestions.js.
    customQuestionSet: null,  // { questions: string[], createdAt } | null
    // Vacancy Target v1: one bounded draft + one active target. Only derived,
    // allowlisted facts live here; source text and source URLs are never persisted.
    vacancyTarget: {
      version: 1,
      draft: null,
      active: null,
      previewUsedAt: null,
      analysisUsage: { hour: '', hourCount: 0, month: '', monthCount: 0 },
    },
    // Job-to-Offer Mission Control stores only a versioned encrypted envelope.
    // Its module owns decryption/normalization so general progress code can never
    // accidentally expose Candidate Passport or opportunity data.
    missionControlEncrypted: null,

    // Salma Personal Tutor: bounded structured state, keyed by immutable account ID.
    // Raw audio, free-form questions, transcripts, and email addresses never live here.
    salmaCoach: {
      version: 4,
      preferences: { dailyMinutes: 10, preferredWindows: [], languageSupport: 'de', autoSpeak: false, muted: false },
      activePrescription: null,
      coachState: { lastHandledEventId: null, acknowledgedEventIds: [], repeatedErrorCounts: {}, completedBlocks: {}, lastRetestSessionId: null,
        improvementHistory: [] },
    },

  };
}

export async function loadUser(userId) {
  const id = safeId(userId);
  if (cache.has(id)) return cache.get(id);

  let saved = {};
  if (dbEnabled()) {
    saved = (await kvGet(NS, id)) ?? {};
  } else {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    try { saved = JSON.parse(await readFile(path.join(DATA_DIR, `${id}.json`), 'utf8')); }
    catch { /* new user */ }
  }

  const profile = { ...defaultProfile(id), ...saved, userId: id };
  cache.set(id, profile);
  if (repairExplicitlyUntrustedSessionXp(profile)) await saveUser(profile);
  return profile;
}

export async function saveUser(profile) {
  const id = safeId(profile.userId);
  profile.userId = id;
  cache.set(id, profile);
  // Snapshot now and preserve call order. A later mutation of the cached object must
  // not change an already-queued write, and an older slow write must never land last.
  const snapshot = JSON.stringify(profile);
  const previous = saveTails.get(id) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    if (dbEnabled()) {
      await kvSet(NS, id, JSON.parse(snapshot));
    } else {
      if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
      await writeFile(path.join(DATA_DIR, `${id}.json`), JSON.stringify(JSON.parse(snapshot), null, 2), 'utf8');
    }
  });
  saveTails.set(id, operation);
  try { await operation; }
  finally { if (saveTails.get(id) === operation) saveTails.delete(id); }
  return profile;
}

/**
 * Serialize a short read-modify-write for one profile. The callback may return
 * `{ save:false, value }` for an idempotent read; otherwise its mutations are
 * persisted once and `value` is returned when supplied.
 */
export async function mutateUser(userId, callback) {
  const id = safeId(userId);
  const previous = mutationTails.get(id) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  mutationTails.set(id, gate);
  await previous.catch(() => {});
  try {
    const profile = await loadUser(id);
    const decision = await callback(profile);
    if (decision?.save === false) return decision.value;
    await saveUser(profile);
    return decision && Object.hasOwn(decision, 'value') ? decision.value : decision;
  } finally {
    release();
    if (mutationTails.get(id) === gate) mutationTails.delete(id);
  }
}

// Hard-delete a user's progress profile (cache + DB row / file). Used by admin account
// deletion. Missing data is fine — deletion is idempotent and never throws on absence.
export async function deleteUser(userId) {
  const id = safeId(userId);
  cache.delete(id);
  if (dbEnabled()) { await kvDel(NS, id); return; }
  try { await rm(path.join(DATA_DIR, `${id}.json`), { force: true }); } catch { /* already gone */ }
}
