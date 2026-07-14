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

function buildDashboard() {
  return Object.freeze({
    kpis: Object.freeze({
      revenue: 1500,
      expenses: 250,
      profit: 1250,
      margin: 1250 / 1500,
      cashFlow: 1250,
      assets: null,
      liabilities: null,
    }),
    health: Object.freeze({
      label: "Healthy",
      detail: "Profit, margin, and cash flow are currently positive.",
    }),
    metadata: Object.freeze({
      provider: "financial-events",
      snapshotStatus: "repository-backed",
    }),
  });
}

function buildApplication(overrides = {}) {
  const workspace = buildWorkspace();
  const dashboard = buildDashboard();
  const reports = Object.freeze({
    portfolio: workspace.portfolio,
    properties: workspace.properties,
    categories: workspace.categories,
    transactions: workspace.transactions,
  });

  const financialWorkspaceQueryService =
    overrides.financialWorkspaceQueryService || {
      buildWorkspace: vi.fn(async () => workspace),
    };

  const readModelAdapter = overrides.readModelAdapter || {
    buildDashboard: vi.fn(() => dashboard),
    buildReports: vi.fn(() => reports),
  };

  const currentOwnerId =
    overrides.currentOwnerId || vi.fn(async () => "owner-1");

  return {
    application: new FinancialReadModelApplication({
      financialWorkspaceQueryService,
      readModelAdapter,
      currentOwnerId,
    }),
    financialWorkspaceQueryService,
    readModelAdapter,
    currentOwnerId,
    workspace,
    dashboard,
    reports,
  };
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
    ).toHaveBeenCalledWith("owner-1");
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

  test("builds the preserved business dashboard DTO", async () => {
    const {
      application,
      readModelAdapter,
      workspace,
      reports,
      dashboard,
    } = buildApplication();

    const result = await application.buildBusinessDashboard();

    expect(readModelAdapter.buildReports).toHaveBeenCalledWith(workspace);
    expect(readModelAdapter.buildDashboard).toHaveBeenCalledWith(workspace);
    expect(result).toEqual({
      type: "business-dashboard",
      reports,
      dashboard,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("builds the preserved investor dashboard DTO", async () => {
    const { application, dashboard } = buildApplication();

    const result = await application.buildInvestorDashboard();

    expect(result).toEqual({
      type: "investor-dashboard",
      kpis: dashboard.kpis,
      health: dashboard.health,
      metadata: dashboard.metadata,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("builds the preserved KPI model DTO", async () => {
    const { application, dashboard } = buildApplication();

    const result = await application.buildKPIModel();

    expect(result).toEqual({
      type: "kpi-model",
      kpis: dashboard.kpis,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("builds the preserved executive summary DTO", async () => {
    const { application, dashboard } = buildApplication();

    const result = await application.buildExecutiveSummary();

    expect(result).toEqual({
      type: "executive-summary",
      health: dashboard.health,
      kpis: dashboard.kpis,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("propagates repository query failures", async () => {
    const repositoryError = new Error("Repository query failed");

    const { application } = buildApplication({
      financialWorkspaceQueryService: {
        buildWorkspace: vi.fn(async () => {
          throw repositoryError;
        }),
      },
    });

    await expect(
      application.buildBusinessDashboard(),
    ).rejects.toBe(repositoryError);
  });

  test("freezes the application instance", () => {
    const { application } = buildApplication();

    expect(Object.isFrozen(application)).toBe(true);
  });
});
