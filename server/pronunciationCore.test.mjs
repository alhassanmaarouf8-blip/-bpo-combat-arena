import test from 'node:test';
import assert from 'node:assert/strict';
import { actionablePronunciationPatterns, analyzePronunciationAttempt, evaluatePronunciationRelease,
  measureProfessionalClarity, measureRecordingQuality, pronunciationFlags, wilsonLower } from './pronunciationCore.js';
import { PRONUNCIATION_DEVIATIONS, PRONUNCIATION_PROTOCOL_VERSION, releasedPronunciationDeviation } from './pronunciationRegistry.js';

function wav({ seconds = 1, amplitude = 4000, clipped = false, rate = 24000 } = {}) {
  const samples = Math.floor(seconds * rate); const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + samples * 2, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(clipped ? 32767 : Math.round(Math.sin(i / 9) * amplitude), 44 + i * 2);
  return out;
}

const ENV = { PRONUNCIATION_MODE: 'on', PRONUNCIATION_PROMPTED_ENABLED: 'true',
  PRONUNCIATION_SPONTANEOUS_ENABLED: 'true', PRONUNCIATION_MODEL_VERSION: 'test-model-v1',
  PRONUNCIATION_PROTOCOL_VERSION };
const RELEASES = { vowel_length: { passed: true, protocolVersion: PRONUNCIATION_PROTOCOL_VERSION } };

test('registry is frozen, explicit, and unvalidated by default', () => {
  assert.ok(Object.isFrozen(PRONUNCIATION_DEVIATIONS));
  assert.equal(PRONUNCIATION_DEVIATIONS.vowel_length.releaseStatus, 'unvalidated');
  assert.equal(releasedPronunciationDeviation('vowel_length', {}), null);
  assert.ok(releasedPronunciationDeviation('vowel_length', RELEASES));
});

test('flags fail closed for missing, unknown, beta-other, and missing independent switches', () => {
  assert.equal(pronunciationFlags({}).enabled, false);
  assert.equal(pronunciationFlags({ PRONUNCIATION_MODE: 'wat' }).enabled, false);
  assert.equal(pronunciationFlags({ PRONUNCIATION_MODE: 'beta', PRONUNCIATION_BETA_ACCOUNT_IDS: 'a' }, 'b').enabled, false);
  assert.deepEqual(pronunciationFlags({ PRONUNCIATION_MODE: 'on' }, 'a').prompted, false);
});

test('recording quality separates usable, quiet, clipped, malformed, and short capture', () => {
  const usable = measureRecordingQuality(wav()); assert.equal(usable.status, 'usable');
  assert.equal(usable.noiseStatus, 'unmeasured'); assert.equal(usable.echoStatus, 'unmeasured');
  assert.equal(measureRecordingQuality(wav({ amplitude: 20 })).reason, 'silence_or_too_quiet');
  assert.equal(measureRecordingQuality(wav({ clipped: true })).reason, 'clipped');
  assert.equal(measureRecordingQuality(Buffer.from('not-wave')).status, 'failed');
  assert.equal(measureRecordingQuality(wav({ seconds: 0.1 })).reason, 'unsupported_or_short_audio');
});

test('professional clarity emits raw timing measurements without an unvalidated learner claim', () => {
  const measured = measureProfessionalClarity({ durationMs: 3_000, words: [
    { word: 'wir', start: 0, end: .2 }, { word: 'helfen', start: .3, end: .7 }, { word: 'gern', start: 1.4, end: 1.7 },
  ] });
  assert.equal(measured.status, 'measured'); assert.equal(measured.pauseCount, 1);
  assert.equal(measured.claimStatus, 'raw_measurement_only');
  assert.equal(measureProfessionalClarity({ durationMs: 100, words: [] }).status, 'abstained');
});

test('no detector and unvalidated detector category always abstain', async () => {
  const base = { accountId: 'acct', attemptId: 'attempt_1234', targetId: 'shadowing:1', targetText: 'Guten Morgen',
    surface: 'shadowing', audio: wav(), env: ENV };
  assert.equal((await analyzePronunciationAttempt(base)).abstentionReason, 'detector_unvalidated');
  const detector = async () => ({ protocolVersion: PRONUNCIATION_PROTOCOL_VERSION, modelVersion: 'test-model-v1',
    wordObservations: [{ categoryId: 'vowel_length', word: 'Morgen', expectedClass: 'oː', observedClass: 'ɔ',
      impact: 'clarity_risk', confidence: 'very_high', detectorId: 'fake' }] });
  assert.equal((await analyzePronunciationAttempt({ ...base, detector })).abstentionReason, 'detector_output_invalid');
});

