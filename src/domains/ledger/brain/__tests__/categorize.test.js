import { describe, expect, test } from "vitest";
import {
  amountBand,
  amountBandLabel,
  normalizeDescriptionTokens,
  suggestCategory,
  suggestTopCategory,
  trainCategorizer,
} from "../categorize.js";

// Small fixture mirroring Jason's real patterns: biweekly mortgage, fuel,
// groceries, and an owner-distribution inflow.
function trainingFixture() {
  const items = [];
  for (let i = 0; i < 12; i += 1) {
    items.push({ description: "DUGOOD HOME EQUITY", amount: -1482.5, category: "mortgage_payment" });
  }
  const fuelAmounts = [-42.1, -51.3, -38.75, -47.9, -55.0, -44.2, -49.99, -41.5, -53.25, -46.8];
  for (const amount of fuelAmounts) {
    items.push({ description: "SHELL OIL 57444123", amount, category: "fuel" });
  }
  const groceryAmounts = [-121.4, -98.2, -143.9, -110.05, -87.3, -132.6, -105.75, -118.9];
  for (const amount of groceryAmounts) {
    items.push({ description: "HEB GROCERY #412", amount, category: "groceries" });
  }
  for (let i = 0; i < 5; i += 1) {
    items.push({ description: "VENMO CASHOUT ETHAN", amount: 5000, category: "owner_distribution" });
  }
  return items;
}

describe("normalizeDescriptionTokens", () => {
  test("lowercases, strips punctuation/numbers, drops stopwords", () => {
    expect(normalizeDescriptionTokens("SHELL OIL 57444123").tokens).toEqual(["shell", "oil"]);
    expect(normalizeDescriptionTokens("ACH Debit DUGood Home Equity").tokens).toEqual(["dugood", "home", "equity"]);
  });

  test("handles null/undefined/empty without throwing", () => {
    expect(normalizeDescriptionTokens(null).tokens).toEqual([]);
    expect(normalizeDescriptionTokens(undefined).tokens).toEqual([]);
    expect(normalizeDescriptionTokens("").tokens).toEqual([]);
    expect(normalizeDescriptionTokens(12345).tokens).toEqual([]);
  });
});

describe("amountBand", () => {
  test("separates mortgage-scale from coffee-scale amounts", () => {
    expect(amountBand(-1482.5)).not.toBe(amountBand(-14.82));
    expect(amountBand(-1482.5)).toBe(amountBand(-1500));
  });

  test("returns null for zero, NaN, and non-numeric input", () => {
    expect(amountBand(0)).toBeNull();
    expect(amountBand(Number.NaN)).toBeNull();
    expect(amountBand("abc")).toBeNull();
    expect(amountBand(null)).toBeNull();
  });

  test("band labels are human-readable ranges", () => {
    expect(amountBandLabel(amountBand(-1482.5))).toBe("$1k-$3.2k");
    expect(amountBandLabel(amountBand(-45))).toBe("$32-$100");
  });
});

describe("trainCategorizer", () => {
  test("ignores undecided ('other'/null/empty) categories", () => {
    const model = trainCategorizer([
      { description: "FOO", amount: -10, category: "other" },
      { description: "FOO", amount: -10, category: null },
      { description: "FOO", amount: -10, category: "" },
      { description: "FOO", amount: -10, category: "groceries" },
    ]);
    expect(model.totalCount).toBe(1);
    expect(Object.keys(model.categories)).toEqual(["groceries"]);
  });

  test("handles empty and garbage input without throwing", () => {
    expect(trainCategorizer([]).totalCount).toBe(0);
    expect(trainCategorizer(null).totalCount).toBe(0);
    expect(trainCategorizer([null, 42, "x"]).totalCount).toBe(0);
  });
});

