/**
 * adapter.js — the BRIDGE: turn a stored user profile into the pure snapshot the engine decides on.
 * Deterministic. Reuses the app's existing signals (hireReadiness, weakLog, sessions, listeningStats).
 *
 * HONESTY: a skill is marked mastered ONLY with positive evidence. With no signal it stays on the path
 * (we never claim mastery we can't see). So early students sit at the foundation and the brain guides
 * up from there — which is correct, not a bug.
 */
import { masteryFromHistory, MASTERY_GATE } from './bkt.js';
import { hireReadinessFor, featuresFromProfile } from '../hireReadiness.js';
import { listeningMasteryEvidence } from '../listeningEvidence.js';

const GRAMMAR_SKILL_IDS = ['konjunktiv-2', 'dativ-akkusativ', 'word-order-sub'];
const GATING = ['intelligibility', 'deescalation', 'wpm'];   // the hire-readiness gating signals
const DAY_MS = 86400000;

function criterionEvidenceCount(sessions, criterionId) {
  const measured = (session) => {
    const words = Number(session?.evidenceQuality?.words) || Number(session?.words) || 0;
    if (criterionId === 'sustained_pace') return Number.isFinite(session?.wpm);
    if (criterionId === 'grammar_control') return session?.grammarMeasured === true && words >= 80;
    if (criterionId === 'speech_recognition_proxy') return Number.isFinite(session?.intelligibility);
    if (criterionId === 'deescalation_response') return Number.isFinite(session?.deescalation);
    if (criterionId === 'complete_response') return Number.isFinite(session?.giveUpRate);
    if (criterionId === 'response_latency') return Number.isFinite(session?.latencyS);
    if (criterionId === 'filler_dependence') return Number.isFinite(session?.fillers) && words >= 80;
    if (criterionId === 'connected_answer_structure') return Number.isFinite(session?.subClauseRate);
    if (criterionId === 'lexical_range_proxy') return Number.isFinite(session?.vocabDiversity);
    return false;
  };
  return sessions.filter((session) => session?.evidenceQuality?.version === 1
    && session.evidenceQuality.prescriptionEligible === true && measured(session)).length;
}

