/**
 * hireReadiness.test.mjs — textFeatures() is now load-bearing for TWO features (the hire-readiness
 * diagnostic AND, as of 2026-07-02, Flow-Drill's structural-complexity signal) but had zero test
 * coverage. Covers the honest <20-word gate (never fabricate a rate from too little text) and
 * real subordinate-clause detection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { textFeatures } from './hireReadiness.js';

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
