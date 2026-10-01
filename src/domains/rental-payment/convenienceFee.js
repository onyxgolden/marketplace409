// Rentec-parity R12: card convenience fees (pass-through to the tenant).
//
// Pure domain logic for the workspace card convenience fee. The API routes are
// the enforcement authority; these functions exist so the UI and the API
// compute and explain with the exact same arithmetic -- the messages are
// Brandy-readable plain English, never codes.
//
// Fee semantics (Rentec item 12b):
// - Workspace-level percent, stored as integer basis points (295 = 2.95%).
// - Default 0 (OFF): enabling billing must never newly charge a tenant, so a
//   workspace with no configured fee charges no fee, ever.
// - Card payments only. ACH / US bank account payments never carry a fee.
// - The fee is what the tenant pays ON TOP of the rent; the fee line composes
//   with R11's payment-policy gate (policy minimums apply to the rent/balance
//   amount, never to rent + fee).
// - The fee is booked as a REIMBURSEMENT, never income: it reimburses the
//   landlord's Stripe processing cost (tracked in rental_settlements), so it
//   must never inflate rent revenue, NOI, or owner statements.
//
// Per-brand rates (AmEx 3.5%): deliberately NOT implemented. Stripe's Payment
// Element (the only card collector in the portal) does not expose the card
// brand in its onChange event -- its change payload carries only
// { elementType: 'payment', value: { type: 'card' | ... } }. The brand is
// PCI-scoped: Stripe reports it only after the charge exists, at
// charge.payment_method_details.card.brand (verified against the Stripe API:
// Charges list/get responses carry payment_method_details.card.brand). The fee
// must be fixed BEFORE the tenant confirms, so a per-brand fee cannot be
// computed at checkout time. One configured rate applies to every card brand;
// the workspace sets it to cover its mix (e.g. 2.95%, or 3.5% to cover AmEx).

export const MAX_FEE_BASIS_POINTS = 10000; // 100%
export const DEFAULT_FEE_BASIS_POINTS = 0; // off

export function isFeeBasisPoints(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_FEE_BASIS_POINTS;
}

// Workspace fee row -> effective basis points. Null/undefined/bad rows fail
// safe to OFF (default 0), so a corrupt settings row can never newly charge.
export function resolveFeeBasisPoints(rawBps) {
  if (rawBps === null || rawBps === undefined) return DEFAULT_FEE_BASIS_POINTS;
  const bps = Number(rawBps);
  return isFeeBasisPoints(bps) ? bps : DEFAULT_FEE_BASIS_POINTS;
}

export function isFeeEnabled(basisPoints) {
  return resolveFeeBasisPoints(basisPoints) > 0;
}

