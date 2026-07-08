/**
 * feedback.js — user feedback collection.
 *
 *   POST /api/feedback   { rating?, answers?, text?, screen? }
 *
 * The client sends only the answers; the SERVER attaches userId, timestamp, sessionCount
 * (how many fights the user has done), level (A2-B1/B2 from their last fight), and the
 * screen it came from. Every entry is appended to server/feedback.json and logged live.
 * Uses the same file-based store pattern as the rest of the server (loadUser + fs).
 */
import express from 'express';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'crypto';
import { loadUser } from './store.js';
import { loadGuide } from './guideStore.js';
import { requireAuth, isAdminEmail } from './auth.js';
import { dbEnabled, kvGet, kvSet } from './db.js';

export const feedbackRouter = express.Router();
const FEEDBACK_FILE   = path.join(path.dirname(fileURLToPath(import.meta.url)), 'feedback.json');

async function loadFeedback() {
  if (dbEnabled()) return (await kvGet('feedback', 'all')) ?? [];
  try { return JSON.parse(await readFile(FEEDBACK_FILE, 'utf8')); } catch { return []; }
}

async function saveFeedback(all) {
  if (dbEnabled()) { await kvSet('feedback', 'all', all); return; }
  await writeFile(FEEDBACK_FILE, JSON.stringify(all, null, 2), 'utf8');
}

// ── Public ratings (landing-page social proof) ────────────────────────────────
// Owner (2026-07-02): show the real user ratings publicly. Honesty rules, non-negotiable:
//   - avgRating/ratingCount are computed over EVERY rating ever submitted — never just the
//     ones displayed. This is the anchor that keeps the curated quotes below from being
//     misleading cherry-picking: the true average is always shown alongside them.
//   - Below MIN_PUBLIC_RATINGS, the whole section reports unavailable rather than presenting a
//     thin, unrepresentative sample as if it were robust social proof (same doctrine as the
//     DailyMission trend chip elsewhere in this app: no data → say nothing, never fake it).
//   - Comments never carry email/name/timestamp — text + the SAME rating that quote earned,
//     capped in length. Sampled from rating>=4 (a testimonials sample, standard practice) but the
//     honest average above always reflects the FULL distribution, including anything lower.
// Threshold lowered to 1 (owner: "doesn't have to be big, just mentioned" — show it even with few
// ratings); ratingCount is always shown so 2 ratings reads honestly as "2", not a fake big average.
// Comments now carry the NAME (never email — owner's explicit privacy choice), resolved by the route.
const MIN_PUBLIC_RATINGS = 1;
const MAX_PUBLIC_COMMENTS = 6;
const MAX_COMMENT_CHARS  = 200;

// A public-safe display name: a stored name (from the Alhassan guide profile) if we have one,
// else a neutral label. NEVER the email — the owner explicitly chose names-only for privacy.
function displayName(e) {
  const n = String(e?.name || '').trim();
  return n || 'Ein Lernender';   // OWNER-AR slot (neutral fallback label)
}

// Best-effort: stamp a `name` onto entries that lack one, resolved from the Alhassan guide profile
// by userId (so his + Fares' EXISTING feedback shows a name too, not just future submissions).
// Bounded to the entries passed (a recent slice) and failure-tolerant → neutral fallback on miss.
async function enrichNames(entries) {
  await Promise.all((Array.isArray(entries) ? entries : []).map(async (e) => {
    if (e.name || !e.userId) return;
    try { const g = await loadGuide(e.userId); if (g?.name) e.name = g.name; } catch { /* neutral fallback */ }
  }));
  return entries;
}

/** Pure + exported for unit tests. Entries may carry an optional `name` (resolved by the route).
 *  Reads e.name only — NEVER e.email — so PII can't leak into a public comment. */
export function buildPublicRatings(all) {
  const entries = Array.isArray(all) ? all : [];
  const ratings = entries.map((e) => e.rating).filter((n) => Number.isFinite(n) && n > 0);
  if (ratings.length < MIN_PUBLIC_RATINGS) return { available: false };

  const avgRating = Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
  const comments = entries
    .filter((e) => Number.isFinite(e.rating) && e.rating >= 4 && String(e.text || '').trim())
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, MAX_PUBLIC_COMMENTS)
    .map((e) => ({ name: displayName(e), rating: e.rating, text: String(e.text).trim().slice(0, MAX_COMMENT_CHARS) }));

  return { available: true, avgRating, ratingCount: ratings.length, comments };
}

