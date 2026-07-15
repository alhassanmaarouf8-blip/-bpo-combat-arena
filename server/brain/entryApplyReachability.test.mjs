import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BEHAVIORAL_QUESTIONS, BPO_SCREENING_QUESTIONS, CS_SCENARIOS,
  INTERVIEW_PROMPT_CONTRACT_VERSION, interviewPromptId } from '../scenarios.js';
import { entryInteractionEvidence } from '../scoring/entryInteractionEvidence.js';
import { speakingMeasurementForSkill } from '../scoring/speakingMeasurement.js';
import { validatedTransferProofs } from '../scoring/transferProofs.js';
import { buildSnapshot, verifiedMasteredSkillsFromProfile } from './adapter.js';
import { decide } from './engine.js';

const NOW = 1_800_800_000_000;
const DAY = 24 * 60 * 60 * 1000;
const digest = (value, length = 16) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);

function storedInteraction(evidence) {
  return Object.fromEntries(['version', 'binding', 'roleType', 'scenarioId', 'targetId', 'sessionId',
    'observedAt', 'turnCount', 'wordCount', 'registerSignals', 'informalAddressDetected',
    'requestSteps', 'requestContradicted'].map((key) => [key, evidence[key]]));
}

function taskContract({ scenarioId, novel = false }) {
  return {
    version: 1,
    promptContractVersion: INTERVIEW_PROMPT_CONTRACT_VERSION,
    assessmentMode: 'diagnostic',
    levelId: 'a2-b1',
    bossId: 'yasmin',
    roleType: 'customer_service',
    scenarioId,
    behavioralPromptId: interviewPromptId('behavioral', BEHAVIORAL_QUESTIONS[novel ? 1 : 0], 'a2-b1'),
    screeningPromptId: interviewPromptId('screening', BPO_SCREENING_QUESTIONS[novel ? 1 : 0], 'a2-b1'),
    industryKey: null,
    targetId: null,
    contentSeed: 'entry-proof-seed',
    mood: 'neutral',
    replayContext: { dossier: '', memory: '', focusTitle: '' },
  };
}

function interactionSession({ sessionId, date, scenarioId, turns, novel = false }) {
  const context = { sessionId, targetId: null, roleType: 'customer_service', scenarioId, observedAt: date };
  const interaction = entryInteractionEvidence(turns, context);
  return {
    sessionId,
    date,
    level: 'a2-b1',
    bossId: 'yasmin',
    targetRoleType: 'customer_service',
    scenarioId,
    evidenceQuality: { version: 2, words: 120, eligibleWords: 120, completeTurns: 5,
      truncatedTurns: 0, stageCoverage: 3, prescriptionEligible: true, highConfidence: true },
    entryInteractionEvidence: storedInteraction(interaction),
    speakingTaskContract: taskContract({ scenarioId, novel }),
  };
}

function proofPair(profile, skillId) {
  const [baselineSession, matchedSession, transferSession] = profile.sessions;
  const baseline = speakingMeasurementForSkill(profile, skillId, { sessionId: baselineSession.sessionId });
  const matched = speakingMeasurementForSkill(profile, skillId, { sessionId: matchedSession.sessionId });
  const transfer = speakingMeasurementForSkill(profile, skillId, { sessionId: transferSession.sessionId });
  assert.ok(baseline && matched && transfer);
  const prescriptionId = digest({ skillId, kind: 'prescription' });
  const matchedId = digest({ skillId, kind: 'matched' });
  const matchedProof = {
    id: matchedId,
    prescriptionId,
    skillId,
    metricKey: baseline.metricKey,
    before: baseline.value,
    after: matched.value,
    phase: 'matched',
    status: 'improved',
    verifiedAt: matched.measuredAt + 100,
    measuredAt: matched.measuredAt,
    measurementEvidenceId: matched.evidenceId,
    retestSessionId: matched.sourceSessionId,
    baselineSessionId: baseline.sourceSessionId,
    baselineMeasurementEvidenceId: baseline.evidenceId,
    comparedValue: baseline.value,
    comparedMeasurementEvidenceId: baseline.evidenceId,
    comparedRetestSessionId: baseline.sourceSessionId,
    contextId: matched.contextId,
    noveltyId: matched.noveltyId,
    comparedContextId: baseline.contextId,
    comparedNoveltyId: baseline.noveltyId,
  };
  const transferProof = {
    id: digest({ skillId, kind: 'transfer' }),
    prescriptionId,
    skillId,
    metricKey: baseline.metricKey,
    before: baseline.value,
    after: transfer.value,
    phase: 'transfer',
    status: 'improved',
    verifiedAt: NOW,
    measuredAt: transfer.measuredAt,
    measurementEvidenceId: transfer.evidenceId,
    retestSessionId: transfer.sourceSessionId,
    baselineSessionId: baseline.sourceSessionId,
    baselineMeasurementEvidenceId: baseline.evidenceId,
    comparedValue: matched.value,
    comparedMeasurementEvidenceId: matched.evidenceId,
    comparedRetestSessionId: matched.sourceSessionId,
    comparedProofId: matchedProof.id,
    contextId: transfer.contextId,
    noveltyId: transfer.noveltyId,
    comparedContextId: matched.contextId,
    comparedNoveltyId: matched.noveltyId,
  };
  return [matchedProof, transferProof];
}

