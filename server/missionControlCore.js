/**
 * Mission Control v1: pure schemas, entitlements, privacy envelope, deterministic
 * matching, and next-action selection.
 *
 * Privacy law: raw CVs, raw vacancy text, full source URLs, and recruiter messages
 * are transient inputs only. The durable state returned by this module is bounded,
 * structured, and encrypted before it is attached to a profile.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { emailOwnershipVerified, isAdminAccount, planOf, trialActive } from './auth.js';
import { dayKey } from './time.js';
import {
  VACANCY_GERMAN_LEVELS,
  VACANCY_INDUSTRY_KEYS,
  VACANCY_PRACTICE_QUESTIONS,
  VACANCY_QUESTION_TOPIC_IDS,
  VACANCY_ROLE_TYPES,
  VACANCY_SKILL_IDS,
  vacancyFlagsFor,
} from './vacancyTargetCore.js';

export const MISSION_CONTROL_SCHEMA_VERSION = 1;
export const MISSION_CONTROL_CONSENT_VERSION = 1;
// Long enough for normal email verification/new-tab flows, still signed and one-use.
export const INTERVIEW_PASS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const FREE_JOB_FIT_PREVIEWS_PER_MONTH = 3;
export const FREE_TRACKED_APPLICATIONS = 1;
export const RADAR_TOP_LIMIT = 5;
export const MISSION_CONTROL_MAX_RECORDS = 250;
export const OPPORTUNITY_DUPLICATE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const PASSPORT_FRESHNESS_MS = 90 * 24 * 60 * 60 * 1000;
export const ASSESSMENT_FRESHNESS_MS = 90 * 24 * 60 * 60 * 1000;
// The encrypted profile is intentionally bounded on both sides of the envelope.
// Eight MiB accommodates the full 250-application plan with generated packs while
// preventing an accidentally amplified profile from becoming an unbounded write.
export const MISSION_CONTROL_MAX_PLAINTEXT_BYTES = 8 * 1024 * 1024;
export const MISSION_CONTROL_MAX_IDEMPOTENCY_RECORDS = 100;
export const MISSION_CONTROL_MAX_IDEMPOTENCY_RESPONSE_BYTES = 16 * 1024;
export const MISSION_CONTROL_IDEMPOTENCY_OPERATIONS = Object.freeze([
  'interview_pass_claim', 'candidate_passport_put', 'opportunity_import',
  'application_pack_create', 'application_pack_approve', 'application_mark_submitted',
  'opportunity_response', 'opportunity_confirm_interview', 'official_page_verify',
  'opportunity_outcome',
]);

export const INTERVIEW_PASS_MILESTONES = Object.freeze([
  Object.freeze({ id:'vacancy_requirements_and_introduction', title:'vacancy_requirements_and_introduction', actions:Object.freeze(['map_requirements', 'build_60_second_introduction']) }),
  Object.freeze({ id:'motivation_availability_and_logistics', title:'motivation_availability_and_logistics', actions:Object.freeze(['prepare_motivation', 'confirm_availability', 'prepare_logistics']) }),
  Object.freeze({ id:'relevant_star_story', title:'relevant_star_story', actions:Object.freeze(['select_truthful_star_story', 'practice_specific_result']) }),
  Object.freeze({ id:'role_specific_customer_scenario', title:'role_specific_customer_scenario', actions:Object.freeze(['practice_role_scenario', 'connect_confirmed_evidence']) }),
  Object.freeze({ id:'pressure_and_deescalation', title:'pressure_and_deescalation', actions:Object.freeze(['practice_pressure_response', 'practice_deescalation']) }),
  Object.freeze({ id:'full_vacancy_tailored_mock_interview', title:'full_vacancy_tailored_mock_interview', actions:Object.freeze(['complete_full_mock', 'review_server_debrief']), live:true }),
  Object.freeze({ id:'weakness_retest_and_final_readiness', title:'weakness_retest_and_final_readiness', actions:Object.freeze(['retest_priority_weakness', 'prepare_closing_questions', 'run_final_readiness_check']), live:true }),
]);

export const MISSION_CONTROL_EVENTS = Object.freeze([
  'interview_pass_opened',
  'interview_pass_cv_local_ready',
  'interview_pass_previewed',
  'interview_pass_signup_clicked',
  'interview_pass_claimed',
  'candidate_passport_opened',
  'candidate_passport_saved',
  'mission_control_opened',
  'job_radar_viewed',
  'opportunity_imported',
  'application_pack_opened',
  'application_pack_created',
  'application_pack_approved',
  'application_pack_exported',
  'official_apply_opened',
  'application_marked_submitted',
  'response_classified',
  'interview_confirmed',
  'application_outcome_recorded',
  'mission_paywall_shown',
]);

export const INTERVIEW_PASS_TIMINGS = Object.freeze([
  'today', 'one_two_days', 'three_six_days', 'seven_plus_days', 'no_date',
]);
export const EVIDENCE_CATEGORIES = Object.freeze([
  'customer_contact', 'deescalation', 'sales_result', 'technical_triage',
  'data_accuracy', 'shift_flexibility', 'quantified_result',
]);
export const LOCATION_MODES = Object.freeze(['onsite', 'hybrid', 'remote', 'flexible']);
export const SHIFT_PREFERENCES = Object.freeze(['day', 'evening', 'night', 'rotating', 'weekends']);
export const EXPERIENCE_BANDS = Object.freeze([
  'entry', 'under_1_year', '1_2_years', '3_5_years', '5_plus_years',
]);
export const WORK_AUTHORIZATIONS = Object.freeze([
  'egypt_authorized', 'eu_authorized', 'gulf_authorized', 'requires_sponsorship', 'other',
]);
export const LOCATION_ELIGIBILITIES = Object.freeze([
  'cairo', 'alexandria', 'egypt', 'remote_egypt', 'remote_global', 'gulf', 'eu',
]);
export const OPPORTUNITY_ELIGIBILITY_DIMENSIONS = Object.freeze([
  'location', 'work_mode', 'work_authorization', 'shift', 'availability', 'experience', 'salary',
]);
export const FACT_TYPES = Object.freeze([
  'experience', 'achievement', 'skill', 'language', 'education', 'certification', 'availability',
]);
export const FACT_PROVENANCE = Object.freeze([
  'user_confirmed', 'assessment', 'interview_session', 'certificate', 'employment_record',
]);
export const READINESS_STATES = Object.freeze([
  'MEASURE_FIRST', 'PREP_FIRST', 'READY_TO_APPLY', 'HARD_MISMATCH',
]);
export const OPPORTUNITY_STATUSES = Object.freeze([
  'discovered', 'shortlisted', 'measure_first', 'prep_first', 'ready_to_apply',
  'pack_approved', 'user_submitted', 'acknowledged', 'human_response',
  'interview_proposed', 'interview_confirmed', 'preparation', 'rejected',
  'offer', 'hired', 'withdrawn', 'expired',
]);
export const APPLICATION_OUTCOMES = Object.freeze([
  'rejected', 'offer', 'hired', 'withdrawn', 'expired',
]);
export const RESPONSE_EVENT_TYPES = Object.freeze([
  'acknowledgement', 'assessment', 'interview_invitation', 'rejection', 'other',
]);

const ROLE_SET = new Set(VACANCY_ROLE_TYPES);
const INDUSTRY_SET = new Set(VACANCY_INDUSTRY_KEYS);
const LEVEL_SET = new Set(VACANCY_GERMAN_LEVELS);
const SKILL_SET = new Set(VACANCY_SKILL_IDS);
const QUESTION_SET = new Set(VACANCY_QUESTION_TOPIC_IDS);
const TIMING_SET = new Set(INTERVIEW_PASS_TIMINGS);
const EVIDENCE_SET = new Set(EVIDENCE_CATEGORIES);
const LOCATION_SET = new Set(LOCATION_MODES);
const SHIFT_SET = new Set(SHIFT_PREFERENCES);
const EXPERIENCE_SET = new Set(EXPERIENCE_BANDS);
const AUTHORIZATION_SET = new Set(WORK_AUTHORIZATIONS);
const LOCATION_ELIGIBILITY_SET = new Set(LOCATION_ELIGIBILITIES);
const ELIGIBILITY_DIMENSION_SET = new Set(OPPORTUNITY_ELIGIBILITY_DIMENSIONS);
const FACT_TYPE_SET = new Set(FACT_TYPES);
const FACT_PROVENANCE_SET = new Set(FACT_PROVENANCE);
const OUTCOME_SET = new Set(APPLICATION_OUTCOMES);
const READINESS_SET = new Set(READINESS_STATES);
const RESPONSE_EVENT_TYPE_SET = new Set(RESPONSE_EVENT_TYPES);
const RESPONSE_CONFIDENCE_SET = new Set(['low', 'medium', 'high']);
const TRUSTED_APPLY_HOSTS = new Set([
  'wuzzuf.net', 'www.wuzzuf.net', 'jobs.lever.co', 'boards.greenhouse.io',
  'apply.workable.com', 'jobs.smartrecruiters.com',
]);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/u;
const IDEMPOTENCY_OPERATION_PATTERN = /^[a-z][a-z0-9:_-]{0,63}$/u;
const IDEMPOTENCY_OPERATION_SET = new Set(MISSION_CONTROL_IDEMPOTENCY_OPERATIONS);

const BIDI_AND_FORMAT_CONTROLS = /[\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>{}\[\]"']+/giu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/gu;
const HTML_PATTERN = /<[^>]+>/gu;
const PROMPT_PATTERN = /(?:ignore|disregard|forget|override|reveal|print|return|follow)\s+(?:all\s+)?(?:previous|prior|system|developer|assistant|prompt|instruction)|(?:system|developer|assistant)\s*(?:message|prompt|instructions?)|<\|(?:system|assistant|developer|user)[^>]*\|>|\[(?:system|assistant|developer|inst)\]/iu;

export class MissionControlError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'MissionControlError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, status = 400) {
  throw new MissionControlError(code, status);
}

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function assertExactObject(value, allowedKeys, code = 'invalid_request') {
  if (!isPlainObject(value)) fail(code);
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(code);
  return value;
}

export function safeText(value, max = 160, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') return nullable ? null : '';
  const clean = value.normalize('NFKC')
    .replace(BIDI_AND_FORMAT_CONTROLS, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(HTML_PATTERN, ' ')
    .replace(URL_PATTERN, '[link]')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(PHONE_PATTERN, '[phone]')
    .split(/\r?\n/gu)
    .filter((line) => !PROMPT_PATTERN.test(line))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
  return clean || (nullable ? null : '');
}

/** A public, trusted, credential-free destination the candidate opens themselves. */
export function normalizeOfficialApplyUrl(value, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  if (typeof value !== 'string' || value.length > 2048) fail('invalid_apply_url');
  let url;
  try { url = new URL(value); }
  catch { fail('invalid_apply_url'); }
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (url.protocol !== 'https:' || url.username || url.password || !TRUSTED_APPLY_HOSTS.has(host)) {
    fail('invalid_apply_url');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.hostname = host;
  const canonical = url.toString();
  if (canonical.length > 1000) fail('invalid_apply_url');
  return canonical;
}

export function safeId(value, prefix = '') {
  const id = String(value || '').trim();
  const pattern = prefix
    ? new RegExp(`^${prefix}_[a-zA-Z0-9_-]{8,64}$`, 'u')
    : /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/u;
  return pattern.test(id) ? id : null;
}

function boundedEnum(value, set, code = 'invalid_request') {
  if (!set.has(value)) fail(code);
  return value;
}

function boundedEnumList(value, set, max, { min = 0, code = 'invalid_request' } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(code);
  const out = [];
  for (const item of value) {
    if (!set.has(item)) fail(code);
    if (!out.includes(item)) out.push(item);
  }
  if (out.length < min) fail(code);
  return out;
}

function isoDate(value, { nullable = false, allowPast = true } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('invalid_date');
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('invalid_date');
  if (!allowPast && value < dayKey()) fail('invalid_date');
  return value;
}

function validTimestamp(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function modeOf(value) {
  const mode = String(value || 'off').trim().toLowerCase();
  return mode === 'on' || mode === 'beta' ? mode : 'off';
}

function boolFlag(value) {
  return /^(?:1|true|on)$/iu.test(String(value || '').trim());
}

function betaAllowed(account, env, feature) {
  if (!account) return false;
  if (isAdminAccount(account)) return true;
  const ids = new Set([
    ...String(env.MISSION_CONTROL_BETA_ACCOUNT_IDS || '').split(','),
    ...String(env[`${feature}_BETA_ACCOUNT_IDS`] || '').split(','),
  ].map((value) => value.trim()).filter(Boolean));
  return ids.has(String(account.id || ''))
    || account?.subscription?.missionControlBeta === true
    || account?.subscription?.[feature === 'INTERVIEW_PASS' ? 'interviewPassBeta' : 'opportunityCopilotBeta'] === true;
}

function enabledForMode(mode, account, env, feature) {
  return mode === 'on' || (mode === 'beta' && betaAllowed(account, env, feature));
}

/** Server-controlled, fail-closed feature and entitlement matrix. */
export function missionControlFlagsFor(account, options = {}) {
  const env = options?.env || (Object.hasOwn(options || {}, 'INTERVIEW_PASS_MODE') ? options : process.env);
  const now = Number(options?.now) || Date.now();
  const paused = boolFlag(env.MISSION_CONTROL_PAUSED);
  const interviewPassMode = modeOf(env.INTERVIEW_PASS_MODE);
  const copilotMode = modeOf(env.OPPORTUNITY_COPILOT_MODE);
  const interviewPassConfigured = enabledForMode(interviewPassMode, account, env, 'INTERVIEW_PASS');
  const copilotConfigured = enabledForMode(copilotMode, account, env, 'OPPORTUNITY_COPILOT');
  const interviewPassEnabled = !paused && interviewPassConfigured;
  const copilotEnabled = !paused && copilotConfigured;
  const plan = account ? planOf(account, now) : 'free';
  const trial = account ? trialActive(account, now) : false;
  const admin = account ? isAdminAccount(account) : false;
  const full = plan === 'basic' || plan === 'elite' || trial || admin;
  const live = plan === 'elite' || trial || admin;
  const vacancyLive = account ? vacancyFlagsFor(account, { env, now }).live : false;
  return {
    paused,
    interviewPassConfigured,
    copilotConfigured,
    interviewPassMode,
    copilotMode,
    interviewPassEnabled,
    copilotEnabled,
    plan,
    trial,
    admin,
    fullPassport: full,
    radarLimit: full ? RADAR_TOP_LIMIT : FREE_JOB_FIT_PREVIEWS_PER_MONTH,
    canGeneratePack: full,
    canTrackApplications: full ? MISSION_CONTROL_MAX_RECORDS : FREE_TRACKED_APPLICATIONS,
    fullWrittenPlan: full,
    targetedLive: copilotEnabled && live && vacancyLive,
    jobDiscoveryLive: copilotEnabled && full && boolFlag(env.JOB_DISCOVERY_LIVE_ENABLED),
  };
}

// -- Privacy envelope -------------------------------------------------------

function decodeKey(value) {
  const raw = String(value || '').trim();
  let key = null;
  if (/^[a-f0-9]{64}$/iu.test(raw)) key = Buffer.from(raw, 'hex');
  else if (/^[A-Za-z0-9_-]{43,44}$/u.test(raw)) {
    try { key = Buffer.from(raw, 'base64url'); } catch { key = null; }
  } else if (/^[A-Za-z0-9+/]{43}=$|^[A-Za-z0-9+/]{44}$/u.test(raw)) {
    try { key = Buffer.from(raw, 'base64'); } catch { key = null; }
  }
  return key?.length === 32 ? key : null;
}

export function missionControlEncryptionKey(env = process.env) {
  const key = decodeKey(env.MISSION_CONTROL_ENCRYPTION_KEY);
  if (!key) fail('privacy_configuration_required', 503);
  return key;
}

function aadFor(userId) {
  const id = String(userId || '').replace(/[^a-zA-Z0-9_-]/gu, '').slice(0, 64);
  if (!id) fail('privacy_configuration_required', 503);
  return Buffer.from(`omni-perform:mission-control:v1:${id}`, 'utf8');
}

export function encryptMissionControlState(state, userId, options = {}) {
  const env = options?.env || process.env;
  const key = options?.key || missionControlEncryptionKey(env);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail('privacy_configuration_required', 503);
  const iv = options?.iv || randomBytes(12);
  if (!Buffer.isBuffer(iv) || iv.length !== 12) fail('privacy_configuration_required', 503);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(userId));
  const plaintext = Buffer.from(canonicalJson(normalizeMissionControlState(state)), 'utf8');
  if (plaintext.length > MISSION_CONTROL_MAX_PLAINTEXT_BYTES) fail('private_state_too_large', 413);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    alg: 'A256GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

export function decryptMissionControlState(envelope, userId, options = {}) {
  if (envelope === null || envelope === undefined) return emptyMissionControlState();
  if (!isPlainObject(envelope) || envelope.version !== 1 || envelope.alg !== 'A256GCM') {
    fail('private_state_unavailable', 409);
  }
  const env = options?.env || process.env;
  const key = options?.key || missionControlEncryptionKey(env);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail('privacy_configuration_required', 503);
  try {
    const encodedCiphertext = String(envelope.ciphertext || '');
    if (encodedCiphertext.length > Math.ceil(MISSION_CONTROL_MAX_PLAINTEXT_BYTES / 3) * 4 + 4) {
      throw new Error('bad_envelope');
    }
    const iv = Buffer.from(String(envelope.iv || ''), 'base64url');
    const tag = Buffer.from(String(envelope.tag || ''), 'base64url');
    const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length
      || ciphertext.length > MISSION_CONTROL_MAX_PLAINTEXT_BYTES) throw new Error('bad_envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aadFor(userId));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length > MISSION_CONTROL_MAX_PLAINTEXT_BYTES) throw new Error('bad_envelope');
    return normalizeMissionControlState(JSON.parse(plaintext.toString('utf8')));
  } catch (error) {
    if (error instanceof MissionControlError) throw error;
    fail('private_state_unavailable', 409);
  }
}

export function attachEncryptedMissionControl(profile, state, options = {}) {
  if (!profile?.userId) fail('privacy_configuration_required', 503);
  profile.missionControlEncrypted = encryptMissionControlState(state, profile.userId, options);
  // A pre-release plaintext experiment must never coexist with the encrypted source of truth.
  delete profile.missionControl;
  return profile.missionControlEncrypted;
}

export function readEncryptedMissionControl(profile, options = {}) {
  if (!profile?.userId) fail('privacy_configuration_required', 503);
  return decryptMissionControlState(profile.missionControlEncrypted, profile.userId, options);
}

function tokenKey(options = {}) {
  const key = options?.key || missionControlEncryptionKey(options?.env || process.env);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail('privacy_configuration_required', 503);
  return createHmac('sha256', key).update('interview-pass-signing-v1').digest();
}

function signPayload(encoded, options = {}) {
  return createHmac('sha256', tokenKey(options)).update(encoded).digest('base64url');
}

// -- Interview Pass --------------------------------------------------------

export function normalizeInterviewPassPreviewRequest(value) {
  assertExactObject(value, ['roleType', 'industryKey', 'germanLevel', 'timing', 'evidenceCategories']);
  return {
    roleType: boundedEnum(value.roleType, ROLE_SET),
    industryKey: boundedEnum(value.industryKey, INDUSTRY_SET),
    germanLevel: boundedEnum(value.germanLevel, LEVEL_SET),
    timing: boundedEnum(value.timing, TIMING_SET),
    evidenceCategories: boundedEnumList(value.evidenceCategories, EVIDENCE_SET, 8),
  };
}

const ROLE_TOPICS = Object.freeze({
  customer_service: ['self_introduction', 'customer_escalation', 'data_accuracy'],
  technical_support: ['self_introduction', 'technical_triage', 'customer_escalation'],
  sales: ['self_introduction', 'sales_objection', 'closing_questions'],
  retention: ['self_introduction', 'customer_escalation', 'sales_objection'],
  backoffice: ['self_introduction', 'data_accuracy', 'work_experience'],
});

const ROLE_EVIDENCE = Object.freeze({
  customer_service: ['customer_contact', 'deescalation', 'data_accuracy'],
  technical_support: ['technical_triage', 'data_accuracy', 'customer_contact'],
  sales: ['sales_result', 'quantified_result', 'customer_contact'],
  retention: ['deescalation', 'sales_result', 'customer_contact'],
  backoffice: ['data_accuracy', 'quantified_result', 'shift_flexibility'],
});

export function buildInterviewPassPreview(request, options = {}) {
  const normalized = normalizeInterviewPassPreviewRequest(request);
  const now = Math.floor((Number(options?.now) || Date.now()) / 1000) * 1000;
  const expiresAt = now + INTERVIEW_PASS_TOKEN_TTL_MS;
  const topics = ROLE_TOPICS[normalized.roleType] || ROLE_TOPICS.customer_service;
  const needed = ROLE_EVIDENCE[normalized.roleType] || ROLE_EVIDENCE.customer_service;
  const strongestEvidence = needed.find((id) => normalized.evidenceCategories.includes(id))
    || normalized.evidenceCategories[0] || null;
  const evidenceGap = needed.find((id) => !normalized.evidenceCategories.includes(id)) || null;
  const previewId = `ip_${sha256(canonicalJson({ ...normalized, issuedAt: now })).slice(0, 24)}`;
  const payload = {
    v:1,
    p:previewId,
    i:Math.floor(now / 1000),
    x:Math.floor(expiresAt / 1000),
    r:VACANCY_ROLE_TYPES.indexOf(normalized.roleType),
    n:VACANCY_INDUSTRY_KEYS.indexOf(normalized.industryKey),
    g:VACANCY_GERMAN_LEVELS.indexOf(normalized.germanLevel),
    t:INTERVIEW_PASS_TIMINGS.indexOf(normalized.timing),
    e:normalized.evidenceCategories.map((id) => EVIDENCE_CATEGORIES.indexOf(id)),
  };
  const encoded = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
  const previewToken = `${encoded}.${signPayload(encoded, options)}`;
  return {
    previewToken,
    expiresAt: new Date(expiresAt).toISOString(),
    predictions: topics.map((id) => ({
      id,
      label: 'practice_prediction',
      text: VACANCY_PRACTICE_QUESTIONS[id],
    })),
    answerStructure: ['direct_answer', 'specific_evidence', 'role_relevance'],
    strongestEvidence,
    evidenceGap: evidenceGap ? { title:'evidence_gap', detail:evidenceGap } : null,
    day1: {
      id: 'vacancy_requirements_and_introduction',
      actions: ['map_requirements', 'build_60_second_introduction', 'practice_predictions'],
    },
  };
}

export function verifyInterviewPassToken(token, options = {}) {
  if (typeof token !== 'string' || token.length < 80 || token.length > 6000) fail('invalid_preview_token', 400);
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) fail('invalid_preview_token', 400);
  const expected = Buffer.from(signPayload(encoded, options));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) fail('invalid_preview_token', 400);
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { fail('invalid_preview_token', 400); }
  assertExactObject(payload, ['v', 'p', 'i', 'x', 'r', 'n', 'g', 't', 'e'], 'invalid_preview_token');
  if (payload.v !== 1 || !safeId(payload.p, 'ip')) fail('invalid_preview_token', 400);
  const request = normalizeInterviewPassPreviewRequest({
    roleType:VACANCY_ROLE_TYPES[payload.r],
    industryKey:VACANCY_INDUSTRY_KEYS[payload.n],
    germanLevel:VACANCY_GERMAN_LEVELS[payload.g],
    timing:INTERVIEW_PASS_TIMINGS[payload.t],
    evidenceCategories:Array.isArray(payload.e) ? payload.e.map((index) => EVIDENCE_CATEGORIES[index]) : null,
  });
  const issuedAt = Number(payload.i) * 1000;
  const expiresAt = Number(payload.x) * 1000;
  const now = Number(options?.now) || Date.now();
  if (!validTimestamp(issuedAt) || !validTimestamp(expiresAt)
    || expiresAt <= now || expiresAt - issuedAt !== INTERVIEW_PASS_TOKEN_TTL_MS) {
    fail('preview_token_expired', 410);
  }
  return { version:1, previewId:payload.p, issuedAt, expiresAt, request };
}

