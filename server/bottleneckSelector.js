/**
 * bottleneckSelector.js — Phase 3: the deliberate ONE-bottleneck choice (owner spec 2026-07-20).
 *
 * After each analyzed MAIN interview, look at everything diagnosed and choose exactly ONE primary
 * bottleneck — the single issue that, if fixed, most improves the next interview. Named,
 * evidence-backed (the learner's own sentences), with runner-ups and a stored WHY.
 *
 * Pure + deterministic: every function here is a function of its inputs (error events, prior
 * records, level). No LLM, no clock reads except the timestamps callers pass in. The score:
 *
 *   score = frequencyToday × avgSeverity × avgImpact × persistenceMultiplier ÷ masteryDampener
 *
 *   persistence: same subcode in prior interviews matters more (1 + 0.5/prior session, cap ×3).
 *   dampener: a recently-closed file (×2, 14 days) or a drilled-and-visibly-improving code (×1.5)
 *   must not be re-picked while healing.
 *   Tie-break: level-appropriate (fixable NOW) beats far-above-level, then higher impact tier.
 *
 * This module is the PRIMARY chooser for the AKTE line when a record exists; brain/problemRank
 * stays the fallback — one effective chooser at runtime, never a third competing brain
 * (audit 07-20: "three competing one-things" is the disease, not a feature).
 */

import { CATEGORIES } from './scoring/errorTaxonomy.js';

export const CLOSE_MAX_OCCURRENCES = 1;   // "Akte geschlossen": ≤1 occurrence …
export const CLOSE_MAX_SEVERITY    = 3;   // … and no high-severity (≥4) instance
export const CLOSED_DAMPENER_DAYS  = 14;
export const RECORD_CAP            = 120;
const LOW_CONFIDENCE_MIN_ANSWERS   = 3;
const LOW_CONFIDENCE_MIN_EVENTS    = 2;

// Which categories are realistically fixable AT the learner's current level (tie-breaker only —
// a far-above-level issue can still win on raw score, but never on a tie).
const LEVEL_ORDER = { 'a2-b1': 0, b2: 1, c1: 2 };
const CATEGORY_MIN_LEVEL = {
  WORTSCHATZ_PRAEZISION: 1, REGISTER_FORMALITAET: 1, KOHAERENZ: 1, AUSSPRACHE: 0,
  // everything else (core grammar, fillers, structure, fluency) is level-appropriate from A2.
};
export function levelFit(category, level) {
  const need = CATEGORY_MIN_LEVEL[category] ?? 0;
  return (LEVEL_ORDER[level] ?? 1) >= need;
}

// Impact tiers aligned with brain/problemRank.js doctrine: global breakers > register/case > polish.
const TIER_BY_CATEGORY = {
  VERB_POSITION: 3, WORTSTELLUNG: 3, SATZBAU_NEBENSATZ: 3, VERB_KONJUGATION: 3, TEMPUS: 3,
  KASUS: 2, PRAEPOSITION: 2, ARTIKEL_GENUS: 2, REGISTER_FORMALITAET: 2, ANTWORT_STRUKTUR: 2,
};
const tierOf = (category) => TIER_BY_CATEGORY[category] ?? 1;

// Live finding (acceptance runs 9a96e030/dea58862): the analyzer names the SAME underlying wall
// slightly differently across days — "Gestern ich habe…" was VERB_POSITION one run and
// WORTSTELLUNG the next. Repeat detection and file-closing therefore work at CATEGORY level,
// with the verb-placement trio as one equivalence family: a file must not close while a sibling
// name of the same problem is still failing, and a re-pick under a sibling name IS a repeat.
const PLACEMENT_FAMILY = new Set(['VERB_POSITION', 'WORTSTELLUNG', 'SATZBAU_NEBENSATZ']);
export function sameProblemFamily(catA, catB) {
  if (!catA || !catB) return false;
  if (catA === catB) return true;
  return PLACEMENT_FAMILY.has(catA) && PLACEMENT_FAMILY.has(catB);
}