function proofProfile() {
  const baselineTurns = [
    'Du musst mir deine Nummer geben, weil das sonst nicht bearbeitet werden kann.',
    'Das ist nicht unser Problem, und wir werden nichts prüfen oder klären.',
  ];
  const masteredTurns = [
    'Wenn ich Sie richtig verstehe, möchten Sie Ihre Lieferadresse ändern. Könnten Sie mir bitte Ihre Kundennummer nennen?',
    'Ich prüfe Ihre Anfrage jetzt für Sie. Als Nächstes kläre ich die Änderung, und Sie erhalten morgen meine Bestätigung.',
  ];
  const transferTurns = [
    'Wenn ich Sie richtig verstehe, geht es Ihnen um eine falsche Rechnung. Könnten Sie mir bitte Ihre Vertragsnummer nennen?',
    'Ich kläre Ihr Anliegen jetzt für Sie. Als Nächstes prüfe ich die Rechnung, und Sie bekommen morgen eine Rückmeldung.',
  ];
  const profile = { sessions: [
    interactionSession({ sessionId: 'entry-baseline', date: NOW - 9 * DAY,
      scenarioId: CS_SCENARIOS[0].id, turns: baselineTurns }),
    interactionSession({ sessionId: 'entry-matched', date: NOW - 8 * DAY,
      scenarioId: CS_SCENARIOS[0].id, turns: masteredTurns }),
    interactionSession({ sessionId: 'entry-transfer', date: NOW - DAY,
      scenarioId: CS_SCENARIOS[1].id, turns: transferTurns, novel: true }),
  ] };
  profile.salmaCoach = { coachState: { improvementHistory: [
    ...proofPair(profile, 'sie-register'),
    ...proofPair(profile, 'handle-clear-request'),
  ] } };
  return profile;
}

test('the two missing entry skills can now earn bound matched-and-transfer mastery', () => {
  const profile = proofProfile();
  const proofs = validatedTransferProofs(profile, NOW);
  assert.deepEqual(proofs.map((proof) => proof.skillId).sort(), ['handle-clear-request', 'sie-register']);
  const verified = verifiedMasteredSkillsFromProfile(profile, NOW);
  assert.equal(verified.has('sie-register'), true);
  assert.equal(verified.has('handle-clear-request'), true);

  const remainingEntryProofs = ['word-order-sub', 'dativ-akkusativ', 'listen-phone', 'no-freeze-expected'];
  const directive = decide({ sessionCount: 3,
    masteredSkills: [...remainingEntryProofs, ...verified],
    verifiedMasteredSkills: [...remainingEntryProofs, ...verified] });
  assert.equal(directive.state, 'APPLY');
  assert.equal(directive.tier.applyNow, true);
});

test('copied proofs, edited packets, and missing session chains cannot unlock APPLY', () => {
  const profile = proofProfile();
  assert.deepEqual([...verifiedMasteredSkillsFromProfile({ ...profile, sessions: [] }, NOW)], []);

  const tampered = structuredClone(profile);
  tampered.sessions[2].entryInteractionEvidence.requestSteps = 2;
  const verified = verifiedMasteredSkillsFromProfile(tampered, NOW);
  assert.equal(verified.has('sie-register'), false,
    'the shared server packet binding protects every metric, not only the edited field');
  assert.equal(verified.has('handle-clear-request'), false);
  const snapshot = buildSnapshot(tampered, NOW);
  assert.equal(decide(snapshot).state === 'APPLY', false);
});
