import { describe, expect, it } from "vitest";
import { InMemoryRiskSnapshotRepository } from "../in-memory-risk-snapshot.repository";
import { RiskWatchlistService } from "../risk-watchlist.service";
import type { RiskSnapshot } from "../risk-history.service";
import type { RiskFinding } from "../risk.types";

const finding = ({
  id,
  severity = "medium",
  score = 40,
  explanation,
  recommendedAction,
}: {
  id: string;
  severity?: RiskFinding["severity"];
  score?: number;
  explanation?: string;
  recommendedAction?: string;
}): RiskFinding => ({
  id,
  sourceType: "audit_finding",
  sourceFindingType: "test",
  severity,
  score,
  confidence: 0.9,
  explanation: explanation ?? `${id} explanation`,
  recommendedAction: recommendedAction ?? `${id} action`,
});

const snapshot = ({
  timestamp,
  findings,
  overallScore = 50,
}: {
  timestamp: string;
  findings: RiskFinding[];
  overallScore?: number;
}): RiskSnapshot => ({
  timestamp,
  overallScore,
  severity: overallScore >= 80 ? "high" : "medium",
  findingCount: findings.length,
  topDrivers: findings,
});

const repositoryWithSnapshots = (
  snapshots: RiskSnapshot[]
): InMemoryRiskSnapshotRepository => {
  const repository = new InMemoryRiskSnapshotRepository();

  snapshots.forEach((riskSnapshot) => repository.save(riskSnapshot));

  return repository;
};

describe("RiskWatchlistService", () => {
  it("returns an empty watchlist when no snapshots exist", () => {
    const service = new RiskWatchlistService({
      repository: new InMemoryRiskSnapshotRepository(),
    });

    expect(service.analyze()).toEqual({
      snapshotCount: 0,
      newlyIntroducedRisks: [],
      recurringRisks: [],
      resolvedRisks: [],
      agingRisks: [],
      watchlistItems: [],
    });
  });

  it("identifies newly introduced risks in the latest snapshot", () => {
    const service = new RiskWatchlistService({
      repository: repositoryWithSnapshots([
        snapshot({
          timestamp: "2026-06-28T18:00:00.000Z",
          findings: [finding({ id: "late-reconciliation" })],
        }),
        snapshot({
          timestamp: "2026-06-29T18:00:00.000Z",
          findings: [
            finding({ id: "late-reconciliation" }),
            finding({ id: "unapproved-disbursement", severity: "high" }),
          ],
        }),
      ]),
    });

    const report = service.analyze();

    expect(report.newlyIntroducedRisks.map((risk) => risk.id)).toEqual([
      "unapproved-disbursement",
    ]);
  });

  it("identifies recurring risks across historical snapshots", () => {
    const service = new RiskWatchlistService({
      repository: repositoryWithSnapshots([
        snapshot({
          timestamp: "2026-06-27T18:00:00.000Z",
          findings: [finding({ id: "missing-receipt" })],
        }),
        snapshot({
          timestamp: "2026-06-28T18:00:00.000Z",
          findings: [finding({ id: "missing-receipt" })],
        }),
        snapshot({
          timestamp: "2026-06-29T18:00:00.000Z",
          findings: [finding({ id: "missing-receipt" })],
        }),
      ]),
    });

    const report = service.analyze();

    expect(report.recurringRisks).toContainEqual({
      id: "missing-receipt",
      finding: finding({ id: "missing-receipt" }),
      occurrences: 3,
      firstSeen: "2026-06-27T18:00:00.000Z",
      lastSeen: "2026-06-29T18:00:00.000Z",
      ageInSnapshots: 3,
      persistenceScore: 1,
      status: "recurring",
    });
  });

  it("identifies resolved risks missing from the latest snapshot", () => {
    const service = new RiskWatchlistService({
      repository: repositoryWithSnapshots([
        snapshot({
          timestamp: "2026-06-28T18:00:00.000Z",
          findings: [finding({ id: "missing-approval" })],
        }),
        snapshot({
          timestamp: "2026-06-29T18:00:00.000Z",
          findings: [finding({ id: "clean-current-risk" })],
        }),
      ]),
    });

    const report = service.analyze();

    expect(report.resolvedRisks.map((risk) => risk.id)).toEqual([
      "missing-approval",
    ]);
  });

  it("identifies aging risks that persist for at least three snapshots", () => {
    const service = new RiskWatchlistService({
      repository: repositoryWithSnapshots([
        snapshot({
          timestamp: "2026-06-26T18:00:00.000Z",
          findings: [finding({ id: "stale-control-gap", severity: "medium" })],
        }),
        snapshot({
          timestamp: "2026-06-27T18:00:00.000Z",
          findings: [finding({ id: "stale-control-gap", severity: "medium" })],
        }),
        snapshot({
          timestamp: "2026-06-28T18:00:00.000Z",
          findings: [finding({ id: "stale-control-gap", severity: "medium" })],
        }),
        snapshot({
          timestamp: "2026-06-29T18:00:00.000Z",
          findings: [finding({ id: "stale-control-gap", severity: "medium" })],
        }),
      ]),
    });

    const report = service.analyze();

    expect(report.agingRisks.map((risk) => risk.id)).toEqual([
      "stale-control-gap",
    ]);
    expect(report.agingRisks[0].ageInSnapshots).toBe(4);
    expect(report.agingRisks[0].persistenceScore).toBe(1);
  });

  it("creates executive watchlist items ordered by persistence then score", () => {
    const persistent = finding({
      id: "persistent-critical-risk",
      severity: "critical",
      score: 90,
    });
    const highScoreNew = finding({
      id: "high-score-new-risk",
      severity: "high",
      score: 95,
    });

    const service = new RiskWatchlistService({
      repository: repositoryWithSnapshots([
        snapshot({
          timestamp: "2026-06-27T18:00:00.000Z",
          findings: [persistent],
        }),
        snapshot({
          timestamp: "2026-06-28T18:00:00.000Z",
          findings: [persistent],
        }),
        snapshot({
          timestamp: "2026-06-29T18:00:00.000Z",
          findings: [persistent, highScoreNew],
        }),
      ]),
    });

    const report = service.analyze();

    expect(report.watchlistItems.map((item) => item.id)).toEqual([
      "persistent-critical-risk",
      "high-score-new-risk",
    ]);
    expect(report.watchlistItems[0]).toMatchObject({
      status: "recurring",
      severity: "critical",
      persistenceScore: 1,
      executiveSummary:
        "persistent-critical-risk explanation Persisted across 3 of 3 snapshots.",
      recommendedAction: "persistent-critical-risk action",
    });
  });
});
