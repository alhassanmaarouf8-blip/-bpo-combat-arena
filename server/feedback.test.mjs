/**
 * feedback.test.mjs — buildPublicRatings() is the honesty gate for landing-page social proof:
 * the real average must come from every consented + approved rating (never just the quotes),
 * and a thin or unapproved sample must report unavailable rather than posing as proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicRatings } from './feedback.js';

const entry = (rating, text = '', daysAgo = 0) => ({
  rating, text, timestamp: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  publicConsentAt: new Date().toISOString(),
  publicApprovedAt: new Date().toISOString(),
});

const padToMinimum = (items) => [
  ...items,
  ...Array.from({ length: Math.max(0, 10 - items.length) }, (_, i) => entry(4, '', 100 + i)),
];

test('buildPublicRatings: zero ratings → unavailable (never a fabricated placeholder)', () => {
  assert.deepEqual(buildPublicRatings([]), { available: false });
  assert.deepEqual(buildPublicRatings([{ text: 'no rating field' }]), { available: false });
});

test('buildPublicRatings: hides thin samples and shows ten approved, consented ratings', () => {
  assert.deepEqual(buildPublicRatings([entry(5, 'Toll!'), entry(4, 'Gut')]), { available: false });
  const out = buildPublicRatings(padToMinimum([entry(5, 'Toll!'), entry(4, 'Gut')]));
  assert.equal(out.available, true);
  assert.equal(out.ratingCount, 10);
});

test('buildPublicRatings: never publishes without both independent gates', () => {
  const noConsent = padToMinimum([entry(5, 'private')]).map((e) => ({ ...e, publicConsentAt: null }));
  const noApproval = padToMinimum([entry(5, 'pending')]).map((e) => ({ ...e, publicApprovedAt: null }));
  assert.deepEqual(buildPublicRatings(noConsent), { available: false });
  assert.deepEqual(buildPublicRatings(noApproval), { available: false });
});

test('buildPublicRatings: average is computed over ALL ratings, including low ones not shown as quotes', () => {
  const all = [entry(5, 'Super'), entry(5, 'Klasse'), entry(1), entry(5), entry(5), entry(2),
    entry(1), entry(1), entry(1), entry(1)];
  const out = buildPublicRatings(all);
  assert.equal(out.available, true);
  assert.equal(out.ratingCount, 10);
  // (5+5+1+5+5+2+1+1+1+1)/10 = 2.7, not an inflated quote-only score.
  assert.equal(out.avgRating, 2.7);
});

test('buildPublicRatings: comments are sampled only from rating>=4 with real text', () => {
  const all = [
    entry(5, 'Hat mir wirklich geholfen'), entry(2, 'War nicht so gut'), entry(4, ''),   // empty text excluded
    entry(5, 'Klare Empfehlung'), entry(3, 'Okay'), entry(4, 'Guter Fortschritt'),
  ];
  const out = buildPublicRatings(padToMinimum(all));
  assert.ok(out.comments.every((c) => c.rating >= 4 && c.text.length > 0));
  assert.equal(out.comments.length, 3);   // the 3 non-empty rating>=4 entries
});

test('buildPublicRatings: a public comment carries ONLY name/rating/text — never email/userId/timestamp', () => {
  const all = Array.from({ length: 10 }, (_, i) => ({
    ...entry(5, `Kommentar ${i}`), name: 'Omar', email: 'student@example.com', userId: 'a_123',
  }));
  const out = buildPublicRatings(all);
  for (const c of out.comments) {
    assert.deepEqual(Object.keys(c).sort(), ['name', 'rating', 'text']);
    assert.equal(c.name, 'Omar');
    assert.ok(!('email' in c) && !('userId' in c) && !('timestamp' in c), 'no PII beyond the chosen name');
  }
});

test('buildPublicRatings: an entry with no name shows the neutral label, never the email', () => {
  const all = padToMinimum([{ ...entry(5, 'Hilfreich'), email: 'secret@example.com', userId: 'a_9' }]);
  const out = buildPublicRatings(all);
  assert.equal(out.comments[0].name, 'Ein Lernender');
  assert.ok(!JSON.stringify(out).includes('secret@example.com'), 'email must never appear anywhere in the public payload');
});

test('buildPublicRatings: comment text is capped in length', () => {
  const out = buildPublicRatings(padToMinimum([entry(5, 'x'.repeat(500))]));
  assert.ok(out.comments[0].text.length <= 200);
});

test('buildPublicRatings: caps at MAX_PUBLIC_COMMENTS even with many eligible entries', () => {
  const all = Array.from({ length: 20 }, (_, i) => entry(5, `Kommentar ${i}`, i));
  const out = buildPublicRatings(all);
  assert.equal(out.comments.length, 6);
});

test('buildPublicRatings: newest comments are preferred', () => {
  const out = buildPublicRatings(padToMinimum([entry(5, 'alt', 30), entry(5, 'neu', 0)]));
  assert.equal(out.comments[0].text, 'neu');
});

test('buildPublicRatings: gracefully handles malformed input', () => {
  assert.deepEqual(buildPublicRatings(null), { available: false });
  assert.deepEqual(buildPublicRatings(undefined), { available: false });
});
