// Work Package Planner slice 6 — application tests. Supabase-shaped
// chain mock, same shape as workSteps.test.js. The curve read is ONE
// snapshot RPC call (baseline + steps + placements + assignments from a
// single database snapshot) — no paged reads, no retry loop. Placement
// writes name the exact baseline version. Also covers the pre-migration
// window: a missing snapshot RPC reads as notApplied, and a missing
// placements table reports 503, never a raw error.

import { describe, expect, it, vi } from "vitest";
import {
  clearStepPlacement,
  getManpowerCurve,
  listPlacementRevisions,
  mapManpowerCurveRpcError,
  setStepPlacement,
} from "./manpowerCurve.js";

function mockDb(chains = [], rpcResults = []) {
  const queue = [...chains];
  const rpcQueue = [...rpcResults];
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
    rpc: vi.fn(async () => {
      if (rpcQueue.length === 0) throw new Error("mockDb: rpc() called more times than results queued");
      return rpcQueue.shift();
    }),
  };
}

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    gte: vi.fn(() => node), lte: vi.fn(() => node), is: vi.fn(() => node),
    not: vi.fn(() => node), in: vi.fn(() => node),
    range: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

// A chain whose range() actually pages: `then` resolves the slice the
// caller asked for, with PostgREST's inclusive range semantics. This is
// what proves the revision paging regression — a limit of 50 must return
// at most 50 rows, never 51.
function pagedChain(rows) {
  let from = 0;
  let to = 0;
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    is: vi.fn(() => node),
    range: vi.fn((lo, hi) => { from = lo; to = hi; return node; }),
    single: vi.fn(async () => ({ data: null, error: null })),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    then: (resolve) => resolve({ data: rows.slice(from, to + 1), error: null }),
  };
  return node;
}

const OWNER = "owner_1";
const PKG_ROW = { id: "pkg_1", status: "in_progress" };
const SNAPSHOT = {
  baseline: { version_number: 1, baseline_start: "2026-11-09", baseline_finish: "2026-11-18", frozen_at: "t0" },
  steps: [{
    id: "step_1", title: "Fabricate spool", sequence_no: 1,
    craft_key: "pipefitter", craft_label: "Pipefitter",
    planned_duration_days: 4, planned_person_hours: "40.00", version: 1,
  }],
  placements: [],
  assignments: [{
    work_date: "2026-11-09", craft_key: "pipefitter", craft_label: "Pipefitter",
    crew_size: 2, hours_per_person: "7.00",
  }],
  generations: {
    steps: { count: 1, max_version: 1 },
    placements: { count: 0, max_version: null },
    assignments: { count: 1, max_version: 1 },
    baseline_version: 1,
  },
};
const PLACEMENT_ROW = {
  id: "place_1", owner_id: OWNER, work_package_id: "pkg_1", step_id: "step_1",
  baseline_version: 1, start_day_index: 3, version: 1, retired_at: null, retired_by: null,
  created_by: "user_1", updated_by: "user_1", created_at: "t1", updated_at: "t1",
};
const PLACEMENT_REVISION_ROW = {
  id: "prev_1", owner_id: OWNER, placement_id: "place_1", version: 1,
  actor_id: "user_1", action: "set", old_values: null,
  new_values: { baseline_version: 1, start_day_index: 3, version: 1 }, reason: null, recorded_at: "t1",
};
const MISSING_TABLE = { code: "42P01", message: 'relation "forge_work_step_curve_placements" does not exist' };

// The two calls getManpowerCurve makes, in order: package, snapshot RPC.
function curveDb({ snapshot = SNAPSHOT } = {}, rpcError = null) {
  return mockDb(
    [chain({ data: PKG_ROW, error: null })],
    [{ data: snapshot, error: rpcError }],
  );
}

