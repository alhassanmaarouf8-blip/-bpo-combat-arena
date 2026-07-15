import { randomBytes } from 'crypto';

const RECEIPT_TTL_MS = 10 * 60 * 1000;
const MAX_RECEIPTS = 10_000;
const RECEIPT_PATTERN = /^[a-f0-9]{48}$/u;
const DRILLS = new Set([
  'satzbau-schmiede', 'sag-es-richtig', 'flow-drill', 'hoer-check', 'shadowing', 'druck-leiter', 'srs',
]);
const receipts = new Map();

function boundedInteger(value, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : null;
}

function normalizeVerifiedEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !DRILLS.has(value.drill)) return null;
  const event = { drill: value.drill, verified: true };
  if (typeof value.correct === 'boolean') event.correct = value.correct;
  if (typeof value.froze === 'boolean') event.froze = value.froze;
  const voicedMs = boundedInteger(value.voicedMs, 0, 120_000);
  if (voicedMs !== null) event.voicedMs = voicedMs;
  if (value.completedSet === true && value.drill === 'flow-drill') event.completedSet = true;
  if (/^[a-f0-9]{16}$/u.test(value.eventId || '')) event.eventId = value.eventId;
  if (value.drill === 'hoer-check' && /^[a-f0-9]{16}$/u.test(value.prescriptionId || '')) {
    event.prescriptionId = value.prescriptionId;
    if (value.skillId === 'listen-clear' || value.skillId === 'listen-phone') event.skillId = value.skillId;
    if (value.phase === 'practice') event.phase = 'practice';
  }
  if (event.correct === undefined && event.froze === undefined && event.completedSet !== true) return null;
  return Object.freeze(event);
}

function prune(now) {
  for (const [token, receipt] of receipts) {
    if (receipt.expiresAt <= now) receipts.delete(token);
  }
  while (receipts.size >= MAX_RECEIPTS) receipts.delete(receipts.keys().next().value);
}

/**
 * Mint a short-lived, one-use proof only from a server-side grader. The token contains no account,
 * score, transcript or audio data; the bounded event remains in process memory until redemption.
 */
export function issueDrillEvidenceReceipt(accountId, value, now = Date.now()) {
  const ownerId = typeof accountId === 'string' ? accountId.trim().slice(0, 120) : '';
  const event = normalizeVerifiedEvent(value);
  if (!ownerId || !event || !Number.isFinite(now) || now <= 0) return null;
  prune(now);
  const token = randomBytes(24).toString('hex');
  receipts.set(token, { accountId: ownerId, event, issuedAt: now, expiresAt: now + RECEIPT_TTL_MS });
  return token;
}

/** Redeem once and derive the event from server state. Client-supplied correctness is ignored. */
export function redeemDrillEvidenceReceipt(accountId, token, now = Date.now()) {
  const ownerId = typeof accountId === 'string' ? accountId.trim().slice(0, 120) : '';
  const key = typeof token === 'string' ? token.trim() : '';
  if (!ownerId || !RECEIPT_PATTERN.test(key) || !Number.isFinite(now) || now <= 0) return null;
  const receipt = receipts.get(key);
  if (!receipt || receipt.accountId !== ownerId) return null;
  receipts.delete(key);
  if (receipt.expiresAt <= now || receipt.issuedAt > now + 5_000) return null;
  return { ...receipt.event, verifiedAt: receipt.issuedAt };
}

export function resetDrillEvidenceReceiptsForTests() { receipts.clear(); }

export default { issueDrillEvidenceReceipt, redeemDrillEvidenceReceipt };
