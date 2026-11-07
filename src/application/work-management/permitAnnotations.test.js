// Work Package Planner slice 3 — application tests. Supabase-shaped
// chain mock, same shape as progress.test.js, extended with an rpc()
// mock for the transactional write path (the service never writes
// annotations or revisions directly — every mutation goes through one
// RPC). Also covers the pre-migration window: a missing table reads
// as an empty list and a missing RPC reports 503, never a raw error.

import { describe, expect, it, vi } from "vitest";
import {
  createPermitAnnotation,
  updatePermitAnnotation,
  retirePermitAnnotation,
  listPermitAnnotations,
  getPermitAnnotationHistory,
  mapPermitAnnotationRpcError,
} from "./permitAnnotations.js";

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
    limit: vi.fn(() => node), is: vi.fn(() => node), range: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const OWNER = "owner_1";
const ANNOTATION_ROW = {
  id: "forge_wppa_1", owner_id: OWNER, work_package_id: "pkg_1",
  target_kind: "package", drawing_id: null, original_drawing_id: null,
  label: "City permit portal", url: "https://example.com/permits/9",
  permit_reference: "PERMIT-42", note: null, version: 1,
  retired_at: null, retired_by: null,
  created_by: "user_1", updated_by: "user_1", created_at: "t1", updated_at: "t1",
};
const DRAWING_ROW = { id: "dwg_1", package_id: "pkg_1", drawing_type: "p_id", p_id_drawing_id: null };

