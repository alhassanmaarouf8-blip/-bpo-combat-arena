/**
 * guideStore.js — persistent per-user memory for the Alhassan guide (total recall).
 *
 * Mirrors store.js EXACTLY: durable in Postgres via the kv_store seam when DATABASE_URL is set
 * (namespace 'guide', key = userId — this IS the per-user "journey table" row), and falls back
 * to a JSON file per user for local dev. NO new table migration, NO new service, zero added cost.
 *
 * Shape per user:
 *   { userId, history: [{role,content,at,flagged?}], summary, summaryCoversN, name, goal,
 *     firstSeenAt, lastSeenAt, messageCount }
 *   - history       : COMPLETE raw conversation, never truncated (total recall).
 *   - summary       : running journey log of OLDER turns (for the context window), Egyptian Arabic.
 *   - summaryCoversN: how many leading history messages `summary` already covers.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync }                 from 'fs';
import path                           from 'path';
import { fileURLToPath }              from 'url';
import { dbEnabled, kvGet, kvSet }    from './db.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'guide');
const cache    = new Map();
const NS       = 'guide';

function safeId(id) { return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'anon'; }

export function defaultGuide(userId) {
  return { userId, history: [], summary: '', summaryCoversN: 0, name: null, goal: null,
           firstSeenAt: Date.now(), lastSeenAt: 0, messageCount: 0 };
}

export async function loadGuide(userId) {
  const id = safeId(userId);
  if (cache.has(id)) return cache.get(id);

  let saved = null;
  try {
    if (dbEnabled()) {
      saved = await kvGet(NS, id);
    } else {
      if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
      try { saved = JSON.parse(await readFile(path.join(DATA_DIR, `${id}.json`), 'utf8')); } catch { /* new user */ }
    }
  } catch (e) {
    // Never crash a session on a load failure — Alhassan works without memory this time.
    console.error('[guideStore] load failed (continuing without memory):', e.message);
    saved = null;
  }

  const g = { ...defaultGuide(id), ...(saved || {}), userId: id };
  if (!Array.isArray(g.history)) g.history = [];
  cache.set(id, g);
  return g;
}

export async function saveGuide(g) {
  const id = safeId(g.userId);
  g.userId = id;
  cache.set(id, g);
  if (dbEnabled()) { await kvSet(NS, id, g); return g; }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, `${id}.json`), JSON.stringify(g, null, 2), 'utf8');
  return g;
}
