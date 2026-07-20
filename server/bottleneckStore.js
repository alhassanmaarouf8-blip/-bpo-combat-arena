/**
 * bottleneckStore.js — persistence for daily bottleneck selections (Phase 3).
 * Same dual-mode seam as analysisStore: KV namespace 'bottlenecks' key userId, file fallback.
 * One record per analyzed interview (the "daily_bottlenecks table" adapted to the KV model),
 * newest last, bounded to RECORD_CAP.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbEnabled, kvGet, kvSet } from './db.js';
import { RECORD_CAP } from './bottleneckSelector.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'bottlenecks');
const NS  = 'bottlenecks';
const safe = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'anon';

export async function loadBottlenecks(userId) {
  const id = safe(userId);
  let cur = null;
  if (dbEnabled()) cur = await kvGet(NS, id);
  else { try { cur = JSON.parse(await readFile(path.join(DIR, `${id}.json`), 'utf8')); } catch { /* new */ } }
  return cur && Array.isArray(cur.records) ? cur : { v: 1, records: [] };
}

export async function saveBottlenecks(userId, state) {
  const id = safe(userId);
  state.records = (state.records || []).slice(-RECORD_CAP);
  if (dbEnabled()) { await kvSet(NS, id, state); return state; }
  if (!existsSync(DIR)) await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, `${id}.json`), JSON.stringify(state), 'utf8');
  return state;
}

/** The current OPEN (or drilled/retested — i.e. not closed) most recent record, if any. */
export function latestActiveRecord(state) {
  return (state?.records || []).filter((r) => r.status !== 'closed').at(-1) || null;
}

export default { loadBottlenecks, saveBottlenecks, latestActiveRecord };
