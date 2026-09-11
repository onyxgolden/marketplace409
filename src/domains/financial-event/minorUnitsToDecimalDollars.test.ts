import { describe, expect, it } from "vitest";
import { minorUnitsToDecimalDollars } from "./minorUnitsToDecimalDollars";

describe("minorUnitsToDecimalDollars", () => {
  it("converts a whole-dollar positive amount", () => {
    expect(minorUnitsToDecimalDollars(1000)).toBe(10);
  });

  it("converts a negative amount, preserving sign", () => {
    expect(minorUnitsToDecimalDollars(-1000)).toBe(-10);
  });

  it("preserves exact cent precision for a non-round amount", () => {
    expect(minorUnitsToDecimalDollars(1001)).toBe(10.01);
  });

  it("preserves exact cent precision for a single cent", () => {
    expect(minorUnitsToDecimalDollars(1)).toBe(0.01);
    expect(minorUnitsToDecimalDollars(-1)).toBe(-0.01);
  });

  it("converts zero to zero", () => {
    expect(minorUnitsToDecimalDollars(0)).toBe(0);
    // Never a negative-zero result that could confuse a sign check downstream.
    expect(Object.is(minorUnitsToDecimalDollars(0), -0)).toBe(false);
  });

  it("preserves exact cent precision for a large real-world amount (the $3,000,000-stored-as-minor-units production case)", () => {
    // This is exactly the shape of the largest corrupted production row this fix addresses:
    // 300000000 minor units is $3,000,000.00 -- a real Stripe Financial Connections transaction
    // ("Online Banking Withdrawal / Transfer to Share 0009") whose TRUE value is $30,000.00 was
    // being stored as if 300000000 were already dollars. This function's job ends at "convert minor
    // units to dollars correctly"; whether 300000000 minor units is itself a plausible amount is a
    // question for the data, not this function.
    expect(minorUnitsToDecimalDollars(300_000_000)).toBe(3_000_000);
  });

  describe("rejects every class of invalid input explicitly, rather than silently truncating, rounding, or coercing", () => {
    it("rejects a decimal input", () => {
      expect(() => minorUnitsToDecimalDollars(10.5)).toThrow(/integer/);
    });

    it("rejects NaN", () => {
      expect(() => minorUnitsToDecimalDollars(NaN)).toThrow(/NaN/);
    });

    it("rejects positive Infinity", () => {
      expect(() => minorUnitsToDecimalDollars(Infinity)).toThrow(/Infinity/);
    });

    it("rejects negative Infinity", () => {
      expect(() => minorUnitsToDecimalDollars(-Infinity)).toThrow(/Infinity/);
    });

    it("rejects an unsafe integer (beyond Number.MAX_SAFE_INTEGER), even though Number.isInteger would accept it", () => {
      const unsafeInteger = Number.MAX_SAFE_INTEGER + 2; // still Number.isInteger === true, but not safe
      expect(Number.isInteger(unsafeInteger)).toBe(true); // confirms this genuinely tests the isSafeInteger gate, not the isInteger gate
      expect(() => minorUnitsToDecimalDollars(unsafeInteger)).toThrow(/safe integer/);
    });

    it("accepts Number.MAX_SAFE_INTEGER itself (the boundary is inclusive)", () => {
      expect(() => minorUnitsToDecimalDollars(Number.MAX_SAFE_INTEGER)).not.toThrow();
    });
  });

  it("round-trips a representative sample of cent values exactly, with no floating-point drift", () => {
    for (const cents of [1, 7, 11, 23, 49, 50, 99, 100, 999, 12345, 1_000_001]) {
      const dollars = minorUnitsToDecimalDollars(cents);
      // toFixed(2) must reproduce the exact expected string -- proves no float drift crept in,
      // not just that the value is "close enough".
      const expectedWhole = Math.trunc(cents / 100);
      const expectedCents = String(cents % 100).padStart(2, "0");
      expect(dollars.toFixed(2)).toBe(`${expectedWhole}.${expectedCents}`);
    }
  });
});