function interviewPassSchedule(timing) {
  const milestones = INTERVIEW_PASS_MILESTONES.map((row) => ({
    id:row.id,
    title:row.title,
    actions:[...row.actions],
    live:row.live === true,
  }));
  if (timing === 'today') {
    return [
      { id:'emergency_introduction_and_motivation', title:'emergency_introduction_and_motivation',
        actions:['build_60_second_introduction', 'prepare_motivation'], live:false, day:1, emergency:true },
      { id:'emergency_evidence_and_pressure', title:'emergency_evidence_and_pressure',
        actions:['select_truthful_star_story', 'practice_role_scenario', 'practice_deescalation'], live:false, day:1, emergency:true },
      { id:'emergency_mock_and_closing', title:'emergency_mock_and_closing',
        actions:['complete_full_mock', 'prepare_closing_questions'], live:true, day:1, emergency:true },
    ];
  }
  const dayMap = timing === 'one_two_days'
    ? [1, 1, 1, 2, 2, 2, 2]
    : timing === 'three_six_days'
      ? [1, 1, 2, 2, 3, 3, 4]
      : [1, 2, 3, 4, 5, 6, 7];
  return milestones.map((row, index) => ({ ...row, day:dayMap[index], emergency:false }));
}

export function publicInterviewPass(pass, flags) {
  const normalized = normalizeInterviewPass(pass);
  if (!normalized) return null;
  const schedule = flags?.fullWrittenPlan ? normalized.schedule : normalized.schedule.slice(0, 1);
  return {
    id:normalized.id,
    roleType:normalized.roleType,
    industryKey:normalized.industryKey,
    germanLevel:normalized.germanLevel,
    timing:normalized.timing,
    evidenceCategories:[...normalized.evidenceCategories],
    schedule,
    planAccess:flags?.fullWrittenPlan ? 'full' : 'day_one',
    targetedLive:flags?.targetedLive === true,
    claimedAt:normalized.claimedAt,
  };
}

