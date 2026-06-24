import { describe, expect, test } from "vitest";

import { categoryNormalizer } from "../category-normalizer";

describe("CategoryNormalizer", () => {
  test("normalizes rental income", () => {
    const result = categoryNormalizer.normalize(
      "Rental Income (Rentec EasyPay)"
    );

    expect(result.normalizedCategory).toBe("rental_income");
    expect(result.transactionKind).toBe("income");
    expect(result.affectsNOI).toBe(true);
  });

  test("normalizes repairs", () => {
    const result = categoryNormalizer.normalize(
      "Repairs (Capital Plumbing)"
    );

    expect(result.normalizedCategory).toBe("property_repairs");
    expect(result.transactionKind).toBe("expense");
    expect(result.taxDeductible).toBe(true);
  });

  test("detects real estate purchase", () => {
    const result = categoryNormalizer.normalize(
      "Commissions (Purchase Price)"
    );

    expect(result.normalizedCategory).toBe("real_estate_purchase");
    expect(result.transactionKind).toBe("asset_purchase");
    expect(result.capitalized).toBe(true);
  });

  test("returns other for unknown categories", () => {
    const result = categoryNormalizer.normalize(
      "Completely Unknown Category"
    );

    expect(result.normalizedCategory).toBe("other");
    expect(result.transactionKind).toBe("expense");
  });

  test("extracts base category", () => {
    expect(
      categoryNormalizer.extractBaseCategory(
        "Repairs (TJ Morgan Plumbing)"
      )
    ).toBe("Repairs");
  });
});
