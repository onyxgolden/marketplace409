import { describe, it, expect } from "vitest";
import { BudgetTracker, lowerBudgets } from "../src/budget.mjs";
import { BUDGETS, REASON } from "../src/constants.mjs";

describe("BudgetTracker", () => {
  it("charges reads and context within budget", () => {
    const b = new BudgetTracker({ ...BUDGETS, maxScopedReads: 3, maxBytesPerFile: 100, maxTotalContextBytes: 250 });
    expect(b.chargeRead(100)).toBeNull();
    expect(b.chargeRead(100)).toBeNull();
    expect(b.usage().reads).toBe(2);
  });

  it("fails closed on too many reads", () => {
    const b = new BudgetTracker({ ...BUDGETS, maxScopedReads: 1 });
    expect(b.chargeRead(10)).toBeNull();
    const f = b.chargeRead(10);
    expect(f.reason).toBe(REASON.BUDGET_EXCEEDED);
    // sticky: stays failed
    expect(b.chargeRead(10)).toBe(f);
  });

  it("fails closed on an oversized single file", () => {
    const b = new BudgetTracker({ ...BUDGETS, maxBytesPerFile: 10 });
    const f = b.chargeRead(11);
    expect(f.reason).toBe(REASON.BUDGET_EXCEEDED);
  });

  it("fails closed on too many profiles", () => {
    const b = new BudgetTracker({ ...BUDGETS, maxProfiles: 2 });
    expect(b.chargeProfile()).toBeNull();
    expect(b.chargeProfile()).toBeNull();
    expect(b.chargeProfile().reason).toBe(REASON.BUDGET_EXCEEDED);
  });

  it("fails closed on wall-clock overrun", () => {
    const b = new BudgetTracker({ ...BUDGETS, totalWallMs: 100 }, 1000);
    expect(b.checkWall(1050)).toBeNull();
    expect(b.checkWall(1200).reason).toBe(REASON.BUDGET_EXCEEDED);
  });
});

describe("lowerBudgets", () => {
  it("takes the minimum of base and overrides", () => {
    const out = lowerBudgets({ maxScopedReads: 40, maxProfiles: 3 }, { maxScopedReads: 5, maxProfiles: 9 });
    expect(out.maxScopedReads).toBe(5);
    expect(out.maxProfiles).toBe(3);
  });
});