export function claimInterviewPass(state, payload, flags, now = Date.now()) {
  const normalized = normalizeMissionControlState(state);
  const existing = normalized.interviewPass;
  if (existing?.previewId === payload.previewId) return { state: normalized, pass: existing, created: false };
  if (!flags.fullWrittenPlan && existing) fail('interview_pass_already_claimed', 409);
  const pass = {
    id: `pass_${sha256(`${payload.previewId}:${payload.request.roleType}`).slice(0, 24)}`,
    previewId: payload.previewId,
    roleType: payload.request.roleType,
    industryKey: payload.request.industryKey,
    germanLevel: payload.request.germanLevel,
    timing: payload.request.timing,
    evidenceCategories: payload.request.evidenceCategories,
    schedule: interviewPassSchedule(payload.request.timing),
    claimedAt: now,
  };
  normalized.interviewPass = pass;
  normalized.claimedPreviewIds = [...new Set([...normalized.claimedPreviewIds, payload.previewId])].slice(-50);
  normalized.updatedAt = now;
  return { state: normalized, pass, created: true };
}

// -- Candidate Passport ----------------------------------------------------

export function normalizePassportInput(value, now = Date.now()) {
  assertExactObject(value, [
    'roleTypes', 'industryKeys', 'germanLevel', 'locationMode', 'shiftPreferences',
    'availabilityDate', 'experienceBand', 'salaryFloorEGP', 'workAuthorization',
    'locationEligibilities', 'skillIds', 'facts', 'consentVersion',
  ], 'invalid_passport');
  if (value.consentVersion !== MISSION_CONTROL_CONSENT_VERSION) fail('consent_required', 409);
  if (value.salaryFloorEGP !== null
    && (!Number.isSafeInteger(value.salaryFloorEGP) || value.salaryFloorEGP < 0 || value.salaryFloorEGP > 500000)) {
    fail('invalid_passport');
  }
  if (!Array.isArray(value.facts) || value.facts.length > 30) fail('invalid_passport');
  const factIds = new Set();
  const facts = value.facts.map((fact) => {
    assertExactObject(fact, ['id', 'type', 'value', 'provenance', 'confirmedAt', 'shareAllowed'], 'invalid_passport');
    const id = safeId(fact.id, 'fact');
    if (!id || factIds.has(id)) fail('invalid_passport');
    factIds.add(id);
    const text = safeText(fact.value, 240);
    if (!text || text.includes('[email]') || text.includes('[phone]') || text.includes('[link]')) fail('invalid_passport');
    const confirmedAt = validTimestamp(fact.confirmedAt);
    if (!confirmedAt || confirmedAt > now + 5 * 60 * 1000) fail('invalid_passport');
    if (typeof fact.shareAllowed !== 'boolean') fail('invalid_passport');
    return {
      id,
      type: boundedEnum(fact.type, FACT_TYPE_SET, 'invalid_passport'),
      value: text,
      provenance: boundedEnum(fact.provenance, FACT_PROVENANCE_SET, 'invalid_passport'),
      confirmedAt,
      shareAllowed: fact.shareAllowed,
    };
  });
  return {
    version: 1,
    roleTypes: boundedEnumList(value.roleTypes, ROLE_SET, 5, { min: 1, code: 'invalid_passport' }),
    industryKeys: boundedEnumList(value.industryKeys, INDUSTRY_SET, 10, { min: 1, code: 'invalid_passport' }),
    germanLevel: boundedEnum(value.germanLevel, LEVEL_SET, 'invalid_passport'),
    locationMode: boundedEnum(value.locationMode, LOCATION_SET, 'invalid_passport'),
    shiftPreferences: boundedEnumList(value.shiftPreferences, SHIFT_SET, 5, { code: 'invalid_passport' }),
    availabilityDate: isoDate(value.availabilityDate, { nullable: true }),
    experienceBand: boundedEnum(value.experienceBand, EXPERIENCE_SET, 'invalid_passport'),
    salaryFloorEGP: value.salaryFloorEGP,
    workAuthorization: boundedEnum(value.workAuthorization, AUTHORIZATION_SET, 'invalid_passport'),
    locationEligibilities: value.locationEligibilities === undefined
      ? []
      : boundedEnumList(value.locationEligibilities, LOCATION_ELIGIBILITY_SET, 7, { code:'invalid_passport' }),
    skillIds: boundedEnumList(value.skillIds, SKILL_SET, 8, { code: 'invalid_passport' }),
    facts,
    consentVersion: MISSION_CONTROL_CONSENT_VERSION,
    updatedAt: now,
  };
}

function normalizePassport(value) {
  if (!isPlainObject(value) || value.version !== 1) return null;
  try {
    const input = { ...value };
    delete input.version;
    delete input.updatedAt;
    const normalized = normalizePassportInput(input, Math.max(Date.now(), validTimestamp(value.updatedAt) || 0));
    normalized.updatedAt = validTimestamp(value.updatedAt) || normalized.updatedAt;
    return normalized;
  } catch { return null; }
}

export function passportView(passport) {
  const normalized = normalizePassport(passport);
  if (!normalized) return null;
  return normalized;
}

function measuredGermanRank(value) {
  const level = String(value || '').trim().toUpperCase();
  if (level === 'C1' || level === 'C2') return 3;
  if (level === 'B2') return 2;
  if (level === 'A2' || level === 'B1') return 1;
  return 0;
}

/** Evidence from server-owned measurements only; self-report can never create READY_TO_APPLY. */
export function candidateReadinessEvidence(profile, account, now = Date.now()) {
  const assessment = isPlainObject(profile?.assessmentResult) ? profile.assessmentResult : null;
  const assessedAt = validTimestamp(assessment?.at);
  const assessmentCurrent = profile?.assessmentUsed === true
    && !!assessedAt
    && now >= assessedAt
    && now - assessedAt <= ASSESSMENT_FRESHNESS_MS
    && assessment?.measured?.writtenGerman === true;
  const measuredRank = assessmentCurrent ? measuredGermanRank(assessment?.estimatedLevel) : 0;
  const meaningfulDebrief = Array.isArray(profile?.sessions) && profile.sessions.some((session) => (
    isPlainObject(session)
      && !!validTimestamp(session.date)
      && session.notCounted !== true
      && Number.isFinite(Number(session.answers))
      && Number(session.answers) >= 3
  ));
  return {
    now,
    accountVerified:emailOwnershipVerified(account),
    assessmentCurrent,
    assessedAt:assessedAt || null,
    measuredGermanRank:measuredRank,
    meaningfulDebrief,
  };
}

// -- Opportunity, fit, packs, and response classification -----------------

function safeRecordId(value, prefix) {
  return safeId(value, prefix);
}

function boundedSalary(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 500000) fail('invalid_opportunity', 422);
  return value;
}

/** Only controlled eligibility values are durable; no source sentences enter this object. */
export function normalizeOpportunityEligibility(value) {
  if (value === null || value === undefined) return {
    verifiedDimensions:[],
    locationKeys:[], workModes:[], workAuthorizations:[], shifts:[],
    requiredStartDate:null, minimumExperienceBand:null, salaryMinEGP:null, salaryMaxEGP:null,
  };
  assertExactObject(value, [
    'verifiedDimensions',
    'locationKeys', 'workModes', 'workAuthorizations', 'shifts', 'requiredStartDate',
    'minimumExperienceBand', 'salaryMinEGP', 'salaryMaxEGP',
  ], 'invalid_opportunity');
  const salaryMinEGP = boundedSalary(value.salaryMinEGP);
  const salaryMaxEGP = boundedSalary(value.salaryMaxEGP);
  if (salaryMinEGP !== null && salaryMaxEGP !== null && salaryMinEGP > salaryMaxEGP) {
    fail('invalid_opportunity', 422);
  }
  return {
    verifiedDimensions: boundedEnumList(value.verifiedDimensions || [], ELIGIBILITY_DIMENSION_SET, 7, { code:'invalid_opportunity' }),
    locationKeys: boundedEnumList(value.locationKeys || [], LOCATION_ELIGIBILITY_SET, 7, { code:'invalid_opportunity' }),
    workModes: boundedEnumList(value.workModes || [], LOCATION_SET, 4, { code:'invalid_opportunity' }),
    workAuthorizations: boundedEnumList(value.workAuthorizations || [], AUTHORIZATION_SET, 5, { code:'invalid_opportunity' }),
    shifts: boundedEnumList(value.shifts || [], SHIFT_SET, 5, { code:'invalid_opportunity' }),
    requiredStartDate: value.requiredStartDate === null || value.requiredStartDate === undefined
      ? null : isoDate(value.requiredStartDate),
    minimumExperienceBand: value.minimumExperienceBand === null || value.minimumExperienceBand === undefined
      ? null : boundedEnum(value.minimumExperienceBand, EXPERIENCE_SET, 'invalid_opportunity'),
    salaryMinEGP,
    salaryMaxEGP,
  };
}

function readinessEvidenceHash(evidence = {}) {
  return sha256(canonicalJson({
    accountVerified:evidence?.accountVerified === true,
    assessmentCurrent:evidence?.assessmentCurrent === true,
    assessedAt:validTimestamp(evidence?.assessedAt),
    measuredGermanRank:Number.isInteger(evidence?.measuredGermanRank)
      ? Math.max(0, Math.min(3, evidence.measuredGermanRank)) : 0,
    meaningfulDebrief:evidence?.meaningfulDebrief === true,
  }));
}

