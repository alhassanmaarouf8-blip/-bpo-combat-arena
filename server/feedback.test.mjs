/**
 * feedback.test.mjs — buildPublicRatings() is the honesty gate for landing-page social proof:
 * the real average must come from EVERY rating (never just the ones shown), and a thin sample
 * must report unavailable rather than posing as robust proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicRatings } from './feedback.js';

const entry = (rating, text = '', daysAgo = 0) => ({
  rating, text, timestamp: new Date(Date.now() - daysAgo * 86400000).toISOString(),
});

test('buildPublicRatings: below MIN_PUBLIC_RATINGS reports unavailable, never a thin sample', () => {
  const few = [entry(5, 'Toll!'), entry(4), entry(5), entry(5)];   // 4 ratings, threshold is 5
  assert.deepEqual(buildPublicRatings(few), { available: false });
});

test('buildPublicRatings: average is computed over ALL ratings, including low ones not shown as quotes', () => {
  const all = [entry(5, 'Super'), entry(5, 'Klasse'), entry(1), entry(5), entry(5), entry(2)];
  const out = buildPublicRatings(all);
  assert.equal(out.available, true);
  assert.equal(out.ratingCount, 6);
  // (5+5+1+5+5+2)/6 = 3.833... -> 3.8, NOT an inflated number from only the 5-star quotes
  assert.equal(out.avgRating, 3.8);
});

test('buildPublicRatings: comments are sampled only from rating>=4 with real text', () => {
  const all = [
    entry(5, 'Hat mir wirklich geholfen'), entry(2, 'War nicht so gut'), entry(4, ''),   // empty text excluded
    entry(5, 'Klare Empfehlung'), entry(3, 'Okay'), entry(4, 'Guter Fortschritt'),
  ];
  const out = buildPublicRatings(all);
  assert.ok(out.comments.every((c) => c.rating >= 4 && c.text.length > 0));
  assert.equal(out.comments.length, 3);   // the 3 non-empty rating>=4 entries
});

test('buildPublicRatings: never leaks email, name, or timestamp into a public comment', () => {
  const all = Array.from({ length: 6 }, (_, i) => ({
    rating: 5, text: `Kommentar ${i}`, email: 'student@example.com', userId: 'a_123', timestamp: new Date().toISOString(),
  }));
  const out = buildPublicRatings(all);
  for (const c of out.comments) {
    assert.deepEqual(Object.keys(c).sort(), ['rating', 'text']);
  }
});

test('buildPublicRatings: comment text is capped in length', () => {
  const long = 'x'.repeat(500);
  const all = [entry(5, long), entry(5), entry(5), entry(5), entry(5)];
  const out = buildPublicRatings(all);
  assert.ok(out.comments[0].text.length <= 200);
});

test('buildPublicRatings: caps at MAX_PUBLIC_COMMENTS even with many eligible entries', () => {
  const all = Array.from({ length: 20 }, (_, i) => entry(5, `Kommentar ${i}`, i));
  const out = buildPublicRatings(all);
  assert.equal(out.comments.length, 6);
});

test('buildPublicRatings: newest comments are preferred', () => {
  const all = [entry(5, 'alt', 30), entry(5, 'neu', 0), entry(5), entry(5), entry(5)];
  const out = buildPublicRatings(all);
  assert.equal(out.comments[0].text, 'neu');
});

test('buildPublicRatings: gracefully handles empty/malformed input', () => {
  assert.deepEqual(buildPublicRatings([]), { available: false });
  assert.deepEqual(buildPublicRatings(null), { available: false });
  assert.deepEqual(buildPublicRatings(undefined), { available: false });
});
