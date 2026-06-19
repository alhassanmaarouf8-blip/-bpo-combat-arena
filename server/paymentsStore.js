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

// Reference code the user writes in the Vodafone transfer note (last 6 of the userId).
export function refCodeFor(userId) { return String(userId || '').slice(-6).toUpperCase(); }

// Hard-delete ALL payment records for one user (admin account deletion). Returns how many
// were removed. Only rewrites the store if something actually matched.
export async function deletePaymentsFor(userId) {
  const all  = await loadPayments();
  const kept = all.filter((p) => p.userId !== userId);
  if (kept.length !== all.length) await savePayments(kept);
  return all.length - kept.length;
}

// The user's current pending payment (if any), and whether their most recent one was rejected.
export async function paymentStatusFor(userId) {
  const all  = await loadPayments();
  const mine = all.filter((p) => p.userId === userId);
  const pending = mine.find((p) => p.status === 'pending') || null;
  const lastRejected = !pending && mine.length > 0 && mine[mine.length - 1].status === 'rejected';
  return { pending, lastRejected };
}
