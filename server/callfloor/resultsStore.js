/**
 * callfloor/resultsStore.js — durable Mode 2 storage: call_sessions + call_results.
 *
 * Same dual-mode contract as the rest of the app: real Postgres tables (callfloor_schema.sql,
 * own pool) when DATABASE_URL is set, JSON files under server/data/callfloor/ otherwise (local
 * dev). The TRANSCRIPT is persisted the moment a call ends — the pipeline-audit law: transcripts
 * must never die with the connection; the post-call analysis retries from here.
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callfloorDbEnabled, cfQuery } from './db.js';

const BASE = () => process.env.CALLFLOOR_DATA_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'callfloor');
const DIR_SESSIONS = () => path.join(BASE(), 'sessions');
const DIR_RESULTS  = () => path.join(BASE(), 'results');

const safe = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'anon';

async function writeJson(dir, name, value) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.json`), JSON.stringify(value), 'utf8');
}
async function readJson(dir, name) {
  try { return JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8')); }
  catch { return null; }
}
async function listJson(dir) {
  const files = await readdir(dir).catch(() => []);
  const out = [];
  for (const f of files.filter((f) => f.endsWith('.json'))) {
    const v = await readJson(dir, f.slice(0, -5));
    if (v) out.push(v);
  }
  return out;
}

/** record = { id, userId, quadrant, scenarioId, startedAt, endedAt, status, analysisStatus, transcript, cairoDay } */
export async function saveCallSession(record) {
  if (callfloorDbEnabled()) {
    await cfQuery(
      `INSERT INTO call_sessions (id, user_id, quadrant, scenario_id, started_at, ended_at, status, analysis_status, transcript, cairo_day)
       VALUES ($1,$2,$3,$4,to_timestamp($5/1000.0),to_timestamp($6/1000.0),$7,$8,$9::jsonb,$10)
       ON CONFLICT (id) DO UPDATE SET ended_at = EXCLUDED.ended_at, status = EXCLUDED.status,
         analysis_status = EXCLUDED.analysis_status, transcript = EXCLUDED.transcript`,
      [record.id, safe(record.userId), record.quadrant, record.scenarioId, record.startedAt,
       record.endedAt ?? record.startedAt, record.status, record.analysisStatus || 'pending',
       JSON.stringify(record.transcript ?? null), record.cairoDay],
    );
    return record;
  }
  await writeJson(DIR_SESSIONS(), safe(record.id), record);
  return record;
}

export async function loadCallSession(id) {
  if (callfloorDbEnabled()) {
    const r = await cfQuery('SELECT * FROM call_sessions WHERE id = $1', [safe(id)]);
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id, userId: row.user_id, quadrant: row.quadrant, scenarioId: row.scenario_id,
      startedAt: new Date(row.started_at).getTime(), endedAt: row.ended_at ? new Date(row.ended_at).getTime() : null,
      status: row.status, analysisStatus: row.analysis_status, transcript: row.transcript, cairoDay: row.cairo_day,
    };
  }
  return readJson(DIR_SESSIONS(), safe(id));
}

/** result = { sessionId, userId, quadrant, scenarioId, handleSeconds, satisfactionFinal, resolved, skills, meta } */
export async function saveCallResult(result) {
  if (callfloorDbEnabled()) {
    await cfQuery(
      `INSERT INTO call_results (session_id, user_id, quadrant, scenario_id, handle_seconds, satisfaction_final, resolved, skills, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
      [safe(result.sessionId), safe(result.userId), result.quadrant, result.scenarioId,
       result.handleSeconds ?? 0, result.satisfactionFinal ?? null, result.resolved ?? null,
       JSON.stringify(result.skills ?? []), JSON.stringify(result.meta ?? null)],
    );
    return result;
  }
  await writeJson(DIR_RESULTS(), `${safe(result.userId)}__${safe(result.sessionId)}`, { ...result, createdAt: Date.now() });
  return result;
}

export async function listCallResults(userId) {
  const id = safe(userId);
  if (callfloorDbEnabled()) {
    const r = await cfQuery('SELECT * FROM call_results WHERE user_id = $1 ORDER BY created_at', [id]);
    return r.rows.map((row) => ({
      sessionId: row.session_id, userId: row.user_id, quadrant: row.quadrant, scenarioId: row.scenario_id,
      handleSeconds: row.handle_seconds, satisfactionFinal: row.satisfaction_final, resolved: row.resolved,
      skills: row.skills, meta: row.meta, createdAt: new Date(row.created_at).getTime(),
    }));
  }
  const all = await listJson(DIR_RESULTS());
  return all.filter((r) => safe(r.userId) === id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** Seconds of call time the user has already consumed today (durable — the daily-cap source). */
export async function secondsUsedToday(userId, cairoDay) {
  const id = safe(userId);
  if (callfloorDbEnabled()) {
    const r = await cfQuery(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))), 0) AS sec
         FROM call_sessions WHERE user_id = $1 AND cairo_day = $2`, [id, cairoDay]);
    return Math.round(Number(r.rows[0]?.sec) || 0);
  }
  const all = await listJson(DIR_SESSIONS());
  return Math.round(all
    .filter((s) => safe(s.userId) === id && s.cairoDay === cairoDay)
    .reduce((sum, s) => sum + Math.max(0, ((s.endedAt || Date.now()) - s.startedAt) / 1000), 0));
}

export default { saveCallSession, loadCallSession, saveCallResult, listCallResults, secondsUsedToday };