function normalizeOpportunity(value) {
  if (!isPlainObject(value) || value.version !== 1 || !safeRecordId(value.id, 'opp')) return null;
  if (!/^[a-f0-9]{64}$/u.test(value.sourceHash || '')) return null;
  if (!ROLE_SET.has(value.roleType) || !INDUSTRY_SET.has(value.industryKey) || !LEVEL_SET.has(value.germanLevel)) return null;
  if (!OPPORTUNITY_STATUSES.includes(value.status)) return null;
  const roleTitle = safeText(value.roleTitle, 100);
  const importedAt = validTimestamp(value.importedAt);
  const updatedAt = validTimestamp(value.updatedAt);
  if (!roleTitle || !importedAt || !updatedAt) return null;
  const sourceHost = value.sourceHost === null ? null : safeText(value.sourceHost, 64, { nullable: true });
  let officialApplyUrl = null;
  try { officialApplyUrl = normalizeOfficialApplyUrl(value.officialApplyUrl, { nullable:true }); }
  catch { return null; }
  const fitScore = Number.isSafeInteger(value.fitScore) ? Math.max(0, Math.min(100, value.fitScore)) : 0;
  let eligibilityRequirements;
  try { eligibilityRequirements = normalizeOpportunityEligibility(value.eligibilityRequirements); }
  catch { return null; }
  const missingEligibilityReasons = OPPORTUNITY_ELIGIBILITY_DIMENSIONS
    .filter((dimension) => !eligibilityRequirements.verifiedDimensions.includes(dimension))
    .map((dimension) => `${dimension}_unknown`);
  const readinessState = missingEligibilityReasons.length
    ? 'MEASURE_FIRST'
    : READINESS_SET.has(value.readinessState) ? value.readinessState : 'MEASURE_FIRST';
  const persistedReadinessReasons = Array.isArray(value.readinessReasons) ? value.readinessReasons : [];
  return {
    version: 1,
    id: value.id,
    sourceHash: value.sourceHash,
    sourceHost,
    officialApplyUrl,
    roleTitle,
    employerDisplay: safeText(value.employerDisplay, 100, { nullable:true }),
    location: safeText(value.location, 120, { nullable:true }),
    postedDate: value.postedDate === null || value.postedDate === undefined ? null : (() => {
      try { return isoDate(value.postedDate); } catch { return null; }
    })(),
    openState: value.openState === 'open' || value.openState === 'closed' ? value.openState : 'unknown',
    roleType: value.roleType,
    industryKey: value.industryKey,
    germanLevel: value.germanLevel,
    skillIds: Array.isArray(value.skillIds) ? [...new Set(value.skillIds.filter((id) => SKILL_SET.has(id)))].slice(0, 8) : [],
    questionTopicIds: Array.isArray(value.questionTopicIds)
      ? [...new Set(value.questionTopicIds.filter((id) => QUESTION_SET.has(id)))].slice(0, 9) : [],
    requirementLabels: Array.isArray(value.requirementLabels)
      ? [...new Set(value.requirementLabels.map((item) => safeText(item, 120)).filter(Boolean))].slice(0, 6) : [],
    eligibilityRequirements,
    fitScore,
    fitReasons: Array.isArray(value.fitReasons)
      ? [...new Set(value.fitReasons.filter((item) => [
        'role', 'industry', 'german', 'skills', 'evidence', 'location', 'work_mode',
        'work_authorization', 'shift', 'availability', 'experience', 'salary',
      ].includes(item)))].slice(0, 12) : [],
    fitGaps: Array.isArray(value.fitGaps)
      ? [...new Set(value.fitGaps.filter((item) => [
        'role', 'industry', 'german', 'skills', 'evidence', 'location', 'work_mode',
        'work_authorization', 'shift', 'availability', 'experience', 'salary',
      ].includes(item)))].slice(0, 12) : [],
    readinessState,
    readinessReasons: [...new Set([...persistedReadinessReasons, ...missingEligibilityReasons].filter((item) => [
        'missing_measurement', 'insufficient_evidence', 'role_gap', 'industry_gap',
        'german_gap', 'skill_gap', 'ready_on_confirmed_facts', 'account_unverified',
        'passport_stale', 'assessment_required', 'assessment_stale', 'debrief_required',
        'posting_unverified', 'location_unknown', 'work_mode_unknown', 'work_mode_gap', 'location_gap',
        'work_authorization_unknown', 'work_authorization_gap', 'shift_unknown', 'shift_gap', 'availability_unknown',
        'availability_gap', 'experience_unknown', 'experience_gap', 'salary_unknown', 'salary_gap',
      ].includes(item)))].slice(0, 16),
    readinessEvidenceHash: /^[a-f0-9]{64}$/u.test(value.readinessEvidenceHash || '')
      ? value.readinessEvidenceHash : readinessEvidenceHash(),
    status: value.status,
    importedAt,
    updatedAt,
    outcome: OUTCOME_SET.has(value.outcome) ? value.outcome : null,
    outcomeAt: validTimestamp(value.outcomeAt),
  };
}

const EXPERIENCE_RANK = Object.freeze({
  entry:0, under_1_year:1, '1_2_years':2, '3_5_years':3, '5_plus_years':4,
});

function eligibilityFit(passport, analysis) {
  const requirements = normalizeOpportunityEligibility(analysis?.eligibilityRequirements);
  const reasons = [];
  const gaps = [];
  const unknownReasons = [];
  const hardReasons = [];
  const verified = new Set(requirements.verifiedDimensions);
  const check = (dimension, matches, unknownReason, hardReason) => {
    if (matches === true) reasons.push(dimension);
    else {
      gaps.push(dimension);
      if (matches === null) unknownReasons.push(unknownReason);
      else hardReasons.push(hardReason);
    }
  };
  if (!verified.has('location')) check('location', null, 'location_unknown', 'location_gap');
  else if (requirements.locationKeys.length) {
    check('location', passport.locationEligibilities.length
      ? requirements.locationKeys.some((item) => passport.locationEligibilities.includes(item))
      : null, 'location_unknown', 'location_gap');
  } else reasons.push('location');
  if (!verified.has('work_mode')) check('work_mode', null, 'work_mode_unknown', 'work_mode_gap');
  else if (requirements.workModes.length) {
    check('work_mode', passport.locationMode === 'flexible'
      || requirements.workModes.includes('flexible')
      || requirements.workModes.includes(passport.locationMode), null, 'work_mode_gap');
  } else reasons.push('work_mode');
  if (!verified.has('work_authorization')) {
    check('work_authorization', null, 'work_authorization_unknown', 'work_authorization_gap');
  } else if (requirements.workAuthorizations.length) {
    check('work_authorization', requirements.workAuthorizations.includes(passport.workAuthorization),
      null, 'work_authorization_gap');
  } else reasons.push('work_authorization');
  if (!verified.has('shift')) check('shift', null, 'shift_unknown', 'shift_gap');
  else if (requirements.shifts.length) {
    check('shift', passport.shiftPreferences.length
      ? requirements.shifts.some((item) => passport.shiftPreferences.includes(item))
      : null, 'shift_unknown', 'shift_gap');
  } else reasons.push('shift');
  if (!verified.has('availability')) check('availability', null, 'availability_unknown', 'availability_gap');
  else if (requirements.requiredStartDate) {
    check('availability', passport.availabilityDate
      ? passport.availabilityDate <= requirements.requiredStartDate
      : null, 'availability_unknown', 'availability_gap');
  } else reasons.push('availability');
  if (!verified.has('experience')) check('experience', null, 'experience_unknown', 'experience_gap');
  else if (requirements.minimumExperienceBand) {
    check('experience', EXPERIENCE_RANK[passport.experienceBand]
      >= EXPERIENCE_RANK[requirements.minimumExperienceBand], null, 'experience_gap');
  } else reasons.push('experience');
  if (!verified.has('salary')) check('salary', null, 'salary_unknown', 'salary_gap');
  else if (requirements.salaryMinEGP !== null || requirements.salaryMaxEGP !== null) {
    check('salary', passport.salaryFloorEGP === null
      ? null
      : requirements.salaryMaxEGP === null || passport.salaryFloorEGP <= requirements.salaryMaxEGP,
    'salary_unknown', 'salary_gap');
  } else reasons.push('salary');
  return { requirements, reasons, gaps, unknownReasons, hardReasons };
}

export function scoreOpportunityFit(passport, analysis) {
  const p = normalizePassport(passport);
  if (!p) return { score: 0, reasons: [], gaps: ['evidence'] };
  let score = 0;
  const reasons = [];
  const gaps = [];
  if (p.roleTypes.includes(analysis.roleType)) { score += 30; reasons.push('role'); } else gaps.push('role');
  if (p.industryKeys.includes(analysis.industryKey)) { score += 15; reasons.push('industry'); } else gaps.push('industry');
  const levelOrder = { unspecified: 0, 'a2-b1': 1, b2: 2, c1: 3 };
  if (analysis.germanLevel === 'unspecified' || levelOrder[p.germanLevel] >= levelOrder[analysis.germanLevel]) {
    score += 20; reasons.push('german');
  } else gaps.push('german');
  const skills = Array.isArray(analysis.skillIds) ? analysis.skillIds.filter((id) => SKILL_SET.has(id)) : [];
  const overlap = skills.filter((id) => p.skillIds.includes(id)).length;
  const skillPoints = skills.length ? Math.round(20 * overlap / skills.length) : 10;
  score += skillPoints;
  if (skillPoints >= 10) reasons.push('skills'); else gaps.push('skills');
  const shareable = p.facts.filter((fact) => fact.shareAllowed);
  if (shareable.length >= 2) { score += 15; reasons.push('evidence'); } else gaps.push('evidence');
  const eligibility = eligibilityFit(p, analysis);
  reasons.push(...eligibility.reasons);
  gaps.push(...eligibility.gaps);
  score -= eligibility.gaps.length * 12;
  return { score: Math.max(0, Math.min(100, score)), reasons, gaps };
}

export function opportunityReadiness(passport, analysis, fit, evidence = {}) {
  const p = normalizePassport(passport);
  const now = Number(evidence?.now) || Date.now();
  const measurementReasons = [];
  if (evidence.accountVerified !== true) measurementReasons.push('account_unverified');
  if (!p) measurementReasons.push('missing_measurement');
  else if (!validTimestamp(p.updatedAt) || now < p.updatedAt
    || now - p.updatedAt > PASSPORT_FRESHNESS_MS) measurementReasons.push('passport_stale');
  if (evidence.assessmentCurrent !== true) {
    measurementReasons.push(evidence.assessedAt ? 'assessment_stale' : 'assessment_required');
  }
  if (evidence.meaningfulDebrief !== true) measurementReasons.push('debrief_required');
  if (!analysis?.officialApplyUrl || analysis?.openState !== 'open') measurementReasons.push('posting_unverified');
  if (p) measurementReasons.push(...eligibilityFit(p, analysis).unknownReasons);
  if (measurementReasons.length) {
    return { state:'MEASURE_FIRST', reasons:[...new Set(measurementReasons)].slice(0, 16) };
  }
  const order = { unspecified:0, 'a2-b1':1, b2:2, c1:3 };
  const eligibility = eligibilityFit(p, analysis);
  if ((analysis.germanLevel !== 'unspecified' && evidence.measuredGermanRank < order[analysis.germanLevel])
    || (!p.roleTypes.includes(analysis.roleType) && p.roleTypes.length > 0)
    || eligibility.hardReasons.length) {
    return { state:'HARD_MISMATCH', reasons:[
      ...(analysis.germanLevel !== 'unspecified' && evidence.measuredGermanRank < order[analysis.germanLevel] ? ['german_gap'] : []),
      ...(!p.roleTypes.includes(analysis.roleType) ? ['role_gap'] : []),
      ...eligibility.hardReasons,
    ] };
  }
  const shareable = p.facts.filter((fact) => fact.shareAllowed);
  if (shareable.length < 2 || fit.score < 75) {
    return { state:'PREP_FIRST', reasons:[
      ...(shareable.length < 2 ? ['insufficient_evidence'] : []),
      ...(fit.gaps.includes('industry') ? ['industry_gap'] : []),
      ...(fit.gaps.includes('skills') ? ['skill_gap'] : []),
    ] };
  }
  return { state:'READY_TO_APPLY', reasons:['ready_on_confirmed_facts'] };
}

