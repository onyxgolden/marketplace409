import { describe, expect, it } from "vitest";
import { resolveCategoryDisplayLabel } from "../categoryDisplayLabel.js";

describe("resolveCategoryDisplayLabel", () => {
  it("uses the curated label when the category is in MANUAL_FINANCIAL_EVENT_CATEGORIES", () => {
    expect(resolveCategoryDisplayLabel("property_repairs")).toBe("Repairs");
  });

  it("title-cases an unrecognized snake_case category as a fallback", () => {
    expect(resolveCategoryDisplayLabel("dining_drinks_restaurants")).toBe("Dining Drinks Restaurants");
    expect(resolveCategoryDisplayLabel("groceries")).toBe("Groceries");
  });
});
