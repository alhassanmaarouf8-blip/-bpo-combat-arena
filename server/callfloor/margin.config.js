/**
 * callfloor/margin.config.js — the business inputs the margin engine (Phase 6) needs on top of the
 * per-unit price book: the EGP↔USD rate (prices are EGP, AI costs are USD) and the
 * payment-processing fee (it eats gross margin at low price points). PLACEHOLDERS, dated — refresh
 * before running Phase 6. Kept in Mode 2 so no Mode 1 file carries a margin assumption.
 */

// EGP per 1 USD. PLACEHOLDER — set by the owner; verify against the live rate before Phase 6.
export const EGP_PER_USD = {
  rate: 51,
  checkedOn: '2026-07-22',
  source: 'owner rail: live mid-market EGP↔USD ~51 (XE 2026-07-22, range 49.6–54.4)',
};

// Payment-processing fee. The owner's CURRENT rail is manual Vodafone Cash, which takes ≈0 fee on
// received money — so net = gross here. If a card processor (Fawry/Paymob/Paddle) is adopted later,
// restore its pct + fixed (Paddle-class was 5% + $0.50) and re-run the margin report.
export const PAYMENT_FEE = {
  pct: 0,
  fixedUsd: 0,
  note: 'Vodafone Cash (owner manual rail) ≈ $0 fee — restore processor fee if a card rail is adopted',
};

export function egpToUsd(egp) {
  const r = Number(EGP_PER_USD.rate) || 0;
  return r > 0 ? (Number(egp) || 0) / r : 0;
}

/** Net USD we keep from one monthly plan payment after the processing fee. Never below 0. */
export function netRevenueUsd(priceEgp) {
  const gross = egpToUsd(priceEgp);
  if (gross <= 0) return 0;
  return Math.max(0, gross * (1 - PAYMENT_FEE.pct) - PAYMENT_FEE.fixedUsd);
}

/** gross_margin = (revenue − cogs) / revenue. Null when there is no revenue (free plan). */
export function grossMargin(revenueUsd, cogsUsd) {
  return revenueUsd > 0 ? (revenueUsd - cogsUsd) / revenueUsd : null;
}

export default { EGP_PER_USD, PAYMENT_FEE, egpToUsd, netRevenueUsd, grossMargin };
