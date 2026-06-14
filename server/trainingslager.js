/**
 * trainingslager.js — ADAPTIVE, never-repeating Trainingslager engine (rule-based, ZERO AI cost).
 *
 * Content lives in trainingslagerContent.js (tiered banks, founder-editable). This engine only
 * DECIDES which stations to serve next, based on the student's interview performance:
 *   - studentTier(): derived from real fight scores (computeRank over stored sessions) — higher
 *     interview scores raise the tier and unlock HARDER tiers + NEW sections; struggling stays low.
 *   - buildAdaptivePath(): the undone stations at/below the student's tier, DEEPEN-first (continue
 *     started sections to a higher tier) then BROADEN (new sections at this level). Completed
 *     stations (profile.lagerDone) are NEVER served again.
 *   - allRecommendedDone(): Boss-Tor opens when the current path is cleared; beating it / scoring
 *     higher raises the tier → the next pass reveals new content. The Lager+interview form a LOOP.
 *
 * Routes + response shapes are UNCHANGED from the previous version, so the client and the fight
 * engine (websocketManager) need no changes. ZERO new paid service.
 *
 *   GET  /api/trainingslager                         → { lessons:[{ruleId,title_de,title_ar,reason_de,reason_ar,tier,band,done}], source, allDone, suggestReassessment, lessonsUnlocked, tier }
 *   GET  /api/trainingslager/lesson/:ruleId          → { lesson, done }
 *   POST /api/trainingslager/lesson/:ruleId/complete → { passed, score, total, done, newlyCompleted, xpAwarded }
 */
import express from 'express';
import { loadUser, saveUser } from './store.js';
import { requireAuth, isAdminEmail, planOf } from './auth.js';
import { getLesson }                 from './lessons.config.js';
import { LAGER_SECTIONS, getStation, maxReadyTier, unauthoredStations } from './trainingslagerContent.js';
import { LESSON_XP, levelFor, computeRank } from './progression.js';
import { dayKey }                    from './time.js';
import { dbEnabled, kvGet, kvSet }   from './db.js';

export const trainingslagerRouter = express.Router();

const MAX_STATIONS = 5;   // how many stations to surface per pass

// ── Lesson gate (unchanged): map visible to all; OPENING requires an active paid plan ─────────
export function lessonsUnlocked(account) { return planOf(account) !== 'free'; }
function lessonBlocked(account) { return !lessonsUnlocked(account); }

// Resolve a station id (new tiered) OR a legacy grammar ruleId → a lesson-shaped object.
// Un-ready (placeholder) stations resolve to null → can NEVER be opened/served to a student.
function resolveLesson(id) {
  const st = getStation(id);
  if (st) return st.ready ? st : null;
  return getLesson(id) || null;
}
function isDone(profile, id) {
  return (Array.isArray(profile?.lagerDone) && profile.lagerDone.includes(id)) ||
         (Array.isArray(profile?.lessonsCompleted) && profile.lessonsCompleted.includes(id));
}

// ── The student's current tier, from REAL interview performance ───────────────────────────────
// Higher interview score → higher tier (harder content unlocks). New users with no fights fall
// back to their assessment level. Capped at the highest authored tier.
function studentTier(profile) {
  const sessions = Array.isArray(profile?.sessions) ? profile.sessions : [];
  let tier;
  if (sessions.length) {
    const score = computeRank(sessions)?.score ?? 0;   // 0–100 interview readiness
    tier = score >= 75 ? 3 : score >= 55 ? 2 : 1;
  } else {
    const lvl = profile?.assessmentResult?.estimatedLevel;
    tier = lvl === 'C1' ? 3 : lvl === 'B2' ? 2 : 1;
  }
  return Math.min(tier, maxReadyTier());   // never beyond the highest tier with REAL content
}

// ── Adaptive path: undone stations at/below the student's tier, DEEPEN-first then BROADEN ──────
function buildAdaptivePath(profile) {
  const tier = studentTier(profile);
  const deepen = [], fresh = [];
  for (const s of LAGER_SECTIONS) {
    if ((s.minTier || 1) > tier) continue;                       // section not unlocked at this level yet
    const started = s.tiers.some((t) => isDone(profile, `${s.id}:${t.tier}`));   // begun this section before?
    for (const t of s.tiers) {
      if (t.ready !== true) continue;                             // ONLY real authored content — never placeholders
      if (t.tier > tier) continue;                                // tier above the student's level → locked for now
      const id = `${s.id}:${t.tier}`;
      if (isDone(profile, id)) continue;                          // NEVER REPEAT a completed station
      const node = { ruleId: id, section: s, t, started };
      (started ? deepen : fresh).push(node);
    }
  }
  deepen.sort((a, b) => a.t.tier - b.t.tier);                                          // continue started sections, lowest undone tier first
  fresh.sort((a, b) => (a.section.minTier || 1) - (b.section.minTier || 1) || a.t.tier - b.t.tier);
  return { stations: [...deepen, ...fresh].slice(0, MAX_STATIONS), tier };
}

