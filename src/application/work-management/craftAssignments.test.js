// Work Package Planner slice 4 — application tests. Supabase-shaped
// chain mock, same shape as progress.test.js and
// permitAnnotations.test.js, extended with an rpc() mock for the
// transactional write path (the service never writes assignments or
// revisions directly — every mutation goes through one RPC). Also
// covers the pre-migration window: a missing table reads as an empty
// list and a missing RPC reports 503, never a raw error.

import { describe, expect, it, vi } from "vitest";
import {
  createCraftAssignment,
  updateCraftAssignment,
  retireCraftAssignment,
  listCraftAssignments,
  listCraftAssignmentRevisions,
  mapCraftAssignmentRpcError,
} from "./craftAssignments.js";

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
    range: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const OWNER = "owner_1";
const PKG_ROW = { id: "pkg_1", status: "in_progress" };
const ASSIGNMENT_ROW = {
  id: "forge_wpca_1", owner_id: OWNER, work_package_id: "pkg_1",
  work_date: "2026-11-09", craft_key: "pipefitter", craft_label: "Pipefitter",
  crew_key: "", crew_label: null, shift_kind: "day", shift_label: null, shift_key: "day",
  crew_size: 6, hours_per_person: "8.00", note: null, version: 1,
  retired_at: null, retired_by: null,
  created_by: "user_1", updated_by: "user_1", created_at: "t1", updated_at: "t1",
};
const REVISION_ROW = {
  id: "forge_wpcr_1", assignment_id: "forge_wpca_1", version: 1,
  actor_id: "user_1", action: "create", historical_correction: false,
  old_values: null, new_values: { craft_key: "pipefitter" }, reason: null, recorded_at: "t1",
};

const INPUT = {
  workDate: "2026-11-09",
  craft: "Pipefitter",
  shiftKind: "day",
  crewSize: 6,
  hoursPerPerson: 8,
};

describe("createCraftAssignment", () => {
  it("rejects invalid input before ever querying the database", async () => {
    const db = mockDb([], []);
    const result = await createCraftAssignment(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { ...INPUT, crewSize: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("404s on an unknown package without calling the RPC", async () => {
    const db = mockDb([chain({ data: null, error: null })], []);
    const result = await createCraftAssignment(db, { ownerId: OWNER, packageId: "pkg_1", input: INPUT });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls the create RPC and returns the camelCased row with derived person-hours", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: ASSIGNMENT_ROW, error: null }],
    );
    const result = await createCraftAssignment(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { ...INPUT, crewLabel: "Crew A", note: "Tie-ins" },
    });
    expect(result.ok).toBe(true);
    expect(result.assignment).toMatchObject({
      id: "forge_wpca_1", workPackageId: "pkg_1", workDate: "2026-11-09",
      craftKey: "pipefitter", craftLabel: "Pipefitter", crewKey: "",
      shiftKind: "day", shiftKey: "day", crewSize: 6, hoursPerPerson: 8,
      plannedPersonHours: 48, version: 1,
    });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_craft_assignment_create", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_work_date: "2026-11-09",
      p_craft_label: "Pipefitter",
      p_crew_label: "Crew A",
      p_shift_kind: "day",
      p_shift_label: null,
      p_crew_size: 6,
      p_hours_per_person: 8,
      p_note: "Tie-ins",
      p_historical_correction: false,
      p_reason: null,
    });
    // No actor is ever passed to the RPC: it derives the actor from
    // auth.uid() inside the database (slice 2's P1 lesson).
    const args = db.rpc.mock.calls[0][1];
    expect(Object.keys(args)).not.toContain("p_actor");
    expect(Object.keys(args)).not.toContain("actor");
  });

  it("maps a missing RPC (migration not yet applied) to 503, not a raw error", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: null, error: { code: "PGRST202", message: "Could not find the function public.forge_work_craft_assignment_create" } }],
    );
    const result = await createCraftAssignment(db, { ownerId: OWNER, packageId: "pkg_1", input: INPUT });
    expect(result).toMatchObject({ ok: false, httpStatus: 503 });
    expect(result.error).toMatch(/hasn't been applied/);
  });

  it("maps a duplicate active identity to 409", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: null, error: { message: "WPP4_DUPLICATE" } }],
    );
    const result = await createCraftAssignment(db, { ownerId: OWNER, packageId: "pkg_1", input: INPUT });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });

  it("maps a terminal package to 409", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: null, error: { message: "WPP4_PACKAGE_TERMINAL" } }],
    );
    const result = await createCraftAssignment(db, { ownerId: OWNER, packageId: "pkg_1", input: INPUT });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });
});

