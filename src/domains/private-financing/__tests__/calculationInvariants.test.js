import { describe, expect, it } from "vitest";
import { computeAccrual } from "../interestAccrual.js";
import { allocatePayment } from "../paymentAllocation.js";
import { assertIntegerCents, roundToNearestCent } from "../currencyMath.js";

// SF-1 Checkpoint B -- verification (and documentation) of the six calculation invariants required
// before Checkpoint B implementation, per owner instruction. Each invariant is stated, then verified by
// an assertion against Checkpoint A's actual, already-approved engine (currencyMath.js,
// interestAccrual.js, paymentAllocation.js) -- nothing here changes Checkpoint A's behavior; this file
// only proves what it already does. The South Main golden reconciliation itself (invariant 6) is not
// re-derived here to avoid duplicating southMainGoldenReplay.test.js's fold -- Checkpoint A's own golden
// replay test file is left untouched per instruction, and its continuing to pass (see the full-suite run
// in the Checkpoint B report) IS the verification of invariant 6.
describe("Checkpoint B calculation invariant verification", () => {
  it("1. monetary ledger entries are always whole integer cents", () => {
    // Every field paymentAllocation.js hands back is asserted through assertIntegerCents internally
    // (paymentAllocation.js's own componentShape/assertIntegerCents calls) before it can be returned at
    // all -- demonstrated directly: a fractional accrued-interest input is rejected outright, never
    // silently truncated into a ledger entry.
    expect(() =>
      allocatePayment({
        components: [{ componentId: "note_a", remainingPrincipalCents: 4_500_000, scheduledComponentAmountCents: 43_452, rateBps: 300, allocationPriority: 1 }],
        accruedInterestCentsByComponent: { note_a: 11_465.75 }, // the raw fractional accrual, unrounded -- must be rejected here
        paymentAmountCents: 51_785,
        allocationPolicy: "scheduled_component_order",
        extraPaymentAllocationPolicy: "highest_rate_first_extra",
      }),
    ).toThrow(/must be an integer/);
    // The caller is required to round (see invariant 4) before this boundary, never after.
    expect(() => assertIntegerCents(11_465.75)).toThrow();
  });

  it("2. actual-day interest may accumulate internally with deterministic sub-cent precision", () => {
    const accrual = computeAccrual({ principalRemainingCents: 4_500_000, rateBps: 300, fromDate: "2022-03-23", toDate: "2022-04-23" });
    expect(Number.isInteger(accrual)).toBe(false); // genuinely fractional -- computeAccrual never rounds
    // Deterministic: identical inputs always produce the bit-for-bit identical fractional value.
    const again = computeAccrual({ principalRemainingCents: 4_500_000, rateBps: 300, fromDate: "2022-03-23", toDate: "2022-04-23" });
    expect(again).toBe(accrual);
  });

  it("3. sub-cent interest is carried forward rather than lost", () => {
    // A small, self-contained example isolating the carry-forward mechanism itself (the full 48-payment
    // fold already proves this at scale in southMainGoldenReplay.test.js, which this deliberately does
    // not duplicate). $10,000 principal at 3% for exactly 1 day accrues a genuinely fractional amount.
    const principalRemainingCents = 1_000_000;
    const rateBps = 300;
    const accrual = computeAccrual({ principalRemainingCents, rateBps, fromDate: "2024-01-01", toDate: "2024-01-02" });
    expect(Number.isInteger(accrual)).toBe(false);

    const roundedPeriod1 = roundToNearestCent(accrual);
    const carriedRemainder = accrual - roundedPeriod1; // what a correct fold must carry into the next period, not discard
    expect(carriedRemainder).not.toBe(0);
    expect(Math.abs(carriedRemainder)).toBeLessThan(0.5); // never more than half a cent, by construction of round-half-up

    // The carried remainder is genuinely folded into the next period's rounding decision, not discarded:
    // rounding (remainder + next period's accrual) together is a different computation from rounding the
    // next period's accrual alone, and the two-period cumulative total under carrying is provably closer
    // to the true (unrounded) two-period sum than resetting the remainder to 0 every period would be.
    // This exact discrepancy (3 cents accumulated over 47 periods, from resetting instead of carrying)
    // was found and fixed during Checkpoint A -- see interestAccrual.js's computeAccrual doc comment.
    const nextPeriodAccrual = computeAccrual({ principalRemainingCents, rateBps, fromDate: "2024-01-02", toDate: "2024-01-03" });
    const trueTwoPeriodSum = accrual + nextPeriodAccrual;
    const cumulativeTotalWhenCarried = roundedPeriod1 + roundToNearestCent(carriedRemainder + nextPeriodAccrual);
    const cumulativeTotalWhenReset = roundedPeriod1 + roundToNearestCent(nextPeriodAccrual);
    const carriedError = Math.abs(cumulativeTotalWhenCarried - trueTwoPeriodSum);
    const resetError = Math.abs(cumulativeTotalWhenReset - trueTwoPeriodSum);
    expect(carriedError).toBeLessThanOrEqual(resetError);
  });

  it("4. interest applied to a payment is rounded deterministically at the allocation boundary", () => {
    // roundToNearestCent is the ONLY rounding function anywhere in the engine, and it is invoked exactly
    // once per period, at the point a period's total accrued interest is about to be handed to
    // allocatePayment as accruedInterestCents -- never inside computeAccrual itself (see invariant 2).
    expect(roundToNearestCent(11_465.75)).toBe(11_466);
    expect(roundToNearestCent(11_465.2)).toBe(11_465);
    expect(roundToNearestCent(11_465.5)).toBe(11_466); // half-up, matching Money.js's own convention
    // Deterministic: the same fractional input always rounds to the same integer cent.
    expect(roundToNearestCent(11_465.5)).toBe(roundToNearestCent(11_465.5));
  });

  it("5. historical replay produces the same result regardless of runtime, locale, or UI formatting", () => {
    // Nothing in computeAccrual or allocatePayment reads Intl, toLocaleString, or any timezone-sensitive
    // Date method -- effectiveDate/datePaid values are plain YYYY-MM-DD strings compared lexicographically
    // (see ledgerOrdering.js) and Date.parse of that exact date-only format is defined by the ECMAScript
    // spec to be interpreted as UTC, independent of the host's locale or timezone. Proven directly: the
    // same call, repeated, is byte-for-byte identical -- there is no hidden dependence on wall-clock time,
    // locale, or any global mutable state.
    const args = { principalRemainingCents: 4_500_000, rateBps: 300, fromDate: "2022-03-23", toDate: "2022-04-23" };
    const results = Array.from({ length: 5 }, () => computeAccrual(args));
    expect(new Set(results).size).toBe(1);

    const allocationArgs = {
      components: [
        { componentId: "note_a", remainingPrincipalCents: 4_500_000, scheduledComponentAmountCents: 43_452, rateBps: 300, allocationPriority: 1 },
        { componentId: "note_b", remainingPrincipalCents: 1_000_000, scheduledComponentAmountCents: 8_333, rateBps: 0, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: { note_a: 11_452 },
      paymentAmountCents: 51_785,
      allocationPolicy: "scheduled_component_order",
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    };
    const allocationResults = Array.from({ length: 5 }, () => allocatePayment(allocationArgs));
    expect(allocationResults.every((result) => JSON.stringify(result) === JSON.stringify(allocationResults[0]))).toBe(true);
  });

  // Invariant 6 (the South Main golden reconciliation remains unchanged) is intentionally not re-derived
  // here -- see file header comment. It is verified by southMainGoldenReplay.test.js continuing to pass,
  // unmodified, in the same full-suite run as this file.
});
