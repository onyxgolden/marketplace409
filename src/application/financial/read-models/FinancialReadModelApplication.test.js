import { describe, expect, test, vi } from "vitest";

import {
  FinancialReadModelApplication,
} from "./FinancialReadModelApplication.js";

function buildWorkspace() {
  return Object.freeze({
    portfolio: Object.freeze({
      income: 1500,
      expenses: 250,
      noi: 1250,
      cashFlow: 1250,
      transactionCount: 2,
    }),
    properties: Object.freeze([]),
    categories: Object.freeze([]),
    transactions: Object.freeze([]),
  });
}

function buildActivityDashboard() {
  return Object.freeze({
    kpis: Object.freeze({
      revenue: 1500,
      expenses: 250,
      profit: 1250,
      margin: 1250 / 1500,
      cashFlow: 1250,
      noi: 1250,
      transactionCount: 2,
      cash: null,
      receivables: null,
      debt: null,
      assets: null,
      liabilities: null,
      equity: null,
    }),
    health: Object.freeze({
      label: "Healthy",
      detail: "Profit, margin, and cash flow are currently positive.",
    }),
    balanceSheetLines: Object.freeze([]),
    metadata: Object.freeze({
      provider: "financial-events",
      snapshotStatus: "repository-backed",
      phase: "16.2",
      balanceSheetStatus: "unavailable-from-event-activity",
    }),
  });
}

function buildPosition() {
  return Object.freeze({
    assets: Object.freeze([]),
    liabilities: Object.freeze([]),
    accountBalances: Object.freeze([]),
    netWorth: Object.freeze({
      totalAssets: 425000,
      totalLiabilities: 200000,
      netWorth: 225000,
      debtToAssetRatio: 200000 / 425000,
    }),
    metrics: null,
    insights: Object.freeze([]),
    metadata: Object.freeze({
      accountBalancesStatus:
        "unavailable-without-owner-wide-balance-query",
    }),
  });
}

function buildPositionProjection() {
  return Object.freeze({
    kpis: Object.freeze({
      cash: 125000,
      receivables: null,
      debt: 200000,
      assets: 425000,
      liabilities: 200000,
      equity: 225000,
    }),
    balanceSheetLines: Object.freeze([
      Object.freeze({
        accountId: "asset:asset-1",
        accountName: "Operating Cash",
        amount: 125000,
      }),
      Object.freeze({
        accountId: "liability:liability-1",
        accountName: "Rental Mortgage",
        amount: 200000,
      }),
    ]),
    metadata: Object.freeze({
      provider: "financial-position",
      snapshotStatus: "repository-backed",
      phase: "16.3",
      balanceSheetStatus:
        "repository-backed-financial-accounts",
      receivablesStatus:
        "unavailable-without-receivables-source",
    }),
  });
}

function buildApplication(overrides = {}) {
  const workspace = buildWorkspace();
  const activityDashboard = buildActivityDashboard();
  const reports = Object.freeze({
    portfolio: workspace.portfolio,
    properties: workspace.properties,
    categories: workspace.categories,
    transactions: workspace.transactions,
  });
  const position = buildPosition();
  const positionProjection = buildPositionProjection();

  const financialWorkspaceQueryService =
    overrides.financialWorkspaceQueryService || {
      buildWorkspace: vi.fn(async () => workspace),
    };

  const readModelAdapter = overrides.readModelAdapter || {
    buildDashboard: vi.fn(() => activityDashboard),
    buildReports: vi.fn(() => reports),
  };

  const financialPositionQueryService =
    Object.prototype.hasOwnProperty.call(
      overrides,
      "financialPositionQueryService",
    )
      ? overrides.financialPositionQueryService
      : null;

  const financialPositionReadModelAdapter =
    Object.prototype.hasOwnProperty.call(
      overrides,
      "financialPositionReadModelAdapter",
    )
      ? overrides.financialPositionReadModelAdapter
      : null;

  const decisionOutcomeQueryService =
    Object.prototype.hasOwnProperty.call(
      overrides,
      "decisionOutcomeQueryService",
    )
      ? overrides.decisionOutcomeQueryService
      : null;

  const decisionOutcomeReadModelAdapter =
    Object.prototype.hasOwnProperty.call(
      overrides,
      "decisionOutcomeReadModelAdapter",
    )
      ? overrides.decisionOutcomeReadModelAdapter
      : null;

  const currentOwnerId =
    overrides.currentOwnerId ||
    vi.fn(async () => "owner-1");

  return {
    application: new FinancialReadModelApplication({
      financialWorkspaceQueryService,
      readModelAdapter,
      financialPositionQueryService,
      financialPositionReadModelAdapter,
      decisionOutcomeQueryService,
      decisionOutcomeReadModelAdapter,
      currentOwnerId,
    }),
    financialWorkspaceQueryService,
    readModelAdapter,
    financialPositionQueryService,
    financialPositionReadModelAdapter,
    decisionOutcomeQueryService,
    decisionOutcomeReadModelAdapter,
    currentOwnerId,
    workspace,
    activityDashboard,
    reports,
    position,
    positionProjection,
  };
}

