import { FinancialDashboardIntelligenceApplication } from "./FinancialDashboardIntelligenceApplication.js";

describe("FinancialDashboardIntelligenceApplication", () => {
  test("builds dashboard intelligence from audit, risk, and net worth services", () => {
    const auditFindings = {
      anomalies: [
        {
          accountId: "1000",
          type: "LARGE_BALANCE",
          explanation: "Large balance detected.",
        },
      ],
      inspectedAccounts: 1,
    };

    const riskDashboard = {
      summary: { findingCount: 1 },
    };

    const netWorth = {
      totalAssets: 100,
      totalLiabilities: 25,
      netWorth: 75,
    };

    const auditAgent = {
      run: vi.fn(() => auditFindings),
    };

    const riskDashboardService = {
      build: vi.fn(() => riskDashboard),
    };

    const netWorthService = {
      calculate: vi.fn(() => netWorth),
    };

    const application = new FinancialDashboardIntelligenceApplication({
      auditAgent,
      riskDashboardService,
      netWorthService,
    });

    const result = application.buildDashboardIntelligence({
      intelligenceContext: {
        financial: {
          dashboard: {
            ledgerContext: { accounts: [] },
          },
          position: {
            assets: [{ value: 100 }],
            liabilities: [{ balance: 25 }],
          },
        },
      },
    });

    expect(result).toMatchObject({
      auditFindings,
      riskDashboard: {
        summary: {
          findingCount: 1,
          severity: "low",
          score: 0,
          status: "Ready",
        },
        assessment: {
          recommendations: ["Continue routine monitoring."],
        },
        executiveBriefing: {
          recommendedActions: ["Continue routine monitoring."],
        },
      },
      netWorth: {
        totalAssets: 100,
        totalLiabilities: 25,
        netWorth: 75,
        debtToAssetRatio: 0,
      },
    });

    expect(auditAgent.run).toHaveBeenCalledWith({
      ledger: { accounts: [] },
    });

    expect(riskDashboardService.build).toHaveBeenCalledWith({
      auditFindings: auditFindings.anomalies,
    });

    expect(netWorthService.calculate).toHaveBeenCalledWith(
      [{ value: 100 }],
      [{ balance: 25 }],
    );
  });

  test("requires an audit agent", () => {
    expect(
      () =>
        new FinancialDashboardIntelligenceApplication({
          riskDashboardService: {},
          netWorthService: {},
        }),
    ).toThrow(
      "FinancialDashboardIntelligenceApplication requires an audit agent.",
    );
  });

  test("requires a risk dashboard service", () => {
    expect(
      () =>
        new FinancialDashboardIntelligenceApplication({
          auditAgent: {},
          netWorthService: {},
        }),
    ).toThrow(
      "FinancialDashboardIntelligenceApplication requires a risk dashboard service.",
    );
  });

  test("requires a net worth service", () => {
    expect(
      () =>
        new FinancialDashboardIntelligenceApplication({
          auditAgent: {},
          riskDashboardService: {},
        }),
    ).toThrow(
      "FinancialDashboardIntelligenceApplication requires a net worth service.",
    );
  });
});
