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
import { adminRequestOk } from './adminAuth.js';
import { PLANS, offerPrice } from './plans.config.js';
import { mutatePayments, maintainPaymentRecords, PAYMENT_INTENT_TTL_MS } from './paymentsStore.js';
import { sendOwnerPaymentAlert, mailerConfigured } from './mailer.js';

export const paymentsRouter = express.Router();
export { PAYMENT_INTENT_TTL_MS } from './paymentsStore.js';

export function supportedPaymentRailAvailable() {
  // Only create a durable payment intent for a rail the customer can actually see and use.
  // The buyer UI implements wallet, InstaPay AND bank transfer (owner order 2026-07-25: "give my
  // students as much variety as possible to pay") — any configured destination opens payment.
  return !!String(process.env.VODAFONE_CASH_NUMBER || '').trim()
    || !!String(process.env.INSTAPAY_ADDRESS || '').trim()
    || !!String(process.env.BANK_ACCOUNT_INFO || '').trim();
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

export function applyPaymentConfirmation(all, { userId, intentId, senderLast4, rail, now = Date.now() }) {
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
  // Which rail the buyer says they used — tells the owner WHERE to look for the incoming
  // transfer (Vodafone Cash app vs bank/InstaPay). Whitelisted; verification stays manual.
  if (rail === 'instapay' || rail === 'vodafone' || rail === 'bank') found.rail ||= rail;
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
        rail: req.body?.rail === 'instapay' ? 'instapay' : 'vodafone',
      });
      return { save: maintained || (next.kind !== 'not_found' && next.kind !== 'conflict'
        && next.kind !== 'under_review'), value: next };
    });
    if (result.kind === 'not_found') return res.status(404).json({ error: 'intent_not_found' });
    if (result.kind === 'expired') return res.status(410).json({ error: 'intent_expired' });
    if (result.kind === 'conflict') return res.status(409).json({ error: 'sender_last4_conflict' });
    if (result.kind === 'under_review') return res.status(409).json({ error: 'payment_under_review' });
    const rec = result.record;
    console.log(`[payments] pending confirmed id=${rec.id} user=${acc.id} rail=${rec.rail || '-'}`);
    // Alert the owner NOW. The buyer's screen promises activation in minutes, and that promise is
    // only honest if he is told the moment it happens. Fire-and-forget: a mail failure must never
    // turn a real payment into an error for the person who just sent money.
    if (mailerConfigured() && process.env.ADMIN_EMAIL) {
      sendOwnerPaymentAlert(process.env.ADMIN_EMAIL, {
        referenceCode: rec.referenceCode, amountEGP: rec.amountEGP, plan: rec.plan,
        billingPeriod: rec.billingPeriod, rail: rec.rail, senderLast4: rec.senderLast4,
        email: rec.email, adminUrl: `${process.env.APP_URL ? '' : ''}${(process.env.BACKEND_URL || '').replace(/\/$/, '')}/admin`,
      }).catch((err) => console.warn('[payments] owner alert failed:', err.message));
    }
    return res.json({ ok: true, referenceCode: rec.referenceCode, amountEGP: rec.amountEGP,
      baseEGP: rec.baseEGP, offerApplied: rec.offerApplied, plan: rec.plan, billingPeriod: rec.billingPeriod });
  } catch (err) {
    console.error('[payments] pay error:', err.message);
    res.status(500).json({ error: 'pay_failed' });
  }
});

// ── GET /api/diag/payments — "can anyone actually pay me right now?" in one curl ──────────────
// Owner, 2026-07-25: "I tried to check whether it's set on production, but the billing endpoint
// sits behind email verification, so I can't see it from here." That is a real gap: whether the
// money rails are live was only observable by logging in as a verified user and walking to the
// paywall. Revenue-critical config must be checkable without an account.
//
// ADMIN-GATED and BOOLEAN-ONLY. It reports whether each destination is configured — never the
// wallet number, IBAN or admin address themselves. A leaked read of this tells an attacker
// nothing except that the owner accepts money, which is already on the public paywall.
paymentsRouter.get('/diag/payments', (req, res) => {
  if (!adminRequestOk(req)) return res.status(403).json({ error: 'forbidden' });
  const set = (v) => !!String(v || '').trim();
  const vodafone = set(process.env.VODAFONE_CASH_NUMBER);
  const instapay = set(process.env.INSTAPAY_ADDRESS) || vodafone;   // InstaPay inherits the wallet number
  const bank     = set(process.env.BANK_ACCOUNT_INFO);
  const payable  = supportedPaymentRailAvailable();
  const alerts   = mailerConfigured() && set(process.env.ADMIN_EMAIL);
  res.json({
    payable,                       // false => the paywall shows nothing and NOBODY can pay
    rails: { vodafone, instapay, bank },
    ownerAlertOnPayment: alerts,   // false => a payment lands silently; you find it by looking
    // Say what to do rather than making the reader map booleans back onto env var names.
    todo: [
      !payable && 'Set VODAFONE_CASH_NUMBER on Render — this alone opens BOTH the wallet and InstaPay rails.',
      payable && !alerts && (mailerConfigured()
        ? 'Set ADMIN_EMAIL on Render so a payment e-mails you the moment it is claimed.'
        : 'Set SMTP_USER + SMTP_PASS (or BREVO_API_KEY) so payment alerts can send at all.'),
    ].filter(Boolean),
  });
});
