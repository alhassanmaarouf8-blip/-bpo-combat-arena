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

feedbackRouter.post('/feedback', requireAuth, async (req, res) => {
  try {
    const { rating, answers, text, screen } = req.body || {};
    const p = await loadUser(req.account.id);
    const sessions = p.sessions || [];

    const entry = {
      userId:       req.account.id,
      email:        req.account.email ?? null,
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
      answers: e.answers ?? null, text: e.text ?? '', email: e.email ?? null,
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
    const entries = all.slice(-100).reverse().map((e) => ({
      timestamp: e.timestamp, screen: e.screen, rating: e.rating ?? null,
      answers: e.answers ?? null, text: e.text ?? '', email: e.email ?? null,
      sessionCount: e.sessionCount, level: e.level,
    }));
    res.json({ entries, total: all.length });
  } catch (err) {
    console.error('[feedback] admin-key error:', err.message);
    res.status(500).json({ error: 'feedback_admin_failed' });
  }
});
