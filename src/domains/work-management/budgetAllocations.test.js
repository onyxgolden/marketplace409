import { describe, expect, it } from "vitest";
import {
  BUDGET_CATEGORIES,
  BUDGET_CATEGORY_VALUES,
  MAX_BUDGET_LINES,
  budgetCategoryColor,
  budgetCategoryLabel,
  computeLaborVariance,
  isBudgetCategory,
  parseBudgetLineAmountToCents,
  summarizeCostSplit,
  validateBudgetAllocationInput,
  validateBudgetAllocationRetireInput,
  validateBudgetLine,
} from "./budgetAllocations.js";

const PKG_A = { id: "pkg_a" };
const PKG_B = { id: "pkg_b" };

function reconciledEntry({ estimateCents, categoryTotals, estimateId = "est_1", estimateVersion = 1 }) {
  return {
    estimate: { id: estimateId, version: estimateVersion, currentEstimateCents: estimateCents },
    allocation: {
      id: "alloc_1",
      version: 1,
      estimateId,
      estimateVersion,
      categoryTotals,
    },
    reconciled: true,
    reason: null,
  };
}

describe("budget categories", () => {
  it("is exactly five fixed categories, labor first and rental last", () => {
    expect(BUDGET_CATEGORY_VALUES).toEqual([
      "labor",
      "material",
      "equipment",
      "external_services",
      "rental",
    ]);
    expect(BUDGET_CATEGORIES).toHaveLength(5);
    expect(BUDGET_CATEGORIES[0].label).toBe("Labor");
    expect(BUDGET_CATEGORIES[4].label).toBe("Rental");
  });

  it("rejects anything outside the five, including craft and change-order words", () => {
    expect(isBudgetCategory("labor")).toBe(true);
    expect(isBudgetCategory("craft")).toBe(false);
    expect(isBudgetCategory("change_order")).toBe(false);
    expect(isBudgetCategory("Labor")).toBe(false);
    expect(isBudgetCategory(null)).toBe(false);
    expect(budgetCategoryLabel("external_services")).toBe("External services");
    expect(budgetCategoryColor("labor")).toBe("#2563eb");
  });
});

describe("validateBudgetLine", () => {
  it("accepts a valid line in each category", () => {
    for (const category of BUDGET_CATEGORY_VALUES) {
      const checked = validateBudgetLine({ category, description: "Pipe", amountCents: 100 });
      expect(checked.ok).toBe(true);
      expect(checked.value.amountCents).toBe(100);
    }
  });

  it("rejects a bad category, an empty or long description, markup, and control characters", () => {
    expect(validateBudgetLine({ category: "craft", description: "x", amountCents: 1 }).ok).toBe(false);
    expect(validateBudgetLine({ category: "labor", description: "  ", amountCents: 1 }).ok).toBe(false);
    expect(validateBudgetLine({ category: "labor", description: "x".repeat(201), amountCents: 1 }).ok).toBe(false);
    expect(validateBudgetLine({ category: "labor", description: "<b>bold</b>", amountCents: 1 }).ok).toBe(false);
    expect(validateBudgetLine({ category: "labor", description: "a\tb", amountCents: 1 }).ok).toBe(false);
  });

  it("rejects zero, negative, fractional, and unsafe amounts", () => {
    expect(validateBudgetLine({ category: "labor", description: "x", amountCents: 0 }).ok).toBe(false);
    expect(validateBudgetLine({ category: "labor", description: "x", amountCents: -5 }).ok).toBe(false);
    expect(validateBudgetLine({ category: "labor", description: "x", amountCents: 1.5 }).ok).toBe(false);
    expect(validateBudgetLine({ category: "labor", description: "x", amountCents: Number.MAX_SAFE_INTEGER + 1 }).ok).toBe(false);
    expect(validateBudgetLine({ category: "labor", description: "x", amountCents: "100" }).ok).toBe(false);
  });
});

