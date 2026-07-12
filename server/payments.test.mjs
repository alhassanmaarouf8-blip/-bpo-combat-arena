import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-not-prod';

const { applyPaymentConfirmation, PAYMENT_INTENT_TTL_MS } = await import('./payments.js');
const {
  paymentStatusFromRecords, mutatePayments, loadPayments, deletePaymentsFor,
} = await import('./paymentsStore.js');
const auth = await import('./auth.js');

const uniq = (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

test('payment confirmation expires an unconfirmed intent after 24 hours', () => {
  const now = Date.now();
  const all = [{ id: 'pay_old', userId: 'u1', status: 'intent', createdAt: now - PAYMENT_INTENT_TTL_MS - 1 }];
  const out = applyPaymentConfirmation(all, {
    userId: 'u1', intentId: 'pay_old', senderLast4: '1234', now,
  });
  assert.equal(out.kind, 'expired');
  assert.equal(all[0].status, 'expired');
  assert.equal(all[0].senderLast4, undefined);
});

test('payment confirmation is idempotent and cannot rewrite the sender fingerprint', () => {
  const now = Date.now();
  const all = [{ id: 'pay_new', userId: 'u1', status: 'intent', createdAt: now - 1000 }];
  const first = applyPaymentConfirmation(all, {
    userId: 'u1', intentId: 'pay_new', senderLast4: '1234', now,
  });
  const replay = applyPaymentConfirmation(all, {
    userId: 'u1', intentId: 'pay_new', senderLast4: '1234', now: now + 1000,
  });
  const conflict = applyPaymentConfirmation(all, {
    userId: 'u1', intentId: 'pay_new', senderLast4: '9999', now: now + 2000,
  });
  assert.equal(first.kind, 'ok');
  assert.equal(replay.kind, 'ok');
  assert.equal(conflict.kind, 'conflict');
  assert.equal(all[0].senderLast4, '1234');
  assert.equal(all[0].confirmedAt, now);
});

test('payment status never resurrects an expired intent', () => {
  const now = Date.now();
  const oldIntent = { id: 'old', userId: 'u1', status: 'intent', createdAt: now - PAYMENT_INTENT_TTL_MS - 1 };
  assert.equal(paymentStatusFromRecords([oldIntent], 'u1', now).intent, null);
  const freshIntent = { ...oldIntent, id: 'fresh', createdAt: now - 1 };
  assert.equal(paymentStatusFromRecords([oldIntent, freshIntent], 'u1', now).intent.id, 'fresh');
});

test('serialized payment mutations do not lose concurrent records', async () => {
  const userId = uniq('payment-lock');
  await Promise.all(Array.from({ length: 12 }, (_, index) => mutatePayments(async (all) => {
    await new Promise((resolve) => setTimeout(resolve, index % 3));
    all.push({ id: `${userId}-${index}`, userId, status: 'intent', createdAt: Date.now() });
    return { value: true };
  })));
  const mine = (await loadPayments()).filter((p) => p.userId === userId);
  assert.equal(mine.length, 12);
  await deletePaymentsFor(userId);
});

test('plan activation preserves prepaid time and is idempotent by payment id', async () => {
  const email = `${uniq('renewal')}@example.com`;
  const account = await auth.createAccount(email, 'password1234', null);
  const existingEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
  account.subscription.billingPeriodEnd = existingEnd;

  await auth.activatePlan(account, 'basic', 'monthly', 'pay_a');
  const firstEnd = account.subscription.billingPeriodEnd;
  assert.ok(firstEnd >= existingEnd + 29 * 24 * 60 * 60 * 1000);

  await auth.activatePlan(account, 'basic', 'monthly', 'pay_a');
  assert.equal(account.subscription.billingPeriodEnd, firstEnd);

  await auth.activatePlan(account, 'basic', 'monthly', 'pay_b');
  assert.ok(account.subscription.billingPeriodEnd >= firstEnd + 29 * 24 * 60 * 60 * 1000);
});
