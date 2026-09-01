import { describe, expect, it } from "vitest";
import { compareBorrowerPayoffScenarios, projectBorrowerPayoff, UnsupportedBorrowerProjectionError } from "../borrowerPayoffProjection.js";

const snapshot = {
  asOfDate: "2026-01-01",
  remainingPrincipalByComponentCents: { interest: 100_000, zero: 20_000 },
  unpaidAccruedInterestFractionalByComponentCents: { interest: 0, zero: 0 },
  components: [
    { componentKey: "interest", rateBps: 300, scheduledComponentAmountCents: 10_000, allocationPriority: 1 },
    { componentKey: "zero", rateBps: 0, scheduledComponentAmountCents: 2_000, allocationPriority: 2 },
  ],
};
const accountTerms = {
  paymentFrequency: "monthly",
  allocationPolicy: "scheduled_component_order",
  extraPaymentAllocationPolicy: "highest_rate_first_extra",
};

describe("borrower payoff projection", () => {
  it("uses actual elapsed days and the authoritative allocator for a monthly payoff estimate", () => {
    const result = projectBorrowerPayoff({ snapshot, accountTerms, paymentAmountCents: 12_000, firstProjectedPaymentDate: "2026-02-01" });
    expect(result.paymentCount).toBe(11);
    expect(result.payoffDate).toBe("2026-12-01");
    expect(result.projectedFutureInterestCents).toBeGreaterThan(0);
    expect(result.balanceSeries.at(-1).principalRemainingCents).toBe(0);
  });

  it("shows that an increased payment saves both time and projected interest", () => {
    const baseline = projectBorrowerPayoff({ snapshot, accountTerms, paymentAmountCents: 12_000, firstProjectedPaymentDate: "2026-02-01" });
    const faster = projectBorrowerPayoff({ snapshot, accountTerms, paymentAmountCents: 20_000, firstProjectedPaymentDate: "2026-02-01" });
    const comparison = compareBorrowerPayoffScenarios(baseline, faster);
    expect(comparison.paymentsSaved).toBeGreaterThan(0);
    expect(comparison.interestSavedCents).toBeGreaterThan(0);
  });

  it("fails closed for unsupported schedules", () => {
    expect(() => projectBorrowerPayoff({ snapshot, accountTerms: { ...accountTerms, paymentFrequency: "biweekly" }, paymentAmountCents: 12_000, firstProjectedPaymentDate: "2026-02-01" })).toThrow(UnsupportedBorrowerProjectionError);
  });
});
