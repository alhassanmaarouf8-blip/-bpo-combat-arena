import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MissionControlRequestError,
  createMissionControlClient,
  normalizeApplicationPack,
  normalizeInterviewPassPreview,
  normalizeMissionBundle,
  normalizePassport,
  normalizeResponseClassification,
} from './missionControlClient.js';

const canonicalPassport = Object.freeze({
  version: 1,
  roleTypes: ['customer_service'],
  industryKeys: ['telecom'],
  germanLevel: 'b2',
  locationMode: 'flexible',
  shiftPreferences: ['day', 'rotating'],
  availabilityDate: '2026-07-20',
  experienceBand: '1_2_years',
  salaryFloorEGP: 18_000,
  workAuthorization: 'egypt_authorized',
  skillIds: ['self_intro', 'deescalation'],
  facts: [{
    id: 'fact_contract_1234',
    type: 'achievement',
    value: 'Resolved 20 customer cases per shift.',
    provenance: 'user_confirmed',
    confirmedAt: 1_752_000_000_000,
    shareAllowed: true,
  }],
  consentVersion: 1,
  updatedAt: 1_752_000_000_100,
});

test('canonical Interview Pass keeps exactly three predictions and the complete claim token', () => {
  const longToken = 'x'.repeat(640);
  const preview = normalizeInterviewPassPreview({
    previewToken: longToken,
    expiresAt: '2026-07-13T12:00:00.000Z',
    predictions: ['Frage eins?', 'Frage zwei?', 'Frage drei?'],
    answerStructure: ['direct_answer', 'specific_evidence', 'role_relevance'],
    strongestEvidence: 'customer_contact',
    evidenceGap: { title: 'evidence_gap', detail: 'quantified_result' },
    day1: { id: 'vacancy_requirements_and_introduction', actions: ['map_requirements'] },
  });

  assert.equal(preview.previewToken, longToken);
  assert.equal(preview.practicePredictions.length, 3);
  assert.deepEqual(preview.confirmedEvidence, ['customer_contact']);
  assert.equal(preview.gap.detail, 'quantified_result');
  assert.equal(preview.dayOne.id, 'vacancy_requirements_and_introduction');
});

test('an incomplete prediction response fails instead of rendering an empty or misleading preview', () => {
  assert.throws(
    () => normalizeInterviewPassPreview({ predictions: ['Only one question'] }),
    (error) => error instanceof MissionControlRequestError && error.code === 'invalid_response',
  );
});

test('public Interview Pass status fails closed and preserves explicit on/beta attestations', async () => {
  const statusFor = async (payload) => createMissionControlClient({
    apiUrl:'https://example.test',
    fetchFn:async () => new Response(JSON.stringify(payload), {
      status:200, headers:{ 'content-type':'application/json' },
    }),
  }).getPreviewStatus();

  assert.deepEqual(await statusFor({}), { enabled:false, mode:'off' });
  assert.deepEqual(await statusFor({ enabled:false, mode:'on' }), { enabled:false, mode:'off' });
  assert.deepEqual(await statusFor({ enabled:true }), { enabled:true, mode:'on' });
  assert.deepEqual(await statusFor({ enabled:true, mode:'on' }), { enabled:true, mode:'on' });
  assert.deepEqual(await statusFor({ enabled:true, mode:'beta' }), { enabled:true, mode:'beta' });
  assert.deepEqual(await statusFor({ enabled:'true', mode:'beta' }), { enabled:false, mode:'off' });
  assert.deepEqual(await statusFor({ enabled:true, mode:'future' }), { enabled:false, mode:'off' });
  assert.deepEqual(await statusFor({ enabled:true, mode:null }), { enabled:false, mode:'off' });
  assert.deepEqual(await statusFor({ enabled:true, mode:7 }), { enabled:false, mode:'off' });
  assert.deepEqual(await statusFor({ enabled:true, mode:' on ' }), { enabled:false, mode:'off' });
});

test('post-signup bundle preserves only the entitled Interview Pass schedule', () => {
  const bundle = normalizeMissionBundle({
    enabled:true,
    capabilities:{ fullWrittenPlan:false, fullPassport:false },
    passport:canonicalPassport,
    interviewPass:{
      id:'pass_contract_1234', roleType:'customer_service', industryKey:'telecom',
      germanLevel:'b2', timing:'seven_plus_days', planAccess:'day_one', targetedLive:false,
      schedule:[{ id:'vacancy_requirements_and_introduction', title:'vacancy_requirements_and_introduction',
        actions:['map_requirements'], day:1, live:false }], claimedAt:1_752_000_000_000,
    },
  });
  assert.equal(bundle.enabled, true);
  assert.equal(bundle.interviewPass.planAccess, 'day_one');
  assert.equal(bundle.interviewPass.schedule.length, 1);
  assert.equal(bundle.passport.facts[0].value, canonicalPassport.facts[0].value);
});

