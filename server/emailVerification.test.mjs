import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-not-prod';
const auth = await import('./auth.js');

const uniq = (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

test('new accounts require mailbox verification while legacy accounts remain usable', async () => {
  const account = await auth.createAccount(uniq('verify-new'), 'password123', null);
  assert.equal(auth.emailOwnershipVerified(account), false);
  assert.equal(auth.publicAccount(account).emailVerified, false);
  assert.equal(auth.emailOwnershipVerified({ id:'legacy', email:'legacy@example.com' }), true);
});

test('verification token is hashed at rest, single-use, and unlocks the account', async () => {
  const account = await auth.createAccount(uniq('verify-token'), 'password123', null);
  const raw = await auth.issueEmailVerificationToken(account);
  assert.equal(raw.length, 64);
  assert.notEqual(account.emailVerification.hash, raw);
  assert.equal(await auth.verifyEmailToken('0'.repeat(64)), null);
  const verified = await auth.verifyEmailToken(raw);
  assert.equal(verified.id, account.id);
  assert.equal(auth.emailOwnershipVerified(verified), true);
  assert.equal(verified.emailVerification, undefined);
  assert.equal(await auth.verifyEmailToken(raw), null);
});

test('requireAuth blocks an unverified account and accepts it after verification', async () => {
  const account = await auth.createAccount(uniq('verify-middleware'), 'password123', null);
  const req = { headers:{ authorization:`Bearer ${auth.signToken(account)}` } };
  let status = 200;
  let payload = null;
  let passed = false;
  const res = { status(code) { status = code; return this; }, json(body) { payload = body; return this; } };
  await auth.requireAuth(req, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(status, 403);
  assert.equal(payload.error, 'email_verification_required');

  const raw = await auth.issueEmailVerificationToken(account);
  await auth.verifyEmailToken(raw);
  passed = false; status = 200; payload = null;
  await auth.requireAuth(req, res, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(status, 200);
  assert.equal(payload, null);
});