function reasonFor(node) {
  const band = node.t.band || '';
  return node.started
    ? { de: `Vertiefung — nächste Stufe (${band}).`, ar: `تعميق — المستوى الأعلى (${band}).` }
    : { de: `Neue Station für dein Niveau (${band}).`, ar: `محطة جديدة على مستواك (${band}).` };
}

// Same name + return shape as before, now adaptive. (Used by GET + refreshRecommendations.)
export function computeRecommendations(profile) {
  const { stations, tier } = buildAdaptivePath(profile);
  const recommendations = stations.map((n) => {
    const r = reasonFor(n);
    return { ruleId: n.ruleId, count: 0, tier: n.t.tier, band: n.t.band, reason_de: r.de, reason_ar: r.ar };
  });
  return { recommendations, source: 'adaptive', tier };
}

// Recompute + store on the user record. Called after every fight (the LOOP) and lazily on read.
export function refreshRecommendations(profile) {
  const { recommendations, source } = computeRecommendations(profile);
  profile.recommendations       = recommendations;
  profile.recommendationsSource = source;
  return recommendations;
}

// Boss-Tor opens when the current path is cleared (all stations at/below the student's tier done).
// A brand-new user has undone stations → false (locked) until they finish them.
export function allRecommendedDone(profile) {
  const { stations } = buildAdaptivePath(profile);
  return stations.length === 0 && LAGER_SECTIONS.length > 0;
}

// True when there is genuinely no further authored content the student could ever reach (vs.
// "more exists but is gated behind a higher tier — beat Boss-Tor to push further").
function outOfAuthoredContent(profile) {
  const tier = studentTier(profile);
  // Any REAL (ready) station above the current tier (deeper tiers OR higher-minTier sections)?
  for (const s of LAGER_SECTIONS) {
    for (const t of s.tiers) {
      if (t.ready !== true) continue;                              // placeholders don't count as content
      if (t.tier > tier || (s.minTier || 1) > tier) {
        if (!isDone(profile, `${s.id}:${t.tier}`)) return false;   // reachable-later REAL content exists
      }
    }
  }
  return true;
}

// ── Global PII-free counters (admin analytics) ───────────────────────────────────────────────
async function loadStats() { if (!dbEnabled()) return {}; try { return (await kvGet('tl_stats', 'counts')) ?? {}; } catch { return {}; } }
async function bumpStat(id, field) {
  if (!dbEnabled()) return;
  try { const s = await loadStats(); s[id] = s[id] || { recommended: 0, completed: 0 }; s[id][field] = (s[id][field] || 0) + 1; await kvSet('tl_stats', 'counts', s); }
  catch (e) { console.error('[trainingslager] stat bump failed:', e.message); }
}

// ── GET the game-map: the adaptive path + done state ──────────────────────────────────────────
trainingslagerRouter.get('/trainingslager', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    const { recommendations: recs, source, tier } = computeRecommendations(p);
    p.recommendations = recs; p.recommendationsSource = source;

    const lessons = recs.map((r) => {
      const l = getStation(r.ruleId);
      return {
        ruleId:    r.ruleId,
        title_de:  l?.title_de || r.ruleId,
        title_ar:  l?.title_ar || r.ruleId,
        reason_de: r.reason_de,
        reason_ar: r.reason_ar,
        tier:      r.tier,
        band:      r.band,
        count:     0,
        done:      false,        // the path only ever contains UNDONE stations (never-repeat)
      };
    });

    // Global recommend-stat: count each (user, station) the first time it's surfaced.
    p.recommendedCounted = Array.isArray(p.recommendedCounted) ? p.recommendedCounted : [];
    let dirty = false;
    for (const r of recs) {
      if (!p.recommendedCounted.includes(r.ruleId)) { p.recommendedCounted.push(r.ruleId); bumpStat(r.ruleId, 'recommended'); dirty = true; }
    }

    const allDone = allRecommendedDone(p);
    const outOfContent = allDone && outOfAuthoredContent(p);
    // One-time "what's next" suggestion once the current path is cleared.
    const suggestReassessment = allDone && !p.neuEinstufungPrompted;
    if (suggestReassessment) { p.neuEinstufungPrompted = true; dirty = true; }
    if (allDone) console.log(`[trainingslager] path cleared  user=${p.userId}  tier=${tier}  outOfAuthoredContent=${outOfContent}  STILL-PLACEHOLDER(author these)=[${unauthoredStations().join(', ')}]`);
    if (dirty) await saveUser(p);

    res.json({ lessons, source, tier, allDone, outOfContent, suggestReassessment, lessonsUnlocked: lessonsUnlocked(req.account) });
  } catch (err) {
    console.error('[trainingslager] read error:', err.message);
    res.status(500).json({ error: 'trainingslager_failed' });
  }
});

