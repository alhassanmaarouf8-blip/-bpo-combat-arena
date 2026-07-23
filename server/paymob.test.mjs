import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { amountForPlan, computeHmac, verifyHmac, paymobEnabled } from './paymob.js';
import { PLANS, offerPrice } from './plans.config.js';

// ── amountForPlan: charges the SAME price as the Vodafone-Cash rail ─────────────────────────────
test('amountForPlan matches the plan price in cents', () => {
  const b = amountForPlan('basic', 'monthly');
  assert.equal(b.plan, 'basic');
  assert.equal(b.billingPeriod, 'monthly');
  assert.equal(b.amountEGP, offerPrice(PLANS.basic.priceEGP));
  assert.equal(b.amountCents, Math.round(offerPrice(PLANS.basic.priceEGP) * 100));

  const y = amountForPlan('elite', 'yearly');
  assert.equal(y.billingPeriod, 'yearly');
  assert.equal(y.amountCents, Math.round(offerPrice(PLANS.elite.yearlyEGP) * 100));
});

test('amountForPlan rejects unknown / free plans', () => {
  assert.equal(amountForPlan('free', 'monthly'), null);
  assert.equal(amountForPlan('nonsense', 'monthly'), null);
  assert.equal(amountForPlan(undefined, 'monthly'), null);
});

// ── HMAC: exact Paymob field order is pinned (a reorder or a missing field breaks this) ──────────
const sampleObj = {
  amount_cents: 99900, created_at: '2026-07-23T12:00:00', currency: 'EGP', error_occured: false,
  has_parent_transaction: false, id: 123456, integration_id: 4001, is_3d_secure: true, is_auth: false,
  is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
  order: { id: 78910, merchant_order_id: 'op_abc123' }, owner: 555, pending: false,
  source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true,
};

test('computeHmac uses the exact Paymob field order (SHA512 of the ordered concatenation)', () => {
  const secret = 'test_hmac_secret';
  const expectedConcat =
    '99900' + '2026-07-23T12:00:00' + 'EGP' + 'false' + 'false' +
    '123456' + '4001' + 'true' + 'false' + 'false' + 'false' + 'true' + 'false' +
    '78910' + '555' + 'false' + '2346' + 'MasterCard' + 'card' + 'true';
  const expected = crypto.createHmac('sha512', secret).update(expectedConcat).digest('hex');
  assert.equal(computeHmac(sampleObj, secret), expected);
});

test('verifyHmac accepts the correct signature and rejects tampering', () => {
  const secret = 'test_hmac_secret';
  const good = computeHmac(sampleObj, secret);
  assert.equal(verifyHmac(sampleObj, good, secret), true);
  // wrong secret
  assert.equal(verifyHmac(sampleObj, good, 'other_secret'), false);
  // tampered amount → different signature → reject with the real signer's key
  const tampered = { ...sampleObj, amount_cents: 1 };
  assert.equal(verifyHmac(tampered, good, secret), false);
  // missing/empty hmac
  assert.equal(verifyHmac(sampleObj, '', secret), false);
  assert.equal(verifyHmac(sampleObj, good, ''), false);
});

test('paymobEnabled is false without full config (dark by default)', () => {
  // No PAYMOB_* env in the test process → must be off, never half-armed.
  assert.equal(paymobEnabled(), false);
});
