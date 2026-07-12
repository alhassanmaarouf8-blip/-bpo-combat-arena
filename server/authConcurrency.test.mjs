import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-not-prod';
const auth = await import('./auth.js');

const uniq = (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;

test('parallel signup permits exactly one account for the same normalized email', async () => {
  const email = uniq('parallel-signup');
  const results = await Promise.allSettled([
    auth.createAccount(` ${email.toUpperCase()} `, 'password1234', null),
    auth.createAccount(email, 'password5678', null),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected');
  assert.equal(rejected.reason.code, 409);
  assert.equal(rejected.reason.message, 'email_taken');
  assert.ok(await auth.getAccountByEmail(email));
});

test('a session is not issued when sessionVersion changes during password verification', async () => {
  const email = uniq('login-reset-race');
  const account = await auth.createAccount(email, 'old-password-1234', null);
  const login = auth.authenticateAndIssueSession(email, 'old-password-1234');

  // Let authenticate capture the old credential snapshot and enter asynchronous scrypt, then
  // model the atomic effect of a reset. The final locked comparison must reject this login.
  await new Promise((resolve) => setImmediate(resolve));
  account.sessionVersion += 1;

  assert.equal(await login, null);
  const current = await auth.authenticateAndIssueSession(email, 'old-password-1234');
  assert.ok(current);
  assert.equal(auth.verifyToken(current.token).v, account.sessionVersion);
});

function runLimit(middleware, { ip, accountId }) {
  let status = 200;
  let next = false;
  const req = { ip, account: { id: accountId } };
  const res = {
    set() {},
    status(code) { status = code; return this; },
    json() { return this; },
  };
  middleware(req, res, () => { next = true; });
  return { status, next };
}

test('accountOnly rate limits cannot be reset by changing proxy IPs', () => {
  const tag = `account-only-${Date.now()}-${Math.random()}`;
  const limit = auth.rateLimit({
    windowMs: 60_000, max: 1, tag, accountOnly: true,
    keyExtra: (req) => req.account.id,
  });
  assert.equal(runLimit(limit, { ip: '198.51.100.1', accountId: 'same' }).next, true);
  assert.equal(runLimit(limit, { ip: '203.0.113.2', accountId: 'same' }).status, 429);

  const isolated = auth.rateLimit({
    windowMs: 60_000, max: 1, tag: `${tag}-isolated`, accountOnly: true,
    keyExtra: (req) => req.account.id,
  });
  assert.equal(runLimit(isolated, { ip: '198.51.100.1', accountId: 'one' }).next, true);
  assert.equal(runLimit(isolated, { ip: '198.51.100.1', accountId: 'two' }).next, true);
});