test('candidate passport preserves exact facts, numeric consent, and numeric timestamps', () => {
  const passport = normalizePassport({ passport: canonicalPassport });
  assert.equal(passport.locationMode, 'flexible');
  assert.equal(passport.experienceBand, '1_2_years');
  assert.equal(passport.workAuthorization, 'egypt_authorized');
  assert.equal(passport.consentVersion, 1);
  assert.equal(passport.facts[0].type, 'achievement');
  assert.equal(passport.facts[0].provenance, 'user_confirmed');
  assert.equal(passport.facts[0].confirmedAt, 1_752_000_000_000);
});

test('passport PUT round-trips the canonical schema without renaming facts', async () => {
  let sentBody = null;
  const fetchFn = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ passport: canonicalPassport }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = createMissionControlClient({ apiUrl: 'https://example.test', token: 'token', fetchFn });
  const saved = await client.savePassport(canonicalPassport);

  assert.deepEqual(sentBody.facts, canonicalPassport.facts);
  assert.equal(Object.hasOwn(sentBody, 'confirmedFacts'), false);
  assert.equal(sentBody.consentVersion, 1);
  assert.match(sentBody.idempotencyKey, /^passport_[a-zA-Z0-9_-]+$/u);
  assert.equal(saved.facts[0].confirmedAt, canonicalPassport.facts[0].confirmedAt);
});

test('all authenticated client mutations generate payload idempotency keys and support explicit retry keys', async () => {
  const requests = [];
  const fetchFn = async (url, init) => {
    requests.push({ url, method:init.method, body:init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/verify-official-page')) {
      return new Response(JSON.stringify({
        opportunityId:'opp_contract_1234',
        officialApplyUrl:'https://jobs.lever.co/example/role',
        verifiedAt:1_752_000_000_000,
      }), { status:200 });
    }
    if (url.endsWith('/opportunities/import')) {
      return new Response(JSON.stringify({ id:'opp_contract_1234' }), { status:201 });
    }
    return new Response(JSON.stringify({}), { status:200 });
  };
  const client = createMissionControlClient({ apiUrl:'https://example.test', token:'token', fetchFn });
  await client.importOpportunity(
    { sourceUrl:'https://jobs.lever.co/example/role' },
    { idempotencyKey:'retry_opportunity_001' },
  );
  const verified = await client.verifyOfficialPage('opp_contract_1234', {
    idempotencyKey:'retry_verify_0001',
  });
  assert.equal(requests[0].body.idempotencyKey, 'retry_opportunity_001');
  assert.equal(requests[1].body.idempotencyKey, 'retry_verify_0001');
  assert.equal(verified.officialApplyUrl, 'https://jobs.lever.co/example/role');
});

test('preview POST never transmits local CV text or unapproved keys', async () => {
  let sentBody = null;
  const fetchFn = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      previewToken: 't'.repeat(160),
      expiresAt: '2026-07-13T12:00:00.000Z',
      predictions: ['Q1', 'Q2', 'Q3'],
      answerStructure: ['direct_answer', 'specific_evidence', 'role_relevance'],
      strongestEvidence: 'customer_contact',
      evidenceGap: null,
      day1: { id: 'vacancy_requirements_and_introduction', actions: [] },
    }), { status: 200 });
  };
  const client = createMissionControlClient({ apiUrl: 'https://example.test', fetchFn });
  await client.preview({
    roleType: 'customer_service', industryKey: 'telecom', germanLevel: 'b2',
    timing: 'today', evidenceCategories: ['customer_contact'], cvText: 'must remain local',
  });

  assert.deepEqual(Object.keys(sentBody).sort(), [
    'evidenceCategories', 'germanLevel', 'industryKey', 'roleType', 'timing',
  ]);
  assert.equal(JSON.stringify(sentBody).includes('must remain local'), false);
});

test('application pack and response classifiers accept the canonical public contracts', () => {
  const pack = normalizeApplicationPack({ pack: {
    id: 'pack_contract_1234', opportunityId: 'opp_contract_1234', status: 'draft',
    title: 'German Customer Service', employerDisplay: 'Example Employer',
    facts: [{ id: 'fact_contract_1234', label: 'achievement', value: 'Resolved 20 cases.', source: 'user_confirmed' }],
    answers: [{ id: 'answer_contract_1234', question: 'Tell me about yourself.', answer: 'Confirmed evidence only.' }],
    factLockIds: ['fact_contract_1234'], checklist: ['review_facts', 'official_apply'],
  } });
  assert.deepEqual(pack.factLockIds, ['fact_contract_1234']);
  assert.equal(pack.facts[0].value, 'Resolved 20 cases.');

  const response = normalizeResponseClassification({ type: 'interview_invitation', confidence: 'high' });
  assert.equal(response.classification, 'interview_invitation');
});
