import { describe, expect, test } from "vitest";

import {
  FinancialWorkspaceReadModelAdapter,
} from "./FinancialWorkspaceReadModelAdapter.js";

function buildWorkspace(overrides = {}) {
  return Object.freeze({
    portfolio: Object.freeze({
      income: 1500,
      expenses: 250,
      noi: 1250,
      cashFlow: 1250,
      transactionCount: 2,
      ...(overrides.portfolio || {}),
    }),
    properties: Object.freeze(
      overrides.properties || [
        Object.freeze({
          propertyId: "170-john",
          income: 1500,
          expenses: 250,
          noi: 1250,
          cashFlow: 1250,
          transactionCount: 2,
        }),
      ],
    ),
    categories: Object.freeze(overrides.categories || []),
    transactions: Object.freeze(overrides.transactions || []),
  });
}

describe("FinancialWorkspaceReadModelAdapter", () => {
  test("requires a financial workspace", () => {
    const adapter = new FinancialWorkspaceReadModelAdapter();

    expect(() => adapter.buildDashboard(null)).toThrow(
      "FinancialWorkspaceReadModelAdapter requires a financial workspace.",
    );

    expect(() => adapter.buildReports(null)).toThrow(
      "FinancialWorkspaceReadModelAdapter requires a financial workspace.",
    );
  });

  test("requires portfolio totals when building a dashboard", () => {
    const adapter = new FinancialWorkspaceReadModelAdapter();

    expect(() => adapter.buildDashboard({})).toThrow(
      "Financial workspace requires portfolio totals.",
    );
  });

  test("builds immutable operational KPIs from workspace totals", () => {
    const adapter = new FinancialWorkspaceReadModelAdapter();

    const dashboard = adapter.buildDashboard(buildWorkspace());

    expect(dashboard.kpis).toEqual({
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
    });

    expect(Object.isFrozen(dashboard)).toBe(true);
    expect(Object.isFrozen(dashboard.kpis)).toBe(true);
  });

  test("does not fabricate balance-sheet values from activity events", () => {
    const adapter = new FinancialWorkspaceReadModelAdapter();

    const dashboard = adapter.buildDashboard(buildWorkspace());

    expect(dashboard.balanceSheetLines).toEqual([]);
    expect(dashboard.kpis.cash).toBeNull();
    expect(dashboard.kpis.assets).toBeNull();
    expect(dashboard.kpis.liabilities).toBeNull();
    expect(dashboard.kpis.equity).toBeNull();
    expect(dashboard.metadata.balanceSheetStatus).toBe(
      "unavailable-from-event-activity",
    );
  });

  test("marks positive operational performance as healthy", () => {
    const adapter = new FinancialWorkspaceReadModelAdapter();

    const dashboard = adapter.buildDashboard(buildWorkspace());

    expect(dashboard.health).toEqual({
      label: "Healthy",
      detail: "Profit, margin, and cash flow are currently positive.",
    });
  });

  test("marks negative profit or cash flow as critical", () => {
    const adapter = new FinancialWorkspaceReadModelAdapter();

    const dashboard = adapter.buildDashboard(
      buildWorkspace({
        portfolio: {
          income: 1000,
          expenses: 1400,
          noi: -400,
          cashFlow: -400,
          transactionCount: 3,
        },
      }),
    );

    expect(dashboard.health.label).toBe("Critical");
  });

  test("marks weak margins or zero cash flow as warning", () => {
    const adapter = new FinancialWorkspaceReadModelAdapter();

    const dashboard = adapter.buildDashboard(
      buildWorkspace({
        portfolio: {
          income: 1000,
          expenses: 900,
          noi: 100,
          cashFlow: 100,
          transactionCount: 2,
        },
      }),
    );

    expect(dashboard.health.label).toBe("Warning");
  });

  test("preserves workspace collections in immutable activity reports", () => {
    const adapter = new FinancialWorkspaceReadModelAdapter();
    const workspace = buildWorkspace();

    const reports = adapter.buildReports(workspace);

    expect(reports).toEqual({
      portfolio: workspace.portfolio,
      properties: workspace.properties,
      categories: workspace.categories,
      transactions: workspace.transactions,
    });

    expect(reports.portfolio).toBe(workspace.portfolio);
    expect(reports.properties).toBe(workspace.properties);
    expect(Object.isFrozen(reports)).toBe(true);
  });
});
