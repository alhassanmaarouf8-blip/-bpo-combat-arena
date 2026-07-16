import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from './store.js';
import { dayKey } from './time.js';
import { buildDaily, completeDaily, gradeDailyItem } from './daily.js';

function profile(id = 'daily-test') {
  const value = defaultProfile(id);
  value.dailyPractice = { date: dayKey(), questionIds: ['fb:weil-end'], grades: {} };
  return value;
}

test('daily completion fails closed until every served card has server-backed evidence', () => {
  const p = profile();
  const before = completeDaily(p);
  assert.equal(before.error, 'daily_evidence_incomplete');
  assert.equal(before.progress.remaining, 1);

  const miss = gradeDailyItem(p, 'fb:weil-end', 'Weil ich habe Erfahrung.');
  assert.equal(miss.correct, false);
  assert.equal(p.dailyPractice.grades['fb:weil-end'].state, 'repair_required');
  assert.equal(completeDaily(p).error, 'daily_evidence_incomplete');

  const repair = gradeDailyItem(p, 'fb:weil-end', 'Weil ich drei Jahre Erfahrung habe.', { repair: true });
  assert.equal(repair.correct, true);
  assert.equal(repair.progress.remaining, 0);
  const complete = completeDaily(p);
  assert.equal(complete.error, undefined);
  assert.equal(complete.completedToday, true);
});

test('a repair cannot be minted without a recorded miss, and a later bad retry cannot erase a pass', () => {
  const p = profile('daily-test-two');
  assert.equal(gradeDailyItem(p, 'fb:weil-end', 'Weil ich drei Jahre Erfahrung habe.', { repair: true }).error, 'repair_not_required');
  assert.equal(gradeDailyItem(p, 'fb:weil-end', 'Weil ich drei Jahre Erfahrung habe.').correct, true);
  assert.equal(gradeDailyItem(p, 'fb:weil-end', 'falsch').alreadyVerified, true);
  assert.equal(p.dailyPractice.grades['fb:weil-end'].state, 'correct');
  assert.equal(completeDaily(p).completedToday, true);
});

test('the daily card set stays stable across reloads and exposes only aggregate completion progress', () => {
  const p = defaultProfile('daily-test-three');
  const first = buildDaily(p);
  const firstIds = first.questions.map((question) => question.id);
  assert.ok(firstIds.length >= 3);
  assert.deepEqual(first.progress, { completed: 0, total: firstIds.length, remaining: firstIds.length });

  const reloaded = buildDaily(p);
  assert.equal(reloaded.source, 'stored');
  assert.deepEqual(reloaded.questions.map((question) => question.id), firstIds);
  assert.deepEqual(reloaded.progress, first.progress);
  assert.equal(Object.hasOwn(reloaded, 'grades'), false);
});
