import { RiskHistoryService, type RiskSnapshot } from "./risk-history.service";
import type { RiskSnapshotRepository } from "./risk-snapshot.repository";

export type RiskTimelinePoint = {
  snapshot: RiskSnapshot;
  previousSnapshot: RiskSnapshot | null;
  scoreChange: number;
  direction: "improving" | "worsening" | "stable";
};

export type RiskTimelineMetrics = {
  snapshotCount: number;
  averageScore: number;
  volatility: number;
  longestImprovementStreak: number;
  longestWorseningStreak: number;
};

export class RiskTimelineService {
  private readonly repository: RiskSnapshotRepository;
  private readonly history: RiskHistoryService;

  constructor({
    repository,
    history = new RiskHistoryService(),
  }: {
    repository: RiskSnapshotRepository;
    history?: RiskHistoryService;
  }) {
    this.repository = repository;
    this.history = history;
  }

  timeline(): RiskTimelinePoint[] {
    const snapshots = this.repository.all();

    return snapshots.map((snapshot, index) => {
      const previousSnapshot = index > 0 ? snapshots[index - 1] : null;
      const trend = this.history.compare(snapshot, previousSnapshot);

      return {
        snapshot,
        previousSnapshot,
        scoreChange: trend.scoreChange,
        direction: trend.direction,
      };
    });
  }

  metrics(): RiskTimelineMetrics {
    const points = this.timeline();
    const scores = points.map((point) => point.snapshot.overallScore);

    return {
      snapshotCount: points.length,
      averageScore: this.average(scores),
      volatility: this.volatility(points),
      longestImprovementStreak: this.longestStreak(points, "improving"),
      longestWorseningStreak: this.longestStreak(points, "worsening"),
    };
  }

  private average(scores: number[]): number {
    if (scores.length === 0) return 0;

    return scores.reduce((total, score) => total + score, 0) / scores.length;
  }

  private volatility(points: RiskTimelinePoint[]): number {
    return points.reduce(
      (largestChange, point) =>
        Math.max(largestChange, Math.abs(point.scoreChange)),
      0
    );
  }

  private longestStreak(
    points: RiskTimelinePoint[],
    direction: RiskTimelinePoint["direction"]
  ): number {
    let current = 0;
    let longest = 0;

    for (const point of points) {
      if (point.direction === direction) {
        current += 1;
        longest = Math.max(longest, current);
      } else {
        current = 0;
      }
    }

    return longest;
  }
}