export function masteredSkillsFromProfile(p) {
  const sessions = p?.sessions || [];
  const weakLog  = p?.weakLog || {};
  const mastered = new Set();
  if (!sessions.length) return mastered;

  const recent = sessions.slice(-3);
  const last   = sessions[sessions.length - 1] || {};
  const avg = (key) => {
    const v = recent.map((s) => s[key]).filter((n) => typeof n === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const functional = sessions.length >= 2 && last.verdict !== 'fail';   // can run a basic interview

  // Grammar skills → BKT over the weakLog error series (0 errors that session = correct, >0 = incorrect).
  for (const id of GRAMMAR_SKILL_IDS) {
    const counts = weakLog[id]?.errCounts || [];
    if (counts.length >= 2) {
      if (masteryFromHistory(counts.map((c) => (c.count || 0) === 0)) >= MASTERY_GATE) mastered.add(id);
    } else if (counts.length === 0 && functional) {
      mastered.add(id);   // functional candidate who has never erred on it → treat as in place
    }
  }

  // Foundation — bootstrap once the candidate is functional (≥2 non-fail interviews).
  if (functional) ['self-intro', 'core-vocab', 'praesens-perfekt', 'handle-clear-request', 'sie-register'].forEach((s) => mastered.add(s));

  // Listening → from listeningStats accuracy when present; else foundation listening for functional users.
  // listening.js records PER-TYPE stats ({ verstehen:{seen,correct}, name:{seen,correct}, … }) — aggregate
  // them here. (The old flat {correct,total} read matched nothing the drill ever wrote, so listening
  // mastery could never be earned no matter how much Hör-Check a student did. Flat shape still honored.)
  const verifiedListening = listeningMasteryEvidence(p);
  const ls = p?.listeningStats;
  let lsC = null, lsT = null;
  if (ls && typeof ls.correct === 'number' && typeof ls.total === 'number') { lsC = ls.correct; lsT = ls.total; }
  else if (ls && typeof ls === 'object') {
    let c = 0, t = 0, any = false;
    for (const v of Object.values(ls)) {
      if (v && typeof v === 'object' && typeof v.seen === 'number') { c += v.correct || 0; t += v.seen; any = true; }
    }
    if (any) { lsC = c; lsT = t; }
  }
  const acc = lsT != null && lsT >= 5 ? lsC / lsT : null;
  // Migrate skill-by-skill: a partial verified packet must not suddenly demote an existing learner,
  // but once a full server-verified packet exists it becomes the authority for that skill. This keeps
  // legacy users stable while preventing replayed or client-forged totals from overriding new evidence.
  const legacyMastered = acc != null && acc >= 0.8;
  if (verifiedListening.clearMeasured ? verifiedListening.clear : (legacyMastered || functional)) mastered.add('listen-clear');
  if (verifiedListening.phoneMeasured ? verifiedListening.phone : legacyMastered) mastered.add('listen-phone');

  // Measured interview signals → specific competencies (ONLY when the signal is actually measured).
  const gu = avg('giveUpRate');      if (gu != null && gu < 0.2)  mastered.add('no-freeze-expected');
  const de = avg('deescalation');    if (de != null && de >= 0.6) mastered.add('deescalate');
  const wpm = avg('wpm');            if (wpm != null && wpm >= 120) mastered.add('fluency-interrupt');
  const intel = avg('intelligibility'); if (intel != null && intel >= 0.8) mastered.add('pronunciation-phone');

  // C1 ceiling competencies — only on a real C1 pass.
  const level = p?.assessmentResult?.estimatedLevel || last.rank;
  if (level === 'C1' && last.verdict === 'pass') ['spontaneous-precise', 'angry-c1', 'behavioral-salary', 'konjunktiv-2'].forEach((s) => mastered.add(s));

  return mastered;
}

export function buildSnapshot(p, now = Date.now()) {
  const sessions = p?.sessions || [];
  const weakLog  = p?.weakLog || {};
  const last = sessions[sessions.length - 1] || null;
  const prev = sessions[sessions.length - 2] || null;
  const hr = hireReadinessFor(p);
  const { measured } = featuresFromProfile(p);
  const limitingCriterionId = hr.rejectionForecast?.criterion?.criterionId || null;

  const lastDate = last?.date || 0;
  const after = (at) => (at || 0) > lastDate;
  const targetRuleId = p?.lastTargetRule?.ruleId || null;
  // Legacy loose signal: ANY drill activity since the last fight. The ENGINE decides whether that
  // prep actually addressed the target (doctrine D3) using recentDrillEvents below — matching by
  // targeted rule OR by the prescribed drill's kind, because most drills (flow-drill, hör-check,
  // satzbau, druck-leiter, shadowing) report no ruleId, only their kind.
  const prepDone = Object.values(weakLog).some((e) => (e.drills || []).some((d) => after(d.at)))
                || (p?.drillLog || []).some((d) => after(d.at));
  const recentDrillEvents = [
    ...Object.values(weakLog).flatMap((e) =>
      (e.drills || []).filter((d) => after(d.at)).map((d) => ({ drill: d.drill || null, ruleId: e.ruleId || null }))),
    ...(p?.drillLog || []).filter((d) => after(d.at)).map((d) => ({ drill: d.drill || null, ruleId: null })),
  ];

  const tot = (s) => (Array.isArray(s?.grammarRules) ? s.grammarRules.reduce((a, r) => a + (r.count || 0), 0) : null);
  const tl = tot(last), tp = tot(prev);

  return {
    masteredSkills:   [...masteredSkillsFromProfile(p)],
    weakLog,
    lastTargetRuleId: targetRuleId,
    limitingSkill:    hr.limitingSkill && hr.limitingSkill !== 'none' ? hr.limitingSkill : null,
    limitingCriterionId,
    limitingEvidenceCount: criterionEvidenceCount(sessions, limitingCriterionId),
    unmeasuredGates:  GATING.filter((g) => !measured[g]),
    sessionCount:     sessions.length,
    daysSinceActive:  lastDate ? Math.floor((now - lastDate) / DAY_MS) : 0,
    prepDone,
    recentDrillEvents,
    globalRegressed:  (tl != null && tp != null && tl > tp),
    // pass-throughs for the UI / masri voice layer (the engine itself stays copy-free)
    level: hr.level, hireReady: hr.hireReady, hireNote: hr.note,
  };
}
