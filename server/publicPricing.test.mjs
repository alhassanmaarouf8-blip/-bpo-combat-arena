/**
 * publicPricing.test.mjs — GET /api/billing/pricing (the PUBLIC, pre-signup pricing route).
 *
 * Why this route exists: the measured funnel leak recorded at client/src/App.jsx ("THE OFFER AT THE
 * PEAK", elite-marketer teardown 2026-07-10) — only 8 of ~120 openers ever SAW a price, because
 * price lived behind signup + e-mail verification + the paywall. Owner decision 2026-07-24: state
 * the offer on the landing page. That makes this the FIRST unauthenticated route that reads the
 * plan objects, so it carries two standing risks this file locks down:
 *
 *   1. LEAK — /status (authed) legitimately spreads `...pl`. If anyone ever "simplifies" this
 *      public route the same way, anonymous callers get callFloor allowances, trackedApplications
 *      ceilings, jobRadar quotas and vacancy flags. The key set is asserted EXACTLY, so any new
 *      plan field silently reaching the public payload fails the build.
 *   2. DRIFT — the landing must never disagree with what entitlement() actually grants. The old
 *      landing line claimed "3 Tage Basic" while a trial user gets Elite-level sessions. Every
 *      number here is asserted against plans.config.js, the single source of truth.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-not-prod';

const { billingRouter, FREE_TRIAL_DAYS } = await import('./auth.js');
const { PLANS } = await import('./plans.config.js');

// Drive the real router over a real socket — no fake req/res, so route-level concerns
// (no auth middleware, cache headers, JSON shape) are exercised exactly as in production.
async function getPricing() {
  const app = express();
  app.use('/api/billing', billingRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/billing/pricing`);
    return { status: res.status, cacheControl: res.headers.get('cache-control'), body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('public pricing is reachable with NO auth and reports prices from plans.config.js', async () => {
  const { status, body, cacheControl } = await getPricing();
  assert.equal(status, 200, 'an anonymous visitor must be able to read the price');
  assert.equal(body.available, true, 'the client renders a price ONLY when available === true');
  assert.match(cacheControl || '', /max-age=300/, 'public marketing data should be cacheable');

  const basic = body.plans.find((p) => p.id === 'basic');
  const elite = body.plans.find((p) => p.id === 'elite');
  assert.equal(basic.priceEGP, PLANS.basic.priceEGP);
  assert.equal(elite.priceEGP, PLANS.elite.priceEGP);
  assert.equal(basic.yearlyEGP, PLANS.basic.yearlyEGP);
  // With no offer live, offerPrice() returns the original — the landing shows the real charge.
  assert.equal(basic.offerPriceEGP, PLANS.basic.priceEGP);
  assert.equal(elite.offerPriceEGP, PLANS.elite.priceEGP);
});

test('public pricing NEVER leaks internal plan shape to anonymous callers', async () => {
  const { body } = await getPricing();
  const allowed = ['id', 'label', 'priceEGP', 'yearlyEGP', 'dailySessions',
    'sessionMinutes', 'offerPriceEGP', 'offerYearlyEGP'];
  for (const plan of body.plans) {
    assert.deepEqual(
      Object.keys(plan).sort(), [...allowed].sort(),
      `public plan payload must be an explicit projection — got extra/missing keys on "${plan.id}". `
      + 'Do NOT spread ...pl here the way the AUTHED /status route does.',
    );
  }
  // Belt and braces: name the fields that would actually hurt if they ever appeared.
  const serialized = JSON.stringify(body);
  for (const secret of ['callFloor', 'trackedApplications', 'jobRadarDaily', 'vacancyLive',
    'applicationPacks', 'candidatePassport', 'opportunityCopilot', 'studyDaysPerWeek']) {
    assert.equal(serialized.includes(secret), false, `public pricing leaked "${secret}"`);
  }
});

test('public pricing states the trial grant the code ACTUALLY gives (not the old "3 Tage Basic")', async () => {
  const { body } = await getPricing();
  assert.equal(body.trial.days, FREE_TRIAL_DAYS);
  // dailyMinutesFor()/entitlement() hand an active trial the ELITE allowance (auth.js) — so the
  // landing must advertise Elite's numbers. Asserting against PLANS.elite (not a literal) means a
  // future plan change moves the promise and this test together, never one without the other.
  assert.equal(body.trial.dailySessions, PLANS.elite.dailySessions);
  assert.equal(body.trial.dailyLiveMinutes, PLANS.elite.dailyLiveMinutes);
  assert.notEqual(body.trial.dailySessions, PLANS.basic.dailySessions,
    'the trial is NOT a Basic trial — advertising it as one under-sells the product and is false');
  assert.equal(body.trial.drills, true);
  assert.equal(body.trial.zielStelle, true);
  // The always-free promise on the landing must match the free plan's real allowance.
  assert.equal(body.free.assessments, PLANS.free.assessments);
  assert.equal(body.free.freeInterviews, 1);
});
