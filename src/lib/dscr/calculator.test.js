import { describe, it, expect } from "vitest";
import {
  computeDscr,
  illustrativeComparisons,
  DISCLAIMER,
} from "./calculator.js";

describe("computeDscr", () => {
  it("computes a basic ratio with all components", () => {
    const r = computeDscr({
      rent: 2000,
      principalAndInterest: 1000,
      taxes: 200,
      insurance: 100,
      hoaDues: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.ratio).toBe(1.481); // 2000 / 1350
    expect(r.formula).toContain("P&I + taxes + insurance + HOA/dues");
    expect(r.components).toHaveLength(4);
    expect(r.components.every((c) => c.included)).toBe(true);
  });

  it("excludes taxes and insurance when escrow-inclusive (no double-count)", () => {
    const r = computeDscr({
      rent: 2000,
      principalAndInterest: 1300, // already includes taxes + insurance
      taxes: 200,
      insurance: 100,
      hoaDues: 50,
      escrowInclusive: true,
    });
    expect(r.ok).toBe(true);
    expect(r.ratio).toBe(1.481); // 2000 / 1350 — same as above, no double count
    const taxesComp = r.components.find((c) => c.label === "Property taxes");
    const insComp = r.components.find((c) => c.label === "Property insurance");
    expect(taxesComp.included).toBe(false);
    expect(insComp.included).toBe(false);
    expect(r.formula).toContain("incl. escrow");
  });

  it("rejects zero debt service with an explicit message (never infinity)", () => {
    const r = computeDscr({
      rent: 2000,
      principalAndInterest: 0,
      taxes: 0,
      insurance: 0,
      hoaDues: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.ratio).toBe(null);
    expect(r.error).toMatch(/cannot compute/i);
    expect(r.error).not.toMatch(/infinity/i);
  });

  it("rejects negative inputs with field-level messages", () => {
    const r = computeDscr({
      rent: -500,
      principalAndInterest: 1000,
      taxes: 0,
      insurance: 0,
      hoaDues: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rent/);
  });

  it("rejects non-numeric inputs", () => {
    const r = computeDscr({
      rent: NaN,
      principalAndInterest: 1000,
      taxes: 0,
      insurance: 0,
      hoaDues: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/must be a number/);
  });

  it("rejects Infinity inputs", () => {
    const r = computeDscr({
      rent: 2000,
      principalAndInterest: Infinity,
      taxes: 0,
      insurance: 0,
      hoaDues: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("handles zero rent (ratio 0, still valid computation)", () => {
    const r = computeDscr({
      rent: 0,
      principalAndInterest: 1000,
      taxes: 200,
      insurance: 100,
      hoaDues: 0,
    });
    expect(r.ok).toBe(true);
    expect(r.ratio).toBe(0);
  });

  it("rounds to 3 decimals deterministically", () => {
    const a = computeDscr({
      rent: 1950,
      principalAndInterest: 1100,
      taxes: 175,
      insurance: 90,
      hoaDues: 35,
    });
    const b = computeDscr({
      rent: 1950,
      principalAndInterest: 1100,
      taxes: 175,
      insurance: 90,
      hoaDues: 35,
    });
    expect(a.ratio).toBe(b.ratio);
    expect(a.ratio).toBe(1.393); // 1950 / 1400
  });
});

describe("illustrativeComparisons", () => {
  it("labels thresholds as illustrative, never pass/fail", () => {
    const comps = illustrativeComparisons(1.3);
    expect(comps).toHaveLength(3);
    const joined = comps.map((c) => c.label).join(" ");
    expect(joined).not.toMatch(/pass|fail/i);
    expect(joined).toMatch(/illustrative/);
  });

  it("marks above and below correctly", () => {
    const comps = illustrativeComparisons(1.1);
    expect(comps[0].label).toMatch(/at or above/i); // 1.0x
    expect(comps[1].label).toMatch(/below/i); // 1.2x
    expect(comps[2].label).toMatch(/below/i); // 1.25x
  });
});

describe("DISCLAIMER", () => {
  it("states illustration, not approval", () => {
    expect(DISCLAIMER).toMatch(/illustration/i);
    expect(DISCLAIMER).toMatch(/not an approval/i);
  });
});
