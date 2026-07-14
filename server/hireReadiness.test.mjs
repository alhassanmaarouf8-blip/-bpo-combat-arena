/**
 * hireReadiness.test.mjs — textFeatures() is now load-bearing for TWO features (the hire-readiness
 * diagnostic AND, as of 2026-07-02, Flow-Drill's structural-complexity signal) but had zero test
 * coverage. Covers the honest <20-word gate (never fabricate a rate from too little text) and
 * real subordinate-clause detection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hireReadinessFor, textFeatures } from './hireReadiness.js';

test('textFeatures: under 20 words returns null rates (honest gate, no fabricated signal)', () => {
  const f = textFeatures('Ich habe drei Jahre Erfahrung im Kundenservice.');
  assert.equal(f.subClauseRate, null);
  assert.equal(f.vocabDiversity, null);
  assert.ok(f.wordCount < 20);
});

test('textFeatures: a long, subordinate-clause-rich answer gets a real, non-zero rate', () => {
  const text = 'Ich habe drei Jahre Erfahrung im Kundenservice gesammelt, weil ich schon immer gerne '
    + 'mit Menschen gearbeitet habe, und ich glaube, dass ich sehr gut zuhören kann, wenn ein Kunde '
    + 'ein Problem hat, das schnell gelöst werden muss.';
  const f = textFeatures(text);
  assert.ok(f.wordCount >= 20);
  assert.ok(f.subClauseRate > 0, `expected subClauseRate > 0, got ${f.subClauseRate}`);
});

test('textFeatures: a long answer with NO subordinate clauses gets a rate near zero', () => {
  const text = 'Ich bin Ahmed. Ich habe drei Jahre Erfahrung. Ich arbeite gerne im Team. Ich bin '
    + 'pünktlich. Ich lerne schnell neue Dinge. Ich helfe gerne anderen Kollegen im Büro jeden Tag.';
  const f = textFeatures(text);
  assert.ok(f.wordCount >= 20);
  assert.equal(f.subClauseRate, 0);
});

test('textFeatures: vocabDiversity is bounded to [0.2, 0.8] even for extreme repetition', () => {
  const repeated = Array(25).fill('immer').join(' ');
  const f = textFeatures(repeated);
  assert.ok(f.vocabDiversity >= 0.2 && f.vocabDiversity <= 0.8);
});

test('hire readiness refuses perfect-looking metrics from a thin session', () => {
  const result = hireReadinessFor({ assessmentResult: { estimatedLevel: 'B1' }, sessions: [{
    date: 1, answers: 1, words: 12, wpm: 150, fillers: 0, grammarRules: [], subClauseRate: 1,
    vocabDiversity: 0.8, deescalation: 1, giveUpRate: 0, intelligibility: 1, latencyS: 0.5,
  }] });
  assert.equal(result.hireReady, null);
  assert.equal(result.limitingSkill, null);
  assert.deepEqual(result.interviewRisk, { state: 'measure_first', confidence: 'insufficient', limitingSkill: null });
});

test('hire readiness names only an observed risk from a reliable packet', () => {
  const result = hireReadinessFor({ sessions: [{
    date: 1, wpm: 120, fillers: 2, grammarRules: [], subClauseRate: 0.3,
    vocabDiversity: 0.5, deescalation: 0.8, giveUpRate: 0.1, intelligibility: 0.4, latencyS: 2,
    evidenceQuality: { version: 1, prescriptionEligible: true, highConfidence: true },
  }] });
  assert.equal(result.hireReady, false);
  assert.equal(result.limitingSkill, 'intelligibility');
  assert.deepEqual(result.interviewRisk, { state: 'observed_risk', confidence: 'high', limitingSkill: 'intelligibility' });
});
