import {
  RiskHistoryService,
  type RiskSnapshot,
  type RiskTrend,
} from "./risk-history.service";
import { InMemoryRiskSnapshotRepository } from "./in-memory-risk-snapshot.repository";
import type { RiskSnapshotRepository } from "./risk-snapshot.repository";
import type { RiskSeverity } from "./risk.types";

export type RiskMonitoringAlert = {
  type: "baseline" | "material_worsening" | "high_risk_posture";
  severity: RiskSeverity;
  message: string;
};

export type RiskMonitoringReport = {
  latestSnapshot: RiskSnapshot | null;
  previousSnapshot: RiskSnapshot | null;
  trend: RiskTrend | null;
  materialChangeDetected: boolean;
  alerts: RiskMonitoringAlert[];
  executiveSummary: string;
};

export class RiskMonitoringService {
  private readonly repository: RiskSnapshotRepository;
  private readonly history: RiskHistoryService;
  private readonly materialScoreChangeThreshold: number;

  constructor({
    repository = new InMemoryRiskSnapshotRepository(),
    history = new RiskHistoryService(),
    materialScoreChangeThreshold = 20,
  }: {
    repository?: RiskSnapshotRepository;
    history?: RiskHistoryService;
    materialScoreChangeThreshold?: number;
  } = {}) {
    this.repository = repository;
    this.history = history;
    this.materialScoreChangeThreshold = materialScoreChangeThreshold;
  }

  record(snapshot: RiskSnapshot): RiskMonitoringReport {
    this.repository.save(snapshot);

    return this.report();
  }

  report(): RiskMonitoringReport {
    const latestSnapshot = this.repository.latest();
    const previousSnapshot = this.repository.previous();

    if (!latestSnapshot) {
      return {
        latestSnapshot: null,
        previousSnapshot: null,
        trend: null,
        materialChangeDetected: false,
        alerts: [],
        executiveSummary: "No risk snapshots have been recorded yet.",
      };
    }

    const trend = this.history.compare(latestSnapshot, previousSnapshot);
    const materialChangeDetected = this.isMaterialWorsening(trend);
    const alerts = this.buildAlerts({
      latestSnapshot,
      previousSnapshot,
      trend,
      materialChangeDetected,
    });

    return {
      latestSnapshot,
      previousSnapshot,
      trend,
      materialChangeDetected,
      alerts,
      executiveSummary: this.buildExecutiveSummary({
        latestSnapshot,
        previousSnapshot,
        trend,
        materialChangeDetected,
        alerts,
      }),
    };
  }

  private isMaterialWorsening(trend: RiskTrend): boolean {
    return (
      trend.direction === "worsening" &&
      trend.scoreChange >= this.materialScoreChangeThreshold
    );
  }

  private buildAlerts({
    latestSnapshot,
    previousSnapshot,
    trend,
    materialChangeDetected,
  }: {
    latestSnapshot: RiskSnapshot;
    previousSnapshot: RiskSnapshot | null;
    trend: RiskTrend;
    materialChangeDetected: boolean;
  }): RiskMonitoringAlert[] {
    const alerts: RiskMonitoringAlert[] = [];

    if (!previousSnapshot) {
      alerts.push({
        type: "baseline",
        severity: latestSnapshot.severity,
        message: `Initial risk monitoring baseline recorded at ${latestSnapshot.overallScore}.`,
      });
    }

    if (materialChangeDetected) {
      alerts.push({
        type: "material_worsening",
        severity: latestSnapshot.severity,
        message: `Risk score worsened by ${trend.scoreChange} points since the previous snapshot.`,
      });
    }

    if (
      latestSnapshot.severity === "high" ||
      latestSnapshot.severity === "critical"
    ) {
      alerts.push({
        type: "high_risk_posture",
        severity: latestSnapshot.severity,
        message: `Current risk posture is ${latestSnapshot.severity} with score ${latestSnapshot.overallScore}.`,
      });
    }

    return alerts;
  }

  private buildExecutiveSummary({
    latestSnapshot,
    previousSnapshot,
    trend,
    materialChangeDetected,
    alerts,
  }: {
    latestSnapshot: RiskSnapshot;
    previousSnapshot: RiskSnapshot | null;
    trend: RiskTrend;
    materialChangeDetected: boolean;
    alerts: RiskMonitoringAlert[];
  }): string {
    if (!previousSnapshot) {
      return `Initial risk monitoring baseline recorded with ${latestSnapshot.severity} severity and score ${latestSnapshot.overallScore}.`;
    }

    if (materialChangeDetected) {
      return `Material risk worsening detected: score moved from ${previousSnapshot.overallScore} to ${latestSnapshot.overallScore}. Executive review is recommended.`;
    }

    if (trend.direction === "worsening") {
      return `Risk posture worsened by ${trend.scoreChange} points, but did not cross the material change threshold.`;
    }

    if (trend.direction === "improving") {
      return `Risk posture improved by ${Math.abs(trend.scoreChange)} points. Continue monitoring for sustained improvement.`;
    }

    if (alerts.length > 0) {
      return alerts[0].message;
    }

    return "Risk posture is stable with no material monitoring alerts.";
  }
}
