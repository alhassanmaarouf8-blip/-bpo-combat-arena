/**
 * plans.config.js — THE single source of truth for plan names, prices, and limits.
 *
 * Change numbers HERE only. No other file may hard-code a price, a plan name, or a limit.
 * Prices are in Egyptian Pounds (EGP). `yearlyEGP` is the discounted annual price (a round
 * number, not a computed percentage). Used by the pricing page, payment flow, and gating.
 */
// Plans are sold as FULL DAILY INTERVIEWS (owner mandate 2026-07-11: every paid subscriber gets a
// daily quota of complete HR interviews + unlimited drills; quotas in minutes felt metered).
// One interview = one full live session, wall-capped at sessionMinutes (mirrors MAX_FIGHT_MS in
// websocketManager). `dailyLiveMinutes` = dailySessions × sessionMinutes remains the HARD daily
// spend cap the server enforces (reset midnight Africa/Cairo).
// UNIT ECONOMICS (measured live 2026-07-11, 3 probe interviews on Gemini native audio, funnel-proven
// zero fallback): $0.022–0.025 per live minute ⇒ a full 8-min interview ≈ $0.19 ≈ 9.6 EGP.
// Worst-case COGS: Basic 1/day = ~290 EGP/mo · Elite 3/day = ~865 EGP/mo. Prices below keep
// ≥50%/40% margin at 100% daily usage; realistic usage (~50%) → ~75% margin.
// PRICE ANCHOR: Goethe Kairo = 3.400 EGP je Stufe (regulär) / 9.500 EGP intensiv — the buyer
// already spends course money; Basic must read as "a fraction of one course level per month".
export const PLANS = {
  free: {
    id:               'free',
    label:            'Gratis',
    assessments:      1,     // free intelligent assessment, once per account ever
    dailyLiveMinutes: 0,     // NO recurring live fight (assessment + the one-time free fight only)
    dailySessions:    0,
    sessionMinutes:   0,
  },
  basic: {
    id:               'basic',
    label:            'Basic',
    priceEGP:         599,
    yearlyEGP:        5990,  // 12 for the price of 10
    dailySessions:    1,     // 1 FULL HR interview per day — the daily-quota law
    sessionMinutes:   8,
    dailyLiveMinutes: 8,     // 1 × 8 — hard daily spend cap
  },
  elite: {
    id:                     'elite',
    label:                  'Elite',
    priceEGP:               1499,
    yearlyEGP:              14990,
    dailySessions:          3,     // 3 FULL HR interviews per day
    sessionMinutes:         8,
    dailyLiveMinutes:       24,    // 3 × 8 — hard daily spend cap
    zielStelle:             true,  // Ziel-Stelle matching — the interview is framed for the target account type
  },
  // "Bis zum Job" one-time plan: KILLED by owner order 2026-07-10 evening ("cancel that shit",
  // he saw the live card and vetoed the whole tier — outranks the morning teardown's approval).
  // The generic `once`/`onceDurationDays` machinery (auth.js grantPlan / paywall render) stays:
  // it is plan-agnostic and a future one-time plan may use it. Accounts that ever got plan:'job'
  // lapse safely to free via planOf()'s PLANS[s.plan] existence check.
};

// Convenience accessors (kept in ONE place).
export const FREE_ASSESSMENTS = PLANS.free.assessments;
export const PLAN_IDS = Object.keys(PLANS); // ['free','basic','elite']

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
