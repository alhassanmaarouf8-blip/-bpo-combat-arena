import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.AUTH_SECRET ||= 'vacancy-routes-test-secret';
delete process.env.VACANCY_AI_ENABLED;
delete process.env.VACANCY_LIVE_ENABLED;

const auth = await import('./auth.js');
const { vacancyTargetRouter } = await import('./vacancyTarget.js');
const { loadUser, saveUser, deleteUser } = await import('./store.js');

const SAMPLE = `German Customer Service Agent
We are hiring a full-time customer service agent for an e-commerce account.
Requirements include German B2, customer complaint handling, accurate data entry,
flexible shifts and one year of customer support experience.`;
const SECOND_SAMPLE = `Technical Support Agent
This job vacancy handles internet troubleshooting and customer tickets for a telecom account.
Requirements include German B2, technical triage, accurate documentation, flexible shifts,
and prior helpdesk or customer support experience.`;

async function withApi(run) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', vacancyTargetRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function accountAndToken(tag, plan = null) {
  const account = await auth.createAccount(
    `vacancy-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
    'password1234',
  );
  // Product routes require verified ownership. Mutating the in-memory account is
  // enough here because getAccountById returns this canonical account object.
  account.emailVerifiedAt = Date.now();
  if (plan) account.subscription.plan = plan;
  return { account, token: auth.signToken(account) };
}

async function api(base, path, token, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  return { response, body: await response.json() };
}

test('vacancy routes require auth, report a disabled kill switch, and enforce lifetime free preview', async () => {
  const previousMode = process.env.VACANCY_MODE;
  const { account, token } = await accountAndToken('free');
  try {
    await withApi(async (base) => {
      delete process.env.VACANCY_MODE;
      const unauthenticated = await api(base, '/api/vacancy-target', null);
      assert.equal(unauthenticated.response.status, 401);
      assert.equal(unauthenticated.body.error, 'auth_required');

      const disabled = await api(base, '/api/vacancy-target', token);
      assert.equal(disabled.response.status, 200);
      assert.deepEqual(disabled.body, {
        enabled: false,
        capabilities: { canPreview: false, canPlan: false, canLive: false, linkImport: false },
        draft: null,
        target: null,
      });
      const disabledWrite = await api(base, '/api/vacancy-target/draft', token, {
        method: 'POST', body: JSON.stringify({ vacancyText: SAMPLE }),
      });
      assert.equal(disabledWrite.response.status, 404);
      assert.equal(disabledWrite.body.error, 'feature_disabled');

      process.env.VACANCY_MODE = 'on';
      const initial = await api(base, '/api/vacancy-target', token);
      assert.equal(initial.body.enabled, true);
      assert.deepEqual(initial.body.capabilities, {
        canPreview: true, canPlan: false, canLive: false, linkImport: true,
      });

      const first = await api(base, '/api/vacancy-target/draft', token, {
        method: 'POST', body: JSON.stringify({ vacancyText: SAMPLE, interviewDate: null }),
      });
      assert.equal(first.response.status, 201);
      assert.equal(first.body.draft.status, 'draft');
      assert.equal(first.body.draft.schedule.length, 1, 'free response exposes Day 1 only');
      assert.equal(first.body.draft.practiceQuestions.length, 3);
      assert.equal(Object.hasOwn(first.body.draft, 'sourceHash'), false);
      assert.equal(Object.hasOwn(first.body.draft, 'sourceText'), false);
      assert.equal(Object.hasOwn(first.body.draft, 'sourceUrl'), false);

      const persisted = await loadUser(account.id);
      assert.equal(persisted.vacancyTarget.draft.schedule.length, 7, 'canonical plan is retained for a later upgrade');
      assert.ok(persisted.vacancyTarget.previewUsedAt);

      const replay = await api(base, '/api/vacancy-target/draft', token, {
        method: 'POST', body: JSON.stringify({ vacancyText: SAMPLE }),
      });
      assert.equal(replay.response.status, 201);
      assert.equal(replay.body.draft.id, first.body.draft.id);

      const second = await api(base, '/api/vacancy-target/draft', token, {
        method: 'POST', body: JSON.stringify({ vacancyText: SECOND_SAMPLE }),
      });
      assert.equal(second.response.status, 403);
      assert.equal(second.body.error, 'preview_used');

      const activated = await api(base, '/api/vacancy-target/active', token, {
        method: 'PUT', body: JSON.stringify({
          roleTitle: 'German Customer Support Agent',
          employerDisplay: null,
          industryKey: 'ecommerce',
          roleType: 'customer_service',
          germanLevel: 'b2',
          interviewDate: null,
        }),
      });
      assert.equal(activated.response.status, 200);
      assert.equal(activated.body.target.status, 'active');
      assert.equal(activated.body.target.schedule.length, 1);

      const completed = await api(base, '/api/vacancy-target/active', token, {
        method: 'PATCH', body: JSON.stringify({ completeMilestoneId:'day_1_foundation' }),
      });
      assert.equal(completed.response.status, 200);
      assert.ok(completed.body.target.schedule[0].completedAt);

      const liveManual = await api(base, '/api/vacancy-target/active', token, {
        method: 'PATCH', body: JSON.stringify({ completeMilestoneId:'day_6_mock' }),
      });
      assert.equal(liveManual.response.status, 409);
      assert.equal(liveManual.body.error, 'meaningful_debrief_required');

      const badPatch = await api(base, '/api/vacancy-target/active', token, {
        method: 'PATCH', body: JSON.stringify({ roleTitle: 'Not allowed in v1' }),
      });
      assert.equal(badPatch.response.status, 400);
      assert.equal(badPatch.body.error, 'unsupported_source');

      const removed = await api(base, '/api/vacancy-target/active', token, { method: 'DELETE' });
      assert.deepEqual(removed.body, { ok: true, deleted: true });
      const removedAgain = await api(base, '/api/vacancy-target/active', token, { method: 'DELETE' });
      assert.deepEqual(removedAgain.body, { ok: true, deleted: false });

      const afterDelete = await api(base, '/api/vacancy-target/draft', token, {
        method: 'POST', body: JSON.stringify({ vacancyText: SAMPLE }),
      });
      assert.equal(afterDelete.response.status, 403);
      assert.equal(afterDelete.body.error, 'preview_used', 'deletion never resets the lifetime preview');
    });
  } finally {
    if (previousMode === undefined) delete process.env.VACANCY_MODE;
    else process.env.VACANCY_MODE = previousMode;
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});

test('paid quotas are concurrency-safe and are checked before URL fetching', async () => {
  const previousMode = process.env.VACANCY_MODE;
  process.env.VACANCY_MODE = 'on';
  const paid = await accountAndToken('quota', 'basic');
  try {
    const profile = await loadUser(paid.account.id);
    profile.vacancyTarget = {
      version:1, draft:null, active:null, previewUsedAt:null,
      analysisUsage:{ hour:new Date().toISOString().slice(0, 13), hourCount:2, month:new Date().toISOString().slice(0, 7), monthCount:2 },
    };
    await saveUser(profile);
    await withApi(async (base) => {
      const variants = [1, 2].map((n) => api(base, '/api/vacancy-target/draft', paid.token, {
        method:'POST', body:JSON.stringify({ vacancyText:`${SECOND_SAMPLE}\nCampaign reference ${n} with German customer support duties.` }),
      }));
      const results = await Promise.all(variants);
      assert.deepEqual(results.map((item) => item.response.status).sort(), [201, 429]);

      const stored = await loadUser(paid.account.id);
      stored.vacancyTarget.analysisUsage = {
        hour:new Date().toISOString().slice(0, 13), hourCount:3,
        month:new Date().toISOString().slice(0, 7), monthCount:30,
      };
      await saveUser(stored);
      assert.equal((await loadUser(paid.account.id)).vacancyTarget.analysisUsage.hourCount, 3);
      const quotaCapabilities = await api(base, '/api/vacancy-target', paid.token);
      assert.equal(quotaCapabilities.body.capabilities.canPlan, true);
      const blockedBeforeFetch = await api(base, '/api/vacancy-target/draft', paid.token, {
        method:'POST', body:JSON.stringify({ sourceUrl:'https://jobs.lever.co/definitely-not-fetched' }),
      });
      assert.equal(blockedBeforeFetch.response.status, 429);
      assert.equal(blockedBeforeFetch.body.error, 'analysis_limit');
    });
  } finally {
    if (previousMode === undefined) delete process.env.VACANCY_MODE;
    else process.env.VACANCY_MODE = previousMode;
    await deleteUser(paid.account.id);
    await auth.deleteAccount(paid.account);
  }
});

test('Basic receives the full deterministic plan while live remains Elite/trial-only', async () => {
  const previousMode = process.env.VACANCY_MODE;
  const previousLive = process.env.VACANCY_LIVE_ENABLED;
  process.env.VACANCY_MODE = 'on';
  process.env.VACANCY_LIVE_ENABLED = 'true';
  const basic = await accountAndToken('basic', 'basic');
  const elite = await accountAndToken('elite', 'elite');
  try {
    await withApi(async (base) => {
      const basicGet = await api(base, '/api/vacancy-target', basic.token);
      assert.deepEqual(basicGet.body.capabilities, {
        canPreview: true, canPlan: true, canLive: false, linkImport: true,
      });
      const draft = await api(base, '/api/vacancy-target/draft', basic.token, {
        method: 'POST', body: JSON.stringify({ vacancyText: SECOND_SAMPLE }),
      });
      assert.equal(draft.response.status, 201);
      assert.equal(draft.body.draft.schedule.length, 7);

      const eliteGet = await api(base, '/api/vacancy-target', elite.token);
      assert.equal(eliteGet.body.capabilities.canPlan, true);
      assert.equal(eliteGet.body.capabilities.canLive, true);
    });
  } finally {
    if (previousMode === undefined) delete process.env.VACANCY_MODE;
    else process.env.VACANCY_MODE = previousMode;
    if (previousLive === undefined) delete process.env.VACANCY_LIVE_ENABLED;
    else process.env.VACANCY_LIVE_ENABLED = previousLive;
    await Promise.all([deleteUser(basic.account.id), deleteUser(elite.account.id)]);
    await auth.deleteAccount(basic.account);
    await auth.deleteAccount(elite.account);
  }
});
