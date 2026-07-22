/**
 * marginEngine.test.mjs — pins the Phase 6 margin math: gross-margin definition, the
 * affordable-allowance formula, and the break-even price solver, with hand-checkable numbers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGET_MARGIN, paymentFeeUsd, marginFor, affordableVoiceMinutes, priceForTarget }
  from './marginEngine.js';
import { egpToUsd, EGP_PER_USD, PAYMENT_FEE } from './margin.config.js';

// A clean cost set for arithmetic (independent of the real price book).
const COSTS = { voiceMinUsd: 0.02, analysisPerSessionUsd: 0.005, infraPerUserUsd: 0 };

test('paymentFee = pct·revenue + fixed', () => {
  assert.ok(Math.abs(paymentFeeUsd(20) - (20 * PAYMENT_FEE.pct + PAYMENT_FEE.fixedUsd)) < 1e-9);
  assert.equal(paymentFeeUsd(0), 0);
});

test('marginFor: heavy usage under a low price is correctly BELOW target', () => {
  // Basic 999 EGP → ~$20.4 gross. Heavy: 900 voice-min/mo × $0.02 = $18 + analysis + fee → margin ≪ 0.8.
  const m = marginFor(999, { voiceMinPerMonth: 900, sessionsPerMonth: 60 }, COSTS);
  assert.ok(m.revenue > 20 && m.revenue < 21, `rev=${m.revenue}`);
  assert.ok(m.margin < TARGET_MARGIN, `expected <0.8, got ${m.margin}`);
  assert.ok(m.cogs.voice === 18 && m.cogs.total > 18);
});

test('affordableVoiceMinutes: the max minutes that still hold 80% at 100% usage', () => {
  // rev=egpToUsd(999); voiceBudget=(0.2·rev − analysis − fee); minutes=voiceBudget/0.02.
  const rev = egpToUsd(999);
  const sessions = 60;
  const fee = rev * PAYMENT_FEE.pct + PAYMENT_FEE.fixedUsd;
  const expected = (0.2 * rev - sessions * COSTS.analysisPerSessionUsd - fee) / COSTS.voiceMinUsd;
  const got = affordableVoiceMinutes(999, sessions, COSTS);
  assert.ok(Math.abs(got - expected) < 1e-6, `got ${got} vs ${expected}`);
  // And a plan priced at that allowance/usage lands exactly on target.
  const m = marginFor(999, { voiceMinPerMonth: got, sessionsPerMonth: sessions }, COSTS);
  assert.ok(Math.abs(m.margin - TARGET_MARGIN) < 1e-6, `margin ${m.margin}`);
});

test('affordableVoiceMinutes: null when the price cannot even cover non-voice COGS at target', () => {
  // A tiny price whose 20% budget is smaller than the fixed fee → null.
  assert.equal(affordableVoiceMinutes(1, 0, COSTS), null);
});

test('priceForTarget: the EGP price that hits 80% for a given consumption checks out', () => {
  const usage = { voiceMinPerMonth: 300, sessionsPerMonth: 30 };
  const price = priceForTarget(usage, COSTS, TARGET_MARGIN, EGP_PER_USD.rate);
  const m = marginFor(price, usage, COSTS);
  assert.ok(Math.abs(m.margin - TARGET_MARGIN) < 1e-3, `margin ${m.margin} at price ${price}`);
});
