import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundEligibility, REFUND_WINDOW_DAYS, REFUND_MAX_INTERVIEWS } from './refundPolicy.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000; // fixed "now" for determinism

test('no paid activation → not eligible, flagged hasPayment:false', () => {
  const r = refundEligibility({ planSetAt: 0, sessions: [], now: NOW });
  assert.equal(r.hasPayment, false);
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_paid_activation');
});

test('within window, zero interviews → eligible', () => {
  const r = refundEligibility({ planSetAt: NOW - 3 * DAY, sessions: [], now: NOW });
  assert.equal(r.eligible, true);
  assert.equal(r.withinWindow, true);
  assert.equal(r.interviewsUsed, 0);
  assert.equal(r.reason, 'eligible');
});

test('within window, at the max-interviews ceiling → still eligible', () => {
  const sessions = Array.from({ length: REFUND_MAX_INTERVIEWS }, (_, i) => ({ date: NOW - i * DAY }));
  const r = refundEligibility({ planSetAt: NOW - 2 * DAY, sessions, now: NOW });
  assert.equal(r.interviewsUsed, REFUND_MAX_INTERVIEWS);
  assert.equal(r.eligible, true);
});

test('within window but one interview over the ceiling → forfeited', () => {
  const sessions = Array.from({ length: REFUND_MAX_INTERVIEWS + 1 }, (_, i) => ({ date: NOW - i * DAY }));
  const r = refundEligibility({ planSetAt: NOW - 2 * DAY, sessions, now: NOW });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'used_too_many_interviews');
});

test('past the 14-day window → not eligible even with zero interviews', () => {
  const r = refundEligibility({ planSetAt: NOW - (REFUND_WINDOW_DAYS + 1) * DAY, sessions: [], now: NOW });
  assert.equal(r.withinWindow, false);
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'past_window');
});

test('exactly at the window edge (14.0 days) is still inside', () => {
  const r = refundEligibility({ planSetAt: NOW - REFUND_WINDOW_DAYS * DAY, sessions: [], now: NOW });
  assert.equal(r.withinWindow, true);
  assert.equal(r.eligible, true);
});

test('interviews taken BEFORE this activation do not count (e.g. re-subscribe)', () => {
  const sessions = [
    { date: NOW - 40 * DAY }, // an old plan's usage
    { date: NOW - 39 * DAY },
    { date: NOW - 38 * DAY },
    { date: NOW - 1 * DAY },  // one under the current activation
  ];
  const r = refundEligibility({ planSetAt: NOW - 2 * DAY, sessions, now: NOW });
  assert.equal(r.interviewsUsed, 1);
  assert.equal(r.eligible, true);
});

test('future-dated / malformed session entries are ignored', () => {
  const sessions = [{ date: NOW + 5 * DAY }, { date: null }, {}, null, { date: NOW - DAY }];
  const r = refundEligibility({ planSetAt: NOW - 3 * DAY, sessions, now: NOW });
  assert.equal(r.interviewsUsed, 1);
});

test('overrides: strict single-interview policy honored', () => {
  const sessions = [{ date: NOW - DAY }, { date: NOW - DAY }];
  const r = refundEligibility({ planSetAt: NOW - DAY, sessions, now: NOW, maxInterviews: 1 });
  assert.equal(r.eligible, false);
  assert.equal(r.maxInterviews, 1);
});
