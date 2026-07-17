import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EXPERT_GOLD_PROTOCOLS,
  buildExpertGoldStudy,
  compareExpertReviews,
  createExpertDisagreementPack,
  deriveExpertGoldAppDecision,
  finalizeExpertGoldStudy,
  loadExpertGoldProfiles,
  verifyFrozenExpertGoldStudy,
} from '../scripts/lib/expert-gold-harness.mjs';

function input(overrides = {}) {
  return { schemaVersion: 2, appVersion: 'abcdef1', frozenAt: '2026-07-17T12:00:00.000Z', cases: [{
    participantId: 'opaque_01', split: 'synthetic_smoke', levelBand: 'b1', protocolId: 'clear-request-handling-v1',
    consentAttested: true, consentVersion: 'expert-gold-v2', captureBindingAttested: true, deleteBy: '2026-08-17',
    baselineArtifacts: ['base_a.wav', 'base_b.wav'], matchedArtifact: null, novelArtifact: null,
    salmaArtifact: null, baselineProfileArtifact: 'baseline.json', finalProfileArtifact: null,
    ...overrides,
  }] };
}

function review(pack, reviewerId, change = {}) {
  return { schemaVersion: 2, reviewerId, qualificationAttested: true, independentReviewAttested: true,
    verdicts: pack.items.map((item) => ({ reviewId: item.reviewId, evidenceState: 'insufficient',
      analyticScores: Object.fromEntries(pack.protocols[item.protocolId].scaleIds.map((id) => [id, null])),
      topBottleneckId: 'insufficient', secondaryBottleneckIds: [], acceptableDrillIds: [],
      doseAppropriateness: 'not_available', salmaGrounding: 'unavailable', matchedResult: 'not_available',
      novelResult: 'not_available', reviewerNote: '', ...change })) };
}

async function fixture(overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'expert-gold-'));
  const wav = Buffer.alloc(1024); wav.write('RIFF', 0); wav.write('WAVE', 8);
  await Promise.all([writeFile(path.join(directory, 'base_a.wav'), wav), writeFile(path.join(directory, 'base_b.wav'), wav),
    writeFile(path.join(directory, 'baseline.json'), JSON.stringify({ userId: 'account_01', sessions: [] }))]);
  const studyInput = input(overrides);
  const profiles = await loadExpertGoldProfiles(studyInput, directory);
  const built = await buildExpertGoldStudy(studyInput, { profiles, baseDirectory: directory });
  return { directory, studyInput, built };
}

test('registry freezes the full observable learning-chain protocol set without phoneme claims', () => {
  const ids = Object.keys(EXPERT_GOLD_PROTOCOLS);
  assert.deepEqual(ids, ['clear-request-handling-v1', 'service-recovery-v1', 'professional-register-v1',
    'response-continuity-v1', 'sustained-pace-v1', 'phone-intelligibility-v1', 'grammar-word-order-v1',
    'grammar-case-v1', 'grammar-konjunktiv-v1', 'listening-clear-v1', 'listening-phone-v1']);
  assert.equal(EXPERT_GOLD_PROTOCOLS['phone-intelligibility-v1'].criterionId, 'speech_recognition_proxy');
  assert.equal(Object.isFrozen(EXPERT_GOLD_PROTOCOLS['listening-phone-v1']), true);
});

test('authoritative derivation abstains on thin evidence and rejects cross-account transfer state', () => {
  const baseline = { userId: 'one', sessions: [] };
  const decision = deriveExpertGoldAppDecision('clear-request-handling-v1', baseline);
  assert.equal(decision.decision, 'abstain');
  assert.equal(decision.evidenceCount, 0);
  assert.equal(decision.masteryClaimed, false);
  assert.throws(() => deriveExpertGoldAppDecision('clear-request-handling-v1', baseline,
    { userId: 'two', sessions: [] }), /one account/u);
  assert.throws(() => deriveExpertGoldAppDecision('unknown', baseline), /Unknown/u);
});

test('pack is blinded, media-bound, smoke-excluded, and missing denominators fail release gates', async () => {
  const { directory, built } = await fixture();
  try {
    const visible = JSON.stringify(built.pack);
    assert.doesNotMatch(visible, /account_01|appDecision|participantHash|decisionBinding/u);
    assert.match(visible, /base_a\.wav/u);
    assert.equal(built.key.items[0].artifactHashes['base_a.wav'].length, 64);
    verifyFrozenExpertGoldStudy(null, built, structuredClone(built.pack), structuredClone(built.key));
    const a = review(built.pack, 'qualified_a'); const b = review(built.pack, 'qualified_b');
    const comparison = compareExpertReviews(built.pack, a, b);
    assert.equal(comparison.agreements, 1);
    const disagreements = createExpertDisagreementPack(built.pack, a, b);
    assert.equal(disagreements.items.length, 0);
    const report = finalizeExpertGoldStudy(built.pack, built.key, a, b,
      { schemaVersion: 2, adjudicatorId: 'qualified_c', qualificationAttested: true, items: [] });
    assert.equal(report.appComparison.targetParticipantCount, 0);
    assert.equal(report.smoke.excludedFromAccuracyClaims, true);
    assert.equal(report.status, 'pilot-evidence-only');
    assert.equal(Object.values(report.releaseGates).every(Boolean), false);
    assert.doesNotMatch(JSON.stringify(report), /account_01|base_a\.wav|qualified_[abc]/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('review validation rejects one rater, incomplete ratings, unknown fields, and incompatible modality substitution', async () => {
  const { directory, built } = await fixture();
  try {
    const a = review(built.pack, 'same_rater');
    assert.throws(() => compareExpertReviews(built.pack, a, review(built.pack, 'same_rater')), /distinct/u);
    const incomplete = review(built.pack, 'other'); incomplete.verdicts = [];
    assert.throws(() => compareExpertReviews(built.pack, a, incomplete), /incomplete/u);
    const extra = review(built.pack, 'other'); extra.verdicts[0].manualAppVerdict = 'selected';
    assert.throws(() => compareExpertReviews(built.pack, a, extra), /unknown fields/u);
    const listening = deriveExpertGoldAppDecision('listening-clear-v1', { userId: 'one', sessions: [{
      sessionId: 'spoken-only', targetRoleType: 'customer_service', evidenceQuality: { prescriptionEligible: true },
    }] });
    assert.equal(listening.decision, 'abstain');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('provenance fails closed for modified evidence, reused media, and prototype-key profile artifacts', async () => {
  const { directory, studyInput, built } = await fixture();
  try {
    const changed = structuredClone(built.key); changed.items[0].appDecision.decision = 'selected';
    assert.throws(() => verifyFrozenExpertGoldStudy(null, built, built.pack, changed), /does not match/u);
    const duplicate = input({ baselineArtifacts: ['base_a.wav', 'base_a.wav'] });
    const profiles = await loadExpertGoldProfiles(duplicate, directory);
    await assert.rejects(() => buildExpertGoldStudy(duplicate, { profiles, baseDirectory: directory }), /reused/u);
    await writeFile(path.join(directory, 'baseline.json'), '{"userId":"account_01","nested":{"__proto__":{"polluted":true}},"sessions":[]}');
    await assert.rejects(() => loadExpertGoldProfiles(studyInput, directory), /forbidden object key/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