function buildComposedApplication(overrides = {}) {
  const position = buildPosition();
  const positionProjection = buildPositionProjection();

  return buildApplication({
    financialPositionQueryService: {
      buildPosition: vi.fn(async () => position),
    },
    financialPositionReadModelAdapter: {
      buildPosition: vi.fn(() => positionProjection),
    },
    ...overrides,
  });
}

describe("FinancialReadModelApplication", () => {
  test("requires a financial workspace query service", () => {
    expect(
      () =>
        new FinancialReadModelApplication({
          readModelAdapter: {
            buildDashboard: vi.fn(),
            buildReports: vi.fn(),
          },
          currentOwnerId: vi.fn(),
        }),
    ).toThrow(
      "FinancialReadModelApplication requires a financial workspace query service.",
    );
  });

  test("requires a financial workspace read model adapter", () => {
    expect(
      () =>
        new FinancialReadModelApplication({
          financialWorkspaceQueryService: {
            buildWorkspace: vi.fn(),
          },
          currentOwnerId: vi.fn(),
        }),
    ).toThrow(
      "FinancialReadModelApplication requires a financial workspace read model adapter.",
    );
  });

  test("requires both financial position dependencies together", () => {
    const base = {
      financialWorkspaceQueryService: {
        buildWorkspace: vi.fn(),
      },
      readModelAdapter: {
        buildDashboard: vi.fn(),
        buildReports: vi.fn(),
      },
      currentOwnerId: vi.fn(),
    };

    expect(
      () =>
        new FinancialReadModelApplication({
          ...base,
          financialPositionQueryService: {
            buildPosition: vi.fn(),
          },
        }),
    ).toThrow(
      "FinancialReadModelApplication requires both financial position dependencies.",
    );

    expect(
      () =>
        new FinancialReadModelApplication({
          ...base,
          financialPositionReadModelAdapter: {
            buildPosition: vi.fn(),
          },
        }),
    ).toThrow(
      "FinancialReadModelApplication requires both financial position dependencies.",
    );
  });

  test("requires valid financial position dependency contracts", () => {
    const base = {
      financialWorkspaceQueryService: {
        buildWorkspace: vi.fn(),
      },
      readModelAdapter: {
        buildDashboard: vi.fn(),
        buildReports: vi.fn(),
      },
      currentOwnerId: vi.fn(),
    };

    expect(
      () =>
        new FinancialReadModelApplication({
          ...base,
          financialPositionQueryService: {},
          financialPositionReadModelAdapter: {
            buildPosition: vi.fn(),
          },
        }),
    ).toThrow(
      "FinancialReadModelApplication requires a financial position query service.",
    );

    expect(
      () =>
        new FinancialReadModelApplication({
          ...base,
          financialPositionQueryService: {
            buildPosition: vi.fn(),
          },
          financialPositionReadModelAdapter: {},
        }),
    ).toThrow(
      "FinancialReadModelApplication requires a financial position read model adapter.",
    );
  });

  test("requires a current owner id resolver", () => {
    expect(
      () =>
        new FinancialReadModelApplication({
          financialWorkspaceQueryService: {
            buildWorkspace: vi.fn(),
          },
          readModelAdapter: {
            buildDashboard: vi.fn(),
            buildReports: vi.fn(),
          },
          currentOwnerId: null,
        }),
    ).toThrow(
      "FinancialReadModelApplication requires a current owner id resolver.",
    );
  });

  test("resolves the authenticated owner and builds the repository workspace", async () => {
    const {
      application,
      currentOwnerId,
      financialWorkspaceQueryService,
    } = buildApplication();

    await application.buildKPIModel();

    expect(currentOwnerId).toHaveBeenCalledOnce();
    expect(
      financialWorkspaceQueryService.buildWorkspace,
    ).toHaveBeenCalledWith("owner-1", { scope: "business" });
  });

  test("rejects read-model queries without an authenticated owner", async () => {
    const { application, financialWorkspaceQueryService } =
      buildApplication({
        currentOwnerId: vi.fn(async () => null),
      });

    await expect(application.buildKPIModel()).rejects.toThrow(
      "Authenticated owner id is required.",
    );

    expect(
      financialWorkspaceQueryService.buildWorkspace,
    ).not.toHaveBeenCalled();
  });

  test("preserves activity-only dashboard behavior before position composition is wired", async () => {
    const {
      application,
      activityDashboard,
    } = buildApplication();

    const result =
      await application.buildFinancialDashboard();

    expect(result).toEqual({
      type: "financial-dashboard",
      dashboard: activityDashboard,
    });
  });

  test("composes activity and financial position into the dashboard DTO", async () => {
    const {
      application,
      financialPositionQueryService,
      financialPositionReadModelAdapter,
      position,
      positionProjection,
    } = buildComposedApplication();

    const result =
      await application.buildFinancialDashboard();

    expect(
      financialPositionQueryService.buildPosition,
    ).toHaveBeenCalledOnce();

    expect(
      financialPositionQueryService.buildPosition,
    ).toHaveBeenCalledWith("owner-1");

    expect(
      financialPositionReadModelAdapter.buildPosition,
    ).toHaveBeenCalledWith(position);

    expect(result).toEqual({
      type: "financial-dashboard",
      dashboard: {
        kpis: {
          revenue: 1500,
          expenses: 250,
          profit: 1250,
          margin: 1250 / 1500,
          cashFlow: 1250,
          noi: 1250,
          transactionCount: 2,
          cash: 125000,
          receivables: null,
          debt: 200000,
          assets: 425000,
          liabilities: 200000,
          equity: 225000,
        },
        health: {
          label: "Healthy",
          detail:
            "Profit, margin, and cash flow are currently positive.",
        },
        balanceSheetLines:
          positionProjection.balanceSheetLines,
        assets:
          positionProjection.assets || [],
        liabilities:
          positionProjection.liabilities || [],
        metadata: {
          provider:
            "financial-events+financial-position",
          snapshotStatus: "repository-backed",
          phase: "16.3",
          balanceSheetStatus:
            "repository-backed-financial-accounts",
          receivablesStatus:
            "unavailable-without-receivables-source",
        },
      },
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.dashboard)).toBe(true);
    expect(
      Object.isFrozen(result.dashboard.kpis),
    ).toBe(true);
    expect(
      Object.isFrozen(result.dashboard.metadata),
    ).toBe(true);
  });

  test("preserves activity health while position owns balance-sheet fields", async () => {
    const { application, activityDashboard } =
      buildComposedApplication();

    const result =
      await application.buildFinancialDashboard();

    expect(result.dashboard.health).toBe(
      activityDashboard.health,
    );
    expect(result.dashboard.kpis.revenue).toBe(1500);
    expect(result.dashboard.kpis.assets).toBe(425000);
    expect(result.dashboard.balanceSheetLines).toHaveLength(2);
  });

  test("builds the preserved business dashboard DTO from the composed dashboard", async () => {
    const {
      application,
      readModelAdapter,
      workspace,
      reports,
    } = buildComposedApplication();

    const result =
      await application.buildBusinessDashboard();

    expect(
      readModelAdapter.buildReports,
    ).toHaveBeenCalledWith(workspace);

    expect(result.type).toBe("business-dashboard");
    expect(result.reports).toBe(reports);
    expect(result.dashboard.kpis.assets).toBe(425000);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("builds preserved investor, KPI, and executive DTOs from composed data", async () => {
    const { application } =
      buildComposedApplication();

    const investor =
      await application.buildInvestorDashboard();
    const kpi = await application.buildKPIModel();
    const executive =
      await application.buildExecutiveSummary();

    expect(investor.kpis.equity).toBe(225000);
    expect(kpi.kpis.cash).toBe(125000);
    expect(executive.kpis.liabilities).toBe(200000);
    expect(executive.health.label).toBe("Healthy");
  });

  test("propagates activity and position query failures", async () => {
    const activityError =
      new Error("Activity repository query failed");

    const { application: activityApplication } =
      buildApplication({
        financialWorkspaceQueryService: {
          buildWorkspace: vi.fn(async () => {
            throw activityError;
          }),
        },
      });

    await expect(
      activityApplication.buildBusinessDashboard(),
    ).rejects.toBe(activityError);

    const positionError =
      new Error("Position repository query failed");

    const { application: positionApplication } =
      buildComposedApplication({
        financialPositionQueryService: {
          buildPosition: vi.fn(async () => {
            throw positionError;
          }),
        },
      });

    await expect(
      positionApplication.buildFinancialDashboard(),
    ).rejects.toBe(positionError);
  });

  test("requires both decision outcome dependencies together", () => {
    expect(() =>
      buildApplication({
        decisionOutcomeQueryService: {
          findByDecisionId: vi.fn(),
        },
      }),
    ).toThrow(
      "FinancialReadModelApplication requires both decision outcome dependencies.",
    );

    expect(() =>
      buildApplication({
        decisionOutcomeReadModelAdapter: {
          buildOutcome: vi.fn(),
        },
      }),
    ).toThrow(
      "FinancialReadModelApplication requires both decision outcome dependencies.",
    );
  });

  test("requires valid decision outcome dependency contracts", () => {
    expect(() =>
      buildApplication({
        decisionOutcomeQueryService: {},
        decisionOutcomeReadModelAdapter: {
          buildOutcome: vi.fn(),
        },
      }),
    ).toThrow(
      "FinancialReadModelApplication requires a decision outcome query service.",
    );

    expect(() =>
      buildApplication({
        decisionOutcomeQueryService: {
          findByDecisionId: vi.fn(),
        },
        decisionOutcomeReadModelAdapter: {},
      }),
    ).toThrow(
      "FinancialReadModelApplication requires a decision outcome read model adapter.",
    );
  });

  test("rejects decision outcome reads when unavailable", async () => {
    const { application } = buildApplication();

    await expect(
      application.buildDecisionOutcome("decision-1"),
    ).rejects.toThrow(
      "Decision outcome read model is unavailable.",
    );
  });

  test("queries and projects a decision outcome read model", async () => {
    const evaluation = Object.freeze({
      decisionId: "decision-1",
      status: "completed",
      evaluation: Object.freeze({
        result: "recorded",
      }),
      outcome: Object.freeze({
        result: "approved",
      }),
    });

    const projection = Object.freeze({
      type: "decision-outcome",
      decisionId: "decision-1",
    });

    const findByDecisionId =
      vi.fn(async () => evaluation);
    const buildOutcome =
      vi.fn(() => projection);

    const { application } = buildApplication({
      decisionOutcomeQueryService: {
        findByDecisionId,
      },
      decisionOutcomeReadModelAdapter: {
        buildOutcome,
      },
    });

    const result =
      await application.buildDecisionOutcome(
        "decision-1",
      );

    expect(findByDecisionId).toHaveBeenCalledWith(
      "decision-1",
    );
    expect(buildOutcome).toHaveBeenCalledWith(
      evaluation,
    );
    expect(result).toBe(projection);
  });

  test("returns null when no decision outcome exists", async () => {
    const buildOutcome = vi.fn();

    const { application } = buildApplication({
      decisionOutcomeQueryService: {
        findByDecisionId: vi.fn(async () => null),
      },
      decisionOutcomeReadModelAdapter: {
        buildOutcome,
      },
    });

    await expect(
      application.buildDecisionOutcome(
        "decision-missing",
      ),
    ).resolves.toBeNull();

    expect(buildOutcome).not.toHaveBeenCalled();
  });

  test("propagates decision outcome failures", async () => {
    const queryError =
      new Error("Decision outcome query failed");

    const { application: queryApplication } =
      buildApplication({
        decisionOutcomeQueryService: {
          findByDecisionId: vi.fn(async () => {
            throw queryError;
          }),
        },
        decisionOutcomeReadModelAdapter: {
          buildOutcome: vi.fn(),
        },
      });

    await expect(
      queryApplication.buildDecisionOutcome(
        "decision-1",
      ),
    ).rejects.toBe(queryError);

    const projectionError =
      new Error("Decision outcome projection failed");

    const { application: projectionApplication } =
      buildApplication({
        decisionOutcomeQueryService: {
          findByDecisionId: vi.fn(async () => ({
            decisionId: "decision-1",
          })),
        },
        decisionOutcomeReadModelAdapter: {
          buildOutcome: vi.fn(() => {
            throw projectionError;
          }),
        },
      });

    await expect(
      projectionApplication.buildDecisionOutcome(
        "decision-1",
      ),
    ).rejects.toBe(projectionError);
  });

  test("freezes the application instance", () => {
    const { application } = buildApplication();

    expect(Object.isFrozen(application)).toBe(true);
  });
});
