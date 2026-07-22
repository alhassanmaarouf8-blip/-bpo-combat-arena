/**
 * hireReadinessLevel.test.mjs — the shown CEFR level must never be FABRICATED from favorable defaults.
 *
 * Bug (diagnostic 2026-07-22): featuresFromProfile fills unmeasured signals with favorable defaults
 * (wpm 100, err 6, subClauseRate 0.3, vocabDiversity 0.5), so levelOf() computes P≈0.67 → a confident
 * "B1" for a learner who has barely spoken. When no assessment estimate exists, that fabricated level
 * was shown as if measured. Fix: assert a level ONLY from a real interview packet with its core drivers
 * measured; else null. The app's own assessment estimate still wins when present.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hireReadinessFor } from './hireReadiness.js';

test('level is null (never a defaults-fabricated "B1") with no real interview packet', () => {
  const out = hireReadinessFor({ sessions: [] });
  assert.equal(out.level, null);
});

test('a session without a v2 evidence packet still yields level null (raw wpm on the session is ignored)', () => {
  const out = hireReadinessFor({ sessions: [{ date: 1, wpm: 130, words: 90 }] });
  assert.equal(out.level, null);
});

test('the app assessment estimate always wins when present', () => {
  const out = hireReadinessFor({ sessions: [], assessmentResult: { estimatedLevel: 'B2' } });
  assert.equal(out.level, 'B2');
});
