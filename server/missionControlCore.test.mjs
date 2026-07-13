import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSION_CONTROL_MAX_PLAINTEXT_BYTES,
  MISSION_CONTROL_MAX_RECORDS,
  applicationReadinessLockHash,
  buildApplicationPack,
  buildInterviewPassPreview,
  buildOpportunity,
  claimInterviewPass,
  classifyResponseText,
  decryptMissionControlState,
  emptyMissionControlState,
  encryptMissionControlState,
  jobRadar,
  markApplicationSubmitted,
  missionControlFlagsFor,
  missionControlVacancyLiveContext,
  normalizeConfirmInterview,
  normalizeMissionControlState,
  normalizePassportInput,
  normalizeOpportunityEligibility,
  passportView,
  publicInterviewPass,
  publicOpportunity,
  refreshOpportunityReadiness,
  recordInterviewConfirmation,
  recordOpportunityOutcome,
  recordResponseClassification,
  verifyInterviewPassToken,
  approveApplicationPack,
  getIdempotencyRecord,
  idempotencyPayloadHash,
  resolveActiveVacancyBridge,
  setActiveVacancyBridge,
  storeIdempotencyRecord,
} from './missionControlCore.js';

const NOW = Date.parse('2026-07-13T09:00:00.000Z');
const KEY = Buffer.alloc(32, 7);
const BASIC = { id:'acct_basic_test', subscription:{ plan:'basic' } };
const ELITE = { id:'acct_elite_test', subscription:{ plan:'elite' } };
const ENV = {
  INTERVIEW_PASS_MODE:'on',
  OPPORTUNITY_COPILOT_MODE:'on',
  JOB_DISCOVERY_LIVE_ENABLED:'true',
  VACANCY_MODE:'on',
  VACANCY_LIVE_ENABLED:'true',
};
const VERIFIED_EVIDENCE = Object.freeze({
  now:NOW,
  accountVerified:true,
  assessmentCurrent:true,
  assessedAt:NOW,
  measuredGermanRank:2,
  meaningfulDebrief:true,
});

function passport(now = NOW) {
  return normalizePassportInput({
    roleTypes:['customer_service'],
    industryKeys:['telecom'],
    germanLevel:'b2',
    locationMode:'remote',
    shiftPreferences:['day', 'evening'],
    availabilityDate:null,
    experienceBand:'1_2_years',
    salaryFloorEGP:15_000,
    workAuthorization:'egypt_authorized',
    locationEligibilities:['cairo', 'egypt', 'remote_egypt'],
    skillIds:['self_intro', 'motivation', 'availability', 'star_story', 'data_capture', 'deescalation'],
    facts:[
      { id:'fact_customer_01', type:'experience', value:'Handled German customer requests for one year.',
        provenance:'user_confirmed', confirmedAt:now, shareAllowed:true },
      { id:'fact_result_0001', type:'achievement', value:'Resolved escalations while keeping records accurate.',
        provenance:'user_confirmed', confirmedAt:now, shareAllowed:true },
    ],
    consentVersion:1,
  }, now);
}

function readyOpportunity(candidate, now = NOW) {
  return buildOpportunity({
    sourceHash:'a'.repeat(64),
    sourceHost:'jobs.lever.co',
    officialApplyUrl:'https://jobs.lever.co/example/german-agent?utm_source=private#apply',
  }, {
    roleTitle:'German Customer Service Agent',
    employerDisplay:'Example Support',
    location:'Cairo',
    postedDate:'2026-07-12',
    openState:'open',
    roleType:'customer_service',
    industryKey:'telecom',
    germanLevel:'b2',
    skillIds:['self_intro', 'motivation', 'availability', 'star_story', 'data_capture', 'deescalation'],
    questionTopicIds:['self_introduction', 'motivation', 'work_experience', 'customer_escalation'],
    displayRequirements:['German customer service', 'Accurate documentation'],
    eligibilityRequirements:{
      verifiedDimensions:['location', 'work_mode', 'work_authorization', 'shift', 'availability', 'experience', 'salary'],
      locationKeys:[], workModes:[], workAuthorizations:[], shifts:[], requiredStartDate:null,
      minimumExperienceBand:null, salaryMinEGP:null, salaryMaxEGP:null,
    },
  }, candidate, now, { ...VERIFIED_EVIDENCE, now });
}

