import { describe, expect, it } from "vitest";
import {
  applyCreditToCharge,
  isOverpayment,
  sortCreditsForAutoApply,
  splitOfflineOverpayment,
} from "../tenantCredit";

describe("splitOfflineOverpayment", () => {
  it("applies the full amount with no credit when within the remaining balance", () => {
    expect(splitOfflineOverpayment(150000, 150000)).toEqual({
      appliedCents: 150000, creditCents: 0, isOverpayment: false,
    });
  });

  it("splits Eric's case: $1,532 against a $1,500 charge leaves a $32 credit", () => {
    expect(splitOfflineOverpayment(153200, 150000)).toEqual({
      appliedCents: 150000, creditCents: 3200, isOverpayment: true,
    });
  });

  it("rejects non-positive and non-integer amounts", () => {
    expect(() => splitOfflineOverpayment(0, 150000)).toThrow("positive");
    expect(() => splitOfflineOverpayment(-100, 150000)).toThrow("positive");
    expect(() => splitOfflineOverpayment(1500.5, 150000)).toThrow("positive");
  });

  it("rejects an invalid charge remaining balance", () => {
    expect(() => splitOfflineOverpayment(150000, -1)).toThrow("remaining balance");
  });
});

describe("isOverpayment", () => {
  it("detects overpayments and exact payments", () => {
    expect(isOverpayment(153200, 150000)).toBe(true);
    expect(isOverpayment(150000, 150000)).toBe(false);
    expect(isOverpayment(100000, 150000)).toBe(false);
  });

  it("returns false for invalid input instead of throwing", () => {
    expect(isOverpayment(NaN, 150000)).toBe(false);
    expect(isOverpayment(150000, -5)).toBe(false);
  });
});

describe("applyCreditToCharge", () => {
  it("applies the requested amount when both sides can absorb it", () => {
    expect(applyCreditToCharge({ creditRemainingCents: 3200, chargeRemainingCents: 150000, requestedCents: 3200 }))
      .toEqual({
        appliedCents: 3200,
        newCreditRemainingCents: 0,
        newChargeRemainingCents: 146800,
        creditFullyApplied: true,
        chargeFullyPaid: false,
      });
  });

  it("clamps to the smaller of the credit and charge remainders", () => {
    const result = applyCreditToCharge({ creditRemainingCents: 5000, chargeRemainingCents: 3000, requestedCents: 99999 });
    expect(result.appliedCents).toBe(3000);
    expect(result.newCreditRemainingCents).toBe(2000);
    expect(result.chargeFullyPaid).toBe(true);
    expect(result.creditFullyApplied).toBe(false);
  });

  it("throws when there is nothing to apply", () => {
    expect(() => applyCreditToCharge({ creditRemainingCents: 0, chargeRemainingCents: 150000, requestedCents: 100 }))
      .toThrow("nothing to apply");
    expect(() => applyCreditToCharge({ creditRemainingCents: 3200, chargeRemainingCents: 0, requestedCents: 100 }))
      .toThrow("nothing to apply");
    expect(() => applyCreditToCharge({ creditRemainingCents: 3200, chargeRemainingCents: 150000, requestedCents: 0 }))
      .toThrow("positive");
  });
});

describe("sortCreditsForAutoApply", () => {
  it("orders oldest-first with a stable id tiebreak", () => {
    const credits = [
      { id: "c2", createdAt: "2026-09-10T00:00:00Z" },
      { id: "c1", createdAt: "2026-09-01T00:00:00Z" },
      { id: "c3", createdAt: "2026-09-01T00:00:00Z" },
    ];
    expect(sortCreditsForAutoApply(credits).map((c) => c.id)).toEqual(["c1", "c3", "c2"]);
  });
});
