/**
 * callfloor/entitlements.js — Mode 2 reads the user's plan (READ-only) to decide their Call Floor
 * allowance: metered daily voice minutes, which seats are unlocked, and free-talk access.
 *
 * The single source of truth for plans stays server/plans.config.js (owner decision 2026-07-21:
 * Call Floor EXTENDS Basic/Elite, no parallel plan system). A trial mirrors Elite, exactly like
 * the interview meter (auth.dailyMinutesFor). Fail-closed: an unknown/lapsed plan → zero minutes,
 * no seats — voice never runs un-entitled.
 */

import { PLANS, callFloorFor, CALLFLOOR_OVERAGE_BLOCK_MIN } from '../plans.config.js';
import { planOf, trialActive } from '../auth.js';

/** The resolved Call Floor entitlement for an account. */
export function callFloorEntitlement(account) {
  const planId = trialActive(account) ? 'elite' : planOf(account);
  const cf = callFloorFor(planId);
  return {
    planId,
    dailyCallSeconds: Math.max(0, Math.round((cf.dailyCallMinutes || 0) * 60)),
    dailyCallMinutes: cf.dailyCallMinutes || 0,
    quadrants: Array.isArray(cf.quadrants) ? cf.quadrants : [],
    freeTalk: !!cf.freeTalk,
    overageEgpPerBlock: cf.overageEgpPerBlock || 0,
    overageBlockMin: CALLFLOOR_OVERAGE_BLOCK_MIN,
  };
}

export function quadrantAllowed(account, quadrant) {
  return callFloorEntitlement(account).quadrants.includes(String(quadrant || ''));
}

/** The lowest plan that unlocks a given quadrant — for an honest "ab Elite" upsell message. */
export function requiredPlanForQuadrant(quadrant) {
  for (const id of ['free', 'basic', 'elite']) {
    if ((callFloorFor(id).quadrants || []).includes(quadrant)) return id;
  }
  return 'elite';
}

/** Human upsell hint (label only; the client renders copy). */
export function upsellFor(planId) {
  const next = planId === 'free' ? 'basic' : 'elite';
  return { nextPlan: next, nextLabel: PLANS[next]?.label || next };
}

export default { callFloorEntitlement, quadrantAllowed, requiredPlanForQuadrant, upsellFor };
