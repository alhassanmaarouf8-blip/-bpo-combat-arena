import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.AUTH_SECRET ||= 'outcome-calibration-test-secret';
const auth = await import('./auth.js');
const { placementRouter } = await import('./placement.js');
const { defaultProfile, deleteUser, loadUser, saveUser } = await import('./store.js');
const {
  captureOutcomeForecast,
  normalizeOutcomeCalibration,
  outcomeCalibrationSummary,
  recordCalibratedOutcome,
} = await import('./outcomeCalibration.js');

const NOW = 1_800_000_000_000;

function reliableRiskSession(date = NOW) {
  return {
    sessionId: `session-${date}`,
    date,
    bossId: 'yasmin',
    targetIndustry: 'telecom',
    targetRoleType: 'customer_service',
    scenarioId: 'telecom-billing',
    wpm: 120,
    words: 120,
    fillers: 2,
    grammarMeasured: true,
    grammarRules: [],
    subClauseRate: 0.3,
    vocabDiversity: 0.5,
    giveUpRate: 0.1,
    intelligibility: 0.4,
    latencyS: 2,
    evidenceQuality: {
      version: 2,
      words: 120,
      eligibleWords: 120,
      completeTurns: 6,
      truncatedTurns: 0,
      stageCoverage: 3,
      prescriptionEligible: true,
      highConfidence: true,
    },
  };
}

test('a pre-interview forecast is immutable-account bound, idempotent, and contains no raw evidence', () => {
  const profile = defaultProfile('calibration-owner');
  profile.sessions = [reliableRiskSession()];
  const first = captureOutcomeForecast(profile, { now: NOW + 1_000 });
  const second = captureOutcomeForecast(profile, { now: NOW + 2_000 });
  assert.equal(first.id, second.id);
  assert.equal(first.forecastState, 'observed_simulation_risk');
  assert.equal(first.riskId, 'intelligibility');
  assert.equal(first.criterion.criterionId, 'speech_recognition_proxy');
  assert.match(first.accountBinding, /^[a-f0-9]{64}$/u);
  const serialized = JSON.stringify(profile.outcomeCalibration);
  assert.doesNotMatch(serialized, /transcript|audio|recruiter|email|rawText/iu);
});

test('later outcomes compare against the frozen forecast without claiming a rejection cause', () => {
  const profile = defaultProfile('calibration-outcome');
  profile.sessions = [reliableRiskSession()];
  captureOutcomeForecast(profile, { now: NOW + 1_000 });
  const rejected = recordCalibratedOutcome(profile, 'not_hired', { now: NOW + 10_000 });
  assert.equal(rejected.comparison, 'outcome_consistent_cause_unverified');
  assert.equal(rejected.causalValidation, 'unknown_without_employer_reason');
  assert.equal(profile.outcomeCalibration.activeForecast, null);
  assert.deepEqual(outcomeCalibrationSummary(profile), {
    linkedOutcomes: 1,
    riskNotBlocking: 0,
    rejectionConsistentCauseUnknown: 1,
    noRiskPositive: 0,
    missedRejectionSignals: 0,
    insufficientPreInterviewEvidence: 0,
  });
});

test('offer then hire updates one forecast record instead of double-counting one interview', () => {
  const profile = defaultProfile('calibration-positive');
  profile.sessions = [reliableRiskSession()];
  captureOutcomeForecast(profile, { now: NOW + 1_000 });
  const offer = recordCalibratedOutcome(profile, 'offer', { now: NOW + 10_000 });
  assert.equal(offer.comparison, 'risk_not_blocking_at_this_stage');
  assert.ok(profile.outcomeCalibration.activeForecast);
  const hired = recordCalibratedOutcome(profile, 'hired', { now: NOW + 20_000 });
  assert.equal(hired.id, offer.id);
  assert.equal(profile.outcomeCalibration.records.length, 1);
  assert.equal(profile.outcomeCalibration.records[0].outcome, 'hired');
  assert.equal(profile.outcomeCalibration.activeForecast, null);
});

test('two separate interviews with the same measured risk remain two calibration records', () => {
  const profile = defaultProfile('calibration-repeat-interview');
  profile.sessions = [reliableRiskSession()];
  const firstForecast = captureOutcomeForecast(profile, { now: NOW + 1_000 });
  recordCalibratedOutcome(profile, 'not_hired', { now: NOW + 10_000 });
  const secondForecast = captureOutcomeForecast(profile, { now: NOW + 20_000 });
  recordCalibratedOutcome(profile, 'not_hired', { now: NOW + 30_000 });
  assert.notEqual(firstForecast.id, secondForecast.id);
  assert.equal(profile.outcomeCalibration.records.length, 2);
});

test('an interview with no reliable pre-interview measurement is retained as insufficient evidence', () => {
  const profile = defaultProfile('calibration-measure-first');
  const forecast = captureOutcomeForecast(profile, { now: NOW + 1_000 });
  assert.equal(forecast.forecastState, 'measure_first');
  const outcome = recordCalibratedOutcome(profile, 'not_hired', { now: NOW + 2_000 });
  assert.equal(outcome.comparison, 'insufficient_pre_interview_evidence');
  assert.equal(outcomeCalibrationSummary(profile).insufficientPreInterviewEvidence, 1);
});

test('copied or corrupted calibration state is rejected for another account', () => {
  const owner = defaultProfile('calibration-owner-a');
  owner.sessions = [reliableRiskSession()];
  captureOutcomeForecast(owner, { now: NOW + 1_000 });
  recordCalibratedOutcome(owner, 'not_hired', { now: NOW + 10_000 });
  const attacker = defaultProfile('calibration-owner-b');
  attacker.outcomeCalibration = structuredClone(owner.outcomeCalibration);
  assert.equal(normalizeOutcomeCalibration(attacker).records.length, 0);
  assert.equal(normalizeOutcomeCalibration(attacker).activeForecast, null);
});

async function withApi(run) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(placementRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function post(base, token, body) {
  const response = await fetch(`${base}/api/placement`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('the placement route freezes a forecast before interview and links a later terminal outcome', async () => {
  const account = await auth.createAccount(
    `calibration-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
    'test-password-1234',
  );
  account.emailVerifiedAt = Date.now();
  const token = auth.signToken(account);
  try {
    const profile = await loadUser(account.id);
    profile.sessions = [reliableRiskSession(Date.now() - 1_000)];
    await saveUser(profile);
    await withApi(async (base) => {
      const interviewing = await post(base, token, { status: 'interviewing', role: 'Kundenservice' });
      assert.equal(interviewing.status, 200);
      const afterInterview = await loadUser(account.id);
      assert.equal(afterInterview.outcomeCalibration.activeForecast.forecastState, 'observed_simulation_risk');

      const rejected = await post(base, token, { status: 'not_hired' });
      assert.equal(rejected.status, 200);
      const afterOutcome = await loadUser(account.id);
      assert.equal(afterOutcome.outcomeCalibration.records.length, 1);
      assert.equal(afterOutcome.outcomeCalibration.records[0].outcome, 'not_hired');
      assert.equal(afterOutcome.outcomeCalibration.activeForecast, null);
    });
  } finally {
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});