test('Mission Control flags fail closed, pause globally, and keep targeted live Elite-only', () => {
  assert.equal(missionControlFlagsFor(BASIC, { env:{}, now:NOW }).copilotEnabled, false);
  assert.equal(missionControlFlagsFor(BASIC, { env:{ ...ENV, MISSION_CONTROL_PAUSED:'true' }, now:NOW }).copilotEnabled, false);
  assert.equal(missionControlFlagsFor(BASIC, { env:ENV, now:NOW }).targetedLive, false);
  assert.equal(missionControlFlagsFor(ELITE, { env:ENV, now:NOW }).targetedLive, true);
  assert.equal(missionControlFlagsFor(ELITE, {
    env:{ ...ENV, VACANCY_LIVE_ENABLED:'false' }, now:NOW,
  }).targetedLive, false);
});

test('Interview Pass is deterministic, compact, signed, expiring, and one-use for Free', () => {
  const request = {
    roleType:'customer_service', industryKey:'telecom', germanLevel:'b2',
    timing:'one_two_days', evidenceCategories:['customer_contact', 'deescalation'],
  };
  const preview = buildInterviewPassPreview(request, { key:KEY, now:NOW });
  assert.equal(preview.predictions.length, 3);
  assert.ok(preview.previewToken.length < 300);
  const payload = verifyInterviewPassToken(preview.previewToken, { key:KEY, now:NOW + 1_000 });
  const flags = missionControlFlagsFor({ id:'acct_free', subscription:{ plan:'free' } }, { env:ENV, now:NOW });
  const claimed = claimInterviewPass(emptyMissionControlState(), payload, flags, NOW);
  assert.equal(claimed.created, true);
  const freeView = publicInterviewPass(claimed.pass, flags);
  const basicView = publicInterviewPass(claimed.pass, missionControlFlagsFor(BASIC, { env:ENV, now:NOW }));
  assert.equal(freeView.schedule.length, 1);
  assert.equal(freeView.planAccess, 'day_one');
  assert.equal(basicView.schedule.length, 7);
  assert.equal(basicView.planAccess, 'full');
  assert.equal(Object.hasOwn(basicView, 'previewId'), false);
  assert.equal(claimInterviewPass(claimed.state, payload, flags, NOW + 1).created, false);
  assert.throws(() => verifyInterviewPassToken(`${preview.previewToken}x`, { key:KEY, now:NOW }), /invalid_preview_token/u);
  assert.throws(() => verifyInterviewPassToken(preview.previewToken, { key:KEY, now:Date.parse(preview.expiresAt) }), /preview_token_expired/u);
});

test('Candidate Passport round-trips exactly for the authenticated owner and is account-bound at rest', () => {
  const candidate = passport();
  assert.deepEqual(passportView(candidate, { fullPassport:false }), candidate);
  const state = { ...emptyMissionControlState(), passport:candidate, updatedAt:NOW };
  const envelope = encryptMissionControlState(state, 'user_alpha_0001', { key:KEY, iv:Buffer.alloc(12, 3) });
  assert.equal(JSON.stringify(envelope).includes(candidate.facts[0].value), false);
  assert.deepEqual(decryptMissionControlState(envelope, 'user_alpha_0001', { key:KEY }).passport, candidate);
  assert.throws(() => decryptMissionControlState(envelope, 'user_beta_00002', { key:KEY }), /private_state_unavailable/u);
});

