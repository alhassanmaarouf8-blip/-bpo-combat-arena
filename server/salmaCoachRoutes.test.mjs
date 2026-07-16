import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.AUTH_SECRET ||= 'salma-coach-route-test-secret';
const auth = await import('./auth.js');
const { salmaCoachRouter } = await import('./salmaCoach.js');
const { deleteUser, loadUser } = await import('./store.js');

async function withApi(run) {
  const app = express(); app.use(express.json({ limit: '16kb' })); app.use('/api', salmaCoachRouter);
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function create(tag, plan = 'free') {
  const account = await auth.createAccount(`salma-${tag}-${Date.now()}-${Math.random()}@example.com`, 'password1234');
  account.emailVerifiedAt = Date.now(); account.subscription.plan = plan;
  return { account, token: auth.signToken(account) };
}

async function api(base, path, token, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
  } });
  return { response, body: await response.json() };
}

test('coach routes fail closed, isolate accounts, allow tutor questions, and never persist questions', async () => {
  const previous = process.env.SALMA_COACH_MODE; const first = await create('first'); const second = await create('second', 'basic');
  try {
    await withApi(async (base) => {
      delete process.env.SALMA_COACH_MODE;
      assert.equal((await api(base, '/api/salma/coach', first.token)).response.status, 404);
      process.env.SALMA_COACH_MODE = 'on';
      const view = await api(base, '/api/salma/coach', first.token);
      assert.equal(view.response.status, 200); assert.equal(view.body.capabilities.questionsUnlimited, true);
      assert.equal(Object.hasOwn(view.body.capabilities, 'dailyQuestions'), false);
      assert.equal(view.body.feature.aiEnabled, false); assert.equal(view.body.feature.voiceEnabled, false);

      const preferences = await api(base, '/api/salma/preferences', first.token, {
        method: 'PUT', body: JSON.stringify({ dailyMinutes: 5, autoSpeak: true }),
      });
      assert.equal(preferences.response.status, 200); assert.equal(preferences.body.preferences.dailyMinutes, 5);
      const badContext = await api(base, '/api/salma/question', first.token, {
        method: 'POST', body: JSON.stringify({ question: 'Was mache ich?', context: { screen: 'home', rawVacancy: 'forbidden' } }),
      });
      assert.equal(badContext.response.status, 400);

      for (let count = 0; count < 12; count += 1) {
        const answer = await api(base, '/api/salma/question', first.token, {
          method: 'POST', body: JSON.stringify({ question: 'Was mache ich jetzt?', context: { screen: 'home' } }),
        });
        assert.equal(answer.response.status, 200); assert.equal(answer.body.source, 'deterministic');
        assert.equal(Object.hasOwn(answer.body, 'remaining'), false);
      }

      const firstStored = await loadUser(first.account.id); const secondStored = await loadUser(second.account.id);
      assert.equal(JSON.stringify(firstStored.salmaCoach).includes('Was mache ich'), false);
      assert.equal(Object.hasOwn(firstStored.salmaCoach.coachState, 'questionUsage'), false);
      assert.equal(secondStored.salmaCoach.preferences.dailyMinutes, 10);
    });
  } finally {
    if (previous === undefined) delete process.env.SALMA_COACH_MODE; else process.env.SALMA_COACH_MODE = previous;
    await Promise.all([deleteUser(first.account.id), deleteUser(second.account.id)]);
    await Promise.all([auth.deleteAccount(first.account), auth.deleteAccount(second.account)]);
  }
});
