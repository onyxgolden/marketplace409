// Applies one payment across an ORDERED COLLECTION of one or more financing components (V1 Terms
// Generalization -- previously this module hard-coded exactly two named components; see the migration's
// own comment for why that was a South-Main-shaped limit, not a structural one). Two closed policy axes
// drive behavior, both read from the account's own effective terms version (financingTermsContracts.js),
// never hard-coded:
//
//   allocationPolicy (currently only "scheduled_component_order" is supported) governs the REQUIRED
//   phase: for each component IN ITS OWN allocationPriority ORDER --
//     1. Apply the payment to that component's own accrued interest first (caller supplies the
//        already-computed accruedInterestCentsByComponent -- see interestAccrual.js -- this module never
//        computes accrual itself).
//     2. Apply the remainder of that component's own scheduledComponentAmountCents envelope to its
//        principal.
//     3. If accrued interest exceeded that component's own envelope, cover the shortfall from whatever
//        payment remains before moving to the next component -- still ahead of any component's principal.
//   A component's envelope never exceeds what's actually owed on it -- a component already paid off
//   (remainingPrincipalCents === 0) receives nothing further from its own envelope, and any leftover
//   moves on to the next component rather than disappearing.
//
//   extraPaymentAllocationPolicy governs what happens to payment amount ABOVE the combined required total:
//     "highest_rate_first_extra"   -- the highest-rate eligible component first (ties broken by priority).
//     "proportional_extra"         -- distributed proportionally across eligible components' own
//                                     remaining-after-required balances (allocateCentsByRatio -- no cent
//                                     lost or manufactured by rounding).
//     "selected_component_extra"   -- the seller/lender's own explicitly selected eligible component only.
//   "Eligible" always means: still has remaining principal after the required phase. Extra beyond what
//   every eligible component can absorb is preserved, never dropped, in unallocatedCents.

import { assertIntegerCents, allocateCentsByRatio } from "./currencyMath.js";
import {
  PRIVATE_FINANCING_ALLOCATION_POLICY,
  PRIVATE_FINANCING_EXTRA_PAYMENT_ALLOCATION_POLICY,
} from "./privateFinancingContracts.js";

export class UnsupportedAllocationPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedAllocationPolicyError";
  }
}

function componentShape(component) {
  assertIntegerCents(component.remainingPrincipalCents, `component "${component.componentId}".remainingPrincipalCents`);
  assertIntegerCents(component.scheduledComponentAmountCents, `component "${component.componentId}".scheduledComponentAmountCents`);
  if (component.remainingPrincipalCents < 0) {
    throw new Error(`component "${component.componentId}".remainingPrincipalCents cannot be negative.`);
  }
}

