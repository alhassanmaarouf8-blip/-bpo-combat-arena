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
import { requireAuth } from './auth.js';
import { PLANS, offerPrice } from './plans.config.js';
import { loadPayments, savePayments, refCodeFor } from './paymentsStore.js';

export const paymentsRouter = express.Router();

// ── POST /billing/pay : record a PENDING payment. Grants NO access. ──
paymentsRouter.post('/billing/pay', requireAuth, async (req, res) => {
  try {
    const acc  = req.account;
    const plan = req.body?.plan;
    const billingPeriod = req.body?.billingPeriod === 'yearly' ? 'yearly' : 'monthly';
    if (plan !== 'basic' && plan !== 'elite') return res.status(400).json({ error: 'invalid_plan' });

    // Amount is derived SERVER-side from the config — never trust a client-sent price. The
    // limited-time launch offer (plans.config.OFFER) is applied HERE so the payable amount and
    // the advertised price share one source of truth. offerPrice() returns the full price once
    // the 3-day window closes, so this needs no follow-up to end.
    const baseEGP      = billingPeriod === 'yearly' ? PLANS[plan].yearlyEGP : PLANS[plan].priceEGP;
    const amountEGP    = offerPrice(baseEGP);
    const offerApplied = amountEGP < baseEGP;
    const referenceCode = refCodeFor(acc.id);

    const all = await loadPayments();
    // One pending per user: drop any earlier still-pending request, keep history of the rest.
    const kept = all.filter((p) => !(p.userId === acc.id && p.status === 'pending'));
    const rec = {
      id: 'pay_' + randomBytes(6).toString('hex'),
      userId: acc.id, email: acc.email || null,
      plan, billingPeriod, amountEGP, baseEGP, offerApplied, referenceCode,
      status: 'pending', createdAt: Date.now(),
    };
    kept.push(rec);
    await savePayments(kept);

    console.log(`[payments] PENDING  user=${acc.id}  email=${acc.email ?? '—'}  plan=${plan}  period=${billingPeriod}  amount=${amountEGP}EGP${offerApplied ? ` (50% off ${baseEGP})` : ''}  ref=${referenceCode}`);
    res.json({ ok: true, referenceCode, amountEGP, baseEGP, offerApplied, plan, billingPeriod }); // NO access granted here
  } catch (err) {
    console.error('[payments] pay error:', err.message);
    res.status(500).json({ error: 'pay_failed' });
  }
});
