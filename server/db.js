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

export function dbEnabled() {
  return !!process.env.DATABASE_URL;
}

let _pool = null;
let _ready = null;

async function getPool() {
  if (_pool) return _pool;
  // Lazy: only require pg when a database is actually configured.
  const pg = (await import('pg')).default;
  _pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Render Postgres requires TLS; its cert chain isn't in Node's trust store.
    ssl: { rejectUnauthorized: false },
    max: 5,
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
    })().catch((err) => { _ready = null; throw err; });
  }
  return _ready;
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
