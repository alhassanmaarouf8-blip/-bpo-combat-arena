/**
 * engagement.js — REAL per-user engagement analytics, ADMIN_KEY-gated.
 *
 *   GET /admin/engagement                  → every user's engagement, sorted by active days
 *   GET /admin/engagement?plan=free        → only free-trial users
 *
 * Honesty is the whole point (owner mandate 2026-07-08): every number here is computed from
 * data the app ACTUALLY persists — never estimated. Specifically:
 *   • activeDays  = distinct Cairo day-keys the user did ANYTHING that leaves a trace
 *                   (interview sessions, daily drills, lessons, or live-voice minutes).
 *   • interviews  = number of full interview/fight sessions.
 *   • minutesTotal / perDay = live-voice minutes, from the DURABLE usageDays map. This map only
 *     started filling when the tracker shipped, so for anyone active BEFORE that it reads 0 with
 *     minutesTracked:false — i.e. "we don't know their past minutes", stated plainly, not faked.
 * The daily-drill/lesson/interview day-keys, by contrast, were already persisted historically, so
 * activeDays IS accurate back to signup.
 */
import express from 'express';
import { adminRequestOk } from './adminAuth.js';
import { dayKey } from './time.js';
import { loadUser } from './store.js';
import { listAllAccounts, planOf, trialActive, trialDaysLeft } from './auth.js';

export const engagementRouter = express.Router();

const adminKeyOk = adminRequestOk;

// Distinct Cairo day-keys across every trace a user leaves. Timestamps (session.date, ms) are
// converted to a day-key; dailyDays / lessonDays / usageDays are already day-keys.
function activeDayKeys(p) {
  const set = new Set();
  for (const s of (p.sessions || []))   if (s && s.date) set.add(dayKey(s.date));
  for (const d of (p.dailyDays || []))   if (d) set.add(String(d));
  for (const d of (p.lessonDays || []))  if (d) set.add(String(d));
  for (const d of Object.keys(p.usageDays || {})) set.add(String(d));
  return set;
}

engagementRouter.get('/admin/engagement', async (req, res) => {
  if (!adminKeyOk(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const onlyPlan = typeof req.query.plan === 'string' ? req.query.plan.toLowerCase() : '';
    const accounts = (await listAllAccounts() || [])
      .filter((a) => a && a.email && !/@example\.com$/i.test(a.email));   // hide QA/test accounts

    const users = [];
    for (const a of accounts) {
      const plan = (() => { try { return planOf(a); } catch { return 'free'; } })();
      if (onlyPlan && plan !== onlyPlan) continue;

      let p = {};
      try { p = await loadUser(a.id); } catch { p = {}; }

      const dayset       = activeDayKeys(p);
      const usageDays    = p.usageDays || {};
      const usageKeys    = Object.keys(usageDays);
      const totalSec     = usageKeys.reduce((s, k) => s + (Number(usageDays[k]) || 0), 0);
      const minutesTotal = Math.round(totalSec / 60);
      const daysWithMin  = usageKeys.filter((k) => (Number(usageDays[k]) || 0) > 0).length;
      const lastActive   = [...dayset].sort().slice(-1)[0] || null;

      users.push({
        email:          a.email,
        name:           p.name || null,
        plan,
        isTrial:        (() => { try { return trialActive(a); } catch { return false; } })(),
        trialDaysLeft:  (() => { try { return trialDaysLeft(a); } catch { return null; } })(),
        signup:         a.createdAt || null,
        activeDays:     dayset.size,                                   // distinct days they did anything (accurate to signup)
        interviews:     (p.sessions || []).length,                    // full interview sessions
        dailyDrillDays: (p.dailyDays || []).length,                   // days they did the daily drill
        dailyStreak:    p.dailyStreak || 0,
        lastActive,                                                   // most recent active day-key
        minutesTotal,                                                 // live-voice minutes (from usageDays)
        minutesPerActiveDay: daysWithMin ? Math.round(minutesTotal / daysWithMin) : 0,
        minutesTracked: usageKeys.length > 0,                         // false = we DON'T know their minutes yet (pre-tracker)
      });
    }

    users.sort((a, b) => b.activeDays - a.activeDays || b.interviews - a.interviews);

    const trialUsers = users.filter((u) => u.plan === 'free').length;
    res.json({
      generatedAt: new Date().toISOString(),
      note: 'activeDays/interviews/dailyDrillDays are accurate to signup. minutesTotal is live-voice ' +
            'minutes and only exists from when the usageDays tracker shipped — minutesTracked:false means unknown, not zero.',
      summary: { totalUsers: users.length, trialUsers },
      users,
    });
  } catch (err) {
    console.error('[engagement] error:', err.message);
    res.status(500).json({ error: 'engagement_failed' });
  }
});
