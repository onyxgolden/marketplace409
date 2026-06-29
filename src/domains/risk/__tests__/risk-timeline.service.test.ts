import { describe, expect, it } from "vitest";
import { InMemoryRiskSnapshotRepository } from "../in-memory-risk-snapshot.repository";
import { RiskTimelineService } from "../risk-timeline.service";
import type { RiskSnapshot } from "../risk-history.service";

const snapshot = ({
  timestamp,
  overallScore,
}: {
  timestamp: string;
  overallScore: number;
}): RiskSnapshot => ({
  timestamp,
  overallScore,
  severity: overallScore >= 80 ? "high" : "low",
  findingCount: 0,
  topDrivers: [],
});

const repositoryWithScores = (scores: number[]): InMemoryRiskSnapshotRepository => {
  const repository = new InMemoryRiskSnapshotRepository();

  scores.forEach((overallScore, index) => {
    repository.save(
      snapshot({
        timestamp: `2026-06-${String(index + 1).padStart(2, "0")}T18:00:00.000Z`,
        overallScore,
      })
    );
  });

  return repository;
};

describe("RiskTimelineService", () => {
  it("returns an empty timeline when no snapshots exist", () => {
    const service = new RiskTimelineService({
      repository: new InMemoryRiskSnapshotRepository(),
    });

    expect(service.timeline()).toEqual([]);
    expect(service.metrics()).toEqual({
      snapshotCount: 0,
      averageScore: 0,
      volatility: 0,
      longestImprovementStreak: 0,
      longestWorseningStreak: 0,
    });
  });

  it("builds timeline points in repository insertion order", () => {
    const service = new RiskTimelineService({
      repository: repositoryWithScores([10, 30, 20]),
    });

    expect(
      service.timeline().map((point) => ({
        score: point.snapshot.overallScore,
        previousScore: point.previousSnapshot?.overallScore ?? null,
        scoreChange: point.scoreChange,
        direction: point.direction,
      }))
    ).toEqual([
      {
        score: 10,
        previousScore: null,
        scoreChange: 0,
        direction: "stable",
      },
      {
        score: 30,
        previousScore: 10,
        scoreChange: 20,
        direction: "worsening",
      },
      {
        score: 20,
        previousScore: 30,
        scoreChange: -10,
        direction: "improving",
      },
    ]);
  });

  it("calculates average risk score", () => {
    const service = new RiskTimelineService({
      repository: repositoryWithScores([10, 20, 30]),
    });

    expect(service.metrics().averageScore).toBe(20);
  });

  it("calculates volatility as the largest absolute score change", () => {
    const service = new RiskTimelineService({
      repository: repositoryWithScores([10, 45, 40, 75]),
    });

    expect(service.metrics().volatility).toBe(35);
  });

  it("calculates longest improvement and worsening streaks", () => {
    const service = new RiskTimelineService({
      repository: repositoryWithScores([80, 70, 60, 65, 75, 70]),
    });

    expect(service.metrics().longestImprovementStreak).toBe(2);
    expect(service.metrics().longestWorseningStreak).toBe(2);
  });
});
