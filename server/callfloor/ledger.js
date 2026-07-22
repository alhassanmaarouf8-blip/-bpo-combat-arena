/**
 * callfloor/ledger.js — the per-user cost ledger: month-to-date AI cost (from ai_usage_events) vs
 * plan revenue → live gross margin, per user and per plan. READ-only over Mode 2 telemetry + the
 * plan config. This is the machinery Phase 6's margin engine reads; it does no pricing itself.
 *
 * Cost is reported at BOTH levels (usd_list = the honest cost structure Phase 6 uses; usd_actual =
 * what we pay today on free tiers). Revenue is the plan's monthly EGP price converted to USD, net
 * of the payment fee (margin.config).
 */

import { readUsageEvents } from './usage.js';
import { PLANS } from '../plans.config.js';
import { planOf } from '../auth.js';
import { netRevenueUsd, grossMargin } from './margin.config.js';

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Sum a user's AI cost for the current UTC month → { list, actual, events }. */
export async function userCostMonthUsd(userId, now = 0) {
  if (!now) return { list: 0, actual: 0, events: 0 };   // now MUST be passed (Date.now() forbidden in some contexts)
  const ym = monthKey(now);
  const rows = await readUsageEvents({ userId });
  let list = 0, actual = 0, events = 0;
  for (const e of rows) {
    if (monthKey(new Date(e.ts).getTime()) !== ym) continue;
    list += Number(e.usdList) || 0; actual += Number(e.usdActual) || 0; events += 1;
  }
  return { list: round4(list), actual: round4(actual), events };
}

const round4 = (v) => Math.round((Number(v) || 0) * 1e4) / 1e4;

/** One user's live ledger row: plan, revenue, month-to-date cost, and gross margin (list + actual). */
export async function userLedger(account, now = 0) {
  const planId = planOf(account, now || undefined);
  const priceEgp = Number(PLANS[planId]?.priceEGP) || 0;   // free → 0 revenue
  const revenueUsd = round4(netRevenueUsd(priceEgp));
  const cost = await userCostMonthUsd(account.id, now);
  return {
    userId: account.id, planId, priceEgp, revenueUsd,
    costUsdList: cost.list, costUsdActual: cost.actual, events: cost.events,
    marginList: revenueUsd > 0 ? round4(grossMargin(revenueUsd, cost.list)) : null,
    marginActual: revenueUsd > 0 ? round4(grossMargin(revenueUsd, cost.actual)) : null,
  };
}

/** Aggregate ledger across a set of accounts → per-plan roll-up (admin view). */
export async function planLedger(accounts, now = 0) {
  const perUser = [];
  for (const a of accounts) perUser.push(await userLedger(a, now));
  const plans = {};
  for (const row of perUser) {
    const p = (plans[row.planId] ||= { planId: row.planId, users: 0, revenueUsd: 0, costUsdList: 0, costUsdActual: 0 });
    p.users += 1; p.revenueUsd = round4(p.revenueUsd + row.revenueUsd);
    p.costUsdList = round4(p.costUsdList + row.costUsdList); p.costUsdActual = round4(p.costUsdActual + row.costUsdActual);
  }
  for (const p of Object.values(plans)) {
    p.marginList = p.revenueUsd > 0 ? round4(grossMargin(p.revenueUsd, p.costUsdList)) : null;
    p.marginActual = p.revenueUsd > 0 ? round4(grossMargin(p.revenueUsd, p.costUsdActual)) : null;
  }
  return { perUser, perPlan: Object.values(plans) };
}

export default { userCostMonthUsd, userLedger, planLedger };
