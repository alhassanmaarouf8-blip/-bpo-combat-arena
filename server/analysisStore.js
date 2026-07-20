/**
 * analysisStore.js — durable storage for the Deep Diagnostic Engine (v2 Phase 2).
 *
 * Two new stores on the EXISTING storage seam (db.js KV when DATABASE_URL is set, JSON files
 * otherwise — same dual-mode contract as store.js). Deliberately OUTSIDE the per-user profile
 * blob: analyses carry the full transcript input and would bloat every loadUser/saveUser.
 *
 *   namespace 'analysis' key `${userId}:${sessionId}` → ONE record per interview:
 *     { v, userId, sessionId, status: 'pending'|'ready'|'queued'|'failed',
 *       createdAt, updatedAt, attempts,
 *       input: { dialogue, utterances, metrics, level, csScenarioId },   // ← the transcript now
 *         SURVIVES the socket (audit gap #1): a queued retry — or a future re-diagnosis — can
 *         re-run from here even after a process restart.
 *       analysis, aggregates, usage }                                    // when ready
 *
 *   namespace 'errorlog' key userId → { v, events: [...] } — one flat event per error, the
 *     queryable fuel for the Phase-3 bottleneck selector. Bounded (newest EVENT_CAP kept).
 *     weakLog stays single-writer (the debrief) — Phase 3 decides any merge; nothing here
 *     double-counts into the existing ranker.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbEnabled, kvGet, kvSet } from './db.js';

const BASE_DIR      = path.dirname(fileURLToPath(import.meta.url));
const ANALYSIS_DIR  = path.join(BASE_DIR, 'data', 'analyses');
const ERRORLOG_DIR  = path.join(BASE_DIR, 'data', 'errorlog');
const NS_ANALYSIS   = 'analysis';
const NS_ERRORLOG   = 'errorlog';
export const EVENT_CAP = 2000;

const safe = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'anon';
const key  = (userId, sessionId) => `${safe(userId)}:${safe(sessionId)}`;

async function readJson(dir, name) {
  try { return JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8')); }
  catch { return null; }
}
async function writeJson(dir, name, value) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.json`), JSON.stringify(value), 'utf8');
}

export async function loadAnalysisRecord(userId, sessionId) {
  if (dbEnabled()) return (await kvGet(NS_ANALYSIS, key(userId, sessionId))) ?? null;
  return readJson(ANALYSIS_DIR, `${safe(userId)}__${safe(sessionId)}`);
}

export async function saveAnalysisRecord(record) {
  const k = key(record.userId, record.sessionId);
  record.updatedAt = Date.now();
  if (dbEnabled()) { await kvSet(NS_ANALYSIS, k, record); return record; }
  await writeJson(ANALYSIS_DIR, `${safe(record.userId)}__${safe(record.sessionId)}`, record);
  return record;
}

/** Flatten a validated analysis into error events and append to the user's bounded log. */
export function eventsFromAnalysis({ userId, sessionId, validated, at = Date.now() }) {
  const events = [];
  for (const a of validated.answers) {
    for (const e of a.errors) {
      events.push({
        at, sessionId: safe(sessionId), turnIndex: a.index,
        category: e.kategorie, subcode: e.subcode, code: e.code,
        severity: e.schwere, impact: e.verstaendlichkeit,
        quote: e.quote, corrected: e.korrektur,
      });
    }
  }
  return events;
}

export async function appendErrorEvents(userId, events) {
  if (!events?.length) return 0;
  const id = safe(userId);
  const cur = (dbEnabled() ? await kvGet(NS_ERRORLOG, id) : await readJson(ERRORLOG_DIR, id)) ?? { v: 1, events: [] };
  cur.events = (cur.events || []).concat(events).slice(-EVENT_CAP);
  if (dbEnabled()) await kvSet(NS_ERRORLOG, id, cur);
  else await writeJson(ERRORLOG_DIR, id, cur);
  return events.length;
}

export async function loadErrorEvents(userId) {
  const id = safe(userId);
  const cur = (dbEnabled() ? await kvGet(NS_ERRORLOG, id) : await readJson(ERRORLOG_DIR, id)) ?? { v: 1, events: [] };
  return Array.isArray(cur.events) ? cur.events : [];
}

export default { loadAnalysisRecord, saveAnalysisRecord, eventsFromAnalysis, appendErrorEvents, loadErrorEvents, EVENT_CAP };
