/**
 * paymentsStore.js — durable storage for Vodafone Cash payments (no auth import → no cycles).
 *
 * Postgres via kv_store when DATABASE_URL is set (production); dev with no DB falls back to
 * memory (NOT a JSON file). Imported by payments.js (the user route), auth.js (billing/status
 * pending lookup), and admin.js (activate/reject) — keeping ONE source of truth.
 */
import { dbEnabled, kvGet, kvSet } from './db.js';

const NS = 'payments';
let _mem = []; // dev-only fallback when there's no database
let _mutationTail = Promise.resolve();
export const PAYMENT_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
export const PAYMENT_PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NOISE_RECORDS_PER_USER = 12;
const MAX_NOISE_RECORDS_GLOBAL = 2000;

if (!dbEnabled()) {
  console.warn('[paymentsStore] WARNING: DATABASE_URL not set — payments are stored in MEMORY ONLY and will be LOST on restart. Set DATABASE_URL on Render to persist payments.');
}

export async function loadPayments() {
  if (dbEnabled()) return (await kvGet(NS, 'all')) ?? [];
  return _mem;
}
export async function savePayments(all) {
  if (dbEnabled()) { await kvSet(NS, 'all', all); return; }
  _mem = all;
}

// Serialize read-modify-write operations inside one server process. Production runs a single
// instance today; this closes request races until financial records are moved to normalized rows.
export async function mutatePayments(mutator) {
  const previous = _mutationTail;
  let release;
  _mutationTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    const all = await loadPayments();
    const result = await mutator(all);
    if (result?.save !== false) await savePayments(all);
    return result?.value;
  } finally {
    release();
  }
}

// Legacy support code. Vodafone Cash transfers do not provide a free-text note field.
export function refCodeFor(userId) { return String(userId || '').slice(-6).toUpperCase(); }

// Hard-delete ALL payment records for one user (admin account deletion). Returns how many
// were removed. Only rewrites the store if something actually matched.
export async function deletePaymentsFor(userId) {
  return mutatePayments(async (all) => {
    const before = all.length;
    for (let i = all.length - 1; i >= 0; i--) if (all[i].userId === userId) all.splice(i, 1);
    return { value: before - all.length, save: before !== all.length };
  });
}

// Expire abandoned queue entries and bound attacker-created intent/cancellation noise without
// deleting activated/rejected financial audit records. A confirmed payment remains reviewable for
// 30 days; after that it is marked expired (not erased) and no longer blocks a fresh attempt.
export function maintainPaymentRecords(all, now = Date.now()) {
  let changed = false;
  for (const record of all) {
    if (record.status === 'intent' && record.createdAt < now - PAYMENT_INTENT_TTL_MS) {
      record.status = 'expired'; record.expiredAt = now; changed = true;
    } else if (record.status === 'pending'
      && (record.confirmedAt || record.createdAt) < now - PAYMENT_PENDING_TTL_MS) {
      record.status = 'expired'; record.expiredAt = now; changed = true;
    }
  }

  const noise = all.map((record, index) => ({ record, index }))
    .filter(({ record }) => record.status === 'cancelled' || record.status === 'expired')
    .sort((a, b) => (b.record.createdAt || 0) - (a.record.createdAt || 0));
  const perUser = new Map();
  const remove = new Set();
  let globallyKept = 0;
  for (const { record, index } of noise) {
    const count = perUser.get(record.userId) || 0;
    if (count >= MAX_NOISE_RECORDS_PER_USER || globallyKept >= MAX_NOISE_RECORDS_GLOBAL) {
      remove.add(index);
      continue;
    }
    perUser.set(record.userId, count + 1);
    globallyKept += 1;
  }
  if (remove.size) {
    for (const index of [...remove].sort((a, b) => b - a)) all.splice(index, 1);
    changed = true;
  }
  return changed;
}

// The user's current pending payment (if any), and whether their most recent one was rejected.
export function paymentStatusFromRecords(all, userId, now = Date.now()) {
  const mine = all.filter((p) => p.userId === userId);
  const pendingCutoff = now - PAYMENT_PENDING_TTL_MS;
  const pending = [...mine].reverse().find((p) => p.status === 'pending'
    && (p.confirmedAt || p.createdAt) >= pendingCutoff) || null;
  const intentCutoff = now - PAYMENT_INTENT_TTL_MS;
  const intent = pending ? null : ([...mine].reverse().find((p) => p.status === 'intent' && p.createdAt >= intentCutoff) || null);
  const lastRejected = !pending && !intent && mine.length > 0 && mine[mine.length - 1].status === 'rejected';
  return { pending, intent, lastRejected };
}

export async function paymentStatusFor(userId) {
  return mutatePayments(async (all) => {
    const changed = maintainPaymentRecords(all);
    return { save: changed, value: paymentStatusFromRecords(all, userId) };
  });
}
