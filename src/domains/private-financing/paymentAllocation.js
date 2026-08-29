// Applies one payment to a two-component seller-financed loan (one interest-bearing component, one
// zero-interest component) in the exact order the handoff requires:
//   1. Accrue interest on the interest-bearing component (caller supplies the already-computed
//      accruedInterestCents -- see interestAccrual.js -- this module never computes accrual itself).
//   2. Apply the payment to accrued interest first.
//   3. Apply the interest-bearing component's regular payment envelope's remainder to its principal.
//   4. Apply the zero-interest component's regular payment envelope to its principal.
//   5. Apply anything above the combined regular payment to the interest-bearing component's principal,
//      so interest stops accruing sooner.
// A payment envelope never exceeds what's actually owed on that component -- a component that's already
// paid off (remainingPrincipalCents === 0) receives nothing further from its own envelope, and any
// leftover payment amount is preserved (never silently dropped) in the returned unallocatedCents.

import { assertIntegerCents } from "./currencyMath.js";

function componentShape(component, label) {
  assertIntegerCents(component.remainingPrincipalCents, `${label}.remainingPrincipalCents`);
  assertIntegerCents(component.regularPaymentCents, `${label}.regularPaymentCents`);
  if (component.remainingPrincipalCents < 0) {
    throw new Error(`${label}.remainingPrincipalCents cannot be negative.`);
  }
}

export function allocatePayment({ interestBearing, zeroInterest, accruedInterestCents, paymentAmountCents }) {
  assertIntegerCents(paymentAmountCents, "paymentAmountCents");
  assertIntegerCents(accruedInterestCents, "accruedInterestCents");
  componentShape(interestBearing, "interestBearing");
  componentShape(zeroInterest, "zeroInterest");
  if (paymentAmountCents < 0) throw new Error("paymentAmountCents cannot be negative.");
  if (accruedInterestCents < 0) throw new Error("accruedInterestCents cannot be negative.");

  let remaining = paymentAmountCents;

  // Steps 1-2: within the interest-bearing component's own regular envelope, interest comes first.
  const interestBearingEnvelope = Math.min(remaining, interestBearing.regularPaymentCents);
  let interestPaidCents = Math.min(interestBearingEnvelope, accruedInterestCents);
  let interestBearingPrincipalCents = Math.min(
    interestBearingEnvelope - interestPaidCents,
    interestBearing.remainingPrincipalCents,
  );
  // Only the portion of the envelope actually applied (to interest + principal) leaves `remaining`. If
  // the component's remaining principal is smaller than its own envelope (near payoff), the unused
  // portion of the envelope must flow on to the next step -- not disappear. Subtracting the full
  // envelope unconditionally here would silently drop money whenever a component is near payoff.
  remaining -= interestPaidCents + interestBearingPrincipalCents;

  // If accrued interest exceeds the regular envelope (not expected for South Main, but never assumed),
  // any remaining payment covers the shortfall before anything else, still ahead of principal.
  const interestShortfall = accruedInterestCents - interestPaidCents;
  if (interestShortfall > 0 && remaining > 0) {
    const extraInterest = Math.min(remaining, interestShortfall);
    interestPaidCents += extraInterest;
    remaining -= extraInterest;
  }

  // Step 4: the zero-interest component's regular envelope, principal only (rate is always 0).
  const zeroInterestPrincipalCents = Math.min(
    remaining,
    zeroInterest.regularPaymentCents,
    zeroInterest.remainingPrincipalCents,
  );
  remaining -= zeroInterestPrincipalCents;

  // Step 5: anything above the combined regular payment goes to the interest-bearing principal.
  const interestBearingRemainingAfterRegular = interestBearing.remainingPrincipalCents - interestBearingPrincipalCents;
  const extraPrincipalCents = Math.min(remaining, interestBearingRemainingAfterRegular);
  interestBearingPrincipalCents += extraPrincipalCents;
  remaining -= extraPrincipalCents;

  return Object.freeze({
    interestPaidCents,
    interestBearingPrincipalPaidCents: interestBearingPrincipalCents,
    zeroInterestPrincipalPaidCents: zeroInterestPrincipalCents,
    // Preserves an overpayment beyond everything currently owed -- never silently dropped. A genuine
    // underpayment instead leaves accruedInterestCents only partially paid, which the caller (replay)
    // must carry forward as still-unpaid interest, not represented in this return value.
    unallocatedCents: remaining,
  });
}
