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
import { requireAuth }        from './auth.js';
import { getLesson, STARTER_PATH } from './lessons.config.js';

export const trainingslagerRouter = express.Router();

const LAST_N_FIGHTS = 3;
const MAX_RECS      = 6;
const STARTER_REASON = { de: 'Empfohlener Startpunkt für den Einstieg.', ar: 'نقطة بداية موصى بها للبداية.' };

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

    res.json({ lessons, source });
  } catch (err) {
    console.error('[trainingslager] read error:', err.message);
    res.status(500).json({ error: 'trainingslager_failed' });
  }
});

// ── GET one lesson (video + quiz) ────────────────────────────────────────────────
trainingslagerRouter.get('/trainingslager/lesson/:ruleId', requireAuth, async (req, res) => {
  try {
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
    const lesson = getLesson(req.params.ruleId);
    if (!lesson) return res.status(404).json({ error: 'lesson_not_found' });

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    let score = 0;
    lesson.quiz.forEach((q, i) => { if (Number(answers[i]) === q.correctIndex) score++; });
    const passed = score >= 2;

    const p = await loadUser(req.account.id);
    p.lessonsCompleted = Array.isArray(p.lessonsCompleted) ? p.lessonsCompleted : [];
    let newlyCompleted = false;
    if (passed && !p.lessonsCompleted.includes(lesson.ruleId)) {
      p.lessonsCompleted.push(lesson.ruleId);
      newlyCompleted = true;
      // (Phase 5 will award XP + streak credit here, once, on newlyCompleted.)
      await saveUser(p);
    }

    console.log(`[trainingslager] lesson=${lesson.ruleId} user=${p.userId} score=${score}/${lesson.quiz.length} passed=${passed} newlyCompleted=${newlyCompleted}`);
    res.json({ passed, score, total: lesson.quiz.length, done: passed || p.lessonsCompleted.includes(lesson.ruleId), newlyCompleted });
  } catch (err) {
    console.error('[trainingslager] complete error:', err.message);
    res.status(500).json({ error: 'complete_failed' });
  }
});
