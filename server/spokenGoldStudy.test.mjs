import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BEHAVIORAL_QUESTIONS,
  BPO_SCREENING_QUESTIONS,
  CS_SCENARIOS,
  INTERVIEW_PROMPT_CONTRACT_VERSION,
  interviewPromptId,
} from './scenarios.js';
import { entryInteractionEvidence } from './scoring/entryInteractionEvidence.js';
import { speakingMeasurementForSkill } from './scoring/speakingMeasurement.js';
import { buildSpokenGoldProfileSnapshot } from './spokenGoldSnapshot.js';
import {
  buildSpokenGoldStudy,
  createSpokenDisagreementTemplate,
  deriveSpokenGoldAppDecision,
  finalizeSpokenGoldStudy,
  loadStudyProfileSnapshots,
  summarizeSpokenInterRater,
  validateIndependentSpokenReview,
  verifySpokenGoldStudyProvenance,
  verifyStudyMediaFiles,
} from '../scripts/lib/spoken-gold-study.mjs';

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const execFile = promisify(execFileCallback);
const digest = (value, length = 16) => createHash('sha256')
  .update(JSON.stringify(value)).digest('hex').slice(0, length);
const PROTOCOL = Object.freeze({
  protocolId: 'clear-request-handling-v1',
  criterionId: 'handle-clear-request',
  archetypeId: 'clear_customer_request',
  stageId: 'customer_roleplay',
  failureThreshold: 75,
  minimumReliableOpportunities: 2,
  evidenceContractVersion: 2,
  frozenAt: '2026-07-16T12:00:00.000Z',
});
const WEAK_TURNS = Object.freeze([
  'Wenn ich Sie richtig verstehe, möchten Sie Ihre Lieferadresse ändern. Könnten Sie mir bitte Ihre Kundennummer nennen?',
  'Ich prüfe Ihre Anfrage jetzt für Sie und kümmere mich um die Änderung.',
]);
const STRONG_TURNS = Object.freeze([
  'Wenn ich Sie richtig verstehe, möchten Sie Ihre Lieferadresse ändern. Könnten Sie mir bitte Ihre Kundennummer nennen?',
  'Ich prüfe Ihre Anfrage jetzt für Sie. Als Nächstes kläre ich die Änderung, und Sie erhalten morgen meine Bestätigung.',
]);
const TRANSFER_TURNS = Object.freeze([
  'Wenn ich Sie richtig verstehe, geht es Ihnen um eine falsche Rechnung. Könnten Sie mir bitte Ihre Vertragsnummer nennen?',
  'Ich kläre Ihr Anliegen jetzt für Sie. Als Nächstes prüfe ich die Rechnung, und Sie bekommen morgen eine Rückmeldung.',
]);

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
    contentSeed: novel ? 'spoken-study-novel' : 'spoken-study-baseline',
    mood: 'neutral',
    replayContext: { dossier: '', memory: '', focusTitle: '' },
  };
}

function interactionSession({ sessionId, date, turns, novel = false, reliable = true }) {
  const scenarioId = CS_SCENARIOS[novel ? 1 : 0].id;
  const context = { sessionId, targetId: null, roleType: 'customer_service', scenarioId, observedAt: date };
  const interaction = entryInteractionEvidence(turns, context);
  return {
    sessionId,
    date,
    level: 'a2-b1',
    bossId: 'yasmin',
    targetRoleType: 'customer_service',
    scenarioId,
    evidenceQuality: {
      version: 2,
      words: 120,
      eligibleWords: 120,
      completeTurns: 5,
      truncatedTurns: 0,
      stageCoverage: 3,
      prescriptionEligible: reliable,
      highConfidence: reliable,
    },
    entryInteractionEvidence: storedInteraction(interaction),
    speakingTaskContract: taskContract({ scenarioId, novel }),
  };
}

function baselineProfile(index, mode = 'selected') {
  const firstTurns = mode === 'not_selected' ? STRONG_TURNS : WEAK_TURNS;
  const secondTurns = mode === 'not_selected' || mode === 'conflicting' ? STRONG_TURNS : WEAK_TURNS;
  return {
    userId: `account_${index}`,
    sessions: [
      interactionSession({ sessionId: `p${index}-baseline-a`, date: NOW - 10 * DAY, turns: firstTurns }),
      interactionSession({ sessionId: `p${index}-baseline-b`, date: NOW - 9 * DAY,
        turns: secondTurns, reliable: mode !== 'insufficient' }),
    ],
  };
}

