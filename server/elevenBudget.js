/**
 * elevenBudget.js — per-user DAILY quota for the ElevenLabs Conversational AI voice.
 *
 * ⚠ NOT WIRED YET (Phase 1). Pure logic + self-test so the pricing decision is captured in code now.
 *
 * Owner pricing decision (2026-07-11):
 *   - FREE TRIAL:   7 minutes, ONE TIME (acquisition; ~$0.56 cost).
 *   - TÄGLICH   (2500 EGP / mo): 15 min PER DAY, resets every day.
 *   - INTENSIV  (4500 EGP / mo): 30 min PER DAY, resets every day.
 *   Engine cost target: ElevenLabs Business-annual ≈ $0.08/min (LLM = own cheap Groq key, separate).
 *
 * Design principles:
 *   - DAILY ACCESS is the product — the quota RESETS every day; a user is never "locked out for the
 *     month". This is the owner's hard requirement (daily habit = retention = getting hired).
 *   - A SILENT monthly abuse ceiling (≈25 maxed days' worth) protects margin from bots/account-farming
 *     WITHOUT real users ever seeing it (nobody uses the full daily quota all 30 days).
 *   - When the DAILY quota is spent, the caller should SOFT-STOP (offer the $0 practice path or "come
 *     back tomorrow") — never a hard paywall that kills the habit.
 *
 * Time keys are passed IN (Cairo-local day/month strings) so this stays pure/deterministic — the caller
 * computes them (Date.now() is intentionally not read here).
 */

export const PLANS = {
  trial:    { label: 'Kostenlose Probe', dailySec: 0,       trialSec: 7 * 60,  monthlyCapSec: 0 },
  taeglich: { label: 'Täglich',          dailySec: 15 * 60, trialSec: 0,       monthlyCapSec: 15 * 60 * 25 },
  intensiv: { label: 'Intensiv',         dailySec: 30 * 60, trialSec: 0,       monthlyCapSec: 30 * 60 * 25 },
};

/** Fresh usage record for a user. */
export function newUsage() {
  return { dayKey: '', daySec: 0, monthKey: '', monthSec: 0, trialSec: 0 };
}

/**
 * Roll the usage record forward to the current day/month (resets the day/month counters when they turn
 * over). Returns a NEW object; never mutates the input.
 */
export function rollUsage(usage, dayKey, monthKey) {
  const u = { ...(usage || newUsage()) };
  if (u.dayKey !== dayKey)     { u.dayKey = dayKey;     u.daySec = 0; }
  if (u.monthKey !== monthKey) { u.monthKey = monthKey; u.monthSec = 0; }
  return u;
}

/**
 * Can this user START a voice fight right now?
 * @returns {{ allowed:boolean, reason:string, remainingSec:number, plan:string }}
 *   reason ∈ 'ok' | 'trial_used' | 'daily_spent' | 'abuse_cap' | 'unknown_plan'
 */
export function voiceGate(usage, planId, dayKey, monthKey) {
  const plan = PLANS[planId];
  if (!plan) return { allowed: false, reason: 'unknown_plan', remainingSec: 0, plan: planId };
  const u = rollUsage(usage, dayKey, monthKey);

  // Free trial: a one-time pool, no daily reset.
  if (planId === 'trial') {
    const remaining = Math.max(0, plan.trialSec - (u.trialSec || 0));
    return { allowed: remaining > 0, reason: remaining > 0 ? 'ok' : 'trial_used', remainingSec: remaining, plan: planId };
  }

  // Paid: silent monthly abuse ceiling first (bots/farming only), then the DAILY quota.
  if (plan.monthlyCapSec && u.monthSec >= plan.monthlyCapSec) {
    return { allowed: false, reason: 'abuse_cap', remainingSec: 0, plan: planId };
  }
  const remainingDay = Math.max(0, plan.dailySec - u.daySec);
  return { allowed: remainingDay > 0, reason: remainingDay > 0 ? 'ok' : 'daily_spent', remainingSec: remainingDay, plan: planId };
}

/**
 * Record `addSec` of voice usage. Returns a NEW usage record (roll-forward applied).
 */
export function applyUsage(usage, planId, dayKey, monthKey, addSec) {
  const u = rollUsage(usage, dayKey, monthKey);
  const sec = Math.max(0, Math.round(addSec || 0));
  if (planId === 'trial') { u.trialSec = (u.trialSec || 0) + sec; return u; }
  u.daySec += sec;
  u.monthSec += sec;
  return u;
}

/** Cairo-local day/month keys for a given epoch ms (caller passes Date.now()). UTC+2, no DST since 2015→2023; 2023+ DST — caller may pass a tz-correct ms. */
export function cairoKeys(nowMs) {
  const d = new Date(nowMs + 2 * 3600 * 1000);   // shift to UTC+2 then read UTC fields
  const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), day = String(d.getUTCDate()).padStart(2, '0');
  return { dayKey: `${y}-${m}-${day}`, monthKey: `${y}-${m}` };
}

export default { PLANS, newUsage, rollUsage, voiceGate, applyUsage, cairoKeys };