export function buildOpportunity(source, analysis, passport, now = Date.now(), evidence = {}) {
  let eligibilityRequirements;
  try { eligibilityRequirements = normalizeOpportunityEligibility(analysis?.eligibilityRequirements); }
  catch { fail('invalid_opportunity', 422); }
  const controlledAnalysis = { ...analysis, eligibilityRequirements };
  const fit = scoreOpportunityFit(passport, controlledAnalysis);
  const readinessInput = {
    ...controlledAnalysis,
    officialApplyUrl:source?.officialApplyUrl || null,
    openState:analysis?.openState,
  };
  const readiness = opportunityReadiness(passport, readinessInput, fit, evidence);
  const sourceHash = String(source?.sourceHash || '');
  if (!/^[a-f0-9]{64}$/u.test(sourceHash)) fail('invalid_opportunity', 422);
  const roleTitle = safeText(analysis?.roleTitle, 100);
  if (!roleTitle || !ROLE_SET.has(analysis?.roleType) || !INDUSTRY_SET.has(analysis?.industryKey)
    || !LEVEL_SET.has(analysis?.germanLevel)) fail('invalid_opportunity', 422);
  return {
    version: 1,
    id: `opp_${sha256(`${sourceHash}:${roleTitle}:${analysis.roleType}`).slice(0, 24)}`,
    sourceHash,
    sourceHost: source?.sourceHost || null,
    officialApplyUrl: normalizeOfficialApplyUrl(source?.officialApplyUrl, { nullable:true }),
    roleTitle,
    employerDisplay: safeText(analysis?.employerDisplay, 100, { nullable:true }),
    location: safeText(analysis?.location, 120, { nullable:true }),
    postedDate: analysis?.postedDate ? isoDate(analysis.postedDate) : null,
    openState: analysis?.openState === 'closed' ? 'closed' : analysis?.openState === 'open' ? 'open' : 'unknown',
    roleType: analysis.roleType,
    industryKey: analysis.industryKey,
    germanLevel: analysis.germanLevel,
    skillIds: Array.isArray(analysis.skillIds) ? analysis.skillIds.filter((id) => SKILL_SET.has(id)).slice(0, 8) : [],
    questionTopicIds: Array.isArray(analysis.questionTopicIds)
      ? analysis.questionTopicIds.filter((id) => QUESTION_SET.has(id)).slice(0, 9) : [],
    requirementLabels: Array.isArray(analysis.displayRequirements)
      ? analysis.displayRequirements.map((item) => safeText(item, 120)).filter(Boolean).slice(0, 6) : [],
    eligibilityRequirements,
    fitScore: fit.score,
    fitReasons: fit.reasons,
    fitGaps: fit.gaps,
    readinessState: readiness.state,
    readinessReasons: readiness.reasons,
    readinessEvidenceHash:readinessEvidenceHash(evidence),
    status: 'discovered',
    importedAt: now,
    updatedAt: now,
    outcome: null,
    outcomeAt: null,
  };
}

const READINESS_STATUS = Object.freeze({
  MEASURE_FIRST:'measure_first',
  PREP_FIRST:'prep_first',
  READY_TO_APPLY:'ready_to_apply',
});

export function refreshOpportunityReadiness(state, passport, now = Date.now(), evidence = {}) {
  const normalized = normalizeMissionControlState(state);
  const earlyStatuses = new Set(['discovered', 'shortlisted', 'measure_first', 'prep_first', 'ready_to_apply']);
  let changed = false;
  for (const opportunity of normalized.opportunities) {
    const fit = scoreOpportunityFit(passport, opportunity);
    const readiness = opportunityReadiness(passport, opportunity, fit, evidence);
    const nextEvidenceHash = readinessEvidenceHash(evidence);
    const nextStatus = earlyStatuses.has(opportunity.status)
      ? (READINESS_STATUS[readiness.state] || 'discovered') : opportunity.status;
    const rowChanged = opportunity.fitScore !== fit.score
      || JSON.stringify(opportunity.fitReasons) !== JSON.stringify(fit.reasons)
      || JSON.stringify(opportunity.fitGaps) !== JSON.stringify(fit.gaps)
      || opportunity.readinessState !== readiness.state
      || JSON.stringify(opportunity.readinessReasons) !== JSON.stringify(readiness.reasons)
      || opportunity.readinessEvidenceHash !== nextEvidenceHash
      || opportunity.status !== nextStatus;
    opportunity.fitScore = fit.score;
    opportunity.fitReasons = fit.reasons;
    opportunity.fitGaps = fit.gaps;
    opportunity.readinessState = readiness.state;
    opportunity.readinessReasons = readiness.reasons;
    opportunity.readinessEvidenceHash = nextEvidenceHash;
    opportunity.status = nextStatus;
    if (rowChanged) { opportunity.updatedAt = now; changed = true; }
  }
  if (changed) normalized.updatedAt = now;
  return normalized;
}

export function findOpportunity(state, id) {
  return opportunityInState(normalizeMissionControlState(state), id);
}

function opportunityInState(normalized, id) {
  const safe = safeRecordId(id, 'opp');
  if (!safe) fail('opportunity_not_found', 404);
  const opportunity = normalized.opportunities.find((item) => item.id === safe);
  if (!opportunity) fail('opportunity_not_found', 404);
  return opportunity;
}

export function findRecentDuplicate(state, sourceHash, now = Date.now()) {
  return normalizeMissionControlState(state).opportunities.find((item) => (
    item.sourceHash === sourceHash && now - item.importedAt <= OPPORTUNITY_DUPLICATE_WINDOW_MS
  )) || null;
}

export function jobRadar(state, flags, now = Date.now()) {
  const normalized = normalizeMissionControlState(state);
  const terminal = new Set(APPLICATION_OUTCOMES);
  return normalized.opportunities
    .filter((item) => !terminal.has(item.status) && item.openState !== 'closed' && item.readinessState !== 'HARD_MISMATCH')
    .sort((a, b) => b.fitScore - a.fitScore || b.importedAt - a.importedAt || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Math.min(RADAR_TOP_LIMIT, flags?.radarLimit || 0)))
    .map((item) => publicOpportunity(item, normalized));
}

export function advanceRadarStatuses(state, opportunityIds, now = Date.now()) {
  const normalized = normalizeMissionControlState(state);
  const ids = new Set(Array.isArray(opportunityIds) ? opportunityIds.map((id) => safeId(id, 'opp')).filter(Boolean) : []);
  let changed = false;
  for (const opportunity of normalized.opportunities) {
    if (!ids.has(opportunity.id) || !['discovered', 'shortlisted'].includes(opportunity.status)) continue;
    opportunity.status = READINESS_STATUS[opportunity.readinessState] || 'shortlisted';
    opportunity.updatedAt = now;
    changed = true;
  }
  if (changed) normalized.updatedAt = now;
  return { state:normalized, changed };
}

export function publicOpportunity(value, relatedState = null) {
  const opportunity = normalizeOpportunity(value);
  if (!opportunity) return null;
  const { sourceHash: _privateHash, readinessEvidenceHash:_privateEvidenceHash, ...safe } = opportunity;
  const applicationPack = normalizePack((Array.isArray(relatedState?.applicationPacks)
    ? relatedState.applicationPacks.filter((item) => item?.opportunityId === opportunity.id) : [])
    .sort((a, b) => (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0))[0]);
  const latestResponse = normalizeResponseEvent((Array.isArray(relatedState?.responseEvents)
    ? relatedState.responseEvents.filter((item) => item?.opportunityId === opportunity.id) : [])
    .sort((a, b) => (Number(b?.createdAt) || 0) - (Number(a?.createdAt) || 0))[0]);
  const confirmedInterview = normalizeInterview((Array.isArray(relatedState?.interviews)
    ? relatedState.interviews.filter((item) => item?.opportunityId === opportunity.id) : [])
    .sort((a, b) => (Number(b?.confirmedAt) || 0) - (Number(a?.confirmedAt) || 0))[0]);
  return {
    ...safe,
    hardFit:safe.readinessState !== 'HARD_MISMATCH'
      && !safe.readinessReasons.some((reason) => reason === 'missing_measurement' || reason.endsWith('_unknown')),
    applicationPack: applicationPack && safeRecordId(applicationPack.id, 'pack')
      ? { id:applicationPack.id, status:applicationPack.status, trackingOnly:applicationPack.trackingOnly === true }
      : null,
    latestResponse: RESPONSE_EVENT_TYPE_SET.has(latestResponse?.type) ? latestResponse.type : null,
    interview:confirmedInterview ? {
      interviewDate:confirmedInterview.interviewDate,
      interviewTime:confirmedInterview.interviewTime,
      timezone:confirmedInterview.timezone,
      confirmedAt:confirmedInterview.confirmedAt,
    } : null,
  };
}

function normalizePack(value) {
  if (!isPlainObject(value) || value.version !== 1 || !safeRecordId(value.id, 'pack')
    || !safeRecordId(value.opportunityId, 'opp')) return null;
  if (!['tracker_only', 'draft', 'approved', 'submitted'].includes(value.status)) return null;
  const createdAt = validTimestamp(value.createdAt);
  const updatedAt = validTimestamp(value.updatedAt);
  if (!createdAt || !updatedAt) return null;
  return {
    version: 1,
    id: value.id,
    opportunityId: value.opportunityId,
    status: value.status,
    trackingOnly: value.trackingOnly === true,
    passportFactsHash: /^[a-f0-9]{64}$/u.test(value.passportFactsHash || '') ? value.passportFactsHash : null,
    readinessLockHash: /^[a-f0-9]{64}$/u.test(value.readinessLockHash || '') ? value.readinessLockHash : null,
    title: safeText(value.title, 100),
    employerDisplay: safeText(value.employerDisplay, 100, { nullable:true }),
    applyUrl: (() => { try { return normalizeOfficialApplyUrl(value.applyUrl, { nullable:true }); } catch { return null; } })(),
    summary: safeText(value.summary, 1600),
    coverNote: safeText(value.coverNote, 3000),
    facts: Array.isArray(value.facts) ? value.facts.filter(isPlainObject).map((fact) => ({
      id: safeId(fact.id, 'fact'),
      label: safeText(fact.label, 100),
      value: safeText(fact.value, 240),
      source: FACT_PROVENANCE_SET.has(fact.source) ? fact.source : null,
    })).filter((fact) => fact.id && fact.label && fact.value && fact.source).slice(0, 30) : [],
    answers: Array.isArray(value.answers) ? value.answers.filter(isPlainObject).map((answer) => ({
      id: safeId(answer.id, 'answer'),
      question: safeText(answer.question, 500),
      answer: safeText(answer.answer, 1200),
    })).filter((answer) => answer.id && answer.question && answer.answer).slice(0, 20) : [],
    warnings: Array.isArray(value.warnings)
      ? [...new Set(value.warnings.map((item) => safeText(item, 300)).filter(Boolean))].slice(0, 12) : [],
    factLockIds: Array.isArray(value.factLockIds)
      ? [...new Set(value.factLockIds.map((id) => safeId(id, 'fact')).filter(Boolean))].slice(0, 30) : [],
    answerMap: Array.isArray(value.answerMap)
      ? value.answerMap.filter(isPlainObject).map((row) => ({
        topicId: QUESTION_SET.has(row.topicId) ? row.topicId : null,
        factLockIds: Array.isArray(row.factLockIds)
          ? [...new Set(row.factLockIds.map((id) => safeId(id, 'fact')).filter(Boolean))].slice(0, 5) : [],
      })).filter((row) => row.topicId).slice(0, 9) : [],
    checklist: Array.isArray(value.checklist)
      ? [...new Set(value.checklist.filter((id) => ['review_facts', 'tailor_cv', 'official_apply', 'save_receipt'].includes(id)))].slice(0, 4) : [],
    confirmationVersion: value.confirmationVersion === 1 ? 1 : null,
    approvedAt: validTimestamp(value.approvedAt),
    submittedAt: validTimestamp(value.submittedAt),
    receiptHash: /^[a-f0-9]{64}$/u.test(value.receiptHash || '') ? value.receiptHash : null,
    createdAt,
    updatedAt,
  };
}