feedbackRouter.get('/feedback/public', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');   // 5 min — this is public marketing data, cheap to cache
  try {
    const all = await loadFeedback();
    await enrichNames((Array.isArray(all) ? all : []).slice(-60));   // resolve names for the recent slice we might show
    res.json(buildPublicRatings(all));
  } catch (err) {
    console.error('[feedback] public error:', err.message);
    res.json({ available: false });   // never break the landing page over this
  }
});

feedbackRouter.post('/feedback', requireAuth, async (req, res) => {
  try {
    const { rating, answers, text, screen } = req.body || {};
    const p = await loadUser(req.account.id);
    const sessions = p.sessions || [];
    // Capture the display NAME at write time (from the Alhassan guide profile) so public ratings
    // can show a name without an email (owner's privacy choice). Best-effort; null if unknown.
    let name = null;
    try { const g = await loadGuide(req.account.id); name = g?.name || null; } catch { /* stays null */ }

    const entry = {
      userId:       req.account.id,
      email:        req.account.email ?? null,   // stored for the ADMIN view only; NEVER sent to /feedback/public
      name:         name,
      timestamp:    new Date().toISOString(),
      sessionCount: sessions.length,                                   // how many fights so far
      level:        sessions.slice(-1)[0]?.level ?? 'a2-b1',           // their last fight's level
      screen:       typeof screen === 'string' ? screen.slice(0, 40) : 'unknown',
      rating:       Number.isFinite(+rating) ? Math.max(0, Math.min(5, Math.round(+rating))) : null,
      answers:      (answers && typeof answers === 'object') ? answers : null,
      text:         typeof text === 'string' ? text.slice(0, 2000) : '',
    };

    const all = await loadFeedback();
    all.push(entry);
    await saveFeedback(all);

    console.log(`[feedback] NEW · user=${entry.userId} · screen=${entry.screen} · rating=${entry.rating ?? '—'} · ` +
      `sessions=${entry.sessionCount} · level=${entry.level} · answers=${JSON.stringify(entry.answers)} · ` +
      `text="${(entry.text || '').replace(/\s+/g, ' ').slice(0, 100)}"`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[feedback] error:', err.message);
    res.status(500).json({ error: 'feedback_failed' });
  }
});

// ── Public feedback submission (NO login) — the shareable-link form ─────────────
// Owner (2026-07-08): a link to send on Messenger/WhatsApp so people who never reach the
// in-app feedback button can still leave detailed feedback. Feeds the SAME store as the
// authed route, so a rating>=4 with text flows into /feedback/public (avg + testimonials)
// on the next cache cycle. Unauthenticated → these guards matter: a honeypot (silent-drop
// bots), a per-IP rate limit, hard length caps, and a require-some-signal check so empty
// spam is rejected. No userId/email is ever attached (there's no logged-in user here).
const pubRate = new Map();                 // ip -> [timestamps]; in-memory soft cap, resets on restart
const PUB_WINDOW_MS = 60 * 60 * 1000;      // 1 hour
const PUB_MAX = 6;                         // max public submissions per IP per hour
function pubRateOk(ip) {
  const now = Date.now();
  const arr = (pubRate.get(ip) || []).filter((t) => now - t < PUB_WINDOW_MS);
  if (arr.length >= PUB_MAX) { pubRate.set(ip, arr); return false; }
  arr.push(now); pubRate.set(ip, arr); return true;
}

feedbackRouter.post('/feedback/public', async (req, res) => {
  try {
    const { rating, liked, disliked, name, hp } = req.body || {};
    // Honeypot: real users never fill this hidden field. Report ok so bots don't retry, but store nothing.
    if (typeof hp === 'string' && hp.trim()) return res.json({ ok: true });

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    if (!pubRateOk(ip)) return res.status(429).json({ error: 'rate_limited' });

    const r         = Number.isFinite(+rating) ? Math.max(0, Math.min(5, Math.round(+rating))) : null;
    const likedT    = typeof liked === 'string'    ? liked.slice(0, 1000).trim()    : '';
    const dislikedT = typeof disliked === 'string' ? disliked.slice(0, 1000).trim() : '';
    const nm        = typeof name === 'string'     ? name.slice(0, 40).trim()       : '';
    // Require a real signal — a star rating OR some words. Nothing to store → reject.
    if (!r && !likedT && !dislikedT) return res.status(400).json({ error: 'empty' });

    const entry = {
      userId:       null,
      email:        null,
      name:         nm || null,
      source:       'public-link',
      timestamp:    new Date().toISOString(),
      sessionCount: null,
      level:        null,
      screen:       'public-link',
      rating:       r,
      answers:      { liked: likedT || null, disliked: dislikedT || null },
      // Public testimonials (rating>=4) render `text` — put the POSITIVE part there; the
      // critical "besser machen" note stays in answers for the owner's admin view only.
      text:         likedT,
    };

    const all = await loadFeedback();
    all.push(entry);
    await saveFeedback(all);

    console.log(`[feedback] PUBLIC · ip=${ip} · rating=${entry.rating ?? '—'} · name=${nm || 'anon'} · ` +
      `liked="${likedT.replace(/\s+/g, ' ').slice(0, 80)}" · disliked="${dislikedT.replace(/\s+/g, ' ').slice(0, 80)}"`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[feedback] public post error:', err.message);
    res.status(500).json({ error: 'feedback_failed' });
  }
});

// NOTE: the placement loop (POST/GET /api/placement, the hire KPI) lives in placement.js —
// the single source of truth. A legacy duplicate handler used to live HERE and, because this
// router mounts first, it SHADOWED placement.js: the client sends {status, employer} but this
// handler read {hired, company}, so every real hire was silently stored as hired:false. Removed
// so the canonical placement.js handler receives the POST. The hire dashboard is GET /admin/placements.

// ── Owner-only dashboard: read all feedback + a willingness-to-pay summary ─────
// Gated to ADMIN_EMAIL accounts (set the env var on the server). Returns aggregates
// (avg rating, price-bucket counts, "felt real" yes/no) plus the newest entries.
feedbackRouter.get('/feedback/admin', requireAuth, async (req, res) => {
  if (!isAdminEmail(req.account.email)) return res.status(403).json({ error: 'forbidden' });
  try {
    const all = Array.isArray(await loadFeedback()) ? await loadFeedback() : [];
    const ratings = all.map((e) => e.rating).filter((n) => Number.isFinite(n) && n > 0);
    const avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;

    const priceCounts = {};
    let feltRealYes = 0, feltRealNo = 0;
    for (const e of all) {
      const a = e.answers || {};
      if (a.price) priceCounts[a.price] = (priceCounts[a.price] || 0) + 1;
      if (a.feltReal === true)  feltRealYes++;
      else if (a.feltReal === false) feltRealNo++;
    }

    // Placement / hire outcomes now live in placement.js → GET /admin/placements (canonical).
    const summary = { total: all.length, avgRating, ratingCount: ratings.length, priceCounts, feltRealYes, feltRealNo };
    const entries = all.slice(-200).reverse().map((e) => ({
      timestamp: e.timestamp, screen: e.screen, rating: e.rating ?? null,
      answers: e.answers ?? null, text: e.text ?? '', email: e.email ?? null, name: e.name ?? null,
      sessionCount: e.sessionCount, level: e.level,
    }));

    res.json({ summary, entries });
  } catch (err) {
    console.error('[feedback] admin error:', err.message);
    res.status(500).json({ error: 'feedback_admin_failed' });
  }
});

// Same data as /feedback/admin, but reachable from the ADMIN_KEY-gated /admin panel (no login
// needed — same dual-gate pattern placement.js uses for /admin/placements).
function adminKeyOk(req) {
  const key = process.env.ADMIN_KEY || '';
  if (!key) return false;
  const got = String(req.query.key || req.headers['x-admin-key'] || (req.body && req.body.key) || '');
  if (got.length !== key.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(key)); } catch { return false; }
}
feedbackRouter.get('/admin/feedback', async (req, res) => {
  if (!adminKeyOk(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const all = await loadFeedback();
    const recent = all.slice(-100).reverse();
    await enrichNames(recent);   // resolve names for existing entries so the owner sees WHO said what
    // The ADMIN view is owner-only, so it keeps BOTH name and email (unlike the public route).
    const entries = recent.map((e) => ({
      timestamp: e.timestamp, screen: e.screen, rating: e.rating ?? null,
      answers: e.answers ?? null, text: e.text ?? '', email: e.email ?? null, name: e.name ?? null,
      sessionCount: e.sessionCount, level: e.level,
    }));
    res.json({ entries, total: all.length });
  } catch (err) {
    console.error('[feedback] admin-key error:', err.message);
    res.status(500).json({ error: 'feedback_admin_failed' });
  }
});
