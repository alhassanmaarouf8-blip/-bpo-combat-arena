/**
 * funnelBeacon.js — first-party, $0, PII-free funnel counters.
 *
 * Built after the 07-06 cohort: 8 real signups, 7 never reached interview #1, and NOTHING could
 * say where they dropped (in-app browser? cold start? mic?) because the app had zero analytics.
 * Every next visitor now answers it automatically.
 *
 *   POST /api/beacon { e }   — count one allowed event (no auth — it fires pre-signup too)
 *   GET  /api/diag/funnel    — today + yesterday counters (counts only; safe one-curl read)
 *
 * No IPs, no emails, no per-user ids, no cookies — whitelisted event names only, one kv row per
 * day, flushed at most every 5s. A counter must never 500 or slow the client.
 */
import express from 'express';
import { dbEnabled, kvGet, kvSet } from './db.js';
import { dayKey } from './time.js';
import { adminRequestOk } from './adminAuth.js';

export const beaconRouter = express.Router();

const NS = 'funnel';
const ALLOWED = new Set([
  'open', 'open_inapp', 'inapp_escape_tap',
  'assessment_shown', 'start_clicked', 'ws_connected', 'connect_timeout',
  'boss_spoke', 'mic_started', 'mic_failed', 'mic_unsupported', 'debrief_shown',
  'paywall_shown', 'whatsapp_prompt_shown', 'whatsapp_saved',
  // Voice-path health (2026-07-09): a fight that silently drops from Gemini native audio to the
  // text pipeline feels transcript-gated and laggy, and until now NOTHING recorded it happening.
  // gemini_fight = the second session_ready flagged useGeminiAudio; gemini_fallback = GEMINI_ENDED
  // reached the client mid-fight. start_clicked − gemini_fight = fights that never got Gemini.
  'gemini_fight', 'gemini_fallback',
  // Salma recruiter cold-open (2026-07-12): shown → name saved → booked/skipped/later/done. The
  // whitelist gate silently 400'd all of these on launch day — her funnel was invisible.
  'salma_intro_shown', 'salma_name_saved', 'salma_booked', 'salma_skipped', 'salma_later', 'salma_done',
  // Cross-device auth hardening (2026-07-12): blocked WebView signups + the PWA install funnel.
  'inapp_signup_blocked', 'pwa_install_shown', 'pwa_install_accepted', 'pwa_ios_hint_shown',
  // Correction ritual (2026-07-12, expert-teacher doctrine): candidate tapped "Laut gesagt" after
  // repeating the verified fix aloud — measures whether the ritual is actually performed.
  'ritual_done',
  // B1+ admission gate (2026-07-12, owner positioning law): Salma's door question at the
  // cold-open — measures the true level mix of the funnel.
  'gate_b1_yes', 'gate_b1_no',
]);
const DAY_CAP = 50_000;   // abuse/runaway ceiling per event per day
const MAX_KEYS = 200;     // distinct-counter ceiling per day (src slugs can't explode the row)

let _cache = { day: null, counts: {} };
let _flush = null;
const beaconRate = new Map();

async function bump(e) {
  const day = dayKey();
  if (_cache.day !== day) {
    _cache = { day, counts: (dbEnabled() ? await kvGet(NS, day) : null) ?? {} };
  }
  if (!(e in _cache.counts) && Object.keys(_cache.counts).length >= MAX_KEYS) return;
  _cache.counts[e] = Math.min(DAY_CAP, (_cache.counts[e] || 0) + 1);
  if (!_flush) {
    _flush = setTimeout(async () => {
      _flush = null;
      try { if (dbEnabled()) await kvSet(NS, _cache.day, _cache.counts); } catch { /* next event retries */ }
    }, 5000);
    _flush.unref?.();
  }
}

beaconRouter.post('/beacon', async (req, res) => {
  const ip = String(req.ip || 'unknown'), now = Date.now();
  const hits = (beaconRate.get(ip) || []).filter((at) => now - at < 60 * 60 * 1000);
  if (hits.length >= 120) return res.status(429).json({ ok: false });
  hits.push(now); beaconRate.set(ip, hits);
  const e = String(req.body?.e || '');
  if (!ALLOWED.has(e)) return res.status(400).json({ ok: false });
  // Optional channel tag (owner posts per-group links with ?src=<slug>): count the plain event
  // AND a per-source variant, so /api/diag/funnel answers "WHICH group converts", not just "how many".
  const src = String(req.body?.src || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16);
  try { await bump(e); if (src) await bump(`${e}@${src}`); } catch { /* counters must never fail the client */ }
  res.json({ ok: true });
});

beaconRouter.get('/diag/funnel', async (req, res) => {
  if (!adminRequestOk(req)) return res.status(403).json({ error: 'forbidden' });
  res.set('Cache-Control', 'no-store');
  try {
    const today = dayKey(), yesterday = dayKey(Date.now() - 86_400_000);
    const t = _cache.day === today ? _cache.counts : ((dbEnabled() ? await kvGet(NS, today) : null) ?? {});
    const y = (dbEnabled() ? await kvGet(NS, yesterday) : null) ?? {};
    res.json({ [today]: t, [yesterday]: y });
  } catch { res.json({}); }
});
