import { describe, expect, it } from "vitest";
import { assertIntegerCents, roundToNearestCent } from "../currencyMath.js";

describe("assertIntegerCents", () => {
  it("accepts any integer, including 0 and negative", () => {
    expect(() => assertIntegerCents(0)).not.toThrow();
    expect(() => assertIntegerCents(51_785)).not.toThrow();
    expect(() => assertIntegerCents(-100)).not.toThrow();
  });

  it("rejects a non-integer amount", () => {
    expect(() => assertIntegerCents(51_785.5)).toThrow(/must be an integer/);
  });

  it("rejects a non-numeric amount", () => {
    expect(() => assertIntegerCents("51785")).toThrow(/must be an integer/);
    expect(() => assertIntegerCents(undefined)).toThrow(/must be an integer/);
    expect(() => assertIntegerCents(NaN)).toThrow(/must be an integer/);
  });

  it("includes the caller-supplied label in the error message", () => {
    expect(() => assertIntegerCents(1.5, "paymentAmountCents")).toThrow(/paymentAmountCents must be an integer/);
  });
});

describe("roundToNearestCent", () => {
  it("rounds half-up, matching Money.js's own convention", () => {
    expect(roundToNearestCent(105.5)).toBe(106);
    expect(roundToNearestCent(105.4)).toBe(105);
    expect(roundToNearestCent(-105.5)).toBe(-105); // Math.round rounds -0.5 toward +Infinity
  });

  it("returns an already-integer value unchanged", () => {
    expect(roundToNearestCent(480_737)).toBe(480_737);
  });

  it("rejects a non-finite or non-numeric input", () => {
    expect(() => roundToNearestCent(Infinity)).toThrow(/finite number/);
    expect(() => roundToNearestCent(NaN)).toThrow(/finite number/);
    expect(() => roundToNearestCent("105.5")).toThrow(/finite number/);
  });
});
