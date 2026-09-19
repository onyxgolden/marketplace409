import { describe, expect, it } from "vitest";

import {
  DEBT_PAYOFF_SUGGESTIONS_PREFERENCE,
  STRATEGY_AVALANCHE,
  classifyDebtTerms,
  compareDebtPayoffStrategies,
  effectiveApr,
  optimizeDebtPayoff,
} from "../debtPayoff.js";

const debt = (overrides = {}) => ({
  id: "d1",
  name: "Test Card",
  balance: 1000,
  apr: 12,
  minimumPayment: 50,
  ...overrides,
});

describe("classifyDebtTerms", () => {
  it("splits eligible debts from ones missing terms without guessing", () => {
    const { eligible, needsTerms } = classifyDebtTerms([
      debt({ id: "ok" }),
      debt({ id: "no-apr", apr: null }),
      debt({ id: "no-min", minimumPayment: 0 }),
      debt({ id: "paid-off", balance: 0 }),
      debt({ id: "garbage", balance: "nonsense" }),
    ]);
    expect(eligible.map((d) => d.id)).toEqual(["ok"]);
    expect(needsTerms.map((d) => d.id)).toEqual(["no-apr", "no-min"]);
    expect(needsTerms[0]).toMatchObject({ missingApr: true, missingMinimum: false });
    expect(needsTerms[1]).toMatchObject({ missingApr: false, missingMinimum: true });
  });

  it("returns empty lists for empty input without throwing", () => {
    expect(classifyDebtTerms()).toEqual({ eligible: [], needsTerms: [] });
    expect(classifyDebtTerms([])).toEqual({ eligible: [], needsTerms: [] });
  });
});

describe("effectiveApr", () => {
  it("reduces the sticker rate for deductible debts", () => {
    expect(effectiveApr({ apr: 8, taxDeductible: true }, 0.25)).toBe(6);
  });

  it("keeps the sticker rate without a tax rate or deduction", () => {
    expect(effectiveApr({ apr: 8, taxDeductible: true }, 0)).toBe(8);
    expect(effectiveApr({ apr: 7, taxDeductible: false }, 0.25)).toBe(7);
  });
});

describe("optimizeDebtPayoff", () => {
  it("pays a zero-APR debt in month one when the surplus covers it, with no interest", () => {
    const plan = optimizeDebtPayoff({
      debts: [debt({ balance: 1000, apr: 0, minimumPayment: 100 })],
      monthlySurplus: 900,
      strategy: STRATEGY_AVALANCHE,
    });
    expect(plan.converged).toBe(true);
    expect(plan.monthsToDebtFree).toBe(1);
    expect(plan.totalInterest).toBe(0);
    expect(plan.order[0].payoffMonth).toBe(1);
  });

  it("converges a single debt on minimums with positive interest", () => {
    const plan = optimizeDebtPayoff({
      debts: [debt({ balance: 1200, apr: 12, minimumPayment: 100 })],
      monthlySurplus: 0,
    });
    expect(plan.converged).toBe(true);
    expect(plan.monthsToDebtFree).toBeGreaterThan(0);
    expect(plan.totalInterest).toBeGreaterThan(0);
    expect(plan.order[0].payoffMonth).toBe(plan.monthsToDebtFree);
  });

  it("orders avalanche by rate and snowball by balance", () => {
    const debts = [
      debt({ id: "a", name: "High rate", balance: 1000, apr: 24, minimumPayment: 50 }),
      debt({ id: "b", name: "Low rate", balance: 500, apr: 6, minimumPayment: 25 }),
    ];
    const avalanche = optimizeDebtPayoff({ debts, monthlySurplus: 100, strategy: "avalanche" });
    const snowball = optimizeDebtPayoff({ debts, monthlySurplus: 100, strategy: "snowball" });
    expect(avalanche.order.map((o) => o.id)).toEqual(["a", "b"]);
    expect(snowball.order.map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("orders avalanche by after-tax effective rate when a debt is deductible", () => {
    const debts = [
      debt({ id: "x", name: "Mortgage", balance: 5000, apr: 8, minimumPayment: 100, taxDeductible: true }),
      debt({ id: "y", name: "Card", balance: 5000, apr: 7, minimumPayment: 100 }),
    ];
    const withTax = optimizeDebtPayoff({ debts, monthlySurplus: 200, marginalTaxRate: 0.25 });
    expect(withTax.order.map((o) => o.id)).toEqual(["y", "x"]);
    expect(withTax.eligible.find((d) => d.id === "x").effectiveApr).toBe(6);
    const noTax = optimizeDebtPayoff({ debts, monthlySurplus: 200, marginalTaxRate: 0 });
    expect(noTax.order.map((o) => o.id)).toEqual(["x", "y"]);
  });

  it("flags minimums that never cover interest instead of simulating forever", () => {
    const plan = optimizeDebtPayoff({
      debts: [debt({ balance: 10000, apr: 24, minimumPayment: 50 })],
      monthlySurplus: 0,
    });
    expect(plan.converged).toBe(false);
    expect(plan.monthsToDebtFree).toBeNull();
  });

  it("returns a clean empty plan when nothing is eligible", () => {
    const plan = optimizeDebtPayoff({ debts: [debt({ apr: null })], monthlySurplus: 500 });
    expect(plan.eligible).toEqual([]);
    expect(plan.order).toEqual([]);
    expect(plan.needsTerms).toHaveLength(1);
  });
});

describe("compareDebtPayoffStrategies", () => {
  const debts = [
    debt({ id: "a", name: "High rate", balance: 1000, apr: 24, minimumPayment: 50 }),
    debt({ id: "b", name: "Low rate", balance: 500, apr: 6, minimumPayment: 25 }),
  ];

  it("ranks avalanche cheapest, then snowball, then minimums", () => {
    const comparison = compareDebtPayoffStrategies({ debts, monthlySurplus: 100 });
    const { avalanche, snowball, minimums } = comparison.strategies;
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
    expect(snowball.totalInterest).toBeLessThan(minimums.totalInterest);
    expect(comparison.interestSavedVsMinimums.avalanche).toBeGreaterThanOrEqual(
      comparison.interestSavedVsMinimums.snowball,
    );
    expect(comparison.interestSavedVsMinimums.snowball).toBeGreaterThan(0);
  });

  it("produces a top move naming the highest-rate debt and its savings", () => {
    const comparison = compareDebtPayoffStrategies({ debts, monthlySurplus: 100 });
    expect(comparison.topMove).toMatchObject({
      debtId: "a",
      debtName: "High rate",
      extraPerMonth: 100,
      strategy: STRATEGY_AVALANCHE,
    });
    expect(comparison.topMove.interestSaved).toBeGreaterThan(0);
    expect(comparison.topMove.monthsSaved).toBeGreaterThan(0);
  });

  it("stays silent (no top move, null savings) when minimums never converge", () => {
    const comparison = compareDebtPayoffStrategies({
      debts: [debt({ balance: 10000, apr: 24, minimumPayment: 50 })],
      monthlySurplus: 0,
    });
    expect(comparison.topMove).toBeNull();
    expect(comparison.interestSavedVsMinimums.avalanche).toBeNull();
  });

  it("stays silent when there is no surplus to allocate", () => {
    const comparison = compareDebtPayoffStrategies({ debts, monthlySurplus: 0 });
    expect(comparison.topMove).toBeNull();
  });

  it("exposes the suggestions preference key", () => {
    expect(DEBT_PAYOFF_SUGGESTIONS_PREFERENCE).toBe("debt_payoff_suggestions_enabled");
  });
});
