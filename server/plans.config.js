/**
 * plans.config.js — THE single source of truth for plan names, prices, and limits.
 *
 * Change numbers HERE only. No other file may hard-code a price, a plan name, or a limit.
 * Prices are in Egyptian Pounds (EGP). `yearlyEGP` is the discounted annual price (a round
 * number, not a computed percentage). Used by the pricing page, payment flow, and gating.
 */
// Plans differ in daily live-interview minutes (reset midnight Africa/Cairo) AND in how those
// minutes are SPLIT into focused sessions. Short, split sessions beat one long blob: each split
// mirrors a real interview stage, earns its own coach debrief, and the cached opening line makes
// each session's first boss turn free. `dailyLiveMinutes` = dailySessions × sessionMinutes is the
// HARD spend cap enforced today; the brain enforces the per-session split structure.
export const PLANS = {
  free: {
    id:               'free',
    label:            'Gratis',
    assessments:      1,     // free intelligent assessment, once per account ever
    dailyLiveMinutes: 0,     // NO live fight (assessment only) — a live fight costs real money
    dailySessions:    0,
    sessionMinutes:   0,
  },
  basic: {
    id:               'basic',
    label:            'Basic',   // package shorthand "Fokus" (3×5) — rename is a separate branding pass (copy cascade)
    priceEGP:         1299,
    yearlyEGP:        12990,
    dailySessions:    3,     // 3 focused sessions/day, one per interview stage
    sessionMinutes:   5,
    dailyLiveMinutes: 15,    // 3 × 5 — hard daily spend cap
  },
  elite: {
    id:                     'elite',
    label:                  'Elite',   // package shorthand "Intensiv" (6×5) — rename is a separate branding pass
    priceEGP:               2999,
    yearlyEGP:              29990,
    dailySessions:          6,     // 6 focused sessions/day (fewer-longer beats 10×3 — less fatigue, fuller arc)
    sessionMinutes:         5,
    dailyLiveMinutes:       30,    // 6 × 5 — hard daily spend cap
    trainingslagerUnlocked: true,  // full Trainingslager lessons unlocked
  },
};

// Convenience accessors (kept in ONE place).
export const FREE_ASSESSMENTS = PLANS.free.assessments;
export const PLAN_IDS = Object.keys(PLANS); // ['free','basic','elite']