test('released detector output is bounded and evidence-bound without audio leakage', async () => {
  const detector = async () => ({ protocolVersion: PRONUNCIATION_PROTOCOL_VERSION, modelVersion: 'test-model-v1',
    wordObservations: [{ categoryId: 'vowel_length', word: 'bieten', expectedClass: 'iː', observedClass: 'ɪ',
      impact: 'clarity_risk', confidence: 'very_high', detectorId: 'fixture' }] });
  const result = await analyzePronunciationAttempt({ accountId: 'acct', attemptId: 'attempt_1234',
    targetId: 'shadowing:1', targetText: 'Wir bieten eine Lösung an.', surface: 'shadowing', audio: wav(),
    env: ENV, detector, releases: RELEASES });
  assert.equal(result.status, 'measured'); assert.match(result.evidenceReceipt, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes('RIFF'), false);
  assert.equal(Object.hasOwn(result, 'audio'), false);
});

test('marginal or failed audio vetoes even a detector', async () => {
  let called = 0; const detector = async () => { called++; return {}; };
  const result = await analyzePronunciationAttempt({ accountId: 'acct', attemptId: 'attempt_1234', targetId: 'x',
    targetText: 'Test', surface: 'shadowing', audio: wav({ clipped: true }), env: ENV, detector, releases: RELEASES });
  assert.equal(result.abstentionReason, 'recording_failed'); assert.equal(called, 0);
});

test('actionable patterns require one very-high intelligibility event or two distinct bound words', () => {
  const a = 'a'.repeat(64); const b = 'b'.repeat(64);
  assert.deepEqual(actionablePronunciationPatterns([{ categoryId: 'vowel_length', word: 'bieten', confidence: 'high',
    impact: 'clarity_risk', evidenceReceipt: a }]), []);
  assert.deepEqual(actionablePronunciationPatterns([
    { categoryId: 'vowel_length', word: 'bieten', confidence: 'high', impact: 'clarity_risk', evidenceReceipt: a },
    { categoryId: 'vowel_length', word: 'Miete', confidence: 'high', impact: 'clarity_risk', evidenceReceipt: b },
  ]), ['vowel_length']);
  assert.deepEqual(actionablePronunciationPatterns([{ categoryId: 'consonant_cluster', word: 'spricht', confidence: 'very_high',
    impact: 'intelligibility_risk', evidenceReceipt: a }]), ['consonant_cluster']);
});

test('release math fails missing denominators and enforces every frozen gate', () => {
  assert.equal(wilsonLower(0, 0), null);
  assert.equal(evaluatePronunciationRelease({}).passed, false);
  const passing = { expertKappa: .8, correctionTruePositive: 99, correctionTotal: 100,
    abstentionCorrect: 96, abstentionTotal: 100, highImpactDetected: 90, highImpactTotal: 100,
    harmfulAcceptedVariantCorrections: 0 };
  assert.equal(evaluatePronunciationRelease(passing).passed, true);
  assert.equal(evaluatePronunciationRelease({ ...passing, harmfulAcceptedVariantCorrections: 1 }).passed, false);
  assert.equal(evaluatePronunciationRelease({ ...passing, highImpactDetected: 84 }).passed, false);
});

test('invalid surface, target binding, version mismatch, and detector failure abstain', async () => {
  const base = { accountId: 'acct', attemptId: 'attempt_1234', targetId: 'shadowing:1', targetText: 'Guten Morgen',
    surface: 'shadowing', audio: wav(), env: ENV, releases: RELEASES };
  assert.equal((await analyzePronunciationAttempt({ ...base, surface: 'unknown' })).abstentionReason, 'unsupported_surface');
  assert.equal((await analyzePronunciationAttempt({ ...base, attemptId: 'x' })).abstentionReason, 'invalid_target_binding');
  assert.equal((await analyzePronunciationAttempt({ ...base, env: { ...ENV, PRONUNCIATION_PROTOCOL_VERSION: 'wrong' } })).abstentionReason, 'version_unavailable');
  assert.equal((await analyzePronunciationAttempt({ ...base, detector: async () => { throw new Error('boom'); } })).abstentionReason, 'detector_failed');
});
