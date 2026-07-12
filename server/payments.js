/**
 * payments.js — manual Vodafone Cash payments (verify-first; NO instant access).
 *
 * A user taps "I paid" → we store a PENDING record and grant NOTHING. The owner verifies the
 * money arrived (matched by the reference code) and ACTIVATES the plan from the admin panel.
 *
 * Durable like accounts: stored in Postgres via the kv_store seam when DATABASE_URL is set
 * (production). Local dev with no DB falls back to memory (NOT a JSON file).
 *
 *   POST /api/billing/pay   (auth)  → create a pending record, return the reference code
 *   (admin list/activate/reject live in admin.js, behind ADMIN_KEY)
 */
import express from 'express';
import { randomBytes } from 'crypto';
import { requireAuth, rateLimit } from './auth.js';
import { PLANS, offerPrice } from './plans.config.js';
import { mutatePayments, maintainPaymentRecords, PAYMENT_INTENT_TTL_MS } from './paymentsStore.js';

export const paymentsRouter = express.Router();
export { PAYMENT_INTENT_TTL_MS } from './paymentsStore.js';

export function supportedPaymentRailAvailable() {
  // The current buyer UI implements Vodafone Cash only. Do not create a durable payment intent
  // for a rail the customer cannot actually see or use.
  return !!String(process.env.VODAFONE_CASH_NUMBER || '').trim();
}

function paymentShape(acc, body = {}) {
  const plan = body.plan;
  if (plan !== 'basic' && plan !== 'elite') return null;
  const billingPeriod = PLANS[plan].once ? 'once' : (body.billingPeriod === 'yearly' ? 'yearly' : 'monthly');
  const baseEGP = billingPeriod === 'yearly' ? PLANS[plan].yearlyEGP : PLANS[plan].priceEGP;
  const amountEGP = offerPrice(baseEGP);
  return { plan, billingPeriod, baseEGP, amountEGP, offerApplied: amountEGP < baseEGP, userId: acc.id };
}

function uniqueReference(all) {
  for (let i = 0; i < 8; i++) {
    const code = `OP${randomBytes(4).toString('hex').toUpperCase()}`;
    if (!all.some((p) => p.referenceCode === code)) return code;
  }
  throw new Error('reference_generation_failed');
}

export function applyPaymentConfirmation(all, { userId, intentId, senderLast4, now = Date.now() }) {
  const found = all.find((p) => p.id === intentId && p.userId === userId);
  if (!found) return { kind: 'not_found', record: null };
  if (found.status === 'expired') return { kind: 'expired', record: found };
  if (found.status !== 'intent' && found.status !== 'pending') return { kind: 'not_found', record: null };
  const otherUnderReview = all.find((p) => p.userId === userId && p.id !== found.id
    && (p.status === 'pending' || p.status === 'activating'));
  if (otherUnderReview) return { kind: 'under_review', record: otherUnderReview };
  if (found.status === 'intent' && found.createdAt < now - PAYMENT_INTENT_TTL_MS) {
    found.status = 'expired';
    found.expiredAt = now;
    return { kind: 'expired', record: found };
  }
  if (found.status === 'pending' && found.senderLast4 && found.senderLast4 !== senderLast4) {
    return { kind: 'conflict', record: found };
  }
  found.status = 'pending';
  found.confirmedAt ||= now;
  found.senderLast4 ||= senderLast4;
  return { kind: 'ok', record: found };
}

