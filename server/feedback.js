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
import { loadUser } from './store.js';
import { requireAuth, isAdminEmail } from './auth.js';
import { dbEnabled, kvGet, kvSet } from './db.js';

export const feedbackRouter = express.Router();
const FEEDBACK_FILE   = path.join(path.dirname(fileURLToPath(import.meta.url)), 'feedback.json');
const PLACEMENTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'placements.json');

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

// ── PLACEMENT LOOP — the only metric that matters: did the user actually get hired? ──
// Without this the app cannot prove or improve its real-world impact (every "improvement"
// number stays a projection). One-tap capture; stored alongside the user's session count and
// level so we can later correlate training volume with real outcomes.
//   POST /api/placement  { hired:boolean, company?, role?, monthlySalaryEgp?, note? }
async function loadPlacements() {
  if (dbEnabled()) return (await kvGet('placements', 'all')) ?? [];
  try { return JSON.parse(await readFile(PLACEMENTS_FILE, 'utf8')); } catch { return []; }
}
async function savePlacements(all) {
  if (dbEnabled()) { await kvSet('placements', 'all', all); return; }
  await writeFile(PLACEMENTS_FILE, JSON.stringify(all, null, 2), 'utf8');
}

feedbackRouter.post('/placement', requireAuth, async (req, res) => {
  try {
    const { hired, company, role, monthlySalaryEgp, note } = req.body || {};
    const p = await loadUser(req.account.id);
    const sessions = p.sessions || [];

    const entry = {
      userId:       req.account.id,
      email:        req.account.email ?? null,
      timestamp:    new Date().toISOString(),
      hired:        hired === true,                                     // explicit yes/no
      company:      typeof company === 'string' ? company.slice(0, 120) : '',
      role:         typeof role === 'string' ? role.slice(0, 120) : '',
      monthlySalaryEgp: Number.isFinite(+monthlySalaryEgp) ? Math.round(+monthlySalaryEgp) : null,
      note:         typeof note === 'string' ? note.slice(0, 1000) : '',
      sessionCount: sessions.length,                                    // training volume at hire time
      level:        sessions.slice(-1)[0]?.level ?? 'a2-b1',
    };

    // Mirror onto the user record too, so progress/eligibility logic can read it directly.
    p.placement = { hired: entry.hired, company: entry.company, role: entry.role, at: entry.timestamp };
    try { await (await import('./store.js')).saveUser(p); } catch { /* non-fatal */ }

    const all = await loadPlacements();
    all.push(entry);
    await savePlacements(all);

    console.log(`[placement] ${entry.hired ? '✅ HIRED' : '❌ not yet'} · user=${entry.userId} · ` +
      `company="${entry.company}" · role="${entry.role}" · sessions=${entry.sessionCount} · level=${entry.level}`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[placement] error:', err.message);
    res.status(500).json({ error: 'placement_failed' });
  }
});

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

    // Placement outcomes — the real-impact numbers.
    const placements = Array.isArray(await loadPlacements()) ? await loadPlacements() : [];
    const hiredList = placements.filter((p) => p.hired);
    const placementSummary = {
      reported:    placements.length,
      hired:       hiredList.length,
      byCompany:   hiredList.reduce((m, p) => { const c = p.company || '—'; m[c] = (m[c] || 0) + 1; return m; }, {}),
      avgSessionsAtHire: hiredList.length
        ? Math.round(hiredList.reduce((a, p) => a + (p.sessionCount || 0), 0) / hiredList.length)
        : null,
    };

    const summary = { total: all.length, avgRating, ratingCount: ratings.length, priceCounts, feltRealYes, feltRealNo, placements: placementSummary };
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
