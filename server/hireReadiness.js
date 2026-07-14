/**
 * hireReadiness.js — the hire-readiness diagnostic. Maps a student's measured signals →
 * measured simulation evidence for a German BPO account. It never predicts an employer decision:
 * there is no outcome-linked validation set for this app yet, so `hireReady` remains null.
 *
 * HONEST STATUS: the available signals vary by session. A missing signal stays explicitly
 * unmeasured and can never be substituted with a favorable default. The internal classifier below
 * protects authored simulation boundaries only; it is not trained or validated on hiring outcomes.
 * Real consented outcomes must be evaluated separately before any employment-probability claim.
 */
import { SERVICE_RECOVERY_CRITERION_ID, serviceRecoveryScoreFromSession } from './scoring/serviceRecoveryEvidence.js';

const ORD = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
const INDUSTRIES = new Set(['telecom', 'ecommerce', 'fintech', 'airline', 'delivery', 'logistik',
  'energie', 'versicherung', 'streaming', 'b2b']);
const ROLE_TYPES = new Set(['customer_service', 'technical_support', 'sales', 'retention', 'backoffice']);
const BOSS_ARCHETYPES = Object.freeze({
  yasmin: 'coach', karim: 'facts_first', hana: 'skeptical_qa', tarek: 'kpi_pressure',
  'frau-mona-adel': 'formal_gatekeeper', lukas: 'self_sufficiency',
});
const clampN = (x) => Math.max(0, Math.min(1, x));
const pos = (x) => (x > 0 ? x : 0);

function levelOf(f) {
  const fluency = clampN(f.wpm / 140);
  const accuracy = clampN(1 - f.errPer100 / 20);
  const range = clampN((f.subClauseRate / 0.6 + f.vocabDiversity / 0.75) / 2);
  const P = 0.30 * fluency + 0.40 * accuracy + 0.30 * range;
  return P < 0.30 ? 'A1' : P < 0.47 ? 'A2' : P < 0.71 ? 'B1' : P < 0.90 ? 'B2' : 'C1';
}
function limitingSkillOf(f, measured = null) {
  const available = (key) => !measured || measured[key] === true;
  const deficits = {
    fluency: available('wpm') ? pos((110 - f.wpm) / 110) : null,
    grammar: available('errPer100') ? pos((f.errPer100 - 8) / 8) : null,
    intelligibility: available('intelligibility') ? pos((0.8 - f.intelligibility) / 0.8) : null,
    confidence: ['fillerPer100', 'giveUpRate', 'latencyS'].some(available)
      ? Math.max(available('fillerPer100') ? pos((f.fillerPer100 - 10) / 10) : 0,
        available('giveUpRate') ? pos((f.giveUpRate - 0.2) / 0.2) : 0,
        available('latencyS') ? pos((f.latencyS - 4) / 4) : 0) : null,
    deescalation: available('deescalation') ? pos((0.6 - f.deescalation) / 0.6) : null,
    complexity: available('subClauseRate') && available('vocabDiversity')
      ? Math.max(pos((0.2 - f.subClauseRate) / 0.2), pos((0.45 - f.vocabDiversity) / 0.45)) : null,
  };
  const importance = { intelligibility: 1.30, fluency: 1.15, deescalation: 1.05, grammar: 1.05, complexity: 1.0, confidence: 0.85 };
  let best = 'none', bestV = 0.05;
  for (const [k, v] of Object.entries(deficits)) {
    if (!Number.isFinite(v)) continue;
    const w = v * (importance[k] || 1); if (v > 0.05 && w > bestV) { bestV = w; best = k; }
  }
  return best;
}
/** Locked internal simulation-boundary classifier. Not an employer-decision model. */
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
  const s = [...(Array.isArray(p?.sessions) ? p.sessions : [])].reverse().find((session) => (
    session?.evidenceQuality?.version === 1 && session.evidenceQuality.prescriptionEligible === true
  )) || {};
  const wordCount = Math.max(0, Number(s?.evidenceQuality?.words) || Number(s.words) || 0);
  const grammarCount = s.grammarMeasured === true && Array.isArray(s.grammarRules)
    ? s.grammarRules.reduce((a, r) => a + Math.max(0, Number(r?.count) || 0), 0) : null;
  const serviceRecoveryScore = serviceRecoveryScoreFromSession(s);
  const measured = {
    wpm: typeof s.wpm === 'number' && s.wpm > 0,
    fillerPer100: typeof s.fillers === 'number' && wordCount >= 80,
    errPer100: grammarCount != null && wordCount >= 80,
    subClauseRate: typeof s.subClauseRate === 'number',   // computed from transcript at session end
    vocabDiversity: typeof s.vocabDiversity === 'number', // computed from transcript at session end
    deescalation: serviceRecoveryScore != null, // 3-step service-recovery structure in stage 3
    giveUpRate: typeof s.giveUpRate === 'number',         // empty/near-silent turn share
    intelligibility: typeof s.intelligibility === 'number', // avg STT word-confidence proxy
    latencyS: typeof s.latencyS === 'number',             // avg reaction latency (s)
  };
  const f = {
    wpm:             measured.wpm ? s.wpm : 100,
    fillerPer100:    measured.fillerPer100 ? Math.min(100, (Math.max(0, s.fillers) / wordCount) * 100) : 6,
    errPer100:       measured.errPer100 ? Math.min(100, (grammarCount / wordCount) * 100) : 6,
    subClauseRate:   measured.subClauseRate ? s.subClauseRate : 0.3,
    vocabDiversity:  measured.vocabDiversity ? s.vocabDiversity : 0.5,
    deescalation:    measured.deescalation ? serviceRecoveryScore : 0.6,
    giveUpRate:      measured.giveUpRate ? s.giveUpRate : 0.15,
    intelligibility: measured.intelligibility ? s.intelligibility : 0.8,
    latencyS:        measured.latencyS ? s.latencyS : 3,
  };
  return { f, measured, evidenceQuality: s.evidenceQuality || null, session: s, wordCount };
}

