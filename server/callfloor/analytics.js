/**
 * callfloor/analytics.js — Phase 3 deterministic aggregates over call_results (READ-only; the
 * job-competency errors live in error_events via the frozen pipeline, never duplicated here).
 *
 * PURE FUNCTIONS. No I/O, no LLM, no fabrication. Every number is computed in code from stored,
 * evidence-gated call_results, and every metric returns an honest "not enough data" shape when the
 * sample is too thin (feedback-accuracy doctrine). Denominators exclude un-judgeable calls (a
 * `resolved: null` is never counted as a failure). Anti-slop: no bonuses, no streaks, no rarity —
 * only real BPO-floor metrics a supervisor would actually read.
 */

import { QUADRANTS, getScenario } from './scenarios.js';

// null/undefined/'' → null (NOT 0 — Number(null)===0 would fake a score); a real 0 is preserved.
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v, d = 0) => (v == null ? null : Number(v.toFixed(d)));
const overallsOf = (rs) => rs.map((r) => num(r?.meta?.overall)).filter((n) => n != null);

/** The Floor-Score: one honest 0-100 competency read from evidence-backed call overalls. */
export function floorScore(results = []) {
  const os = overallsOf(results);
  return { score: os.length ? Math.round(mean(os)) : null, calls: results.length, scored: os.length };
}

/** Resolved% over ONLY the calls where resolution was actually judgeable (null → excluded). */
export function resolvedPct(results = []) {
  const judged = results.filter((r) => r?.resolved === true || r?.resolved === false);
  if (!judged.length) return null;
  return Math.round((100 * judged.filter((r) => r.resolved === true).length) / judged.length);
}

const enrichCall = (r) => {
  const sc = getScenario(r?.scenarioId);
  return {
    sessionId: r?.sessionId, quadrant: r?.quadrant, scenarioId: r?.scenarioId,
    title_de: sc?.title_de || r?.scenarioId, title_ar: sc?.title_ar || '',
    overall: num(r?.meta?.overall), satisfaction: num(r?.satisfactionFinal), resolved: r?.resolved ?? null,
  };
};

/** A BPO shift report — the real supervisor read of a run of back-to-back calls. */
export function shiftReport(results = []) {
  const callsHandled = results.length;
  if (!callsHandled) return { callsHandled: 0, empty: true };
  const sats = results.map((r) => num(r.satisfactionFinal)).filter((n) => n != null);
  const handles = results.map((r) => num(r.handleSeconds)).filter((n) => n != null);
  const scored = results.filter((r) => num(r?.meta?.overall) != null);
  const byOverall = [...scored].sort((a, b) => a.meta.overall - b.meta.overall);
  return {
    empty: false,
    callsHandled,
    resolvedPct: resolvedPct(results),                       // null when nothing judgeable
    avgSatisfaction: sats.length ? round(mean(sats), 1) : null,
    avgHandleSec: handles.length ? Math.round(mean(handles)) : null,
    totalTalkSec: handles.reduce((a, b) => a + b, 0),
    floorScore: floorScore(results).score,
    bestCall: byOverall.length ? enrichCall(byOverall[byOverall.length - 1]) : null,
    hardestCall: byOverall.length ? enrichCall(byOverall[0]) : null,
  };
}

/** Mean score per rubric skill across a set of calls → strongest & weakest demonstrated skill. */
function skillProfile(results) {
  const sums = {};
  for (const r of results) {
    for (const s of Array.isArray(r?.skills) ? r.skills : []) {
      const sc = num(s?.score);
      if (!s?.key || sc == null) continue;
      (sums[s.key] ||= []).push(sc);
    }
  }
  const avgs = Object.entries(sums).map(([key, xs]) => ({ key, avg: mean(xs), n: xs.length }));
  if (!avgs.length) return { top: null, weak: null };
  avgs.sort((a, b) => b.avg - a.avg);
  return { top: avgs[0], weak: avgs[avgs.length - 1] };
}

