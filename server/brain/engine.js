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
import { rankProblems } from './problemRank.js';
import { seriesProgress } from './drillSeries.mjs';

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

function pickTarget(fr, limitingSkill, weakLog, criterionId = null, grammarRuleId = null, ranked = []) {
  if (!fr.length) return null;
  const frIds = new Set(fr.map((s) => s.id));
  // A v2 grammar-control forecast may target only the exact rule attributed by the same fresh,
  // reliable archetype evidence. A locked or unattributed rule fails closed instead of falling
  // through to stale weakLog history or an unrelated curriculum item.
  if (criterionId === 'grammar_control') {
    return GRAMMAR_SKILLS.includes(grammarRuleId) && frIds.has(grammarRuleId)
      ? SKILL_BY_ID[grammarRuleId] : null;
  }
  // Grammar guidance without a criterion: the elite-teacher ranking chooses first (v2 Phase 2 —
  // impact tier before raw count: 2 verb-position sessions outrank 5 dative slips because the
  // former breaks understanding). A rule below the ranking's 2-session evidence floor keeps the
  // historical worst-by-last-count fallback, so a single-session observation still beats drilling
  // something never observed.
  if (limitingSkill === 'grammar') {
    const topRanked = ranked.find((r) => GRAMMAR_SKILLS.includes(r.ruleId));
    const worst = GRAMMAR_SKILLS
      .map((id) => ({ id, n: lastErr(weakLog, id) }))
      .sort((a, b) => b.n - a.n)[0];
    const grammarTarget = pathTarget(topRanked?.ruleId || (worst?.n > 0 ? worst.id : 'word-order-sub'), frIds);
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
  grammar_errors: 'lower', fluency_score: 'higher', wpm: 'higher', deescalation_score: 'higher',
  response_continuity: 'higher', intelligibility_score: 'higher', listening_accuracy: 'higher',
  formal_register_score: 'higher', request_handling_score: 'higher',
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
    limitingGrammarRuleId = null, limitingGrammarEvidenceCount = 0,
    limitingGrammarEvidenceConflictCount = 0,
    sessionCount = 0, srsDueCount = 0, daysSinceActive = 0, prepDone = false, globalRegressed = false,
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

  // v2 Phase 2 CHOOSE layer: the elite-teacher problem ranking (impact → frequency → readiness,
  // lexicographic, ≥2-session floor). Top 5 ride on every directive so Fortschritt can show the
  // ranked list with a checkable "why" — while the prescription surface still shows exactly ONE step.
  const ranked = rankProblems({ weakLog, masteredSkills }).slice(0, 5);

  // Cold-start: no history → no causal claims, just the first concrete step.
  if (sessionCount <= 0) {
    // …but recorded corrections outrank "start from zero" (probe-proven 07-20: a short/stopped
    // interview stays below the progression floor — sessionCount 0 — yet produced real LT-verified
    // corrections; sending that user back to the Diagnose is the dead-end class again). Reviewing
    // their OWN corrections needs no diagnosis; confidence stays low, nothing is asserted.
    if (srsDueCount > 0) {
      return { state: 'POST_FIGHT', confidence: 'low', target: null,
        prescription: { action: 'drill', drill: 'sag-es-richtig' },
        tier: tierStatus(verifiedMasteredSkills), journey, aha: null, measure: [], ranked };
    }
    return { state: 'NEW', confidence: 'low', target: null,
      prescription: { action: 'assessment' }, tier: tierStatus(verifiedMasteredSkills), journey, aha: null, measure: [], ranked };
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
      ranked,
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
      ranked,
    };
  }

  const mastered = new Set(masteredSkills);
  const fr = frontier(mastered);
  const tier = tierStatus(new Set(verifiedMasteredSkills));
  const aha = detectAha(verifiedImprovement, globalRegressed);

  // Entry tier cleared → stop drilling, start applying (the loop must end in a JOB, not a treadmill).
  if (tier.applyNow) {
    return { state: 'APPLY', confidence: 'high', target: null,
      prescription: { action: 'apply', tier: 'entry' }, tier, journey, aha, measure: [], ranked };
  }

  // A hire-gating signal is unmeasured → MEASURE it (don't prescribe a grammar drill on missing data).
  if (unmeasuredGates.length) {
    // …UNLESS the candidate just walked out of a real interview with recorded corrections due
    // (owner lived the dead-end twice, 07-19/20: session done, 44 items recorded, and the app
    // answered "erst sauber messen" as if nothing happened). Reviewing the learner's OWN
    // LT-verified corrections aloud requires NO diagnosis — nothing is asserted about a
    // weakness (confidence stays low, the measure list stays visible), so D4 holds. MEASURE
    // returns the moment the review queue is empty.
    if (srsDueCount > 0) {
      return { state: 'POST_FIGHT', confidence: 'low', target: null,
        prescription: { action: 'drill', drill: 'sag-es-richtig' },
        tier, journey, aha, measure: unmeasuredGates, ranked };
    }
    return { state: 'MEASURE', confidence: 'high', target: null,
      prescription: { action: 'measure', signal: unmeasuredGates[0] }, tier, journey, aha, measure: unmeasuredGates, ranked };
  }

  const coachSkillId = typeof coachGate?.skillId === 'string' && Object.hasOwn(SKILL_BY_ID, coachGate.skillId)
    && ['practice', 'wait', 'retest'].includes(coachGate.status) ? coachGate.skillId : null;
  const target = coachSkillId ? SKILL_BY_ID[coachSkillId]
    : pickTarget(fr, limitingSkill, weakLog, limitingCriterionId, limitingGrammarRuleId, ranked);
  // Confidence: only assert "your weakness" if the targeted rule has ≥2 sessions of evidence.
  const targetEvidence = target && weakLog?.[target.id]?.errCounts?.length || 0;
  const criterionEvidenceCount = limitingCriterionId === 'grammar_control'
    ? limitingGrammarEvidenceCount : limitingEvidenceCount;
  const criterionConflictCount = limitingCriterionId === 'grammar_control'
    ? limitingGrammarEvidenceConflictCount : limitingEvidenceConflictCount;
  const confidence = limitingCriterionId
    ? (target && Math.max(0, Number(criterionEvidenceCount) || 0) >= 2
      && Math.max(0, Number(criterionConflictCount) || 0) === 0 ? 'high' : 'low')
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
      ranked,
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
      ranked,
    };
  }
  const prepMatched = matchingCoachGate?.status === 'practice' ? false : !target || recentDrillEvents == null
    ? prepDone
    : recentDrillEvents.some((e) => (e.ruleId && e.ruleId === target.id) || (e.drill && e.drill === target.drill));

  const inactive = daysSinceActive >= 4;

  // Drill-prescription doctrine (docs/drill-prescription-doctrine.md): a ranked grammar problem is
  // treated through its staged SERIES (NOTICE → CONTROLLED → AUTOMATIZE → disguised TRANSFER), the
  // stage derived from the rule's own drill-event record — not through the skill graph's single
  // static drill. Scope guard: criterion-driven forecasts and active coach doses keep their own
  // machinery (their drill ids anchor dose crediting); the series governs the pure ranked path.
  if (target && !limitingCriterionId && !matchingCoachGate) {
    const series = seriesProgress(target.id, weakLog);
    if (series) {
      const state = inactive ? 'PLATEAU' : series.transferReady ? 'READY' : 'POST_FIGHT';
      const seriesStage = series.transferReady
        ? { stage: 'D', step: series.totalSteps, of: series.totalSteps }
        : { stage: series.current.stage, step: series.currentIndex + 1, of: series.totalSteps,
          ...(series.regressed ? { regressed: true } : {}) };
      return {
        state, confidence, tier, journey, aha,
        target: { skillId: target.id, layer: target.layer },
        prescription: series.transferReady
          ? { action: 'interview', skillId: target.id, seriesStage }
          : { action: 'drill', drill: series.current.drill, skillId: target.id, seriesStage },
        measure: [],
        ranked,
      };
    }
  }
  const state = inactive ? 'PLATEAU'
    : prepMatched        ? 'READY'        // did the prep (on target) → earn the targeted rematch
    : 'POST_FIGHT';                        // fresh debrief → here's the prescription

  const targetShape = target ? { skillId: target.id, layer: target.layer, ...(limitingCriterionId ? { criterionId: limitingCriterionId } : {}) } : null;
  if (state === 'READY') {
    return { state, confidence, tier, journey, aha, target: targetShape,
      prescription: { action: 'interview', ...(target ? { skillId: target.id } : {}) }, measure: [], ranked };
  }
  return {
    state, confidence, tier, journey, aha,
    target: targetShape,
    prescription: target ? { action: 'drill', drill: target.drill, skillId: target.id,
      ...(limitingCriterionId ? { criterionId: limitingCriterionId } : {}) } : { action: 'interview' },
    measure: [],
    ranked,
  };
}
