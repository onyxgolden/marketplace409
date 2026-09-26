import { describe, expect, test } from "vitest";
import { DemoFinancialDataProvider, FinancialEngine } from "@/domains/ledger";
import { FinancialDashboardService } from "../FinancialDashboardService.js";
import { buildLedgerInputsFromFinancialEvents } from "../../providers/ProductionFinancialDataProvider.js";

describe("FinancialDashboardService", () => {
  test("builds immutable executive dashboard data from financial reports", () => {
    const provider = new DemoFinancialDataProvider();
    const engine = new FinancialEngine(provider.getFinancialData());
    const reports = engine.buildReports();

    const service = new FinancialDashboardService();
    const dashboard = service.buildFromReports(reports);

    expect(Object.isFrozen(dashboard)).toBe(true);
    expect(Object.isFrozen(dashboard.kpis)).toBe(true);
    expect(Object.isFrozen(dashboard.health)).toBe(true);
    expect(Object.isFrozen(dashboard.balanceSheetLines)).toBe(true);
    expect(Object.isFrozen(dashboard.metadata)).toBe(true);

    expect(dashboard.kpis.cash).toBe(1000000);
    expect(dashboard.kpis.receivables).toBe(250000);
    expect(dashboard.kpis.debt).toBe(400000);
    expect(dashboard.kpis.liabilities).toBe(400000);
    expect(dashboard.kpis.equity).toBe(850000);
    expect(dashboard.kpis.profit).toBe(350000);
    expect(dashboard.kpis.margin).toBeCloseTo(0.291666, 5);

    expect(dashboard.health.label).toBe("Healthy");
    expect(dashboard.balanceSheetLines.length).toBeGreaterThan(0);
    expect(dashboard.metadata.provider).toBe("demo");
  });

  test("aggregates revenue/expenses across real per-category accounts and labels the source", () => {
    const inputs = buildLedgerInputsFromFinancialEvents([
      {
        id: "evt-1",
        owner_id: "owner-1",
        status: "active",
        is_deleted: false,
        event_date: "2026-08-05",
        description: "Chipotle",
        amount: 60,
        transaction_kind: "expense",
        normalized_category: "dining_drinks",
        created_at: "2026-08-05T12:00:00.000Z",
      },
      {
        id: "evt-2",
        owner_id: "owner-1",
        status: "active",
        is_deleted: false,
        event_date: "2026-08-01",
        description: "Rent",
        amount: 1600,
        transaction_kind: "income",
        normalized_category: "rent",
        created_at: "2026-08-01T12:00:00.000Z",
      },
    ]);

    const engine = new FinancialEngine(inputs);
    const reports = engine.buildReports();

    const service = new FinancialDashboardService({ provider: "production" });
    const dashboard = service.buildFromReports(reports, {
      chartOfAccounts: inputs.chartOfAccounts,
    });

    // Real category accounts total by sign -- no hardcoded 4000/5000 lookup.
    expect(dashboard.kpis.revenue).toBe(160000);
    expect(dashboard.kpis.expenses).toBe(6000);
    expect(dashboard.kpis.profit).toBe(154000);
    expect(dashboard.metadata.provider).toBe("production");
    // The P&L-only events ledger has no balance-sheet accounts: cash/debt stay zero
    // (honest absence, not invented balances).
    expect(dashboard.kpis.cash).toBe(0);
    expect(dashboard.kpis.debt).toBe(0);
  });
});