test('encrypted state uses one symmetric bound and full generated plan capacity round-trips', () => {
  const candidate = passport();
  const seedOpportunity = readyOpportunity(candidate);
  const flags = missionControlFlagsFor(BASIC, { env:ENV, now:NOW });
  const seedState = { ...emptyMissionControlState(), passport:candidate,
    opportunities:[seedOpportunity], updatedAt:NOW };
  const seedPack = buildApplicationPack(seedState, seedOpportunity, flags, NOW + 1).pack;
  const opportunities = [];
  const applicationPacks = [];
  for (let index = 0; index < MISSION_CONTROL_MAX_RECORDS; index += 1) {
    const suffix = index.toString(16).padStart(24, '0');
    const opportunityId = `opp_${suffix}`;
    opportunities.push({
      ...seedOpportunity,
      id:opportunityId,
      sourceHash:index.toString(16).padStart(64, '0'),
      importedAt:NOW + index,
      updatedAt:NOW + index,
    });
    applicationPacks.push({
      ...seedPack,
      id:`pack_${suffix}`,
      opportunityId,
      createdAt:NOW + index,
      updatedAt:NOW + index,
    });
  }
  const maxPlanState = normalizeMissionControlState({
    ...emptyMissionControlState(), passport:candidate, opportunities, applicationPacks,
    idempotencyRecords:Array.from({ length:100 }, (_, index) => ({
      key:`capacity_${String(index).padStart(8, '0')}`,
      operation:'official_page_verify',
      payloadHash:index.toString(16).padStart(64, '0'),
      responseStatus:200,
      responseValue:{
        a:'a'.repeat(3800), b:'b'.repeat(3800), c:'c'.repeat(3800), d:'d'.repeat(3800),
      },
      createdAt:NOW + index,
    })),
    updatedAt:NOW,
  });
  const envelope = encryptMissionControlState(maxPlanState, 'user_maximum_plan', { key:KEY, iv:Buffer.alloc(12, 8) });
  assert.ok(Buffer.from(envelope.ciphertext, 'base64url').length < MISSION_CONTROL_MAX_PLAINTEXT_BYTES);
  const roundTrip = decryptMissionControlState(envelope, 'user_maximum_plan', { key:KEY });
  assert.equal(roundTrip.opportunities.length, MISSION_CONTROL_MAX_RECORDS);
  assert.equal(roundTrip.applicationPacks.length, MISSION_CONTROL_MAX_RECORDS);
  assert.equal(roundTrip.idempotencyRecords.length, 100);

  const oversizedPacks = applicationPacks.map((pack) => ({
    ...pack,
    summary:'x'.repeat(1600),
    coverNote:'y'.repeat(3000),
    facts:Array.from({ length:30 }, (_, index) => ({
      id:`fact_${index.toString(16).padStart(12, '0')}`,
      label:'l'.repeat(100), value:'v'.repeat(240), source:'user_confirmed',
    })),
    answers:Array.from({ length:20 }, (_, index) => ({
      id:`answer_${index.toString(16).padStart(12, '0')}`,
      question:'q'.repeat(500), answer:'a'.repeat(1200),
    })),
    warnings:Array.from({ length:12 }, (_, index) => `${index}${'w'.repeat(298)}`),
  }));
  assert.throws(() => encryptMissionControlState({
    ...maxPlanState, applicationPacks:oversizedPacks,
  }, 'user_oversized_plan', { key:KEY, iv:Buffer.alloc(12, 9) }), /private_state_too_large/u);
});

test('self-reported profile data never authorizes an application without server evidence', () => {
  const candidate = passport();
  const opportunity = buildOpportunity({
    sourceHash:'b'.repeat(64), sourceHost:'jobs.lever.co',
    officialApplyUrl:'https://jobs.lever.co/example/unverified-candidate',
  }, {
    roleTitle:'German Customer Service Agent', openState:'open', roleType:'customer_service',
    industryKey:'telecom', germanLevel:'b2', skillIds:['deescalation'],
    questionTopicIds:['customer_escalation'], displayRequirements:['German B2'],
  }, candidate, NOW);
  assert.equal(opportunity.readinessState, 'MEASURE_FIRST');
  assert.deepEqual(opportunity.readinessReasons, [
    'account_unverified', 'assessment_required', 'debrief_required', 'location_unknown',
    'work_mode_unknown', 'work_authorization_unknown', 'shift_unknown',
    'availability_unknown', 'experience_unknown', 'salary_unknown',
  ]);
});

