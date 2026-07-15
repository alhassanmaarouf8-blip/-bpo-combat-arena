import test from 'node:test';
import assert from 'node:assert/strict';
import { CS_SCENARIOS } from '../scenarios.js';
import { serverStreamEvidence, typedAnswerEvidence } from '../spokenEvidence.js';
import { clearRequestScoreFromSession, entryInteractionEvidence,
  entryInteractionEvidenceFromUtterances, formalRegisterScoreFromSession } from './entryInteractionEvidence.js';

const NOW = 1_800_000_000_000;
const CONTEXT = Object.freeze({
  sessionId: 'entry-session-1', targetId: null, roleType: 'customer_service',
  scenarioId: CS_SCENARIOS[0].id, observedAt: NOW,
});
const GOOD_TURNS = Object.freeze([
  'Wenn ich Sie richtig verstehe, möchten Sie die Lieferadresse ändern. Könnten Sie mir bitte Ihre Kundennummer nennen?',
  'Ich prüfe Ihre Anfrage jetzt für Sie. Als Nächstes werde ich die Adresse klären, und Sie erhalten morgen meine Bestätigung.',
]);

function storedEvidence(evidence) {
  return Object.fromEntries(['version', 'binding', 'roleType', 'scenarioId', 'targetId', 'sessionId',
    'observedAt', 'turnCount', 'wordCount', 'registerSignals', 'informalAddressDetected',
    'requestSteps', 'requestContradicted'].map((key) => [key, evidence[key]]));
}

function sessionFor(evidence, overrides = {}) {
  return {
    sessionId: CONTEXT.sessionId,
    date: CONTEXT.observedAt,
    targetRoleType: CONTEXT.roleType,
    scenarioId: CONTEXT.scenarioId,
    entryInteractionEvidence: storedEvidence(evidence),
    ...overrides,
  };
}

test('formal register and clear-request handling require distinct observable acts', () => {
  const evidence = entryInteractionEvidence(GOOD_TURNS, CONTEXT);
  assert.equal(evidence.eligible, true);
  assert.equal(evidence.formalRegisterScore, 1);
  assert.equal(evidence.clearRequestScore, 1);
  assert.equal(evidence.requestSteps, 3);
  const session = sessionFor(evidence);
  assert.equal(formalRegisterScoreFromSession(session), 1);
  assert.equal(clearRequestScoreFromSession(session), 1);
});

test('typed, cut-off, low-confidence and non-roleplay turns cannot become interaction evidence', () => {
  const spoken = serverStreamEvidence({ source: 'deepgram_stream', serverAudioMs: 4_000, scoringDurationMs: 4_000 });
  const turns = [
    { stage: 2, durationMs: 4_000, text: GOOD_TURNS[0], lowConf: [], spokenEvidence: typedAnswerEvidence() },
    { stage: 2, durationMs: 4_000, text: 'Wenn ich Sie richtig verstehe, möchten Sie', lowConf: [], spokenEvidence: spoken },
    { stage: 2, durationMs: 4_000, text: GOOD_TURNS[1], lowConf: ['anfrage'], spokenEvidence: spoken },
    { stage: 1, durationMs: 4_000, text: GOOD_TURNS[1], lowConf: [], spokenEvidence: spoken },
  ];
  const evidence = entryInteractionEvidenceFromUtterances(turns, CONTEXT);
  assert.equal(evidence.eligible, false);
  assert.equal(evidence.formalRegisterScore, null);
  assert.equal(evidence.clearRequestScore, null);
});

test('an observed du-slip and contradictory refusal fail closed', () => {
  const evidence = entryInteractionEvidence([
    'Wenn ich Sie richtig verstehe, möchten Sie die Adresse ändern. Du musst mir aber zuerst deine Nummer geben.',
    'Das ist nicht unser Problem, und wir werden nichts prüfen oder klären. Als Nächstes passiert deshalb nichts.',
  ], CONTEXT);
  assert.equal(evidence.eligible, true);
  assert.equal(evidence.informalAddressDetected, true);
  assert.equal(evidence.requestContradicted, true);
  assert.equal(evidence.formalRegisterScore, 0);
  assert.equal(evidence.clearRequestScore, 0);
});

test('stored interaction scores are bound to the exact session tuple and payload', () => {
  const evidence = entryInteractionEvidence(GOOD_TURNS, CONTEXT);
  const valid = sessionFor(evidence);
  for (const changed of [
    { sessionId: 'entry-session-2' },
    { date: NOW + 1 },
    { targetRoleType: 'technical_support' },
    { scenarioId: CS_SCENARIOS[1].id },
    { vacancyTargetId: 'different-target' },
  ]) {
    assert.equal(formalRegisterScoreFromSession({ ...valid, ...changed }), null);
    assert.equal(clearRequestScoreFromSession({ ...valid, ...changed }), null);
  }
  assert.equal(formalRegisterScoreFromSession({ ...valid, entryInteractionEvidence: {
    ...valid.entryInteractionEvidence, registerSignals: 4,
  } }), null, 'an in-range payload mutation must break the binding');
  assert.equal(clearRequestScoreFromSession({ ...valid, entryInteractionEvidence: {
    ...valid.entryInteractionEvidence, requestSteps: 2,
  } }), null, 'request progress cannot be edited after the server packet was issued');
});
