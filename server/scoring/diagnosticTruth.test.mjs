import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosticTruth } from './diagnosticTruth.js';

const MEASURED = Object.freeze({
  wpm: true,
  fillerPer100: true,
  errPer100: true,
  subClauseRate: true,
  vocabDiversity: true,
  deescalation: true,
  giveUpRate: true,
  intelligibility: true,
  latencyS: true,
});

function observed(criterionId, overrides = {}) {
  return {
    state: 'observed_simulation_risk',
    confidence: 'high',
    supportCount: 2,
    conflictCount: 0,
    criterion: {
      criterionId,
      stageId: 'spoken_interview',
      observed: 70,
      reference: 90,
      direction: 'at_least',
      unit: 'wpm',
    },
    ...overrides,
  };
}

test('truth packet: no reliable forecast fails closed into measurement', () => {
  const truth = buildDiagnosticTruth({ measured: { wpm: true } });
  assert.equal(truth.state, 'measure_first');
  assert.equal(truth.observedFact, null);
  assert.equal(truth.causeStatus, 'not_established');
  assert.ok(truth.missingMeasurements.includes('intelligibility'));
});

test('truth packet: repeated pace is an observed pattern, never a causal diagnosis', () => {
  const truth = buildDiagnosticTruth({ forecast: observed('sustained_pace'), measured: MEASURED });
  assert.equal(truth.state, 'repeated_pattern');
  assert.equal(truth.patternConfidence, 'high');
  assert.equal(truth.causeStatus, 'not_established');
  assert.deepEqual(truth.observedFact, {
    criterionId: 'sustained_pace', stageId: 'spoken_interview', observed: 70,
    reference: 90, direction: 'at_least', unit: 'wpm',
  });
  assert.ok(truth.possibleExplanations.includes('lexical_retrieval_load'));
  assert.ok(truth.possibleExplanations.includes('question_comprehension_load'));
  assert.equal(truth.nextDiscriminatorId, 'compare_prepared_and_novel_pace');
});

test('truth packet: contradictory evidence can never be presented as a stable diagnosis', () => {
  const truth = buildDiagnosticTruth({ forecast: observed('sustained_pace', {
    confidence: 'medium', supportCount: 2, conflictCount: 1,
  }), measured: MEASURED });
  assert.equal(truth.state, 'conflicted_pattern');
  assert.equal(truth.patternConfidence, 'provisional');
  assert.equal(truth.conflictCount, 1);
});

test('truth packet: speech recognition explicitly preserves device, ASR and articulation alternatives', () => {
  const forecast = observed('speech_recognition_proxy', { criterion: {
    criterionId: 'speech_recognition_proxy', stageId: 'phone_roleplay', observed: 62,
    reference: 80, direction: 'at_least', unit: 'percent',
  } });
  const truth = buildDiagnosticTruth({ forecast, measured: MEASURED });
  assert.deepEqual(truth.possibleExplanations, [
    'microphone_or_background_noise',
    'speech_recognizer_accent_mismatch',
    'pronunciation_or_articulation',
  ]);
  assert.equal(truth.nextDiscriminatorId, 'repeat_same_answer_with_clean_audio');
});

test('truth packet: latency never infers anxiety, confidence, therapy needs or motivation', () => {
  const forecast = observed('response_latency', { criterion: {
    criterionId: 'response_latency', stageId: 'pressure_followup', observed: 6.2,
    reference: 4, direction: 'at_most', unit: 'seconds',
  } });
  const truth = buildDiagnosticTruth({ forecast, measured: MEASURED });
  const explanations = JSON.stringify(truth.possibleExplanations);
  assert.doesNotMatch(explanations, /anxiety|confidence|therapy|motivation|psychological_state/iu);
  assert.match(explanations, /question_comprehension_load/u);
  assert.match(explanations, /response_planning_load/u);
  assert.ok(truth.limitations.includes('not_a_causal_or_psychological_diagnosis'));
});

test('truth packet: an exact grammar rule is exposed only after repeated conflict-free support', () => {
  const forecast = observed('grammar_control', { criterion: {
    criterionId: 'grammar_control', stageId: 'spoken_interview', observed: 12,
    reference: 8, direction: 'at_most', unit: 'errors_per_100_words',
  } });
  const confirmed = buildDiagnosticTruth({ forecast, measured: MEASURED,
    grammarRule: { ruleId: 'word-order-sub', supportCount: 2, conflictCount: 0 } });
  assert.equal(confirmed.observedRuleId, 'word-order-sub');
  const thin = buildDiagnosticTruth({ forecast, measured: MEASURED,
    grammarRule: { ruleId: 'word-order-sub', supportCount: 1, conflictCount: 0 } });
  assert.equal(thin.observedRuleId, null);
  const conflicted = buildDiagnosticTruth({ forecast, measured: MEASURED,
    grammarRule: { ruleId: 'word-order-sub', supportCount: 3, conflictCount: 1 } });
  assert.equal(conflicted.observedRuleId, null);
});

test('truth packet: malformed criteria, prototype keys and non-numeric observations fail closed', () => {
  for (const criterion of [
    { criterionId: '__proto__', stageId: 'x', observed: 1, reference: 2, direction: 'at_least', unit: 'x' },
    { criterionId: 'sustained_pace', stageId: 'x', observed: 'secret', reference: 90, direction: 'at_least', unit: 'wpm' },
    { criterionId: 'sustained_pace', stageId: 'x', observed: 70, reference: 90, direction: 'sideways', unit: 'wpm' },
  ]) {
    const truth = buildDiagnosticTruth({ forecast: observed('sustained_pace', { criterion }), measured: MEASURED });
    assert.equal(truth.state, 'measure_first');
    assert.equal(truth.observedFact, null);
  }
});

test('truth packet: public shape cannot contain transcript, audio, employer, email or session identity', () => {
  const hostile = observed('sustained_pace', {
    transcript: 'private transcript',
    email: 'person@example.com',
    sessionId: 'private-session',
    employer: 'Private Employer',
    criterion: {
      criterionId: 'sustained_pace', stageId: 'spoken_interview', observed: 70,
      reference: 90, direction: 'at_least', unit: 'wpm', transcript: 'secret',
    },
  });
  const serialized = JSON.stringify(buildDiagnosticTruth({ forecast: hostile, measured: MEASURED }));
  assert.doesNotMatch(serialized, /private transcript|person@example\.com|private-session|Private Employer|secret/u);
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
    'causeStatus', 'conflictCount', 'limitations', 'missingMeasurements', 'nextDiscriminatorId',
    'observedFact', 'observedRuleId', 'patternConfidence', 'possibleExplanations', 'state',
    'supportCount', 'version',
  ]);
});
