import { createHash } from 'crypto';
import { featuresFromProfile, hireReadinessFor } from './hireReadiness.js';

const VERSION = 1;
const MAX_RECORDS = 50;
const FORECAST_STATES = new Set([
  'measure_first', 'historical_only', 'observed_simulation_risk', 'no_single_risk_observed',
]);
const CONFIDENCE = new Set(['insufficient', 'low', 'medium', 'high']);
const OUTCOMES = new Set(['offer', 'hired', 'not_hired']);
const COMPARISONS = new Set([
  'risk_not_blocking_at_this_stage',
  'outcome_consistent_cause_unverified',
  'no_risk_and_positive_outcome',
  'missed_rejection_signal',
  'insufficient_pre_interview_evidence',
]);

const sha256 = (value) => createHash('sha256').update(String(value || '')).digest('hex');
const safeId = (value, length) => typeof value === 'string'
  && new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(value) ? value : null;
const boundedKey = (value, max = 80) => typeof value === 'string' && /^[a-z0-9_-]+$/u.test(value)
  ? value.slice(0, max) : null;
const finiteTime = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const finiteMetric = (value) => Number.isFinite(Number(value))
  ? Math.max(-1_000_000, Math.min(1_000_000, Number(value))) : null;

function accountBinding(profile) {
  const id = String(profile?.userId || '').trim().slice(0, 120);
  return id ? sha256(`outcome-calibration-v1:${id}`) : null;
}

function safeTarget(value) {
  if (!value || typeof value !== 'object') return null;
  const roleType = boundedKey(value.roleType);
  const industryKey = boundedKey(value.industryKey);
  const source = boundedKey(value.source);
  return roleType && industryKey && source ? { roleType, industryKey, source } : null;
}

function safeCriterion(value) {
  if (!value || typeof value !== 'object') return null;
  const stageId = boundedKey(value.stageId);
  const criterionId = boundedKey(value.criterionId);
  const direction = value.direction === 'at_least' || value.direction === 'at_most' ? value.direction : null;
  const unit = boundedKey(value.unit);
  const observed = finiteMetric(value.observed);
  const reference = finiteMetric(value.reference);
  if (!stageId || !criterionId || !direction || !unit || observed === null || reference === null) return null;
  return { stageId, criterionId, direction, unit, observed, reference };
}

function safeSnapshot(value, expectedOwner) {
  if (!value || typeof value !== 'object' || Number(value.version) !== VERSION
    || safeId(value.accountBinding, 64) !== expectedOwner || safeId(value.id, 16) === null
    || value.source !== 'placement' || !FORECAST_STATES.has(value.forecastState)
    || !CONFIDENCE.has(value.confidence) || !finiteTime(value.capturedAt) || safeId(value.sessionRef, 16) === null) return null;
  const target = safeTarget(value.target);
  const criterion = safeCriterion(value.criterion);
  if (!target || (value.forecastState === 'observed_simulation_risk' && !criterion)) return null;
  return {
    version: VERSION,
    id: value.id,
    accountBinding: expectedOwner,
    source: 'placement',
    capturedAt: Number(value.capturedAt),
    sessionRef: value.sessionRef,
    forecastState: value.forecastState,
    confidence: value.confidence,
    riskId: boundedKey(value.riskId) || null,
    target,
    criterion,
  };
}

function safeRecord(value, expectedOwner) {
  const snapshot = safeSnapshot(value?.forecast, expectedOwner);
  const outcome = OUTCOMES.has(value?.outcome) ? value.outcome : null;
  const comparison = COMPARISONS.has(value?.comparison) ? value.comparison : null;
  const outcomeAt = finiteTime(value?.outcomeAt);
  if (!snapshot || !outcome || !comparison || !outcomeAt || outcomeAt <= snapshot.capturedAt
    || safeId(value?.id, 16) === null) return null;
  return {
    version: VERSION,
    id: value.id,
    accountBinding: expectedOwner,
    forecast: snapshot,
    outcome,
    outcomeAt,
    comparison,
    causalValidation: 'unknown_without_employer_reason',
  };
}

export function normalizeOutcomeCalibration(profile) {
  const owner = accountBinding(profile);
  const value = profile?.outcomeCalibration;
  const activeForecast = owner ? safeSnapshot(value?.activeForecast, owner) : null;
  const records = owner && Array.isArray(value?.records)
    ? value.records.map((row) => safeRecord(row, owner)).filter(Boolean)
      .sort((a, b) => a.outcomeAt - b.outcomeAt).slice(-MAX_RECORDS)
    : [];
  return { version: VERSION, activeForecast, records };
}

