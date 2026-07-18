/**
 * progress.js
 * HTTP API for the progress dashboard and the spaced-repetition review drill.
 *   GET  /api/progress/:userId         → dashboard (trends, level, due count, next boss)
 *   GET  /api/review/:userId           → due production-recall items
 *   POST /api/review/:userId/grade     → grade one produced answer, advance the schedule
 */
import express from 'express';
import { loadUser, saveUser }                 from './store.js';
import { dueCount } from './srs.js';
import { levelProgress, bossForLevel, nextBoss, computeStreak, computeRank } from './progression.js';
import { dailyStatus } from './daily.js';
import { isSpeakableRule } from './grammarCheck.js';
import { dayKey } from './time.js';
import { requireAuth, publicAccount, listAllAccounts } from './auth.js';
import { hireReadinessFor } from './hireReadiness.js';
import { recentTurns, summary as latencySummary, recordClient, recentClient, clientSummary } from './latencyLog.js';
import { buildSnapshot } from './brain/adapter.js';
import { classifyGrammar } from './errorTags.js';
import { INDUSTRIES } from './scenarios.js';
import { adminRequestOk } from './adminAuth.js';
import { canonicalCoachDirective, coachCueForDrill, recordDrillOutcome, salmaCoachEventId,
  salmaCoachFlags, syncSalmaCoach } from './salmaCoachCore.js';
import { redeemDrillEvidenceReceipt } from './drillEvidence.js';

export const progressRouter = express.Router();
const RECEIPT_PROTECTED_DRILLS = new Set([
  'satzbau-schmiede', 'sag-es-richtig', 'flow-drill', 'hoer-check', 'shadowing', 'druck-leiter', 'srs',
]);

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
  let topWeakness = weakG.length ? { rule: weakG[0].content, lapses: weakG[0].lapses || 0 } : null;
  // CONTINUITY: a student who JUST finished the assessment has no grammar-SRS history yet — without
  // this they'd see "weakness not detected, do an assessment" (the thing they just did). Surface the
  // real top blocker the assessment found so the home names exactly what to fix. lapses:0 → the
  // DailyMission copy reads "…heute fixen wir genau das" (no fake re-lapse count).
  if (!topWeakness) {
    const b = (p.assessmentResult?.blockers || []).find((x) => x?.rule && isSpeakableRule(x.rule));
    if (b) topWeakness = { rule: b.rule, lapses: 0, fromAssessment: true };
  }

  // SIMULATION DIAGNOSTIC. Its thresholds are internal training references, not an employer-outcome
  // model. The outcome-calibration field stays explicit until real consented hiring outcomes exist.
  const hireReadiness = hireReadinessFor(p);
  // Readiness is private learner data. Do not emit account ids, level, bottlenecks, or verdicts
  // into provider logs where they can be correlated by timestamp across requests.

  return {
    remainingXp,
    etaSessions,
    topWeakness,
    hireReadiness,
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
    // One-shot proof card from the last interview whose debrief the user never saw (they closed the
    // tab before it arrived). null once seen. Corrections are LanguageTool-verified only.
    lastDebrief:   p.lastDebrief && !p.lastDebrief.seen ? p.lastDebrief : null,
    targetIndustry: p.targetIndustry || null,   // Ziel-Stelle: current target account type (or null)
  };
}

// [LAT] DIAGNOSTIC: server-side voice-turn latency breakdown (user-stops → boss-text-ready).
// Run an interview, then GET /api/diag/latency to see avg flush/prep/llm ms + the biggest gap.
// No auth (numbers only, no PII) so it's a one-curl read.
progressRouter.get('/diag/latency', (req, res) => {
  if (!adminRequestOk(req)) return res.status(403).json({ error: 'forbidden' });
  res.json({ server: latencySummary(), client: clientSummary(), serverTurns: recentTurns(), clientTurns: recentClient() });
});
// Browser POSTs its real per-turn timing here (vadWaitMs / ttsMs / fullMs / build). No auth (numbers only).
progressRouter.post('/diag/clientlat', requireAuth, (req, res) => {
  const b = req.body || {};
  const safe = {
    vadWaitMs: Math.max(0, Math.min(120000, Number(b.vadWaitMs) || 0)),
    ttsMs: Math.max(0, Math.min(120000, Number(b.ttsMs) || 0)),
    fullMs: Math.max(0, Math.min(120000, Number(b.fullMs) || 0)),
    build: String(b.build || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 20),
  };
  try { recordClient(safe); } catch {}
  res.json({ ok: true });
});

