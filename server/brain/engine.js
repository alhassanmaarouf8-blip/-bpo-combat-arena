/**
 * engine.js — the live-brain DECISION POLICY. Pure + deterministic: given a snapshot of the learner's
 * already-computed signals, it returns a structured DIRECTIVE (state, target, prescription, tier, aha)
 * with NO copy. The masri voice renders the directive via owner-authored templates — the engine never
 * writes words, never calls an LLM, never names an employer. Same snapshot in → same directive out.
 *
 * Honesty gates baked in (so it cannot confidently lie):
 *  - cold-start → low confidence, no causal claims
 *  - a weakness is only asserted with ≥2 sessions of evidence (hysteresis)
 *  - an "aha" fires ONLY on a delayed novel transfer proof recorded by the server AND only when
 *    overall errors did not rise (global regression vetoes a local celebration)
 *  - when a hire-gating signal is unmeasured, the next action is to MEASURE it, not guess
 */
import { frontier, tierStatus, progress, SKILL_BY_ID } from './skillGraph.js';

// Which frontier skill best addresses the hire-gating limiting skill (reuses hireReadiness' vector).
const LIMIT_TO_SKILL = {
  intelligibility: 'pronunciation-phone',
  fluency:         'fluency-interrupt',
  deescalation:    'deescalate',
  confidence:      'no-freeze-expected',
  complexity:      'word-order-sub',
  // grammar handled specially (pick the worst frontier grammar skill from weakLog)
};
const CRITERION_TO_SKILL = Object.freeze({
  sustained_pace: 'fluency-interrupt',
  speech_recognition_proxy: 'pronunciation-phone',
  service_recovery_structure: 'deescalate',
  complete_response: 'no-freeze-expected',
  response_latency: 'no-freeze-expected',
  filler_dependence: 'fluency-interrupt',
  connected_answer_structure: 'word-order-sub',
  lexical_range_proxy: 'core-vocab',
});
const GRAMMAR_SKILLS = ['konjunktiv-2', 'dativ-akkusativ', 'word-order-sub'];
const MISSION_STEPS = new Set(['passport', 'measure', 'prep', 'shortlist', 'pack', 'submit', 'response', 'interview']);

function pathTarget(targetId, frIds, seen = new Set()) {
  if (!targetId || seen.has(targetId)) return null;
  if (frIds.has(targetId)) return SKILL_BY_ID[targetId];
  seen.add(targetId);
  const target = SKILL_BY_ID[targetId];
  for (const prerequisite of target?.prereq || []) {
    const available = pathTarget(prerequisite, frIds, seen);
    if (available) return available;
  }
  return null;
}

function pickTarget(fr, limitingSkill, weakLog, criterionId = null) {
  if (!fr.length) return null;
  const frIds = new Set(fr.map((s) => s.id));
  // 1) grammar: target the worst-recent frontier grammar skill
  if (limitingSkill === 'grammar' || criterionId === 'grammar_control') {
    const worst = GRAMMAR_SKILLS
      .map((id) => ({ id, n: lastErr(weakLog, id) }))
      .sort((a, b) => b.n - a.n)[0];
    const grammarTarget = pathTarget(worst?.n > 0 ? worst.id : 'word-order-sub', frIds);
    if (grammarTarget) return grammarTarget;
  }
  // 2) the exact observed criterion wins. If its direct skill is still locked, select the nearest
  // unmet prerequisite on that same path rather than an unrelated low-layer curriculum item.
  const mapped = CRITERION_TO_SKILL[criterionId] || LIMIT_TO_SKILL[limitingSkill];
  const aligned = pathTarget(mapped, frIds);
  if (aligned) return aligned;
  // 3) fallback: the lowest-layer frontier skill (curriculum order)
  return [...fr].sort((a, b) => a.layer - b.layer)[0];
}

function lastErr(weakLog, ruleId) {
  const e = weakLog?.[ruleId];
  const s = e?.errCounts;
  return s && s.length ? (s[s.length - 1].count || 0) : 0;
}

const AHA_METRIC_DIRECTIONS = Object.freeze({
  grammar_errors: 'lower', fluency_score: 'higher', deescalation_score: 'higher',
  response_continuity: 'higher', intelligibility_score: 'higher', listening_accuracy: 'higher',
});

