import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realFluencyTrend } from './progressTrend.js';

// Pins the exact dishonest cases the old debrief produced (see diagnostic 2026-07-22):
test('realFluencyTrend strips fabricated ?? 0 zeros; the old false "+improvement" can no longer be built', () => {
  // OLD: [0,55] → last-first = +55 → "+55 besser … du verbesserst dich" (fabricated from a missing value).
  assert.deepEqual(realFluencyTrend([0, 55]), [55]);
  // A real regression must NOT read as improvement: OLD [40,90,45] → last-first = +5 "du verbesserst dich"
  // though the learner fell from their peak. We keep the real values; no last-first verdict is emitted.
  assert.deepEqual(realFluencyTrend([40, 90, 45]), [40, 90, 45]);
  // All-missing → nothing to show (the card's length>1 guard then hides the sparkline — honest-when-thin).
  assert.deepEqual(realFluencyTrend([0, 0]), []);
  assert.deepEqual(realFluencyTrend([]), []);
  assert.deepEqual(realFluencyTrend(null), []);
  assert.deepEqual(realFluencyTrend([12, 0, 30, 0, 41]), [12, 30, 41]);
});
