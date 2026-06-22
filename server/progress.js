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
import { dayKey } from './time.js';
import { requireAuth, publicAccount }          from './auth.js';

export const progressRouter = express.Router();

function buildDashboard(p) {
  const sessions = p.sessions || [];
  const recent   = sessions.slice(-20);
  const lp        = levelProgress(p.xp);
  const boss      = bossForLevel(p.level);
  const upcoming  = nextBoss(p.level);

  return {
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
