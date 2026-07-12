/**
 * placement.js — the mission KPI: are students actually getting HIRED?
 *
 * The whole product exists for one outcome — Egyptians hired into German-speaking BPO roles.
 * Until now nothing recorded it (the in-fight "win/loss" is a game result, not a job). This
 * captures the real funnel on the user's durable profile and exposes a founder-only rollup.
 *
 *   GET  /api/placement          → { placement, shouldPrompt }   (requireAuth)
 *   POST /api/placement          → update status/employer/role/note (requireAuth)
 *   POST /api/placement/snooze   → mark the weekly nudge as shown  (requireAuth)
 *   GET  /admin/placements       → aggregate funnel + hires        (admin session/header)
 */
import express from 'express';
import { adminRequestOk } from './adminAuth.js';
import { loadUser, saveUser } from './store.js';
import { requireAuth, listAllAccounts } from './auth.js';

export const placementRouter = express.Router();

// Hiring funnel stages. 'hired' and 'not_hired' are terminal (stop nudging).
const STATUSES = ['none', 'applying', 'interviewing', 'offer', 'hired', 'not_hired'];
const TERMINAL = new Set(['hired', 'not_hired']);
const WEEK_MS  = 7 * 24 * 60 * 60 * 1000;
const DAY_MS   = 24 * 60 * 60 * 1000;

function defaultPlacement() {
  return { status: 'none', employer: '', role: '', updatedAt: null, history: [], lastPromptedAt: null };
}

// Ask returning students for a job-search update — but never nag: not in the first 3 days
// (too early to have applied), not if already hired/rejected, and at most once a week.
function shouldPrompt(p) {
  const pl = p.placement || defaultPlacement();
  if (TERMINAL.has(pl.status)) return false;
  const accountAge = Date.now() - (p.createdAt || Date.now());
  if (accountAge < 3 * DAY_MS) return false;
  if (pl.lastPromptedAt && Date.now() - pl.lastPromptedAt < WEEK_MS) return false;
  return true;
}

placementRouter.get('/api/placement', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    res.json({ placement: p.placement || defaultPlacement(), shouldPrompt: shouldPrompt(p) });
  } catch (err) {
    console.error('[placement] get error:', err.message);
    res.status(500).json({ error: 'placement_failed' });
  }
});

placementRouter.post('/api/placement', requireAuth, async (req, res) => {
  try {
    const { status, employer, role, note } = req.body || {};
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'bad_status' });

    const p = await loadUser(req.account.id);
    const pl = p.placement || defaultPlacement();
    pl.status    = status;
    pl.employer  = String(employer || pl.employer || '').slice(0, 120);
    pl.role      = String(role     || pl.role     || '').slice(0, 120);
    pl.updatedAt = Date.now();
    pl.lastPromptedAt = Date.now();   // an update counts as a prompt → resets the weekly nudge
    pl.history = [
      ...(pl.history || []),
      { at: Date.now(), status, employer: pl.employer, role: pl.role, note: String(note || '').slice(0, 280) },
    ].slice(-50);   // keep the audit trail bounded
    p.placement = pl;
    await saveUser(p);

    if (status === 'hired') {
      console.log(`[placement] 🎯 HIRE reported  user=${req.account.id}  employer=${pl.employer || '?'}  role=${pl.role || '?'}`);
    }
    res.json({ ok: true, placement: pl });
  } catch (err) {
    console.error('[placement] post error:', err.message);
    res.status(500).json({ error: 'placement_failed' });
  }
});

placementRouter.post('/api/placement/snooze', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    p.placement = p.placement || defaultPlacement();
    p.placement.lastPromptedAt = Date.now();
    await saveUser(p);
    res.json({ ok: true });
  } catch (err) {
    console.error('[placement] snooze error:', err.message);
    res.status(500).json({ error: 'placement_failed' });
  }
});

// ── Founder KPI rollup ─────────────────────────────────────────────────────────
// Same ADMIN_KEY guard as admin.js (constant-time). Returns the full hiring funnel
// across every account plus the hire list — the single most important number in the app.
const adminKeyOk = adminRequestOk;

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  const u = (user || '').slice(0, 3) + '***';
  const d = domain ? domain.split('.')[0].slice(0, 2) + '***' : '***';
  return `${u}@${d}`;
}

placementRouter.get('/admin/placements', async (req, res) => {
  if (!adminKeyOk(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const accounts = await listAllAccounts();
    const funnel = { none: 0, applying: 0, interviewing: 0, offer: 0, hired: 0, not_hired: 0 };
    const hires = [];

    await Promise.all(accounts.map(async (acct) => {
      try {
        const p  = await loadUser(acct.id);
        const pl = p.placement || defaultPlacement();
        funnel[pl.status] = (funnel[pl.status] || 0) + 1;
        if (pl.status === 'hired') {
          hires.push({ masked: maskEmail(acct.email), employer: pl.employer || '?', role: pl.role || '?', at: pl.updatedAt });
        }
      } catch { /* skip unreadable profile */ }
    }));

    hires.sort((a, b) => (b.at || 0) - (a.at || 0));
    const active = funnel.applying + funnel.interviewing + funnel.offer;
    res.json({
      totalAccounts: accounts.length,
      funnel,
      activeJobSeekers: active,
      hired: funnel.hired,
      hires,
    });
  } catch (err) {
    console.error('[placement] admin rollup error:', err.message);
    res.status(500).json({ error: 'rollup_failed' });
  }
});