// POST /api/drill-event — a drill reports its OUTCOME so the brain can see whether a prescribed fix
// actually worked (the two client drills, DRUCK-LEITER + Shadowing, fed back NOTHING before this →
// the brain would prescribe them blind). Appends to the per-weakness weakLog spine (keyed by the
// canonical ruleId when the drill targets one) or a global drillLog otherwise. Authed, additive, free.
progressRouter.post('/drill-event', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const body = req.body || {};
    const verifiedEvent = redeemDrillEvidenceReceipt(req.account.id, body.evidenceReceipt);
    const requestedDrill = String(body.drill || '').slice(0, 40);
    if (RECEIPT_PROTECTED_DRILLS.has(requestedDrill) && !verifiedEvent) {
      return res.status(422).json({ error: 'verified_drill_evidence_required' });
    }
    if (verifiedEvent && requestedDrill && requestedDrill !== verifiedEvent.drill) {
      return res.status(422).json({ error: 'drill_evidence_mismatch' });
    }
    const { drill, ruleId, rule, froze, correct, voicedMs, completedSet, eventId,
      prescriptionId, skillId, phase } = verifiedEvent || body;
    if (!drill) return res.status(400).json({ error: 'missing_drill' });
    const p = await loadUser(req.account.id);
    p.weakLog = p.weakLog || {};
    const ev = {
      at: Date.now(), drill: String(drill).slice(0, 40),
      ...(typeof froze === 'boolean'    ? { froze }   : {}),
      ...(typeof correct === 'boolean'  ? { correct } : {}),
      ...(completedSet === true         ? { completedSet: true } : {}),
      ...(Number.isFinite(+voicedMs)    ? { voicedMs: Math.round(+voicedMs) } : {}),
      ...(/^[a-f0-9]{16}$/u.test(eventId || '') ? { eventId } : {}),
      ...(/^[a-f0-9]{16}$/u.test(prescriptionId || '') ? { prescriptionId } : {}),
      ...((skillId === 'listen-clear' || skillId === 'listen-phone') ? { skillId } : {}),
      ...(phase === 'practice' ? { phase } : {}),
    };
    // Canonicalize an LT rule NAME to the interview's ruleId (same classifyGrammar the interview
    // uses at session-persist) so drill events land on the SAME weakLog entry the interview writes —
    // before this, a 'lt:'-keyed drill event and a canonical-keyed interview error never met, and
    // the aha loop couldn't see the drill.
    const canon = !ruleId && typeof rule === 'string' && rule
      ? (classifyGrammar([{ rule, count: 1 }])[0] ?? null) : null;
    const key = ruleId || canon || (typeof rule === 'string' && rule ? 'lt:' + rule : null);
    if (key) {
      const entry = p.weakLog[key] || { ruleId: ruleId || canon || null, ltName: rule || null, firstSeen: Date.now(), errCounts: [], drills: [] };
      entry.drills.push(ev);
      if (entry.drills.length > 50) entry.drills = entry.drills.slice(-50);
      p.weakLog[key] = entry;
    } else {
      p.drillLog = (p.drillLog || []).concat(ev).slice(-100);   // not tied to a rule (general pressure/shadowing)
    }
    let coachCue = null;
    if (salmaCoachFlags(process.env, req.account).enabled) {
      const { state: salmaState } = syncSalmaCoach(p);
      const eventId = salmaCoachEventId({ accountId: req.account.id, ...ev });
      p.salmaCoach = recordDrillOutcome(salmaState, ev, ev.at);
      coachCue = coachCueForDrill({ drill: ev.drill, correct: ev.correct, froze: ev.froze, eventId });
    }
    await saveUser(p);
    res.json({ ok: true, ...(coachCue ? { coachCue } : {}) });
  } catch (err) {
    console.error('[drill-event] error:', err.message);
    res.status(500).json({ error: 'drill_event_failed' });
  }
});

// GET /api/brain — the live brain's ONE next step for this student. Returns a copy-free directive
// (state, the single prescription, the journey progress, an honest aha when a loop closed) the client
// renders with the owner's masri. Deterministic, free, no LLM. This is the bridge engine→user.
progressRouter.get('/brain', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const p = await loadUser(req.account.id);
    const snapshot = buildSnapshot(p);
    const directive = canonicalCoachDirective(p, req.account);
    res.json({ directive, level: snapshot.level, hireReady: snapshot.hireReady, hireNote: snapshot.hireNote });
  } catch (err) {
    console.error('[brain] error:', err.message);
    res.status(500).json({ error: 'brain_failed' });
  }
});

progressRouter.get('/progress', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');   // never serve a stale readiness/weakness snapshot
  try {
    const p = await loadUser(req.account.id);
    res.json({ ...buildDashboard(p), account: publicAccount(req.account) });
  } catch (err) {
    console.error('[progress] dashboard error:', err.message);
    res.status(500).json({ error: 'dashboard_failed' });
  }
});

// Ziel-Stelle: store the target account type (INDUSTRIES key from scenarios.js, or null = Auto).
// Storing is open to every plan (aspiration is free); the interview only USES it when the plan's
// entitlement carries zielStelle — enforced at fight start in websocketManager, not here.
progressRouter.post('/progress/target-industry', requireAuth, async (req, res) => {
  try {
    const raw = req.body?.industry;
    const industry = raw === null || raw === '' || raw === undefined ? null : String(raw);
    // Object.hasOwn, not a truthy lookup: '__proto__'/'constructor'/'toString' inherit through
    // INDUSTRIES[key] and would validate — then leak Function source into the boss prompt.
    if (industry !== null && !Object.hasOwn(INDUSTRIES, industry)) return res.status(400).json({ error: 'unknown_industry' });
    const p = await loadUser(req.account.id);
    p.targetIndustry = industry;
    await saveUser(p);
    res.json({ ok: true, targetIndustry: industry });
  } catch (err) {
    console.error('[progress] target-industry error:', err.message);
    res.status(500).json({ error: 'target_industry_failed' });
  }
});

// The home shows the last unseen debrief snapshot exactly once; this flips it off. Idempotent.
progressRouter.post('/progress/debrief-seen', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    if (p.lastDebrief && !p.lastDebrief.seen) { p.lastDebrief.seen = true; await saveUser(p); }
    res.json({ ok: true });
  } catch (err) {
    console.error('[progress] debrief-seen error:', err.message);
    res.status(500).json({ error: 'debrief_seen_failed' });
  }
});

// (Removed the dead GET /review + POST /review/grade endpoints — their only consumer, the typed
//  RecallDrill pre-fight warm-up, was deleted. SRS review now lives entirely in the SPOKEN path:
//  /api/spoken-review (SAG ES RICHTIG) + the daily session. Nothing called these anymore.)

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
