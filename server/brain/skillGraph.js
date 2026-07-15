/**
 * skillGraph.js — the LOCKED German-BPO-interview skill DAG (owner-approved). The spine every brain
 * decision routes on. Prerequisites gate unlocking; a skill is on the FRONTIER when all its prereqs
 * are mastered but it isn't. Tiers are by CHARACTERISTIC ONLY — never an employer/company name.
 *
 * Grammar skill ids deliberately match the canonical errorTags ruleIds (konjunktiv-2, dativ-akkusativ,
 * …) so the brain's weakness signal and the curriculum share ONE identifier (the taxonomy fix).
 */

// Hiring tiers — described by what the work demands, NEVER by a company name.
export const TIERS = {
  entry:   { id: 'entry',   label_de: 'Einstiegslinie', cefr: 'B2', applyHere: true  },
  premium: { id: 'premium', label_de: 'Premium-Linie',  cefr: 'C1', applyHere: false },
};

// drill ids map to the app's existing surfaces (DRUCK-LEITER, HÖR-CHECK, …).
export const SKILLS = [
  // Layer 0 — Foundation (~B1)
  { id: 'self-intro',           layer: 0, prereq: [],                                  drill: 'shadowing',     tier: null },
  { id: 'praesens-perfekt',     layer: 0, prereq: [],                                  drill: 'sag-es-richtig',tier: null },
  { id: 'core-vocab',           layer: 0, prereq: [],                                  drill: 'srs',           tier: null },
  { id: 'listen-clear',         layer: 0, prereq: [],                                  drill: 'hoer-check',    tier: null },

  // Layer 1 — ENTRY tier (B2 floor → "go apply")
  // word-order-sub → SATZBAU-SCHMIEDE: the drill purpose-built for verb-final order (THE #1
  // Arabic-L1 wall). It was mapped to flow-drill (a speed drill that never touches word order),
  // so the brain could not prescribe the one exercise that trains its most common target.
  { id: 'word-order-sub',       layer: 1, prereq: ['praesens-perfekt'],               drill: 'satzbau-schmiede', tier: 'entry' },
  { id: 'dativ-akkusativ',      layer: 1, prereq: ['praesens-perfekt'],               drill: 'sag-es-richtig',tier: 'entry' },
  { id: 'sie-register',         layer: 1, prereq: ['self-intro'],                     drill: 'srs',           tier: 'entry' },
  // The pressure ladder trains the observable request-handling sequence and reports server-graded
  // practice. The generic interview mapping had no completable practice-to-retest path.
  { id: 'handle-clear-request', layer: 1, prereq: ['listen-clear', 'core-vocab'],     drill: 'druck-leiter',  tier: 'entry' },
  { id: 'listen-phone',         layer: 1, prereq: ['listen-clear'],                   drill: 'hoer-check',    tier: 'entry' },
  { id: 'no-freeze-expected',   layer: 1, prereq: ['self-intro'],                     drill: 'druck-leiter',  tier: 'entry' },

  // Layer 2 — line-ready (B2→C1)
  { id: 'deescalate',           layer: 2, prereq: ['no-freeze-expected', 'sie-register'], drill: 'druck-leiter', tier: 'premium' },
  { id: 'konjunktiv-2',         layer: 2, prereq: ['word-order-sub'],                  drill: 'sag-es-richtig',tier: 'premium' },
  { id: 'gdpr-verify',          layer: 2, prereq: ['handle-clear-request'],           drill: 'interview',     tier: 'premium' },
  { id: 'complaint-phrases',    layer: 2, prereq: ['sie-register'],                   drill: 'srs',           tier: 'premium' },
  { id: 'fluency-interrupt',    layer: 2, prereq: ['no-freeze-expected'],             drill: 'flow-drill',    tier: 'premium' },
  { id: 'pronunciation-phone',  layer: 2, prereq: ['listen-phone'],                   drill: 'shadowing',     tier: 'premium' },

  // Layer 3 — PREMIUM tier (C1, opt-in)
  { id: 'angry-c1',             layer: 3, prereq: ['deescalate', 'fluency-interrupt'], drill: 'druck-leiter', tier: 'premium' },
  { id: 'spontaneous-precise',  layer: 3, prereq: ['konjunktiv-2', 'pronunciation-phone'], drill: 'interview', tier: 'premium' },
  { id: 'behavioral-salary',    layer: 3, prereq: ['handle-clear-request'],           drill: 'interview',     tier: 'premium' },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

// Frontier = skills not yet mastered whose prerequisites are ALL mastered. masteredSet: Set<skillId>.
// This is what stops the brain offering an advanced scenario before the fundamentals are in place.
export function frontier(masteredSet) {
  const m = masteredSet instanceof Set ? masteredSet : new Set(masteredSet || []);
  return SKILLS.filter((s) => !m.has(s.id) && s.prereq.every((p) => m.has(p)));
}

// Journey progress toward the GOAL (apply-ready), so the app can REFLECT advancement back to the
// learner — a filling path, "X of N steps to apply-ready", the next milestone — not just a next step.
export function progress(masteredSet) {
  const m = masteredSet instanceof Set ? masteredSet : new Set(masteredSet || []);
  const entryPath   = SKILLS.filter((s) => s.layer <= 1);   // Layer 0 + 1 = the road to apply-ready
  const premiumPath = SKILLS.filter((s) => s.layer >= 2);
  const done = (arr) => arr.filter((s) => m.has(s.id)).length;
  const entryDone = done(entryPath), entryTotal = entryPath.length;
  return {
    entryDone, entryTotal,
    premiumDone: done(premiumPath), premiumTotal: premiumPath.length,
    pctToApply: entryTotal ? Math.round((entryDone / entryTotal) * 100) : 0,
    stepsToApply: Math.max(0, entryTotal - entryDone),
    totalMastered: SKILLS.filter((s) => m.has(s.id)).length, totalSkills: SKILLS.length,
  };
}

// The nearest hiring tier the learner can CLEAR next = the lowest-layer tier whose every skill is
// mastered. Returns { cleared:[tierIds], next:tierId|null, applyNow:boolean }.
export function tierStatus(masteredSet) {
  const m = masteredSet instanceof Set ? masteredSet : new Set(masteredSet || []);
  const tierSkills = (t) => SKILLS.filter((s) => s.tier === t);
  const clearedTier = (t) => tierSkills(t).length > 0 && tierSkills(t).every((s) => m.has(s.id));
  const entryCleared = clearedTier('entry');
  const premiumCleared = clearedTier('premium');
  return {
    cleared:  [entryCleared && 'entry', premiumCleared && 'premium'].filter(Boolean),
    next:     !entryCleared ? 'entry' : !premiumCleared ? 'premium' : null,
    applyNow: entryCleared,   // internal entry simulation cleared → gather real application evidence
  };
}
