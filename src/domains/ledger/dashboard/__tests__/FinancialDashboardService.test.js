import { describe, expect, test } from "vitest";
import { DemoFinancialDataProvider, FinancialEngine } from "@/domains/ledger";
import { FinancialDashboardService } from "../FinancialDashboardService.js";

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
});
