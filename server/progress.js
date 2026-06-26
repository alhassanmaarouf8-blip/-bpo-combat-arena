/**
 * progress.js
 * HTTP API for the progress dashboard and the spaced-repetition review drill.
 *   GET  /api/progress/:userId         → dashboard (trends, level, due count, next boss)
 *   GET  /api/review/:userId           → due production-recall items
 *   POST /api/review/:userId/grade     → grade one produced answer, advance the schedule
 */
import express from 'express';
import { loadUser, saveUser }                 from './store.js';
import { dueItems, dueCount, grade, checkAnswer } from './srs.js';
import { levelProgress, bossForLevel, nextBoss, computeStreak, computeRank } from './progression.js';
import { dailyStatus } from './daily.js';
import { isSpeakableRule } from './grammarCheck.js';
import { dayKey } from './time.js';
import { requireAuth, publicAccount, listAllAccounts } from './auth.js';

export const progressRouter = express.Router();

function buildDashboard(p) {
  const sessions = p.sessions || [];
  const recent   = sessions.slice(-20);
  const lp        = levelProgress(p.xp);
  const boss      = bossForLevel(p.level);
  const upcoming  = nextBoss(p.level);

  // ETA to the next level: remaining XP ÷ the student's REAL recent average XP-per-session.
  // Honest estimate — null until ≥2 sessions actually recorded xpGained (no fabricated pace).
  const remainingXp = Math.max(0, lp.perLevel - lp.intoLevel);
  const withXp = recent.filter((s) => typeof s.xpGained === 'number' && s.xpGained > 0);
  let etaSessions = null;
  if (withXp.length >= 2) {
    const avgXp = withXp.reduce((x, s) => x + s.xpGained, 0) / withXp.length;
    if (avgXp > 0) etaSessions = Math.max(1, Math.ceil(remainingXp / avgXp));
  }

  // THE SPINE — the student's #1 named weakness right now, from their REAL data (most-lapsed,
  // still-unmastered grammar rule). Lets every surface say "this is what to fix" instead of leaving
  // them guessing. `lapses` is the real re-lapse count (only meaningful when > 0 — honest).
  const srsItems = Array.isArray(p.srs) ? p.srs : [];
  const weakG = srsItems
    .filter((i) => i.type === 'grammar' && !i.mastered && i.content && isSpeakableRule(i.content))
    .sort((a, b) => (b.lapses || 0) - (a.lapses || 0) || (b.reps || 0) - (a.reps || 0));
  const topWeakness = weakG.length ? { rule: weakG[0].content, lapses: weakG[0].lapses || 0 } : null;

  return {
    remainingXp,
    etaSessions,
    topWeakness,
    recentErrors:  (p.recentErrors || []).slice(0, 3),
    userId:        p.userId,
    level:         p.level,
    xp:            p.xp,
    // UNIFIED practice streak: a fight, a Trainingslager lesson, OR a daily drill all count —
    // so real practice never shows a dead grey flame (loss-aversion is the strongest retention lever).
    streak:        computeStreak(sessions, [...(p.lessonDays || []), ...(p.dailyDays || [])]),
    trainedToday:  [...(p.lessonDays || []), ...(p.dailyDays || [])].includes(dayKey())
                     || sessions.some((s) => dayKey(s.date) === dayKey()),
    daily:         dailyStatus(p),   // { streak, completedToday, best } — the daily-training loop
    rank:          computeRank(sessions),  // interview-readiness rank ladder
    levelProgress: lp,
    currentBoss:   boss,
    nextBoss:      upcoming,
    totals: {
      sessions:      sessions.length,
      vocabLearned:  (p.vocabLearned || []).length,
      rulesMastered: (p.masteredRules || []).length,
      dueReviews:    dueCount(p),
      srsActive:     (p.srs || []).filter((i) => !i.mastered).length,
    },
    trends: {
      fluency: recent.map((s) => s.fluency ?? 0),
      wpm:     recent.map((s) => s.wpm ?? 0),
      fillers: recent.map((s) => s.fillers ?? 0),
      vocab:   recent.map((s) => s.vocabTotal ?? 0),
      dates:   recent.map((s) => s.date),
    },
    masteredRules: p.masteredRules || [],
    vocabLearned:  p.vocabLearned || [],
  };
}

