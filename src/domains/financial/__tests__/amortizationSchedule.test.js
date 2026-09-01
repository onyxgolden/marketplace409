import { describe, expect, it } from "vitest";
import {
  buildAmortizationSchedule,
  calculateRequiredMonthlyPaymentCents,
  compareAmortizationSchedules,
  InvalidAmortizationTermsError,
} from "../amortizationSchedule";

const base = {
  principalCents: 30_000_000,
  annualRateBps: 650,
  termMonths: 360,
  startDate: "2026-10-01",
};

describe("amortization schedule", () => {
  it("calculates a fixed-rate monthly payment and reaches a zero balance", () => {
    expect(calculateRequiredMonthlyPaymentCents(base)).toBe(189_621);
    const schedule = buildAmortizationSchedule(base);
    expect(schedule.paymentCount).toBe(360);
    expect(schedule.rows.at(-1).endingBalanceCents).toBe(0);
    expect(schedule.payoffDate).toBe("2056-09-01");
  });

  it("shows savings from recurring and one-time principal overpayments", () => {
    const baseline = buildAmortizationSchedule(base);
    const accelerated = buildAmortizationSchedule({
      ...base,
      recurringExtraCents: 25_000,
      oneTimeExtraCents: 100_000,
      oneTimeExtraMonth: 12,
    });
    const comparison = compareAmortizationSchedules(baseline, accelerated);
    expect(comparison.monthsSaved).toBeGreaterThan(0);
    expect(comparison.interestSavedCents).toBeGreaterThan(0);
    expect(accelerated.rows[11].extraPrincipalCents).toBe(125_000);
  });

  it("supports zero-interest loans and rejects invalid terms", () => {
    const schedule = buildAmortizationSchedule({ ...base, principalCents: 1_200_000, annualRateBps: 0, termMonths: 12 });
    expect(schedule.requiredPaymentCents).toBe(100_000);
    expect(schedule.totalInterestCents).toBe(0);
    expect(() => buildAmortizationSchedule({ ...base, termMonths: 0 })).toThrow(InvalidAmortizationTermsError);
  });
});
