/**
 * db.js — optional durable storage.
 *
 * Render's free web-service disk is EPHEMERAL: every restart/redeploy wipes the local
 * JSON files, so accounts/progress/feedback are lost. When a DATABASE_URL is provided
 * (Render's free managed Postgres), this module backs the existing storage seams
 * (store.js, auth.js, feedback.js) with a durable JSONB key-value table instead.
 *
 * If DATABASE_URL is NOT set, dbEnabled() is false and every consumer transparently
 * falls back to the original file storage — so local dev needs neither `pg` nor a DB.
 * `pg` is imported LAZILY (only when a DB is actually configured), so a missing pg
 * dependency never breaks file-only runs.
 *
 * One generic table:
 *   kv_store(namespace text, key text, value jsonb, updated_at timestamptz)
 *   - namespace 'profile' / key=userId      → per-user progress profile
 *   - namespace 'auth'    / key='store'      → the accounts + emailIndex blob
 *   - namespace 'feedback'/ key='all'        → the feedback array
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export function dbEnabled() {
  return !!process.env.DATABASE_URL;
}

let _pool = null;
let _ready = null;

export function databaseConnectionConfig(rawUrl) {
  const parsed = new URL(String(rawUrl || ''));
  // Render internal hosts do not use TLS. External hosts must verify the full certificate and
  // hostname. Normalize the query too: `sslmode=require` would otherwise override the explicit
  // secure object and emits a future-semantics warning at every production boot.
  const useSsl = parsed.hostname.includes('.');
  if (useSsl) parsed.searchParams.set('sslmode', 'verify-full');
  else parsed.searchParams.delete('sslmode');
  return {
    connectionString:parsed.toString(),
    ssl:useSsl ? { rejectUnauthorized:true } : false,
  };
}

async function getPool() {
  if (_pool) return _pool;
  // Lazy: only require pg when a database is actually configured.
  const pg = (await import('pg')).default;
  const url = process.env.DATABASE_URL;
  // Render's INTERNAL host (e.g. dpg-xxxx-a, no domain dot) does NOT use SSL; the
  // EXTERNAL host (….render.com) requires it. Detect by whether the host has a dot.
  const connection = databaseConnectionConfig(url);
  _pool = new pg.Pool({
    connectionString:  connection.connectionString,
    // External providers must present a publicly trusted certificate. Disabling
    // verification turns every account/password/payment query into MITM-readable data.
    ssl:               connection.ssl,
    max:               5,
    idleTimeoutMillis: 30_000,
  });
  _pool.on('error', (err) => console.error('[db] pool error:', err.message));
  return _pool;
}

// Ensure the table exists exactly once per process.
function ensureReady() {
  if (!_ready) {
    _ready = (async () => {
      const pool = await getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS kv_store (
          namespace  text        NOT NULL,
          key        text        NOT NULL,
          value      jsonb       NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (namespace, key)
        )`);
      console.log('[db] Connected — durable storage active (kv_store ready)');

      // Additive: ensure the optional weakness-DB schema (NEW tables only — every statement is
      // CREATE TABLE/INDEX IF NOT EXISTS, wrapped in BEGIN/COMMIT). Fully ISOLATED in its own
      // try/catch so a failure here can NEVER break kv_store readiness or the live app. The
      // schema is idempotent, so it is safe to re-run on every boot.
      try {
        const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'weakness_db_schema.sql');
        await pool.query(await readFile(sqlPath, 'utf8'));
        console.log('[db] weakness schema ensured (weakness_taxonomy / error_events / weakness_profile)');
      } catch (e) {
        console.warn('[db] weakness schema NOT applied (non-fatal, app unaffected):', e.message);
      }
    })().catch((err) => { _ready = null; throw err; });
  }
  return _ready;
}

export async function ensureDatabaseReady() {
  if (!dbEnabled()) throw new Error('DATABASE_URL is required');
  await ensureReady();
  return true;
}

export async function kvGet(namespace, key) {
  await ensureReady();
  const pool = await getPool();
  const r = await pool.query('SELECT value FROM kv_store WHERE namespace = $1 AND key = $2', [namespace, key]);
  return r.rows[0]?.value ?? null;   // jsonb is auto-parsed to a JS value
}

export async function kvSet(namespace, key, value) {
  await ensureReady();
  const pool = await getPool();
  await pool.query(
    `INSERT INTO kv_store (namespace, key, value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (namespace, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [namespace, key, JSON.stringify(value)],
  );
}

// Hard-delete one row (used by admin account deletion to remove a user's profile).
export async function kvDel(namespace, key) {
  await ensureReady();
  const pool = await getPool();
  await pool.query('DELETE FROM kv_store WHERE namespace = $1 AND key = $2', [namespace, key]);
}

export async function deleteWeaknessData(userId) {
  if (!dbEnabled()) return 0;
  await ensureReady();
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const events = await client.query('DELETE FROM error_events WHERE user_id = $1', [String(userId)]);
    const profiles = await client.query('DELETE FROM weakness_profile WHERE user_id = $1', [String(userId)]);
    await client.query('COMMIT');
    return (events.rowCount || 0) + (profiles.rowCount || 0);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