// Create the server-side payment record BEFORE showing transfer instructions. If the
// user's final confirmation request later fails, the owner still has a traceable intent.
paymentsRouter.post('/billing/intent', requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 120, tag: 'payment-intent-ip' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 6, tag: 'payment-intent-account',
              keyExtra: (req) => req.account.id, accountOnly: true }), async (req, res) => {
  try {
    if (!supportedPaymentRailAvailable()) return res.status(503).json({ error: 'payment_unavailable' });
    const shape = paymentShape(req.account, req.body || {});
    if (!shape) return res.status(400).json({ error: 'invalid_plan' });
    const key = String(req.headers['idempotency-key'] || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    if (!key) return res.status(400).json({ error: 'missing_idempotency_key' });
    const decision = await mutatePayments(async (all) => {
      const maintained = maintainPaymentRecords(all);
      const underReview = [...all].reverse().find((p) => p.userId === req.account.id
        && (p.status === 'pending' || p.status === 'activating'));
      if (underReview) return { save: maintained, value: { kind: 'under_review', record: underReview } };
      const existing = [...all].reverse().find((p) => p.userId === req.account.id && p.idempotencyKey === key
        && p.status !== 'cancelled' && p.status !== 'expired');
      if (existing) return { save: maintained, value: { kind: 'ok', record: existing } };
      const active = [...all].reverse().find((p) => p.userId === req.account.id && p.status === 'intent'
        && p.createdAt >= Date.now() - PAYMENT_INTENT_TTL_MS);
      if (active && active.plan === shape.plan && active.billingPeriod === shape.billingPeriod) {
        return { save: maintained, value: { kind: 'ok', record: active } };
      }
      for (const old of all) if (old.userId === req.account.id && old.status === 'intent') {
        old.status = 'cancelled'; old.cancelledAt = Date.now();
      }
      const created = {
        id: 'pay_' + randomBytes(8).toString('hex'), idempotencyKey: key,
        ...shape, email: req.account.email || null, referenceCode: uniqueReference(all),
        status: 'intent', createdAt: Date.now(),
      };
      all.push(created);
      return { value: { kind: 'ok', record: created } };
    });
    if (decision.kind === 'under_review') return res.status(409).json({
      error: 'payment_under_review', referenceCode: decision.record.referenceCode || null,
    });
    const rec = decision.record;
    console.log(`[payments] intent created id=${rec.id} user=${req.account.id} plan=${rec.plan}`);
    res.json({ ok: true, intentId: rec.id, referenceCode: rec.referenceCode, amountEGP: rec.amountEGP,
      baseEGP: rec.baseEGP, offerApplied: rec.offerApplied, plan: rec.plan, billingPeriod: rec.billingPeriod });
  } catch (err) {
    console.error('[payments] intent error:', err.message);
    res.status(500).json({ error: 'intent_failed' });
  }
});

// ── POST /billing/pay : record a PENDING payment. Grants NO access. ──
paymentsRouter.post('/billing/pay', requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 120, tag: 'payment-confirm-ip' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 6, tag: 'payment-confirm-account',
              keyExtra: (req) => req.account.id, accountOnly: true }), async (req, res) => {
  try {
    const acc  = req.account;
    if (!req.body?.intentId) return res.status(400).json({ error: 'intent_required' });
    const senderLast4 = String(req.body?.senderLast4 || '').replace(/\D/g, '');
    if (!/^\d{4}$/.test(senderLast4)) return res.status(400).json({ error: 'sender_last4_required' });
    const result = await mutatePayments(async (all) => {
      const maintained = maintainPaymentRecords(all);
      const next = applyPaymentConfirmation(all, {
        userId: acc.id, intentId: req.body.intentId, senderLast4,
      });
      return { save: maintained || (next.kind !== 'not_found' && next.kind !== 'conflict'
        && next.kind !== 'under_review'), value: next };
    });
    if (result.kind === 'not_found') return res.status(404).json({ error: 'intent_not_found' });
    if (result.kind === 'expired') return res.status(410).json({ error: 'intent_expired' });
    if (result.kind === 'conflict') return res.status(409).json({ error: 'sender_last4_conflict' });
    if (result.kind === 'under_review') return res.status(409).json({ error: 'payment_under_review' });
    const rec = result.record;
    console.log(`[payments] pending confirmed id=${rec.id} user=${acc.id}`);
    return res.json({ ok: true, referenceCode: rec.referenceCode, amountEGP: rec.amountEGP,
      baseEGP: rec.baseEGP, offerApplied: rec.offerApplied, plan: rec.plan, billingPeriod: rec.billingPeriod });
  } catch (err) {
    console.error('[payments] pay error:', err.message);
    res.status(500).json({ error: 'pay_failed' });
  }
});
