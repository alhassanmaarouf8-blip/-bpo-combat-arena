/**
 * trainingslager.js — the intelligent recommendation engine (rule-based, ZERO AI cost).
 *
 * After each fight, the fight's grammar errors are classified into lesson ruleIds (errorTags.js)
 * and stored on the session. Here we read the user's LAST 3 fights, count exact frequency per
 * ruleId, and rank the lessons most-failed first. Pure counting — no LLM, no Realtime, nothing
 * to hallucinate.
 *
 * Edge cases (bulletproof):
 *   - brand-new user / no errors yet  → hardcoded STARTER_PATH (never an empty list)
 *   - a failed rule has no lesson      → classifier never emits it, so it's skipped silently
 *
 *   GET /api/trainingslager → { lessons: [{ ruleId, title_de, title_ar, reason_de, reason_ar,
 *                                           count, done }], source }
 */
import express from 'express';
import { loadUser, saveUser } from './store.js';
import { requireAuth, isAdminEmail, entitlement } from './auth.js';
import { getLesson, STARTER_PATH } from './lessons.config.js';
import { LESSON_XP, levelFor }     from './progression.js';
import { dayKey }                  from './time.js';
import { dbEnabled, kvGet, kvSet } from './db.js';

export const trainingslagerRouter = express.Router();

const LAST_N_FIGHTS = 3;
const MAX_RECS      = 6;
const STARTER_REASON = { de: 'Empfohlener Startpunkt für den Einstieg.', ar: 'نقطة بداية موصى بها للبداية.' };

// ── Lesson gate ──────────────────────────────────────────────────────────────
// The game MAP (diagnosis + path) is visible to everyone — the hook. OPENING a lesson/quiz
// requires the Trainingslager to be unlocked, which only the Elite plan grants
// (PLANS.elite.trainingslagerUnlocked; admin counts as elite). Free/Basic see the map and get
// an honest upsell.
export function lessonsUnlocked(account) { return !!entitlement(account)?.trainingslagerUnlocked; }
function lessonBlocked(account) { return !lessonsUnlocked(account); }

// Boss-Tor is unlocked only when EVERY recommended lesson is done (server-side truth).
export function allRecommendedDone(profile) {
  const recs = Array.isArray(profile?.recommendations) ? profile.recommendations : [];
  if (recs.length === 0) return false;
  const done = new Set(Array.isArray(profile?.lessonsCompleted) ? profile.lessonsCompleted : []);
  return recs.every((r) => done.has(r.ruleId));
}

// ── Global, PII-free counters (admin analytics): per-ruleId recommended/completed ──
async function loadStats() { if (!dbEnabled()) return {}; try { return (await kvGet('tl_stats', 'counts')) ?? {}; } catch { return {}; } }
async function bumpStat(ruleId, field) {
  if (!dbEnabled()) return;
  try { const s = await loadStats(); s[ruleId] = s[ruleId] || { recommended: 0, completed: 0 }; s[ruleId][field] = (s[ruleId][field] || 0) + 1; await kvSet('tl_stats', 'counts', s); }
  catch (e) { console.error('[trainingslager] stat bump failed:', e.message); }
}

// Count error tags across the last N fights and rank lessons most-failed first.
export function computeRecommendations(profile) {
  const sessions = Array.isArray(profile?.sessions) ? profile.sessions : [];
  const recent   = sessions.slice(-LAST_N_FIGHTS);

  const counts = new Map(); // ruleId -> exact frequency
  for (const s of recent) {
    for (const tag of (Array.isArray(s?.errorTags) ? s.errorTags : [])) {
      if (getLesson(tag)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  // Most-failed first (stable: ties keep insertion order via the map).
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_RECS);

  let recs = ranked.map(([ruleId, count]) => {
    const l = getLesson(ruleId);
    return {
      ruleId, count,
      reason_de: `Empfohlen, weil: du hattest ${count} Fehler bei ${l.title_de}.`,
      reason_ar: `موصى به لأنك غلطت ${count} مرات في ${l.title_ar}.`,
    };
  });

  let source = 'errors';
  // Edge case: nothing failed (new user / clean fights) → hardcoded starter path. Never empty.
  if (recs.length === 0) {
    source = 'starter';
    recs = STARTER_PATH
      .map((ruleId) => getLesson(ruleId) && ({ ruleId, count: 0, reason_de: STARTER_REASON.de, reason_ar: STARTER_REASON.ar }))
      .filter(Boolean);
  }

  return { recommendations: recs, source };
}

// Recompute and store on the user record. Called after every fight (and lazily on read).
export function refreshRecommendations(profile) {
  const { recommendations, source } = computeRecommendations(profile);
  profile.recommendations       = recommendations;
  profile.recommendationsSource = source;
  return recommendations;
}

// ── GET the game-map data: ordered lessons + reasons + done state ────────────────
trainingslagerRouter.get('/trainingslager', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);

    // Lazily compute for users who existed before this feature (no stored recs yet).
    let recs = Array.isArray(p.recommendations) ? p.recommendations : [];
    let source = p.recommendationsSource || 'errors';
    if (recs.length === 0) {
      const fresh = computeRecommendations(p);
      recs = fresh.recommendations; source = fresh.source;
      p.recommendations = recs; p.recommendationsSource = source;
      await saveUser(p);
    }

    const done = new Set(Array.isArray(p.lessonsCompleted) ? p.lessonsCompleted : []);
    const lessons = recs.map((r) => {
      const l = getLesson(r.ruleId);
      return {
        ruleId:    r.ruleId,
        title_de:  l?.title_de || r.ruleId,
        title_ar:  l?.title_ar || r.ruleId,
        reason_de: r.reason_de,
        reason_ar: r.reason_ar,
        count:     r.count,
        done:      done.has(r.ruleId),
      };
    });

    // Global recommend-stat: count each (user, lesson) the first time it's recommended.
    p.recommendedCounted = Array.isArray(p.recommendedCounted) ? p.recommendedCounted : [];
    let dirty = false;
    for (const r of recs) {
      if (!p.recommendedCounted.includes(r.ruleId)) { p.recommendedCounted.push(r.ruleId); bumpStat(r.ruleId, 'recommended'); dirty = true; }
    }

    // One-time "monthly re-assessment" suggestion once the whole path is done.
    const allDone = allRecommendedDone(p);
    const suggestReassessment = allDone && !p.neuEinstufungPrompted;
    if (suggestReassessment) { p.neuEinstufungPrompted = true; dirty = true; }
    if (dirty) await saveUser(p);

    res.json({
      lessons, source, allDone, suggestReassessment,
      lessonsUnlocked: lessonsUnlocked(req.account),
    });
  } catch (err) {
    console.error('[trainingslager] read error:', err.message);
    res.status(500).json({ error: 'trainingslager_failed' });
  }
});

