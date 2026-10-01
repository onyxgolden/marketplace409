import { describe, expect, it } from "vitest";
import {
  ASSET_CATEGORIES,
  DEPRECIATION_METHODS,
  computeDepreciationSchedule,
  computePropertyDepreciationReport,
  depreciableBasisCents,
  groupScheduleByYear,
  scheduleSummary,
  validateDepreciationAsset,
} from "../depreciation";

const cents = (dollars) => Math.round(dollars * 100);

function asset(overrides = {}) {
  return {
    id: "a1",
    description: "Test asset",
    category: "appliance",
    placed_in_service: "2026-07-15",
    cost_basis_cents: cents(12000),
    method: "straight_line",
    useful_life_months: 60,
    salvage_value_cents: 0,
    ...overrides,
  };
}

describe("depreciation asset validation", () => {
  it("accepts a well-formed asset and normalizes MACRS life to the preset", () => {
    const result = validateDepreciationAsset({
      description: " Roof replacement ",
      category: "improvement",
      placed_in_service: "2026-03-01",
      cost_basis_cents: cents(18000),
      method: "macrs_27_5",
      useful_life_months: 12, // ignored — preset wins
      salvage_value_cents: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.clean.description).toBe("Roof replacement");
    expect(result.clean.useful_life_months).toBe(330);
    expect(result.clean.salvage_value_cents).toBe(0);
  });

  it("requires a placed-in-service date", () => {
    expect(validateDepreciationAsset({ description: "x", cost_basis_cents: 100, useful_life_months: 12 }).ok).toBe(false);
    expect(validateDepreciationAsset({ description: "x", placed_in_service: "not-a-date", cost_basis_cents: 100, useful_life_months: 12 }).error)
      .toMatch(/Placed-in-service date is required/);
  });

  it("requires cost basis above zero", () => {
    const base = { description: "x", placed_in_service: "2026-01-01", useful_life_months: 12 };
    expect(validateDepreciationAsset({ ...base, cost_basis_cents: 0 }).ok).toBe(false);
    expect(validateDepreciationAsset({ ...base, cost_basis_cents: -500 }).error).toMatch(/Cost basis must be a positive amount/);
  });

  it("requires a positive useful life for straight line", () => {
    const base = { description: "x", placed_in_service: "2026-01-01", cost_basis_cents: 100 };
    expect(validateDepreciationAsset({ ...base, useful_life_months: 0 }).error).toMatch(/Useful life must be a positive number/);
  });

  it("rejects salvage at or above cost basis", () => {
    const result = validateDepreciationAsset({
      description: "x", placed_in_service: "2026-01-01", cost_basis_cents: 1000,
      useful_life_months: 12, salvage_value_cents: 1000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Salvage value must be less than the cost basis/);
  });

  it("rejects unknown methods and categories", () => {
    const base = { description: "x", placed_in_service: "2026-01-01", cost_basis_cents: 100, useful_life_months: 12 };
    expect(validateDepreciationAsset({ ...base, method: "double_declining" }).error).toMatch(/Unsupported depreciation method/);
    expect(validateDepreciationAsset({ ...base, category: "yacht" }).ok).toBe(false);
  });

  it("documents the supported methods", () => {
    expect(Object.keys(DEPRECIATION_METHODS).sort()).toEqual(["macrs_27_5", "macrs_39", "straight_line"]);
    expect(DEPRECIATION_METHODS.macrs_27_5.presetLifeMonths).toBe(330);
    expect(DEPRECIATION_METHODS.macrs_39.presetLifeMonths).toBe(468);
    expect(ASSET_CATEGORIES.map((c) => c.code)).toContain("building");
  });
});

describe("straight-line schedule engine", () => {
  it("computes even monthly depreciation", () => {
    const schedule = computeDepreciationSchedule(asset());
    expect(schedule).toHaveLength(60);
    expect(schedule.every((e) => e.depreciationCents === cents(200))).toBe(true);
  });

  it("prorates the first calendar year when placed in service mid-year", () => {
    const byYear = groupScheduleByYear(computeDepreciationSchedule(asset()));
    const year2026 = byYear.find((row) => row.year === 2026);
    // Placed 2026-07-15 → July..December = 6 months.
    expect(year2026.totalCents).toBe(cents(1200));
    expect(year2026.months.map((m) => m.month)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it("handles a partial final year", () => {
    const byYear = groupScheduleByYear(computeDepreciationSchedule(asset()));
    const year2031 = byYear.find((row) => row.year === 2031);
    // 60 months from Jul 2026 → Jan..Jun 2031.
    expect(year2031.totalCents).toBe(cents(1200));
  });

  it("sums exactly to the depreciable basis via largest remainder", () => {
    // $100 over 3 months: 10000 cents / 6 half-month units does not divide evenly.
    const schedule = computeDepreciationSchedule(asset({
      cost_basis_cents: cents(100), useful_life_months: 3, placed_in_service: "2026-01-10",
    }));
    expect(schedule).toHaveLength(3);
    const amounts = schedule.map((e) => e.depreciationCents);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(cents(100));
    // Largest remainder: leftover cents land on the earliest periods.
    expect(amounts).toEqual([3334, 3334, 3332]);
    // Every entry is whole cents by construction.
    expect(amounts.every((a) => Number.isInteger(a))).toBe(true);
  });

  it("subtracts salvage value before scheduling", () => {
    const schedule = computeDepreciationSchedule(asset({
      cost_basis_cents: cents(12000), salvage_value_cents: cents(2000), useful_life_months: 50,
    }));
    expect(schedule.reduce((a, e) => a + e.depreciationCents, 0)).toBe(cents(10000));
  });
});

describe("MACRS presets", () => {
  it("macrs_27_5 totals exactly and uses the mid-month convention", () => {
    const schedule = computeDepreciationSchedule(asset({
      method: "macrs_27_5", useful_life_months: 330, placed_in_service: "2026-01-20",
      cost_basis_cents: cents(275000),
    }));
    // 330 months + the leftover half-month in period 331.
    expect(schedule).toHaveLength(331);
    expect(schedule.reduce((a, e) => a + e.depreciationCents, 0)).toBe(cents(275000));
    // First period is a half month; second is a full month (~2x the first).
    expect(schedule[0].depreciationCents).toBeLessThan(schedule[1].depreciationCents);
    const summary = scheduleSummary(asset({ method: "macrs_27_5", useful_life_months: 330 }));
    expect(summary.sumsToBasisExactly).toBe(true);
  });

  it("macrs_39 spans 469 periods and sums exactly", () => {
    const schedule = computeDepreciationSchedule(asset({
      method: "macrs_39", useful_life_months: 468, placed_in_service: "2026-06-01",
      cost_basis_cents: cents(390000),
    }));
    expect(schedule).toHaveLength(469);
    expect(schedule.reduce((a, e) => a + e.depreciationCents, 0)).toBe(cents(390000));
    // Year 1 prorated: June..December.
    const year1 = groupScheduleByYear(schedule).find((row) => row.year === 2026);
    expect(year1.months).toHaveLength(7);
  });
});

describe("MACRS salvage handling (tax depreciation ignores salvage)", () => {
  it("normalizes a submitted salvage to zero for MACRS presets", () => {
    for (const method of ["macrs_27_5", "macrs_39"]) {
      const result = validateDepreciationAsset({
        description: "Building", placed_in_service: "2026-01-15",
        cost_basis_cents: cents(275000), method, useful_life_months: 12,
        salvage_value_cents: cents(50000),
      });
      expect(result.ok).toBe(true);
      expect(result.clean.salvage_value_cents).toBe(0);
    }
  });

  it("ignores a nonzero stored salvage in the MACRS schedule (regression)", () => {
    // Rows carrying nonzero salvage must still recover the full cost basis
    // under a MACRS preset — MACRS does not reduce basis by salvage value.
    const stored = asset({
      method: "macrs_27_5", useful_life_months: 330, placed_in_service: "2026-01-20",
      cost_basis_cents: cents(275000), salvage_value_cents: cents(50000),
    });
    const schedule = computeDepreciationSchedule(stored);
    expect(schedule.reduce((a, e) => a + e.depreciationCents, 0)).toBe(cents(275000));
    const summary = scheduleSummary(stored);
    expect(summary.depreciableBasisCents).toBe(cents(275000));
    expect(summary.sumsToBasisExactly).toBe(true);
    const report = computePropertyDepreciationReport({ assets: [stored], year: 2026 });
    expect(report.assets[0].depreciableBasisCents).toBe(cents(275000));
  });

  it("keeps subtracting salvage for straight line", () => {
    expect(depreciableBasisCents(asset({
      cost_basis_cents: cents(12000), salvage_value_cents: cents(2000),
    }))).toBe(cents(10000));
    expect(depreciableBasisCents(asset({
      method: "macrs_39", cost_basis_cents: cents(12000), salvage_value_cents: cents(2000),
    }))).toBe(cents(12000));
  });
});

describe("property depreciation report", () => {
  const roof = asset({
    id: "roof", description: "Roof", category: "improvement",
    placed_in_service: "2026-03-01", cost_basis_cents: cents(12000), useful_life_months: 120,
  });
  const fridge = asset({
    id: "fridge", description: "Refrigerator", category: "appliance",
    placed_in_service: "2026-07-01", cost_basis_cents: cents(1200), useful_life_months: 60,
  });

  it("aggregates per-year depreciation, accumulated, and book value per asset", () => {
    const report = computePropertyDepreciationReport({ assets: [roof, fridge], year: 2026 });
    const roofRow = report.assets.find((r) => r.id === "roof");
    // Roof: 12000/120 = $100/mo, Mar..Dec 2026 = 10 months.
    expect(roofRow.depreciationTakenCents).toBe(cents(1000));
    expect(roofRow.accumulatedCents).toBe(cents(1000));
    expect(roofRow.remainingBookValueCents).toBe(cents(11000));
    const fridgeRow = report.assets.find((r) => r.id === "fridge");
    // Fridge: 1200/60 = $20/mo, Jul..Dec 2026 = 6 months.
    expect(fridgeRow.depreciationTakenCents).toBe(cents(120));
    expect(report.totals.depreciationTakenCents).toBe(cents(1120));
    expect(report.totals.remainingBookValueCents).toBe(cents(11000) + cents(1080));
  });

  it("accumulates across years", () => {
    const report = computePropertyDepreciationReport({ assets: [roof], year: 2027 });
    const roofRow = report.assets[0];
    expect(roofRow.depreciationTakenCents).toBe(cents(1200));
    expect(roofRow.accumulatedCents).toBe(cents(2200));
  });

  it("reports zero for a year before the asset was placed", () => {
    const report = computePropertyDepreciationReport({ assets: [roof], year: 2025 });
    expect(report.assets[0].depreciationTakenCents).toBe(0);
    expect(report.assets[0].accumulatedCents).toBe(0);
    expect(report.assets[0].remainingBookValueCents).toBe(cents(12000));
  });

  it("rejects an invalid report year", () => {
    expect(() => computePropertyDepreciationReport({ assets: [], year: "soon" })).toThrow(/valid year/);
  });
});
