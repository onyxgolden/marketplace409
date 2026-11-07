// Work Package Planner slice 5 — application tests. Supabase-shaped
// chain mock, same shape as craftAssignments.test.js, extended with
// an rpc() mock for the transactional write path (the service never
// writes steps, revisions, links, or order rows directly — every
// mutation goes through one RPC). Also covers the pre-migration
// window: a missing table reads as an empty list and a missing RPC
// reports 503, never a raw error.

import { describe, expect, it, vi } from "vitest";
import {
  createWorkStep,
  updateWorkStep,
  reorderWorkSteps,
  retireWorkStep,
  listWorkSteps,
  listWorkStepRevisions,
  createStepDrawingLink,
  retireStepDrawingLink,
  listStepDrawings,
  listStepDrawingLinkRevisions,
  mapWorkStepRpcError,
} from "./workSteps.js";

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
    in: vi.fn(() => node),
    range: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const OWNER = "owner_1";
const PKG_ROW = { id: "pkg_1", status: "in_progress" };
const STEP_ROW = {
  id: "forge_wps_1", owner_id: OWNER, work_package_id: "pkg_1",
  title: "Fabricate pipe spool", description: null, sequence_no: 1,
  craft_key: "pipefitter", craft_label: "Pipefitter",
  planned_duration_days: 3, planned_person_hours: "24.50",
  source_note: null, supersedes_step_id: null, version: 1,
  retired_at: null, retired_by: null,
  created_by: "user_1", updated_by: "user_1", created_at: "t1", updated_at: "t1",
};
const REVISION_ROW = {
  id: "forge_wpsr_1", step_id: "forge_wps_1", version: 1,
  actor_id: "user_1", action: "create",
  old_values: null, new_values: { title: "Fabricate pipe spool", sequence_no: 1 }, reason: null, recorded_at: "t1",
};
const LINK_ROW = {
  id: "forge_wpsl_1", owner_id: OWNER, work_package_id: "pkg_1",
  step_id: "forge_wps_1", drawing_id: "dwg_1", original_drawing_id: "dwg_1",
  refinement_note: "Per P&ID rev C", version: 1,
  retired_at: null, retired_by: null, created_by: "user_1", created_at: "t1",
};
const DRAWING_ROW = { id: "dwg_1", drawing_number: "P-101", drawing_type: "p_id", title: "Main line" };

const INPUT = { title: "Fabricate pipe spool" };

