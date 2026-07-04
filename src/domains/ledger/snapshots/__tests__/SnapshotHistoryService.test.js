import { describe, expect, test } from "vitest";
import { SnapshotHistoryService } from "../SnapshotHistoryService.js";
import { FinancialSnapshotRepository } from "../FinancialSnapshotRepository.js";

function makeDashboard(cash) {
  return {
    kpis: {
      cash,
      receivables: 250000,
      debt: 400000,
      revenue: 1200000,
      expenses: 850000,
      assets: cash + 250000,
      liabilities: 400000,
      equity: cash + 250000 - 400000,
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
  };
}

describe("SnapshotHistoryService", () => {
  test("captures dashboard data as immutable financial snapshots", () => {
    const repository = new FinancialSnapshotRepository();
    const service = new SnapshotHistoryService(repository);

    const snapshot = service.captureDashboardSnapshot({
      id: "snapshot-1",
      capturedAt: "2026-07-04T00:00:00.000Z",
      period: {
        start: "2026-07-01",
        end: "2026-07-31",
      },
      dashboard: makeDashboard(1000000),
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.id).toBe("snapshot-1");
    expect(snapshot.kpis.cash).toBe(1000000);
    expect(service.listSnapshots()).toHaveLength(1);
    expect(service.getLatestSnapshot()).toBe(snapshot);
  });

  test("requires a repository", () => {
    expect(() => new SnapshotHistoryService()).toThrow(
      "SnapshotHistoryService requires a repository.",
    );
  });
});
