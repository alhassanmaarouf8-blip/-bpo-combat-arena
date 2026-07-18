import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultProfile } from './store.js';
import { dayKey } from './time.js';
import { buildDaily, completeDaily, gradeDailyItem } from './daily.js';

const readClient = (path) => readFile(new URL(`../client/src/${path}`, import.meta.url), 'utf8');

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

test('legacy grammar labels are never served or graded as production answers', () => {
  const p = defaultProfile('daily-corrupt-label');
  p.srs.push({
    id: 'grammar:case-label', type: 'grammar', content: 'Kasus (Fall) nach Präposition',
    prompt: 'Wende korrekt an: Kasus (Fall) nach Präposition',
    answer: 'Kasus (Fall) nach Präposition', example: null,
    stage: 0, due: 0, reps: 0, lapses: 0, mastered: false,
  });
  p.dailyPractice = { date: dayKey(), questionIds: ['grammar:case-label'], grades: {} };
  const daily = buildDaily(p);
  assert.equal(daily.questions.some((question) => question.id === 'grammar:case-label'), false);
  assert.equal(gradeDailyItem(p, 'grammar:case-label', 'Kasus (Fall) nach Präposition').error, 'daily_session_required');
});

test('fake repairs with identical wrong and right sentences never reach the learner', () => {
  const p = defaultProfile('daily-identical-repair');
  const sentence = 'Ja, weil ich Erfahrung gesammelt habe.';
  p.srs.push({
    id: 'grammar:fake-repair', type: 'grammar', content: 'Satzbau',
    prompt: `Korrigiere: ${sentence}`, answer: sentence,
    example: { wrong: sentence, right: sentence },
    stage: 0, due: 0, reps: 0, lapses: 0, mastered: false,
  });
  p.dailyPractice = { date: dayKey(), questionIds: ['grammar:fake-repair'], grades: {} };
  const daily = buildDaily(p);
  assert.equal(daily.questions.some((question) => question.id === 'grammar:fake-repair'), false);
  assert.equal(gradeDailyItem(p, 'grammar:fake-repair', sentence).error, 'daily_session_required');
});

test('a repair answer must match the stored corrected example', () => {
  const p = defaultProfile('daily-mismatched-answer');
  p.srs.push({
    id: 'grammar:mismatched-answer', type: 'grammar', content: 'Nebensatz',
    prompt: 'Korrigiere den weil-Satz.', answer: 'Eine andere Antwort.',
    example: { wrong: 'Weil ich habe Erfahrung.', right: 'Weil ich Erfahrung habe.' },
    stage: 0, due: 0, reps: 0, lapses: 0, mastered: false,
  });
  p.dailyPractice = { date: dayKey(), questionIds: ['grammar:mismatched-answer'], grades: {} };
  const daily = buildDaily(p);
  assert.equal(daily.questions.some((question) => question.id === 'grammar:mismatched-answer'), false);
});

test('daily German practice is isolated from RTL and explains the two card purposes', async () => {
  const source = await readClient('DailyTraining.jsx');
  assert.match(source, /dir="ltr" lang="de"/u);
  assert.match(source, /ZUSATZ · SATZ FÜR DEN JOB/u);
  assert.match(source, /Unabhängig von deinem Reparaturblock unten/u);
  assert.match(source, /Zielantwort:/u);
  assert.match(source, /ZIELANTWORT VOLLSTÄNDIG EINGEBEN/u);
  assert.doesNotMatch(source, /ERST TIPPEN/u);
});

test('a stored grammar repair exposes its focus once without repeating the original sentence', () => {
  const p = defaultProfile('daily-focus-label');
  p.srs.push({
    id: 'grammar:focus-label', type: 'grammar', content: 'Verb am Ende nach weil',
    prompt: 'Korrigiere: „Weil ich habe Erfahrung."', answer: 'Weil ich Erfahrung habe.',
    example: { wrong: 'Weil ich habe Erfahrung.', right: 'Weil ich Erfahrung habe.' },
    stage: 0, due: 0, reps: 0, lapses: 0, mastered: false,
  });
  const daily = buildDaily(p);
  const card = daily.questions.find((question) => question.id === 'grammar:focus-label');
  assert.equal(card.focus, 'Verb am Ende nach weil');
  assert.equal(card.hint, null);
  assert.equal((JSON.stringify(card).match(/Weil ich habe Erfahrung\./gu) || []).length, 1);
});

test('grammar focus is bounded and strips control and bidirectional characters', () => {
  const p = defaultProfile('daily-safe-focus');
  p.srs.push({
    id: 'grammar:safe-focus', type: 'grammar', content: `Satzbau\u202e${'x'.repeat(180)}`,
    prompt: 'Korrigiere: „Ich denke ich kann das."', answer: 'Ich denke, dass ich das kann.',
    example: { wrong: 'Ich denke ich kann das.', right: 'Ich denke, dass ich das kann.' },
    stage: 0, due: 0, reps: 0, lapses: 0, mastered: false,
  });
  const card = buildDaily(p).questions.find((question) => question.id === 'grammar:safe-focus');
  assert.ok(card.focus.length <= 120);
  assert.doesNotMatch(card.focus, /\u202e/u);
});