test('controlled eligibility covers location, work mode, authorization, shifts, availability, experience, and salary', () => {
  const fromPassport = (base, overrides = {}) => {
    const { version:_version, updatedAt:_updatedAt, ...input } = base;
    return normalizePassportInput({ ...input, ...overrides }, NOW);
  };
  const requirements = normalizeOpportunityEligibility({
    verifiedDimensions:['location', 'work_mode', 'work_authorization', 'shift', 'availability', 'experience', 'salary'],
    locationKeys:['cairo'],
    workModes:['remote'],
    workAuthorizations:['egypt_authorized'],
    shifts:['day'],
    requiredStartDate:'2026-07-14',
    minimumExperienceBand:'1_2_years',
    salaryMinEGP:15_000,
    salaryMaxEGP:20_000,
  });
  const analysis = {
    roleTitle:'German Customer Service Agent', employerDisplay:'Example Support', location:'Cairo',
    postedDate:'2026-07-12', openState:'open', roleType:'customer_service', industryKey:'telecom',
    germanLevel:'b2', skillIds:['deescalation'], questionTopicIds:['customer_escalation'],
    displayRequirements:['German B2'], eligibilityRequirements:requirements,
  };
  const source = {
    sourceHash:'c'.repeat(64), sourceHost:'jobs.lever.co',
    officialApplyUrl:'https://jobs.lever.co/example/eligibility',
  };
  const matching = fromPassport(passport(), { availabilityDate:'2026-07-13' });
  const unverifiedDimensions = buildOpportunity(
    { ...source, sourceHash:'1'.repeat(64) },
    { ...analysis, eligibilityRequirements:undefined },
    matching, NOW, VERIFIED_EVIDENCE,
  );
  assert.equal(unverifiedDimensions.readinessState, 'MEASURE_FIRST');
  assert.equal(publicOpportunity(unverifiedDimensions).hardFit, false);
  assert.deepEqual(unverifiedDimensions.readinessReasons, [
    'location_unknown', 'work_mode_unknown', 'work_authorization_unknown', 'shift_unknown',
    'availability_unknown', 'experience_unknown', 'salary_unknown',
  ]);
  const ready = buildOpportunity(source, analysis, matching, NOW, VERIFIED_EVIDENCE);
  assert.equal(ready.readinessState, 'READY_TO_APPLY');
  assert.deepEqual(ready.fitReasons.slice(-7), [
    'location', 'work_mode', 'work_authorization', 'shift', 'availability', 'experience', 'salary',
  ]);

  const unknown = fromPassport(matching, {
    locationEligibilities:[], shiftPreferences:[], availabilityDate:null, salaryFloorEGP:null,
  });
  const measure = buildOpportunity({ ...source, sourceHash:'d'.repeat(64) }, analysis, unknown, NOW, VERIFIED_EVIDENCE);
  assert.equal(measure.readinessState, 'MEASURE_FIRST');
  assert.deepEqual(measure.readinessReasons, [
    'location_unknown', 'shift_unknown', 'availability_unknown', 'salary_unknown',
  ]);

  const mismatch = fromPassport(matching, {
    locationEligibilities:['alexandria'], locationMode:'onsite', workAuthorization:'eu_authorized',
    shiftPreferences:['night'], availabilityDate:'2026-07-20', experienceBand:'entry', salaryFloorEGP:25_000,
  });
  const hard = buildOpportunity({ ...source, sourceHash:'e'.repeat(64) }, analysis, mismatch, NOW, VERIFIED_EVIDENCE);
  assert.equal(hard.readinessState, 'HARD_MISMATCH');
  assert.deepEqual(hard.readinessReasons, [
    'location_gap', 'work_mode_gap', 'work_authorization_gap', 'shift_gap',
    'availability_gap', 'experience_gap', 'salary_gap',
  ]);
  assert.ok(hard.fitGaps.includes('location'));
  assert.ok(hard.fitGaps.includes('salary'));
  assert.throws(() => normalizeOpportunityEligibility({ ...requirements, rawRequirement:'secret' }), /invalid_opportunity/u);
});