function snapshotFromProfile(profile, now) {
  const owner = accountBinding(profile);
  if (!owner) return null;
  const { session } = featuresFromProfile(profile);
  const observedAt = finiteTime(session?.date);
  if (observedAt && observedAt > now) return null;
  const readiness = hireReadinessFor(profile, now);
  const forecast = readiness.rejectionForecast || {};
  const forecastState = FORECAST_STATES.has(forecast.state) ? forecast.state : 'measure_first';
  const confidence = CONFIDENCE.has(forecast.confidence) ? forecast.confidence : 'insufficient';
  const target = safeTarget(forecast.target) || {
    roleType: 'customer_service', industryKey: 'general', source: 'generic_simulation',
  };
  const criterion = safeCriterion(forecast.criterion);
  if (forecastState === 'observed_simulation_risk' && !criterion) return null;
  const sessionRef = sha256(JSON.stringify({
    userId: profile.userId,
    observedAt: observedAt || null,
    sessionId: boundedKey(session?.sessionId, 120),
    roleType: target.roleType,
    industryKey: target.industryKey,
    scenarioId: boundedKey(session?.scenarioId, 120),
  })).slice(0, 16);
  const identity = JSON.stringify({ owner, sessionRef, capturedAt: now, forecastState,
    riskId: forecast.riskId || null, criterion, target });
  return {
    version: VERSION,
    id: sha256(identity).slice(0, 16),
    accountBinding: owner,
    source: 'placement',
    capturedAt: now,
    sessionRef,
    forecastState,
    confidence,
    riskId: boundedKey(forecast.riskId) || null,
    target,
    criterion,
  };
}

function sameForecastContext(left, right) {
  if (!left || !right) return false;
  return left.sessionRef === right.sessionRef
    && left.forecastState === right.forecastState
    && left.confidence === right.confidence
    && left.riskId === right.riskId
    && JSON.stringify(left.target) === JSON.stringify(right.target)
    && JSON.stringify(left.criterion) === JSON.stringify(right.criterion);
}

/** Freeze the latest pre-outcome simulation forecast when a learner reports a real interview. */
export function captureOutcomeForecast(profile, { now = Date.now() } = {}) {
  const state = normalizeOutcomeCalibration(profile);
  const snapshot = snapshotFromProfile(profile, now);
  if (!snapshot) return null;
  if (sameForecastContext(state.activeForecast, snapshot)) return state.activeForecast;
  state.activeForecast = snapshot;
  profile.outcomeCalibration = state;
  return snapshot;
}

function comparisonFor(snapshot, outcome) {
  const positive = outcome === 'offer' || outcome === 'hired';
  if (snapshot.forecastState === 'observed_simulation_risk') {
    return positive ? 'risk_not_blocking_at_this_stage' : 'outcome_consistent_cause_unverified';
  }
  if (snapshot.forecastState === 'no_single_risk_observed') {
    return positive ? 'no_risk_and_positive_outcome' : 'missed_rejection_signal';
  }
  return 'insufficient_pre_interview_evidence';
}

/** Link a later real outcome to the forecast frozen before it—without claiming the forecast caused it. */
export function recordCalibratedOutcome(profile, outcome, { now = Date.now() } = {}) {
  if (!OUTCOMES.has(outcome)) return null;
  const state = normalizeOutcomeCalibration(profile);
  const snapshot = state.activeForecast;
  if (!snapshot || now <= snapshot.capturedAt) return null;
  const record = {
    version: VERSION,
    id: sha256(`outcome:${snapshot.id}`).slice(0, 16),
    accountBinding: snapshot.accountBinding,
    forecast: snapshot,
    outcome,
    outcomeAt: now,
    comparison: comparisonFor(snapshot, outcome),
    causalValidation: 'unknown_without_employer_reason',
  };
  state.records = [...state.records.filter((row) => row.id !== record.id), record]
    .sort((a, b) => a.outcomeAt - b.outcomeAt).slice(-MAX_RECORDS);
  if (outcome === 'hired' || outcome === 'not_hired') state.activeForecast = null;
  profile.outcomeCalibration = state;
  return record;
}

export function outcomeCalibrationSummary(profile) {
  const records = normalizeOutcomeCalibration(profile).records;
  const summary = {
    linkedOutcomes: records.length,
    riskNotBlocking: 0,
    rejectionConsistentCauseUnknown: 0,
    noRiskPositive: 0,
    missedRejectionSignals: 0,
    insufficientPreInterviewEvidence: 0,
  };
  for (const row of records) {
    if (row.comparison === 'risk_not_blocking_at_this_stage') summary.riskNotBlocking += 1;
    else if (row.comparison === 'outcome_consistent_cause_unverified') summary.rejectionConsistentCauseUnknown += 1;
    else if (row.comparison === 'no_risk_and_positive_outcome') summary.noRiskPositive += 1;
    else if (row.comparison === 'missed_rejection_signal') summary.missedRejectionSignals += 1;
    else if (row.comparison === 'insufficient_pre_interview_evidence') summary.insufficientPreInterviewEvidence += 1;
  }
  return summary;
}

export default {
  captureOutcomeForecast,
  normalizeOutcomeCalibration,
  outcomeCalibrationSummary,
  recordCalibratedOutcome,
};
