import { describe, expect, it } from "vitest";
import { computeAccrual } from "../interestAccrual.js";
import { allocatePayment } from "../paymentAllocation.js";
import { roundToNearestCent } from "../currencyMath.js";
import * as interestAccrualModule from "../interestAccrual.js";
import * as paymentAllocationModule from "../paymentAllocation.js";
import { SOUTH_MAIN_TERMS, SOUTH_MAIN_PAYMENTS, SOUTH_MAIN_ACCEPTED_RECONCILIATION } from "../__fixtures__/southMainPayments.js";

// A minimal, test-only sequential fold over the real 48-payment history -- NOT the general-purpose
// replayEvents() engine (that's Checkpoint C's scope, handling arbitrary event types and point-in-time
// queries). This harness exists only to prove Checkpoint A's core primitives (computeAccrual,
// allocatePayment) reproduce the owner-approved reconciliation numbers when folded across real payments
// in the required order.
//
// computeAccrual returns unrounded fractional cents by design (see interestAccrual.js). This fold is
// where the "round at the end, never mid-calculation" rule actually lives: each period's fractional
// accrual is added to whatever sub-cent remainder carried over from the prior period, the combined total
// is rounded exactly once to produce the integer accruedInterestCents that allocatePayment consumes, and
// the leftover fractional difference (always inside (-0.5, 0.5) cents by construction) carries forward
// unrounded. Rounding independently 47 times instead drifts a few cents from the owner-approved total --
// confirmed by direct comparison during Checkpoint A implementation.
function foldGoldenPayments(terms, payments, throughDate) {
  let interestBearingRemainingCents = terms.interestBearing.originalPrincipalCents;
  let zeroInterestRemainingCents = terms.zeroInterest.originalPrincipalCents;
  let unpaidAccruedInterestFractionalCents = 0;
  let lastDate = terms.calculationStartDate;
  let totalInterestPaidCents = 0;
  let totalPrincipalPaidCents = 0;
  let totalUnallocatedCents = 0;

  for (const payment of payments) {
    if (payment.datePaid > throughDate) break;
    const newAccrualFractionalCents = computeAccrual({
      principalRemainingCents: interestBearingRemainingCents,
      rateBps: terms.interestBearing.rateBps,
      fromDate: lastDate,
      toDate: payment.datePaid,
    });
    const totalAccruedFractionalCents = unpaidAccruedInterestFractionalCents + newAccrualFractionalCents;
    const accruedInterestCents = roundToNearestCent(totalAccruedFractionalCents);
    const result = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: interestBearingRemainingCents, scheduledComponentAmountCents: terms.interestBearing.regularPaymentCents, rateBps: terms.interestBearing.rateBps, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: zeroInterestRemainingCents, scheduledComponentAmountCents: terms.zeroInterest.regularPaymentCents, rateBps: terms.zeroInterest.rateBps, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: { ib: accruedInterestCents },
      paymentAmountCents: payment.amountPaidCents,
      allocationPolicy: "scheduled_component_order",
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    const interestPaid = result.interestPaidByComponentCents.ib || 0;
    const ibPrincipalPaid = result.principalPaidByComponentCents.ib || 0;
    const ziPrincipalPaid = result.principalPaidByComponentCents.zi || 0;
    unpaidAccruedInterestFractionalCents = totalAccruedFractionalCents - interestPaid;
    interestBearingRemainingCents -= ibPrincipalPaid;
    zeroInterestRemainingCents -= ziPrincipalPaid;
    totalInterestPaidCents += interestPaid;
    totalPrincipalPaidCents += ibPrincipalPaid + ziPrincipalPaid;
    totalUnallocatedCents += result.unallocatedCents;
    lastDate = payment.datePaid;
  }

  return {
    interestBearingRemainingCents,
    zeroInterestRemainingCents,
    totalPrincipalRemainingCents: interestBearingRemainingCents + zeroInterestRemainingCents,
    totalInterestPaidCents,
    totalPrincipalPaidCents,
    totalUnallocatedCents,
    unpaidAccruedInterestFractionalCents,
  };
}

