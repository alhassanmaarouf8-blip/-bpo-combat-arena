/**
 * store.js
 * Per-user progress persistence. JSON file per user under server/data/users/.
 * This is the single seam Phase 6 will swap for a real multi-tenant DB — the rest of
 * the app only touches loadUser()/saveUser(), never the storage details.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync }                 from 'fs';
import path                           from 'path';
import { fileURLToPath }              from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'users');
const cache    = new Map();

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
  };
}

export async function loadUser(userId) {
  const id = safeId(userId);
  if (cache.has(id)) return cache.get(id);

  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });

  let saved = {};
  try { saved = JSON.parse(await readFile(path.join(DATA_DIR, `${id}.json`), 'utf8')); }
  catch { /* new user */ }

  const profile = { ...defaultProfile(id), ...saved, userId: id };
  cache.set(id, profile);
  return profile;
}

export async function saveUser(profile) {
  const id = safeId(profile.userId);
  profile.userId = id;
  cache.set(id, profile);
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, `${id}.json`), JSON.stringify(profile, null, 2), 'utf8');
  return profile;
}
