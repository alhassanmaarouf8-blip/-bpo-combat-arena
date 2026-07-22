/**
 * callfloor/marginEngine.js — Phase 6. Computes gross margin per plan from cost inputs and sizes
 * allowances/prices to a target margin. PURE functions (costs injected) so the math is unit-pinned;
 * the report script feeds it REAL numbers (measured call costs from ai_usage_events + the measured
 * interview/analysis constants). It NEVER changes live prices — it only recommends, behind the
 * owner's sign-off (Phase 6 spec).
 *
 * Definitions (exact): gross_margin = (revenue − cogs) / revenue. TARGET ≥ 0.80 ⇒ cogs ≤ 0.20·rev.
 * revenue = gross plan price in USD (EGP→USD). cogs_per_user_month = voice + analysis + payment fee
 * (per-user infra is ~0 marginal on the current stack; fixed costs are reported separately).
 */

import { egpToUsd, PAYMENT_FEE } from './margin.config.js';

export const TARGET_MARGIN = 0.80;

/**
 * costs = {
 *   voiceMinUsd,          // blended $ per voice minute (LIST — the honest cost structure)
 *   analysisPerSessionUsd,// $ per interview/call post-analysis (deep-diagnosis + judge)
 *   infraPerUserUsd = 0,  // marginal per-user infra (≈0 on Render+Neon; fixed costs listed apart)
 * }
 * usage = { voiceMinPerMonth, sessionsPerMonth }  — a modeled consumption profile.
 */
export function paymentFeeUsd(grossRevenueUsd) {
  if (grossRevenueUsd <= 0) return 0;
  return grossRevenueUsd * PAYMENT_FEE.pct + PAYMENT_FEE.fixedUsd;
}

export function cogsPerUserMonth({ voiceMinPerMonth, sessionsPerMonth }, costs, grossRevenueUsd) {
  const voice = (voiceMinPerMonth || 0) * costs.voiceMinUsd;
  const analysis = (sessionsPerMonth || 0) * costs.analysisPerSessionUsd;
  const infra = costs.infraPerUserUsd || 0;
  const fee = paymentFeeUsd(grossRevenueUsd);
  return { voice, analysis, infra, fee, total: voice + analysis + infra + fee };
}

export function marginFor(priceEgp, usage, costs) {
  const revenue = egpToUsd(priceEgp);
  const cogs = cogsPerUserMonth(usage, costs, revenue);
  const margin = revenue > 0 ? (revenue - cogs.total) / revenue : null;
  return { revenue, cogs, margin };
}

/**
 * The affordable-allowance formula: the MAX voice minutes/month a plan can include and still hold
 * the target margin at 100% usage. Non-voice COGS (analysis + fee + infra) is subtracted first.
 * Returns minutes/month (>=0); null if the plan can't even cover its non-voice COGS at the target.
 */
export function affordableVoiceMinutes(priceEgp, sessionsPerMonth, costs, target = TARGET_MARGIN) {
  const revenue = egpToUsd(priceEgp);
  if (revenue <= 0) return 0;
  const nonVoice = (sessionsPerMonth || 0) * costs.analysisPerSessionUsd + (costs.infraPerUserUsd || 0) + paymentFeeUsd(revenue);
  const voiceBudget = (1 - target) * revenue - nonVoice;
  if (voiceBudget <= 0) return null;                       // price too low to hit target even with 0 voice
  return voiceBudget / costs.voiceMinUsd;
}

/** The price (EGP) needed to hold the target margin at a given monthly consumption. */
export function priceForTarget(usage, costs, target = TARGET_MARGIN, egpPerUsd = null) {
  // revenue·(1−target) ≥ voice+analysis+infra ; fee is pct·rev+fixed → solve for rev.
  const voice = (usage.voiceMinPerMonth || 0) * costs.voiceMinUsd;
  const analysis = (usage.sessionsPerMonth || 0) * costs.analysisPerSessionUsd;
  const infra = costs.infraPerUserUsd || 0;
  // (1−t)·rev = voice+analysis+infra + (pct·rev + fixed)  ⇒ rev·(1−t−pct) = base+fixed
  const base = voice + analysis + infra + PAYMENT_FEE.fixedUsd;
  const denom = (1 - target) - PAYMENT_FEE.pct;
  if (denom <= 0) return null;                             // fee alone breaks the target
  const revUsd = base / denom;
  const rate = egpPerUsd || (1 / (egpToUsd(1) || 1));      // invert egpToUsd(1) → EGP per USD
  return revUsd * rate;
}

export default { TARGET_MARGIN, paymentFeeUsd, cogsPerUserMonth, marginFor, affordableVoiceMinutes, priceForTarget };