test('truth-locked tracker survives response, interview, and outcome transitions without raw recruiter text', () => {
  const flags = missionControlFlagsFor(BASIC, { env:ENV, now:NOW });
  let state = { ...emptyMissionControlState(), passport:passport(), updatedAt:NOW };
  const opportunity = readyOpportunity(state.passport);
  assert.equal(opportunity.readinessState, 'READY_TO_APPLY');
  state.opportunities.push(opportunity);

  const built = buildApplicationPack(state, opportunity, flags, NOW + 1);
  assert.equal(built.pack.facts.length, 2);
  assert.match(built.pack.summary, /Handled German customer requests/u);
  assert.equal(JSON.stringify(built.pack).includes('invented'), false);
  state = built.state;

  const approved = approveApplicationPack(state, built.pack.id, {
    confirmed:true, factLockIds:built.pack.factLockIds, confirmationVersion:1,
  }, NOW + 2);
  state = approved.state;
  const submitted = markApplicationSubmitted(state, built.pack.id, { confirmed:true }, NOW + 3);
  state = submitted.state;
  assert.equal(state.opportunities[0].status, 'user_submitted');

  const acknowledgement = classifyResponseText('Vielen Dank, Ihre Bewerbung ist bei uns eingegangen.');
  const acknowledged = recordResponseClassification(state, opportunity.id, acknowledgement, NOW + 4);
  state = acknowledged.state;
  assert.equal(state.opportunities[0].status, 'acknowledged');

  const recruiterText = 'Einladung zum Vorstellungsgespräch am 14.07 um 14 Uhr. recruiter@example.com';
  const invitation = classifyResponseText(recruiterText);
  const proposed = recordResponseClassification(state, opportunity.id, invitation, NOW + 5);
  state = proposed.state;
  assert.equal(state.opportunities[0].status, 'interview_proposed');
  assert.equal(JSON.stringify(state).includes(recruiterText), false);
  assert.deepEqual(state.responseEvents.at(-1), {
    opportunityId:opportunity.id, type:'interview_invitation', confidence:'high',
    createdAt:NOW + 5, confirmedAt:null,
  });

  let publicTracker = publicOpportunity(state.opportunities[0], state);
  assert.deepEqual(publicTracker.applicationPack, {
    id:built.pack.id, status:'submitted', trackingOnly:false,
  });
  assert.equal(publicTracker.latestResponse, 'interview_invitation');

  const confirmation = normalizeConfirmInterview({
    interviewDate:'2026-07-14', interviewTime:'14:00', timezone:'Africa/Cairo', confirmed:true,
  }, NOW);
  const confirmed = recordInterviewConfirmation(state, opportunity.id, confirmation, NOW + 6);
  state = confirmed.state;
  assert.equal(state.opportunities[0].status, 'interview_confirmed');
  assert.equal(state.responseEvents.at(-1).confirmedAt, NOW + 6);
  assert.equal(state.interviews[0].interviewDate, '2026-07-14');
  assert.equal(Object.hasOwn(state.responseEvents.at(-1), 'interviewDate'), false);

  const offered = recordOpportunityOutcome(state, opportunity.id, { outcome:'offer' }, NOW + 7);
  state = offered.state;
  assert.equal(state.opportunities[0].status, 'offer');
  assert.equal(jobRadar(state, flags).length, 0);
  publicTracker = publicOpportunity(state.opportunities[0], state);
  assert.equal(publicTracker.latestResponse, 'interview_invitation');
});

