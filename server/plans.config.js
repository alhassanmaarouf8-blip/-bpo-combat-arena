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
    vacancyTarget:    'preview', // one lifetime preview; API exposes Day 1 only
    vacancyPlanDays:  1,
    interviewPass:    'preview', // one claimed X-Ray/Day 1; raw CV never leaves the browser
    candidatePassport:'limited', // confirmed evidence cards only
    opportunityCopilot:'preview',
    jobFitPreviewsMonthly: 3,
    trackedApplications: 1,
    applicationPacks: false,
    // Call Floor (Mode 2). PLACEHOLDER allowances — Phase 6's margin engine sets the real numbers
    // via the affordable-allowance formula (docs/PRICING.md). `dailyCallMinutes` = the metered voice
    // ceiling for simulated calls (SEPARATE from the interview `dailyLiveMinutes` meter — unifying
    // them into one voice wallet touches the frozen interview path and is an owner-gated Phase 6
    // call). `quadrants` = unlocked seats (outbound_sales is the Elite hook). `freeTalk` = Phase 5
    // open conversation. `overageEgpPerBlock` = price per extra CALLFLOOR_OVERAGE_BLOCK_MIN block (0
    // until Phase 6 prices it).
    callFloor: { dailyCallMinutes: 6, quadrants: ['inbound_cs', 'inbound_sales'], freeTalk: false, overageEgpPerBlock: 0 },
  },
  // Owner order 07-11 (supersedes the same-day 599/1499 ship): Basic = 15 live minutes/day,
  // Elite = 30, prices raised. Sold as full interviews: 2×7.5 and 4×7.5 (MAX_FIGHT_MS = 7.5 min).
  // Worst-case COGS at the measured $0.024/min: Basic ~540 EGP/mo, Elite ~1.080 — prices keep a
  // ~45% floor margin at 100% daily usage, ~73% at realistic (~50%) usage.
  basic: {
    id:               'basic',
    label:            'Basic',
    priceEGP:         999,
    yearlyEGP:        9990,  // 12 for the price of 10
    dailySessions:    2,     // 2 FULL HR interviews per day — the daily-quota law
    sessionMinutes:   7.5,
    dailyLiveMinutes: 15,    // 2 × 7.5 — hard daily spend cap
    // "Study 5, rest 2" (owner 2026-07-22): a paid subscriber gets 5 STUDY DAYS per week (Cairo,
    // Mon-start); the 2 days they skip are their own rest days — they pick by simply showing up.
    // Mirrors a real work week + protects margin (~67% at list). Enforced as a weekly COUNT (not
    // shuffleable named days), so it can't be gamed to 7.
    studyDaysPerWeek: 5,
    vacancyTarget:    'full',
    vacancyPlanDays:  7,
    interviewPass:    'full',
    candidatePassport:'full',
    opportunityCopilot:'full',
    jobRadarDaily:    5,
    trackedApplications: 100, // operational ceiling, not a volume promise
    applicationPacks: true,
    // Call Floor — PLACEHOLDER (see the free-plan note above). Basic = the three service/CS-heavy
    // seats; outbound_sales stays the Elite upsell.
    callFloor: { dailyCallMinutes: 15, quadrants: ['inbound_cs', 'inbound_sales', 'outbound_cs'], freeTalk: false, overageEgpPerBlock: 0 },
  },
  elite: {
    id:                     'elite',
    label:                  'Elite',
    priceEGP:               1999,
    yearlyEGP:              19990,
    dailySessions:          4,     // 4 FULL HR interviews per day
    sessionMinutes:         7.5,
    dailyLiveMinutes:       30,    // 4 × 7.5 — hard daily spend cap
    studyDaysPerWeek:       5,     // "Study 5, rest 2" — see the Basic note above

    zielStelle:             true,  // Ziel-Stelle matching — the interview is framed for the target account type
    vacancyTarget:          'full',
    vacancyPlanDays:        7,
    vacancyLive:            true,  // also requires the independent VACANCY_LIVE_ENABLED kill switch
    interviewPass:          'full',
    candidatePassport:      'full',
    opportunityCopilot:     'full',
    jobRadarDaily:          5,
    trackedApplications:    250, // operational ceiling, not a volume promise
    applicationPacks:       true,
    // Call Floor — PLACEHOLDER (see the free-plan note above). Elite = the full floor incl.
    // outbound_sales + the Phase 5 free-talk mode.
    callFloor: { dailyCallMinutes: 30, quadrants: ['inbound_cs', 'inbound_sales', 'outbound_cs', 'outbound_sales'], freeTalk: true, overageEgpPerBlock: 0 },
  },
  // "Bis zum Job" one-time plan: KILLED by owner order 2026-07-10 evening ("cancel that shit",
  // he saw the live card and vetoed the whole tier — outranks the morning teardown's approval).
  // The generic `once`/`onceDurationDays` machinery (auth.js grantPlan / paywall render) stays:
  // it is plan-agnostic and a future one-time plan may use it. Accounts that ever got plan:'job'
  // lapse safely to free via planOf()'s PLANS[s.plan] existence check.
};

// Study days per week for a plan (0/absent = no weekly limit, e.g. the free one-time fight).
export function studyDaysPerWeekFor(planId = 'free') {
  const v = Number(PLANS[planId]?.studyDaysPerWeek);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Call Floor overage block size (minutes). Phase 6 prices `overagePerBlock`; the block size is here.
export const CALLFLOOR_OVERAGE_BLOCK_MIN = 5;
// The Call Floor entitlement block for a plan id (never throws; unknown → a locked, zero-minute
// default so a lapsed/unknown plan can never accidentally get free voice).
export function callFloorFor(planId = 'free') {
  return PLANS[planId]?.callFloor || { dailyCallMinutes: 0, quadrants: [], freeTalk: false, overageEgpPerBlock: 0 };
}

// Convenience accessors (kept in ONE place).
export const FREE_ASSESSMENTS = PLANS.free.assessments;
export const PLAN_IDS = Object.keys(PLANS); // ['free','basic','elite']
export function trackedApplicationsFor(planId = 'free') {
  const value = Number(PLANS[planId]?.trackedApplications);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export const MAX_TRACKED_APPLICATIONS = Math.max(
  ...PLAN_IDS.map((planId) => trackedApplicationsFor(planId)),
);

// ── Limited-time launch offer — the SINGLE source of truth for the discount ──────────────────
// When active, BOTH the payable amount (payments.js) and the pricing page (billing/status) use the
// discounted price. Time-boxed: it flips OFF automatically after `endsAt` — no code change or
// deploy needed to end it. The client shows the deal ONLY when the server reports it active, so the
// advertised price and the charged amount can never disagree (no "advertised 50% but charged full"
// half-deployed state). Applies to BOTH plans, monthly AND yearly.
export const OFFER = {
  active: false,                                   // normal prices during Mission Control validation
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