// ── GET one station (video + quiz) ────────────────────────────────────────────────────────────
trainingslagerRouter.get('/trainingslager/lesson/:ruleId', requireAuth, async (req, res) => {
  try {
    if (lessonBlocked(req.account)) return res.status(402).json({ error: 'plan_required' });
    const lesson = resolveLesson(req.params.ruleId);
    if (!lesson) return res.status(404).json({ error: 'lesson_not_found' });
    const p = await loadUser(req.account.id);
    res.json({ lesson, done: isDone(p, lesson.ruleId) });
  } catch (err) {
    console.error('[trainingslager] lesson read error:', err.message);
    res.status(500).json({ error: 'lesson_failed' });
  }
});

// ── POST quiz answers → grade → mark station DONE (never-repeat). Pass = 2/3. Idempotent. ──────
trainingslagerRouter.post('/trainingslager/lesson/:ruleId/complete', requireAuth, async (req, res) => {
  try {
    if (lessonBlocked(req.account)) return res.status(402).json({ error: 'plan_required' });
    const lesson = resolveLesson(req.params.ruleId);
    if (!lesson) return res.status(404).json({ error: 'lesson_not_found' });

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    let score = 0;
    lesson.quiz.forEach((q, i) => { if (Number(answers[i]) === q.correctIndex) score++; });
    const passed = score >= 2;

    const p = await loadUser(req.account.id);
    p.lagerDone = Array.isArray(p.lagerDone) ? p.lagerDone : [];
    const isStation = !!getStation(lesson.ruleId);
    let newlyCompleted = false, xpAwarded = 0;

    if (passed && !isDone(p, lesson.ruleId)) {
      if (isStation) p.lagerDone.push(lesson.ruleId);
      else { p.lessonsCompleted = Array.isArray(p.lessonsCompleted) ? p.lessonsCompleted : []; p.lessonsCompleted.push(lesson.ruleId); }
      newlyCompleted = true;

      p.xp = (p.xp || 0) + LESSON_XP; xpAwarded = LESSON_XP; p.level = levelFor(p.xp);
      const today = dayKey();
      p.lessonDays = Array.isArray(p.lessonDays) ? p.lessonDays : [];
      if (!p.lessonDays.includes(today)) p.lessonDays.push(today);
      p.lastCompletedLesson = lesson.ruleId;   // (fight-focus lookup degrades gracefully for station ids)

      refreshRecommendations(p);               // recompute the path immediately so the next one is fresh
      await saveUser(p);
      bumpStat(lesson.ruleId, 'completed');
    }

    console.log(`[trainingslager] station=${lesson.ruleId} user=${p.userId} score=${score}/${lesson.quiz.length} passed=${passed} new=${newlyCompleted} xp+=${xpAwarded}`);
    res.json({ passed, score, total: lesson.quiz.length, done: passed || isDone(p, lesson.ruleId), newlyCompleted, xpAwarded });
  } catch (err) {
    console.error('[trainingslager] complete error:', err.message);
    res.status(500).json({ error: 'complete_failed' });
  }
});

// ── Admin-only: global PII-free counts ────────────────────────────────────────────────────────
trainingslagerRouter.get('/trainingslager/admin/stats', requireAuth, async (req, res) => {
  if (!isAdminEmail(req.account.email)) return res.status(403).json({ error: 'forbidden' });
  const stats = await loadStats();
  const rows = Object.entries(stats).map(([id, c]) => {
    const l = getStation(id) || getLesson(id);
    return { ruleId: id, title_de: l?.title_de || id, recommended: c.recommended || 0, completed: c.completed || 0 };
  }).sort((a, b) => b.recommended - a.recommended);
  res.json({ stats: rows });
});