// ── GET one lesson (video + quiz) ────────────────────────────────────────────────
trainingslagerRouter.get('/trainingslager/lesson/:ruleId', requireAuth, async (req, res) => {
  try {
    if (lessonBlocked(req.account)) return res.status(402).json({ error: 'plan_required' });
    const lesson = getLesson(req.params.ruleId);
    if (!lesson) return res.status(404).json({ error: 'lesson_not_found' });
    const p = await loadUser(req.account.id);
    const done = (Array.isArray(p.lessonsCompleted) ? p.lessonsCompleted : []).includes(lesson.ruleId);
    res.json({ lesson, done });
  } catch (err) {
    console.error('[trainingslager] lesson read error:', err.message);
    res.status(500).json({ error: 'lesson_failed' });
  }
});

// ── POST quiz answers → server grades (source of truth) → marks lesson DONE on pass ──
// Pass = at least 2 of 3 correct. Idempotent: re-passing an already-done lesson is harmless.
trainingslagerRouter.post('/trainingslager/lesson/:ruleId/complete', requireAuth, async (req, res) => {
  try {
    if (lessonBlocked(req.account)) return res.status(402).json({ error: 'plan_required' });
    const lesson = getLesson(req.params.ruleId);
    if (!lesson) return res.status(404).json({ error: 'lesson_not_found' });

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    let score = 0;
    lesson.quiz.forEach((q, i) => { if (Number(answers[i]) === q.correctIndex) score++; });
    const passed = score >= 2;

    const p = await loadUser(req.account.id);
    p.lessonsCompleted = Array.isArray(p.lessonsCompleted) ? p.lessonsCompleted : [];
    let newlyCompleted = false, xpAwarded = 0;
    if (passed && !p.lessonsCompleted.includes(lesson.ruleId)) {
      p.lessonsCompleted.push(lesson.ruleId);
      newlyCompleted = true;

      // Award (once) ~50% of a fight's XP, recompute level.
      p.xp = (p.xp || 0) + LESSON_XP; xpAwarded = LESSON_XP; p.level = levelFor(p.xp);
      // Streak credit: today (Cairo) counts as an active day even without a fight.
      const today = dayKey();
      p.lessonDays = Array.isArray(p.lessonDays) ? p.lessonDays : [];
      if (!p.lessonDays.includes(today)) p.lessonDays.push(today);
      // Fight focus: the next fight weaves in situations that test this lesson.
      p.lastCompletedLesson = lesson.ruleId;

      await saveUser(p);
      bumpStat(lesson.ruleId, 'completed');
    }

    console.log(`[trainingslager] lesson=${lesson.ruleId} user=${p.userId} score=${score}/${lesson.quiz.length} passed=${passed} newlyCompleted=${newlyCompleted} xp+=${xpAwarded}`);
    res.json({ passed, score, total: lesson.quiz.length, done: passed || p.lessonsCompleted.includes(lesson.ruleId), newlyCompleted, xpAwarded });
  } catch (err) {
    console.error('[trainingslager] complete error:', err.message);
    res.status(500).json({ error: 'complete_failed' });
  }
});

// ── Admin-only: global PII-free counts (recommended/completed per lesson) ─────────
trainingslagerRouter.get('/trainingslager/admin/stats', requireAuth, async (req, res) => {
  if (!isAdminEmail(req.account.email)) return res.status(403).json({ error: 'forbidden' });
  const stats = await loadStats();
  const rows = Object.entries(stats).map(([ruleId, c]) => {
    const l = getLesson(ruleId);
    return { ruleId, title_de: l?.title_de || ruleId, recommended: c.recommended || 0, completed: c.completed || 0 };
  }).sort((a, b) => b.recommended - a.recommended);
  res.json({ stats: rows });
});