const r2 = (n) => Math.round(n * 100) / 100;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Group events by code → { code, category, subcode, events[] }. */
function byCode(events) {
  const map = new Map();
  for (const e of events || []) {
    if (!e?.code) continue;
    if (!map.has(e.code)) map.set(e.code, { code: e.code, category: e.category, subcode: e.subcode, events: [] });
    map.get(e.code).events.push(e);
  }
  return map;
}

/** Distinct prior sessions (excluding today's) in which a code appeared. */
function priorSessionsWith(code, historyEvents, todaySessionId) {
  const s = new Set();
  for (const e of historyEvents || []) {
    if (e.code === code && e.sessionId && e.sessionId !== todaySessionId) s.add(e.sessionId);
  }
  return s.size;
}

export function persistenceMultiplier(priorSessions) {
  return Math.min(3, 1 + 0.5 * Math.min(4, priorSessions));
}

/**
 * masteryDampener(code, priorRecords, todayFreq, now): don't keep picking a healing wound.
 *   ×2   — this code's file was CLOSED within CLOSED_DAMPENER_DAYS
 *   ×1.5 — previously selected + at least drilled, and today's frequency dropped ≥50% vs selection day
 */
export function masteryDampener(code, priorRecords, todayFreq, now) {
  let d = 1;
  for (const rec of priorRecords || []) {
    if (rec.code !== code) continue;
    if (rec.status === 'closed' && Number.isFinite(rec.closedAt)
      && now - rec.closedAt <= CLOSED_DAMPENER_DAYS * 24 * 60 * 60 * 1000) d = Math.max(d, 2);
    if ((rec.status === 'drilled' || rec.status === 'retested')
      && Number.isFinite(rec.frequencyToday) && rec.frequencyToday > 0
      && todayFreq <= rec.frequencyToday / 2) d = Math.max(d, 1.5);
  }
  return d;
}

/** Score every candidate code from today's events (plus, on thin days, persistent history codes). */
export function scoreCandidates({ todayEvents = [], historyEvents = [], priorRecords = [],
  level = 'b2', sessionId, now = 0, lowConfidence = false }) {
  const today = byCode(todayEvents);
  const candidates = [];

  for (const [code, g] of today) {
    const prior = priorSessionsWith(code, historyEvents, sessionId);
    const freq = g.events.length;
    const sev = mean(g.events.map((e) => e.severity || 1));
    const imp = mean(g.events.map((e) => e.impact || 1));
    const pers = persistenceMultiplier(prior);
    const damp = masteryDampener(code, priorRecords, freq, now);
    candidates.push({
      code, category: g.category, subcode: g.subcode,
      frequencyToday: freq, avgSeverity: r2(sev), avgImpact: r2(imp),
      priorSessions: prior, persistence: pers, dampener: damp,
      levelFit: levelFit(g.category, level), tier: tierOf(g.category),
      score: r2((freq * sev * imp * pers) / damp),
      quotes: g.events.slice(0, 3).map((e) => ({ quote: e.quote, corrected: e.corrected })),
      source: 'today',
    });
  }

  // Thin sample → today's noise must not outvote the learner's known walls: add persistent
  // history codes (≥2 prior sessions) at a 0.8 discount, using their historical stats.
  if (lowConfidence) {
    const hist = byCode((historyEvents || []).filter((e) => e.sessionId !== sessionId));
    for (const [code, g] of hist) {
      if (today.has(code)) continue;
      const prior = priorSessionsWith(code, historyEvents, sessionId);
      if (prior < 2) continue;
      const perSession = g.events.length / prior;
      const sev = mean(g.events.map((e) => e.severity || 1));
      const imp = mean(g.events.map((e) => e.impact || 1));
      const damp = masteryDampener(code, priorRecords, 0, now);
      candidates.push({
        code, category: g.category, subcode: g.subcode,
        frequencyToday: 0, avgSeverity: r2(sev), avgImpact: r2(imp),
        priorSessions: prior, persistence: persistenceMultiplier(prior), dampener: damp,
        levelFit: levelFit(g.category, level), tier: tierOf(g.category),
        score: r2((0.8 * perSession * sev * imp * persistenceMultiplier(prior)) / damp),
        quotes: g.events.slice(-3).map((e) => ({ quote: e.quote, corrected: e.corrected })),
        source: 'history',
      });
    }
  }

  return candidates.sort((a, b) =>
    (b.score - a.score)
    || (b.levelFit - a.levelFit)          // tie: fixable at the current level wins
    || (b.tier - a.tier)                  // then the bigger comprehension breaker
    || (b.frequencyToday - a.frequencyToday)
    || (a.code < b.code ? -1 : 1));       // stable
}