progressRouter.get('/progress', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    res.json({ ...buildDashboard(p), account: publicAccount(req.account) });
  } catch (err) {
    console.error('[progress] dashboard error:', err.message);
    res.status(500).json({ error: 'dashboard_failed' });
  }
});

progressRouter.get('/review', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    const items = dueItems(p, Date.now()).map((i) => ({
      id:     i.id,
      type:   i.type,          // 'grammar' | 'vocab'
      prompt: i.prompt,        // what the user sees (English gloss or "fix this")
      hint:   i.example?.wrong ?? null,
      stage:  i.stage,
    }));
    res.json({ items });
  } catch (err) {
    console.error('[progress] review error:', err.message);
    res.status(500).json({ error: 'review_failed' });
  }
});

progressRouter.post('/review/grade', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    const { id, answer, responseMs } = req.body || {};
    const item = (p.srs || []).find((i) => i.id === id);
    if (!item) return res.status(404).json({ error: 'not_found' });

    const { correct, note, note_ar } = checkAnswer(answer, item.answer);
    grade(p, id, correct, Date.now());

    // Mastered grammar rules graduate to the dashboard list.
    if (correct && item.mastered && item.type === 'grammar' && !p.masteredRules.includes(item.content)) {
      p.masteredRules.push(item.content);
    }
    await saveUser(p);

    res.json({
      correct,
      note,                       // gentle capitalization nudge (German nouns), or ''
      note_ar,                    // same nudge in Arabic (for the toggle)
      expected: item.answer,
      mastered: !!item.mastered,
      // Automaticity nudge: a confident live-call answer comes fast.
      fast:     correct && Number.isFinite(responseMs) && responseMs < 4000,
    });
  } catch (err) {
    console.error('[progress] grade error:', err.message);
    res.status(500).json({ error: 'grade_failed' });
  }
});

// ── Weekly leaderboard ────────────────────────────────────────────────────────
// Ranks active students by weekly practice volume (live sessions + daily drill days).
// Emails are masked client-side — server sends a short alias derived from the email
// so the requesting user can identify themselves without exposing others' addresses.
// Cached for 5 minutes to avoid hammering the store on every open.
let _lbCache = null;
let _lbCacheAt = 0;
const LB_TTL = 5 * 60 * 1000;

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  const u = user.slice(0, 3) + '***';
  const d = domain ? domain.split('.')[0].slice(0, 2) + '***' : '***';
  return `${u}@${d}`;
}

progressRouter.get('/leaderboard', requireAuth, async (req, res) => {
  try {
    if (_lbCache && Date.now() - _lbCacheAt < LB_TTL) {
      return res.json({ ..._lbCache, myId: req.account.id });
    }
    const accounts = await listAllAccounts();
    const now    = Date.now();
    const week   = now - 7 * 24 * 60 * 60 * 1000;

    const rows = (await Promise.all(
      accounts.map(async (acct) => {
        try {
          const p = await loadUser(acct.id);
          const liveSessions   = (p.sessions   || []).filter(s => new Date(s.date).getTime() > week).length;
          const dailyDaysWeek  = (p.dailyDays  || []).filter(d => new Date(d + 'T12:00:00').getTime() > week).length;
          const score = liveSessions * 3 + dailyDaysWeek;
          if (score === 0) return null;
          return { id: acct.id, masked: maskEmail(acct.email), liveSessions, dailyDaysWeek, score, streak: p.dailyStreak || 0 };
        } catch { return null; }
      })
    )).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 15);

    // Add rank
    const entries = rows.map((r, i) => ({ rank: i + 1, ...r }));
    _lbCache = { entries };
    _lbCacheAt = Date.now();
    res.json({ entries, myId: req.account.id });
  } catch (err) {
    console.error('[leaderboard] error:', err.message);
    res.status(500).json({ error: 'leaderboard_failed' });
  }
});
