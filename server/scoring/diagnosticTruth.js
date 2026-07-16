/**
 * diagnosticTruth.js — the boundary between an observed interview pattern and its cause.
 *
 * The app can measure pace, latency, grammar, response completion, recognition confidence and
 * roleplay structure. It cannot infer psychology, motivation, anxiety, or the reason behind a
 * pattern from those measurements alone. This module makes that distinction explicit and returns
 * only bounded enum IDs plus already-public numeric observations. No transcript, audio, employer
 * text, session identity, or free-form model output can enter this packet.
 */

const CRITERIA = new Set([
  'sustained_pace',
  'grammar_control',
  'speech_recognition_proxy',
  'service_recovery_structure',
  'complete_response',
  'response_latency',
  'filler_dependence',
  'connected_answer_structure',
  'lexical_range_proxy',
]);

const MEASUREMENTS = new Set([
  'wpm', 'fillerPer100', 'errPer100', 'subClauseRate', 'vocabDiversity',
  'deescalation', 'giveUpRate', 'intelligibility', 'latencyS',
]);

const GRAMMAR_RULES = new Set(['konjunktiv-2', 'dativ-akkusativ', 'word-order-sub']);

const EXPLANATIONS = Object.freeze({
  sustained_pace: Object.freeze([
    'lexical_retrieval_load',
    'sentence_planning_load',
    'question_comprehension_load',
    'deliberate_speaking_style',
  ]),
  grammar_control: Object.freeze([
    'rule_not_automatic_under_pressure',
    'sentence_complexity_load',
    'self_correction_during_speech',
  ]),
  speech_recognition_proxy: Object.freeze([
    'microphone_or_background_noise',
    'speech_recognizer_accent_mismatch',
    'pronunciation_or_articulation',
  ]),
  service_recovery_structure: Object.freeze([
    'response_structure_not_automatic',
    'scenario_knowledge_gap',
    'language_load_during_roleplay',
  ]),
  complete_response: Object.freeze([
    'question_comprehension_load',
    'lexical_retrieval_load',
    'sentence_planning_load',
    'turn_capture_or_interruption',
  ]),
  response_latency: Object.freeze([
    'question_comprehension_load',
    'lexical_retrieval_load',
    'response_planning_load',
    'deliberate_thinking_time',
  ]),
  filler_dependence: Object.freeze([
    'lexical_retrieval_load',
    'response_planning_load',
    'habitual_filler_use',
  ]),
  connected_answer_structure: Object.freeze([
    'sentence_planning_load',
    'grammar_automaticity_gap',
    'task_answer_style',
  ]),
  lexical_range_proxy: Object.freeze([
    'topic_vocabulary_gap',
    'retrieval_under_pressure',
    'short_answer_style',
  ]),
});

const DISCRIMINATORS = Object.freeze({
  sustained_pace: 'compare_prepared_and_novel_pace',
  grammar_control: 'compare_controlled_rule_and_novel_speech',
  speech_recognition_proxy: 'repeat_same_answer_with_clean_audio',
  service_recovery_structure: 'compare_prompted_and_unprompted_roleplay',
  complete_response: 'restate_question_then_answer_novel_followup',
  response_latency: 'compare_understood_and_novel_question_latency',
  filler_dependence: 'compare_prepared_and_novel_filler_rate',
  connected_answer_structure: 'compare_guided_and_unguided_answer_structure',
  lexical_range_proxy: 'compare_familiar_and_novel_topic_range',
});

function safeCount(value) {
  return Math.max(0, Math.min(20, Math.floor(Number(value) || 0)));
}

function safeObservedFact(criterion) {
  if (!criterion || typeof criterion !== 'object' || Array.isArray(criterion)
    || !CRITERIA.has(criterion.criterionId)) return null;
  const observed = Number(criterion.observed);
  const reference = Number(criterion.reference);
  const direction = criterion.direction;
  if (!Number.isFinite(observed) || !Number.isFinite(reference)
    || !['at_least', 'at_most'].includes(direction)) return null;
  const stageId = typeof criterion.stageId === 'string'
    && /^[a-z0-9_-]{1,40}$/u.test(criterion.stageId) ? criterion.stageId : null;
  const unit = typeof criterion.unit === 'string'
    && /^[a-z0-9_-]{1,50}$/u.test(criterion.unit) ? criterion.unit : null;
  if (!stageId || !unit) return null;
  return Object.freeze({
    criterionId: criterion.criterionId,
    stageId,
    observed,
    reference,
    direction,
    unit,
  });
}

function missingMeasurements(measured) {
  if (!measured || typeof measured !== 'object' || Array.isArray(measured)) return Object.freeze([...MEASUREMENTS]);
  return Object.freeze([...MEASUREMENTS].filter((key) => measured[key] !== true));
}

function safeGrammarRule(grammarRule) {
  if (!grammarRule || typeof grammarRule !== 'object' || Array.isArray(grammarRule)
    || !GRAMMAR_RULES.has(grammarRule.ruleId)) return null;
  const supportCount = safeCount(grammarRule.supportCount);
  const conflictCount = safeCount(grammarRule.conflictCount);
  return supportCount >= 2 && conflictCount === 0 ? grammarRule.ruleId : null;
}

function basePacket(state, measured) {
  return {
    version: 1,
    state,
    patternConfidence: 'insufficient',
    causeStatus: 'not_established',
    observedFact: null,
    observedRuleId: null,
    supportCount: 0,
    conflictCount: 0,
    possibleExplanations: Object.freeze([]),
    nextDiscriminatorId: null,
    missingMeasurements: missingMeasurements(measured),
    limitations: Object.freeze([
      'internal_simulation_only',
      'not_an_employer_decision',
      'not_a_causal_or_psychological_diagnosis',
    ]),
  };
}

/**
 * Build the public differential truth packet for the latest authoritative diagnostic.
 * Confidence describes repeatability of the observable pattern only. Cause confidence is never
 * upgraded: the current product has no randomized intervention or expert-adjudicated causal data.
 */
export function buildDiagnosticTruth({ forecast = null, measured = null, grammarRule = null } = {}) {
  if (!forecast || typeof forecast !== 'object' || Array.isArray(forecast)) {
    return Object.freeze(basePacket('measure_first', measured));
  }
  if (forecast.state === 'measure_first') return Object.freeze(basePacket('measure_first', measured));
  if (forecast.state === 'historical_only') return Object.freeze(basePacket('historical_only', measured));
  if (forecast.state !== 'observed_simulation_risk') {
    return Object.freeze(basePacket('no_single_pattern_observed', measured));
  }

  const observedFact = safeObservedFact(forecast.criterion);
  if (!observedFact) return Object.freeze(basePacket('measure_first', measured));
  const supportCount = safeCount(forecast.supportCount);
  const conflictCount = safeCount(forecast.conflictCount);
  const patternConfidence = forecast.confidence === 'high' && supportCount >= 2 && conflictCount === 0
    ? 'high' : supportCount >= 1 ? 'provisional' : 'insufficient';
  const state = conflictCount > 0 ? 'conflicted_pattern'
    : patternConfidence === 'high' ? 'repeated_pattern' : 'provisional_pattern';

  return Object.freeze({
    ...basePacket(state, measured),
    patternConfidence,
    observedFact,
    observedRuleId: observedFact.criterionId === 'grammar_control' ? safeGrammarRule(grammarRule) : null,
    supportCount,
    conflictCount,
    possibleExplanations: EXPLANATIONS[observedFact.criterionId],
    nextDiscriminatorId: DISCRIMINATORS[observedFact.criterionId],
  });
}

export default { buildDiagnosticTruth };
