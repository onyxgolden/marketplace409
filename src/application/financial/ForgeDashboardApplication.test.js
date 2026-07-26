import { ForgeDashboardApplication } from "./ForgeDashboardApplication.js";

describe("ForgeDashboardApplication", () => {
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
  test("loads dashboard intelligence through injected fetcher", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          auditFindings: { anomalies: [] },
          riskDashboard: {
            summary: { status: "Ready", summary: "Loaded." },
            assessment: { recommendations: [] },
            executiveBriefing: { outlook: "Stable." },
          },
          netWorth: {
            totalAssets: 100,
            totalLiabilities: 25,
            netWorth: 75,
            debtToAssetRatio: 0.25,
          },
        },
      }),
    }));

    const result = await ForgeDashboardApplication.loadDashboardIntelligence({
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/financial/dashboard-intelligence",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.riskDashboard.summary.status).toBe("Ready");
    expect(result.netWorth.netWorth).toBe(75);
  });

  test("normalizes dashboard intelligence failures into fallback state", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "API failed." }),
    }));

    const result = await ForgeDashboardApplication.loadDashboardIntelligence({
      fetcher,
    });

    expect(result.auditFindings.error).toBe("API failed.");
    expect(result.riskDashboard.summary.status).toBe("Review");
  });

  test("loads read models through injected fetcher", async () => {
    const data = {
      businessDashboard: { total: 1 },
      investorDashboard: { total: 2 },
      kpiModel: { total: 3 },
      executiveSummary: { total: 4 },
    };

    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data }),
    }));

    const result = await ForgeDashboardApplication.loadReadModels({ fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/financial/read-models?business=true&investor=true&kpi=true&executive=true",
    );
    expect(result).toBe(data);
  });

  test("keeps read model failures non-blocking", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Read models failed." }),
    }));
    const logger = { warn: vi.fn() };

    const result = await ForgeDashboardApplication.loadReadModels({
      fetcher,
      logger,
    });

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "Read models failed (non-blocking):",
      expect.any(Error),
    );
  });
});