test('application pack lock covers the whole Passport, server evidence, and opportunity readiness inputs', () => {
  const flags = missionControlFlagsFor(BASIC, { env:ENV, now:NOW });
  const makeDraft = () => {
    const candidate = passport();
    const opportunity = readyOpportunity(candidate);
    const state = { ...emptyMissionControlState(), passport:candidate,
      opportunities:[opportunity], updatedAt:NOW };
    return buildApplicationPack(state, opportunity, flags, NOW + 1);
  };
  const approvalBody = (pack) => ({
    confirmed:true, factLockIds:pack.factLockIds, confirmationVersion:1,
  });

  const passportChanged = makeDraft();
  const { version:_version, updatedAt:_updatedAt, ...passportInput } = passportChanged.state.passport;
  passportChanged.state.passport = normalizePassportInput({ ...passportInput, salaryFloorEGP:16_000 }, NOW + 2);
  const refreshedPassport = refreshOpportunityReadiness(
    passportChanged.state, passportChanged.state.passport, NOW + 2,
    { ...VERIFIED_EVIDENCE, now:NOW + 2 },
  );
  assert.equal(refreshedPassport.opportunities[0].readinessState, 'READY_TO_APPLY');
  assert.notEqual(applicationReadinessLockHash(
    refreshedPassport.passport, refreshedPassport.opportunities[0],
  ), passportChanged.pack.readinessLockHash);
  assert.throws(() => approveApplicationPack(
    refreshedPassport, passportChanged.pack.id, approvalBody(passportChanged.pack), NOW + 3,
  ), /application_pack_stale/u);

  const evidenceChanged = makeDraft();
  const refreshedEvidence = refreshOpportunityReadiness(
    evidenceChanged.state, evidenceChanged.state.passport, NOW + 2,
    { ...VERIFIED_EVIDENCE, assessedAt:NOW - 1, now:NOW + 2 },
  );
  assert.equal(refreshedEvidence.opportunities[0].readinessState, 'READY_TO_APPLY');
  assert.throws(() => approveApplicationPack(
    refreshedEvidence, evidenceChanged.pack.id, approvalBody(evidenceChanged.pack), NOW + 3,
  ), /application_pack_stale/u);

  const readinessLost = makeDraft();
  const noLongerReady = refreshOpportunityReadiness(
    readinessLost.state, readinessLost.state.passport, NOW + 2,
    { ...VERIFIED_EVIDENCE, accountVerified:false, now:NOW + 2 },
  );
  assert.equal(noLongerReady.opportunities[0].readinessState, 'MEASURE_FIRST');
  assert.throws(() => approveApplicationPack(
    noLongerReady, readinessLost.pack.id, approvalBody(readinessLost.pack), NOW + 3,
  ), /not_ready_to_apply/u);

  const opportunityChanged = makeDraft();
  opportunityChanged.state.opportunities[0].sourceHash = 'f'.repeat(64);
  assert.throws(() => approveApplicationPack(
    opportunityChanged.state, opportunityChanged.pack.id, approvalBody(opportunityChanged.pack), NOW + 3,
  ), /application_pack_stale/u);
});

test('state normalization preserves only bounded response events and valid tracker relations', () => {
  const candidate = passport();
  const opportunity = readyOpportunity(candidate);
  const normalized = normalizeMissionControlState({
    ...emptyMissionControlState(), passport:candidate, opportunities:[opportunity],
    responseEvents:[
      { opportunityId:opportunity.id, type:'assessment', confidence:'medium', createdAt:NOW, confirmedAt:null },
      { opportunityId:opportunity.id, type:'raw_text', confidence:'high', createdAt:NOW, raw:'secret' },
      { opportunityId:`opp_${'z'.repeat(24)}`, type:'other', confidence:'low', createdAt:NOW, confirmedAt:null },
    ],
    updatedAt:NOW,
  });
  assert.deepEqual(normalized.responseEvents, [
    { opportunityId:opportunity.id, type:'assessment', confidence:'medium', createdAt:NOW, confirmedAt:null },
  ]);
  assert.equal(JSON.stringify(normalized).includes('secret'), false);
});

