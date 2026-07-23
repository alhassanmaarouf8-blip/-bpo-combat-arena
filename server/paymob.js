/**
 * paymob.js — card + wallet checkout via Paymob (Egypt), the rail that lets Egyptian users pay
 * "through all ways": Visa/Mastercard/Meeza cards, mobile wallets (Vodafone Cash, Orange, Etisalat),
 * Fawry, Apple/Google Pay — one hosted Unified Checkout, settled in EGP to the owner's bank, with
 * INSTANT auto-activation (no manual confirmation like the Vodafone-Cash rail).
 *
 *   POST /api/paymob/checkout   { plan, billingPeriod } → { url }  (redirect the browser there)
 *   POST /api/paymob/webhook    Paymob → us on payment result; HMAC-verified; activates the plan
 *
 * Flow (Paymob Intention API): create an intention (Secret Key) → redirect to Unified Checkout with
 * the client_secret + Public Key → Paymob calls the webhook with the transaction; on success we map
 * the special_reference back to {userId, plan} and call activatePlan (idempotent). OFF by default —
 * needs PAYMOB_ENABLED=1 + PAYMOB_SECRET_KEY + PAYMOB_PUBLIC_KEY + PAYMOB_HMAC + PAYMOB_INTEGRATION_IDS.
 */
import express from 'express';
import crypto from 'crypto';
import { requireAuth, getAccountById, activatePlan } from './auth.js';
import { PLANS, offerPrice } from './plans.config.js';
import { dbEnabled, kvGet, kvSet } from './db.js';

const NS = 'paymob';
const INTENTION_URL = process.env.PAYMOB_INTENTION_URL || 'https://accept.paymob.com/v1/intention/';
const CHECKOUT_BASE = process.env.PAYMOB_CHECKOUT_URL || 'https://accept.paymob.com/unifiedcheckout/';

export const paymobEnabled = () =>
  process.env.PAYMOB_ENABLED === '1'
  && !!process.env.PAYMOB_SECRET_KEY && !!process.env.PAYMOB_PUBLIC_KEY
  && !!process.env.PAYMOB_HMAC && !!integrationIds().length;

function integrationIds() {
  return String(process.env.PAYMOB_INTEGRATION_IDS || '')
    .split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isInteger);
}

// ── Amount (same price the Vodafone-Cash rail charges) ──────────────────────────────────────────
export function amountForPlan(plan, billingPeriodIn) {
  if (plan !== 'basic' && plan !== 'elite' || !PLANS[plan]) return null;
  const billingPeriod = PLANS[plan].once ? 'once' : (billingPeriodIn === 'yearly' ? 'yearly' : 'monthly');
  const baseEGP = billingPeriod === 'yearly' ? PLANS[plan].yearlyEGP : PLANS[plan].priceEGP;
  const amountEGP = offerPrice(baseEGP);
  return { plan, billingPeriod, amountEGP, amountCents: Math.round(amountEGP * 100) };
}

// ── HMAC verification (Paymob transaction callback) ─────────────────────────────────────────────
// Paymob signs the callback by concatenating THESE fields of obj IN THIS EXACT ORDER, then
// HMAC-SHA512 with the merchant HMAC secret. Order is fixed by Paymob and must not change.
const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
  'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
  'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
];

const dig = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function computeHmac(obj, secret) {
  const concat = HMAC_FIELDS.map((f) => {
    const v = dig(obj, f);
    return v === undefined || v === null ? '' : String(v);
  }).join('');
  return crypto.createHmac('sha512', secret).update(concat).digest('hex');
}