export function passportFactsHash(passport) {
  const normalized = normalizePassport(passport);
  return normalized ? sha256(canonicalJson(normalized.facts)) : sha256('[]');
}

/**
 * Locks every input that can change application eligibility or the generated
 * pack. Server-owned evidence is represented by the opportunity's refresh hash;
 * raw assessments and private source material never enter the pack.
 */
export function applicationReadinessLockHash(passport, opportunity) {
  const p = normalizePassport(passport);
  const o = normalizeOpportunity(opportunity);
  if (!p || !o) return null;
  return sha256(canonicalJson({
    passport:{
      roleTypes:[...p.roleTypes].sort(),
      industryKeys:[...p.industryKeys].sort(),
      germanLevel:p.germanLevel,
      locationMode:p.locationMode,
      locationEligibilities:[...p.locationEligibilities].sort(),
      shiftPreferences:[...p.shiftPreferences].sort(),
      availabilityDate:p.availabilityDate,
      experienceBand:p.experienceBand,
      salaryFloorEGP:p.salaryFloorEGP,
      workAuthorization:p.workAuthorization,
      skillIds:[...p.skillIds].sort(),
      facts:[...p.facts].sort((a, b) => a.id.localeCompare(b.id)),
      consentVersion:p.consentVersion,
      updatedAt:p.updatedAt,
    },
    opportunity:{
      sourceHash:o.sourceHash,
      officialApplyUrl:o.officialApplyUrl,
      openState:o.openState,
      roleTitle:o.roleTitle,
      roleType:o.roleType,
      industryKey:o.industryKey,
      germanLevel:o.germanLevel,
      skillIds:[...o.skillIds].sort(),
      questionTopicIds:[...o.questionTopicIds].sort(),
      eligibilityRequirements:{
        ...o.eligibilityRequirements,
        verifiedDimensions:[...o.eligibilityRequirements.verifiedDimensions].sort(),
        locationKeys:[...o.eligibilityRequirements.locationKeys].sort(),
        workModes:[...o.eligibilityRequirements.workModes].sort(),
        workAuthorizations:[...o.eligibilityRequirements.workAuthorizations].sort(),
        shifts:[...o.eligibilityRequirements.shifts].sort(),
      },
      readinessEvidenceHash:o.readinessEvidenceHash,
    },
  }));
}

function buildTruthLockedAssets(opportunity, passport) {
  const facts = passport.facts.filter((fact) => fact.shareAllowed).slice(0, 12).map((fact) => ({
    id:fact.id,
    label:fact.type,
    value:fact.value,
    source:fact.provenance,
  }));
  const evidence = facts.map((fact) => fact.value);
  const summary = evidence.length
    ? `Candidate for ${opportunity.roleTitle}. Confirmed relevant evidence: ${evidence.join('; ')}.`
    : '';
  const coverNote = evidence.length
    ? `I am applying for the ${opportunity.roleTitle} role. My confirmed relevant experience includes ${evidence.join('; ')}. I would welcome the opportunity to discuss how this experience applies to the role.`
    : '';
  const topics = opportunity.questionTopicIds.slice(0, 6);
  const answers = topics.map((topicId, index) => {
    const fact = facts[index % Math.max(1, facts.length)];
    if (!fact) return null;
    return {
      id:`answer_${sha256(`${opportunity.id}:${topicId}`).slice(0, 16)}`,
      question:VACANCY_PRACTICE_QUESTIONS[topicId],
      answer:`Confirmed evidence to adapt in your own words: ${fact.value}`,
    };
  }).filter(Boolean);
  return {
    summary,
    coverNote,
    facts,
    answers,
    warnings:[
      'Review and edit every draft before submitting it yourself.',
      'The draft uses only facts you confirmed and allowed for sharing.',
    ],
  };
}

export function buildApplicationPack(state, opportunity, flags, now = Date.now()) {
  const normalized = normalizeMissionControlState(state);
  const target = normalized.opportunities.find((item) => item.id === opportunity?.id);
  if (!target) fail('opportunity_not_found', 404);
  if (APPLICATION_OUTCOMES.includes(target.status) || target.openState === 'closed') fail('opportunity_closed', 409);
  if (target.readinessState !== 'READY_TO_APPLY') fail('not_ready_to_apply', 409);
  const passport = normalizePassport(normalized.passport);
  const currentFactsHash = passportFactsHash(passport);
  const currentReadinessLockHash = applicationReadinessLockHash(passport, target);
  if (!currentReadinessLockHash) fail('not_ready_to_apply', 409);
  const existingIndex = normalized.applicationPacks.findIndex((item) => item.opportunityId === target.id);
  const existing = existingIndex >= 0 ? normalized.applicationPacks[existingIndex] : null;
  if (existing && (existing.readinessLockHash === currentReadinessLockHash || existing.status === 'submitted')) {
    return { state: normalized, pack: existing, created: false };
  }
  if (existingIndex >= 0) normalized.applicationPacks.splice(existingIndex, 1);
  if (normalized.applicationPacks.length >= flags.canTrackApplications) fail('application_limit', 403);
  const shareable = passport?.facts.filter((fact) => fact.shareAllowed) || [];
  if (flags.canGeneratePack && !shareable.length) fail('passport_evidence_required', 422);
  const trackingOnly = !flags.canGeneratePack;
  const factLockIds = trackingOnly ? [] : shareable.map((fact) => fact.id).slice(0, 12);
  const assets = trackingOnly ? { summary:'', coverNote:'', facts:[], answers:[], warnings:[] }
    : buildTruthLockedAssets(target, passport);
  const pack = {
    version: 1,
    id: `pack_${sha256(`${target.id}:${now}`).slice(0, 24)}`,
    opportunityId: target.id,
    status: trackingOnly ? 'tracker_only' : 'draft',
    trackingOnly,
    passportFactsHash: currentFactsHash,
    readinessLockHash:currentReadinessLockHash,
    title: target.roleTitle,
    employerDisplay: target.employerDisplay,
    applyUrl: target.officialApplyUrl,
    ...assets,
    factLockIds,
    answerMap: trackingOnly ? [] : target.questionTopicIds.map((topicId, index) => ({
      topicId,
      factLockIds: factLockIds.length ? [factLockIds[index % factLockIds.length]] : [],
    })),
    checklist: trackingOnly ? ['official_apply', 'save_receipt']
      : ['review_facts', 'tailor_cv', 'official_apply', 'save_receipt'],
    confirmationVersion: null,
    approvedAt: null,
    submittedAt: null,
    receiptHash: null,
    createdAt: now,
    updatedAt: now,
  };
  normalized.applicationPacks.push(pack);
  target.status = 'ready_to_apply';
  target.updatedAt = now;
  normalized.updatedAt = now;
  return { state: normalized, pack, created: true };
}

export function approveApplicationPack(state, packId, body, now = Date.now()) {
  assertExactObject(body, ['confirmed', 'factLockIds', 'confirmationVersion', 'idempotencyKey']);
  if (body.confirmed !== true || body.confirmationVersion !== 1) fail('confirmation_required', 409);
  const normalized = normalizeMissionControlState(state);
  const pack = normalized.applicationPacks.find((item) => item.id === safeRecordId(packId, 'pack'));
  if (!pack) fail('application_pack_not_found', 404);
  const opportunity = opportunityInState(normalized, pack.opportunityId);
  if (APPLICATION_OUTCOMES.includes(opportunity.status) || opportunity.openState === 'closed') fail('opportunity_closed', 409);
  if (pack.trackingOnly) fail('upgrade_required', 403);
  const passport = normalizePassport(normalized.passport);
  if (opportunity.readinessState !== 'READY_TO_APPLY') fail('not_ready_to_apply', 409);
  const currentReadinessLockHash = applicationReadinessLockHash(passport, opportunity);
  if (!currentReadinessLockHash || pack.readinessLockHash !== currentReadinessLockHash
    || pack.passportFactsHash !== passportFactsHash(passport)) fail('application_pack_stale', 409);
  const allowedFacts = new Set((passport?.facts || []).filter((fact) => fact.shareAllowed).map((fact) => fact.id));
  const factLockIds = Array.isArray(body.factLockIds)
    ? [...new Set(body.factLockIds.map((id) => safeId(id, 'fact')).filter(Boolean))] : [];
  if (!factLockIds.length || factLockIds.length > 30 || factLockIds.some((id) => !allowedFacts.has(id))) {
    fail('fact_lock_invalid', 422);
  }
  if (pack.status === 'approved' || pack.status === 'submitted') return { state: normalized, pack, changed: false };
  pack.factLockIds = factLockIds;
  pack.status = 'approved';
  pack.confirmationVersion = 1;
  pack.approvedAt = now;
  pack.updatedAt = now;
  opportunity.status = 'pack_approved';
  opportunity.updatedAt = now;
  normalized.updatedAt = now;
  return { state: normalized, pack, changed: true };
}

export function markApplicationSubmitted(state, packId, body, now = Date.now()) {
  assertExactObject(body, ['confirmed', 'receiptHash', 'idempotencyKey']);
  if (body.confirmed !== true) fail('confirmation_required', 409);
  if (body.receiptHash !== undefined && body.receiptHash !== null
    && !/^[a-f0-9]{64}$/u.test(String(body.receiptHash))) fail('invalid_receipt_hash');
  const normalized = normalizeMissionControlState(state);
  const pack = normalized.applicationPacks.find((item) => item.id === safeRecordId(packId, 'pack'));
  if (!pack) fail('application_pack_not_found', 404);
  const opportunity = opportunityInState(normalized, pack.opportunityId);
  if (APPLICATION_OUTCOMES.includes(opportunity.status) || opportunity.openState === 'closed') fail('opportunity_closed', 409);
  if (!pack.trackingOnly && pack.status !== 'approved' && pack.status !== 'submitted') fail('application_pack_not_approved', 409);
  if (pack.status === 'submitted') return { state: normalized, pack, changed: false };
  pack.status = 'submitted';
  pack.submittedAt = now;
  pack.updatedAt = now;
  pack.receiptHash = body.receiptHash || null;
  opportunity.status = 'user_submitted';
  opportunity.updatedAt = now;
  normalized.updatedAt = now;
  return { state: normalized, pack, changed: true };
}

export function publicApplicationPack(value, flags) {
  const pack = normalizePack(value);
  if (!pack) return null;
  if (!flags?.canGeneratePack || pack.trackingOnly) {
    return {
      id: pack.id,
      opportunityId: pack.opportunityId,
      status: pack.status,
      trackingOnly: true,
      applyUrl:pack.applyUrl,
      title:pack.title,
      employerDisplay:pack.employerDisplay,
      submittedAt: pack.submittedAt,
      createdAt: pack.createdAt,
      updatedAt: pack.updatedAt,
    };
  }
  const {
    passportFactsHash:_privateFactsHash,
    readinessLockHash:_privateReadinessLockHash,
    factLockIds:_privateFactLocks,
    answerMap:_privateAnswerMap,
    checklist:_privateChecklist,
    receiptHash:_privateReceiptHash,
    ...safe
  } = pack;
  return safe;
}

export function classifyResponseText(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 10000) fail('invalid_response_text');
  const text = value.normalize('NFKC').replace(BIDI_AND_FORMAT_CONTROLS, '').replace(CONTROL_CHARS, ' ').trim();
  if (!text) fail('invalid_response_text');
  const lower = text.toLocaleLowerCase('de');
  const has = (pattern) => pattern.test(lower);
  let type = 'other';
  let confidence = 'low';
  if (has(/\b(?:interview|vorstellungsgespr[aä]ch|gespr[aä]ch|termin|einladung|video call|telefoninterview)\b/iu)
    && has(/\b(?:uhr|datum|am\s+\d|einladen|best[aä]tigen|verf[uü]gbar|schedule|when)\b/iu)) {
    type = 'interview_invitation'; confidence = 'high';
  } else if (has(/\b(?:leider|absage|nicht weiter|anderer kandidat|not selected|unsuccessful|rejected)\b/iu)) {
    type = 'rejection'; confidence = 'high';
  } else if (has(/\b(?:assessment|test|sprachtest|online.?test|aufgabe|probeaufgabe)\b/iu)) {
    type = 'assessment'; confidence = 'medium';
  } else if (has(/\b(?:erhalten|eingang|received|application received|bewerbung(?:\s+.{0,40})?\s+eingegangen|vielen dank f[uü]r ihre bewerbung)\b/iu)) {
    type = 'acknowledgement'; confidence = 'medium';
  }
  return {
    type,
    confidence,
    suggestedAction: type === 'interview_invitation' ? 'confirm_interview'
      : type === 'rejection' ? 'record_outcome'
        : type === 'assessment' ? 'review_assessment'
          : type === 'acknowledgement' ? 'wait_for_human_response' : 'review_manually',
    rawPersisted: false,
  };
}

