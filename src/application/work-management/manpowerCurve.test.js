// Work Package Planner slice 6 — application tests. Supabase-shaped
// chain mock, same shape as workSteps.test.js, extended for the curve
// reads (settings + steps + placements + assignments, then the settings
// fence re-read) and the three slice-6 RPCs. Also covers the
// pre-migration window: a missing settings table reads as notApplied,
// and a missing RPC reports 503, never a raw error.

import { describe, expect, it, vi } from "vitest";
import {
  clearStepPlacement,
  getCurveSettings,
  getManpowerCurve,
  listPlacementRevisions,
  mapManpowerCurveRpcError,
  setCurveSettings,
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

const OWNER = "owner_1";
const PKG_ROW = { id: "pkg_1", status: "in_progress" };
const SETTINGS_ROW = {
  owner_id: OWNER, work_package_id: "pkg_1",
  outage_start_date: "2026-11-09", outage_days: 10, standard_hours_per_person_day: "8.00",
  version: 2, created_by: "user_1", updated_by: "user_1", created_at: "t1", updated_at: "t2",
};
const STEP_ROW = {
  id: "step_1", title: "Fabricate spool", sequence_no: 1,
  craft_key: "pipefitter", craft_label: "Pipefitter",
  planned_duration_days: 4, planned_person_hours: "40.00", version: 1,
};
const PLACEMENT_ROW = {
  id: "place_1", owner_id: OWNER, work_package_id: "pkg_1", step_id: "step_1",
  start_day_index: 3, version: 1, retired_at: null, retired_by: null,
  created_by: "user_1", updated_by: "user_1", created_at: "t1", updated_at: "t1",
};
const ASSIGNMENT_ROW = {
  work_date: "2026-11-09", craft_key: "pipefitter", craft_label: "Pipefitter",
  crew_size: 2, hours_per_person: "7.00",
};
const PLACEMENT_REVISION_ROW = {
  id: "prev_1", owner_id: OWNER, placement_id: "place_1", version: 1,
  actor_id: "user_1", action: "set", old_values: null,
  new_values: { start_day_index: 3, version: 1 }, reason: null, recorded_at: "t1",
};
const MISSING_TABLE = { code: "42P01", message: 'relation "forge_work_package_curve_settings" does not exist' };

// The six reads getManpowerCurve makes, in order: package, settings,
// steps, placements, assignments, settings fence re-read.
function curveChains({ settings = SETTINGS_ROW, steps = [STEP_ROW], placements = [], assignments = [ASSIGNMENT_ROW], fenceSettings = settings } = {}) {
  return [
    chain({ data: PKG_ROW, error: null }),
    chain({ data: settings, error: null }),
    chain({ data: steps, error: null }),
    chain({ data: placements, error: null }),
    chain({ data: assignments, error: null }),
    chain({ data: fenceSettings, error: null }),
  ];
}

describe("getManpowerCurve", () => {
  it("recomputes the curve from the live plan and returns server-computed totals", async () => {
    const db = mockDb(curveChains(), []);
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.packageStatus).toBe("in_progress");
    expect(result.curve.windowConfigured).toBe(true);
    expect(result.curve.window.outageEndDate).toBe("2026-11-18");
    expect(result.curve.days.slice(0, 4).map((d) => d.totalRequiredHours)).toEqual([10, 10, 10, 10]);
    expect(result.curve.days[0].totalAssignedHours).toBe(14);
    expect(result.curve.totals.requiredHours).toBe(40);
    expect(result.curve.totals.assignedHours).toBe(14);
    expect(result.curve.reconciliation.reconciled).toBe(true);
    expect(result.curve.notApplied).toBe(false);
    expect(result.curve.settings).toMatchObject({ outageStartDate: "2026-11-09", outageDays: 10, version: 2 });
    expect(typeof result.curve.computedAt).toBe("string");
  });

  it("applies an explicit placement instead of the baseline", async () => {
    const db = mockDb(curveChains({ placements: [{ id: "place_1", step_id: "step_1", start_day_index: 3, version: 1 }] }), []);
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.curve.days.slice(0, 2).map((d) => d.totalRequiredHours)).toEqual([0, 0]);
    expect(result.curve.days.slice(2, 4).map((d) => d.totalRequiredHours)).toEqual([10, 10]);
    expect(result.curve.steps[0].placement).toMatchObject({ id: "place_1", startDayIndex: 3, version: 1 });
  });

  it("reports a missing window as configuration, not an error", async () => {
    const db = mockDb(curveChains({ settings: null, fenceSettings: null }), []);
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.curve.windowConfigured).toBe(false);
    expect(result.curve.excludedSteps).toHaveLength(1);
    expect(result.curve.excludedSteps[0].reason).toBe("window_not_configured");
  });

  it("reports a missing settings table as notApplied instead of failing", async () => {
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: null, error: MISSING_TABLE }),
      chain({ data: [STEP_ROW], error: null }),
      chain({ data: null, error: MISSING_TABLE }),
      chain({ data: [], error: null }),
      chain({ data: null, error: MISSING_TABLE }),
    ], []);
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.curve.notApplied).toBe(true);
    expect(result.curve.windowConfigured).toBe(false);
  });

  it("retries once when the window version moves mid-read, then returns STALE_SNAPSHOT", async () => {
    const moved = { ...SETTINGS_ROW, version: 3 };
    const db = mockDb([
      ...curveChains({ fenceSettings: moved }),
      // Second attempt re-reads only settings, steps, placements,
      // assignments, fence — the package is proven once, before the loop.
      chain({ data: moved, error: null }),
      chain({ data: [STEP_ROW], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [ASSIGNMENT_ROW], error: null }),
      chain({ data: { ...SETTINGS_ROW, version: 4 }, error: null }),
    ], []);
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/changed while it was being read/);
  });

  it("succeeds on the retry when the window stops moving", async () => {
    const moved = { ...SETTINGS_ROW, version: 3 };
    const db = mockDb([
      ...curveChains({ fenceSettings: moved }),
      chain({ data: moved, error: null }),
      chain({ data: [STEP_ROW], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [ASSIGNMENT_ROW], error: null }),
      chain({ data: moved, error: null }),
    ], []);
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.curve.settings.version).toBe(3);
  });

  it("404s on an unknown package without reading further", async () => {
    const db = mockDb([chain({ data: null, error: null })], []);
    const result = await getManpowerCurve(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Work package not found." });
  });
});

