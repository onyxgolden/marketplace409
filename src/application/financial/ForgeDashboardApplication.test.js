import { ForgeDashboardApplication } from "./ForgeDashboardApplication.js";

describe("ForgeDashboardApplication", () => {
  test("builds immutable dashboard request input", () => {
    const result = ForgeDashboardApplication.buildDashboardRequestInput();

    expect(result).toMatchObject({
      ledgerContext: {
        accounts: [
          { id: "1000", name: "Cash", balance: 280000 },
          { id: "1100", name: "Accounts Receivable", balance: 120000 },
          { id: "2000", name: "Debt", balance: -40000 },
        ],
        postings: [],
      },
      assets: [{ id: "cash", name: "Cash", category: "bank", value: 280000 }],
      liabilities: [
        { id: "debt", name: "Debt", category: "loan", balance: 0 },
      ],
    });
  });

  test("builds loading dashboard intelligence", () => {
    const result = ForgeDashboardApplication.buildLoadingDashboardIntelligence();

    expect(result).toMatchObject({
      auditFindings: {
        anomalies: [],
      },
      riskDashboard: {
        summary: {
          status: "Loading",
          summary: "Dashboard intelligence is loading.",
        },
      },
      netWorth: {
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        debtToAssetRatio: 0,
      },
    });
  });

  test("builds error dashboard intelligence", () => {
    const result = ForgeDashboardApplication.buildErrorDashboardIntelligence(
      new Error("Network failed."),
    );

    expect(result.auditFindings.error).toBe("Network failed.");
    expect(result.riskDashboard.summary.status).toBe("Review");
    expect(result.riskDashboard.summary.summary).toBe(
      "Dashboard intelligence could not be loaded.",
    );
  });

  test("builds dashboard view model from dashboard intelligence", () => {
    const result = ForgeDashboardApplication.buildViewModel({
      auditFindings: {
        anomalies: [{ id: "finding-1" }],
      },
      riskDashboard: {
        summary: {
          status: "Ready",
          summary: "Risk dashboard ready.",
        },
        assessment: {
          recommendations: ["Review cash position."],
        },
        executiveBriefing: {
          outlook: "Stable outlook.",
        },
      },
      netWorth: {
        totalAssets: 100000,
        totalLiabilities: 25000,
        netWorth: 75000,
      },
    });

    expect(result.alertItems).toEqual([
      {
        label: "Ready",
        detail: "Risk dashboard ready.",
      },
      {
        label: "Audit Findings",
        detail: "1 active findings in the current read-only scan.",
      },
    ]);

    expect(result.insightItems).toEqual([
      {
        label: "Executive Outlook",
        detail: "Stable outlook.",
      },
      {
        label: "Recommended Focus",
        detail: "Review cash position.",
      },
    ]);

    expect(result.portfolioSummaryItems).toEqual([
      { label: "Assets", value: "$100,000" },
      { label: "Liabilities", value: "$25,000" },
      { label: "Net Worth", value: "$75,000" },
    ]);

    expect(result.systemHealthItems[1]).toMatchObject({
      label: "Dashboard Intelligence API",
      status: "online",
    });

    expect(result.systemStatusItems[2]).toEqual({
      label: "Net Worth",
      detail: "Snapshot calculation completed.",
      value: "$75,000",
    });

    expect(result.recentActivities[1]).toMatchObject({
      id: "audit-findings",
      detail: "1 anomalies detected.",
    });
  });
});
