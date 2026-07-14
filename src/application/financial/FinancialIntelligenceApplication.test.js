import { FinancialIntelligenceApplication } from "./FinancialIntelligenceApplication.js";

describe("FinancialIntelligenceApplication", () => {
  function buildReadModelApplication() {
    return {
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
  }

  function buildServices() {
    return {
      trendAnalysisService: {
        analyze: vi.fn(() => ({
          profitability: "positive",
          liquidity: "cash-positive",
          leverage: "controlled",
        })),
      },
      scenarioModelingService: {
        model: vi.fn(() => ({
          revenueDownTenPercent: {
            revenue: 90000,
            profit: 20000,
          },
          expenseUpTenPercent: {
            expenses: 77000,
            profit: 23000,
          },
        })),
      },
      forecastService: {
        forecast: vi.fn(() => ({
          nextPeriodRevenueBaseline: 100000,
          nextPeriodExpenseBaseline: 70000,
          nextPeriodProfitBaseline: 30000,
          method: "current-period-baseline",
        })),
      },
      recommendationService: {
        recommend: vi.fn(() => [
          "Continue routine monitoring and preserve current controls.",
        ]),
      },
      planningService: {
        buildPlan: vi.fn(() => ({
          priority: "optimize",
          suggestedFocus: "controlled growth",
          summary: "Optimize operating performance.",
        })),
      },
    };
  }

  test("builds deterministic financial intelligence from injected read models and services", async () => {
    const readModelApplication = buildReadModelApplication();
    const services = buildServices();

    const application = new FinancialIntelligenceApplication({
      readModelApplication,
      ...services,
    });

    const result = await application.buildFinancialIntelligence();

    expect(result.type).toBe("financial-intelligence");
    expect(result.source).toEqual({
      authority: "financial-event-repository-backed-read-models",
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
      summary: "Optimize operating performance.",
    });

    expect(readModelApplication.buildExecutiveSummary).toHaveBeenCalled();
    expect(readModelApplication.buildKPIModel).toHaveBeenCalled();

    expect(services.trendAnalysisService.analyze).toHaveBeenCalledWith({
      revenue: 100000,
      expenses: 70000,
      profit: 30000,
      margin: 0.3,
      cash: 25000,
      assets: 200000,
      liabilities: 60000,
    });

    expect(services.recommendationService.recommend).toHaveBeenCalledWith(
      {
        revenue: 100000,
        expenses: 70000,
        profit: 30000,
        margin: 0.3,
        cash: 25000,
        assets: 200000,
        liabilities: 60000,
      },
      {
        label: "Healthy",
        detail: "Business is performing well.",
      },
    );

    expect(services.planningService.buildPlan).toHaveBeenCalledWith(
      {
        revenue: 100000,
        expenses: 70000,
        profit: 30000,
        margin: 0.3,
        cash: 25000,
        assets: 200000,
        liabilities: 60000,
      },
      {
        label: "Healthy",
        detail: "Business is performing well.",
      },
    );
  });

  test("requires a read model application", () => {
    expect(
      () =>
        new FinancialIntelligenceApplication({
          ...buildServices(),
        }),
    ).toThrow(
      "FinancialIntelligenceApplication requires a read model application.",
    );
  });

  test("requires injected financial intelligence services", () => {
    const readModelApplication = buildReadModelApplication();
    const services = buildServices();

    expect(
      () =>
        new FinancialIntelligenceApplication({
          readModelApplication,
          ...services,
          trendAnalysisService: undefined,
        }),
    ).toThrow(
      "FinancialIntelligenceApplication requires a trend analysis service.",
    );

    expect(
      () =>
        new FinancialIntelligenceApplication({
          readModelApplication,
          ...services,
          scenarioModelingService: undefined,
        }),
    ).toThrow(
      "FinancialIntelligenceApplication requires a scenario modeling service.",
    );

    expect(
      () =>
        new FinancialIntelligenceApplication({
          readModelApplication,
          ...services,
          forecastService: undefined,
        }),
    ).toThrow(
      "FinancialIntelligenceApplication requires a forecast service.",
    );

    expect(
      () =>
        new FinancialIntelligenceApplication({
          readModelApplication,
          ...services,
          recommendationService: undefined,
        }),
    ).toThrow(
      "FinancialIntelligenceApplication requires a recommendation service.",
    );

    expect(
      () =>
        new FinancialIntelligenceApplication({
          readModelApplication,
          ...services,
          planningService: undefined,
        }),
    ).toThrow(
      "FinancialIntelligenceApplication requires a planning service.",
    );
  });
});
