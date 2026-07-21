/**
 * callfloor/usage.js — the ai_usage_events recorder (Call Floor Phase 1, the margin engine's fuel).
 *
 * ONE function every Mode 2 AI call reports through: recordAiUsage(event). Durable path is the
 * ai_usage_events Postgres table (callfloor/db.js). Without DATABASE_URL it appends JSONL to a
 * local file — EPHEMERAL on Render (disk wiped on restart/redeploy); the audit tells the owner
 * durable cost telemetry requires the DB. LOGGING FAILURE IS NEVER FEATURE FAILURE: this module
 * never throws into a caller's path — it logs the error and returns { ok:false }.
 *
 * Mode 1 (frozen) calls are NOT wrapped — per the Phase 1 contract they are estimate-only
 * (see docs/AUDIT_CALLFLOOR.md §3); the backfill script writes those rows with measured=false.
 */

import { appendFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { callfloorDbEnabled, cfQuery } from './db.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_FILE = () => process.env.CALLFLOOR_USAGE_FILE
  || path.join(__dir, '..', 'data', 'callfloor-usage.jsonl');

const UNIT_TYPES = new Set(['tokens', 'seconds', 'chars', 'requests']);

/** Normalize + validate one usage event; returns null when the event is unusable. */
export function shapeUsageEvent(e = {}) {
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  const str = (v, fb) => (String(v ?? '').trim() || fb);
  const unitType = str(e.unitType, '');
  if (!UNIT_TYPES.has(unitType)) return null;
  return {
    ts:        Number.isFinite(e.ts) ? new Date(e.ts).toISOString() : new Date().toISOString(),
    userId:    str(e.userId, 'system').slice(0, 64),
    feature:   str(e.feature, 'unknown').slice(0, 64),
    provider:  str(e.provider, 'unknown').slice(0, 64),
    model:     str(e.model, 'unknown').slice(0, 128),
    unitType,
    unitsIn:   num(e.unitsIn),
    unitsOut:  num(e.unitsOut),
    usdActual: num(e.usdActual),
    usdList:   num(e.usdList),
    measured:  e.measured !== false,
    meta:      (e.meta && typeof e.meta === 'object') ? e.meta : null,
  };
}

/** Record one AI usage event. Never throws. → { ok, sink: 'db'|'file'|null } */
export async function recordAiUsage(event) {
  const row = shapeUsageEvent(event);
  if (!row) {
    console.error('[callfloor/usage] dropped malformed usage event:', JSON.stringify(event).slice(0, 200));
    return { ok: false, sink: null };
  }
  try {
    if (callfloorDbEnabled()) {
      await cfQuery(
        `INSERT INTO ai_usage_events
           (ts, user_id, feature, provider, model, unit_type, units_in, units_out, usd_actual, usd_list, measured, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [row.ts, row.userId, row.feature, row.provider, row.model, row.unitType,
         row.unitsIn, row.unitsOut, row.usdActual, row.usdList, row.measured,
         row.meta ? JSON.stringify(row.meta) : null],
      );
      return { ok: true, sink: 'db' };
    }
    const file = FALLBACK_FILE();
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(row) + '\n', 'utf8');
    return { ok: true, sink: 'file' };
  } catch (err) {
    console.error('[callfloor/usage] record failed (feature continues):', err.message);
    return { ok: false, sink: null };
  }
}

/** Read back events (verification/tests; Phase 4 builds the real ledger). Never throws. */
export async function readUsageEvents({ userId } = {}) {
  try {
    if (callfloorDbEnabled()) {
      const r = userId
        ? await cfQuery('SELECT * FROM ai_usage_events WHERE user_id = $1 ORDER BY ts', [userId])
        : await cfQuery('SELECT * FROM ai_usage_events ORDER BY ts', []);
      return r.rows;
    }
    const text = await readFile(FALLBACK_FILE(), 'utf8').catch(() => '');
    const rows = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return userId ? rows.filter((r) => r.userId === userId) : rows;
  } catch (err) {
    console.error('[callfloor/usage] read failed:', err.message);
    return [];
  }
}

export default { shapeUsageEvent, recordAiUsage, readUsageEvents };