export function allocatePayment({
  components,
  accruedInterestCentsByComponent = {},
  paymentAmountCents,
  allocationPolicy,
  extraPaymentAllocationPolicy,
  selectedExtraComponentId = null,
}) {
  assertIntegerCents(paymentAmountCents, "paymentAmountCents");
  if (paymentAmountCents < 0) throw new Error("paymentAmountCents cannot be negative.");
  if (!Array.isArray(components) || components.length === 0) {
    throw new Error("components must be a non-empty array -- every account has at least one financing component.");
  }
  for (const component of components) componentShape(component);
  for (const component of components) {
    if (component.componentId in accruedInterestCentsByComponent) {
      assertIntegerCents(accruedInterestCentsByComponent[component.componentId], `accruedInterestCentsByComponent.${component.componentId}`);
      if (accruedInterestCentsByComponent[component.componentId] < 0) {
        throw new Error(`accruedInterestCentsByComponent.${component.componentId} cannot be negative.`);
      }
    }
  }

  // Fail closed: an allocation/extra-payment policy this engine does not implement must never be silently
  // guessed at. This is the same "unsupported terms fail closed" rule enforced structurally elsewhere.
  if (allocationPolicy !== PRIVATE_FINANCING_ALLOCATION_POLICY.SCHEDULED_COMPONENT_ORDER) {
    throw new UnsupportedAllocationPolicyError(`allocationPolicy "${allocationPolicy}" is not supported -- V1 only implements "${PRIVATE_FINANCING_ALLOCATION_POLICY.SCHEDULED_COMPONENT_ORDER}".`);
  }
  if (!Object.values(PRIVATE_FINANCING_EXTRA_PAYMENT_ALLOCATION_POLICY).includes(extraPaymentAllocationPolicy)) {
    throw new UnsupportedAllocationPolicyError(
      `extraPaymentAllocationPolicy "${extraPaymentAllocationPolicy}" is not supported -- must be one of ${Object.values(PRIVATE_FINANCING_EXTRA_PAYMENT_ALLOCATION_POLICY).join(", ")}.`,
    );
  }

  const ordered = [...components].sort((a, b) => a.allocationPriority - b.allocationPriority);

  let remaining = paymentAmountCents;
  const interestPaidByComponentCents = {};
  const principalPaidByComponentCents = {};
  const principalPaidSoFar = {};
  for (const component of ordered) principalPaidSoFar[component.componentId] = 0;

  // -- Required phase: interest then principal, per component, in priority order ------------------------
  for (const component of ordered) {
    const accrued = accruedInterestCentsByComponent[component.componentId] ?? 0;
    const envelope = Math.min(remaining, component.scheduledComponentAmountCents);
    let interestPaid = Math.min(envelope, accrued);
    let principalPaid = Math.min(envelope - interestPaid, component.remainingPrincipalCents);
    remaining -= interestPaid + principalPaid;

    const shortfall = accrued - interestPaid;
    if (shortfall > 0 && remaining > 0) {
      const extraInterest = Math.min(remaining, shortfall);
      interestPaid += extraInterest;
      remaining -= extraInterest;
    }

    if (interestPaid > 0) interestPaidByComponentCents[component.componentId] = interestPaid;
    if (principalPaid > 0) {
      principalPaidByComponentCents[component.componentId] = principalPaid;
      principalPaidSoFar[component.componentId] = principalPaid;
    }
  }

  // -- Extra-payment phase: only components with balance remaining after the required phase are eligible -
  if (remaining > 0) {
    const eligible = ordered
      .map((component) => ({ component, remainingAfterRequired: component.remainingPrincipalCents - principalPaidSoFar[component.componentId] }))
      .filter((entry) => entry.remainingAfterRequired > 0);

    if (eligible.length > 0) {
      if (extraPaymentAllocationPolicy === PRIVATE_FINANCING_EXTRA_PAYMENT_ALLOCATION_POLICY.HIGHEST_RATE_FIRST_EXTRA) {
        const byRateThenPriority = [...eligible].sort(
          (a, b) => b.component.rateBps - a.component.rateBps || a.component.allocationPriority - b.component.allocationPriority,
        );
        for (const entry of byRateThenPriority) {
          if (remaining <= 0) break;
          const extra = Math.min(remaining, entry.remainingAfterRequired);
          principalPaidByComponentCents[entry.component.componentId] = (principalPaidByComponentCents[entry.component.componentId] ?? 0) + extra;
          remaining -= extra;
        }
      } else if (extraPaymentAllocationPolicy === PRIVATE_FINANCING_EXTRA_PAYMENT_ALLOCATION_POLICY.PROPORTIONAL_EXTRA) {
        const totalEligibleBalance = eligible.reduce((sum, entry) => sum + entry.remainingAfterRequired, 0);
        const extraToDistribute = Math.min(remaining, totalEligibleBalance);
        const shares = allocateCentsByRatio(extraToDistribute, eligible.map((entry) => entry.remainingAfterRequired));
        eligible.forEach((entry, index) => {
          if (shares[index] > 0) {
            principalPaidByComponentCents[entry.component.componentId] = (principalPaidByComponentCents[entry.component.componentId] ?? 0) + shares[index];
          }
        });
        remaining -= extraToDistribute;
      } else {
        // SELECTED_COMPONENT_EXTRA -- extra principal requires an explicitly selected eligible component;
        // this is never inferred or defaulted. A missing/ineligible selection leaves the extra amount
        // entirely unallocated (never silently applied elsewhere) so the caller's own validation surfaces
        // the missing selection as a blocking problem rather than this module guessing.
        const selected = eligible.find((entry) => entry.component.componentId === selectedExtraComponentId);
        if (selected) {
          const extra = Math.min(remaining, selected.remainingAfterRequired);
          principalPaidByComponentCents[selected.component.componentId] = (principalPaidByComponentCents[selected.component.componentId] ?? 0) + extra;
          remaining -= extra;
        }
      }
    }
  }

  return Object.freeze({
    interestPaidByComponentCents: Object.freeze({ ...interestPaidByComponentCents }),
    principalPaidByComponentCents: Object.freeze({ ...principalPaidByComponentCents }),
    // Preserves an overpayment beyond everything currently owed, or an unmet selected-component-extra
    // requirement -- never silently dropped. A genuine underpayment instead leaves accrued interest only
    // partially paid, which the caller (replay) must carry forward as still-unpaid, not represented here.
    unallocatedCents: remaining,
  });
}
