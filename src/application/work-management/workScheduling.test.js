import { describe, expect, it, vi } from "vitest";
import {
  freezeBaseline,
  recordProgressSnapshot,
  recordWeeklyCommitment,
  recordManpowerDay,
  getScheduleStatus,
} from "./workScheduling.js";

function mockDb(chains = []) {
  const queue = [...chains];
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
  };
}

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    limit: vi.fn(() => node),
    insert: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const CTX = { ownerId: "owner_1", packageId: "forge_wp_1" };
const BASELINE = {
  version_number: 1, baseline_hours: "1000", baseline_cost: "50000",
  baseline_start: "2026-10-01", baseline_finish: "2026-10-11",
};

describe("freezeBaseline", () => {
  it("inserts version 1 when no baseline exists", async () => {
    const insertChain = chain({ data: { version_number: 1 }, error: null });
    const db = mockDb([
      chain({ data: null, error: null }),
      insertChain,
    ]);
    const result = await freezeBaseline(db, {
      ...CTX,
      baseline: { start: "2026-10-01", finish: "2026-10-31", hours: 1000, cost: 50000 },
      frozenBy: "user_1",
    });
    expect(result.version_number).toBe(1);
    const inserted = insertChain.insert.mock.calls[0][0];
    expect(inserted.version_number).toBe(1);
    expect(inserted.frozen_by).toBe("user_1");
  });

  it("increments version when a baseline exists", async () => {
    const insertChain = chain({ data: { version_number: 3 }, error: null });
    const db = mockDb([
      chain({ data: { version_number: 2 }, error: null }),
      insertChain,
    ]);
    const result = await freezeBaseline(db, {
      ...CTX,
      baseline: { start: "2026-11-01", finish: "2026-11-30", hours: 1200, cost: 60000 },
      frozenBy: "user_1",
    });
    expect(result.version_number).toBe(3);
    expect(insertChain.insert.mock.calls[0][0].version_number).toBe(3);
  });

  it("retries on a concurrent version collision", async () => {
    const retryInsert = chain({ data: { version_number: 3 }, error: null });
    const db = mockDb([
      chain({ data: { version_number: 2 }, error: null }),           // first max read
      chain({ data: null, error: { code: "23505", message: "duplicate key" } }), // collision
      chain({ data: { version_number: 3 }, error: null }),           // retried max read
      retryInsert,
    ]);
    const result = await freezeBaseline(db, {
      ...CTX,
      baseline: { start: "2026-11-01", finish: "2026-11-30", hours: 1200, cost: 60000 },
      frozenBy: "user_1",
    });
    expect(result.version_number).toBe(3);
    expect(retryInsert.insert.mock.calls[0][0].version_number).toBe(4);
  });

  it("requires an authenticated actor — never undefined, never 'system'", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    await expect(freezeBaseline(db, {
      ...CTX,
      baseline: { start: "2026-10-01", finish: "2026-10-31", hours: 1000, cost: 50000 },
    })).rejects.toThrow(/frozenBy/);
  });
});

describe("recordProgressSnapshot", () => {
  it("computes earned value through the package progress method", async () => {
    const insertChain = chain({ data: { id: "s1" }, error: null });
    const db = mockDb([
      chain({ data: { id: "forge_wp_1", progress_method: "physical_quantity", weight_method: "hours" }, error: null }),
      chain({ data: BASELINE, error: null }),
      insertChain,
    ]);
    const result = await recordProgressSnapshot(db, {
      ...CTX,
      statusDate: "2026-10-04",
      measurements: { installedQty: 250, plannedQty: 1000 },
      actualHours: 300, actualCost: 15000,
      recordedBy: "user_1",
    });
    const inserted = insertChain.insert.mock.calls[0][0];
    expect(inserted.earned_pct).toBe(25);
    expect(inserted.earned_hours).toBe(250);
    expect(inserted.earned_cost).toBe(12500);
    expect(inserted.baseline_version).toBe(1);
    // Planned % is derived from the frozen schedule (3 of 10 days = 30%),
    // never caller-supplied.
    expect(inserted.planned_pct).toBe(30);
    expect(result.variances.costVariance).toBe(-2500);
  });

  it("derives planned % as 0 before the baseline start", async () => {
    const insertChain = chain({ data: { id: "s1" }, error: null });
    const db = mockDb([
      chain({ data: { id: "forge_wp_1", progress_method: "physical_quantity", weight_method: "hours" }, error: null }),
      chain({ data: BASELINE, error: null }),
      insertChain,
    ]);
    await recordProgressSnapshot(db, {
      ...CTX,
      statusDate: "2026-09-20",
      measurements: { installedQty: 250, plannedQty: 1000 },
      actualHours: 10, actualCost: 500,
      recordedBy: "user_1",
    });
    const inserted = insertChain.insert.mock.calls[0][0];
    expect(inserted.planned_pct).toBe(0);
  });

  it("records valid progress when actuals are zero (undefined CPI)", async () => {
    // Reviewer finding, PR #549: zero actuals must not throw.
    const insertChain = chain({ data: { id: "s1" }, error: null });
    const db = mockDb([
      chain({ data: { id: "forge_wp_1", progress_method: "physical_quantity", weight_method: "hours" }, error: null }),
      chain({ data: BASELINE, error: null }),
      insertChain,
    ]);
    const result = await recordProgressSnapshot(db, {
      ...CTX,
      statusDate: "2026-10-04",
      measurements: { installedQty: 250, plannedQty: 1000 },
      actualHours: 0, actualCost: 0,
      recordedBy: "user_1",
    });
    const inserted = insertChain.insert.mock.calls[0][0];
    // ETC forecasts the remaining work at plan; EAC is actuals + ETC.
    expect(inserted.etc_cost).toBe(37500);
    expect(inserted.eac_cost).toBe(37500);
    expect(inserted.etc_hours).toBe(750);
    expect(result.variances.cpi).toBe(Infinity);
  });

  it("requires an authenticated actor", async () => {
    const db = mockDb([
      chain({ data: { id: "forge_wp_1", progress_method: "physical_quantity" }, error: null }),
      chain({ data: BASELINE, error: null }),
    ]);
    await expect(recordProgressSnapshot(db, {
      ...CTX, statusDate: "2026-10-04",
      measurements: { installedQty: 1, plannedQty: 4 },
      actualHours: 1, actualCost: 1,
    })).rejects.toThrow(/recordedBy/);
  });

  it("throws when no baseline is frozen", async () => {
    const db = mockDb([
      chain({ data: { id: "forge_wp_1", progress_method: "physical_quantity" }, error: null }),
      chain({ data: null, error: null }),
    ]);
    await expect(recordProgressSnapshot(db, {
      ...CTX, statusDate: "2026-10-04",
      measurements: { installedQty: 1, plannedQty: 4 },
      actualHours: 1, actualCost: 1,
      recordedBy: "user_1",
    })).rejects.toThrow(/no baseline/i);
  });
});