describe("createPermitAnnotation", () => {
  const input = { targetKind: "package", label: "City permit portal", url: "https://example.com/permits/9" };

  it("rejects invalid input before ever querying the database", async () => {
    const db = mockDb([], []);
    const result = await createPermitAnnotation(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { targetKind: "package", label: "Portal", url: "http://example.com/x" },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("404s on a drawing from another package without calling the RPC", async () => {
    const otherPkgDrawing = { ...DRAWING_ROW, package_id: "pkg_2" };
    const db = mockDb([chain({ data: otherPkgDrawing, error: null })], []);
    const result = await createPermitAnnotation(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { ...input, targetKind: "drawing", drawingId: "dwg_1" },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls the create RPC with normalized values and returns the camelCased row", async () => {
    const db = mockDb([], [{ data: ANNOTATION_ROW, error: null }]);
    const result = await createPermitAnnotation(db, {
      ownerId: OWNER, packageId: "pkg_1",
      input: { ...input, label: "  City permit portal  ", url: "https://EXAMPLE.com/permits/9", permitReference: "PERMIT-42" },
    });
    expect(result.ok).toBe(true);
    expect(result.annotation).toMatchObject({
      id: "forge_wppa_1", workPackageId: "pkg_1", targetKind: "package",
      label: "City permit portal", url: "https://example.com/permits/9", permitReference: "PERMIT-42",
    });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_permit_annotation_create", {
      p_owner_id: OWNER,
      p_package_id: "pkg_1",
      p_target_kind: "package",
      p_drawing_id: null,
      p_label: "City permit portal",
      p_url: "https://example.com/permits/9",
      p_permit_reference: "PERMIT-42",
      p_note: null,
    });
    // No actor is ever passed to the RPC: it derives the actor from
    // auth.uid() inside the database (slice 2's P1 lesson).
    const args = db.rpc.mock.calls[0][1];
    expect(Object.keys(args)).not.toContain("p_actor");
    expect(Object.keys(args)).not.toContain("actor");
  });

  it("maps a missing RPC (migration not yet applied) to 503, not a raw error", async () => {
    const db = mockDb([], [{ data: null, error: { code: "PGRST202", message: "Could not find the function public.forge_work_permit_annotation_create" } }]);
    const result = await createPermitAnnotation(db, { ownerId: OWNER, packageId: "pkg_1", input });
    expect(result).toMatchObject({ ok: false, httpStatus: 503 });
    expect(result.error).toMatch(/hasn't been applied/);
  });
});

describe("updatePermitAnnotation", () => {
  it("404s on an annotation from another package without calling the RPC", async () => {
    const otherPkgRow = { ...ANNOTATION_ROW, work_package_id: "pkg_2" };
    const db = mockDb([chain({ data: otherPkgRow, error: null })], []);
    const result = await updatePermitAnnotation(db, {
      ownerId: OWNER, packageId: "pkg_1", annotationId: "forge_wppa_1",
      patch: { expectedVersion: 1, label: "Renamed" },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps a version conflict to 409", async () => {
    const db = mockDb(
      [chain({ data: ANNOTATION_ROW, error: null })],
      [{ data: null, error: { message: "WPP3_VERSION_CONFLICT" } }],
    );
    const result = await updatePermitAnnotation(db, {
      ownerId: OWNER, packageId: "pkg_1", annotationId: "forge_wppa_1",
      patch: { expectedVersion: 1, label: "Renamed" },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/changed by someone else/);
  });

  it("passes only the supplied fields (null = clear, absent = keep) to the RPC", async () => {
    const updated = { ...ANNOTATION_ROW, version: 2, label: "Renamed", note: null };
    const db = mockDb(
      [chain({ data: ANNOTATION_ROW, error: null })],
      [{ data: updated, error: null }],
    );
    const result = await updatePermitAnnotation(db, {
      ownerId: OWNER, packageId: "pkg_1", annotationId: "forge_wppa_1",
      patch: { expectedVersion: 1, label: "Renamed", note: null },
    });
    expect(result.ok).toBe(true);
    expect(result.annotation.version).toBe(2);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_permit_annotation_update", {
      p_owner_id: OWNER,
      p_annotation_id: "forge_wppa_1",
      p_expected_version: 1,
      p_label: "Renamed",
      p_url: null,
      p_permit_reference: null,
      p_note: null,
      p_reason: null,
      // note was explicitly cleared (null) so its flag is set;
      // permitReference was absent so its flag stays false (preserve).
      p_set_reference: false,
      p_set_note: true,
    });
  });

  it("sets the reference flag when the reference is cleared and leaves both flags false when neither is supplied", async () => {
    const updated = { ...ANNOTATION_ROW, version: 2, permit_reference: null };
    const db = mockDb(
      [chain({ data: ANNOTATION_ROW, error: null })],
      [{ data: updated, error: null }],
    );
    const cleared = await updatePermitAnnotation(db, {
      ownerId: OWNER, packageId: "pkg_1", annotationId: "forge_wppa_1",
      patch: { expectedVersion: 1, label: "Renamed", permitReference: "" },
    });
    expect(cleared.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_permit_annotation_update", expect.objectContaining({
      p_permit_reference: null,
      p_note: null,
      p_set_reference: true,
      p_set_note: false,
    }));

    const db2 = mockDb(
      [chain({ data: ANNOTATION_ROW, error: null })],
      [{ data: { ...ANNOTATION_ROW, version: 2, label: "Renamed" }, error: null }],
    );
    const kept = await updatePermitAnnotation(db2, {
      ownerId: OWNER, packageId: "pkg_1", annotationId: "forge_wppa_1",
      patch: { expectedVersion: 1, label: "Renamed" },
    });
    expect(kept.ok).toBe(true);
    expect(db2.rpc).toHaveBeenCalledWith("forge_work_permit_annotation_update", expect.objectContaining({
      p_set_reference: false,
      p_set_note: false,
    }));
  });
});

describe("retirePermitAnnotation", () => {
  it("retires through the RPC with the caller's expected version and reason", async () => {
    const retired = { ...ANNOTATION_ROW, version: 2, retired_at: "t2", retired_by: "user_1" };
    const db = mockDb(
      [chain({ data: ANNOTATION_ROW, error: null })],
      [{ data: retired, error: null }],
    );
    const result = await retirePermitAnnotation(db, {
      ownerId: OWNER, packageId: "pkg_1", annotationId: "forge_wppa_1",
      input: { expectedVersion: 1, reason: "Superseded" },
    });
    expect(result.ok).toBe(true);
    expect(result.annotation.retiredAt).toBe("t2");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_permit_annotation_retire", {
      p_owner_id: OWNER,
      p_annotation_id: "forge_wppa_1",
      p_expected_version: 1,
      p_reason: "Superseded",
    });
  });

  it("maps an already-retired annotation to 409", async () => {
    const db = mockDb(
      [chain({ data: ANNOTATION_ROW, error: null })],
      [{ data: null, error: { message: "WPP3_RETIRED" } }],
    );
    const result = await retirePermitAnnotation(db, {
      ownerId: OWNER, packageId: "pkg_1", annotationId: "forge_wppa_1",
      input: { expectedVersion: 1 },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/Retired permit links cannot be changed/);
  });
});

describe("listPermitAnnotations", () => {
  it("returns annotations newest first, camelCased", async () => {
    const db = mockDb([chain({ data: [ANNOTATION_ROW], error: null })], []);
    const result = await listPermitAnnotations(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]).toMatchObject({ id: "forge_wppa_1", label: "City permit portal" });
  });

  it("rejects out-of-range paging before querying", async () => {
    const db = mockDb([], []);
    expect((await listPermitAnnotations(db, { ownerId: OWNER, packageId: "pkg_1", limit: 0 })).httpStatus).toBe(400);
    expect((await listPermitAnnotations(db, { ownerId: OWNER, packageId: "pkg_1", limit: 201 })).httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("treats a missing table (migration not yet applied) as an empty list", async () => {
    const db = mockDb([chain({ data: null, error: { code: "42P01", message: "relation \"public.forge_work_permit_annotations\" does not exist" } })], []);
    const result = await listPermitAnnotations(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result).toEqual({ ok: true, annotations: [] });
  });

  it("404s when the drawing filter names a drawing from another package", async () => {
    const otherPkgDrawing = { ...DRAWING_ROW, package_id: "pkg_2" };
    const db = mockDb([chain({ data: otherPkgDrawing, error: null })], []);
    const result = await listPermitAnnotations(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });
});

describe("getPermitAnnotationHistory", () => {
  it("returns revisions oldest first", async () => {
    const revisionRow = {
      id: "forge_wppr_1", annotation_id: "forge_wppa_1", version: 1, actor_id: "user_1",
      action: "create", old_values: null, new_values: { label: "City permit portal" },
      reason: null, recorded_at: "t1",
    };
    const db = mockDb([
      chain({ data: ANNOTATION_ROW, error: null }),
      chain({ data: [revisionRow], error: null }),
    ], []);
    const result = await getPermitAnnotationHistory(db, { ownerId: OWNER, packageId: "pkg_1", annotationId: "forge_wppa_1" });
    expect(result.ok).toBe(true);
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ action: "create", version: 1, actorId: "user_1" });
  });

  it("404s when the annotation lives in another package", async () => {
    const otherPkgRow = { ...ANNOTATION_ROW, work_package_id: "pkg_2" };
    const db = mockDb([chain({ data: otherPkgRow, error: null })], []);
    const result = await getPermitAnnotationHistory(db, { ownerId: OWNER, packageId: "pkg_1", annotationId: "forge_wppa_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });
});

describe("mapPermitAnnotationRpcError", () => {
  it.each([
    ["WPP3_WORKSPACE_FORBIDDEN", 404],
    ["WPP3_PACKAGE_NOT_FOUND", 404],
    ["WPP3_ANNOTATION_NOT_FOUND", 404],
    ["WPP3_DRAWING_NOT_FOUND", 404],
    ["WPP3_DRAWING_HAS_CHILDREN", 409],
    ["WPP3_DRAWING_HAS_LINES", 409],
    ["WPP3_VERSION_CONFLICT", 409],
    ["WPP3_RETIRED", 409],
    ["WPP3_INVALID_TARGET", 400],
    ["WPP3_INVALID_LABEL", 400],
    ["WPP3_INVALID_URL", 400],
    ["WPP3_REFERENCE_TOO_LONG", 400],
    ["WPP3_NOTE_TOO_LONG", 400],
    ["WPP3_REASON_TOO_LONG", 400],
  ])("maps %s to HTTP %s", (code, status) => {
    expect(mapPermitAnnotationRpcError({ message: code }).httpStatus).toBe(status);
  });

  it("throws on an unknown RPC failure (route turns it into a 500)", () => {
    expect(() => mapPermitAnnotationRpcError({ message: "boom" })).toThrow("boom");
  });
});
