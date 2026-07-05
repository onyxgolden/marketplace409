import { FinancialIntelligenceApplication } from "./FinancialIntelligenceApplication.js";

describe("FinancialIntelligenceApplication", () => {
  test("builds deterministic financial intelligence from read models", () => {
    const readModelApplication = {
      buildExecutiveSummary: vi.fn(() => ({
        health: {
          label: "Healthy",
          detail: "Business is performing well.",
        },
      })),
      buildKPIModel: vi.fn(() => ({
        kpis: {
          revenue: 100000,
          expenses: 70000,
          profit: 30000,
          margin: 0.3,
          cash: 25000,
          assets: 200000,
          liabilities: 60000,
        },
      })),
    };

    const application = new FinancialIntelligenceApplication({
      readModelApplication,
    });

    const result = application.buildFinancialIntelligence();

    expect(result.type).toBe("financial-intelligence");
    expect(result.source).toEqual({
      authority: "financial-engine-derived-read-models",
      mutableLedgerState: false,
      aiGenerated: false,
    });

    expect(result.trendAnalysis).toEqual({
      profitability: "positive",
      liquidity: "cash-positive",
      leverage: "controlled",
    });

    expect(result.scenarioModeling.revenueDownTenPercent.profit).toBe(20000);
    expect(result.forecast.nextPeriodProfitBaseline).toBe(30000);

    expect(result.recommendations).toContain(
      "Continue routine monitoring and preserve current controls.",
    );

    expect(result.planningAssistance).toEqual({
      priority: "optimize",
      suggestedFocus: "controlled growth",
    });

    expect(readModelApplication.buildExecutiveSummary).toHaveBeenCalled();
    expect(readModelApplication.buildKPIModel).toHaveBeenCalled();
  });

  test("requires a read model application", () => {
    expect(
      () => new FinancialIntelligenceApplication({}),
    ).toThrow(
      "FinancialIntelligenceApplication requires a read model application.",
    );
  });
});
