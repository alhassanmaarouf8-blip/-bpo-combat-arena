/**
 * progression.js
 * Light leveling: XP per session, a level curve, and a boss ladder
 * (warm-up → standard → final boss) that unlocks with level.
 */
import { dayKey, dayKeyNoonMs } from './time.js';

export const XP_PER_LEVEL = 120;
const DAY = 24 * 60 * 60 * 1000;

// Ordered easiest → hardest. bossId must exist in realtimeClient BOSS_CONFIGS.
// 5-character ladder — ids MUST match interviewer-characters.json / BOSS_CONFIGS.
export const BOSS_LADDER = [
  { id: 'yasmin',         name: 'YASMIN',         tier: 'Junior-Recruiterin', minLevel: 1 },
  { id: 'karim',          name: 'KARIM',          tier: 'Teamleiter',         minLevel: 2 },
  { id: 'hana',           name: 'HANA',           tier: 'Hiring Managerin',   minLevel: 4 },
  { id: 'tarek',          name: 'TAREK',          tier: 'Eskalations-Boss',   minLevel: 6 },
  { id: 'frau-mona-adel', name: 'FRAU MONA ADEL', tier: 'Geschäftsführerin',  minLevel: 8 },
];

export function levelFor(xp) {
  return 1 + Math.floor((xp || 0) / XP_PER_LEVEL);
}

export function bossForLevel(level) {
  let boss = BOSS_LADDER[0];
  for (const b of BOSS_LADDER) if (level >= b.minLevel) boss = b;
  return boss;
}

export function nextBoss(level) {
  return BOSS_LADDER.find((b) => b.minLevel > level) ?? null;
}

/** XP earned for a finished session, weighted toward real fluency + vocab range. */
export function xpForSession(metrics = {}) {
  const fluency = metrics.fluency ?? metrics.avgScore ?? 0;
  return 15
    + Math.round(fluency / 5)                       // up to ~20 for a strong session
    + Math.min(15, (metrics.c1Hits || 0) * 3)       // vocab range
    + Math.min(10, (metrics.konjunktivHits || 0) * 2); // politeness register
}

export function levelProgress(xp) {
  const level   = levelFor(xp);
  const intoLvl = (xp || 0) - (level - 1) * XP_PER_LEVEL;
  return { level, intoLevel: intoLvl, perLevel: XP_PER_LEVEL, pct: Math.round((intoLvl / XP_PER_LEVEL) * 100) };
}

// ── Interview-readiness rank ladder ───────────────────────────────────────────
// Computed from STORED session scores (backend = source of truth). Fluency is the
// spine; clean speech (few fillers) and real structure (connectors) nudge it; top
// tiers require some experience so one lucky session can't fake "Interview-Bereit".
export const RANKS = ['Rekrut', 'Anwärter', 'Geübt', 'Profi', 'Interview-Bereit'];
// Each tier needs BOTH a minimum readiness score AND a minimum number of sessions
// (so a couple of lucky sessions can't fake the top ranks).
const TIER_REQ = [
  { minScore: 0,  minSessions: 0 },
  { minScore: 42, minSessions: 0 },
  { minScore: 58, minSessions: 0 },
  { minScore: 72, minSessions: 4 },
  { minScore: 85, minSessions: 6 },
];

export function computeRank(sessions) {
  const list   = Array.isArray(sessions) ? sessions : [];
  const recent = list.slice(-5);
  const n      = list.length;

  let score = 0;
  if (recent.length) {
    const mean = (a) => a.reduce((s, x) => s + (x || 0), 0) / a.length;
    const avgFluency = mean(recent.map((s) => s.fluency ?? 0));
    const avgFillers = mean(recent.map((s) => s.fillers ?? 0));
    const avgConn    = mean(recent.map((s) => s.connectorHits ?? 0));
    score = avgFluency;
    if (avgFillers <= 3) score += 6; else if (avgFillers >= 10) score -= 6;
    if (avgConn >= 2) score += 4;
    score = Math.max(0, Math.min(100, Math.round(score)));
  }

  // Highest tier whose score AND session requirements are both met.
  let tier = 0;
  for (let i = 0; i < TIER_REQ.length; i++) {
    if (score >= TIER_REQ[i].minScore && n >= TIER_REQ[i].minSessions) tier = i;
  }
  const isMax = tier >= RANKS.length - 1;
  const next  = isMax ? null : TIER_REQ[tier + 1];

  // HONEST "to next" — if the score already qualifies but more sessions are required,
  // report that (sessions), not a misleading 100%.
  let toNextPct = 100, nextBy = null, sessionsToNext = 0;
  if (next) {
    const scoreGap = Math.max(0, next.minScore - score);
    sessionsToNext = Math.max(0, next.minSessions - n);
    if (scoreGap > 0) {
      nextBy = 'score';
      const lo = TIER_REQ[tier].minScore, hi = next.minScore;
      toNextPct = Math.max(0, Math.min(100, Math.round(((score - lo) / (hi - lo)) * 100)));
    } else if (sessionsToNext > 0) {
      nextBy = 'sessions';
      toNextPct = 100;
    }
  }

  return {
    tier, label: RANKS[tier], score, sessions: n,
    nextLabel: isMax ? null : RANKS[tier + 1],
    toNextPct, nextBy, sessionsToNext, ranks: RANKS,
  };
}

/**
 * Consecutive-day training streak ("Trainingsserie") from session timestamps.
 * Counts back from today (or yesterday, if no session yet today) over unbroken days.
 */
export function computeStreak(sessions, extraDayKeys = []) {
  // Bucket sessions (and any extra active days, e.g. Trainingslager lesson days) by their Cairo
  // calendar day, then walk back day-by-day. Stepping via dayKeyNoonMs keeps each hop anchored
  // near noon, so DST transitions can't skip/double a day.
  const days = new Set();
  for (const s of (Array.isArray(sessions) ? sessions : [])) days.add(dayKey(new Date(s.date).getTime()));
  for (const k of (Array.isArray(extraDayKeys) ? extraDayKeys : [])) if (k) days.add(k);
  if (days.size === 0) return 0;

  let key = dayKey();                           // today (Cairo)
  if (!days.has(key)) {
    key = dayKey(dayKeyNoonMs(key) - DAY);      // allow yesterday as the anchor (today not trained yet)
    if (!days.has(key)) return 0;
  }
  let streak = 0;
  while (days.has(key)) {
    streak++;
    key = dayKey(dayKeyNoonMs(key) - DAY);
  }
  return streak;
}

// XP for completing a Trainingslager lesson (quiz passed) — ~50% of a typical fight's XP.
export const LESSON_XP = 18;