describe("validateBudgetAllocationInput", () => {
  const base = {
    expectedAllocationVersion: 0,
    expectedEstimateId: "est_1",
    expectedEstimateVersion: 1,
    reason: "First allocation",
    lines: [{ category: "labor", description: "Crew", amountCents: 5000 }],
  };

  it("accepts a create (version 0) and an update (version >= 1)", () => {
    expect(validateBudgetAllocationInput(base).ok).toBe(true);
    expect(validateBudgetAllocationInput({ ...base, expectedAllocationVersion: 3 }).ok).toBe(true);
    expect(validateBudgetAllocationInput({ ...base, expectedAllocationVersion: null }).ok).toBe(true);
  });

  it("requires the estimate binding and a reason", () => {
    expect(validateBudgetAllocationInput({ ...base, expectedEstimateId: "" }).ok).toBe(false);
    expect(validateBudgetAllocationInput({ ...base, expectedEstimateVersion: 0 }).ok).toBe(false);
    expect(validateBudgetAllocationInput({ ...base, reason: "   " }).ok).toBe(false);
    expect(validateBudgetAllocationInput({ ...base, reason: "x".repeat(1001) }).ok).toBe(false);
  });

  it("rejects more than 100 lines and duplicate submitted line ids", () => {
    const many = Array.from({ length: MAX_BUDGET_LINES + 1 }, (_, i) => ({
      category: "labor", description: `Line ${i}`, amountCents: 1,
    }));
    expect(validateBudgetAllocationInput({ ...base, lines: many }).ok).toBe(false);
    const dupes = [
      { id: "line_1", category: "labor", description: "A", amountCents: 1 },
      { id: "line_1", category: "material", description: "B", amountCents: 1 },
    ];
    expect(validateBudgetAllocationInput({ ...base, lines: dupes }).ok).toBe(false);
  });

  it("rejects a bad line inside the set", () => {
    expect(validateBudgetAllocationInput({
      ...base,
      lines: [{ category: "labor", description: "Crew", amountCents: 0 }],
    }).ok).toBe(false);
  });
});

describe("validateBudgetAllocationRetireInput", () => {
  it("requires a version of 1 or more and a reason", () => {
    expect(validateBudgetAllocationRetireInput({ expectedVersion: 2, reason: "Wrong split" }).ok).toBe(true);
    expect(validateBudgetAllocationRetireInput({ expectedVersion: 0, reason: "x" }).ok).toBe(false);
    expect(validateBudgetAllocationRetireInput({ expectedVersion: 1, reason: "" }).ok).toBe(false);
  });
});

describe("parseBudgetLineAmountToCents", () => {
  it("parses dollars to exact cents", () => {
    expect(parseBudgetLineAmountToCents("1250.00")).toEqual({ ok: true, cents: 125000 });
    expect(parseBudgetLineAmountToCents("$1,250.50")).toEqual({ ok: true, cents: 125050 });
    expect(parseBudgetLineAmountToCents("0.01")).toEqual({ ok: true, cents: 1 });
  });

  it("rejects zero, negatives, and extra decimals", () => {
    expect(parseBudgetLineAmountToCents("0").ok).toBe(false);
    expect(parseBudgetLineAmountToCents("0.00").ok).toBe(false);
    expect(parseBudgetLineAmountToCents("-5").ok).toBe(false);
    expect(parseBudgetLineAmountToCents("10.999").ok).toBe(false);
    expect(parseBudgetLineAmountToCents("abc").ok).toBe(false);
    expect(parseBudgetLineAmountToCents("").ok).toBe(false);
  });
});

