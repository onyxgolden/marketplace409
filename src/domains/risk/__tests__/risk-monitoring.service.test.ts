import { describe, expect, it } from "vitest";
import { RiskMonitoringService } from "../risk-monitoring.service";
import type { RiskSnapshot } from "../risk-history.service";

const snapshot = ({
  timestamp,
  overallScore,
  severity,
}: {
  timestamp: string;
  overallScore: number;
  severity?: RiskSnapshot["severity"];
}): RiskSnapshot => ({
  timestamp,
  overallScore,
  severity: severity ?? "low",
  findingCount: 0,
  topDrivers: [],
});

describe("RiskMonitoringService", () => {
  it("reports an empty monitoring state before snapshots are recorded", () => {
    const report = new RiskMonitoringService().report();

    expect(report.latestSnapshot).toBeNull();
    expect(report.previousSnapshot).toBeNull();
    expect(report.trend).toBeNull();
    expect(report.materialChangeDetected).toBe(false);
    expect(report.alerts).toEqual([]);
    expect(report.executiveSummary).toContain("No risk snapshots");
  });

  it("reports baseline when only one snapshot exists", () => {
    const report = new RiskMonitoringService().record(
      snapshot({
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 10,
        severity: "low",
      })
    );

    expect(report.previousSnapshot).toBeNull();
    expect(report.trend?.direction).toBe("stable");
    expect(report.alerts).toContainEqual({
      type: "baseline",
      severity: "low",
      message: "Initial risk monitoring baseline recorded at 10.",
    });
    expect(report.executiveSummary).toContain("Initial risk monitoring baseline");
  });

  it("reports worsening when score increases", () => {
    const service = new RiskMonitoringService();

    service.record(
      snapshot({
        timestamp: "2026-06-28T18:00:00.000Z",
        overallScore: 20,
        severity: "low",
      })
    );

    const report = service.record(
      snapshot({
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 30,
        severity: "medium",
      })
    );

    expect(report.trend?.direction).toBe("worsening");
    expect(report.trend?.scoreChange).toBe(10);
    expect(report.materialChangeDetected).toBe(false);
  });

  it("reports improving when score decreases", () => {
    const service = new RiskMonitoringService();

    service.record(
      snapshot({
        timestamp: "2026-06-28T18:00:00.000Z",
        overallScore: 80,
        severity: "high",
      })
    );

    const report = service.record(
      snapshot({
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 30,
        severity: "medium",
      })
    );

    expect(report.trend?.direction).toBe("improving");
    expect(report.trend?.scoreChange).toBe(-50);
    expect(report.executiveSummary).toContain("improved by 50 points");
  });

  it("flags material worsening", () => {
    const service = new RiskMonitoringService();

    service.record(
      snapshot({
        timestamp: "2026-06-28T18:00:00.000Z",
        overallScore: 25,
        severity: "low",
      })
    );

    const report = service.record(
      snapshot({
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 55,
        severity: "medium",
      })
    );

    expect(report.materialChangeDetected).toBe(true);
    expect(report.alerts).toContainEqual({
      type: "material_worsening",
      severity: "medium",
      message: "Risk score worsened by 30 points since the previous snapshot.",
    });
    expect(report.executiveSummary).toContain("Material risk worsening detected");
  });

  it("flags high current severity", () => {
    const report = new RiskMonitoringService().record(
      snapshot({
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 80,
        severity: "high",
      })
    );

    expect(report.alerts).toContainEqual({
      type: "high_risk_posture",
      severity: "high",
      message: "Current risk posture is high with score 80.",
    });
  });

  it("flags critical current severity", () => {
    const report = new RiskMonitoringService().record(
      snapshot({
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 95,
        severity: "critical",
      })
    );

    expect(report.alerts).toContainEqual({
      type: "high_risk_posture",
      severity: "critical",
      message: "Current risk posture is critical with score 95.",
    });
  });
});
