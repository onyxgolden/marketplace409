import { describe, expect, it } from "vitest";
import { validateSplits } from "./validateSplits";

describe("validateSplits", () => {
  it("accepts split lines that sum exactly to the transaction total", () => {
    const result = validateSplits(
      [
        { normalizedCategory: "property_repairs", amount: 300 },
        { normalizedCategory: "supplies", amount: 150, memo: "Filters" },
      ],
      450,
    );
    expect(result.valid).toBe(true);
    expect(result.value.splits).toHaveLength(2);
    expect(result.value.splits[1]).toMatchObject({ normalizedCategory: "supplies", memo: "Filters" });
  });

  it("rejects an under-sum with the exact difference", () => {
    const result = validateSplits(
      [
        { normalizedCategory: "property_repairs", amount: 300 },
        { normalizedCategory: "supplies", amount: 149.99 },
      ],
      450,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/off by \$-0\.01/);
  });

  it("rejects an over-sum", () => {
    const result = validateSplits([{ normalizedCategory: "property_repairs", amount: 450.01 }], 450);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/off by \$0\.01/);
  });

  it("rejects invalid categories and non-positive amounts per line", () => {
    const result = validateSplits(
      [
        { normalizedCategory: "bogus", amount: 60 },
        { normalizedCategory: "supplies", amount: 0 },
      ],
      100,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3); // bad category, zero amount, sum mismatch
  });

  it("rejects an empty split list", () => {
    const result = validateSplits([], 100);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/at least one split/i);
  });

  it("handles cent-level precision without float drift", () => {
    const result = validateSplits(
      [
        { normalizedCategory: "supplies", amount: 33.33 },
        { normalizedCategory: "utilities", amount: 33.33 },
        { normalizedCategory: "cleaning", amount: 33.34 },
      ],
      100,
    );
    expect(result.valid).toBe(true);
  });
});