// ── Near-perfect fallback: there is ALWAYS a #1 lever — never "nothing to train" ──────────────
export function polishFallback({ aggregates = {}, metrics = {}, answers = [] }) {
  const quotes = answers.filter((a) => (a.original || '').split(/\s+/).length >= 6)
    .slice(0, 2).map((a) => ({ quote: a.original, corrected: null }));
  if ((aggregates.fillerCount ?? metrics.fillers ?? 0) >= 3) {
    return { code: 'FUELLWOERTER/fuellwoerter_durch_pausen_ersetzen', category: 'FUELLWOERTER',
      subcode: 'fuellwoerter_durch_pausen_ersetzen', quotes, fallback: true };
  }
  if (Number.isFinite(metrics.wpm) && metrics.wpm > 0 && metrics.wpm < 110) {
    return { code: 'FLUESSIGKEIT/sprechtempo_aufbauen', category: 'FLUESSIGKEIT',
      subcode: 'sprechtempo_aufbauen', quotes, fallback: true };
  }
  return { code: 'ANTWORT_STRUKTUR/star_mit_ergebnis_abschliessen', category: 'ANTWORT_STRUKTUR',
    subcode: 'star_mit_ergebnis_abschliessen', quotes, fallback: true };
}

// ── WHY the winner won — honest numbers, learner-facing German (owner-AR stays a slot) ────────
export function buildWhy(selected, runnerUps) {
  const label = CATEGORIES[selected.category]?.de || selected.category;
  const base = selected.fallback
    ? `Keine gravierenden Fehler in diesem Interview — der größte Hebel ist jetzt Feinschliff: ${label}.`
    : `${label}: ${selected.frequencyToday}× in diesem Interview, Schweregrad Ø ${selected.avgSeverity}, ` +
      `Verständlichkeit Ø ${selected.avgImpact}` +
      (selected.priorSessions > 0 ? `, wiederholt in ${selected.priorSessions} früheren Interviews` : '') + '.';
  // When runner-ups share a category, the label alone reads as a duplicate ("Wortstellung (6)
  // und Wortstellung (6)" — live run dea58862 sibling): disambiguate with the subcode.
  const tops = (runnerUps || []).slice(0, 2);
  const dupCat = tops.length === 2 && tops[0].category === tops[1].category;
  const vs = tops.map((r) => {
    const lbl = CATEGORIES[r.category]?.de || r.category;
    return `${dupCat ? `${lbl} – ${String(r.subcode || '').replace(/_/g, ' ')}` : lbl} (${r.score})`;
  }).join(' und ');
  return vs ? `${base} Gewählt vor ${vs}${selected.fallback ? '' : ` — Score ${selected.score}`}.` : base;
}

