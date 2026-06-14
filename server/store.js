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

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'users');
const cache    = new Map();
const NS       = 'profile';   // durable-store namespace for per-user profiles

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
    assessmentUsed:   false, // free intelligent assessment is once-per-account ever
    assessmentResult: null,  // the stored verdict (level/blockers/strengths/focus)
    recommendations:  [],    // Trainingslager: ordered lesson recommendations (refreshed per fight)
    lessonsCompleted: [],    // Trainingslager (legacy grammar lessons): ruleIds passed
    lagerDone:        [],    // Trainingslager (tiered): station ids "section:tier" completed (never-repeat)
    lessonDays:       [],    // Trainingslager: Cairo day-keys with a lesson done (streak credit)
    lastCompletedLesson: null, // Trainingslager: ruleId of the most recent lesson (fight focus)
    recommendedCounted:  [], // Trainingslager: ruleIds already counted in the global recommend stat
    neuEinstufungPrompted: false, // Trainingslager: one-time "monthly re-assessment" prompt shown?
    liveUsage:        { day: '', sec: 0 }, // live-interview seconds used today (Cairo day-key)
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
  return profile;
}

export async function saveUser(profile) {
  const id = safeId(profile.userId);
  profile.userId = id;
  cache.set(id, profile);
  if (dbEnabled()) {
    await kvSet(NS, id, profile);
  } else {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    await writeFile(path.join(DATA_DIR, `${id}.json`), JSON.stringify(profile, null, 2), 'utf8');
  }
  return profile;
}

// Hard-delete a user's progress profile (cache + DB row / file). Used by admin account
// deletion. Missing data is fine — deletion is idempotent and never throws on absence.
export async function deleteUser(userId) {
  const id = safeId(userId);
  cache.delete(id);
  if (dbEnabled()) { await kvDel(NS, id); return; }
  try { await rm(path.join(DATA_DIR, `${id}.json`), { force: true }); } catch { /* already gone */ }
}
