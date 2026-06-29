/**
 * engine.js — the live-brain DECISION POLICY. Pure + deterministic: given a snapshot of the learner's
 * already-computed signals, it returns a structured DIRECTIVE (state, target, prescription, tier, aha)
 * with NO copy. The masri voice renders the directive via owner-authored templates — the engine never
 * writes words, never calls an LLM, never names an employer. Same snapshot in → same directive out.
 *
 * Honesty gates baked in (so it cannot confidently lie):
 *  - cold-start → low confidence, no causal claims
 *  - a weakness is only asserted with ≥2 sessions of evidence (hysteresis)
 *  - an "aha" fires ONLY on a confirmed closed loop (targeted → drilled → sustained drop) AND only
 *    when overall errors didn't rise (global regression vetoes a local celebration)
 *  - when a hire-gating signal is unmeasured, the next action is to MEASURE it, not guess
 */
import { frontier, tierStatus, SKILL_BY_ID } from './skillGraph.js';

// Which frontier skill best addresses the hire-gating limiting skill (reuses hireReadiness' vector).
const LIMIT_TO_SKILL = {
  intelligibility: 'pronunciation-phone',
  fluency:         'fluency-interrupt',
  deescalation:    'deescalate',
  // grammar handled specially (pick the worst frontier grammar skill from weakLog)
};
const GRAMMAR_SKILLS = ['konjunktiv-2', 'dativ-akkusativ', 'word-order-sub'];

function pickTarget(fr, limitingSkill, weakLog) {
  if (!fr.length) return null;
  const frIds = new Set(fr.map((s) => s.id));
  // 1) grammar: target the worst-recent frontier grammar skill
  if (limitingSkill === 'grammar') {
    const worst = GRAMMAR_SKILLS
      .filter((id) => frIds.has(id))
      .map((id) => ({ id, n: lastErr(weakLog, id) }))
      .sort((a, b) => b.n - a.n)[0];
    if (worst) return SKILL_BY_ID[worst.id];
  }
  // 2) a specific limiting skill maps to a specific competency (if it's on the frontier)
  const mapped = LIMIT_TO_SKILL[limitingSkill];
  if (mapped && frIds.has(mapped)) return SKILL_BY_ID[mapped];
  // 3) fallback: the lowest-layer frontier skill (curriculum order)
  return [...fr].sort((a, b) => a.layer - b.layer)[0];
}

function lastErr(weakLog, ruleId) {
  const e = weakLog?.[ruleId];
  const s = e?.errCounts;
  return s && s.length ? (s[s.length - 1].count || 0) : 0;
}

// Confirmed closed loop → an honest "aha". Returns {ruleId, before, after} or null.
function detectAha(weakLog, lastTargetRuleId, globalRegressed) {
  if (globalRegressed) return null;                       // never celebrate amid an overall regression
  const e = lastTargetRuleId && weakLog?.[lastTargetRuleId];
  if (!e) return null;
  const drilled = (e.drills || []).length > 0;            // they actually did a prescribed drill
  const s = e.errCounts || [];
  if (!drilled || s.length < 2) return null;              // need a drill + ≥2 measurements (hysteresis)
  const before = s[s.length - 2].count || 0;
  const after  = s[s.length - 1].count || 0;
  return (before > 0 && after < before) ? { ruleId: lastTargetRuleId, before, after } : null;
}

export function decide(snapshot = {}) {
  const {
    masteredSkills = [], weakLog = {}, lastTargetRuleId = null,
    limitingSkill = null, unmeasuredGates = [],
    sessionCount = 0, daysSinceActive = 0, prepDone = false, globalRegressed = false,
  } = snapshot;

  // Cold-start: no history → no causal claims, just the first concrete step.
  if (sessionCount <= 0) {
    return { state: 'NEW', confidence: 'low', target: null,
      prescription: { action: 'assessment' }, tier: tierStatus(masteredSkills), aha: null, measure: [] };
  }

  const mastered = new Set(masteredSkills);
  const fr = frontier(mastered);
  const tier = tierStatus(mastered);
  const aha = detectAha(weakLog, lastTargetRuleId, globalRegressed);

  // Entry tier cleared → stop drilling, start applying (the loop must end in a JOB, not a treadmill).
  if (tier.applyNow) {
    return { state: 'APPLY', confidence: 'high', target: null,
      prescription: { action: 'apply', tier: 'entry' }, tier, aha, measure: [] };
  }

  // A hire-gating signal is unmeasured → MEASURE it (don't prescribe a grammar drill on missing data).
  if (unmeasuredGates.length) {
    return { state: 'MEASURE', confidence: 'high', target: null,
      prescription: { action: 'measure', signal: unmeasuredGates[0] }, tier, aha, measure: unmeasuredGates };
  }

  const target = pickTarget(fr, limitingSkill, weakLog);
  // Confidence: only assert "your weakness" if the targeted rule has ≥2 sessions of evidence.
  const ev = target && weakLog?.[target.id]?.errCounts?.length || 0;
  const confidence = ev >= 2 ? 'high' : 'low';

  const inactive = daysSinceActive >= 4;
  const state = inactive ? 'PLATEAU'
    : prepDone           ? 'READY'        // did the prep → earn the targeted rematch
    : 'POST_FIGHT';                        // fresh debrief → here's the prescription

  return {
    state, confidence, tier, aha,
    target: target ? { skillId: target.id, layer: target.layer } : null,
    prescription: target ? { action: 'drill', drill: target.drill, skillId: target.id } : { action: 'interview' },
    measure: [],
  };
}