describe("getManpowerCurve", () => {
  it("recomputes the curve from one snapshot RPC call and returns server-computed totals", async () => {
    const db = curveDb();
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.packageStatus).toBe("in_progress");
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_manpower_curve_snapshot", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_baseline_version: null,
    });
    expect(db.from).toHaveBeenCalledTimes(1); // the package check only — no paged reads
    expect(result.curve.windowConfigured).toBe(true);
    expect(result.curve.baseline.versionNumber).toBe(1);
    expect(result.curve.window.outageEndDate).toBe("2026-11-18");
    expect(result.curve.window.outageDays).toBe(10);
    expect(result.curve.days.slice(0, 4).map((d) => d.totalRequiredHours)).toEqual([10, 10, 10, 10]);
    expect(result.curve.days[0].totalAssignedHours).toBe(14);
    expect(result.curve.totals.requiredHours).toBe(40);
    expect(result.curve.totals.assignedHours).toBe(14);
    expect(result.curve.reconciliation.reconciled).toBe(true);
    expect(result.curve.notApplied).toBe(false);
    expect(result.curve.generations).toEqual(SNAPSHOT.generations);
    expect(typeof result.curve.computedAt).toBe("string");
  });

  it("passes a named baseline version through to the snapshot RPC", async () => {
    const db = curveDb();
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1", baselineVersion: 2 });
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_manpower_curve_snapshot", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_baseline_version: 2,
    });
  });

  it("rejects a non-numeric baseline version before calling the RPC", async () => {
    const db = curveDb();
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1", baselineVersion: "abc" });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("applies an explicit placement instead of the baseline", async () => {
    const placed = { ...SNAPSHOT, placements: [{ id: "place_1", step_id: "step_1", start_day_index: 3, version: 1 }] };
    const db = curveDb({ snapshot: placed });
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.curve.days.slice(0, 2).map((d) => d.totalRequiredHours)).toEqual([0, 0]);
    expect(result.curve.days.slice(2, 4).map((d) => d.totalRequiredHours)).toEqual([10, 10]);
    expect(result.curve.steps[0].placement).toMatchObject({ id: "place_1", startDayIndex: 3, version: 1 });
  });

  it("reports a missing baseline as configuration, not an error", async () => {
    const db = curveDb({ snapshot: { ...SNAPSHOT, baseline: null } });
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.curve.windowConfigured).toBe(false);
    expect(result.curve.excludedSteps).toHaveLength(1);
    expect(result.curve.excludedSteps[0].reason).toBe("baseline_not_frozen");
    expect(result.curve.warnings.some((w) => w.code === "BASELINE_NOT_FROZEN")).toBe(true);
  });

  it("reports a missing snapshot RPC as notApplied instead of failing", async () => {
    const db = curveDb({}, { code: "PGRST202", message: "Could not find the function" });
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.curve.notApplied).toBe(true);
    expect(result.curve.windowConfigured).toBe(false);
  });

  it("maps a named-but-missing baseline to 404 and a stale baseline to 409", async () => {
    const missing = curveDb({}, { message: "WPP6_BASELINE_NOT_FOUND" });
    expect(await getManpowerCurve(missing, { ownerId: OWNER, packageId: "pkg_1", baselineVersion: 9 }))
      .toMatchObject({ ok: false, httpStatus: 404, error: "Baseline version not found." });
    const stale = curveDb({}, { message: "WPP6_BASELINE_STALE" });
    const staleResult = await setStepPlacement(stale, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { stepId: "step_1", baselineVersion: 1, startDayIndex: 3 },
    });
    expect(staleResult).toMatchObject({ ok: false, httpStatus: 409 });
    expect(staleResult.error).toMatch(/re-baselined/);
  });

  it("404s on an unknown package without calling the RPC", async () => {
    const db = mockDb([chain({ data: null, error: null })], []);
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("setStepPlacement", () => {
  it("calls the placement RPC with the exact baseline version and returns the camelCased row", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: PLACEMENT_ROW, error: null }],
    );
    const result = await setStepPlacement(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { stepId: "step_1", baselineVersion: 1, startDayIndex: 3 },
    });
    expect(result.ok).toBe(true);
    expect(result.placement).toMatchObject({ id: "place_1", stepId: "step_1", baselineVersion: 1, startDayIndex: 3, version: 1 });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_manpower_curve_placement_set", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_step_id: "step_1",
      p_baseline_version: 1,
      p_start_day_index: 3,
      p_expected_version: null,
      p_reason: null,
    });
  });

  it("rejects a placement without a baseline version before touching the database", async () => {
    const db = mockDb([], []);
    const result = await setStepPlacement(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { stepId: "step_1", startDayIndex: 3 },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps a placement-outside-window failure to 409 with the affected step ids", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: null, error: { message: "WPP6_PLACEMENT_OUTSIDE_WINDOW:step_1,step_2" } }],
    );
    const result = await setStepPlacement(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { stepId: "step_1", baselineVersion: 1, startDayIndex: 9 },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409, code: "PLACEMENT_OUTSIDE_WINDOW" });
    expect(result.affectedStepIds).toEqual(["step_1", "step_2"]);
    expect(result.error).toMatch(/2 steps outside the outage window/);
  });
});

describe("clearStepPlacement", () => {
  it("requires a version and a reason before touching the database", async () => {
    const db = mockDb([], []);
    const result = await clearStepPlacement(db, {
      ownerId: OWNER, packageId: "pkg_1", placementId: "place_1", expectedVersion: 1, reason: "  ",
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls the clear RPC and returns the retired placement", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: { ...PLACEMENT_ROW, retired_at: "t3", version: 2 }, error: null }],
    );
    const result = await clearStepPlacement(db, {
      ownerId: OWNER, packageId: "pkg_1", placementId: "place_1", expectedVersion: 1, reason: "No longer sequenced",
    });
    expect(result.ok).toBe(true);
    expect(result.placement).toMatchObject({ id: "place_1", retiredAt: "t3", version: 2 });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_manpower_curve_placement_clear", {
      p_owner_id: OWNER,
      p_placement_id: "place_1",
      p_expected_version: 1,
      p_reason: "No longer sequenced",
    });
  });
});

