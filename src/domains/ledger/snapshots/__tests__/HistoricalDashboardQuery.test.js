import { describe, expect, test } from "vitest";
import { FinancialSnapshot } from "../FinancialSnapshot.js";
import { FinancialSnapshotRepository } from "../FinancialSnapshotRepository.js";
import { HistoricalDashboardQuery } from "../HistoricalDashboardQuery.js";

function makeSnapshot(id, capturedAt, cash, healthLabel) {
  return new FinancialSnapshot({
    id,
    capturedAt,
    period: {
      start: capturedAt.slice(0, 10),
      end: capturedAt.slice(0, 10),
    },
    kpis: {
      cash,
      equity: cash - 100,
      profit: 50,
    },
    health: {
      label: healthLabel,
      detail: `${healthLabel} detail`,
    },
  });
}

describe("HistoricalDashboardQuery", () => {
  test("returns immutable KPI series for snapshots", () => {
    const repository = new FinancialSnapshotRepository([
      makeSnapshot("snapshot-1", "2026-07-04T00:00:00.000Z", 1000, "Healthy"),
      makeSnapshot("snapshot-2", "2026-07-05T00:00:00.000Z", 1500, "Healthy"),
    ]);

    const query = new HistoricalDashboardQuery(repository);
    const series = query.getKpiSeries("cash");

    expect(Object.isFrozen(series)).toBe(true);
    expect(Object.isFrozen(series[0])).toBe(true);
    expect(series).toEqual([
      {
        snapshotId: "snapshot-1",
        capturedAt: "2026-07-04T00:00:00.000Z",
        period: {
          start: "2026-07-04",
          end: "2026-07-04",
        },
        value: 1000,
      },
      {
        snapshotId: "snapshot-2",
        capturedAt: "2026-07-05T00:00:00.000Z",
        period: {
          start: "2026-07-05",
          end: "2026-07-05",
        },
        value: 1500,
      },
    ]);
  });

  test("returns immutable health timeline", () => {
    const repository = new FinancialSnapshotRepository([
      makeSnapshot("snapshot-1", "2026-07-04T00:00:00.000Z", 1000, "Healthy"),
      makeSnapshot("snapshot-2", "2026-07-05T00:00:00.000Z", -100, "Critical"),
    ]);

    const query = new HistoricalDashboardQuery(repository);
    const timeline = query.getHealthTimeline();

    expect(Object.isFrozen(timeline)).toBe(true);
    expect(Object.isFrozen(timeline[0])).toBe(true);
    expect(timeline[1].label).toBe("Critical");
  });

  test("requires a repository", () => {
    expect(() => new HistoricalDashboardQuery()).toThrow(
      "HistoricalDashboardQuery requires a repository.",
    );
  });
});
