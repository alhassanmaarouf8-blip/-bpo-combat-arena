/**
 * callfloor/db.js — Mode 2's OWN database seam (Call Floor Phase 1).
 *
 * RULE ZERO: Mode 2 never modifies a Mode 1 file. So this module opens its OWN pg pool —
 * importing only the exported, read-only helpers from server/db.js (dbEnabled +
 * databaseConnectionConfig) — and applies callfloor_schema.sql itself (idempotent,
 * CREATE IF NOT EXISTS only). A failure anywhere in here can never touch Mode 1: every
 * consumer of this module already fails soft.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbEnabled, databaseConnectionConfig } from '../db.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));

let _pool = null;
let _ready = null;

async function getPool() {
  if (_pool) return _pool;
  const pg = (await import('pg')).default;
  const connection = databaseConnectionConfig(process.env.DATABASE_URL);
  _pool = new pg.Pool({
    connectionString:  connection.connectionString,
    ssl:               connection.ssl,
    max:               3,          // Mode 2 is low-traffic in Phase 1; keep the footprint small
    idleTimeoutMillis: 30_000,
  });
  _pool.on('error', (err) => console.error('[callfloor/db] pool error:', err.message));
  return _pool;
}

function ensureReady() {
  if (!_ready) {
    _ready = (async () => {
      const pool = await getPool();
      const sql = await readFile(path.join(__dir, 'callfloor_schema.sql'), 'utf8');
      await pool.query(sql);
      console.log('[callfloor/db] schema ensured (ai_usage_events)');
    })().catch((err) => { _ready = null; throw err; });
  }
  return _ready;
}

export function callfloorDbEnabled() { return dbEnabled(); }

/** Run one parameterized query against the Mode 2 pool (schema guaranteed first). */
export async function cfQuery(text, params = []) {
  await ensureReady();
  const pool = await getPool();
  return pool.query(text, params);
}

// Test-only: drop cached state so tests can point DATABASE_URL elsewhere.
export function _resetForTest() { _pool = null; _ready = null; }

export default { callfloorDbEnabled, cfQuery, _resetForTest };
