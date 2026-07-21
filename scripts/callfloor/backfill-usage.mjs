/**
 * backfill-usage.mjs — reconstruct HISTORICAL AI costs into ai_usage_events (Call Floor Phase 1).
 *
 * Offline, node built-ins only, ZERO LLM calls (pure arithmetic — Groq's daily token budget is
 * never touched). Sources, per user profile (Postgres kv_store namespace 'profile' when
 * DATABASE_URL is set, else server/data/users/*.json):
 *   - usageDays {'YYYY-MM-DD': seconds}  → live interview VOICE minutes (the durable per-day log)
 *   - sessions[]                          → count of interviews → deep-analysis/debrief LLM cost
 *
 * Every written row is measured=false (estimated) with the method in meta — reconstruction can
 * never masquerade as telemetry. Rates come from the ONE price book. Estimates are deliberately
 * labeled and ranged; see docs/AUDIT_CALLFLOOR.md §5 for the arithmetic and its limits (e.g.
 * pre-07-20 sessions had no deep-analysis pass → the LLM estimate over-counts old sessions).
 *
 * Usage:  node scripts/callfloor/backfill-usage.mjs           (dry run — prints, writes nothing)
 *         node scripts/callfloor/backfill-usage.mjs --write   (insert rows; refuses to double-run)
 *         node scripts/callfloor/backfill-usage.mjs --write --force   (re-run after a wipe)
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_MINUTE_USD, ANALYSIS_CYCLE_TOKENS, PRICEBOOK } from '../../server/callfloor/pricebook.config.js';
import { recordAiUsage, readUsageEvents } from '../../server/callfloor/usage.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const USERS_DIR = path.join(__dir, '..', '..', 'server', 'data', 'users');
const WRITE = process.argv.includes('--write');
const FORCE = process.argv.includes('--force');

async function loadProfiles() {
  if (process.env.DATABASE_URL) {
    const { cfQuery } = await import('../../server/callfloor/db.js');
    const r = await cfQuery(`SELECT key, value FROM kv_store WHERE namespace = 'profile'`, []);
    return r.rows.map((row) => ({ userId: row.key, ...row.value }));
  }
  const files = await readdir(USERS_DIR).catch(() => []);
  const out = [];
  for (const f of files.filter((f) => f.endsWith('.json'))) {
    try { out.push(JSON.parse(await readFile(path.join(USERS_DIR, f), 'utf8'))); }
    catch { console.error(`[backfill] unreadable profile skipped: ${f}`); }
  }
  return out;
}

// Per-interview LLM estimate = half a full daily cycle (cycle ≈ interview + re-interview + gen,
// measured 2026-07-20). Priced at Groq LIST rates; actual today = $0 (free tier).
const groq = PRICEBOOK['groq:llama-3.3-70b-versatile'];
const PER_SESSION_TOKENS = { in: ANALYSIS_CYCLE_TOKENS.in / 2, out: ANALYSIS_CYCLE_TOKENS.out / 2 };
const PER_SESSION_USD_LIST = PER_SESSION_TOKENS.in * groq.list.in + PER_SESSION_TOKENS.out * groq.list.out;

async function main() {
  if (WRITE && !FORCE) {
    const existing = (await readUsageEvents()).filter((r) => String(r.feature || '').startsWith('backfill-'));
    if (existing.length) {
      console.error(`[backfill] ${existing.length} backfill rows already exist — refusing to double-write (use --force after a deliberate wipe).`);
      process.exit(1);
    }
  }

  const profiles = await loadProfiles();
  const rate = VOICE_MINUTE_USD.cascadeListEstimate;   // all non-owner accounts ran the free cascaded path
  let totMin = 0, totSessions = 0, totListLow = 0, totListHigh = 0, written = 0;

  for (const p of profiles) {
    const userId = p.userId || 'unknown';
    const voiceSec = Object.values(p.usageDays || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    const voiceMin = voiceSec / 60;
    const sessions = Array.isArray(p.sessions) ? p.sessions.length : 0;
    if (!voiceMin && !sessions) continue;

    const voiceListMid = voiceMin * rate.mid;
    const analysisList = sessions * PER_SESSION_USD_LIST;
    totMin += voiceMin; totSessions += sessions;
    totListLow  += voiceMin * rate.low  + analysisList;
    totListHigh += voiceMin * rate.high + analysisList;
    console.log(`user=${userId}  voice=${voiceMin.toFixed(1)}min  sessions=${sessions}  `
      + `estList=$${(voiceListMid + analysisList).toFixed(3)} (actual $0 — free tiers)`);

    if (WRITE) {
      if (voiceMin > 0) {
        const r = await recordAiUsage({
          userId, feature: 'backfill-interview-voice', provider: 'cascade', model: 'deepgram+groq+aura2',
          unitType: 'seconds', unitsIn: voiceSec, unitsOut: 0,
          usdActual: 0, usdList: voiceListMid, measured: false,
          meta: { method: `usageDays seconds × $${rate.mid}/min (${rate.basis})`, range: [voiceMin * rate.low, voiceMin * rate.high] },
        });
        if (r.ok) written++;
      }
      if (sessions > 0) {
        const r = await recordAiUsage({
          userId, feature: 'backfill-deep-analysis', provider: 'groq', model: 'llama-3.3-70b-versatile',
          unitType: 'tokens', unitsIn: sessions * PER_SESSION_TOKENS.in, unitsOut: sessions * PER_SESSION_TOKENS.out,
          usdActual: 0, usdList: analysisList, measured: false,
          meta: { method: `sessions × half of ANALYSIS_CYCLE_TOKENS at Groq list (${ANALYSIS_CYCLE_TOKENS.basis}); over-counts pre-07-20 sessions` },
        });
        if (r.ok) written++;
      }
    }
  }

  console.log(`\n[backfill] users=${profiles.length}  voice=${totMin.toFixed(1)}min  sessions=${totSessions}`);
  console.log(`[backfill] estimated historical LIST cost: $${totListLow.toFixed(2)}–$${totListHigh.toFixed(2)}  (ACTUAL paid: ~$0 — free tiers; Gemini-path spend is tracked separately by geminiBudget.js)`);
  console.log(WRITE ? `[backfill] wrote ${written} estimated rows (measured=false).` : '[backfill] DRY RUN — nothing written (pass --write).');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[backfill] failed:', e.message); process.exit(1); });
