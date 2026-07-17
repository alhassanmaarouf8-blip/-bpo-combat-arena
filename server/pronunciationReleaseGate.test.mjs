import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizePronunciationRelease } from '../scripts/pronunciation-release-gate.mjs';
import { PRONUNCIATION_PROTOCOL_VERSION } from './pronunciationRegistry.js';

const INPUT = { schemaVersion: 1, categoryId: 'vowel_length', protocolVersion: PRONUNCIATION_PROTOCOL_VERSION,
  modelVersion: 'model-v1', targetLearners: 30, metrics: { expertKappa: .8, correctionTruePositive: 99,
    correctionTotal: 100, abstentionCorrect: 96, abstentionTotal: 100, highImpactDetected: 90,
    highImpactTotal: 100, harmfulAcceptedVariantCorrections: 0 } };

test('release report passes only a sufficiently powered, fully gated category', () => {
  const report = finalizePronunciationRelease(INPUT); assert.equal(report.passed, true);
  assert.equal(report.evidenceClass, 'validation'); assert.equal(Object.hasOwn(report, 'participantHash'), false);
});
test('pilot denominators, harmful corrections, and missing denominators fail', () => {
  assert.equal(finalizePronunciationRelease({ ...INPUT, targetLearners: 29 }).passed, false);
  assert.equal(finalizePronunciationRelease({ ...INPUT, metrics: { ...INPUT.metrics, harmfulAcceptedVariantCorrections: 1 } }).passed, false);
  assert.equal(finalizePronunciationRelease({ ...INPUT, metrics: { ...INPUT.metrics, correctionTotal: 0 } }).passed, false);
});
test('private keys, extra fields, unknown categories, and protocol drift are rejected', () => {
  assert.throws(() => finalizePronunciationRelease({ ...INPUT, transcript: 'private' }), /forbidden/u);
  assert.throws(() => finalizePronunciationRelease({ ...INPUT, extra: true }), /unknown fields/u);
  assert.throws(() => finalizePronunciationRelease({ ...INPUT, categoryId: 'accent_bad' }), /Unknown/u);
  assert.throws(() => finalizePronunciationRelease({ ...INPUT, protocolVersion: 'old' }), /Unknown/u);
});

