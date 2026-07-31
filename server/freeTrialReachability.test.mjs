// The free day must be REACHABLE — the ratchet for the 2026-07-31 defect.
//
// FREE_TRIAL_DAYS went 0 -> 1 on 2026-07-25 and /api/billing/pricing advertised `trial:{days:1}`
// from that moment. But the gate that lets a free account into its first interview keyed on
// `freeFightUsed`, while the trial clock lived in `trialStartedAt` and was only ever written
// *behind* that gate. Every account that had spent its free interview while the trial was switched
// off therefore carried freeFightUsed=true + trialStartedAt=null and could never arm the trial:
// measured in production on 2026-07-31, `activeTrials` was 0 and all 8 real accounts were
// paywalled, six days after the owner shipped "one free day of Basic".
//
// The invariant these tests pin: ONE free Basic day per account, exactly once, ever — recorded by
// the single field `trialStartedAt`. Two fields meaning "already used" is what allowed the drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  trialActive, entitlement, freeFightAvailable, dailyMinutesFor, consumeFreeFight, FREE_TRIAL_DAYS,
} from './auth.js';

const DAY = 24 * 60 * 60 * 1000;
const account = (subscription) => ({ id: 'a_test', email: 'learner@example.com', subscription });

test('a brand-new free account may enter its first interview', () => {
  const acc = account({ tier: 'trial', trialStartedAt: null, freeFightUsed: false });
  assert.equal(freeFightAvailable(acc), true);
  assert.equal(entitlement(acc).allowed, true);
});

test('a pre-2026-07-25 account (free fight spent, trial never armed) still gets its free day', () => {
  // THE REGRESSION. Before the fix: allowed=false, forever, for every existing learner.
  const acc = account({ tier: 'trial', trialStartedAt: null, freeFightUsed: true });
  assert.equal(freeFightAvailable(acc), true, 'the free day must not be gated on the legacy flag');
  assert.equal(entitlement(acc).allowed, true);
});

test('the free day arms on the first accepted interview and grants Basic, not Elite', async () => {
  const acc = account({ tier: 'trial', trialStartedAt: null, freeFightUsed: true });
  await consumeFreeFight(acc);
  assert.ok(acc.subscription.trialStartedAt, 'consumeFreeFight must stamp trialStartedAt');
  assert.equal(trialActive(acc), true);
  assert.equal(dailyMinutesFor(acc), 15, 'Basic minutes during the free day');
  const ent = entitlement(acc);
  assert.equal(ent.dailySessions, 2, 'Basic interviews/day, never Elite 4');
  assert.equal(ent.zielStelle, false, 'Ziel-Stelle stays Elite-only and paid');
  assert.equal(ent.interviewResults, true, 'the verdict is the whole point of the free day');
});

test('the free day is granted ONCE — a second entry after it expires is paywalled', async () => {
  const acc = account({ tier: 'trial', trialStartedAt: null, freeFightUsed: true });
  await consumeFreeFight(acc);
  const armedAt = acc.subscription.trialStartedAt;

  // Re-entering while the day runs must not slide the clock forward.
  await consumeFreeFight(acc);
  assert.equal(acc.subscription.trialStartedAt, armedAt, 'the trial clock must never restart');

  // Once the day has passed: no trial, no minutes, no second free fight.
  acc.subscription.trialStartedAt = Date.now() - (FREE_TRIAL_DAYS * DAY + 60_000);
  assert.equal(trialActive(acc), false);
  assert.equal(freeFightAvailable(acc), false, 'an expired free day must not re-arm');
  assert.equal(entitlement(acc).allowed, false);
  assert.equal(entitlement(acc).interviewResults, false, 'verdict locked again once the day ends');
});

test('a paid account is unaffected by the free-day gate', () => {
  const acc = account({ plan: 'basic', billingPeriodEnd: Date.now() + 30 * DAY });
  assert.equal(trialActive(acc), false, 'paid users do not consume the trial');
  assert.equal(entitlement(acc).allowed, true);
});
