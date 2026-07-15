import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

const SECRET = 'cohort-route-test-' + 'z'.repeat(32);
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const INVITE_IDS = [`route_${RUN}_01`, `route_${RUN}_02`, `route_${RUN}_03`, `route_${RUN}_04`];
process.env.AUTH_SECRET ||= 'study-route-auth-test-secret';
process.env.STUDY_COHORT_MODE = 'beta';
process.env.STUDY_COHORT_INVITE_SECRET = SECRET;
process.env.STUDY_COHORT_INVITE_IDS = INVITE_IDS.join(',');

const auth = await import('./auth.js');
const { studyCohortRouter } = await import('./studyCohort.js');
const { createStudyCohortInvite } = await import('./studyCohortInvite.js');

async function withApi(run) {
  const app = express();
  app.use(express.json({ limit:'16kb' }));
  app.use('/api', studyCohortRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function post(base, path, body, token = '') {
  const response = await fetch(`${base}${path}`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) },
    body:JSON.stringify(body || {}),
  });
  return { response, body:await response.json() };
}

test('status attests only safe fixed cohort capabilities and claim activates server-side', async (t) => {
  const rawInvite = createStudyCohortInvite({ inviteId:INVITE_IDS[0],
    expiresAt:Date.now() + 60 * 60 * 1000, secret:SECRET });
  await withApi(async (base) => {
    const invalid = await post(base, '/api/study-cohort/status', { invite:`${rawInvite}x` });
    assert.equal(invalid.response.status, 200);
    assert.deepEqual(invalid.body, { valid:false });

    const status = await post(base, '/api/study-cohort/status', { invite:rawInvite });
    assert.equal(status.response.status, 200);
    assert.deepEqual(status.body, { valid:true, cohort:'21-day-study', days:21 });
    const statusJson = JSON.stringify(status.body);
    assert.equal(statusJson.includes(rawInvite), false);
    assert.equal(statusJson.includes(INVITE_IDS[0]), false);

    const account = await auth.createAccount(
      `route-study-${Date.now()}-${Math.random()}@example.com`, 'password1234',
    );
    t.after(() => auth.deleteAccount(account));
    account.emailVerifiedAt = Date.now();
    const claimed = await post(base, '/api/study-cohort/claim', { invite:rawInvite }, auth.signToken(account));
    assert.equal(claimed.response.status, 200);
    assert.deepEqual(claimed.body.account.studyAccess, { pending:false, active:true, days:21, daysLeft:21 });
    assert.equal(Object.hasOwn(claimed.body.account.subscription, 'studyCohort'), false);
    assert.equal(JSON.stringify(claimed.body).includes(INVITE_IDS[0]), false);
    assert.equal(JSON.stringify(claimed.body).includes(rawInvite), false);

    const retried = await post(base, '/api/study-cohort/claim', { invite:rawInvite }, auth.signToken(account));
    assert.equal(retried.response.status, 200);
    assert.deepEqual(retried.body.account.studyAccess, claimed.body.account.studyAccess);
  });
});

test('atomic claims allow exactly one verified account and reject tampered, expired, or disabled tokens', async (t) => {
  const accounts = await Promise.all(['first', 'second', 'tampered', 'expired', 'disabled'].map(async (tag) => {
    const account = await auth.createAccount(`route-${tag}-${Date.now()}-${Math.random()}@example.com`, 'password1234');
    account.emailVerifiedAt = Date.now();
    return account;
  }));
  t.after(() => Promise.all(accounts.map((account) => auth.deleteAccount(account))));
  const shared = createStudyCohortInvite({ inviteId:INVITE_IDS[1], expiresAt:Date.now() + 60_000, secret:SECRET });

  await withApi(async (base) => {
    const contenders = await Promise.all(accounts.slice(0, 2).map((account) => post(
      base, '/api/study-cohort/claim', { invite:shared }, auth.signToken(account),
    )));
    assert.deepEqual(contenders.map((result) => result.response.status).sort(), [200, 403]);
    assert.equal(contenders.filter((result) => result.body?.account?.studyAccess?.active === true).length, 1);

    const tampered = await post(base, '/api/study-cohort/claim', { invite:`${shared}x` }, auth.signToken(accounts[2]));
    assert.equal(tampered.response.status, 403);
    const expired = createStudyCohortInvite({ inviteId:INVITE_IDS[2], expiresAt:Date.now() - 1, secret:SECRET });
    assert.equal((await post(base, '/api/study-cohort/claim', { invite:expired }, auth.signToken(accounts[3]))).response.status, 403);

    const enabled = process.env.STUDY_COHORT_MODE;
    process.env.STUDY_COHORT_MODE = 'off';
    try {
      const disabled = createStudyCohortInvite({ inviteId:INVITE_IDS[3], expiresAt:Date.now() + 60_000, secret:SECRET });
      assert.equal((await post(base, '/api/study-cohort/claim', { invite:disabled }, auth.signToken(accounts[4]))).response.status, 403);
    } finally {
      process.env.STUDY_COHORT_MODE = enabled;
    }
  });
});
