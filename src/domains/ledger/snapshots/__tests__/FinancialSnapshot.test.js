import { describe, expect, test } from "vitest";
import { FinancialSnapshot } from "../FinancialSnapshot.js";

describe("FinancialSnapshot", () => {
  test("creates an immutable snapshot from dashboard data", () => {
    const snapshot = FinancialSnapshot.fromDashboard({
      id: "snapshot-1",
      capturedAt: "2026-07-04T00:00:00.000Z",
      period: {
        start: "2026-07-01",
        end: "2026-07-31",
      },
      dashboard: {
        kpis: {
          cash: 1000000,
          receivables: 250000,
          debt: 400000,
          revenue: 1200000,
          expenses: 850000,
          assets: 1250000,
          liabilities: 400000,
          equity: 850000,
          profit: 350000,
          margin: 0.291666,
        },
        health: {
          label: "Healthy",
          detail: "Profit, margin, cash, and equity are currently positive.",
        },
        metadata: {
          provider: "demo",
          snapshotStatus: "current",
          phase: "7.3",
        },
      },
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.period)).toBe(true);
    expect(Object.isFrozen(snapshot.kpis)).toBe(true);
    expect(Object.isFrozen(snapshot.health)).toBe(true);
    expect(Object.isFrozen(snapshot.metadata)).toBe(true);

    expect(snapshot.id).toBe("snapshot-1");
    expect(snapshot.kpis.equity).toBe(850000);
    expect(snapshot.kpis.cash).toBe(1000000);
    expect(snapshot.kpis.profit).toBe(350000);
    expect(snapshot.health.label).toBe("Healthy");
    expect(snapshot.metadata.provider).toBe("demo");
  });

  test("requires id and capturedAt", () => {
    expect(() => new FinancialSnapshot({ capturedAt: "now" })).toThrow(
      "FinancialSnapshot requires an id.",
    );

    expect(() => new FinancialSnapshot({ id: "snapshot-1" })).toThrow(
      "FinancialSnapshot requires capturedAt.",
    );
  });
});
