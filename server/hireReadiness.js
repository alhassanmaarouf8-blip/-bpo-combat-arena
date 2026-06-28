/**
 * hireReadiness.js — the hire-readiness diagnostic, ported from the auto-research winner
 * (Diagnostic Accuracy 96.9 vs expert labels). Maps a student's measured signals →
 * { level, hireReady, limitingSkill } for a German BPO account.
 *
 * HONEST STATUS: the app currently measures only ~4 of the 9 signals this was calibrated on
 * (wpm, fillers, grammar-errors, a CEFR estimate). intelligibility, subordinate-clause rate,
 * vocab diversity, give-up rate and latency are NOT yet measured. So the verdict here is marked
 * PRELIMINARY (partial), and hireReady is returned as null when the hire-GATING signals
 * (intelligibility / de-escalation) are unmeasured — we do not guess "hireable". Every computed
 * feature vector is logged so the diagnostic can be validated on REAL students later (free).
 *
 * `classify(f)` is byte-for-byte the auto-research winner — do not "improve" it here; improve it in
 * the research loop against the locked scorer, then re-port.
 */
const ORD = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
const clampN = (x) => Math.max(0, Math.min(1, x));
const pos = (x) => (x > 0 ? x : 0);

function levelOf(f) {
  const fluency = clampN(f.wpm / 140);
  const accuracy = clampN(1 - f.errPer100 / 20);
  const range = clampN((f.subClauseRate / 0.6 + f.vocabDiversity / 0.75) / 2);
  const P = 0.30 * fluency + 0.40 * accuracy + 0.30 * range;
  return P < 0.30 ? 'A1' : P < 0.47 ? 'A2' : P < 0.71 ? 'B1' : P < 0.90 ? 'B2' : 'C1';
}
function limitingSkillOf(f) {
  const deficits = {
    fluency:         pos((110 - f.wpm) / 110),
    grammar:         pos((f.errPer100 - 8) / 8),
    intelligibility: pos((0.8 - f.intelligibility) / 0.8),
    confidence:      Math.max(pos((f.fillerPer100 - 10) / 10), pos((f.giveUpRate - 0.2) / 0.2), pos((f.latencyS - 4) / 4)),
    deescalation:    pos((0.6 - f.deescalation) / 0.6),
    complexity:      Math.max(pos((0.2 - f.subClauseRate) / 0.2), pos((0.45 - f.vocabDiversity) / 0.45)),
  };
  const importance = { intelligibility: 1.30, fluency: 1.15, deescalation: 1.05, grammar: 1.05, complexity: 1.0, confidence: 0.85 };
  let best = 'none', bestV = 0.05;
  for (const [k, v] of Object.entries(deficits)) { const w = v * (importance[k] || 1); if (v > 0.05 && w > bestV) { bestV = w; best = k; } }
  return best;
}
/** The auto-research winner — verbatim. */
export function classify(f) {
  const level = levelOf(f);
  const hireReady = ORD[level] >= 3 && f.intelligibility >= 0.7 && f.deescalation >= 0.5 && f.giveUpRate <= 0.3 && f.wpm >= 90;
  return { level, hireReady, limitingSkill: limitingSkillOf(f) };
}

// Clear German subordinators (ambiguous ones like da/wie/wo/als omitted to cut false positives).
const SUBORD = /\b(weil|dass|daß|obwohl|obgleich|damit|sodass|so dass|bevor|nachdem|falls|indem|sobald|seitdem|während|wenn|ob|sofern|solange|sooft)\b/gi;
/** Deterministic, FREE text features from the candidate's transcript: subordinate-clause rate
 *  (range/complexity) and vocab diversity (type-token ratio). null when too little text to judge. */
export function textFeatures(text) {
  const t = String(text || '').trim();
  const words = t.toLowerCase().replace(/[^a-zäöüß\s]/g, ' ').split(/\s+/).filter(Boolean);
  const total = words.length;
  if (total < 20) return { wordCount: total, subClauseRate: null, vocabDiversity: null };
  const sentences = Math.max(1, (t.match(/[.!?]+/g) || []).length);
  const subClauseRate = Math.min(1, (t.match(SUBORD) || []).length / sentences);
  const vocabDiversity = Math.max(0.2, Math.min(0.8, new Set(words).size / total));
  return { wordCount: total, subClauseRate, vocabDiversity };
}

/** Map the app's available session/profile signals → feature vector + provenance (which are real). */
export function featuresFromProfile(p) {
  const s = (p?.sessions || []).slice(-1)[0] || {};
  const grammarCount = Array.isArray(s.grammarRules) ? s.grammarRules.reduce((a, r) => a + (r.count || 0), 0) : null;
  const measured = {
    wpm: typeof s.wpm === 'number' && s.wpm > 0,
    fillerPer100: typeof s.fillers === 'number',
    errPer100: grammarCount != null,
    subClauseRate: typeof s.subClauseRate === 'number',   // now computed from transcript at session end
    vocabDiversity: typeof s.vocabDiversity === 'number', // now computed from transcript at session end
    intelligibility: false, deescalation: false, giveUpRate: false, latencyS: false,
  };
  const f = {
    wpm:             measured.wpm ? s.wpm : 100,
    fillerPer100:    measured.fillerPer100 ? s.fillers : 6,
    errPer100:       measured.errPer100 ? Math.min(20, grammarCount) : 6,  // rough proxy (no per-100 normalization yet)
    subClauseRate:   measured.subClauseRate ? s.subClauseRate : 0.3,
    vocabDiversity:  measured.vocabDiversity ? s.vocabDiversity : 0.5,
    intelligibility: 0.8,  // NOT measured — neutral assumption (flagged)
    deescalation:    0.6,  // NOT measured
    giveUpRate:      0.15, // NOT measured
    latencyS:        3,    // NOT measured
  };
  return { f, measured };
}

/** Preliminary, honest hire-readiness for a profile. Prefers the app's existing CEFR estimate for
 *  level; returns hireReady=null when the hire-gating signals are unmeasured (no guessing). */
export function hireReadinessFor(p) {
  const { f, measured } = featuresFromProfile(p);
  const raw = classify(f);
  const measuredCount = Object.values(measured).filter(Boolean).length;
  const missing = Object.entries(measured).filter(([, v]) => !v).map(([k]) => k);
  const gatingMeasured = measured.intelligibility && measured.deescalation && measured.wpm;
  const out = {
    level: p?.assessmentResult?.estimatedLevel || raw.level,   // prefer the real CEFR estimate
    hireReady: gatingMeasured ? raw.hireReady : null,          // honest: unknown until gating signals exist
    limitingSkill: raw.limitingSkill,
    partial: measuredCount < 9,
    measuredSignals: measuredCount,
    totalSignals: 9,
    note: measuredCount < 9
      ? `preliminary — ${measuredCount}/9 signals measured; not yet measured: ${missing.join(', ')}`
      : 'full',
  };
  return out;
}

export default { classify, featuresFromProfile, hireReadinessFor };