describe("createWorkStep", () => {
  it("rejects invalid input before ever querying the database", async () => {
    const db = mockDb([], []);
    const result = await createWorkStep(db, {
      ownerId: OWNER, packageId: "pkg_1", input: { title: "" },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("404s on an unknown package without calling the RPC", async () => {
    const db = mockDb([chain({ data: null, error: null })], []);
    const result = await createWorkStep(db, { ownerId: OWNER, packageId: "pkg_1", input: INPUT });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls the create RPC and returns the camelCased row", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: STEP_ROW, error: null }],
    );
    const result = await createWorkStep(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { ...INPUT, craftLabel: "Pipefitter", plannedDurationDays: 3, plannedPersonHours: 24.5, insertAt: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.step).toMatchObject({
      id: "forge_wps_1", workPackageId: "pkg_1", title: "Fabricate pipe spool",
      sequenceNo: 1, craftKey: "pipefitter", craftLabel: "Pipefitter",
      plannedDurationDays: 3, plannedPersonHours: 24.5, version: 1,
    });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_step_create", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_title: "Fabricate pipe spool",
      p_description: null,
      p_craft_label: "Pipefitter",
      p_planned_duration_days: 3,
      p_planned_person_hours: 24.5,
      p_source_note: null,
      p_supersedes_step_id: null,
      p_insert_at: 1,
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
      [{ data: null, error: { code: "PGRST202", message: "Could not find the function public.forge_work_step_create" } }],
    );
    const result = await createWorkStep(db, { ownerId: OWNER, packageId: "pkg_1", input: INPUT });
    expect(result).toMatchObject({ ok: false, httpStatus: 503 });
    expect(result.error).toMatch(/hasn't been applied/);
  });
});

describe("updateWorkStep", () => {
  it("rejects an invalid patch before querying", async () => {
    const db = mockDb([], []);
    const result = await updateWorkStep(db, {
      ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1",
      patch: { title: "x" },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("404s on a step from another package without calling the RPC", async () => {
    const db = mockDb([chain({ data: { ...STEP_ROW, work_package_id: "pkg_other" }, error: null })], []);
    const result = await updateWorkStep(db, {
      ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1",
      patch: { expectedVersion: 1, title: "New title" },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Work step not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("sends explicit-null clears through set flags and keeps untouched fields absent", async () => {
    const db = mockDb(
      [chain({ data: STEP_ROW, error: null })],
      [{ data: { ...STEP_ROW, description: null, version: 2 }, error: null }],
    );
    const result = await updateWorkStep(db, {
      ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1",
      patch: { expectedVersion: 1, description: null, plannedDurationDays: 5 },
    });
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_step_update", expect.objectContaining({
      p_expected_version: 1,
      p_title: null,
      p_description: null,
      p_set_description: true,
      p_set_craft_label: false,
      p_set_duration_days: true,
      p_planned_duration_days: 5,
      p_set_person_hours: false,
      p_set_source_note: false,
    }));
  });

  it("503s when the steps table is missing (pre-migration window)", async () => {
    const db = mockDb(
      [chain({ data: null, error: { code: "42P01", message: 'relation "forge_work_steps" does not exist' } })],
      [],
    );
    const result = await updateWorkStep(db, {
      ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1",
      patch: { expectedVersion: 1, title: "New title" },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 503 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("reorderWorkSteps", () => {
  it("rejects an invalid permutation before querying", async () => {
    const db = mockDb([], []);
    const result = await reorderWorkSteps(db, {
      ownerId: OWNER, packageId: "pkg_1", stepIds: ["a", "a"], expectedGeneration: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("calls the reorder RPC and returns the reordered steps plus the new generation", async () => {
    const db = mockDb(
      [
        chain({ data: PKG_ROW, error: null }),
        chain({ data: { generation: 2 }, error: null }),
      ],
      [{ data: [STEP_ROW, { ...STEP_ROW, id: "forge_wps_2", sequence_no: 2 }], error: null }],
    );
    const result = await reorderWorkSteps(db, {
      ownerId: OWNER, packageId: "pkg_1",
      stepIds: ["forge_wps_2", "forge_wps_1"], expectedGeneration: 1, reason: "Field order",
    });
    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.generation).toBe(2);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_step_reorder", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_step_ids: ["forge_wps_2", "forge_wps_1"],
      p_expected_generation: 1,
      p_reason: "Field order",
    });
  });
});

describe("retireWorkStep", () => {
  it("calls the retire RPC with version and reason", async () => {
    const db = mockDb(
      [chain({ data: STEP_ROW, error: null })],
      [{ data: { ...STEP_ROW, retired_at: "t2", version: 2 }, error: null }],
    );
    const result = await retireWorkStep(db, {
      ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1",
      expectedVersion: 1, reason: "Superseded by field change",
    });
    expect(result.ok).toBe(true);
    expect(result.step.retiredAt).toBe("t2");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_step_retire", {
      p_owner_id: OWNER,
      p_step_id: "forge_wps_1",
      p_expected_version: 1,
      p_reason: "Superseded by field change",
      p_historical_correction: false,
    });
  });
});

describe("listWorkSteps", () => {
  it("rejects bad paging before querying", async () => {
    const db = mockDb([], []);
    const result = await listWorkSteps(db, { ownerId: OWNER, packageId: "pkg_1", limit: 0 });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("reads a missing table as an empty list with generation 0", async () => {
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: null, error: { code: "42P01", message: 'relation "forge_work_steps" does not exist' } }),
    ]);
    const result = await listWorkSteps(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result).toMatchObject({ ok: true, steps: [], generation: 0, packageStatus: "in_progress" });
  });

  it("returns steps plus the current generation", async () => {
    const db = mockDb([
      chain({ data: PKG_ROW, error: null }),
      chain({ data: [STEP_ROW], error: null }),
      chain({ data: { generation: 3 }, error: null }),
    ]);
    const result = await listWorkSteps(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ sequenceNo: 1, plannedPersonHours: 24.5 });
    expect(result.generation).toBe(3);
  });
});

describe("listWorkStepRevisions", () => {
  it("reads a missing table as an empty history", async () => {
    const db = mockDb([
      chain({ data: null, error: { code: "42P01", message: 'relation "forge_work_steps" does not exist' } }),
    ]);
    const result = await listWorkStepRevisions(db, { ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1" });
    expect(result).toMatchObject({ ok: true, step: null, revisions: [] });
  });

  it("returns the step plus its revisions oldest first", async () => {
    const db = mockDb([
      chain({ data: STEP_ROW, error: null }),
      chain({ data: [REVISION_ROW], error: null }),
    ]);
    const result = await listWorkStepRevisions(db, { ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1" });
    expect(result.ok).toBe(true);
    expect(result.step.id).toBe("forge_wps_1");
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ action: "create", version: 1 });
  });
});

describe("createStepDrawingLink / retireStepDrawingLink", () => {
  it("calls the link-create RPC", async () => {
    const db = mockDb(
      [chain({ data: STEP_ROW, error: null })],
      [{ data: LINK_ROW, error: null }],
    );
    const result = await createStepDrawingLink(db, {
      ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1",
      input: { drawingId: "dwg_1", refinementNote: "Per P&ID rev C" },
    });
    expect(result.ok).toBe(true);
    expect(result.link).toMatchObject({ stepId: "forge_wps_1", drawingId: "dwg_1", originalDrawingId: "dwg_1" });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_step_link_drawing_create", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_step_id: "forge_wps_1",
      p_drawing_id: "dwg_1",
      p_refinement_note: "Per P&ID rev C",
      p_reason: null,
    });
  });

  it("404s when the link belongs to another step", async () => {
    const db = mockDb([chain({ data: { ...LINK_ROW, step_id: "forge_wps_other" }, error: null })], []);
    const result = await retireStepDrawingLink(db, {
      ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1", linkId: "forge_wpsl_1",
      expectedVersion: 1, reason: "Wrong drawing",
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Drawing link not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("listStepDrawings", () => {
  it("merges the linked drawing's display info into each link", async () => {
    const db = mockDb([
      chain({ data: STEP_ROW, error: null }),
      chain({ data: [LINK_ROW], error: null }),
      chain({ data: [DRAWING_ROW], error: null }),
    ]);
    const result = await listStepDrawings(db, { ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1" });
    expect(result.ok).toBe(true);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].drawing).toMatchObject({ id: "dwg_1", drawingNumber: "P-101", drawingType: "p_id" });
  });

  it("reports drawing null when the parent drawing is gone", async () => {
    const deletedLink = { ...LINK_ROW, drawing_id: null };
    const db = mockDb([
      chain({ data: STEP_ROW, error: null }),
      chain({ data: [deletedLink], error: null }),
    ]);
    const result = await listStepDrawings(db, { ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1" });
    expect(result.ok).toBe(true);
    expect(result.links[0].drawing).toBe(null);
    expect(result.links[0].originalDrawingId).toBe("dwg_1");
    // No drawing lookup happens when no link has a live drawing id.
    expect(db.from).toHaveBeenCalledTimes(2);
  });
});

describe("listStepDrawingLinkRevisions", () => {
  it("returns the link plus its revisions", async () => {
    const linkRevision = {
      id: "forge_wplr_1", link_id: "forge_wpsl_1", version: 1,
      actor_id: "user_1", action: "create", old_values: null,
      new_values: { drawing_id: "dwg_1" }, reason: null, recorded_at: "t1",
    };
    const db = mockDb([
      chain({ data: LINK_ROW, error: null }),
      chain({ data: [linkRevision], error: null }),
    ]);
    const result = await listStepDrawingLinkRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", stepId: "forge_wps_1", linkId: "forge_wpsl_1",
    });
    expect(result.ok).toBe(true);
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ action: "create" });
  });
});

describe("mapWorkStepRpcError", () => {
  it("maps the slice-5 codes to plain-English statuses", () => {
    expect(mapWorkStepRpcError(new Error("WPP5_PACKAGE_TERMINAL"))).toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapWorkStepRpcError(new Error("WPP5_VERSION_CONFLICT"))).toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapWorkStepRpcError(new Error("WPP5_INVALID_ORDER"))).toMatchObject({ ok: false, httpStatus: 400 });
    expect(mapWorkStepRpcError(new Error("WPP5_INVALID_SUPERSEDES"))).toMatchObject({ ok: false, httpStatus: 400 });
    expect(mapWorkStepRpcError(new Error("WPP5_DUPLICATE"))).toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapWorkStepRpcError(new Error("WPP5_STEP_NOT_FOUND"))).toMatchObject({ ok: false, httpStatus: 404 });
    expect(mapWorkStepRpcError(new Error("WPP5_RETIRED"))).toMatchObject({ ok: false, httpStatus: 409 });
  });

  it("throws unknown errors instead of mapping them", () => {
    expect(() => mapWorkStepRpcError(new Error("boom"))).toThrow("boom");
  });
});
