import { FinancialOperationsApplication } from "./FinancialOperationsApplication.js";

describe("FinancialOperationsApplication", () => {
  function buildFinancialIntelligenceApplication() {
    return {
      buildFinancialIntelligence: vi.fn(() => ({
        type: "financial-intelligence",
        trendAnalysis: {
          profitability: "positive",
          liquidity: "cash-positive",
          leverage: "controlled",
        },
        forecast: {
          nextPeriodRevenueBaseline: 100000,
          nextPeriodExpenseBaseline: 70000,
          nextPeriodProfitBaseline: 30000,
          method: "current-period-baseline",
        },
        recommendations: [
          "Continue routine monitoring and preserve current controls.",
          "Review pricing, margins, and operating costs.",
        ],
        planningAssistance: {
          priority: "optimize",
          suggestedFocus: "controlled growth",
        },
        source: {
          authority: "financial-engine-derived-read-models",
          mutableLedgerState: false,
          aiGenerated: false,
        },
      })),
    };
  }

  test("builds deterministic financial operations from financial intelligence", () => {
    const financialIntelligenceApplication =
      buildFinancialIntelligenceApplication();

    const application = new FinancialOperationsApplication({
      financialIntelligenceApplication,
    });

    const result = application.buildFinancialOperations();

    expect(result.type).toBe("financial-operations");
    expect(result.priority).toBe("optimize");
    expect(result.focus).toBe("controlled growth");

    expect(result.actions).toEqual([
      {
        id: "financial-operation-1",
        title: "Continue routine monitoring and preserve current controls.",
        category: "controlled growth",
        priority: "optimize",
        status: "recommended",
        rationale: "Derived from deterministic financial intelligence.",
      },
      {
        id: "financial-operation-2",
        title: "Review pricing, margins, and operating costs.",
        category: "controlled growth",
        priority: "optimize",
        status: "recommended",
        rationale: "Derived from deterministic financial intelligence.",
      },
    ]);

    expect(result.source).toEqual({
      authority: "financial-engine-derived-read-models",
      mutableLedgerState: false,
      aiGenerated: false,
      derivedFrom: "financial-intelligence",
    });

    expect(
      financialIntelligenceApplication.buildFinancialIntelligence,
    ).toHaveBeenCalled();
  });

  test("requires a financial intelligence application", () => {
    expect(() => new FinancialOperationsApplication({})).toThrow(
      "FinancialOperationsApplication requires a financial intelligence application.",
    );
  });
});
