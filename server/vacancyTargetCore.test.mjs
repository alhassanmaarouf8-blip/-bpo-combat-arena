import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET ||= 'vacancy-core-test-secret';

const core = await import('./vacancyTargetCore.js');
const { analyzeVacancyWithFallback, resetVacancyAiFuseForTests } = await import('./vacancyTarget.js');

const SAMPLE = `Customer Service Agent
We are hiring a full-time customer service agent for an e-commerce account.
Requirements: German B2, professional complaint handling, accurate documentation,
flexible shift availability, and at least one year of customer support experience.
Apply at jobs@example.com, https://example.com/apply, or +20 100 000 0000.`;

function sampleDraft(now = Date.parse('2026-07-13T09:00:00Z')) {
  const source = core.preparePastedVacancy(SAMPLE);
  const analysis = core.analyzeVacancyDeterministically(source);
  return core.buildVacancyDraft({ source, analysis, interviewDate: '2026-08-01', now });
}

test('pasted source is bounded, canonicalized, redacted, and never copied into the target', () => {
  const source = core.preparePastedVacancy(SAMPLE);
  assert.match(source.sourceHash, /^[a-f0-9]{64}$/u);
  assert.equal(source.text.includes('jobs@example.com'), false);
  assert.equal(source.text.includes('https://example.com'), false);
  assert.equal(source.text.includes('+20 100 000 0000'), false);
  assert.match(source.text, /\[email\]/u);
  assert.match(source.text, /\[link\]/u);
  assert.match(source.text, /\[phone\]/u);
  assert.equal(core.vacancySourceHash(' same\n value '), core.vacancySourceHash('same value'));
  assert.throws(() => core.preparePastedVacancy('not a vacancy'), (error) => error.code === 'unsupported_vacancy');
  assert.throws(
    () => core.preparePastedVacancy(`Job vacancy ${'x'.repeat(core.VACANCY_MAX_SOURCE_CHARS)}`),
    (error) => error.code === 'analysis_limit' && error.status === 413,
  );

  const draft = sampleDraft();
  const serialized = JSON.stringify(draft);
  assert.equal(serialized.includes('jobs@example.com'), false);
  assert.equal(serialized.includes('example.com/apply'), false);
  assert.equal(Object.hasOwn(draft, 'text'), false);
  assert.equal(Object.hasOwn(draft, 'url'), false);
});

test('deterministic analysis and seven-day schedule use controlled enums only', () => {
  const source = core.preparePastedVacancy(SAMPLE);
  const first = core.analyzeVacancyDeterministically(source);
  const second = core.analyzeVacancyDeterministically(source);
  assert.deepEqual(first, second);
  assert.equal(first.roleType, 'customer_service');
  assert.equal(first.germanLevel, 'b2');
  assert.equal(first.industryKey, 'ecommerce');
  assert.ok(first.skillIds.every((id) => core.VACANCY_SKILL_IDS.includes(id)));
  assert.ok(first.questionTopicIds.every((id) => core.VACANCY_QUESTION_TOPIC_IDS.includes(id)));
  assert.ok(first.displayRequirements.length <= 6);

  const scheduleA = core.buildVacancySchedule(first);
  const scheduleB = core.buildVacancySchedule(first);
  assert.equal(scheduleA.length, 7);
  assert.deepEqual(scheduleA, scheduleB);
  assert.deepEqual(scheduleA.map((row) => row.day), [1, 2, 3, 4, 5, 6, 7]);
  for (const row of scheduleA) {
    assert.ok(row.skillIds.every((id) => core.VACANCY_SKILL_IDS.includes(id)));
    assert.ok(row.questionTopicIds.every((id) => core.VACANCY_QUESTION_TOPIC_IDS.includes(id)));
  }
});