/**
 * Quadrant Career Profile — demonstrated skill per seat + which seat is theirs. READS call_results
 * only. A seat needs MIN_SEAT calls before it can be named the best/train-up (slip ≠ signal).
 */
export const MIN_SEAT_CALLS = 2;
export function careerProfile(results = []) {
  const seats = Object.keys(QUADRANTS).map((q) => {
    const rs = results.filter((r) => r.quadrant === q);
    const os = overallsOf(rs);
    const sk = skillProfile(rs);
    return {
      quadrant: q, label_de: QUADRANTS[q].label_de, label_ar: QUADRANTS[q].label_ar,
      skill_de: QUADRANTS[q].skill_de,
      calls: rs.length,
      avgOverall: os.length ? Math.round(mean(os)) : null,
      resolvedPct: resolvedPct(rs),
      topSkill: sk.top?.key || null, weakSkill: sk.weak?.key || null,
      tested: rs.length >= MIN_SEAT_CALLS,                    // honest: below MIN = "noch nicht bewertbar"
    };
  });
  const ranked = seats.filter((s) => s.tested && s.avgOverall != null).sort((a, b) => b.avgOverall - a.avgOverall);
  return {
    seats,
    bestSeat: ranked[0]?.quadrant || null,                   // null → "erst mehr Anrufe nötig"
    trainUp: ranked.length > 1 ? ranked[ranked.length - 1].quadrant : null,
    rejectionStamina: rejectionStamina(results),
  };
}

/**
 * Rejection stamina (outbound sales) — do the scores HOLD across a run of no's, or collapse?
 * A "rejection" = the call ended unresolved OR the customer stayed cold (final mood ≤ 2). We
 * compare performance on calls that FOLLOW a rejection against the seat baseline. Honest gate:
 * needs ≥3 outbound-sales calls AND ≥1 after-rejection call, else measurable:false.
 */
export const STAMINA_MIN_CALLS = 3;
export function rejectionStamina(results = []) {
  const chrono = results.filter((r) => r.quadrant === 'outbound_sales')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (chrono.length < STAMINA_MIN_CALLS) {
    return { measurable: false, reason: 'zu_wenige_outbound_sales_anrufe', calls: chrono.length };
  }
  const isRejection = (r) => r.resolved === false || (num(r.satisfactionFinal) != null && r.satisfactionFinal <= 2);
  const baseOveralls = overallsOf(chrono);
  const baseline = mean(baseOveralls);
  const afterRej = [];
  for (let i = 1; i < chrono.length; i++) {
    if (isRejection(chrono[i - 1])) { const o = num(chrono[i]?.meta?.overall); if (o != null) afterRej.push(o); }
  }
  if (baseline == null || !afterRej.length) {
    return { measurable: false, reason: 'keine_absage_folgeanrufe', calls: chrono.length };
  }
  const afterAvg = mean(afterRej);
  // Hold at baseline → 100; each point dropped after a rejection subtracts one. Clamp 0-100.
  const score = Math.max(0, Math.min(100, Math.round(100 + (afterAvg - baseline))));
  const label = score >= 85 ? 'haelt_dem_druck_stand' : score >= 60 ? 'wackelt_nach_absagen' : 'bricht_nach_absagen_ein';
  return {
    measurable: true, score, label, calls: chrono.length,
    baselineOverall: Math.round(baseline), afterRejectionOverall: Math.round(afterAvg),
    rejectionRuns: afterRej.length,
  };
}

/**
 * Floor-Score delta for one just-finished call: score BEFORE this call vs AFTER (inclusive).
 * `priorResults` excludes the new call; `newResult` is the call just judged.
 */
export function scoreDelta(priorResults = [], newResult = null) {
  const before = floorScore(priorResults).score;
  const after = floorScore(newResult ? [...priorResults, newResult] : priorResults).score;
  return { before, after, delta: (before != null && after != null) ? after - before : null };
}

export default { floorScore, resolvedPct, shiftReport, careerProfile, rejectionStamina, scoreDelta, MIN_SEAT_CALLS, STAMINA_MIN_CALLS };