function safeSessionTarget(session) {
  const industryKey = INDUSTRIES.has(session?.targetIndustry) ? session.targetIndustry : 'general';
  const roleType = ROLE_TYPES.has(session?.targetRoleType) ? session.targetRoleType : 'customer_service';
  const scenarioId = typeof session?.scenarioId === 'string' && /^[a-z0-9_-]{1,80}$/u.test(session.scenarioId)
    ? session.scenarioId : null;
  return {
    roleType,
    industryKey,
    bossArchetype: BOSS_ARCHETYPES[session?.bossId] || 'professional_interviewer',
    scenarioId,
    source: session?.vacancyTargetId ? 'vacancy_snapshot' : industryKey !== 'general' ? 'industry_snapshot' : 'generic_simulation',
  };
}

function confidenceForEvidence(evidenceQuality) {
  return evidenceQuality?.highConfidence === true ? 'high'
    : evidenceQuality?.prescriptionEligible === true ? 'medium' : 'insufficient';
}

function riskCriterion(skill, f, measured, target = null) {
  if (skill === 'fluency') return { stageId: 'spoken_interview', criterionId: 'sustained_pace',
    observed: Math.round(f.wpm), reference: 90, direction: 'at_least', unit: 'wpm' };
  if (skill === 'grammar') return { stageId: 'spoken_interview', criterionId: 'grammar_control',
    observed: Math.round(f.errPer100 * 10) / 10, reference: 8, direction: 'at_most', unit: 'errors_per_100_words' };
  if (skill === 'intelligibility') return { stageId: 'phone_roleplay', criterionId: 'speech_recognition_proxy',
    observed: Math.round(f.intelligibility * 100), reference: 80, direction: 'at_least', unit: 'percent' };
  if (skill === 'deescalation') return {
    stageId: target?.roleType === 'retention' ? 'retention_roleplay' : 'customer_roleplay',
    criterionId: SERVICE_RECOVERY_CRITERION_ID,
    targetRoleType: target?.roleType === 'retention' ? 'retention' : 'customer_service',
    ...(target?.scenarioId ? { scenarioId: target.scenarioId } : {}),
    observed: Math.round(f.deescalation * 3), reference: 2, direction: 'at_least', unit: 'recovery_steps_out_of_3',
  };
  if (skill === 'confidence') {
    const candidates = [
      measured.giveUpRate && { severity: Math.max(0, (f.giveUpRate - 0.2) / 0.2), stageId: 'pressure_followup', criterionId: 'complete_response',
        observed: Math.round(f.giveUpRate * 100), reference: 20, direction: 'at_most', unit: 'percent_incomplete_turns' },
      measured.latencyS && { severity: Math.max(0, (f.latencyS - 4) / 4), stageId: 'pressure_followup', criterionId: 'response_latency',
        observed: Math.round(f.latencyS * 10) / 10, reference: 4, direction: 'at_most', unit: 'seconds' },
      measured.fillerPer100 && { severity: Math.max(0, (f.fillerPer100 - 10) / 10), stageId: 'spoken_interview', criterionId: 'filler_dependence',
        observed: Math.round(f.fillerPer100 * 10) / 10, reference: 10, direction: 'at_most', unit: 'fillers_per_100_words' },
    ].filter(Boolean).sort((a, b) => b.severity - a.severity);
    if (!candidates.length) return null;
    const { severity: _severity, ...criterion } = candidates[0];
    return criterion;
  }
  if (skill === 'complexity') {
    return f.subClauseRate < 0.2
      ? { stageId: 'behavioral_interview', criterionId: 'connected_answer_structure', observed: Math.round(f.subClauseRate * 100),
        reference: 20, direction: 'at_least', unit: 'subordinate_clauses_per_100_sentences' }
      : { stageId: 'behavioral_interview', criterionId: 'lexical_range_proxy', observed: Math.round(f.vocabDiversity * 100),
        reference: 45, direction: 'at_least', unit: 'type_token_percent' };
  }
  return null;
}

