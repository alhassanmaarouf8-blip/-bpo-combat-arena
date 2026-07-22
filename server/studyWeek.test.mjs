/**
 * studyWeek.test.mjs — pins the "study 5, rest 2" weekly cap: Monday-start weeks, the distinct-day
 * count, the anti-gaming (can't exceed the cap), continue-today-if-already-studied, and no-limit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mondayOf, weekStudyStatus, DEFAULT_STUDY_DAYS_PER_WEEK } from './studyWeek.js';

// Fixed reference: 2026-07-22 is a Wednesday. Its week Monday is 2026-07-20.
const WED = Date.parse('2026-07-22T09:00:00Z');   // ~noon Cairo
const usage = (keys) => Object.fromEntries(keys.map((k) => [k, 300]));   // 5 min each

test('mondayOf: resolves the Monday of the containing week', () => {
  assert.equal(mondayOf('2026-07-22'), '2026-07-20');   // Wed → Mon
  assert.equal(mondayOf('2026-07-20'), '2026-07-20');   // Mon → itself
  assert.equal(mondayOf('2026-07-26'), '2026-07-20');   // Sun → prior Mon
  assert.equal(mondayOf('2026-07-27'), '2026-07-27');   // next Mon → itself
});

test('under the cap: a new study day is allowed', () => {
  // Mon+Tue studied (2 days), today Wed not yet → allowed as the 3rd.
  const s = weekStudyStatus(usage(['2026-07-20', '2026-07-21']), 5, WED);
  assert.equal(s.studyDaysThisWeek, 2);
  assert.equal(s.todayIsStudyDay, false);
  assert.equal(s.allowedToday, true);
  assert.equal(s.restDaysLeft, 3);
});

test('AT the cap on a fresh day: blocked (this would be the 6th study day)', () => {
  // 5 distinct study days already (Mon–Fri of a PAST scenario) — but cap counts THIS week only.
  // Use Mon–Fri of the current week, today = a 6th distinct day would exceed. Simulate today as Sat.
  const SAT = Date.parse('2026-07-25T09:00:00Z');       // Sat of the same week
  const s = weekStudyStatus(usage(['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']), 5, SAT);
  assert.equal(s.studyDaysThisWeek, 5);
  assert.equal(s.todayIsStudyDay, false);
  assert.equal(s.allowedToday, false);                  // rest day — can't start a 6th
  assert.equal(s.restDaysLeft, 0);
});

test('continue today: if today is already a study day, always allowed (no mid-day lockout)', () => {
  // Today = Friday; Mon–Fri all studied (5, incl. today) → the 5th day is today; continuing is fine.
  const FRI = Date.parse('2026-07-24T09:00:00Z');
  const s = weekStudyStatus(usage(['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']), 5, FRI);
  assert.equal(s.studyDaysThisWeek, 5);
  assert.equal(s.todayIsStudyDay, true);
  assert.equal(s.allowedToday, true);                   // today already counts → keep going
});

test('anti-gaming: prior-week usage does not count against this week', () => {
  const s = weekStudyStatus(usage(['2026-07-13', '2026-07-14', '2026-07-15']), 5, WED);   // all last week
  assert.equal(s.studyDaysThisWeek, 0);                 // this week is fresh
  assert.equal(s.allowedToday, true);
});

test('no weekly limit when cap<=0 (e.g. the free one-time fight)', () => {
  const s = weekStudyStatus(usage(['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']), 0, Date.parse('2026-07-25T09:00:00Z'));
  assert.equal(s.allowedToday, true);
  assert.equal(s.restDaysLeft, null);
  assert.equal(DEFAULT_STUDY_DAYS_PER_WEEK, 5);
});

test('zero-usage days do not count as study days', () => {
  const s = weekStudyStatus({ '2026-07-20': 0, '2026-07-21': 300 }, 5, WED);
  assert.equal(s.studyDaysThisWeek, 1);                 // only the 300-sec day counts
});