describe("getCurveSettings", () => {
  it("returns settings with their versioned history", async () => {
    const revisionRow = {
      id: "srev_1", owner_id: OWNER, work_package_id: "pkg_1", version: 1,
      actor_id: "user_1", action: "create", old_values: null,
      new_values: { outage_start_date: "2026-11-09", outage_days: 10 }, reason: null, recorded_at: "t1",
    };
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: SETTINGS_ROW, error: null }),
      chain({ data: [revisionRow], error: null }),
    ], []);
    const result = await getCurveSettings(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.settings).toMatchObject({ outageStartDate: "2026-11-09", outageDays: 10, version: 2 });
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ action: "create", version: 1 });
  });

  it("returns null settings when no window is configured", async () => {
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: null, error: null }),
    ], []);
    const result = await getCurveSettings(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.settings).toBe(null);
    expect(result.revisions).toEqual([]);
  });
});

describe("setCurveSettings", () => {
  it("rejects invalid input before ever querying the database", async () => {
    const db = mockDb([], []);
    const result = await setCurveSettings(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { outageStartDate: "2026-11-09", outageDays: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls the settings RPC and returns the camelCased row", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: SETTINGS_ROW, error: null }],
    );
    const result = await setCurveSettings(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { outageStartDate: "2026-11-09", outageDays: 10, standardHoursPerPersonDay: 8, expectedVersion: 1, reason: "Outage moved" },
    });
    expect(result.ok).toBe(true);
    expect(result.settings).toMatchObject({ outageStartDate: "2026-11-09", outageDays: 10, version: 2 });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_manpower_curve_settings_set", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_outage_start_date: "2026-11-09",
      p_outage_days: 10,
      p_standard_hours_per_person_day: 8,
      p_expected_version: 1,
      p_reason: "Outage moved",
    });
  });
});

describe("setStepPlacement", () => {
  it("calls the placement RPC and returns the camelCased row", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: PLACEMENT_ROW, error: null }],
    );
    const result = await setStepPlacement(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { stepId: "step_1", startDayIndex: 3 },
    });
    expect(result.ok).toBe(true);
    expect(result.placement).toMatchObject({ id: "place_1", stepId: "step_1", startDayIndex: 3, version: 1 });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_manpower_curve_placement_set", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_step_id: "step_1",
      p_start_day_index: 3,
      p_expected_version: null,
      p_reason: null,
    });
  });

  it("maps a placement-outside-window failure to 409 with the affected step ids", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: null, error: { message: "WPP6_PLACEMENT_OUTSIDE_WINDOW:step_1,step_2" } }],
    );
    const result = await setStepPlacement(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { stepId: "step_1", startDayIndex: 9 },
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
    expect(result.placement).toMatchObject({ id: "place_1", startDayIndex: 3 });
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ action: "set", version: 1 });
    expect(result.hasMore).toBe(false);
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
    expect(mapManpowerCurveRpcError({ message: "WPP6_WINDOW_NOT_CONFIGURED" }))
      .toMatchObject({ ok: false, httpStatus: 400 });
    expect(mapManpowerCurveRpcError({ message: "WPP6_VERSION_CONFLICT" }))
      .toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapManpowerCurveRpcError({ message: "WPP6_PACKAGE_TERMINAL" }))
      .toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapManpowerCurveRpcError({ message: "WPP6_REASON_REQUIRED" }))
      .toMatchObject({ ok: false, httpStatus: 400 });
    expect(mapManpowerCurveRpcError({ message: "WPP6_INVALID_OUTAGE_DAYS" }))
      .toMatchObject({ ok: false, httpStatus: 400 });
    expect(mapManpowerCurveRpcError({ code: "PGRST202", message: "Could not find the function" }))
      .toMatchObject({ ok: false, httpStatus: 503 });
  });

  it("throws unknown failures for the route to turn into a 500", () => {
    expect(() => mapManpowerCurveRpcError({ message: "boom" })).toThrow("boom");
  });
});