describe("suggestCategory", () => {
  test("empty model yields no suggestions", () => {
    expect(suggestCategory(trainCategorizer([]), { description: "SHELL", amount: -45 })).toEqual([]);
    expect(suggestCategory(null, { description: "SHELL", amount: -45 })).toEqual([]);
  });

  test("exact description re-suggest: high confidence with exact-match reason", () => {
    const model = trainCategorizer(trainingFixture());
    const top = suggestTopCategory(model, { description: "DUGOOD HOME EQUITY", amount: -1482.5 });
    expect(top.category).toBe("mortgage_payment");
    expect(top.confidence).toBeGreaterThanOrEqual(0.95);
    expect(top.reasons[0]).toMatch(/exact description seen 12x/);
  });

  test("near-duplicate description with same amount bucket: correct category, high confidence", () => {
    const model = trainCategorizer(trainingFixture());
    const top = suggestTopCategory(model, { description: "DUGOOD HOME EQUITY PMT", amount: -1482.5 });
    expect(top.category).toBe("mortgage_payment");
    expect(top.confidence).toBeGreaterThan(0.7);
    expect(top.reasons.join(" ")).toMatch(/dugood/);
  });

  test("fuel purchase resolves to fuel with token reason", () => {
    const model = trainCategorizer(trainingFixture());
    const top = suggestTopCategory(model, { description: "SHELL", amount: -48.2 });
    expect(top.category).toBe("fuel");
    expect(top.reasons.join(" ")).toMatch(/shell/);
  });

  test("completely unknown description: low confidence", () => {
    const model = trainCategorizer(trainingFixture());
    const top = suggestTopCategory(model, { description: "QUANTUM BANANA STAND XYZ", amount: -23.45 });
    expect(top === null || top.confidence < 0.5).toBe(true);
  });

  test("sign is respected: outflow at a distribution merchant is not a confident distribution", () => {
    const model = trainCategorizer(trainingFixture());
    const inflow = suggestTopCategory(model, { description: "VENMO CASHOUT", amount: 5000 });
    expect(inflow.category).toBe("owner_distribution");
    expect(inflow.confidence).toBeGreaterThan(0.7);

    const outflow = suggestTopCategory(model, { description: "VENMO CASHOUT", amount: -5000 });
    expect(outflow === null || outflow.category !== "owner_distribution" || outflow.confidence < 0.5).toBe(true);
  });

  test("confidence ordering: clearly-trained item outranks weakly-trained one", () => {
    const model = trainCategorizer(trainingFixture());
    const strong = suggestTopCategory(model, { description: "DUGOOD HOME EQUITY", amount: -1482.5 });
    const weak = suggestTopCategory(model, { description: "HEB", amount: -5000 });
    expect(strong.confidence).toBeGreaterThan(weak?.confidence ?? 1);
  });

  test("empty description falls back to amount-only scoring", () => {
    const model = trainCategorizer(trainingFixture());
    const top = suggestTopCategory(model, { description: "", amount: -1482.5 });
    // $1,482.50 band is unique to the mortgage in this fixture.
    expect(top.category).toBe("mortgage_payment");
  });

  test("never throws on weird items", () => {
    const model = trainCategorizer(trainingFixture());
    expect(() => suggestCategory(model, null)).not.toThrow();
    expect(() => suggestCategory(model, {})).not.toThrow();
    expect(() => suggestCategory(model, { description: null, amount: "abc" })).not.toThrow();
    expect(suggestCategory(model, null)).toEqual(expect.any(Array));
  });

  test("ranked output is sorted and capped, runners-up carry lower confidence", () => {
    const model = trainCategorizer(trainingFixture());
    const ranked = suggestCategory(model, { description: "DUGOOD HOME EQUITY", amount: -1482.5 });
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i].confidence).toBeLessThanOrEqual(ranked[0].confidence);
    }
    for (const entry of ranked) {
      expect(entry.confidence).toBeGreaterThanOrEqual(0);
      expect(entry.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(entry.reasons)).toBe(true);
      expect(entry.reasons.length).toBeLessThanOrEqual(2);
    }
  });
});
