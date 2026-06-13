/**
 * plans.config.js — THE single source of truth for plan names, prices, and limits.
 *
 * Change numbers HERE only. No other file may hard-code a price, a plan name, or a limit.
 * Prices are in Egyptian Pounds (EGP). `yearlyEGP` is the discounted annual price (a round
 * number, not a computed percentage). Used by the pricing page, payment flow, and gating.
 */
// Plans differ ONLY in daily live-interview minutes (reset midnight Africa/Cairo). Both paid
// plans allow daily use; Elite gets more minutes + the full Trainingslager.
export const PLANS = {
  free: {
    id:               'free',
    label:            'Gratis',
    assessments:      1,     // free intelligent assessment, once per account ever
    dailyLiveMinutes: 0,     // NO live fight (assessment only) — a live fight costs real money
  },
  basic: {
    id:               'basic',
    label:            'Basic',
    priceEGP:         1299,
    yearlyEGP:        12990,
    dailyLiveMinutes: 7,     // up to 7 min live interview every day
  },
  elite: {
    id:                    'elite',
    label:                 'Elite',
    priceEGP:              2999,
    yearlyEGP:             29990,
    dailyLiveMinutes:      15,   // up to 15 min live interview every day
    trainingslagerUnlocked: true, // full Trainingslager lessons unlocked
  },
};

// Convenience accessors (kept in ONE place).
export const FREE_ASSESSMENTS = PLANS.free.assessments;
export const PLAN_IDS = Object.keys(PLANS); // ['free','basic','elite']