function proofPair(profile) {
  const baseline = speakingMeasurementForSkill(profile, 'handle-clear-request',
    { sessionId: profile.sessions[1].sessionId });
  const matched = speakingMeasurementForSkill(profile, 'handle-clear-request',
    { sessionId: profile.sessions[2].sessionId });
  const transfer = speakingMeasurementForSkill(profile, 'handle-clear-request',
    { sessionId: profile.sessions[3].sessionId });
  assert.ok(baseline && matched && transfer);
  const prescriptionId = digest({ userId: profile.userId, kind: 'prescription' });
  const matchedProof = {
    id: digest({ userId: profile.userId, kind: 'matched' }),
    prescriptionId,
    skillId: 'handle-clear-request',
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
    id: digest({ userId: profile.userId, kind: 'transfer' }),
    prescriptionId,
    skillId: 'handle-clear-request',
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

function finalProfile(index, { matchedOnly = false } = {}) {
  const profile = structuredClone(baselineProfile(index));
  profile.sessions.push(
    interactionSession({ sessionId: `p${index}-matched`, date: NOW - 8 * DAY, turns: STRONG_TURNS }),
    interactionSession({ sessionId: `p${index}-transfer`, date: NOW - DAY, turns: TRANSFER_TURNS, novel: true }),
  );
  const proofs = proofPair(profile);
  profile.salmaCoach = {
    coachState: {
      completedBlocks: { [proofs[0].prescriptionId]: 1 },
      improvementHistory: matchedOnly ? [proofs[0]] : proofs,
    },
  };
  return profile;
}

function studyCase(index, split, mode = 'selected') {
  const selected = mode === 'selected';
  return {
    participantId: `participant_${index}`,
    split,
    levelBand: index % 3 === 0 ? 'a2' : index % 3 === 1 ? 'b1' : 'b2',
    consentAttested: true,
    consentVersion: 'spoken-gold-v1',
    captureBindingAttested: true,
    deleteBy: '2026-08-16',
    baselineArtifacts: [`p${index}_baseline_a.wav`, `p${index}_baseline_b.wav`],
    matchedArtifact: selected ? `p${index}_matched.wav` : null,
    novelArtifact: selected ? `p${index}_novel.wav` : null,
    baselineProfileArtifact: `p${index}_baseline_profile.json`,
    finalProfileArtifact: selected ? `p${index}_final_profile.json` : null,
  };
}

function completeStudy() {
  return {
    schemaVersion: 1,
    protocol: PROTOCOL,
    cases: [
      studyCase(0, 'owner_smoke'),
      studyCase(1, 'calibration'),
      studyCase(2, 'calibration'),
      studyCase(3, 'calibration', 'insufficient'),
      studyCase(4, 'development'),
      studyCase(5, 'holdout'),
    ],
  };
}

function completeProfiles() {
  const profiles = new Map();
  for (let index = 0; index < 6; index += 1) {
    const insufficient = index === 3;
    profiles.set(`p${index}_baseline_profile.json`, baselineProfile(index, insufficient ? 'insufficient' : 'selected'));
    if (!insufficient) profiles.set(`p${index}_final_profile.json`, finalProfile(index));
  }
  return profiles;
}

function build(input = completeStudy(), profileSnapshots = completeProfiles()) {
  return buildSpokenGoldStudy(input, { profileSnapshots });
}

function completedReview(pack, reviewerId, change = null) {
  return {
    schemaVersion: 1,
    reviewerId,
    qualificationAttested: true,
    independentReviewAttested: true,
    verdicts: pack.items.map((item, index) => {
      const insufficient = index === 3;
      const verdict = {
        reviewId: item.reviewId,
        evidenceState: insufficient ? 'insufficient' : 'sufficient',
        topBottleneckId: insufficient ? 'insufficient' : 'handle-clear-request',
        acceptableDrillIds: insufficient ? [] : ['druck-leiter'],
        matchedResult: item.matchedArtifact ? 'pass' : 'not_available',
        novelResult: item.novelArtifact ? 'pass' : 'not_available',
        reviewerNote: '',
      };
      return change?.index === index ? { ...verdict, ...change.value } : verdict;
    }),
  };
}

test('app decisions are derived from bound server profiles and fail closed on bad evidence', () => {
  const completeBaseline = baselineProfile(20);
  const completeFinal = finalProfile(20);
  const selected = deriveSpokenGoldAppDecision(completeBaseline, completeFinal);
  assert.equal(selected.decision, 'selected');
  assert.equal(selected.observedScore, 66.7);
  assert.equal(selected.prescription.drillId, 'druck-leiter');
  assert.equal(selected.prescription.repetitions, 5);
  assert.equal(selected.prescription.matchedRetestAfterMinutes, 1_440);
  assert.equal(selected.prescription.novelRetestAfterMinutes, 10_080);
  assert.equal(selected.masteryClaimed, true);
  assert.match(selected.decisionBinding, /^[a-f0-9]{64}$/u);

  const exported = deriveSpokenGoldAppDecision(
    buildSpokenGoldProfileSnapshot(completeBaseline),
    buildSpokenGoldProfileSnapshot(completeFinal),
  );
  assert.deepEqual(exported, selected,
    'privacy-safe owner exports must reproduce the full server-profile study decision exactly');

  assert.equal(deriveSpokenGoldAppDecision(baselineProfile(21, 'not_selected')).decision, 'not_selected');
  assert.equal(deriveSpokenGoldAppDecision(baselineProfile(22, 'conflicting')).decision, 'abstain');
  assert.equal(deriveSpokenGoldAppDecision(baselineProfile(23, 'insufficient')).decision, 'abstain');

  const tampered = baselineProfile(24);
  tampered.sessions[0].entryInteractionEvidence.requestSteps = 1;
  const abstained = deriveSpokenGoldAppDecision(tampered);
  assert.equal(abstained.decision, 'abstain');
  assert.equal(abstained.evidenceCount, 1);

  const mismatchedAccount = finalProfile(25);
  mismatchedAccount.userId = 'different-account';
  assert.throws(() => deriveSpokenGoldAppDecision(baselineProfile(25), mismatchedAccount), /same immutable account/);

  const changedBaseline = finalProfile(26);
  changedBaseline.sessions[1].entryInteractionEvidence.requestSteps = 1;
  assert.throws(() => deriveSpokenGoldAppDecision(baselineProfile(26), changedBaseline), /preserve the bound baseline/);

  const matchedOnly = deriveSpokenGoldAppDecision(baselineProfile(27), finalProfile(27, { matchedOnly: true }));
  assert.equal(matchedOnly.masteryClaimed, false, 'drill completion and a matched pass are not mastery');
});

test('spoken gold pack is blinded, participant-disjoint and excludes owner smoke from accuracy claims', () => {
  const { pack, key, reviewTemplate } = build();
  assert.equal(pack.items.length, 6);
  assert.equal(key.items.filter((item) => item.split === 'owner_smoke').length, 1);
  assert.equal(reviewTemplate.verdicts.length, 6);
  const visible = JSON.stringify(pack);
  assert.doesNotMatch(visible, /participant_\d|appDecision|observedScore|druck-leiter|profile\.json/u);
  assert.match(visible, /p0_baseline_a\.wav/u);
  assert.equal(key.items[0].participantHash.length, 64);
  assert.doesNotMatch(JSON.stringify(key), /account_\d|profile\.json/u);

  const crossed = completeStudy();
  crossed.cases.push({ ...studyCase(7, 'holdout'), participantId: 'participant_1' });
  const crossedProfiles = completeProfiles();
  crossedProfiles.set('p7_baseline_profile.json', baselineProfile(7));
  crossedProfiles.set('p7_final_profile.json', finalProfile(7));
  assert.throws(() => build(crossed, crossedProfiles), /cannot cross study splits/);

  const reusedAccount = completeStudy();
  const reusedProfiles = completeProfiles();
  reusedProfiles.set('p2_baseline_profile.json', structuredClone(reusedProfiles.get('p1_baseline_profile.json')));
  reusedProfiles.set('p2_final_profile.json', structuredClone(reusedProfiles.get('p1_final_profile.json')));
  assert.throws(() => build(reusedAccount, reusedProfiles), /cannot represent multiple study participants/);
});

test('spoken study rejects manual verdicts, private fields, unsafe artifacts and media reuse', () => {
  const manualVerdict = completeStudy();
  manualVerdict.cases[0].appDecision = { decision: 'selected' };
  assert.throws(() => build(manualVerdict), /missing or unknown fields/);

  const privateInput = completeStudy();
  privateInput.cases[0].transcript = 'private words';
  assert.throws(() => build(privateInput), /forbidden private study data/);

  const unsafeArtifact = completeStudy();
  unsafeArtifact.cases[0].baselineArtifacts[0] = '../private.wav';
  assert.throws(() => build(unsafeArtifact), /opaque relative media filename/);

  const unboundCapture = completeStudy();
  unboundCapture.cases[0].captureBindingAttested = false;
  assert.throws(() => build(unboundCapture), /media matches the exact server snapshots/);

  const reused = completeStudy();
  reused.cases[1].baselineArtifacts[0] = reused.cases[0].baselineArtifacts[0];
  assert.throws(() => build(reused), /cannot be reused/);

  const excessiveRetention = completeStudy();
  excessiveRetention.cases[0].deleteBy = '2027-08-16';
  assert.throws(() => build(excessiveRetention), /1-90 days/);

  assert.throws(() => buildSpokenGoldStudy(completeStudy()), /profile snapshots are required/);
});

test('study creation verifies private profiles and every referenced media file', async () => {
  const input = { schemaVersion: 1, protocol: PROTOCOL, cases: [studyCase(0, 'owner_smoke')] };
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omni-spoken-gold-'));
  try {
    await writeFile(path.join(directory, 'p0_baseline_profile.json'), JSON.stringify(baselineProfile(0)));
    await writeFile(path.join(directory, 'p0_final_profile.json'), JSON.stringify(finalProfile(0)));
    const snapshots = await loadStudyProfileSnapshots(input, directory);
    const { pack } = buildSpokenGoldStudy(input, { profileSnapshots: snapshots });
    const wav = Buffer.alloc(1_024);
    wav.write('RIFF', 0, 'ascii');
    wav.write('WAVE', 8, 'ascii');
    for (const artifact of pack.items.flatMap((item) => [
      ...item.baselineArtifacts, item.matchedArtifact, item.novelArtifact,
    ]).filter(Boolean)) await writeFile(path.join(directory, artifact), wav);
    assert.deepEqual(await verifyStudyMediaFiles(pack, directory), { verifiedFiles: 4 });

    await writeFile(path.join(directory, pack.items[0].novelArtifact), Buffer.alloc(1_024));
    await assert.rejects(() => verifyStudyMediaFiles(pack, directory), /header does not match/);
    await rm(path.join(directory, pack.items[0].novelArtifact));
    await assert.rejects(() => verifyStudyMediaFiles(pack, directory), /missing, linked, or outside/);

    await writeFile(path.join(directory, 'p0_baseline_profile.json'),
      '{"userId":"account_0","__proto__":{"polluted":true}}');
    await assert.rejects(() => loadStudyProfileSnapshots(input, directory), /forbidden object key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the public pack command derives its hidden key without emitting private profile data', async () => {
  const input = { schemaVersion: 1, protocol: PROTOCOL, cases: [studyCase(0, 'owner_smoke')] };
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omni-spoken-cli-'));
  try {
    const inputPath = path.join(directory, 'input.json');
    await writeFile(inputPath, JSON.stringify(input));
    await writeFile(path.join(directory, 'p0_baseline_profile.json'), JSON.stringify(baselineProfile(0)));
    await writeFile(path.join(directory, 'p0_final_profile.json'), JSON.stringify(finalProfile(0)));
    const wav = Buffer.alloc(1_024);
    wav.write('RIFF', 0, 'ascii');
    wav.write('WAVE', 8, 'ascii');
    for (const artifact of input.cases[0].baselineArtifacts.concat([
      input.cases[0].matchedArtifact, input.cases[0].novelArtifact,
    ])) await writeFile(path.join(directory, artifact), wav);
    const outputs = {
      pack: path.join(directory, 'pack.json'),
      key: path.join(directory, 'key.json'),
      reviewA: path.join(directory, 'review-a.json'),
      reviewB: path.join(directory, 'review-b.json'),
    };
    const { stdout } = await execFile(process.execPath, [
      path.resolve('scripts/create-spoken-gold-study-pack.mjs'),
      '--input', inputPath,
      '--out-pack', outputs.pack,
      '--out-key', outputs.key,
      '--out-review-a', outputs.reviewA,
      '--out-review-b', outputs.reviewB,
    ], { cwd: path.resolve('.') });
    assert.match(stdout, /"ok":true/u);
    const pack = JSON.parse(await readFile(outputs.pack, 'utf8'));
    const key = JSON.parse(await readFile(outputs.key, 'utf8'));
    assert.equal(key.items[0].appDecision.decision, 'selected');
    assert.match(key.items[0].appDecision.decisionBinding, /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify({ pack, key }), /account_0|profile\.json/u);

    const snapshots = await loadStudyProfileSnapshots(input, directory);
    assert.deepEqual(verifySpokenGoldStudyProvenance(input, snapshots, pack, key), { pack, key });
    const editedKey = structuredClone(key);
    editedKey.items[0].appDecision.observedScore = 100;
    assert.throws(
      () => verifySpokenGoldStudyProvenance(input, snapshots, pack, editedKey),
      /does not match the re-derived server evidence/,
    );
    const editedPack = structuredClone(pack);
    editedPack.items[0].levelBand = 'b2';
    assert.throws(
      () => verifySpokenGoldStudyProvenance(input, snapshots, editedPack, key),
      /does not match the original private evidence manifest/,
    );

    const reviewA = completedReview(pack, 'qualified_rater_a');
    const reviewB = completedReview(pack, 'qualified_rater_b');
    const resolution = {
      schemaVersion: 1,
      adjudicatorId: 'qualified_adjudicator',
      qualificationAttested: true,
      items: [],
    };
    await writeFile(outputs.reviewA, JSON.stringify(reviewA));
    await writeFile(outputs.reviewB, JSON.stringify(reviewB));
    const resolutionPath = path.join(directory, 'resolution.json');
    const reportPath = path.join(directory, 'aggregate.json');
    await writeFile(resolutionPath, JSON.stringify(resolution));
    const finalized = await execFile(process.execPath, [
      path.resolve('scripts/finalize-spoken-gold-study.mjs'),
      '--input', inputPath,
      '--pack', outputs.pack,
      '--key', outputs.key,
      '--rater-a', outputs.reviewA,
      '--rater-b', outputs.reviewB,
      '--resolution', resolutionPath,
      '--out', reportPath,
    ], { cwd: path.resolve('.') });
    assert.match(finalized.stdout, /"ok":true/u);
    const aggregate = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.match(aggregate.sourceHashes.input, /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(aggregate), /account_0|profile\.json|decisionBinding/u);

    await writeFile(outputs.key, JSON.stringify(editedKey));
    await assert.rejects(
      () => execFile(process.execPath, [
        path.resolve('scripts/finalize-spoken-gold-study.mjs'),
        '--input', inputPath,
        '--pack', outputs.pack,
        '--key', outputs.key,
        '--rater-a', outputs.reviewA,
        '--rater-b', outputs.reviewB,
        '--resolution', resolutionPath,
        '--out', path.join(directory, 'tampered-aggregate.json'),
      ], { cwd: path.resolve('.') }),
      /does not match the re-derived server evidence/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('two qualified independent reviews are complete, blind and measured before app comparison', () => {
  const { pack } = build();
  const a = completedReview(pack, 'qualified_rater_a');
  const b = completedReview(pack, 'qualified_rater_b', { index: 2, value: {
    topBottleneckId: 'sie-register', acceptableDrillIds: ['srs'],
  } });
  const summary = summarizeSpokenInterRater(pack, a, b);
  assert.equal(summary.reviewed, 6);
  assert.equal(summary.disagreements, 1);
  assert.equal(summary.topBottleneck.n, 5);
  assert.ok(summary.topBottleneck.observedAgreement < 1);
  const resolution = createSpokenDisagreementTemplate(pack, a, b);
  assert.equal(resolution.items.length, 1);
  assert.equal(resolution.items[0].finalVerdict, null);
  assert.doesNotMatch(JSON.stringify(summary), /appDecision|participantHash/u);

  assert.throws(() => summarizeSpokenInterRater(pack, a, { ...b, reviewerId: 'qualified_rater_a' }), /distinct independent reviewers/);
  assert.throws(() => validateIndependentSpokenReview(pack, { ...a, qualificationAttested: false }), /qualified independent/);
  assert.throws(() => validateIndependentSpokenReview(pack, { ...a, verdicts: a.verdicts.slice(1) }), /incomplete/);
  assert.throws(() => validateIndependentSpokenReview(pack, {
    ...a, verdicts: a.verdicts.map((verdict, index) => index ? verdict : { ...verdict, hiddenAppLabel: true }),
  }), /unknown fields/);
});

test('final spoken report preserves agreements, excludes smoke and enforces every beta gate', () => {
  const { pack, key } = build();
  const a = completedReview(pack, 'qualified_rater_a');
  const b = completedReview(pack, 'qualified_rater_b', { index: 2, value: {
    topBottleneckId: 'sie-register', acceptableDrillIds: ['srs'],
  } });
  const dispute = createSpokenDisagreementTemplate(pack, a, b).items[0];
  const resolution = {
    schemaVersion: 1,
    adjudicatorId: 'qualified_adjudicator',
    qualificationAttested: true,
    items: [{
      reviewId: dispute.reviewId,
      finalVerdict: {
        evidenceState: 'sufficient', topBottleneckId: 'handle-clear-request',
        acceptableDrillIds: ['druck-leiter'], matchedResult: 'pass', novelResult: 'pass',
      },
      rationale: 'The candidate omits the ordered ownership sequence in both reliable baseline opportunities.',
    }],
  };
  const report = finalizeSpokenGoldStudy(pack, key, a, b, resolution);
  const reportKeys = Object.keys(report);
  assert.ok(reportKeys.indexOf('interRater') < reportKeys.indexOf('appComparison'),
    'inter-rater evidence is emitted before app comparison');
  assert.equal(report.ownerSmoke.caseCount, 1);
  assert.equal(report.ownerSmoke.excludedFromAccuracyClaims, true);
  assert.equal(report.appComparison.targetParticipantCount, 5);
  assert.equal(report.appComparison.splitParticipantCounts.holdout, 1);
  assert.equal(report.appComparison.correctAbstention.rate, 1);
  assert.equal(report.appComparison.bottleneckAgreement.rate, 1);
  assert.equal(report.appComparison.prescriptionAgreement.rate, 1);
  assert.equal(report.appComparison.harmfulMisdirectionCount, 0);
  assert.equal(report.appComparison.invalidMasteryClaimCount, 0);
  assert.equal(report.status, 'beta-gates-measured-and-passed');
  assert.ok(Object.values(report.betaGates).every(Boolean));
  assert.equal(report.containsRawAudioOrTranscript, false);
  assert.doesNotMatch(JSON.stringify(report), /profile|account_|decisionBinding|participantHash/u);

  assert.throws(() => finalizeSpokenGoldStudy(pack, key, a, b, { ...resolution, items: [] }), /adjudication is incomplete/);
  assert.throws(() => finalizeSpokenGoldStudy(pack, key, a, b, {
    ...resolution,
    items: [{ ...resolution.items[0], reviewId: pack.items[0].reviewId }],
  }), /unexpected/);
});

test('human transfer failure exposes an app mastery disagreement instead of hiding it', () => {
  const { pack, key } = build();
  const a = completedReview(pack, 'qualified_rater_a', { index: 1, value: { novelResult: 'fail' } });
  const b = completedReview(pack, 'qualified_rater_b', { index: 1, value: { novelResult: 'fail' } });
  const report = finalizeSpokenGoldStudy(pack, key, a, b, {
    schemaVersion: 1, adjudicatorId: 'qualified_adjudicator', qualificationAttested: true, items: [],
  });
  assert.equal(report.appComparison.invalidMasteryClaimCount, 1);
  assert.equal(report.betaGates.zeroInvalidMasteryClaims, false);
  assert.equal(report.status, 'beta-gates-not-yet-passed');
});