function rejectionForecast({ session, evidenceQuality, limitingSkill, f, measured }) {
  const target = safeSessionTarget(session);
  const confidence = confidenceForEvidence(evidenceQuality);
  if (confidence === 'insufficient') return { state: 'measure_first', confidence, target, riskId: null, criterion: null };
  const criterion = limitingSkill ? riskCriterion(limitingSkill, f, measured, target) : null;
  return criterion
    ? { state: 'observed_simulation_risk', confidence, target, riskId: limitingSkill, criterion,
      calibration: 'internal_simulation_reference_only' }
    : { state: 'no_single_risk_observed', confidence, target, riskId: null, criterion: null,
      calibration: 'internal_simulation_reference_only' };
}

/** Preliminary simulation diagnostic. Prefers the app's existing CEFR estimate for level and keeps
 *  employer-level hire readiness unknown until real outcome-linked validation exists. */
export function hireReadinessFor(p) {
  const { f, measured, evidenceQuality, session } = featuresFromProfile(p);
  const raw = classify(f);
  const measuredCount = Object.values(measured).filter(Boolean).length;
  const missing = Object.entries(measured).filter(([, v]) => !v).map(([k]) => k);
  // These gates can describe performance inside this simulation. They cannot establish that a real
  // employer would hire the learner until outcome-linked validation exists.
  const gatingFull = measured.intelligibility && measured.deescalation && measured.wpm;
  const simulationReady = evidenceQuality?.highConfidence === true && gatingFull && measuredCount === 9
    ? raw.hireReady : null;
  const hireReady = null;
  const limitingSkill = evidenceQuality ? limitingSkillOf(f, measured) : null;
  const interviewRisk = !evidenceQuality
    ? { state: 'measure_first', confidence: 'insufficient', limitingSkill: null }
    : limitingSkill
      ? { state: 'observed_risk', confidence: evidenceQuality.highConfidence === true ? 'high' : 'medium', limitingSkill }
      : { state: 'no_single_risk_observed', confidence: evidenceQuality.highConfidence === true ? 'high' : 'medium', limitingSkill: null };
  const forecast = rejectionForecast({ session, evidenceQuality, limitingSkill, f, measured });
  const out = {
    level: p?.assessmentResult?.estimatedLevel || raw.level,   // prefer the real CEFR estimate
    hireReady,
    simulationReady,
    outcomeCalibration: 'not_yet_validated_against_real_hiring_outcomes',
    limitingSkill,
    interviewRisk,
    rejectionForecast: forecast,
    partial: measuredCount < 9,
    measuredSignals: measuredCount,
    totalSignals: 9,
    note: !evidenceQuality
      ? 'measure first — no reliable multi-turn interview packet is available'
      : measuredCount < 9
      ? `preliminary — ${measuredCount}/9 signals measured; not yet measured: ${missing.join(', ')}`
      : 'full (intelligibility = STT word-confidence proxy; service recovery = 3 observable response steps)',
  };
  return out;
}

export default { classify, featuresFromProfile, hireReadinessFor };