test('encrypted idempotency ledger and active vacancy bridge are bounded and relationship-safe', () => {
  const opportunity = readyOpportunity(passport());
  let state = { ...emptyMissionControlState(), passport:passport(), opportunities:[opportunity], updatedAt:NOW };
  const payloadHash = idempotencyPayloadHash({ opportunityId:opportunity.id, confirmed:true });
  const first = storeIdempotencyRecord(state, {
    key:'request_00000001', operation:'application_pack_approve', payloadHash,
    responseStatus:200, responseValue:{ id:'safe_result', created:true }, createdAt:NOW,
  });
  state = first.state;
  assert.equal(first.created, true);
  assert.equal(getIdempotencyRecord(state, 'request_00000001', 'application_pack_approve', payloadHash)?.responseStatus, 200);
  assert.throws(() => getIdempotencyRecord(
    state, 'request_00000001', 'application_pack_approve', 'f'.repeat(64),
  ), /idempotency_conflict/u);
  assert.throws(() => storeIdempotencyRecord(state, {
    key:'request_00000002', operation:'application_pack_approve', payloadHash,
    responseStatus:200, responseValue:{ huge:'x'.repeat(17_000) }, createdAt:NOW + 1,
  }), /invalid_idempotency_record/u);

  for (let index = 2; index <= 102; index += 1) {
    state = storeIdempotencyRecord(state, {
      key:`request_${String(index).padStart(8, '0')}`,
      operation:'application_pack_approve', payloadHash, responseStatus:200,
      responseValue:{ index }, createdAt:NOW + index,
    }).state;
  }
  assert.equal(state.idempotencyRecords.length, 100);
  assert.equal(getIdempotencyRecord(state, 'request_00000001', 'application_pack_approve', payloadHash), null);

  state = setActiveVacancyBridge(state, {
    opportunityId:opportunity.id,
    targetId:`vac_${'a'.repeat(24)}`,
    interviewDate:'2026-07-14',
    activatedAt:NOW + 200,
  });
  const context = resolveActiveVacancyBridge(state, opportunity.id);
  assert.deepEqual(context, {
    opportunityId:opportunity.id,
    targetId:`vac_${'a'.repeat(24)}`,
    interviewDate:'2026-07-14',
    activatedAt:NOW + 200,
    roleType:'customer_service',
    industryKey:'telecom',
    germanLevel:'b2',
    skillIds:opportunity.skillIds,
    questionTopicIds:opportunity.questionTopicIds,
  });
  assert.equal(Object.hasOwn(context, 'employerDisplay'), false);
  const profile = { userId:ELITE.id };
  profile.missionControlEncrypted = encryptMissionControlState(state, profile.userId, { key:KEY, iv:Buffer.alloc(12, 5) });
  assert.equal(missionControlVacancyLiveContext(profile, ELITE, {
    key:KEY, env:{ ...ENV, MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'true' }, now:NOW,
  })?.targetId, `vac_${'a'.repeat(24)}`);
  assert.equal(missionControlVacancyLiveContext(profile, ELITE, {
    key:KEY, env:{ ...ENV, MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'false' }, now:NOW,
  }), null);
  assert.equal(missionControlVacancyLiveContext(profile, BASIC, {
    key:KEY, env:{ ...ENV, MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'true' }, now:NOW,
  }), null);
  const orphaned = normalizeMissionControlState({
    ...state, opportunities:[], activeVacancyBridge:state.activeVacancyBridge,
  });
  assert.equal(orphaned.activeVacancyBridge, null);
});
