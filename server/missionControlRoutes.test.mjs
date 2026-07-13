import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.AUTH_SECRET ||= 'mission-control-routes-test-secret';
const auth = await import('./auth.js');
const { createMissionControlRouter } = await import('./missionControl.js');
const { decryptMissionControlState, missionControlVacancyLiveContext } = await import('./missionControlCore.js');
const { deleteUser, loadUser, saveUser } = await import('./store.js');

const NOW = Date.parse('2026-07-13T09:00:00.000Z');
const KEY = Buffer.alloc(32, 11);
const ENV = {
  INTERVIEW_PASS_MODE:'on', OPPORTUNITY_COPILOT_MODE:'on', JOB_DISCOVERY_LIVE_ENABLED:'true',
  VACANCY_MODE:'on', VACANCY_LIVE_ENABLED:'true',
  MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'true',
};
const IMPORTED_VACANCY = Object.freeze({
  title:'German Customer Service Agent',
  employer:'Example Support',
  sourceHost:'jobs.lever.co',
  description:'Full-time German B2 customer service vacancy for a telecom account in Cairo. Customer complaint handling, de-escalation and accurate data entry required.',
  eligibilityRequirements:{
    verifiedDimensions:['location', 'work_mode', 'work_authorization', 'shift', 'availability', 'experience', 'salary'],
    locationKeys:[], workModes:[], workAuthorizations:[], shifts:[], requiredStartDate:null,
    minimumExperienceBand:null, salaryMinEGP:null, salaryMaxEGP:null,
  },
});

