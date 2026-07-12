/**
 * compAccess.test.mjs — the standing comp-access whitelist must grant real access reliably and
 * revoke cleanly. Runs in file-fallback mode (no DATABASE_URL needed in CI); each test uses a
 * unique email so the shared on-disk store never collides across tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-not-prod';
const auth = await import('./auth.js');
const comp = await import('./compAccess.js');

const uniq = (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

test('compAccess: an unverified signup cannot inherit a privileged email allowlist', async () => {
  const email = uniq('presignup');
  await comp.addComp({ email, plan: 'elite', note: 'test' });
  const acc = await auth.createAccount(email, 'password123', null);
  assert.equal(auth.planOf(acc), 'free');
  assert.notEqual(acc.subscription.comp, true);
});

test('compAccess: a non-whitelisted signup is unaffected (free/trial as normal)', async () => {
  const email = uniq('normal');
  const acc = await auth.createAccount(email, 'password123', null);
  assert.notEqual(auth.planOf(acc), 'elite');
  assert.notEqual(acc.subscription?.comp, true);
});

test('compAccess: admin grantComp applies to an ALREADY-EXISTING account instantly', async () => {
  const email = uniq('existing');
  const acc = await auth.createAccount(email, 'password123', null);
  assert.notEqual(auth.planOf(acc), 'basic');
  await comp.addComp({ email, plan: 'basic' });
  await auth.grantComp(acc, 'basic');
  assert.equal(auth.planOf(acc), 'basic');
});

test('compAccess: planOf ignores billingPeriodEnd expiry for comp accounts (unlike real payments)', async () => {
  const email = uniq('neverexpires');
  const acc = await auth.createAccount(email, 'password123', null);
  await auth.grantComp(acc, 'elite');
  acc.subscription.billingPeriodEnd = Date.now() - 1000; // an "expired" period, as a real payment would set
  assert.equal(auth.planOf(acc), 'elite');
});

test('compAccess: deactivatePlan revokes comp access and clears the comp flag', async () => {
  const email = uniq('revoke');
  const acc = await auth.createAccount(email, 'password123', null);
  await auth.grantComp(acc, 'elite');
  assert.equal(auth.planOf(acc), 'elite');
  await auth.deactivatePlan(acc);
  assert.equal(auth.planOf(acc), 'free');
  assert.equal(acc.subscription.comp, false);
});

test('compAccess: removeComp removes the whitelist entry', async () => {
  const email = uniq('remove');
  await comp.addComp({ email, plan: 'elite' });
  assert.ok(await comp.findComp(email));
  const removed = await comp.removeComp(email);
  assert.equal(removed, true);
  assert.equal(await comp.findComp(email), null);
});

test('compAccess: addComp rejects an invalid email', async () => {
  await assert.rejects(() => comp.addComp({ email: 'not-an-email', plan: 'elite' }));
});

test('compAccess: a real paid plan (no comp flag) still expires normally on billingPeriodEnd', async () => {
  const email = uniq('realpayment');
  const acc = await auth.createAccount(email, 'password123', null);
  await auth.activatePlan(acc, 'elite', 'monthly');
  assert.equal(auth.planOf(acc), 'elite');
  acc.subscription.billingPeriodEnd = Date.now() - 1000;
  assert.equal(auth.planOf(acc), 'free');   // regression guard: comp immunity must NOT leak to real payments
});
