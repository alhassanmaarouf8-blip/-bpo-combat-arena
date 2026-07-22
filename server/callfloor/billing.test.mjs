/**
 * billing.test.mjs — Phase 4 machinery: plan→Call-Floor entitlement (seats + metered minutes,
 * trial mirrors Elite, fail-closed), the margin config (EGP→USD, net revenue after fee, gross
 * margin), and the per-user cost ledger (month-to-date cost vs plan revenue → live margin).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

delete process.env.DATABASE_URL;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'cf-bill-'));
process.env.CALLFLOOR_USAGE_FILE = path.join(tmp, 'usage.jsonl');
test.after(async () => { await rm(tmp, { recursive: true, force: true }); });

const { callFloorEntitlement, quadrantAllowed, requiredPlanForQuadrant } = await import('./entitlements.js');
const { callFloorFor } = await import('../plans.config.js');
const { egpToUsd, netRevenueUsd, grossMargin, EGP_PER_USD, PAYMENT_FEE } = await import('./margin.config.js');
const { recordAiUsage } = await import('./usage.js');
const { userCostMonthUsd, userLedger } = await import('./ledger.js');

const acct = (plan) => (plan ? { id: 'u', subscription: { plan } } : { id: 'u', subscription: {} });

// ── Entitlements ───────────────────────────────────────────────────────────────────────────────
test('entitlement: free gets a taste (2 seats), Basic adds outbound_cs, Elite the full floor', () => {
  const f = callFloorEntitlement(acct(null));
  assert.equal(f.planId, 'free');
  assert.equal(f.dailyCallSeconds, 6 * 60);
  assert.deepEqual(f.quadrants, ['inbound_cs', 'inbound_sales']);
  assert.equal(f.freeTalk, false);

  const b = callFloorEntitlement(acct('basic'));
  assert.equal(b.dailyCallSeconds, 15 * 60);
  assert.ok(b.quadrants.includes('outbound_cs') && !b.quadrants.includes('outbound_sales'));

  const e = callFloorEntitlement(acct('elite'));
  assert.equal(e.dailyCallSeconds, 30 * 60);
  assert.equal(e.quadrants.length, 4);
  assert.equal(e.freeTalk, true);
});

test('entitlement: an active trial mirrors Elite', () => {
  const trial = { id: 'u', subscription: { plan: 'free', trialStartedAt: Date.now() - 1000 } };
  const ent = callFloorEntitlement(trial);
  assert.equal(ent.planId, 'elite');
  assert.equal(ent.quadrants.length, 4);
  assert.equal(ent.freeTalk, true);
});

test('seat gate: outbound_sales is Elite-only; required plan resolves per seat', () => {
  assert.equal(quadrantAllowed(acct(null), 'outbound_sales'), false);
  assert.equal(quadrantAllowed(acct('elite'), 'outbound_sales'), true);
  assert.equal(requiredPlanForQuadrant('inbound_cs'), 'free');
  assert.equal(requiredPlanForQuadrant('outbound_cs'), 'basic');
  assert.equal(requiredPlanForQuadrant('outbound_sales'), 'elite');
});

test('callFloorFor fails closed: unknown plan → zero minutes, no seats', () => {
  const cf = callFloorFor('does-not-exist');
  assert.equal(cf.dailyCallMinutes, 0);
  assert.deepEqual(cf.quadrants, []);
});

// ── Margin config ─────────────────────────────────────────────────────────────────────────────
test('margin: EGP→USD, net revenue after fee, gross margin', () => {
  assert.equal(EGP_PER_USD.rate, 51);
  assert.ok(Math.abs(egpToUsd(51) - 1) < 1e-9);
  const net999 = netRevenueUsd(999);                       // Vodafone Cash: (999/51)*(1−0) − 0
  assert.ok(Math.abs(net999 - ((999 / 51) * (1 - PAYMENT_FEE.pct) - PAYMENT_FEE.fixedUsd)) < 1e-9);
  assert.equal(netRevenueUsd(0), 0);                       // free plan → no revenue
  assert.equal(grossMargin(20, 4), 0.8);
  assert.equal(grossMargin(0, 5), null);                   // no revenue → margin undefined (not −Inf)
});

// ── Cost ledger ───────────────────────────────────────────────────────────────────────────────
test('ledger: month-to-date sums only THIS month; margin computed vs net revenue', async () => {
  const now = Date.now();
  const lastMonth = now - 40 * 24 * 60 * 60 * 1000;
  await recordAiUsage({ userId: 'u', feature: 'callfloor-persona', provider: 'groq', model: 'm',
    unitType: 'tokens', usdList: 0.01, usdActual: 0, measured: true });                 // this month
  await recordAiUsage({ userId: 'u', feature: 'callfloor-stt', provider: 'groq', model: 'm',
    unitType: 'seconds', usdList: 0.02, usdActual: 0, measured: true });                // this month
  await recordAiUsage({ userId: 'u', ts: lastMonth, feature: 'old', provider: 'groq', model: 'm',
    unitType: 'tokens', usdList: 5, usdActual: 5, measured: true });                    // stale → excluded

  const cost = await userCostMonthUsd('u', now);
  assert.ok(Math.abs(cost.list - 0.03) < 1e-9, `list=${cost.list}`);
  assert.equal(cost.actual, 0);
  assert.equal(cost.events, 2);                            // the stale row is not counted

  const led = await userLedger({ id: 'u', subscription: { plan: 'basic' } }, now);
  assert.equal(led.planId, 'basic');
  assert.equal(led.priceEgp, 999);
  assert.ok(led.revenueUsd > 19 && led.revenueUsd < 20);   // 999/51, Vodafone-Cash 0 fee → ~$19.6
  assert.ok(led.marginList > 0.99 && led.marginList <= 1);  // 3¢ cost on ~$19.6 revenue → ~99.8%
  assert.equal(led.marginActual, 1);                        // $0 actual cost today → 100%

  const free = await userLedger({ id: 'u', subscription: {} }, now);
  assert.equal(free.revenueUsd, 0);
  assert.equal(free.marginList, null);                      // free plan → no revenue → margin null
});
