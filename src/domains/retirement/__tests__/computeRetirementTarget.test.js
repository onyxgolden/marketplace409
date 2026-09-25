import { describe, expect, it } from "vitest";
import computeRetirementTarget from "../computeRetirementTarget";
import { ALLOCATION_PROFILES, allocationProfileById } from "../allocationProfiles";

const BASE = {
  monthlyExpenses: 5000,
  withdrawalRatePct: 4,
  currentAge: 40,
  retirementAge: 65,
  generalInflationPct: 3,
  includeHealthcare: false,
  monthlySSBenefit: 0,
  monthlyRentalCashFlow: 0,
};

describe("computeRetirementTarget", () => {
  it("returns exactly $1,500,000 for $5000/mo, 4%, 40->65, no inflation, no offsets", () => {
    const result = computeRetirementTarget({
      ...BASE,
      generalInflationPct: 0,
    });
    expect(result.requiredNestEgg).toBe(1_500_000);
    expect(result.yearsToRetirement).toBe(25);
    expect(result.portfolioNeedAnnual).toBe(60_000);
  });

  it("compounds inflation correctly (hand-computed)", () => {
    // $1000/mo, 5% withdrawal, age 60->65, 3% general inflation, no offsets:
    // annual spend at retirement = 12,000 * 1.03^5 = 13,911.2889...
    // nest egg = 13,911.2889 / 0.05 = 278,225.7778...
    const result = computeRetirementTarget({
      ...BASE,
      monthlyExpenses: 1000,
      withdrawalRatePct: 5,
      currentAge: 60,
      retirementAge: 65,
      generalInflationPct: 3,
    });
    expect(result.yearsToRetirement).toBe(5);
    expect(result.annualSpendAtRetirement).toBeCloseTo(13911.29, 2);
    expect(result.requiredNestEgg).toBeCloseTo(278225.78, 2);
  });

  it("uses pre-65 healthcare when retiring before 65, post-65 when retiring at 65+", () => {
    const retiringAt60 = computeRetirementTarget({
      ...BASE,
      includeHealthcare: true,
      generalInflationPct: 0,
      healthcareInflationPct: 0,
      currentAge: 40,
      retirementAge: 60,
    });
    expect(retiringAt60.healthcareAnnualAtRetirement).toBe(18000);

    const retiringAt67 = computeRetirementTarget({
      ...BASE,
      includeHealthcare: true,
      generalInflationPct: 0,
      healthcareInflationPct: 0,
      currentAge: 40,
      retirementAge: 67,
    });
    expect(retiringAt67.healthcareAnnualAtRetirement).toBe(6500);

    const off = computeRetirementTarget({ ...BASE, includeHealthcare: false });
    expect(off.healthcareAnnualAtRetirement).toBe(0);
  });

  it("inflates healthcare at the healthcare rate, not the general rate", () => {
    // retire at 65, so post-65 base ($6,500) grown at 5% for 25 years
    const result = computeRetirementTarget({
      ...BASE,
      includeHealthcare: true,
      generalInflationPct: 3,
      healthcareInflationPct: 5,
    });
    expect(result.healthcareAnnualAtRetirement).toBeCloseTo(6500 * 1.05 ** 25, 6);
    // and the informational post-65-at-65 line
    expect(result.post65At65).toBeCloseTo(6500 * 1.05 ** 25, 6);
  });

  it("claiming at 70 pays more than 67 (1.24 factor), and the haircut reduces the benefit", () => {
    const ssInput = {
      ...BASE,
      generalInflationPct: 0,
      monthlySSBenefit: 2000,
      monthlyExpenses: 0,
    };
    const at67 = computeRetirementTarget({ ...ssInput, ssClaimAge: 67 });
    const at70 = computeRetirementTarget({ ...ssInput, ssClaimAge: 70 });
    const at62 = computeRetirementTarget({ ...ssInput, ssClaimAge: 62 });
    expect(at67.ssClaimFactor).toBe(1.0);
    expect(at67.ssAnnualAtRetirement).toBe(24_000);
    expect(at70.ssAnnualAtRetirement).toBe(24_000 * 1.24);
    expect(at62.ssAnnualAtRetirement).toBe(24_000 * 0.7);
    expect(at70.ssAnnualAtRetirement).toBeGreaterThan(at67.ssAnnualAtRetirement);

    const haircut = computeRetirementTarget({ ...ssInput, ssClaimAge: 67, ssHaircut: true });
    expect(haircut.ssAnnualAtRetirement).toBe(24_000 * 0.75);
  });

  it("Social Security and rental income reduce the required nest egg", () => {
    const base = computeRetirementTarget({ ...BASE, generalInflationPct: 0 });
    const withSS = computeRetirementTarget({
      ...BASE,
      generalInflationPct: 0,
      monthlySSBenefit: 1000,
      ssClaimAge: 67,
    });
    // $12k/yr of SS at a 4% withdrawal rate cuts the nest egg by $300k
    expect(base.requiredNestEgg - withSS.requiredNestEgg).toBe(300_000);

    const withRental = computeRetirementTarget({
      ...BASE,
      generalInflationPct: 0,
      monthlyRentalCashFlow: 1000,
    });
    expect(base.requiredNestEgg - withRental.requiredNestEgg).toBe(300_000);
  });

  it("lever deltas point in the good (negative) direction", () => {
    // Retiring at 64 (not 65): the "retire 2 years later" lever crosses the
    // Medicare cliff — healthcare drops from the pre-65 bridge ($18k) to the
    // post-65 cost ($6.5k), which is exactly the employer-coverage cliff the
    // two-phase model exists to capture.
    const result = computeRetirementTarget({
      ...BASE,
      retirementAge: 64,
      generalInflationPct: 0,
      includeHealthcare: true,
      monthlySSBenefit: 2000,
      ssClaimAge: 67,
    });
    expect(result.levers.retireLater2).toBeLessThan(0);
    expect(result.levers.spendLess200).toBeLessThan(0);
    // claim 67 -> 70 saves a real $5,760/yr = $144k at 4%
    expect(result.levers.ssAt70).toBeLessThan(0);
    expect(result.levers.ssAt70).toBeCloseTo(-(5760 / 0.04), 2);
  });

  it("reports 0 lever delta for SS when the claim age is already 70", () => {
    const result = computeRetirementTarget({ ...BASE, monthlySSBenefit: 2000, ssClaimAge: 70 });
    expect(result.levers.ssAt70).toBe(0);
  });

  it("retirementAge <= currentAge means zero years, no inflation scaling", () => {
    const result = computeRetirementTarget({
      ...BASE,
      currentAge: 70,
      retirementAge: 60,
    });
    expect(result.yearsToRetirement).toBe(0);
    expect(result.retirementYear).toBe(new Date().getFullYear());
    expect(result.annualSpendAtRetirement).toBe(60_000);
    expect(result.requiredNestEgg).toBe(1_500_000);
  });

  it("returns nulls safely for a zero or missing withdrawal rate", () => {
    for (const withdrawalRatePct of [0, -1, Number.NaN]) {
      const result = computeRetirementTarget({ ...BASE, withdrawalRatePct });
      expect(result.requiredNestEgg).toBeNull();
      expect(result.levers.retireLater2).toBeNull();
    }
    const missingAge = computeRetirementTarget({ ...BASE, currentAge: Number.NaN });
    expect(missingAge.requiredNestEgg).toBeNull();
  });

  it("declining spending divides by (withdrawal rate + 1%) — $1.5M flat becomes $1.2M", () => {
    // Flat real perpetuity at 4%: 60,000 / 0.04 = 1,500,000.
    // Smile (real spending declining 1%/yr): 60,000 / 0.05 = 1,200,000.
    const flat = computeRetirementTarget({ ...BASE, generalInflationPct: 0 });
    const smile = computeRetirementTarget({ ...BASE, generalInflationPct: 0, spendingSmile: true });
    expect(flat.spendingSmile).toBe(false);
    expect(flat.requiredNestEgg).toBe(1_500_000);
    expect(smile.spendingSmile).toBe(true);
    expect(smile.requiredNestEgg).toBe(1_200_000);
    // The first-year need is identical — only the funded path differs.
    expect(smile.portfolioNeedAnnual).toBe(flat.portfolioNeedAnnual);
  });

  it("declining spending defaults off and levers stay consistent on the declining path", () => {
    const def = computeRetirementTarget({ ...BASE, generalInflationPct: 0 });
    expect(def.spendingSmile).toBe(false);
    expect(def.requiredNestEgg).toBe(1_500_000); // unchanged behavior

    const smile = computeRetirementTarget({ ...BASE, generalInflationPct: 0, spendingSmile: true });
    // $200/mo less = $2,400/yr less need; at the 5% smile divisor that's -$48,000.
    expect(smile.levers.spendLess200).toBe(-48_000);
    // No inflation and no age-driven offsets here, so retiring later changes nothing.
    expect(smile.levers.retireLater2).toBe(0);
  });

  it("declining spending still returns nulls for invalid inputs", () => {
    const result = computeRetirementTarget({ ...BASE, withdrawalRatePct: 0, spendingSmile: true });
    expect(result.requiredNestEgg).toBeNull();
    expect(result.spendingSmile).toBeNull();
    expect(result.levers.retireLater2).toBeNull();
  });

  it("maps allocation profiles to their withdrawal rates", () => {
    expect(ALLOCATION_PROFILES).toHaveLength(3);
    expect(allocationProfileById("conservative")?.withdrawalRatePct).toBe(3.5);
    expect(allocationProfileById("balanced")?.withdrawalRatePct).toBe(4.0);
    expect(allocationProfileById("growth")?.withdrawalRatePct).toBe(4.5);
    expect(allocationProfileById("bogus")).toBeNull();
  });
});
