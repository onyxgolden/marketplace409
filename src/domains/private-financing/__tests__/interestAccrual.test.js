import { describe, expect, it } from "vitest";
import { computeAccrual, daysBetween } from "../interestAccrual.js";

describe("daysBetween", () => {
  it("counts actual elapsed calendar days", () => {
    expect(daysBetween("2022-03-23", "2022-04-23")).toBe(31);
    expect(daysBetween("2022-03-23", "2022-03-23")).toBe(0);
  });

  it("rejects an invalid date string", () => {
    expect(() => daysBetween("not-a-date", "2022-04-23")).toThrow(/valid dates/);
    expect(() => daysBetween("2022-03-23", "not-a-date")).toThrow(/valid dates/);
  });
});

describe("computeAccrual", () => {
  const baseArgs = { principalRemainingCents: 4_500_000, rateBps: 300, fromDate: "2022-03-23", toDate: "2022-04-23" };

  it("computes 365/365 actual-day interest and returns it UNROUNDED", () => {
    // 4,500,000 cents * 300 bps * 31 days / (10,000 * 365) = 11465.753424657534...
    const accrual = computeAccrual(baseArgs);
    expect(accrual).toBeCloseTo(11465.753424657534, 10);
    expect(Number.isInteger(accrual)).toBe(false); // deliberately fractional -- caller rounds, not this function
  });

  it("never accrues interest on a zero or negative remaining balance", () => {
    expect(computeAccrual({ ...baseArgs, principalRemainingCents: 0 })).toBe(0);
  });

  it("rejects a negative remaining balance as a malformed input rather than silently accruing", () => {
    expect(() => computeAccrual({ ...baseArgs, principalRemainingCents: -100 })).not.toThrow();
    // Negative principal is not itself an integer-cents violation, so it is not rejected here; the
    // non-positive guard below is what prevents it from producing interest.
    expect(computeAccrual({ ...baseArgs, principalRemainingCents: -100 })).toBe(0);
  });

  it("never accrues interest at a zero or negative rate (the zero-interest component)", () => {
    expect(computeAccrual({ ...baseArgs, rateBps: 0 })).toBe(0);
  });

  it("never accrues interest for a non-positive day count", () => {
    expect(computeAccrual({ ...baseArgs, fromDate: "2022-03-23", toDate: "2022-03-23" })).toBe(0);
    expect(computeAccrual({ ...baseArgs, fromDate: "2022-04-23", toDate: "2022-03-23" })).toBe(0);
  });

  it("rejects a non-integer principalRemainingCents", () => {
    expect(() => computeAccrual({ ...baseArgs, principalRemainingCents: 4_500_000.5 })).toThrow(/must be an integer/);
  });

  it("stops accruing on prepaid principal immediately -- a smaller remaining balance today produces less accrual for the very next period, with no delay", () => {
    const fullBalanceAccrual = computeAccrual(baseArgs);
    const afterPrepaymentAccrual = computeAccrual({ ...baseArgs, principalRemainingCents: 4_000_000 });
    expect(afterPrepaymentAccrual).toBeLessThan(fullBalanceAccrual);
    // Proportional: exactly 4,000,000 / 4,500,000 of the original accrual.
    expect(afterPrepaymentAccrual).toBeCloseTo(fullBalanceAccrual * (4_000_000 / 4_500_000), 10);
  });
});
