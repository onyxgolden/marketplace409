import { describe, expect, it } from "vitest";

import { describeLeftToSpend } from "@/components/forge/budget/budgetHeadline.js";

describe("describeLeftToSpend", () => {
  it("reports unspent money as positive with a planned-vs-left caption", () => {
    const result = describeLeftToSpend({ leftToSpendCents: 42500, totalPlannedCents: 200000 });
    expect(result.value).toBe("$425");
    expect(result.tone).toBe("positive");
    expect(result.caption).toContain("$425 of $2,000 planned is still unspent");
    expect(result.loaded).toBe(true);
  });

  it("reports overspend as a positive magnitude with an over-budget caption", () => {
    const result = describeLeftToSpend({ leftToSpendCents: -12050, totalPlannedCents: 200000 });
    expect(result.value).toBe("$121");
    expect(result.tone).toBe("negative");
    expect(result.caption).toContain("Over budget by $121");
  });

  it("reports exactly-on-plan with a neutral tone", () => {
    const result = describeLeftToSpend({ leftToSpendCents: 0, totalPlannedCents: 200000 });
    expect(result.value).toBe("$0");
    expect(result.tone).toBe("neutral");
    expect(result.caption).toContain("Right on plan");
  });

  it("handles an empty budget without claiming a plan", () => {
    const result = describeLeftToSpend({ leftToSpendCents: 0, totalPlannedCents: 0 });
    expect(result.caption).toBe("No budget lines yet.");
  });

  it("never fabricates a number for missing input -- the header shows a dash", () => {
    for (const missing of [
      { leftToSpendCents: null, totalPlannedCents: 200000 },
      { leftToSpendCents: 42500, totalPlannedCents: null },
      { leftToSpendCents: undefined, totalPlannedCents: undefined },
      {},
    ]) {
      const result = describeLeftToSpend(missing);
      expect(result.value).toBe("–");
      expect(result.tone).toBe("neutral");
      expect(result.caption).toBeNull();
      expect(result.loaded).toBe(false);
    }
  });
});
