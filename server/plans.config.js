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
    zielStelle:             true,  // Ziel-Stelle matching — the interview is framed for the target account type
  },
  // ONE-TIME plan (elite-marketer teardown 2026-07-10, owner-approved): one payment, "train until
  // you're hired". Kills the monthly manual-Vodafone re-decision — with manual rails, every renewal
  // is a fresh sale. `once: true` ⇒ no monthly/yearly toggle; access runs `onceDurationDays`, then
  // lapses to free via the normal planOf() date check — no cron, no manual step. Basic-level daily
  // limits keep the worst-case per-user Gemini audio cost bounded over the year.
  job: {
    id:               'job',
    label:            'Bis zum Job',
    priceEGP:         2000,   // ONE-TIME; the launch OFFER discounts it like the other plans
    once:             true,
    onceDurationDays: 365,    // "until hired", honestly bounded — 12 months of daily training
    dailySessions:    3,
    sessionMinutes:   5,
    dailyLiveMinutes: 15,
    zielStelle:       true,   // owner 2026-07-10: this buyer has a REAL target interview — perk included
  },
};

// Convenience accessors (kept in ONE place).
export const FREE_ASSESSMENTS = PLANS.free.assessments;
export const PLAN_IDS = Object.keys(PLANS); // ['free','basic','elite','job']

// ── Limited-time launch offer — the SINGLE source of truth for the discount ──────────────────
// When active, BOTH the payable amount (payments.js) and the pricing page (billing/status) use the
// discounted price. Time-boxed: it flips OFF automatically after `endsAt` — no code change or
// deploy needed to end it. The client shows the deal ONLY when the server reports it active, so the
// advertised price and the charged amount can never disagree (no "advertised 50% but charged full"
// half-deployed state). Applies to BOTH plans, monthly AND yearly.
export const OFFER = {
  active: true,
  pct:    50,                                    // percent off
  // 3-day window. Ends 23:59:59 Africa/Cairo (UTC+3 in July DST) on 2026-07-11.
  endsAt: Date.parse('2026-07-11T20:59:59Z'),
  label:  '50% Start-Angebot',
};
export function offerActive(now = Date.now()) {
  return !!OFFER.active && Number.isFinite(OFFER.endsAt) && now < OFFER.endsAt;
}
// Discounted EGP, rounded to whole pounds, when the offer is live; the original price otherwise.
export function offerPrice(egp, now = Date.now()) {
  return offerActive(now) ? Math.round(Number(egp) * (100 - OFFER.pct) / 100) : Number(egp);
}
