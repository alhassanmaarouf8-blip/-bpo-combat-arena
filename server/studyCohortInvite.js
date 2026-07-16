import { createHmac, timingSafeEqual } from 'crypto';

export const STUDY_COHORT_ID = 'omni-perform-21d-v1';
export const STUDY_COHORT_DAYS = 21;

const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 2048;
const MAX_FUTURE_MS = 45 * 24 * 60 * 60 * 1000;
const INVITE_ID_RE = /^[a-z0-9][a-z0-9_-]{7,63}$/;
const PARTICIPANT_SLOT_RE = /^(.*)__([0-9]{2})$/;
const PAYLOAD_KEYS = new Set(['v', 'cohort', 'inviteId', 'days', 'exp']);

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signatureFor(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function safeEqual(left, right) {
  let leftBytes;
  let rightBytes;
  try {
    leftBytes = Buffer.from(left, 'base64url');
    rightBytes = Buffer.from(right, 'base64url');
  } catch {
    return false;
  }
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function allowlistedInviteIds(raw) {
  const values = String(raw || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length > 1000 || values.some((value) => !INVITE_ID_RE.test(value))) return new Set();
  return new Set(values);
}

function inviteIdAllowed(inviteId, configuredIds) {
  const id = String(inviteId || '');
  if (configuredIds.has(id)) return true;
  const match = id.match(PARTICIPANT_SLOT_RE);
  if (!match || !configuredIds.has(match[1])) return false;
  const slot = Number(match[2]);
  return Number.isInteger(slot) && slot >= 1 && slot <= 99;
}

export function studyCohortConfig(env = process.env) {
  const mode = String(env.STUDY_COHORT_MODE || '').trim().toLowerCase();
  const secret = String(env.STUDY_COHORT_INVITE_SECRET || '');
  const inviteIds = allowlistedInviteIds(env.STUDY_COHORT_INVITE_IDS);
  const enabled = (mode === 'beta' || mode === 'on') && secret.length >= 32 && inviteIds.size > 0;
  return Object.freeze({ mode: enabled ? mode : 'off', enabled, secret: enabled ? secret : '', inviteIds });
}

export function studyInviteIdAllowed(inviteId, env = process.env) {
  const config = studyCohortConfig(env);
  return config.enabled && inviteIdAllowed(inviteId, config.inviteIds);
}

export function createStudyCohortInvite({ inviteId, expiresAt, secret }) {
  const id = String(inviteId || '').trim();
  const exp = Number(expiresAt);
  const key = String(secret || '');
  if (!INVITE_ID_RE.test(id)) throw new Error('invalid_invite_id');
  if (!Number.isSafeInteger(exp) || exp <= 0) throw new Error('invalid_invite_expiry');
  if (key.length < 32) throw new Error('invalid_invite_secret');
  const encodedPayload = base64url(JSON.stringify({
    v: TOKEN_VERSION,
    cohort: STUDY_COHORT_ID,
    inviteId: id,
    days: STUDY_COHORT_DAYS,
    exp,
  }));
  return `${encodedPayload}.${signatureFor(encodedPayload, key)}`;
}

export function validateStudyCohortInvite(token, { env = process.env, now = Date.now() } = {}) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw || raw.length > MAX_TOKEN_LENGTH) return null;
  const config = studyCohortConfig(env);
  if (!config.enabled) return null;
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = signatureFor(encodedPayload, config.secret);
  if (!safeEqual(suppliedSignature, expectedSignature)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const keys = Object.keys(payload);
  if (keys.length !== PAYLOAD_KEYS.size || keys.some((key) => !PAYLOAD_KEYS.has(key))) return null;
  if (payload.v !== TOKEN_VERSION || payload.cohort !== STUDY_COHORT_ID || payload.days !== STUDY_COHORT_DAYS) return null;
  if (!INVITE_ID_RE.test(payload.inviteId) || !inviteIdAllowed(payload.inviteId, config.inviteIds)) return null;
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= now || payload.exp - now > MAX_FUTURE_MS) return null;
  return Object.freeze({
    cohortId: STUDY_COHORT_ID,
    inviteId: payload.inviteId,
    days: STUDY_COHORT_DAYS,
    expiresAt: payload.exp,
  });
}