// "2.95%" / "3.5%" / "0%". Basis points are exact integers, so no float drift.
export function formatFeePercent(basisPoints) {
  const bps = resolveFeeBasisPoints(basisPoints);
  const whole = Math.trunc(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac === "" ? `${whole}%` : `${whole}.${frac}%`;
}

// Whole-cent fee for a rent amount: integer math only, so
// 2.95% of $1600.00 = exactly 4720 cents ($47.20), never 4719.999...
export function convenienceFeeCents(rentCents, basisPoints) {
  if (!Number.isSafeInteger(rentCents) || rentCents <= 0) return 0;
  const bps = resolveFeeBasisPoints(basisPoints);
  if (bps === 0) return 0;
  return Math.round((rentCents * bps) / 10000);
}

export function formatCents(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
}

// Plain-English fee line for the portal review screen and agreement copy.
export function feeLineText(rentCents, basisPoints) {
  const feeCents = convenienceFeeCents(rentCents, basisPoints);
  return `Card convenience fee (${formatFeePercent(basisPoints)}): ${formatCents(feeCents)}`;
}

// The agreement copy the tenant explicitly checks. Names the rate, the exact
// dollar amount, that it applies only to card payments, and that it is a
// pass-through reimbursement of the landlord's card processing cost -- not rent.
export function feeAgreementText(rentCents, basisPoints) {
  const feeCents = convenienceFeeCents(rentCents, basisPoints);
  return `I agree to pay a card convenience fee of ${formatCents(feeCents)} ` +
    `(${formatFeePercent(basisPoints)} of my ${formatCents(rentCents)} payment) if I pay by card. ` +
    `Bank (ACH) payments have no fee. The fee reimburses the landlord's card processing cost; it is not rent.`;
}

// Server-side validation for the owner settings input. Returns
// { ok: true, bps } or { ok: false, message } with a Brandy-readable message.
export function validateFeeInput(raw) {
  if (raw === null || raw === undefined || raw === "") return { ok: true, bps: DEFAULT_FEE_BASIS_POINTS };
  const asNumber = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  if (!Number.isFinite(asNumber) || asNumber < 0 || asNumber > 100)
    return { ok: false, message: "The convenience fee must be a percent between 0 and 100." };
  // Hundredths of a percent = basis points; reject anything more precise than
  // 0.01% so the stored rate is exact (no float storage).
  const bps = Math.round(asNumber * 100);
  if (Math.abs(asNumber * 100 - bps) > 1e-9)
    return { ok: false, message: "The convenience fee can have at most two decimal places (e.g. 2.95)." };
  return { ok: true, bps };
}

// Server-side gate for creating a card payment session. Returns
// { ok: true, feeCents } or { ok: false, message } (HTTP 422 copy).
// - feeCents is computed here from the workspace rate -- the client never
//   decides the amount.
// - methodType must be explicit when a fee is enabled and cards are offered;
//   an absent method with an enabled fee fails closed (400-level, caller bug).
// - ACH never carries a fee and needs no agreement.
export function checkFeeAgreement({ methodType, feeBps, feeAgreed, expectedFeeCents, rentCents, cardPaymentsEnabled }) {
  const bps = resolveFeeBasisPoints(feeBps);
  if (methodType !== "card" && methodType !== "us_bank_account") {
    if (bps > 0 && cardPaymentsEnabled === true)
      return { ok: false, status: 400, message: "Choose how you'd like to pay: card or bank account." };
    return { ok: true, feeCents: 0 };
  }
  if (methodType === "us_bank_account") return { ok: true, feeCents: 0 };
  if (cardPaymentsEnabled === false)
    return { ok: false, status: 400, message: "Card payments are not enabled for this account." };
  const feeCents = convenienceFeeCents(rentCents, bps);
  if (bps === 0 || feeCents === 0) return { ok: true, feeCents: 0 };
  if (feeAgreed !== true)
    return { ok: false, status: 422,
      message: `To pay by card, please check the box agreeing to the card convenience fee of ${formatCents(feeCents)} (${formatFeePercent(bps)}).` };
  if (expectedFeeCents !== undefined && expectedFeeCents !== null && Number(expectedFeeCents) !== feeCents)
    return { ok: false, status: 422,
      message: "The convenience fee changed while you were reviewing your payment. Please review the updated total and try again." };
  return { ok: true, feeCents };
}

// Autopay decision (documented): a card autopay attempt carries the fee ONLY
// when the tenant explicitly consented to card-autopay fees in the portal,
// charged at the consented rate CAPPED at the current workspace rate:
//   - owner raises the rate later  -> consented rate (owner absorbs the diff
//     until the tenant re-consents)
//   - owner lowers the rate later   -> the lower current rate
//   - owner turns the fee off later -> no fee
// The tenant can never be charged MORE than they agreed to, and never more
// than the workspace's current rate. ACH autopay never carries a fee.
export function autopayFeeCents({ paymentMethodType, consentBps, workspaceBps, rentCents }) {
  if (paymentMethodType !== "card") return 0;
  const effectiveBps = Math.min(resolveFeeBasisPoints(consentBps), resolveFeeBasisPoints(workspaceBps));
  return convenienceFeeCents(rentCents, effectiveBps);
}
