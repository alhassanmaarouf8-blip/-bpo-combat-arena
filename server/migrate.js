/**
 * migrate.js — DB migration runner (no-op when DATABASE_URL is not set).
 * Runs at server startup before routes are exercised.
 */
import { dbEnabled, pool } from './db.js';

export async function runMigrations() {
  if (!dbEnabled()) return;
  try {
    // Ensure the srs_items table exists for future SRS-to-DB migration path.
    // All current SRS data lives in the user profile JSON blob — this is a no-op guard.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id    SERIAL PRIMARY KEY,
        name  TEXT UNIQUE NOT NULL,
        ran_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    console.log('[migrate] DB ready');
  } catch (err) {
    console.warn('[migrate] Could not initialise migrations table:', err.message);
  }
}
