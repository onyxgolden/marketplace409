import { describe, expect, test } from "vitest";
import { FinancialSnapshot } from "../FinancialSnapshot.js";
import { FinancialSnapshotRepository } from "../FinancialSnapshotRepository.js";

function makeSnapshot(id, capturedAt) {
  return new FinancialSnapshot({
    id,
    capturedAt,
    kpis: { cash: 100 },
    health: { label: "Healthy" },
  });
}

describe("FinancialSnapshotRepository", () => {
  test("saves and lists immutable snapshots", () => {
    const repository = new FinancialSnapshotRepository();
    const snapshot = makeSnapshot("snapshot-1", "2026-07-04T00:00:00.000Z");

    repository.save(snapshot);

    const snapshots = repository.list();

    expect(Object.isFrozen(snapshots)).toBe(true);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toBe(snapshot);
  });

  test("finds snapshots by id and latest snapshot", () => {
    const first = makeSnapshot("snapshot-1", "2026-07-04T00:00:00.000Z");
    const second = makeSnapshot("snapshot-2", "2026-07-05T00:00:00.000Z");
    const repository = new FinancialSnapshotRepository([first]);

    repository.save(second);

    expect(repository.findById("snapshot-1")).toBe(first);
    expect(repository.findById("missing")).toBe(null);
    expect(repository.findLatest()).toBe(second);
  });
});