async function withApi(router, run) {
  const app = express();
  app.use(express.json({ limit:'64kb' }));
  app.use('/api', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function request(base, path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers:{
      ...(token ? { Authorization:`Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type':'application/json' }),
    },
    ...(body === undefined ? {} : { body:JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status:response.status, body:text ? JSON.parse(text) : null };
}

async function accountForTest({ admin = true, plan = 'free' } = {}) {
  const account = await auth.createAccount(
    `mission-route-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
    'test-password-1234',
  );
  account.emailVerifiedAt = NOW;
  account.roles = admin ? ['admin'] : [];
  account.subscription = { ...(account.subscription || {}), plan };
  const profile = await loadUser(account.id);
  profile.assessmentUsed = true;
  profile.assessmentResult = {
    estimatedLevel:'B2', measured:{ writtenGerman:true }, at:NOW,
  };
  profile.sessions = [{ date:NOW, answers:4, level:'b2', verdict:'pass' }];
  await saveUser(profile);
  return { account, token:auth.signToken(account) };
}

async function removeAccountForTest(account) {
  await deleteUser(account.id);
  await auth.deleteAccount(account);
}

test('owner beta is account-isolated and off mode restores invisible routes', async () => {
  const owner = await accountForTest({ admin:false, plan:'elite' });
  const outsider = await accountForTest({ admin:false, plan:'elite' });
  const betaEnv = {
    INTERVIEW_PASS_MODE:'beta',
    OPPORTUNITY_COPILOT_MODE:'beta',
    MISSION_CONTROL_BETA_ACCOUNT_IDS:owner.account.id,
    MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'true',
  };
  try {
    await withApi(createMissionControlRouter({
      env:betaEnv, encryptionKey:KEY, now:() => NOW,
    }), async (base) => {
      const publicProbe = await request(base, '/api/interview-pass/preview');
      assert.equal(publicProbe.status, 200);
      assert.deepEqual(publicProbe.body, { enabled:false });

      const ownerView = await request(base, '/api/candidate-passport', { token:owner.token });
      assert.equal(ownerView.status, 200);
      assert.equal(ownerView.body.enabled, true);

      const outsiderView = await request(base, '/api/candidate-passport', { token:outsider.token });
      assert.equal(outsiderView.status, 404);
      assert.equal(outsiderView.body.error, 'feature_disabled');
    });

    await withApi(createMissionControlRouter({
      env:{
        ...betaEnv,
        INTERVIEW_PASS_MODE:'off',
        OPPORTUNITY_COPILOT_MODE:'off',
      },
      encryptionKey:KEY,
      now:() => NOW,
    }), async (base) => {
      const publicProbe = await request(base, '/api/interview-pass/preview');
      assert.deepEqual(publicProbe.body, { enabled:false });
      const ownerView = await request(base, '/api/candidate-passport', { token:owner.token });
      assert.equal(ownerView.status, 404);
      assert.equal(ownerView.body.error, 'feature_disabled');
    });
  } finally {
    await Promise.all([
      removeAccountForTest(owner.account),
      removeAccountForTest(outsider.account),
    ]);
  }
});

test('response and pack tracker references survive encrypted HTTP reloads without recruiter text', async () => {
  const { account, token } = await accountForTest();
  const router = createMissionControlRouter({
    env:ENV, encryptionKey:KEY, now:() => NOW,
    importVacancy:async () => ({ ...IMPORTED_VACANCY }),
  });
  try {
    await withApi(router, async (base) => {
      const saved = await request(base, '/api/candidate-passport', {
        token, method:'PUT', body:{
          roleTypes:['customer_service'], industryKeys:['telecom'], germanLevel:'b2',
          locationMode:'remote', shiftPreferences:['day'], availabilityDate:null,
          experienceBand:'1_2_years', salaryFloorEGP:15_000,
          workAuthorization:'egypt_authorized',
          skillIds:['self_intro', 'motivation', 'availability', 'star_story', 'data_capture', 'deescalation'],
          facts:[
            { id:'fact_route_0001', type:'experience', value:'Handled German customer requests for one year.',
              provenance:'user_confirmed', confirmedAt:NOW, shareAllowed:true },
            { id:'fact_route_0002', type:'achievement', value:'Resolved escalations and documented each case.',
              provenance:'user_confirmed', confirmedAt:NOW, shareAllowed:true },
          ],
          consentVersion:1,
          idempotencyKey:'route-passport-0001',
        },
      });
      assert.equal(saved.status, 200);

      const imported = await request(base, '/api/opportunities/import', {
        token, method:'POST', body:{ sourceUrl:'https://jobs.lever.co/example/german-agent', idempotencyKey:'route-import-0001' },
      });
      assert.equal(imported.status, 201);
      assert.equal(imported.body.readinessState, 'READY_TO_APPLY');

      const packed = await request(base, `/api/opportunities/${imported.body.id}/application-pack`, {
        token, method:'POST', body:{ idempotencyKey:'route-pack-0001' },
      });
      assert.equal(packed.status, 201);
      const pack = packed.body.applicationPack;
      assert.ok(pack.facts.length >= 2);

      const approved = await request(base, `/api/application-packs/${pack.id}/approve`, {
        token, method:'POST', body:{
          confirmed:true, factLockIds:pack.facts.map((fact) => fact.id),
          confirmationVersion:1, idempotencyKey:'route-approve-01',
        },
      });
      assert.equal(approved.status, 200);
      const submitted = await request(base, `/api/application-packs/${pack.id}/mark-submitted`, {
        token, method:'POST', body:{ confirmed:true, idempotencyKey:'route-submit-001' },
      });
      assert.equal(submitted.status, 200);

      const recruiterText = 'Einladung zum Vorstellungsgespräch am 14.07 um 14 Uhr. recruiter@example.com';
      const classified = await request(base, `/api/opportunities/${imported.body.id}/response`, {
        token, method:'POST', body:{ responseText:recruiterText, idempotencyKey:'route-response-0001' },
      });
      assert.equal(classified.status, 200);
      assert.equal(classified.body.classification.type, 'interview_invitation');
      assert.equal(classified.body.opportunity.status, 'interview_proposed');
      assert.equal(classified.body.opportunity.latestResponse, 'interview_invitation');
      assert.deepEqual(classified.body.opportunity.applicationPack, {
        id:pack.id, status:'submitted', trackingOnly:false,
      });
      assert.equal(JSON.stringify(classified.body).includes('recruiter@example.com'), false);

      const listed = await request(base, '/api/opportunities', { token });
      assert.equal(listed.status, 200);
      assert.equal(listed.body.opportunities[0].latestResponse, 'interview_invitation');
      assert.equal(listed.body.opportunities[0].applicationPack.status, 'submitted');

      const radar = await request(base, '/api/job-radar/today', { token });
      assert.equal(radar.status, 200);
      assert.equal(radar.body.opportunities[0].latestResponse, 'interview_invitation');
      assert.equal(radar.body.opportunities[0].applicationPack.id, pack.id);

      const confirmed = await request(base, `/api/opportunities/${imported.body.id}/confirm-interview`, {
        token, method:'POST', body:{
          interviewDate:'2026-07-14', interviewTime:'14:00', timezone:'Africa/Cairo', confirmed:true,
          idempotencyKey:'route-interview-001',
        },
      });
      assert.equal(confirmed.status, 200);

      const profile = await loadUser(account.id);
      assert.equal(JSON.stringify(profile).includes(recruiterText), false);
      assert.equal(profile.vacancyTarget.active, null, 'private opportunity data must not be copied to plaintext vacancy state');
      const state = decryptMissionControlState(profile.missionControlEncrypted, account.id, { key:KEY });
      assert.deepEqual(state.responseEvents, [{
        opportunityId:imported.body.id, type:'interview_invitation', confidence:'high',
        createdAt:NOW, confirmedAt:NOW,
      }]);
      assert.equal(Object.hasOwn(state.responseEvents[0], 'interviewDate'), false);
      assert.equal(state.interviews[0].interviewDate, '2026-07-14');
      assert.equal(state.activeVacancyBridge.opportunityId, imported.body.id);
      const liveContext = missionControlVacancyLiveContext(profile, account, {
        env:ENV, key:KEY, now:NOW,
      });
      assert.equal(liveContext.targetId, confirmed.body.vacancyTargetId);
      assert.equal(liveContext.industryKey, 'telecom');
      assert.equal(liveContext.roleType, 'customer_service');
      assert.equal(liveContext.germanLevel, 'b2');
      assert.ok(liveContext.skillIds.includes('deescalation'));
      assert.ok(liveContext.questionTopicIds.includes('customer_escalation'));

      const outcome = await request(base, `/api/opportunities/${imported.body.id}/outcome`, {
        token, method:'PATCH', body:{ outcome:'offer', idempotencyKey:'route-outcome-0001' },
      });
      assert.equal(outcome.status, 200);
      assert.equal(outcome.body.status, 'offer');
      const emptyRadar = await request(base, '/api/job-radar/today', { token });
      assert.deepEqual(emptyRadar.body.opportunities, []);
    });
  } finally {
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});

test('confirming an interview requires a bounded invitation event', async () => {
  const { account, token } = await accountForTest();
  const router = createMissionControlRouter({
    env:ENV, encryptionKey:KEY, now:() => NOW,
    importVacancy:async () => ({ ...IMPORTED_VACANCY }),
  });
  try {
    await withApi(router, async (base) => {
      const imported = await request(base, '/api/opportunities/import', {
        token, method:'POST', body:{ sourceUrl:'https://jobs.lever.co/example/german-agent-two', idempotencyKey:'route-import-0002' },
      });
      assert.equal(imported.status, 201);
      const confirmation = await request(base, `/api/opportunities/${imported.body.id}/confirm-interview`, {
        token, method:'POST', body:{
          interviewDate:'2026-07-14', interviewTime:null, timezone:'Africa/Cairo', confirmed:true,
          idempotencyKey:'route-interview-002',
        },
      });
      assert.equal(confirmation.status, 409);
      assert.equal(confirmation.body.error, 'interview_invitation_required');
    });
  } finally {
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});

test('Free tracking limit is enforced before a second external listing fetch', async () => {
  const { account, token } = await accountForTest({ admin:false, plan:'free' });
  let fetches = 0;
  const router = createMissionControlRouter({
    env:ENV, encryptionKey:KEY, now:() => NOW,
    importVacancy:async (url) => {
      fetches += 1;
      return { ...IMPORTED_VACANCY, title:`German Customer Service ${url.split('/').at(-1)}` };
    },
  });
  try {
    await withApi(router, async (base) => {
      const first = await request(base, '/api/opportunities/import', {
        token, method:'POST', body:{
          sourceUrl:'https://jobs.lever.co/example/free-one', idempotencyKey:'free-import-0001',
        },
      });
      assert.equal(first.status, 201);
      assert.equal(fetches, 1);
      const second = await request(base, '/api/opportunities/import', {
        token, method:'POST', body:{
          sourceUrl:'https://jobs.lever.co/example/free-two', idempotencyKey:'free-import-0002',
        },
      });
      assert.equal(second.status, 403);
      assert.equal(second.body.error, 'application_limit');
      assert.equal(fetches, 1, 'capacity must be checked before fetching a new listing');
    });
  } finally {
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});

test('Free Candidate Passport is limited on both write and downgraded read', async () => {
  const { account, token } = await accountForTest({ admin:false, plan:'basic' });
  const router = createMissionControlRouter({ env:ENV, encryptionKey:KEY, now:() => NOW });
  const fullPassport = {
    roleTypes:['customer_service'], industryKeys:['telecom'], germanLevel:'b2',
    locationMode:'remote', locationEligibilities:['remote_egypt', 'egypt'],
    shiftPreferences:['day', 'weekends'], availabilityDate:null,
    experienceBand:'1_2_years', salaryFloorEGP:15_000,
    workAuthorization:'egypt_authorized', skillIds:['self_intro', 'motivation', 'deescalation'],
    facts:[
      { id:'fact_free_read_01', type:'experience', value:'Handled customer requests.',
        provenance:'user_confirmed', confirmedAt:NOW, shareAllowed:true },
      { id:'fact_free_read_02', type:'achievement', value:'Resolved escalated cases.',
        provenance:'user_confirmed', confirmedAt:NOW, shareAllowed:true },
    ],
    consentVersion:1,
  };
  try {
    await withApi(router, async (base) => {
      const paidWrite = await request(base, '/api/candidate-passport', {
        token, method:'PUT', body:{ ...fullPassport, idempotencyKey:'paid-passport-0001' },
      });
      assert.equal(paidWrite.status, 200);
      assert.equal(paidWrite.body.passport.facts.length, 2);
      account.subscription.plan = 'free';

      const freeRead = await request(base, '/api/candidate-passport', { token });
      assert.equal(freeRead.status, 200);
      assert.equal(freeRead.body.capabilities.fullPassport, false);
      assert.equal(freeRead.body.passport.facts.length, 1);
      assert.equal(freeRead.body.passport.skillIds.length, 2);
      assert.equal(freeRead.body.passport.locationEligibilities.length, 1);
      assert.equal(freeRead.body.passport.salaryFloorEGP, null);

      const downgradedReplay = await request(base, '/api/candidate-passport', {
        token, method:'PUT', body:{ ...fullPassport, idempotencyKey:'paid-passport-0001' },
      });
      assert.equal(downgradedReplay.status, 200);
      assert.equal(downgradedReplay.body.passport.facts.length, 1);
      assert.equal(downgradedReplay.body.passport.salaryFloorEGP, null);

      const freeWrite = await request(base, '/api/candidate-passport', {
        token, method:'PUT', body:{ ...fullPassport, idempotencyKey:'free-passport-0001' },
      });
      assert.equal(freeWrite.status, 403);
      assert.equal(freeWrite.body.error, 'upgrade_required');
    });
  } finally {
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});

test('mutation idempotency is payload-bound and official-page verification refetches only once', async () => {
  const { account, token } = await accountForTest();
  let fetches = 0;
  let openState = 'open';
  const router = createMissionControlRouter({
    env:ENV, encryptionKey:KEY, now:() => NOW,
    importVacancy:async () => { fetches += 1; return { ...IMPORTED_VACANCY, openState }; },
  });
  try {
    await withApi(router, async (base) => {
      const importBody = {
        sourceUrl:'https://jobs.lever.co/example/idempotent-role',
        idempotencyKey:'idempotent-import-01',
      };
      const first = await request(base, '/api/opportunities/import', {
        token, method:'POST', body:importBody,
      });
      const replay = await request(base, '/api/opportunities/import', {
        token, method:'POST', body:importBody,
      });
      assert.equal(first.status, 201);
      assert.deepEqual(replay, first);
      assert.equal(fetches, 1);

      const conflict = await request(base, '/api/opportunities/import', {
        token, method:'POST', body:{
          sourceUrl:'https://jobs.lever.co/example/different-role',
          idempotencyKey:'idempotent-import-01',
        },
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error, 'idempotency_conflict');
      assert.equal(fetches, 1);

      const verifyBody = { idempotencyKey:'official-verify-0001' };
      const verified = await request(base, `/api/opportunities/${first.body.id}/verify-official-page`, {
        token, method:'POST', body:verifyBody,
      });
      const verifiedReplay = await request(base, `/api/opportunities/${first.body.id}/verify-official-page`, {
        token, method:'POST', body:verifyBody,
      });
      assert.equal(verified.status, 200);
      assert.equal(verified.body.officialApplyUrl, 'https://jobs.lever.co/example/idempotent-role');
      assert.deepEqual(verifiedReplay, verified);
      assert.equal(fetches, 2, 'verification replay must not repeat the external fetch');

      openState = 'closed';
      const closed = await request(base, `/api/opportunities/${first.body.id}/verify-official-page`, {
        token, method:'POST', body:{ idempotencyKey:'official-verify-closed' },
      });
      assert.equal(closed.status, 409);
      assert.equal(closed.body.error, 'opportunity_closed');

      const missingKey = await request(base, `/api/opportunities/${first.body.id}/verify-official-page`, {
        token, method:'POST', body:{},
      });
      assert.equal(missingKey.status, 400);
      assert.equal(missingKey.body.error, 'idempotency_key_required');
    });
  } finally {
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});