describe("recordWeeklyCommitment", () => {
  it("stores the commitment with computed PPC", async () => {
    const insertChain = chain({ data: { id: "c1" }, error: null });
    const db = mockDb([insertChain]);
    const result = await recordWeeklyCommitment(db, {
      ...CTX,
      weekStartDate: "2026-09-28",
      crewName: "Crew A",
      plannedCount: 10, completedCount: 8,
      nonCompletionReasons: ["waiting on materials"],
      recordedBy: "user_1",
    });
    expect(result.ppc).toBe(80);
    const inserted = insertChain.insert.mock.calls[0][0];
    expect(inserted.crew_name).toBe("Crew A");
    expect(inserted.non_completion_reasons).toEqual(["waiting on materials"]);
  });
});

describe("recordManpowerDay", () => {
  it("stores the day row with variance deltas", async () => {
    const insertChain = chain({ data: { id: "m1" }, error: null });
    const db = mockDb([insertChain]);
    const result = await recordManpowerDay(db, {
      ...CTX,
      workDate: "2026-10-04", company: "ABC", craft: "pipefitter",
      plannedHeads: 10, actualHeads: 12,
      plannedManhours: 100, estimatedManhours: 110, actualManhours: 96,
      recordedBy: "user_1",
    });
    expect(result.variances.headsDelta).toBe(2);
    expect(result.variances.timesheetVsTrackDelta).toBe(14);
  });
});

describe("getScheduleStatus", () => {
  it("returns baseline, snapshot, and variances", async () => {
    const db = mockDb([
      chain({ data: BASELINE, error: null }),
      chain({ data: {
        earned_cost: "12500", actual_cost: "15000", planned_pct: "30",
        baseline_version: 1,
      }, error: null }),
      chain({ data: BASELINE, error: null }),
    ]);
    const status = await getScheduleStatus(db, CTX);
    expect(status.baseline.version_number).toBe(1);
    expect(status.variances.costVariance).toBe(-2500);
    expect(status.variances.cpi).toBeCloseTo(0.833, 2);
  });

  it("resolves variances against the snapshot's named baseline, not the current one", async () => {
    // Reviewer finding, PR #549: re-baselining must not rewrite history.
    // Snapshot: earned_cost=250, planned_pct=50 against version 1 (BAC=1000).
    const v1 = { ...BASELINE, version_number: 1, baseline_cost: "1000" };
    const v2 = { ...BASELINE, version_number: 2, baseline_cost: "2000" };
    const db = mockDb([
      chain({ data: v2, error: null }), // current baseline (after re-baseline)
      chain({ data: {
        earned_cost: "250", actual_cost: "250", planned_pct: "50",
        baseline_version: 1,
      }, error: null }),
      chain({ data: v1, error: null }), // named version 1
    ]);
    const status = await getScheduleStatus(db, CTX);
    // Against version 1: PV = 50% of 1000 = 500; SV = 250 - 500 = -250.
    expect(status.variances.scheduleVariance).toBe(-250);
    expect(status.variances.spi).toBe(0.5);
  });

  it("returns null snapshot when none recorded", async () => {
    const db = mockDb([
      chain({ data: BASELINE, error: null }),
      chain({ data: null, error: null }),
    ]);
    const status = await getScheduleStatus(db, CTX);
    expect(status.snapshot).toBeNull();
    expect(status.variances).toBeNull();
  });
});
