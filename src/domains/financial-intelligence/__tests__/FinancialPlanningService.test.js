import { FinancialPlanningService } from "../FinancialPlanningService.js";

describe("FinancialPlanningService", () => {
  test("builds deterministic planning assistance for healthy financials", () => {
    const service = new FinancialPlanningService();

    const plan = service.buildPlan(
      {
        profit: 30000,
        cash: 25000,
      },
      {
        label: "Healthy",
      },
    );

    expect(plan).toEqual({
      priority: "optimize",
      suggestedFocus: "controlled growth",
      summary: "Optimize operating performance.",
    });

    expect(Object.isFrozen(plan)).toBe(true);
  });

  test("builds deterministic planning assistance for warning financials", () => {
    const service = new FinancialPlanningService();

    const plan = service.buildPlan(
      {
        profit: 30000,
        cash: 25000,
      },
      {
        label: "Warning",
      },
    );

    expect(plan).toEqual({
      priority: "improve",
      suggestedFocus: "controlled growth",
      summary: "Improve financial performance and controls.",
    });

    expect(Object.isFrozen(plan)).toBe(true);
  });

  test("builds deterministic planning assistance for critical financials", () => {
    const service = new FinancialPlanningService();

    const plan = service.buildPlan(
      {
        profit: -1000,
        cash: 0,
      },
      {
        label: "Critical",
      },
    );

    expect(plan).toEqual({
      priority: "stabilize",
      suggestedFocus: "profitability",
      summary: "Stabilize financial resilience and liquidity.",
    });

    expect(Object.isFrozen(plan)).toBe(true);
  });
});
