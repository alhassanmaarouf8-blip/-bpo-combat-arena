/**
 * progression.js
 * Light leveling: XP per session, a level curve, and a boss ladder
 * (warm-up → standard → final boss) that unlocks with level.
 */
export const XP_PER_LEVEL = 120;

// Ordered easiest → hardest. bossId must exist in realtimeClient BOSS_CONFIGS.
export const BOSS_LADDER = [
  { id: 'frau-mueller',   name: 'FRAU MÜLLER',    tier: 'Aufwärm-Boss',  minLevel: 1 },
  { id: 'herr-tariq',     name: 'HERR TARIQ',     tier: 'Standard-Boss', minLevel: 3 },
  { id: 'direktor-vogel', name: 'DIREKTOR VOGEL', tier: 'Endgegner',     minLevel: 6 },
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

/**
 * Consecutive-day training streak ("Trainingsserie") from session timestamps.
 * Counts back from today (or yesterday, if no session yet today) over unbroken days.
 */
export function computeStreak(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return 0;
  const days = new Set(sessions.map((s) => new Date(s.date).toDateString()));
  const d = new Date();
  if (!days.has(d.toDateString())) {
    d.setDate(d.getDate() - 1);             // allow yesterday as the anchor (today not trained yet)
    if (!days.has(d.toDateString())) return 0;
  }
  let streak = 0;
  while (days.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