function normalizeResponseEvent(value) {
  if (!isPlainObject(value) || !safeRecordId(value.opportunityId, 'opp')
    || !RESPONSE_EVENT_TYPE_SET.has(value.type) || !RESPONSE_CONFIDENCE_SET.has(value.confidence)) return null;
  const createdAt = validTimestamp(value.createdAt);
  const confirmedAt = value.confirmedAt === null || value.confirmedAt === undefined
    ? null : validTimestamp(value.confirmedAt);
  if (!createdAt || (value.confirmedAt !== null && value.confirmedAt !== undefined && !confirmedAt)) return null;
  return {
    opportunityId:value.opportunityId,
    type:value.type,
    confidence:value.confidence,
    createdAt,
    confirmedAt,
  };
}

/** Persist only the bounded classification; the supplied recruiter text never enters state. */
export function recordResponseClassification(state, opportunityId, classification, now = Date.now()) {
  if (!isPlainObject(classification) || !RESPONSE_EVENT_TYPE_SET.has(classification.type)
    || !RESPONSE_CONFIDENCE_SET.has(classification.confidence)) fail('invalid_response_classification');
  const normalized = normalizeMissionControlState(state);
  const opportunity = opportunityInState(normalized, opportunityId);
  const event = {
    opportunityId:opportunity.id,
    type:classification.type,
    confidence:classification.confidence,
    createdAt:now,
    confirmedAt:null,
  };
  normalized.responseEvents = [...normalized.responseEvents, event].slice(-100);
  if (!APPLICATION_OUTCOMES.includes(opportunity.status)
    && !['interview_confirmed', 'preparation'].includes(opportunity.status)) {
    if (classification.type === 'interview_invitation') opportunity.status = 'interview_proposed';
    else if (classification.type === 'acknowledgement'
      && !['human_response', 'interview_proposed'].includes(opportunity.status)) opportunity.status = 'acknowledged';
    else if (classification.type !== 'acknowledgement' && opportunity.status !== 'interview_proposed') {
      opportunity.status = 'human_response';
    }
  }
  opportunity.updatedAt = now;
  normalized.updatedAt = now;
  return { state:normalized, event, opportunity };
}

export function normalizeConfirmInterview(value, now = Date.now()) {
  assertExactObject(value, ['interviewDate', 'interviewTime', 'timezone', 'confirmed']);
  if (value.confirmed !== true) fail('confirmation_required', 409);
  if (value.timezone !== 'Africa/Cairo') fail('invalid_timezone');
  const interviewTime = value.interviewTime === undefined || value.interviewTime === null ? null : String(value.interviewTime);
  if (interviewTime !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(interviewTime)) fail('invalid_time');
  const interviewDate = isoDate(value.interviewDate);
  if (interviewDate < dayKey(now)) fail('invalid_date');
  return {
    interviewDate,
    interviewTime,
    timezone: 'Africa/Cairo',
    confirmed: true,
  };
}

export function recordInterviewConfirmation(state, opportunityId, confirmation, now = Date.now()) {
  const normalized = normalizeMissionControlState(state);
  const opportunity = opportunityInState(normalized, opportunityId);
  if (APPLICATION_OUTCOMES.includes(opportunity.status)) fail('opportunity_closed', 409);
  const invitation = normalized.responseEvents
    .filter((item) => item.opportunityId === opportunity.id && item.type === 'interview_invitation')
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!invitation) fail('interview_invitation_required', 409);
  const existing = normalized.interviews.find((item) => item.opportunityId === opportunity.id);
  if (existing && existing.interviewDate === confirmation.interviewDate
    && existing.interviewTime === confirmation.interviewTime && invitation.confirmedAt) {
    return { state: normalized, interview: existing, changed: false };
  }
  const interview = {
    id: existing?.id || `int_${sha256(`${opportunity.id}:interview`).slice(0, 24)}`,
    opportunityId: opportunity.id,
    interviewDate: confirmation.interviewDate,
    interviewTime: confirmation.interviewTime,
    timezone: 'Africa/Cairo',
    confirmedAt: now,
  };
  if (existing) Object.assign(existing, interview);
  else normalized.interviews.push(interview);
  invitation.confirmedAt = invitation.confirmedAt || now;
  opportunity.updatedAt = now;
  opportunity.status = 'interview_confirmed';
  normalized.updatedAt = now;
  return { state: normalized, interview, changed: true };
}

export function recordOpportunityOutcome(state, opportunityId, body, now = Date.now()) {
  assertExactObject(body, ['outcome']);
  const outcome = boundedEnum(body.outcome, OUTCOME_SET, 'invalid_outcome');
  const normalized = normalizeMissionControlState(state);
  const opportunity = opportunityInState(normalized, opportunityId);
  if (opportunity.outcome === outcome) return { state: normalized, opportunity, changed: false };
  opportunity.outcome = outcome;
  opportunity.outcomeAt = now;
  opportunity.updatedAt = now;
  opportunity.status = outcome;
  normalized.outcomes = [
    ...normalized.outcomes,
    { opportunityId: opportunity.id, outcome, at: now },
  ].slice(-100);
  normalized.updatedAt = now;
  return { state: normalized, opportunity, changed: true };
}

// -- State normalization and guide integration ----------------------------

function jsonSafeClone(value, depth = 0) {
  if (depth > 8) fail('invalid_idempotency_record');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > 4096) fail('invalid_idempotency_record');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_idempotency_record');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) fail('invalid_idempotency_record');
    return value.map((item) => jsonSafeClone(item, depth + 1));
  }
  if (!isPlainObject(value)) fail('invalid_idempotency_record');
  const keys = Object.keys(value);
  if (keys.length > 100 || keys.some((key) => !/^[A-Za-z0-9_-]{1,80}$/u.test(key)
    || ['__proto__', 'prototype', 'constructor'].includes(key))) fail('invalid_idempotency_record');
  const result = Object.create(null);
  for (const key of keys) result[key] = jsonSafeClone(value[key], depth + 1);
  return result;
}

function normalizeIdempotencyResponse(operation, value) {
  const cloned = jsonSafeClone(value);
  if (!['application_pack_create', 'application_pack_approve', 'application_mark_submitted'].includes(operation)) {
    return cloned;
  }
  if (!isPlainObject(cloned) || !isPlainObject(cloned.applicationPack)
    || !safeRecordId(cloned.applicationPack.id, 'pack')) fail('invalid_idempotency_record');
  const compact = { applicationPack:{ id:cloned.applicationPack.id } };
  if (operation === 'application_pack_create') {
    if (typeof cloned.created !== 'boolean') fail('invalid_idempotency_record');
    compact.created = cloned.created;
  }
  return compact;
}

function normalizeIdempotencyRecord(value) {
  try {
    assertExactObject(value, ['key', 'operation', 'payloadHash', 'responseStatus', 'responseValue', 'createdAt'], 'invalid_idempotency_record');
    if (!IDEMPOTENCY_KEY_PATTERN.test(value.key || '')
      || !IDEMPOTENCY_OPERATION_PATTERN.test(value.operation || '')
      || !IDEMPOTENCY_OPERATION_SET.has(value.operation)
      || !/^[a-f0-9]{64}$/u.test(value.payloadHash || '')
      || !Number.isInteger(value.responseStatus) || value.responseStatus < 100 || value.responseStatus > 599
      || !validTimestamp(value.createdAt)) fail('invalid_idempotency_record');
    const responseValue = normalizeIdempotencyResponse(value.operation, value.responseValue);
    if (Buffer.byteLength(canonicalJson(responseValue), 'utf8') > MISSION_CONTROL_MAX_IDEMPOTENCY_RESPONSE_BYTES) {
      fail('invalid_idempotency_record');
    }
    return {
      key:value.key,
      operation:value.operation,
      payloadHash:value.payloadHash,
      responseStatus:value.responseStatus,
      responseValue,
      createdAt:value.createdAt,
    };
  } catch { return null; }
}

export function idempotencyPayloadHash(value) {
  const cloned = jsonSafeClone(value);
  return sha256(canonicalJson(cloned));
}

export function getIdempotencyRecord(state, key, operation, payloadHash) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(key || ''))
    || !IDEMPOTENCY_OPERATION_PATTERN.test(String(operation || ''))
    || !IDEMPOTENCY_OPERATION_SET.has(String(operation || ''))
    || !/^[a-f0-9]{64}$/u.test(String(payloadHash || ''))) fail('invalid_idempotency_key');
  const normalized = normalizeMissionControlState(state);
  const record = normalized.idempotencyRecords.find((item) => item.key === key);
  if (!record) return null;
  if (record.operation !== operation || record.payloadHash !== payloadHash) fail('idempotency_conflict', 409);
  return record;
}

export function storeIdempotencyRecord(state, value) {
  const record = normalizeIdempotencyRecord(value);
  if (!record) fail('invalid_idempotency_record');
  const normalized = normalizeMissionControlState(state);
  const existing = normalized.idempotencyRecords.find((item) => item.key === record.key);
  if (existing) {
    if (existing.operation !== record.operation || existing.payloadHash !== record.payloadHash) {
      fail('idempotency_conflict', 409);
    }
    return { state:normalized, record:existing, created:false };
  }
  normalized.idempotencyRecords = [...normalized.idempotencyRecords, record]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MISSION_CONTROL_MAX_IDEMPOTENCY_RECORDS);
  normalized.updatedAt = Math.max(normalized.updatedAt || 0, record.createdAt);
  return { state:normalized, record, created:true };
}

function normalizeActiveVacancyBridge(value) {
  if (value === null || value === undefined) return null;
  try { assertExactObject(value, ['opportunityId', 'targetId', 'interviewDate', 'activatedAt'], 'invalid_vacancy_bridge'); }
  catch { return null; }
  if (!safeRecordId(value.opportunityId, 'opp') || !/^vac_[a-f0-9]{24}$/u.test(value.targetId || '')
    || !validTimestamp(value.activatedAt)) return null;
  let interviewDate;
  try { interviewDate = isoDate(value.interviewDate); } catch { return null; }
  return { opportunityId:value.opportunityId, targetId:value.targetId, interviewDate, activatedAt:value.activatedAt };
}

export function setActiveVacancyBridge(state, bridge) {
  const normalizedBridge = normalizeActiveVacancyBridge(bridge);
  if (!normalizedBridge) fail('invalid_vacancy_bridge');
  const normalized = normalizeMissionControlState(state);
  if (!normalized.opportunities.some((item) => item.id === normalizedBridge.opportunityId)) {
    fail('opportunity_not_found', 404);
  }
  normalized.activeVacancyBridge = normalizedBridge;
  normalized.updatedAt = Math.max(normalized.updatedAt || 0, normalizedBridge.activatedAt);
  return normalized;
}

export function resolveActiveVacancyBridge(state, opportunityId = null) {
  const normalized = normalizeMissionControlState(state);
  const bridge = normalized.activeVacancyBridge;
  if (!bridge || (opportunityId && bridge.opportunityId !== safeRecordId(opportunityId, 'opp'))) return null;
  const opportunity = normalized.opportunities.find((item) => item.id === bridge.opportunityId);
  if (!opportunity || opportunity.openState === 'closed' || APPLICATION_OUTCOMES.includes(opportunity.status)) return null;
  return {
    opportunityId:opportunity.id,
    targetId:bridge.targetId,
    interviewDate:bridge.interviewDate,
    activatedAt:bridge.activatedAt,
    roleType:opportunity.roleType,
    industryKey:opportunity.industryKey,
    germanLevel:opportunity.germanLevel,
    skillIds:[...opportunity.skillIds],
    questionTopicIds:[...opportunity.questionTopicIds],
  };
}