describe("summarizeCostSplit", () => {
  it("reports unavailable (never a false zero) when the snapshot is missing", () => {
    const summary = summarizeCostSplit({ packages: [PKG_A], costByPackage: null });
    expect(summary.unavailable).toBe(true);
    expect(summary.complete).toBe(false);
    expect(summary.totalControlEstimateCents).toBe(0);
    expect(summary.hasControlEstimate).toBe(false);
  });

  it("sums the five categories exactly to the strip when every estimate is reconciled", () => {
    const summary = summarizeCostSplit({
      packages: [PKG_A, PKG_B],
      costByPackage: {
        pkg_a: reconciledEntry({
          estimateCents: 100000,
          categoryTotals: { labor: 40000, material: 30000, equipment: 15000, external_services: 10000, rental: 5000 },
        }),
        pkg_b: reconciledEntry({
          estimateCents: 50000,
          categoryTotals: { labor: 20000, material: 15000, equipment: 10000, external_services: 3000, rental: 2000 },
          estimateId: "est_2",
        }),
      },
    });
    expect(summary.unavailable).toBe(false);
    expect(summary.complete).toBe(true);
    expect(summary.totalControlEstimateCents).toBe(150000);
    expect(summary.categoryTotals).toEqual({
      labor: 60000, material: 45000, equipment: 25000, external_services: 13000, rental: 7000,
    });
    const fiveSum = Object.values(summary.categoryTotals).reduce((a, b) => a + b, 0);
    expect(fiveSum).toBe(summary.totalControlEstimateCents);
    expect(summary.categoryPackageCounts).toEqual({
      labor: 2, material: 2, equipment: 2, external_services: 2, rental: 2,
    });
  });

  it("counts overlapping category packages without adding them together", () => {
    const summary = summarizeCostSplit({
      packages: [PKG_A],
      costByPackage: {
        pkg_a: reconciledEntry({
          estimateCents: 10000,
          categoryTotals: { labor: 10000, material: 0, equipment: 0, external_services: 0, rental: 0 },
        }),
      },
    });
    expect(summary.categoryPackageCounts.labor).toBe(1);
    expect(summary.categoryPackageCounts.material).toBe(0);
    expect(summary.complete).toBe(true);
  });

  it("excludes packages without an estimate from the strip and never blocks reconciliation on them", () => {
    const summary = summarizeCostSplit({
      packages: [PKG_A, PKG_B],
      costByPackage: {
        pkg_a: reconciledEntry({
          estimateCents: 10000,
          categoryTotals: { labor: 10000, material: 0, equipment: 0, external_services: 0, rental: 0 },
        }),
        pkg_b: { estimate: null, allocation: null, reconciled: false, reason: "no_estimate" },
      },
    });
    expect(summary.complete).toBe(true);
    expect(summary.totalControlEstimateCents).toBe(10000);
    expect(summary.noEstimatePackageCount).toBe(1);
    expect(summary.estimatedPackageCount).toBe(1);
  });

  it("reports missing and stale allocations as incomplete with the exact unallocated amount", () => {
    const summary = summarizeCostSplit({
      packages: [PKG_A, PKG_B],
      costByPackage: {
        pkg_a: reconciledEntry({
          estimateCents: 10000,
          categoryTotals: { labor: 10000, material: 0, equipment: 0, external_services: 0, rental: 0 },
        }),
        pkg_b: {
          estimate: { id: "est_2", version: 3, currentEstimateCents: 25000 },
          allocation: {
            id: "alloc_2", version: 1, estimateId: "est_2", estimateVersion: 2,
            categoryTotals: { labor: 25000, material: 0, equipment: 0, external_services: 0, rental: 0 },
          },
          reconciled: false,
          reason: "stale",
        },
      },
    });
    expect(summary.complete).toBe(false);
    expect(summary.unallocatedPackageCount).toBe(1);
    expect(summary.unallocatedEstimateCents).toBe(25000);
    // The stale package's lines never enter the five-way totals.
    expect(summary.categoryTotals.labor).toBe(10000);
    expect(summary.totalControlEstimateCents).toBe(35000);
  });

  it("never treats a stale binding as reconciled", () => {
    const summary = summarizeCostSplit({
      packages: [PKG_A],
      costByPackage: {
        pkg_a: {
          estimate: { id: "est_1", version: 2, currentEstimateCents: 10000 },
          allocation: {
            id: "alloc_1", version: 1, estimateId: "est_1", estimateVersion: 1,
            categoryTotals: { labor: 10000, material: 0, equipment: 0, external_services: 0, rental: 0 },
          },
          reconciled: false,
          reason: "stale",
        },
      },
    });
    expect(summary.perPackage.pkg_a.reconciled).toBe(false);
    expect(summary.complete).toBe(false);
  });
});

describe("computeLaborVariance", () => {
  it("reports over, under, and matching with exact cents", () => {
    expect(computeLaborVariance({ laborBudgetCents: 120000, plannedLaborForecastCents: 100000 }))
      .toEqual(expect.objectContaining({ varianceCents: 20000, wording: "over the planned labor estimate" }));
    expect(computeLaborVariance({ laborBudgetCents: 90000, plannedLaborForecastCents: 100000 }))
      .toEqual(expect.objectContaining({ varianceCents: -10000, wording: "under the planned labor estimate" }));
    expect(computeLaborVariance({ laborBudgetCents: 100000, plannedLaborForecastCents: 100000 }))
      .toEqual(expect.objectContaining({ varianceCents: 0, wording: "matches the planned labor estimate" }));
  });

  it("returns nulls when either side is unknown", () => {
    expect(computeLaborVariance({ laborBudgetCents: null, plannedLaborForecastCents: 100000 }).varianceCents).toBe(null);
    expect(computeLaborVariance({ laborBudgetCents: 100000, plannedLaborForecastCents: null }).varianceCents).toBe(null);
  });
});