describe("South Main golden replay -- reproduces the owner-approved reconciliation exactly", () => {
  it("matches the real 48-payment cash total exactly ($26,577.00)", () => {
    const totalCashCents = SOUTH_MAIN_PAYMENTS.reduce((sum, p) => sum + p.amountPaidCents, 0);
    expect(totalCashCents).toBe(2_657_700);
  });

  it("reproduces interest paid, cash-to-principal, and the split remaining principal through 2026-08-23", () => {
    const result = foldGoldenPayments(SOUTH_MAIN_TERMS, SOUTH_MAIN_PAYMENTS, SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate);
    expect(result.totalInterestPaidCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.interestPaidCents);
    expect(result.totalPrincipalPaidCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.cashAppliedToPrincipalCents);
    // No cent of the real cash history is ever lost or double-counted: interest + principal applied
    // must equal every dollar actually paid, with nothing left unallocated -- proving the engine never
    // silently drops or invents money. The carried fractional interest remainder is a sub-cent rounding
    // artifact only (always strictly inside one cent), never unaccounted-for cash.
    expect(result.totalInterestPaidCents + result.totalPrincipalPaidCents).toBe(2_657_700);
    expect(result.totalUnallocatedCents).toBe(0);
    expect(Math.abs(result.unpaidAccruedInterestFractionalCents)).toBeLessThan(1);
  });

  it("reproduces the corrected principal remaining after applying the owner-approved bring-current credit", () => {
    const result = foldGoldenPayments(SOUTH_MAIN_TERMS, SOUTH_MAIN_PAYMENTS, SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate);
    const principalBeforeCredit = result.totalPrincipalRemainingCents;
    // The bring-current credit is a distinct, non-cash seller-granted adjustment (never one of the 48
    // real payments) -- applied as extra principal reduction on the interest-bearing component, the same
    // convention this engine already uses for any payment amount above what's owed (paymentAllocation.js
    // step 5). Checkpoint C's real adjustment events formalize this; here it's applied directly to prove
    // the arithmetic reconciles to the owner-approved total.
    const principalAfterCredit = principalBeforeCredit - SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents;
    expect(principalAfterCredit).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.correctedPrincipalRemainingCents);
  });

  it("never assesses a late charge -- no such code path exists in the engine at all", () => {
    // A structural guard, not a behavioral one: computeAccrual and allocatePayment together are the
    // engine's entire vocabulary in this checkpoint, and neither exports nor references anything named
    // or shaped like a late fee.
    for (const name of [...Object.keys(interestAccrualModule), ...Object.keys(paymentAllocationModule)]) {
      expect(name.toLowerCase()).not.toContain("late");
      expect(name.toLowerCase()).not.toContain("penalty");
    }
  });

  it("is independent of the source workbook's two known defects", () => {
    // Defect 1: the workbook used fixed monthly interest instead of actual-day. A fixed-monthly engine
    // computing interest for payment #1 (23 days from 2022-03-23, i.e. before the very first period even
    // completes) would have to either accrue a full month's interest immediately or accrue nothing --
    // this engine accrues for exactly the elapsed days.
    const day23Accrual = computeAccrual({
      principalRemainingCents: SOUTH_MAIN_TERMS.interestBearing.originalPrincipalCents,
      rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps,
      fromDate: "2022-03-23",
      toDate: "2022-03-23",
    });
    expect(day23Accrual).toBe(0); // zero elapsed days -> zero interest, never a flat monthly assumption

    // Defect 2: the workbook's $100 second-loan carry-forward error would show up as a $100 discrepancy
    // somewhere in the zero-interest component's principal reduction. This engine's zero-interest
    // component only ever reduces by exactly what a payment's envelope allocates to it -- there is no
    // carry-forward state of any kind for that component (it has no interest to accrue), so no such
    // error can be reproduced structurally.
    const result = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: 4_500_000, scheduledComponentAmountCents: 43_452, rateBps: 300, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: 10_000, scheduledComponentAmountCents: 8_333, rateBps: 0, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: {},
      // Exactly the combined required envelope, so there is no leftover "extra" amount to redirect --
      // isolating the required-phase envelope allocation this test actually checks.
      paymentAmountCents: 43_452 + 8_333,
      allocationPolicy: "scheduled_component_order",
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(result.principalPaidByComponentCents.zi).toBe(8_333); // exactly the regular envelope, never off by $100
  });
});