export function verifyHmac(obj, receivedHmac, secret) {
  if (!receivedHmac || !secret) return false;
  const expected = computeHmac(obj, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(receivedHmac), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Pending map: special_reference → { userId, plan, billingPeriod } ────────────────────────────
const memPending = new Map();
async function savePending(ref, rec) {
  if (dbEnabled()) { await kvSet(NS, ref, rec); return; }
  memPending.set(ref, rec);
}
async function loadPending(ref) {
  if (dbEnabled()) return (await kvGet(NS, ref)) ?? null;
  return memPending.get(ref) ?? null;
}

const newRef = () => `op_${crypto.randomBytes(9).toString('hex')}`;

// ── Router ───────────────────────────────────────────────────────────────────────────────────────
export const paymobRouter = express.Router();

paymobRouter.post('/paymob/checkout', requireAuth, express.json(), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!paymobEnabled()) return res.status(503).json({ error: 'card_unavailable' });
  try {
    const amt = amountForPlan(req.body?.plan, req.body?.billingPeriod);
    if (!amt) return res.status(400).json({ error: 'invalid_plan' });

    const ref = newRef();
    const origin = process.env.APP_URL || `https://${req.headers.host}`;
    const email = req.account.email || 'na@example.com';
    const body = {
      amount: amt.amountCents,
      currency: 'EGP',
      payment_methods: integrationIds(),
      items: [{ name: `${amt.plan} (${amt.billingPeriod})`, amount: amt.amountCents, quantity: 1 }],
      billing_data: {
        first_name: 'NA', last_name: 'NA', email, phone_number: 'NA',
        country: 'EG', city: 'NA', street: 'NA', building: 'NA', floor: 'NA', apartment: 'NA',
      },
      special_reference: ref,
      redirection_url: `${origin}/?paid=card`,
      notification_url: `${origin}/api/paymob/webhook`,
    };

    const r = await fetch(INTENTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${process.env.PAYMOB_SECRET_KEY}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`intention ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    const j = await r.json();
    const clientSecret = j.client_secret;
    if (!clientSecret) throw new Error('no_client_secret');

    await savePending(ref, { userId: req.account.id, plan: amt.plan, billingPeriod: amt.billingPeriod, amountCents: amt.amountCents, createdAt: Date.now() });
    const url = `${CHECKOUT_BASE}?publicKey=${encodeURIComponent(process.env.PAYMOB_PUBLIC_KEY)}&clientSecret=${encodeURIComponent(clientSecret)}`;
    console.log(`[paymob] checkout created  user=${req.account.id}  plan=${amt.plan}/${amt.billingPeriod}  ref=${ref}`);
    return res.json({ url });
  } catch (err) {
    console.error('[paymob] checkout failed:', err.message);
    return res.status(502).json({ error: 'checkout_failed' });
  }
});

// Paymob posts the transaction result here. Public endpoint — trust ONLY the HMAC, never the body alone.
paymobRouter.post('/paymob/webhook', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const obj = req.body?.obj;
    const receivedHmac = req.query?.hmac || req.body?.hmac;
    if (!obj || !verifyHmac(obj, receivedHmac, process.env.PAYMOB_HMAC)) {
      console.warn('[paymob] webhook HMAC rejected');
      return res.status(401).json({ error: 'bad_hmac' });
    }
    // Ack fast; do the work after. Paymob only needs a 2xx.
    res.json({ ok: true });

    if (!obj.success || obj.is_voided || obj.is_refunded || obj.error_occured) {
      console.log(`[paymob] webhook non-success txn=${obj.id} success=${obj.success}`);
      return;
    }
    const ref = obj.order?.merchant_order_id || obj.payment_key_claims?.extra?.ref || null;
    const pending = ref ? await loadPending(ref) : null;
    if (!pending) { console.warn(`[paymob] webhook: no pending for ref=${ref} txn=${obj.id}`); return; }
    const acc = await getAccountById(pending.userId);
    if (!acc) { console.warn(`[paymob] webhook: no account ${pending.userId}`); return; }
    // Idempotent: activatePlan skips a repeated paymentId, so duplicate webhooks are safe.
    await activatePlan(acc, pending.plan, pending.billingPeriod, `paymob:${obj.id}`);
    pending.status = 'activated'; pending.txnId = obj.id; pending.activatedAt = Date.now();
    await savePending(ref, pending);
    console.log(`[paymob] PLAN ACTIVATED  user=${pending.userId}  plan=${pending.plan}/${pending.billingPeriod}  txn=${obj.id}`);
  } catch (err) {
    console.error('[paymob] webhook error:', err.message);
    // Response already sent; nothing else to do.
  }
});

export default { paymobRouter, paymobEnabled, amountForPlan, computeHmac, verifyHmac };
