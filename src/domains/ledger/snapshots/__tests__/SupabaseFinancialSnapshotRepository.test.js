import { beforeEach, describe, expect, test, vi } from "vitest";

import { FinancialSnapshot } from "../FinancialSnapshot.js";
import { SupabaseFinancialSnapshotRepository } from "../SupabaseFinancialSnapshotRepository.js";

const query = {
  upsert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  order: vi.fn(),
  eq: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => query),
  },
}));

function makeSnapshot(id, capturedAt) {
  return new FinancialSnapshot({
    id,
    capturedAt,
    period: {
      start: "2026-07-01",
      end: "2026-07-31",
    },
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
      phase: "7.6",
    },
  });
}

function makeRow(snapshot) {
  return {
    id: snapshot.id,
    captured_at: snapshot.capturedAt,
    period_start: snapshot.period.start,
    period_end: snapshot.period.end,
    kpis: snapshot.kpis,
    health: snapshot.health,
    metadata: snapshot.metadata,
    snapshot: {
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      period: snapshot.period,
      kpis: snapshot.kpis,
      health: snapshot.health,
      metadata: snapshot.metadata,
    },
  };
}

describe("SupabaseFinancialSnapshotRepository", () => {
  beforeEach(() => {
    query.upsert.mockReset();
    query.select.mockReset();
    query.single.mockReset();
    query.order.mockReset();
    query.eq.mockReset();
    query.limit.mockReset();
    query.maybeSingle.mockReset();

    query.upsert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.limit.mockReturnValue(query);
  });

  test("saves immutable financial snapshots", async () => {
    const snapshot = makeSnapshot(
      "snapshot-1",
      "2026-07-04T00:00:00.000Z",
    );

    query.single.mockResolvedValue({
      data: makeRow(snapshot),
      error: null,
    });

    const repository = new SupabaseFinancialSnapshotRepository();
    const result = await repository.save(snapshot);

    expect(query.upsert).toHaveBeenCalledWith({
      id: "snapshot-1",
      captured_at: "2026-07-04T00:00:00.000Z",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      kpis: snapshot.kpis,
      health: snapshot.health,
      metadata: snapshot.metadata,
      snapshot: {
        id: snapshot.id,
        capturedAt: snapshot.capturedAt,
        period: snapshot.period,
        kpis: snapshot.kpis,
        health: snapshot.health,
        metadata: snapshot.metadata,
      },
    });

    expect(result).toBeInstanceOf(FinancialSnapshot);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.id).toBe("snapshot-1");
    expect(result.kpis.equity).toBe(850000);
  });

  test("lists snapshots ordered by captured date", async () => {
    const first = makeSnapshot("snapshot-1", "2026-07-04T00:00:00.000Z");
    const second = makeSnapshot("snapshot-2", "2026-07-05T00:00:00.000Z");

    query.order.mockResolvedValue({
      data: [makeRow(first), makeRow(second)],
      error: null,
    });

    const repository = new SupabaseFinancialSnapshotRepository();
    const result = await repository.list();

    expect(query.order).toHaveBeenCalledWith("captured_at", {
      ascending: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe("snapshot-2");
  });

  test("finds a snapshot by id", async () => {
    const snapshot = makeSnapshot(
      "snapshot-1",
      "2026-07-04T00:00:00.000Z",
    );

    query.maybeSingle.mockResolvedValue({
      data: makeRow(snapshot),
      error: null,
    });

    const repository = new SupabaseFinancialSnapshotRepository();
    const result = await repository.findById("snapshot-1");

    expect(query.eq).toHaveBeenCalledWith("id", "snapshot-1");
    expect(result.id).toBe("snapshot-1");
  });

  test("returns null when a snapshot is missing", async () => {
    query.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const repository = new SupabaseFinancialSnapshotRepository();
    const result = await repository.findById("missing");

    expect(result).toBe(null);
  });

  test("finds the latest snapshot", async () => {
    const snapshot = makeSnapshot(
      "snapshot-2",
      "2026-07-05T00:00:00.000Z",
    );

    query.maybeSingle.mockResolvedValue({
      data: makeRow(snapshot),
      error: null,
    });

    const repository = new SupabaseFinancialSnapshotRepository();
    const result = await repository.findLatest();

    expect(query.order).toHaveBeenCalledWith("captured_at", {
      ascending: false,
    });
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(result.id).toBe("snapshot-2");
  });
});
