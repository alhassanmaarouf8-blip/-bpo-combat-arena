/**
 * problemRank.js — the CHOOSE layer of v2 Phase 2 (owner requirement 2026-07-19: "detect every
 * mistake, but then CHOOSE, like a real elite human teacher, WHICH one is the main bottleneck").
 *
 * Pure + deterministic + copy-free (doctrine rules 1+4): given the learner's OBSERVED error record
 * (weakLog) and mastered skills, return the problems RANKED the way a master DaF teacher triages:
 *
 *   1. IMPACT first — does it break understanding? Global errors (verb position/word order, verb
 *      forms, copula — the Arabic-L1 traps) outrank register errors (case, prepositions,
 *      Konjunktiv-II politeness: BPO-critical), which outrank local polish (articles, endings).
 *      Grounded in the error-gravity literature (global vs local comprehensibility) — see the
 *      auto-research evidence cache. No invented numeric weights: ordering is LEXICOGRAPHIC.
 *   2. FREQUENCY in the learner's OWN speech — sessions-with-error, then total occurrences
 *      (so the "why now" case can say "appeared in N of your interviews", checkable).
 *   3. READINESS — a problem whose prerequisite skills are unmastered is ranked but flagged
 *      not-ready (the teacher doesn't prescribe Konjunktiv II while verb position is broken).
 *
 * Slip ≠ system (D4): a rule enters the ranking only with errors in ≥2 sessions. One bad day
 * is never "your biggest problem".
 */
import { SKILL_BY_ID } from './skillGraph.js';

// Documented impact taxonomy. Explicit ids first (the curriculum's own rules), then pattern
// classes for LT-derived rule ids, then the honest default: LOCAL (tier 1) — an unknown error
// class must never be promoted to "breaks understanding" by guesswork.
const TIER_BY_ID = Object.freeze({
  'word-order-sub':   3,  // verb-final/verb position — the classic global breaker
  'praesens-perfekt': 3,  // verb forms/tense — global
  'dativ-akkusativ':  2,  // case — strains, rarely breaks
  'konjunktiv-2':     2,  // politeness register — BPO-critical, not comprehension-critical
});
const T3 = /word.?order|verbstellung|verb.?(position|form|final)|satzstellung|kopula|copula|verbform/i;
const T2 = /dativ|akkusativ|genitiv|kasus|präposition|praeposition|preposition|konjunktiv|tempus|zeitform|negation/i;

export function impactTierOf(ruleId = '') {
  if (Object.hasOwn(TIER_BY_ID, ruleId)) return TIER_BY_ID[ruleId];
  if (T3.test(ruleId)) return 3;
  if (T2.test(ruleId)) return 2;
  return 1;
}

/**
 * rankProblems({ weakLog, masteredSkills }) → [{ ruleId, tier, sessionsWith, occurrences, ready, known }]
 * Ordered: ready first, then tier desc, sessionsWith desc, occurrences desc, ruleId asc (stable).
 */
export function rankProblems({ weakLog = {}, masteredSkills = [] } = {}) {
  const mastered = new Set(masteredSkills);
  const rows = [];
  for (const [ruleId, entry] of Object.entries(weakLog)) {
    const counts = Array.isArray(entry?.errCounts) ? entry.errCounts : [];
    const errSessions = counts.filter((c) => (c?.count || 0) > 0);
    if (errSessions.length < 2) continue;                 // slip ≠ system — evidence floor
    if (mastered.has(ruleId)) continue;                   // already conquered → not a problem
    const skill = SKILL_BY_ID[ruleId];
    const ready = skill ? (skill.prereq || []).every((pre) => mastered.has(pre)) : true;
    rows.push({
      ruleId,
      tier: impactTierOf(ruleId),
      sessionsWith: errSessions.length,
      occurrences: errSessions.reduce((s, c) => s + (c.count || 0), 0),
      ready,
      known: !!skill,
    });
  }
  return rows.sort((a, b) =>
    (b.ready - a.ready) || (b.tier - a.tier) || (b.sessionsWith - a.sessionsWith)
    || (b.occurrences - a.occurrences) || (a.ruleId < b.ruleId ? -1 : 1));
}