describe("listPlacementRevisions", () => {
  it("returns the placement with its bounded history", async () => {
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: PLACEMENT_ROW, error: null }),
      chain({ data: [PLACEMENT_REVISION_ROW], error: null }),
    ], []);
    const result = await listPlacementRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", placementId: "place_1", limit: "100", offset: "0",
    });
    expect(result.ok).toBe(true);
    expect(result.placement).toMatchObject({ id: "place_1", baselineVersion: 1, startDayIndex: 3 });
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ action: "set", version: 1 });
    expect(result.hasMore).toBe(false);
  });

  it("requests an inclusive PostgREST range (limit 50 = rows 0..49, never 51 rows)", async () => {
    const revisionsChain = chain({ data: [PLACEMENT_REVISION_ROW], error: null });
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: PLACEMENT_ROW, error: null }),
      revisionsChain,
    ], []);
    await listPlacementRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", placementId: "place_1", limit: "50", offset: "0",
    });
    expect(revisionsChain.range).toHaveBeenCalledWith(0, 49);
  });

  it("pages 201 revisions exactly once with no duplicates and no missing rows", async () => {
    const all = Array.from({ length: 201 }, (_, i) => ({
      ...PLACEMENT_REVISION_ROW, id: `prev_${i + 1}`, version: i + 1,
    }));
    const seen = [];
    let hasMore = true;
    for (let offset = 0; offset < 201; offset += 50) {
      const revisionsChain = pagedChain(all);
      const db = mockDb([
        chain({ data: PKG_ROW, error: null }),
        chain({ data: PLACEMENT_ROW, error: null }),
        revisionsChain,
      ], []);
      const result = await listPlacementRevisions(db, {
        ownerId: OWNER, packageId: "pkg_1", placementId: "place_1", limit: "50", offset: String(offset),
      });
      expect(result.ok).toBe(true);
      expect(result.revisions.length).toBeLessThanOrEqual(50);
      seen.push(...result.revisions.map((r) => r.version));
      hasMore = result.hasMore;
    }
    expect(seen).toHaveLength(201);
    expect(new Set(seen).size).toBe(201);
    expect(seen).toEqual(Array.from({ length: 201 }, (_, i) => i + 1));
    expect(hasMore).toBe(false);
  });

  it("rejects a limit above 200", async () => {
    const db = mockDb([], []);
    const result = await listPlacementRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", placementId: "place_1", limit: "201", offset: "0",
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("404s on an unknown placement", async () => {
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: null, error: null }),
    ], []);
    const result = await listPlacementRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", placementId: "place_9", limit: "100", offset: "0",
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Placement not found." });
  });

  it("reports a missing placements table as 503, never a raw error", async () => {
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: null, error: MISSING_TABLE }),
    ], []);
    const result = await listPlacementRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", placementId: "place_1", limit: "100", offset: "0",
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 503 });
  });
});

describe("mapManpowerCurveRpcError", () => {
  it("maps the slice-6 codes to plain English", () => {
    expect(mapManpowerCurveRpcError({ message: "WPP6_WORKSPACE_FORBIDDEN" }))
      .toMatchObject({ ok: false, httpStatus: 404 });
    expect(mapManpowerCurveRpcError({ message: "WPP6_PACKAGE_NOT_FOUND" }))
      .toMatchObject({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(mapManpowerCurveRpcError({ message: "WPP6_BASELINE_NOT_FOUND" }))
      .toMatchObject({ ok: false, httpStatus: 404, error: "Baseline version not found." });
    expect(mapManpowerCurveRpcError({ message: "WPP6_BASELINE_STALE" }))
      .toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapManpowerCurveRpcError({ message: "WPP6_VERSION_CONFLICT" }))
      .toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapManpowerCurveRpcError({ message: "WPP6_PACKAGE_TERMINAL" }))
      .toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapManpowerCurveRpcError({ message: "WPP6_REASON_REQUIRED" }))
      .toMatchObject({ ok: false, httpStatus: 400 });
    expect(mapManpowerCurveRpcError({ message: "WPP6_INVALID_START_DAY" }))
      .toMatchObject({ ok: false, httpStatus: 400 });
    expect(mapManpowerCurveRpcError({ code: "PGRST202", message: "Could not find the function" }))
      .toMatchObject({ ok: false, httpStatus: 503 });
  });

  it("throws unknown failures for the route to turn into a 500", () => {
    expect(() => mapManpowerCurveRpcError({ message: "boom" })).toThrow("boom");
  });
});
