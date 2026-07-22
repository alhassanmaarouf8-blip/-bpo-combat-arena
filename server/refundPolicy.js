/**
 * refundPolicy.js — usage-gated refund (owner 2026-07-22). Closes the refund-abuse hole: a user
 * could pay, burn expensive voice minutes inside the 14-day window, then demand a refund. Policy:
 * a full refund is offered ONLY if the plan is still in its window AND the learner has used at most
 * a couple of interviews ("not satisfied, barely tried"). Heavy use forfeits the refund.
 *
 * Enforcement is MANUAL — the owner approves every Vodafone Cash refund himself — so this is a pure
 * DECISION helper (the admin endpoint calls it). It never moves money; it tells the owner, per his
 * own policy, whether a given account qualifies. The free trial already lets honest users test
 * risk-free, so this refund can be strict.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const REFUND_WINDOW_DAYS = 14;   // money-back window from plan activation (planSetAt)
export const REFUND_MAX_INTERVIEWS = 2; // "barely used" ceiling — beyond this, no refund

/**
 * refundEligibility({ planSetAt, sessions, now, windowDays, maxInterviews }) →
 *   { hasPayment, daysSincePayment, withinWindow, interviewsUsed, eligible, reason, windowDays, maxInterviews }
 * `sessions` = the profile's interview sessions ([{ date:<ms>, … }]); interviews since activation count.
 */
export function refundEligibility({ planSetAt, sessions = [], now = Date.now(),
  windowDays = REFUND_WINDOW_DAYS, maxInterviews = REFUND_MAX_INTERVIEWS } = {}) {
  const setAt = Number(planSetAt) || 0;
  if (!setAt) {
    return { hasPayment: false, eligible: false, reason: 'no_paid_activation',
      windowDays, maxInterviews };
  }
  const daysSincePayment = Math.max(0, (now - setAt) / DAY_MS);
  const withinWindow = daysSincePayment <= windowDays;
  const interviewsUsed = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && Number(s.date) >= setAt && Number(s.date) <= now).length;
  const eligible = withinWindow && interviewsUsed <= maxInterviews;
  return {
    hasPayment: true,
    daysSincePayment: Math.round(daysSincePayment * 10) / 10,
    withinWindow,
    interviewsUsed,
    windowDays,
    maxInterviews,
    eligible,
    reason: eligible ? 'eligible'
      : !withinWindow ? 'past_window'
      : 'used_too_many_interviews',
  };
}

export default { REFUND_WINDOW_DAYS, REFUND_MAX_INTERVIEWS, refundEligibility };