describe("updateCraftAssignment", () => {
  it("404s on an assignment from another package without calling the RPC", async () => {
    const otherPkgRow = { ...ASSIGNMENT_ROW, work_package_id: "pkg_2" };
    const db = mockDb([chain({ data: otherPkgRow, error: null })], []);
    const result = await updateCraftAssignment(db, {
      ownerId: OWNER, packageId: "pkg_1", assignmentId: "forge_wpca_1",
      patch: { expectedVersion: 1, crewSize: 4 },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("passes presence flags so an explicit null clears and an omitted field preserves", async () => {
    const updated = { ...ASSIGNMENT_ROW, version: 2, note: null, crew_size: 4 };
    const db = mockDb(
      [chain({ data: ASSIGNMENT_ROW, error: null })],
      [{ data: updated, error: null }],
    );
    const result = await updateCraftAssignment(db, {
      ownerId: OWNER, packageId: "pkg_1", assignmentId: "forge_wpca_1",
      patch: { expectedVersion: 1, crewSize: 4, note: null },
    });
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_craft_assignment_update", expect.objectContaining({
      p_expected_version: 1,
      p_crew_size: 4,
      p_note: null,
      p_set_note: true,
      p_set_crew_label: false,
      p_set_shift_label: false,
      p_work_date: null,
      p_craft_label: null,
    }));
  });

  it("maps a version conflict to 409 with a refresh message", async () => {
    const db = mockDb(
      [chain({ data: ASSIGNMENT_ROW, error: null })],
      [{ data: null, error: { message: "WPP4_VERSION_CONFLICT" } }],
    );
    const result = await updateCraftAssignment(db, {
      ownerId: OWNER, packageId: "pkg_1", assignmentId: "forge_wpca_1",
      patch: { expectedVersion: 1, crewSize: 4 },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/changed by someone else/);
  });

  it("maps a retired assignment to 409", async () => {
    const db = mockDb(
      [chain({ data: ASSIGNMENT_ROW, error: null })],
      [{ data: null, error: { message: "WPP4_RETIRED" } }],
    );
    const result = await updateCraftAssignment(db, {
      ownerId: OWNER, packageId: "pkg_1", assignmentId: "forge_wpca_1",
      patch: { expectedVersion: 1, crewSize: 4 },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });

  it("reports 503 when the table is missing (pre-migration window)", async () => {
    const db = mockDb([chain({ data: null, error: { code: "42P01", message: "relation forge_work_craft_assignments does not exist" } })], []);
    const result = await updateCraftAssignment(db, {
      ownerId: OWNER, packageId: "pkg_1", assignmentId: "forge_wpca_1",
      patch: { expectedVersion: 1, crewSize: 4 },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 503 });
  });
});

describe("retireCraftAssignment", () => {
  it("requires a reason before any database call", async () => {
    const db = mockDb([], []);
    const result = await retireCraftAssignment(db, {
      ownerId: OWNER, packageId: "pkg_1", assignmentId: "forge_wpca_1",
      expectedVersion: 1, reason: "",
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("calls the retire RPC with the version, reason and correction flag", async () => {
    const retired = { ...ASSIGNMENT_ROW, version: 2, retired_at: "t2", retired_by: "user_1" };
    const db = mockDb(
      [chain({ data: ASSIGNMENT_ROW, error: null })],
      [{ data: retired, error: null }],
    );
    const result = await retireCraftAssignment(db, {
      ownerId: OWNER, packageId: "pkg_1", assignmentId: "forge_wpca_1",
      expectedVersion: 1, reason: "Crew stood down", historicalCorrection: false,
    });
    expect(result.ok).toBe(true);
    expect(result.assignment.retiredAt).toBe("t2");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_craft_assignment_retire", {
      p_owner_id: OWNER,
      p_assignment_id: "forge_wpca_1",
      p_expected_version: 1,
      p_reason: "Crew stood down",
      p_historical_correction: false,
    });
  });
});

describe("listCraftAssignments", () => {
  it("returns assignments with derived person-hours, day totals and package status", async () => {
    const night = {
      ...ASSIGNMENT_ROW, id: "forge_wpca_2", shift_kind: "night", shift_key: "night",
      crew_size: 2, hours_per_person: "10.00",
    };
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: [ASSIGNMENT_ROW, night], error: null }),
    ]);
    const result = await listCraftAssignments(db, {
      ownerId: OWNER, packageId: "pkg_1", from: "2026-11-09", to: "2026-11-09",
    });
    expect(result.ok).toBe(true);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[0].plannedPersonHours).toBe(48);
    expect(result.assignments[1].plannedPersonHours).toBe(20);
    expect(result.dayTotals).toEqual([
      { workDate: "2026-11-09", plannedPersonHours: 68, assignmentCount: 2 },
    ]);
    expect(result.packageStatus).toBe("in_progress");
    expect(result.from).toBe("2026-11-09");
    expect(result.to).toBe("2026-11-09");
  });

  it("normalizes a craft filter to its key before querying", async () => {
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: [ASSIGNMENT_ROW], error: null }),
    ]);
    const result = await listCraftAssignments(db, {
      ownerId: OWNER, packageId: "pkg_1", craft: "Pipe Fitter",
      from: "2026-11-09", to: "2026-11-09",
    });
    expect(result.ok).toBe(true);
    const listChain = db.from.mock.results[1].value;
    expect(listChain.eq).toHaveBeenCalledWith("craft_key", "pipe-fitter");
  });

  it("reads a missing table as an empty list in the pre-migration window", async () => {
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: null, error: { code: "42P01", message: "relation forge_work_craft_assignments does not exist" } }),
    ]);
    const result = await listCraftAssignments(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result).toMatchObject({ ok: true, assignments: [], dayTotals: [], packageStatus: "in_progress" });
  });

  it("rejects an inverted or over-wide window", async () => {
    const db = mockDb([], []);
    const inverted = await listCraftAssignments(db, {
      ownerId: OWNER, packageId: "pkg_1", from: "2026-11-10", to: "2026-11-09",
    });
    expect(inverted).toMatchObject({ ok: false, httpStatus: 400 });
    const wide = await listCraftAssignments(db, {
      ownerId: OWNER, packageId: "pkg_1", from: "2026-01-01", to: "2027-01-03",
    });
    expect(wide).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("listCraftAssignmentRevisions", () => {
  it("returns the assignment with its history, oldest first", async () => {
    const db = mockDb([
      chain({ data: ASSIGNMENT_ROW, error: null }),
      chain({ data: [REVISION_ROW], error: null }),
    ]);
    const result = await listCraftAssignmentRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", assignmentId: "forge_wpca_1",
    });
    expect(result.ok).toBe(true);
    expect(result.assignment.id).toBe("forge_wpca_1");
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ action: "create", historicalCorrection: false });
  });

  it("404s on an assignment from another package", async () => {
    const db = mockDb([chain({ data: { ...ASSIGNMENT_ROW, work_package_id: "pkg_2" }, error: null })], []);
    const result = await listCraftAssignmentRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", assignmentId: "forge_wpca_1",
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });
});

describe("mapCraftAssignmentRpcError", () => {
  it("maps known codes and rethrows unknown failures", () => {
    expect(mapCraftAssignmentRpcError({ message: "WPP4_HISTORICAL_CORRECTION_REQUIRED" }))
      .toMatchObject({ httpStatus: 400 });
    expect(mapCraftAssignmentRpcError({ message: "WPP4_INVALID_HOURS" }))
      .toMatchObject({ httpStatus: 400 });
    expect(mapCraftAssignmentRpcError({ message: "WPP4_INVALID_CRAFT" }))
      .toMatchObject({ httpStatus: 400 });
    expect(mapCraftAssignmentRpcError({ message: "WPP4_INVALID_SHIFT" }))
      .toMatchObject({ httpStatus: 400 });
    expect(() => mapCraftAssignmentRpcError({ message: "boom" })).toThrow("boom");
  });
});