// A delayed novel transfer proof can support a narrow observed change. It cannot prove that the
// drill caused the change, predict an employer decision, or authorize a different next action.
function detectAha(verifiedImprovement, globalRegressed) {
  if (globalRegressed || !verifiedImprovement || verifiedImprovement.phase !== 'transfer') return null;
  const skillId = verifiedImprovement.skillId;
  const metricKey = verifiedImprovement.metricKey;
  const before = Number(verifiedImprovement.before); const after = Number(verifiedImprovement.after);
  const direction = Object.hasOwn(AHA_METRIC_DIRECTIONS, metricKey) ? AHA_METRIC_DIRECTIONS[metricKey] : null;
  const changedInExpectedDirection = direction === 'higher' ? after > before : direction === 'lower' ? after < before : false;
  if (!Object.hasOwn(SKILL_BY_ID, skillId) || direction !== verifiedImprovement.direction
    || !Number.isFinite(before) || !Number.isFinite(after) || !changedInExpectedDirection) return null;
  return { skillId, metricKey, before, after, direction, phase: 'transfer' };
}

export function decide(snapshot = {}) {
  const {
    masteredSkills = [], verifiedMasteredSkills = [], verifiedImprovement = null, weakLog = {},
    limitingSkill = null, limitingCriterionId = null, limitingEvidenceCount = 0,
    limitingEvidenceConflictCount = 0, unmeasuredGates = [],
    sessionCount = 0, daysSinceActive = 0, prepDone = false, globalRegressed = false,
    recentDrillEvents = null,
    coachGate = null,
    vacancyDue = null,
    missionDue = null,
  } = snapshot;

  // Journey toward the goal — handed to the UI so the app REFLECTS step-by-step advancement back to
  // the learner (a filling path, "N steps to apply-ready"), making the guidance felt, not just done.
  // Navigation may use provisional legacy observations, but visible progress and APPLY authority use
  // transfer-verified mastery only. A generic pass or historical completion can never unlock readiness.
  const journey = progress(verifiedMasteredSkills);

  // Cold-start: no history → no causal claims, just the first concrete step.
  if (sessionCount <= 0) {
    return { state: 'NEW', confidence: 'low', target: null,
      prescription: { action: 'assessment' }, tier: tierStatus(verifiedMasteredSkills), journey, aha: null, measure: [] };
  }

  // A confirmed vacancy target adds one due preparation step to the same
  // decision spine. It never creates a second home-screen CTA or bypasses the
  // initial assessment needed to make later coaching honest.
  if (vacancyDue?.id && vacancyDue?.title) {
    return {
      state: 'VACANCY_PREP',
      confidence: 'high',
      target: null,
      prescription: {
        action: 'vacancy',
        milestoneId: vacancyDue.id,
        title: vacancyDue.title,
        objective: vacancyDue.objective || '',
        scheduledDate: vacancyDue.scheduledDate || null,
        liveRequired: vacancyDue.liveRequired === true,
      },
      tier: tierStatus(verifiedMasteredSkills),
      journey,
      aha: null,
      measure: [],
    };
  }

  // Mission Control contributes to the same decision spine instead of creating a
  // second dashboard CTA. Only an allowlisted, copy-free step can reach the client;
  // employer names, vacancy prose, and candidate facts stay outside this engine.
  if (MISSION_STEPS.has(missionDue?.step)) {
    const opportunityId = typeof missionDue.opportunityId === 'string'
      && /^[a-zA-Z0-9_-]{1,64}$/u.test(missionDue.opportunityId)
      ? missionDue.opportunityId : null;
    return {
      state: 'MISSION_CONTROL',
      confidence: 'high',
      target: null,
      prescription: {
        action: 'mission',
        step: missionDue.step,
        ...(opportunityId ? { opportunityId } : {}),
      },
      tier: tierStatus(verifiedMasteredSkills),
      journey,
      aha: null,
      measure: [],
    };
  }

  const mastered = new Set(masteredSkills);
  const fr = frontier(mastered);
  const tier = tierStatus(new Set(verifiedMasteredSkills));
  const aha = detectAha(verifiedImprovement, globalRegressed);

  // Entry tier cleared → stop drilling, start applying (the loop must end in a JOB, not a treadmill).
  if (tier.applyNow) {
    return { state: 'APPLY', confidence: 'high', target: null,
      prescription: { action: 'apply', tier: 'entry' }, tier, journey, aha, measure: [] };
  }

  // A hire-gating signal is unmeasured → MEASURE it (don't prescribe a grammar drill on missing data).
  if (unmeasuredGates.length) {
    return { state: 'MEASURE', confidence: 'high', target: null,
      prescription: { action: 'measure', signal: unmeasuredGates[0] }, tier, journey, aha, measure: unmeasuredGates };
  }

  const coachSkillId = typeof coachGate?.skillId === 'string' && Object.hasOwn(SKILL_BY_ID, coachGate.skillId)
    && ['practice', 'wait', 'retest'].includes(coachGate.status) ? coachGate.skillId : null;
  const target = coachSkillId ? SKILL_BY_ID[coachSkillId] : pickTarget(fr, limitingSkill, weakLog, limitingCriterionId);
  // Confidence: only assert "your weakness" if the targeted rule has ≥2 sessions of evidence.
  const targetEvidence = target && weakLog?.[target.id]?.errCounts?.length || 0;
  const confidence = limitingCriterionId
    ? (Math.max(0, Number(limitingEvidenceCount) || 0) >= 2
      && Math.max(0, Number(limitingEvidenceConflictCount) || 0) === 0 ? 'high' : 'low')
    : targetEvidence >= 2 ? 'high' : 'low';

  // Prep must plausibly address THE TARGET to earn the rematch (doctrine D3): a drill event
  // counts if it landed on the targeted rule OR came from the drill this target prescribes
  // (most drills report only their kind, no ruleId). An unrelated rep — shadowing for a dative
  // target — no longer flips READY. Older snapshots without recentDrillEvents keep the legacy
  // loose prepDone behavior.
  const matchingCoachGate = target && coachSkillId === target.id ? coachGate : null;
  if (matchingCoachGate?.status === 'wait') {
    return {
      state: 'RETEST_WAIT', confidence, tier, journey, aha,
      target: { skillId: target.id, layer: target.layer, ...(limitingCriterionId ? { criterionId: limitingCriterionId } : {}) },
      prescription: { action: 'wait', skillId: target.id, phase: matchingCoachGate.phase,
        nextEligibleAt: matchingCoachGate.nextEligibleAt },
      measure: [],
    };
  }
  if (matchingCoachGate?.status === 'retest') {
    return {
      state: matchingCoachGate.action === 'interview' ? 'READY' : 'RETEST_READY',
      confidence, tier, journey, aha,
      target: { skillId: target.id, layer: target.layer, ...(limitingCriterionId ? { criterionId: limitingCriterionId } : {}) },
      prescription: matchingCoachGate.action === 'interview'
        ? { action: 'interview', skillId: target.id, phase: matchingCoachGate.phase }
        : { action: 'drill', drill: matchingCoachGate.drillId, skillId: target.id, phase: matchingCoachGate.phase },
      measure: [],
    };
  }
  const prepMatched = matchingCoachGate?.status === 'practice' ? false : !target || recentDrillEvents == null
    ? prepDone
    : recentDrillEvents.some((e) => (e.ruleId && e.ruleId === target.id) || (e.drill && e.drill === target.drill));

  const inactive = daysSinceActive >= 4;
  const state = inactive ? 'PLATEAU'
    : prepMatched        ? 'READY'        // did the prep (on target) → earn the targeted rematch
    : 'POST_FIGHT';                        // fresh debrief → here's the prescription

  const targetShape = target ? { skillId: target.id, layer: target.layer, ...(limitingCriterionId ? { criterionId: limitingCriterionId } : {}) } : null;
  if (state === 'READY') {
    return { state, confidence, tier, journey, aha, target: targetShape,
      prescription: { action: 'interview', ...(target ? { skillId: target.id } : {}) }, measure: [] };
  }
  return {
    state, confidence, tier, journey, aha,
    target: targetShape,
    prescription: target ? { action: 'drill', drill: target.drill, skillId: target.id,
      ...(limitingCriterionId ? { criterionId: limitingCriterionId } : {}) } : { action: 'interview' },
    measure: [],
  };
}
