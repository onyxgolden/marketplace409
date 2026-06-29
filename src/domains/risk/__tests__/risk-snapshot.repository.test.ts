import { describe, expect, it } from "vitest";
import { InMemoryRiskSnapshotRepository } from "../in-memory-risk-snapshot.repository";
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

describe("InMemoryRiskSnapshotRepository", () => {
  it("stores snapshots in insertion order", () => {
    const repository = new InMemoryRiskSnapshotRepository();
    const first = snapshot({
      timestamp: "2026-06-28T18:00:00.000Z",
      overallScore: 10,
    });
    const second = snapshot({
      timestamp: "2026-06-29T18:00:00.000Z",
      overallScore: 80,
    });

    repository.save(first);
    repository.save(second);

    expect(repository.all()).toEqual([first, second]);
  });

  it("returns latest and previous snapshots", () => {
    const repository = new InMemoryRiskSnapshotRepository();
    const first = snapshot({
      timestamp: "2026-06-27T18:00:00.000Z",
      overallScore: 10,
    });
    const second = snapshot({
      timestamp: "2026-06-28T18:00:00.000Z",
      overallScore: 20,
    });
    const third = snapshot({
      timestamp: "2026-06-29T18:00:00.000Z",
      overallScore: 30,
    });

    repository.save(first);
    repository.save(second);
    repository.save(third);

    expect(repository.latest()).toEqual(third);
    expect(repository.previous()).toEqual(second);
  });

  it("returns null when latest or previous snapshots do not exist", () => {
    const repository = new InMemoryRiskSnapshotRepository();

    expect(repository.latest()).toBeNull();
    expect(repository.previous()).toBeNull();

    repository.save(
      snapshot({
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 10,
      })
    );

    expect(repository.latest()).not.toBeNull();
    expect(repository.previous()).toBeNull();
  });

  it("returns a copy of all snapshots", () => {
    const repository = new InMemoryRiskSnapshotRepository();

    repository.save(
      snapshot({
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 10,
      })
    );

    const allSnapshots = repository.all();
    allSnapshots.push(
      snapshot({
        timestamp: "2026-06-30T18:00:00.000Z",
        overallScore: 80,
      })
    );

    expect(repository.all()).toHaveLength(1);
  });
});