test('AI enrichment is impossible while its flag is off and malformed AI fields fail closed', async () => {
  const source = core.preparePastedVacancy(SAMPLE);
  let calls = 0;
  const deterministic = await analyzeVacancyWithFallback(source, { aiEnabled: false }, {
    fetchFn: async () => { calls += 1; throw new Error('must not run'); },
  });
  assert.equal(calls, 0);

  const responsePayload = {
    choices: [{ message: { content: JSON.stringify({
      roleType: '__proto__',
      industryKey: 'internal_network',
      germanLevel: 'native',
      skillIds: ['closing', 'arbitrary_tool'],
      questionTopicIds: ['sales_objection', 'steal_secrets'],
      displayRequirements: ['Valid short requirement', 'email attacker@example.com'],
    }) } }],
  };
  const enriched = await analyzeVacancyWithFallback(source, { aiEnabled: true }, {
    env: { GROQ_API_KEY: 'test-key' },
    fetchFn: async () => new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  assert.deepEqual(enriched, deterministic);
  assert.equal(JSON.stringify(enriched).includes('attacker@example.com'), false);
});

test('global AI fuse falls back deterministically without a second provider call', async () => {
  resetVacancyAiFuseForTests();
  const source = core.preparePastedVacancy(SAMPLE);
  let calls = 0;
  const responsePayload = { choices:[{ message:{ content:JSON.stringify({ roleType:'sales' }) } }] };
  const dependencies = {
    env:{ GROQ_API_KEY:'test', VACANCY_AI_GLOBAL_HOURLY_LIMIT:'1', VACANCY_AI_GLOBAL_MONTHLY_LIMIT:'1' },
    now:Date.parse('2026-07-13T09:00:00Z'),
    fetchFn:async () => {
      calls += 1;
      return new Response(JSON.stringify(responsePayload), { status:200, headers:{ 'content-type':'application/json' } });
    },
  };
  await analyzeVacancyWithFallback(source, { aiEnabled:true }, dependencies);
  const fallback = await analyzeVacancyWithFallback(source, { aiEnabled:true }, dependencies);
  assert.equal(calls, 1);
  assert.deepEqual(fallback, core.analyzeVacancyDeterministically(source));
  resetVacancyAiFuseForTests();
});

test('feature policy is fail-closed and enforces free/basic/elite/beta (trial REMOVED)', () => {
  const now = Date.parse('2026-07-13T09:00:00Z');
  const free = { id: 'free-1', subscription: { tier: 'trial', trialStartedAt: null } };
  const basic = { id: 'basic-1', subscription: { plan: 'basic' } };
  const elite = { id: 'elite-1', subscription: { plan: 'elite' } };
  const trial = { id: 'trial-1', subscription: { tier: 'trial', trialStartedAt: now - 1000 } };

  assert.equal(core.vacancyFlagsFor(free, { env: {}, now }).enabled, false);
  const env = { VACANCY_MODE: 'on', VACANCY_LIVE_ENABLED: 'true' };
  assert.equal(core.vacancyFlagsFor(free, { env, now }).previewOnly, true);
  assert.equal(core.vacancyFlagsFor(free, { env, now }).live, false);
  assert.equal(core.vacancyFlagsFor(basic, { env, now }).fullPlan, true);
  assert.equal(core.vacancyFlagsFor(basic, { env, now }).live, false);
  assert.equal(core.vacancyFlagsFor(elite, { env, now }).live, true);
  // Owner order 2026-07-25: the trial is removed — a trial stamp behaves as plain free.
  assert.equal(core.vacancyFlagsFor(trial, { env, now }).fullPlan, false);
  assert.equal(core.vacancyFlagsFor(trial, { env, now }).live, false);

  const betaEnv = { VACANCY_MODE: 'beta', VACANCY_BETA_ACCOUNT_IDS: 'other, free-1' };
  assert.equal(core.vacancyFlagsFor(free, { env: betaEnv, now }).enabled, true);
  assert.equal(core.vacancyFlagsFor(basic, { env: betaEnv, now }).enabled, false);
  assert.equal(core.vacancyFlagsFor({ ...basic, subscription: { ...basic.subscription, vacancyBeta: true } }, { env: betaEnv, now }).enabled, true);
});

test('free views expose Day 1 only; live context exposes controlled IDs and no employer', () => {
  const draft = sampleDraft();
  const active = { ...draft, status: 'active' };
  const preview = core.vacancyTargetView(active, { fullPlan: false });
  const full = core.vacancyTargetView(active, { fullPlan: true });
  assert.equal(preview.schedule.length, 1);
  assert.equal(full.schedule.length, 7);
  const context = core.safeVacancyContext(active);
  assert.deepEqual(Object.keys(context), [
    'targetId', 'industryKey', 'roleType', 'germanLevel', 'skillIds', 'questionTopicIds',
  ]);
  assert.equal(Object.hasOwn(context, 'employerDisplay'), false);
  assert.equal(Object.hasOwn(context, 'displayRequirements'), false);

  const profile = { vacancyTarget: { ...core.emptyVacancyState(), active } };
  const elite = { id: 'elite-live', subscription: { plan: 'elite' } };
  const basic = { id: 'basic-no-live', subscription: { plan: 'basic' } };
  const options = { env: { VACANCY_MODE: 'on', VACANCY_LIVE_ENABLED: '1' } };
  assert.deepEqual(core.vacancyLiveContext(profile, elite, options), context);
  assert.equal(core.vacancyLiveContext(profile, basic, options), null);
});

test('activation accepts only controlled overrides, re-derives arrays, and rebuilds schedule', () => {
  const now = Date.parse('2026-07-13T09:00:00Z');
  const draft = sampleDraft(now);
  const changed = core.activationOverrides({
    roleTitle: 'German Sales Agent',
    employerDisplay: null,
    industryKey: 'b2b',
    roleType: 'sales',
    germanLevel: 'c1',
    interviewDate: '2026-08-10',
  }, draft, now);
  assert.equal(changed.roleType, 'sales');
  assert.equal(changed.employerDisplay, null);
  assert.deepEqual(changed.skillIds, core.deriveVacancySkillIds('sales'));
  assert.deepEqual(changed.questionTopicIds, core.deriveVacancyQuestionTopicIds('sales'));
  assert.equal(changed.schedule.length, 7);
  assert.throws(() => core.activationOverrides({ industryKey: 'other' }, draft, now), (error) => error.code === 'unsupported_vacancy');
  assert.throws(() => core.activationOverrides({ skillIds: ['closing'] }, draft, now), (error) => error.code === 'unsupported_source');
  assert.throws(() => core.normalizeInterviewDate('2026-02-30', { now }), (error) => error.code === 'bad_interview_date');
});

test('state normalization bounds drafts/targets and discards unknown or unsafe persisted fields', () => {
  const draft = sampleDraft();
  const active = { ...draft, status: 'active' };
  const state = core.normalizeVacancyState({
    version: 1,
    draft: { ...draft, rawSource: SAMPLE, sourceUrl: 'https://secret.example/path' },
    active,
    previewUsedAt: draft.createdAt,
    analysisUsage: { day: '2026-07-13', count: 999999 },
    extraDrafts: [draft, draft],
  });
  assert.equal(state.analysisUsage.count, core.VACANCY_MAX_ANALYSES_PER_DAY);
  assert.equal(Object.hasOwn(state.draft, 'rawSource'), false);
  assert.equal(Object.hasOwn(state.draft, 'sourceUrl'), false);
  assert.equal(Object.hasOwn(state, 'extraDrafts'), false);
  assert.equal(core.normalizeVacancyTarget({ ...active, sourceHost: 'evil.example' }), null);
});