// ── Status updates for PRIOR records, evaluated against TODAY's evidence ──────────────────────
// "Die Akte bleibt offen … wird erneut geprüft": a later interview closes the file only when the
// error rate dropped below the threshold (≤1 occurrence, none severity ≥4) — but ONE clean day is
// not mastery (E2E verification 07-20: a learner who simply avoided subordinate clauses for a day
// closed their verb-position file untreated — mastery by avoidance). Closure now needs the loop
// to have run (drilled/retested + 1 clean interview) OR 2 CONSECUTIVE clean interviews. A drilled
// file re-examined without closing becomes 'retested'.
export function updatePriorStatuses(records, todayEvents, { sessionId, now = 0 } = {}) {
  for (const rec of records || []) {
    if (rec.status === 'closed') continue;
    // Closure counts every event in the record's problem FAMILY — an exact-subcode count let a
    // file close while the same wall was still failing under a sibling name (live run dea58862).
    // Category derives from the code for records that predate the category field.
    const recCategory = rec.category || String(rec.code || '').split('/')[0];
    const familyEvents = (todayEvents || []).filter((e) => sameProblemFamily(e.category, recCategory));
    const occurrences = familyEvents.length;
    const worst = familyEvents.length ? Math.max(...familyEvents.map((e) => e.severity || 1)) : 0;
    const cleanToday = occurrences <= CLOSE_MAX_OCCURRENCES && worst < 4;
    rec.cleanStreak = cleanToday ? (rec.cleanStreak || 0) + 1 : 0;
    const loopRan = rec.status === 'drilled' || rec.status === 'retested';
    if (cleanToday && (rec.cleanStreak >= 2 || (loopRan && rec.cleanStreak >= 1))) {
      rec.status = 'closed';
      rec.closedAt = now;
      rec.closedBySessionId = sessionId;
    } else if (rec.status === 'drilled') {
      rec.status = 'retested';
      rec.retestedAt = now;
    }
  }
  return records;
}

/**
 * selectBottleneck — the full per-interview decision. Returns the new record (not yet persisted).
 * `records` must ALREADY be status-updated for today (updatePriorStatuses) by the caller.
 */
export function selectBottleneck({ todayEvents = [], historyEvents = [], records = [],
  level = 'b2', sessionId, cairoDay, now = 0, answersAnalyzed = 0, wordsSpoken = 0,
  aggregates = {}, metrics = {}, answers = [] }) {
  const lowConfidence = answersAnalyzed < LOW_CONFIDENCE_MIN_ANSWERS
    || (todayEvents.length < LOW_CONFIDENCE_MIN_EVENTS && wordsSpoken < 60);

  const scored = scoreCandidates({ todayEvents, historyEvents, priorRecords: records,
    level, sessionId, now, lowConfidence });

  let selected = scored[0] || null;
  let runnerUps = scored.slice(1, 4).map((c) => ({ code: c.code, category: c.category,
    subcode: c.subcode, score: c.score, frequencyToday: c.frequencyToday }));
  if (!selected) {
    selected = { ...polishFallback({ aggregates, metrics, answers }),
      frequencyToday: 0, avgSeverity: 0, avgImpact: 0, priorSessions: 0,
      persistence: 1, dampener: 1, score: 0, levelFit: true, tier: 1, source: 'fallback' };
    runnerUps = [];
  }

  // Repeat-day: the same problem may win again, but it must be FLAGGED so Phase 4 generates
  // completely different exercises (exerciseHistory travels with the record for that call).
  // Family-level match: a re-pick under a sibling name of the same wall is still a repeat.
  const prev = (records || []).filter((r) => r.status !== 'superseded').at(-1) || null;
  const repeat = !!(prev && prev.status !== 'closed' && sameProblemFamily(prev.category, selected.category));
  const dayStreak = repeat
    ? (prev.dayStreak || 1) + (prev.cairoDay && cairoDay && prev.cairoDay !== cairoDay ? 1 : 0)
    : 1;

  return {
    v: 1,
    sessionId, cairoDay, at: now,
    code: selected.code, category: selected.category, subcode: selected.subcode,
    score: selected.score,
    frequencyToday: selected.frequencyToday,
    avgSeverity: selected.avgSeverity, avgImpact: selected.avgImpact,
    priorSessions: selected.priorSessions, persistence: selected.persistence,
    dampener: selected.dampener, levelFit: selected.levelFit,
    evidenceQuotes: (selected.quotes || []).filter((q) => q.quote),
    runnerUps,
    why: buildWhy(selected, runnerUps),
    status: 'open',
    repeat, dayStreak,
    lowConfidence, fallback: !!selected.fallback,
    source: selected.source || 'today',
    exerciseHistory: repeat && prev ? (prev.exerciseHistory || []) : [],   // Phase 4 appends here
  };
}

export default { scoreCandidates, selectBottleneck, updatePriorStatuses, polishFallback,
  buildWhy, persistenceMultiplier, masteryDampener, levelFit };
