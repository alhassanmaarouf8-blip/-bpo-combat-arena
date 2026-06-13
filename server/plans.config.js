/**
 * plans.config.js — THE single source of truth for plan names, prices, and limits.
 *
 * Change numbers HERE only. No other file may hard-code a price, a plan name, or a limit.
 * Prices are in Egyptian Pounds (EGP). `yearlyEGP` is the discounted annual price (a round
 * number, not a computed percentage). Used by the pricing page, payment flow, and gating.
 */
export const PLANS = {
  free: {
    id:          'free',
    label:       'Gratis',
    assessments: 1,          // free intelligent assessment, once per account ever
  },
  kaempfer: {
    id:             'kaempfer',
    label:          'Kämpfer',
    priceEGP:       1499,
    yearlyEGP:      14990,
    fightsPerMonth: 12,
  },
  elite: {
    id:         'elite',
    label:      'Elite Täglich',
    priceEGP:   2999,
    yearlyEGP:  29990,
    dailyFight: true,        // one fight per calendar day (Africa/Cairo)
  },
};

// Convenience accessor for the free assessment limit (kept in ONE place).
export const FREE_ASSESSMENTS = PLANS.free.assessments;
