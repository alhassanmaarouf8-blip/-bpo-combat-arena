/**
 * bkt.js — Bayesian Knowledge Tracing (Corbett & Anderson 1994): a per-skill mastery PROBABILITY
 * from a sequence of correct/incorrect attempts. Closed-form, deterministic, zero-cost, interpretable
 * ("dative mastery = 0.72"). Params are hand-set sensible defaults; can be fit from logs later.
 */
export const BKT_DEFAULTS = { pL0: 0.2, pT: 0.15, pS: 0.10, pG: 0.20 };

// One Bayesian update from a single graded attempt → posterior mastery after the learning step.
export function bktUpdate(pL, correct, params = BKT_DEFAULTS) {
  const { pT, pS, pG } = params;
  const num = correct ? pL * (1 - pS) : pL * pS;
  const den = correct
    ? (pL * (1 - pS) + (1 - pL) * pG)
    : (pL * pS + (1 - pL) * (1 - pG));
  const posterior = den > 0 ? num / den : pL;
  return posterior + (1 - posterior) * pT;   // learning transition
}

// P(next attempt correct) given current mastery — the prediction used for the 85% difficulty rule.
export function bktPredict(pL, params = BKT_DEFAULTS) {
  const { pS, pG } = params;
  return pL * (1 - pS) + (1 - pL) * pG;
}

// Replay a history of booleans → final mastery probability.
export function masteryFromHistory(events, params = BKT_DEFAULTS) {
  let pL = params.pL0;
  for (const correct of (events || [])) pL = bktUpdate(pL, !!correct, params);
  return pL;
}

export const MASTERY_GATE = 0.8;   // Bloom-style: ≥0.8 mastery before a skill counts as "learned".