/**
 * Return only the opaque target id needed by other server-side diagnostics.
 * Decryption, owner-bound AAD verification, state normalization, and the
 * opportunity/bridge relationship all stay inside the Mission Control boundary.
 * Any unavailable, malformed, orphaned, closed, or foreign state fails closed.
 */
export function missionControlActiveVacancyTargetId(profile, options = {}) {
  try {
    const bridge = resolveActiveVacancyBridge(readEncryptedMissionControl(profile, options));
    return /^vac_[a-f0-9]{24}$/u.test(bridge?.targetId || '') ? bridge.targetId : null;
  } catch {
    return null;
  }
}

/** Governed, enum-only bridge for the existing live interview stack. */
export function missionControlVacancyLiveContext(profile, account, options = {}) {
  const env = options?.env || process.env;
  const flags = missionControlFlagsFor(account, { ...options, env });
  if (!flags.targetedLive || !boolFlag(env.MISSION_CONTROL_SINGLE_WRITER_CONFIRMED)
    || !profile?.userId || String(profile.userId) !== String(account?.id || '')) return null;
  try {
    const context = resolveActiveVacancyBridge(readEncryptedMissionControl(profile, options));
    if (!context) return null;
    return {
      targetId:context.targetId,
      industryKey:context.industryKey,
      roleType:context.roleType,
      germanLevel:context.germanLevel,
      skillIds:context.skillIds,
      questionTopicIds:context.questionTopicIds,
    };
  } catch { return null; }
}

export function emptyMissionControlState() {
  return {
    version: MISSION_CONTROL_SCHEMA_VERSION,
    passport: null,
    interviewPass: null,
    claimedPreviewIds: [],
    opportunities: [],
    applicationPacks: [],
    responseEvents: [],
    interviews: [],
    outcomes: [],
    idempotencyRecords: [],
    activeVacancyBridge: null,
    usage: { month: '', freeFitPreviews: 0 },
    updatedAt: null,
  };
}

function normalizeInterviewPass(value) {
  if (!isPlainObject(value) || !safeRecordId(value.id, 'pass') || !safeRecordId(value.previewId, 'ip')) return null;
  if (!ROLE_SET.has(value.roleType) || !INDUSTRY_SET.has(value.industryKey)
    || !LEVEL_SET.has(value.germanLevel) || !TIMING_SET.has(value.timing)) return null;
  const claimedAt = validTimestamp(value.claimedAt);
  if (!claimedAt) return null;
  return {
    id: value.id,
    previewId: value.previewId,
    roleType: value.roleType,
    industryKey: value.industryKey,
    germanLevel: value.germanLevel,
    timing: value.timing,
    evidenceCategories: Array.isArray(value.evidenceCategories)
      ? [...new Set(value.evidenceCategories.filter((id) => EVIDENCE_SET.has(id)))].slice(0, 8) : [],
    schedule:interviewPassSchedule(value.timing),
    claimedAt,
  };
}

function normalizeInterview(value) {
  if (!isPlainObject(value) || !safeRecordId(value.id, 'int') || !safeRecordId(value.opportunityId, 'opp')) return null;
  try {
    const interviewDate = isoDate(value.interviewDate);
    const interviewTime = value.interviewTime === null ? null : String(value.interviewTime || '');
    if (interviewTime !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(interviewTime)) return null;
    if (value.timezone !== 'Africa/Cairo' || !validTimestamp(value.confirmedAt)) return null;
    return { id:value.id, opportunityId:value.opportunityId, interviewDate, interviewTime,
      timezone:'Africa/Cairo', confirmedAt:value.confirmedAt };
  } catch { return null; }
}

export function normalizeMissionControlState(value) {
  const empty = emptyMissionControlState();
  if (!isPlainObject(value) || value.version !== MISSION_CONTROL_SCHEMA_VERSION) return empty;
  const opportunities = Array.isArray(value.opportunities)
    ? value.opportunities.map(normalizeOpportunity).filter(Boolean).slice(-MISSION_CONTROL_MAX_RECORDS) : [];
  const opportunityIds = new Set(opportunities.map((item) => item.id));
  const applicationPacks = Array.isArray(value.applicationPacks)
    ? value.applicationPacks.map(normalizePack).filter((item) => item && opportunityIds.has(item.opportunityId)).slice(-MISSION_CONTROL_MAX_RECORDS) : [];
  const responseEvents = Array.isArray(value.responseEvents)
    ? value.responseEvents.map(normalizeResponseEvent)
      .filter((item) => item && opportunityIds.has(item.opportunityId)).slice(-100) : [];
  const interviews = Array.isArray(value.interviews)
    ? value.interviews.map(normalizeInterview).filter((item) => item && opportunityIds.has(item.opportunityId)).slice(-100) : [];
  const outcomes = Array.isArray(value.outcomes) ? value.outcomes.filter(isPlainObject).map((row) => ({
    opportunityId: safeRecordId(row.opportunityId, 'opp'),
    outcome: OUTCOME_SET.has(row.outcome) ? row.outcome : null,
    at: validTimestamp(row.at),
  })).filter((row) => row.opportunityId && row.outcome && row.at && opportunityIds.has(row.opportunityId)).slice(-100) : [];
  const usage = isPlainObject(value.usage) ? value.usage : {};
  const idempotencyRecords = Array.isArray(value.idempotencyRecords)
    ? value.idempotencyRecords.map(normalizeIdempotencyRecord).filter(Boolean)
      .sort((a, b) => a.createdAt - b.createdAt).slice(-MISSION_CONTROL_MAX_IDEMPOTENCY_RECORDS)
    : [];
  const activeVacancyBridge = normalizeActiveVacancyBridge(value.activeVacancyBridge);
  return {
    version: MISSION_CONTROL_SCHEMA_VERSION,
    passport: normalizePassport(value.passport),
    interviewPass: normalizeInterviewPass(value.interviewPass),
    claimedPreviewIds: Array.isArray(value.claimedPreviewIds)
      ? [...new Set(value.claimedPreviewIds.map((id) => safeId(id, 'ip')).filter(Boolean))].slice(-50) : [],
    opportunities,
    applicationPacks,
    responseEvents,
    interviews,
    outcomes,
    idempotencyRecords,
    activeVacancyBridge:activeVacancyBridge
      && opportunityIds.has(activeVacancyBridge.opportunityId) ? activeVacancyBridge : null,
    usage: {
      month: typeof usage.month === 'string' && /^\d{4}-\d{2}$/u.test(usage.month) ? usage.month : '',
      freeFitPreviews: Number.isSafeInteger(usage.freeFitPreviews) && usage.freeFitPreviews >= 0
        ? Math.min(usage.freeFitPreviews, FREE_JOB_FIT_PREVIEWS_PER_MONTH) : 0,
    },
    updatedAt: validTimestamp(value.updatedAt),
  };
}

export function usageForMonth(state, now = Date.now()) {
  const normalized = normalizeMissionControlState(state);
  const month = dayKey(now).slice(0, 7);
  return {
    month,
    freeFitPreviews: normalized.usage.month === month ? normalized.usage.freeFitPreviews : 0,
  };
}

export function consumeFreeFitPreview(state, flags, now = Date.now()) {
  const normalized = normalizeMissionControlState(state);
  if (flags.fullPassport) return normalized;
  const usage = usageForMonth(normalized, now);
  if (usage.freeFitPreviews >= FREE_JOB_FIT_PREVIEWS_PER_MONTH) fail('job_fit_preview_limit', 403);
  normalized.usage = { month: usage.month, freeFitPreviews: usage.freeFitPreviews + 1 };
  normalized.updatedAt = now;
  return normalized;
}

export function missionControlView(state, flags, now = Date.now()) {
  if (!flags?.copilotEnabled || flags?.paused) return { enabled:false, paused:!!flags?.paused };
  const normalized = normalizeMissionControlState(state);
  const usage = usageForMonth(normalized, now);
  return {
    enabled: !!flags?.copilotEnabled,
    capabilities: {
      fullPassport: !!flags?.fullPassport,
      radarLimit: flags?.radarLimit || 0,
      canGeneratePack: !!flags?.canGeneratePack,
      canTrackApplications: flags?.canTrackApplications || 0,
      fullWrittenPlan: !!flags?.fullWrittenPlan,
      targetedLive: !!flags?.targetedLive,
      jobDiscoveryLive: !!flags?.jobDiscoveryLive,
    },
    passport: passportView(normalized.passport, flags),
    interviewPass: publicInterviewPass(normalized.interviewPass, flags),
    opportunities: normalized.opportunities.map((opportunity) => publicOpportunity(opportunity, normalized)).filter(Boolean),
    applicationPacks: normalized.applicationPacks.map((pack) => publicApplicationPack(pack, flags)).filter(Boolean),
    interviews: normalized.interviews,
    outcomes: normalized.outcomes,
    usage: flags?.fullPassport ? null : {
      freeFitPreviewsUsed: usage.freeFitPreviews,
      freeFitPreviewsLimit: FREE_JOB_FIT_PREVIEWS_PER_MONTH,
      trackedApplicationsLimit: FREE_TRACKED_APPLICATIONS,
    },
  };
}

/**
 * Copy-free, allowlisted action for BrainGuide. Vacancy/interview preparation is
 * intentionally selected here but the engine may still place its existing active
 * vacancy directive ahead of this helper.
 */
export function missionNextAction(profile, account, options = {}) {
  // HTTP callers may pass the already-governed rollout flags so BrainGuide
  // cannot advertise a Mission Control action while the write path is locked.
  // Pure/unit callers keep the core entitlement calculation as their default.
  const flags = options?.flags && typeof options.flags === 'object'
    ? options.flags
    : missionControlFlagsFor(account, options);
  if (!flags.copilotEnabled) return null;
  let state;
  try { state = readEncryptedMissionControl(profile, options); }
  catch { return null; }
  state = refreshOpportunityReadiness(
    state,
    state.passport,
    Number(options?.now) || Date.now(),
    candidateReadinessEvidence(profile, account, Number(options?.now) || Date.now()),
  );
  if (!state.passport) return { step:'passport' };
  if (!Array.isArray(profile?.sessions) || !profile.sessions.length) return { step:'measure' };
  const activeOpportunityIds = new Set(state.opportunities
    .filter((item) => !APPLICATION_OUTCOMES.includes(item.status) && item.openState !== 'closed')
    .map((item) => item.id));
  const interview = state.interviews
    .filter((item) => activeOpportunityIds.has(item.opportunityId)
      && item.interviewDate >= dayKey(Number(options?.now) || Date.now()))
    .sort((a, b) => a.interviewDate.localeCompare(b.interviewDate))[0];
  if (interview) return { step:'interview', opportunityId:interview.opportunityId };
  const packs = state.applicationPacks
    .filter((pack) => activeOpportunityIds.has(pack.opportunityId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const submitted = packs.find((pack) => pack.status === 'submitted');
  if (submitted) return { step:'response', opportunityId:submitted.opportunityId };
  const approved = packs.find((pack) => pack.status === 'approved' || pack.status === 'tracker_only');
  if (approved) return { step:'submit', opportunityId:approved.opportunityId };
  const draftPack = packs.find((pack) => pack.status === 'draft');
  if (draftPack) return { step:'pack', opportunityId:draftPack.opportunityId };
  const best = jobRadar(state, flags)[0];
  if (best?.readinessState === 'MEASURE_FIRST') return { step:'measure', opportunityId:best.id };
  if (best?.readinessState === 'PREP_FIRST') return { step:'prep', opportunityId:best.id };
  if (best?.readinessState === 'READY_TO_APPLY') return { step:'pack', opportunityId:best.id };
  if (best) return { step:'shortlist', opportunityId:best.id };
  if (state.interviewPass) return { step:'prep' };
  return { step:'shortlist' };
}

export default {
  missionControlFlagsFor,
  normalizeMissionControlState,
  missionNextAction,
};
