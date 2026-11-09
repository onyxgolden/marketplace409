import { describe, expect, it, vi } from "vitest";
import {
  createDrawing, listDrawingsForPackage, deleteDrawing,
  createTakeoffLine, listTakeoffLinesForDrawing, updateTakeoffLine, deleteTakeoffLine,
  getPidTakeoffSummary,
} from "./takeoff.js";

// Supabase-shaped chain mock, same shape as workLinks.test.js: one chain
// per db.from() call, consumed in order; plus an rpc() queue for the
// slice-3 delete-drawing RPC (deleteDrawing calls the RPC first and
// falls back to the legacy direct delete only when the RPC does not
// exist yet).
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
    limit: vi.fn(() => node), in: vi.fn(() => node),
    insert: vi.fn(() => node), update: vi.fn(() => node), delete: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const OWNER = "owner_1";
const ACTOR = "user_1";

describe("createDrawing", () => {
  const input = { packageId: "pkg_1", drawingNumber: "P-101", drawingType: "p_id" };

  it("creates a p_id drawing after confirming the package exists", async () => {
    const pkgChain = chain({ data: { id: "pkg_1" }, error: null });
    const insertChain = chain({
      data: {
        id: "forge_wdwg_1", owner_id: OWNER, package_id: "pkg_1", drawing_number: "P-101",
        drawing_type: "p_id", title: null, p_id_drawing_id: null,
        created_by: ACTOR, created_at: "2026-11-04T00:00:00Z", updated_at: "2026-11-04T00:00:00Z",
      },
      error: null,
    });
    const db = mockDb([pkgChain, insertChain]);
    const result = await createDrawing(db, { ownerId: OWNER, actor: ACTOR, input });
    expect(result.ok).toBe(true);
    expect(result.drawing.drawingType).toBe("p_id");
    expect(result.drawing.pIdDrawingId).toBeNull();
  });

  it("404s on a missing package without inserting anything", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await createDrawing(db, { ownerId: OWNER, actor: ACTOR, input });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid input before ever querying the database", async () => {
    const db = mockDb([]);
    const result = await createDrawing(db, { ownerId: OWNER, actor: ACTOR, input: { drawingType: "p_id" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("an isometric must name an existing p_id drawing, not just any drawing", async () => {
    const isoInput = { packageId: "pkg_1", drawingNumber: "ISO-001", drawingType: "isometric", pIdDrawingId: "dwg_cutsheet" };
    const pkgChain = chain({ data: { id: "pkg_1" }, error: null });
    const pidLookupChain = chain({ data: { id: "dwg_cutsheet", drawing_type: "cut_sheet" }, error: null });
    const db = mockDb([pkgChain, pidLookupChain]);
    const result = await createDrawing(db, { ownerId: OWNER, actor: ACTOR, input: isoInput });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(result.error).toMatch(/drawingType is p_id/);
  });

  it("WPP1-002: a child in package A cannot roll up to a P&ID in package B", async () => {
    const isoInput = { packageId: "pkg_1", drawingNumber: "ISO-001", drawingType: "isometric", pIdDrawingId: "dwg_other_pkg_pid" };
    const pkgChain = chain({ data: { id: "pkg_1" }, error: null });
    // Package-scoped lookup finds nothing: the P&ID lives in pkg_2, not pkg_1.
    const pidLookupChain = chain({ data: null, error: null });
    const db = mockDb([pkgChain, pidLookupChain]);
    const result = await createDrawing(db, { ownerId: OWNER, actor: ACTOR, input: isoInput });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(result.error).toMatch(/in this package/);
    expect(pidLookupChain.eq).toHaveBeenCalledWith("package_id", "pkg_1");
    expect(db.from).toHaveBeenCalledTimes(2);
  });

  it("maps a unique-violation into a clear 409, not a raw DB error", async () => {
    const pkgChain = chain({ data: { id: "pkg_1" }, error: null });
    const insertChain = chain({ data: null, error: { code: "23505", message: "duplicate key" } });
    const db = mockDb([pkgChain, insertChain]);
    const result = await createDrawing(db, { ownerId: OWNER, actor: ACTOR, input });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/already exists/);
  });
});

describe("listDrawingsForPackage", () => {
  it("returns every drawing for a package, camelCased", async () => {
    const rows = [{
      id: "dwg_1", owner_id: OWNER, package_id: "pkg_1", drawing_number: "P-101",
      drawing_type: "p_id", title: null, p_id_drawing_id: null,
      created_by: ACTOR, created_at: "t1", updated_at: "t1",
    }];
    const db = mockDb([chain({ data: rows, error: null })]);
    const result = await listDrawingsForPackage(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.drawings).toHaveLength(1);
    expect(result.drawings[0]).toMatchObject({ id: "dwg_1", drawingNumber: "P-101", drawingType: "p_id" });
  });
});

describe("deleteDrawing", () => {
  const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_1" }, error: null });

  it("deletes through the RPC (which retires attached annotations atomically) without touching tables directly", async () => {
    // Slice 7: after the RPC returns true the service re-reads the
    // drawing row to tell a physical delete from a logical retire
    // (a drawing with review history survives with retired_at set).
    // Row gone here, so this is a physical delete.
    const rereadChain = chain({ data: null, error: null });
    const db = mockDb([rereadChain], [{ data: true, error: null }]);
    const result = await deleteDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toEqual({ ok: true, retired: false });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_permit_annotation_delete_drawing", {
      p_owner_id: OWNER, p_package_id: "pkg_1", p_drawing_id: "dwg_1",
    });
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("forge_work_drawings");
  });

  it("reports retired when the RPC retires the drawing instead of deleting it (slice 7)", async () => {
    const rereadChain = chain({ data: { id: "dwg_1", retired_at: "t2" }, error: null });
    const db = mockDb([rereadChain], [{ data: true, error: null }]);
    const result = await deleteDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toEqual({ ok: true, retired: true });
  });

  it("maps the RPC's children guard to 409", async () => {
    const db = mockDb([], [{ data: null, error: { message: "WPP3_DRAWING_HAS_CHILDREN" } }]);
    const result = await deleteDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_pid1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/rolled up/);
  });

  it("maps the RPC's lines guard to 409", async () => {
    const db = mockDb([], [{ data: null, error: { message: "WPP3_DRAWING_HAS_LINES" } }]);
    const result = await deleteDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/takeoff lines/);
  });

  it("WPP1-003: 404s when the RPC says the drawing lives in another package than the URL names", async () => {
    const db = mockDb([], [{ data: null, error: { message: "WPP3_DRAWING_NOT_FOUND" } }]);
    const result = await deleteDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(result.error).toMatch(/in this package/);
  });

  it("falls back to the legacy direct delete when the RPC does not exist yet (pre-migration window)", async () => {
    const childrenChain = chain({ data: [], error: null });
    const linesChain = chain({ data: [], error: null });
    const deleteChain = chain({ data: null, error: null });
    const db = mockDb(
      [drawingChain, childrenChain, linesChain, deleteChain],
      [{ data: null, error: { code: "PGRST202", message: "Could not find the function public.forge_work_permit_annotation_delete_drawing" } }],
    );
    const result = await deleteDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toEqual({ ok: true });
    expect(db.from).toHaveBeenCalledTimes(4);
  });

  it("legacy fallback still refuses a P&ID that has child drawings rolled up to it", async () => {
    const childrenChain = chain({ data: [{ id: "dwg_child" }], error: null });
    const db = mockDb(
      [drawingChain, childrenChain],
      [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }],
    );
    const result = await deleteDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_pid1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/rolled up/);
  });

  it("legacy fallback still 404s when the drawing lives in another package", async () => {
    const otherPkgChain = chain({ data: { id: "dwg_1", package_id: "pkg_2" }, error: null });
    const db = mockDb(
      [otherPkgChain],
      [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }],
    );
    const result = await deleteDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(result.error).toMatch(/in this package/);
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});

describe("createTakeoffLine", () => {
  const input = {
    drawingId: "dwg_1", description: "6in CS pipe", quantity: 40, unit: "ft",
    category: "pipe", fabLocation: "shop",
  };

  it("auto-assigns the next lineNo when none is supplied", async () => {
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_1" }, error: null });
    const maxLineChain = chain({ data: [{ line_no: 3 }], error: null });
    const insertChain = chain({
      data: {
        id: "forge_wtol_1", owner_id: OWNER, drawing_id: "dwg_1", line_no: 4,
        description: "6in CS pipe", material_spec: null, size_label: null,
        quantity: "40", unit: "ft", category: "pipe", fab_location: "shop",
        field_weld_count: 0, requires_field_fit: false, notes: null,
        created_by: ACTOR, created_at: "t1", updated_at: "t1",
      },
      error: null,
    });
    const db = mockDb([drawingChain, maxLineChain, insertChain]);
    const result = await createTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", actor: ACTOR, input });
    expect(result.ok).toBe(true);
    expect(result.line.lineNo).toBe(4);
    expect(result.line.quantity).toBe(40);
  });

  it("slice 2: stamps the proven package on the new line (package_id is NOT NULL after the slice-2 migration)", async () => {
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_1" }, error: null });
    const maxLineChain = chain({ data: [], error: null });
    const insertChain = chain({
      data: {
        id: "forge_wtol_1", owner_id: OWNER, drawing_id: "dwg_1", line_no: 1,
        description: "6in CS pipe", quantity: "40", unit: "ft", category: "pipe", fab_location: "shop",
        created_at: "t1", updated_at: "t1",
      },
      error: null,
    });
    const db = mockDb([drawingChain, maxLineChain, insertChain]);
    const result = await createTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", actor: ACTOR, input });
    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({ package_id: "pkg_1" }));
  });

  it("starts at lineNo 1 for a drawing with no existing lines", async () => {
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_1" }, error: null });
    const maxLineChain = chain({ data: [], error: null });
    const insertChain = chain({
      data: {
        id: "forge_wtol_1", owner_id: OWNER, drawing_id: "dwg_1", line_no: 1,
        description: "x", quantity: "1", unit: "ea", category: "other", fab_location: "field",
        field_weld_count: 0, requires_field_fit: false, created_at: "t1", updated_at: "t1",
      },
      error: null,
    });
    const db = mockDb([drawingChain, maxLineChain, insertChain]);
    const result = await createTakeoffLine(db, {
      ownerId: OWNER, packageId: "pkg_1", actor: ACTOR,
      input: { drawingId: "dwg_1", description: "x", quantity: 1, unit: "ea", category: "other", fabLocation: "field" },
    });
    expect(result.line.lineNo).toBe(1);
  });

  it("404s on a missing drawing", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await createTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", actor: ACTOR, input });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it("WPP1-003: 404s when the drawing lives in another package than the URL names, without inserting", async () => {
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_2" }, error: null });
    const db = mockDb([drawingChain]);
    const result = await createTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", actor: ACTOR, input });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(result.error).toMatch(/in this package/);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid line (e.g. bad category) without inserting", async () => {
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_1" }, error: null });
    const maxLineChain = chain({ data: [], error: null });
    const db = mockDb([drawingChain, maxLineChain]);
    const result = await createTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", actor: ACTOR, input: { ...input, category: "bogus" } });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
  });
});

describe("listTakeoffLinesForDrawing", () => {
  it("returns every line on a drawing, camelCased, in line-number order", async () => {
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_1" }, error: null });
    const rows = [{
      id: "line_1", owner_id: OWNER, drawing_id: "dwg_1", line_no: 1, description: "pipe",
      quantity: "10", unit: "ft", category: "pipe", fab_location: "shop",
      field_weld_count: 0, requires_field_fit: false, created_at: "t1", updated_at: "t1",
    }];
    const db = mockDb([drawingChain, chain({ data: rows, error: null })]);
    const result = await listTakeoffLinesForDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ id: "line_1", lineNo: 1, quantity: 10 });
  });

  it("WPP1-003: 404s when the drawing lives in another package than the URL names", async () => {
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_2" }, error: null });
    const db = mockDb([drawingChain]);
    const result = await listTakeoffLinesForDrawing(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});

describe("updateTakeoffLine", () => {
  const CURRENT = {
    id: "line_1", owner_id: OWNER, drawing_id: "dwg_1", line_no: 1,
    description: "6in CS pipe", material_spec: null, size_label: null,
    quantity: "40", unit: "ft", category: "pipe", fab_location: "shop",
    field_weld_count: 0, requires_field_fit: false, notes: null,
    created_at: "t1", updated_at: "t1",
  };

  it("updates only the supplied fields and re-validates the merged result", async () => {
    const currentChain = chain({ data: CURRENT, error: null });
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_1" }, error: null });
    const updateChain = chain({ data: { ...CURRENT, quantity: "55", updated_at: "t2" }, error: null });
    const db = mockDb([currentChain, drawingChain, updateChain]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1", patch: { quantity: 55 } });
    expect(result.ok).toBe(true);
    expect(result.line.quantity).toBe(55);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ quantity: 55 }));
  });

  it("rejects an update that would make the line invalid (e.g. negative quantity)", async () => {
    const currentChain = chain({ data: CURRENT, error: null });
    const db = mockDb([currentChain]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1", patch: { quantity: -5 } });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("refuses a no-op patch with no editable fields", async () => {
    const db = mockDb([]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1", patch: {} });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("404s on a missing line", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "missing", patch: { quantity: 1 } });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it("WPP1-003: 404s when the line sits on a different drawing than the URL names, without updating", async () => {
    const currentChain = chain({ data: { ...CURRENT, drawing_id: "dwg_9" }, error: null });
    const db = mockDb([currentChain]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1", patch: { quantity: 55 } });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(result.error).toMatch(/in this drawing/);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("WPP1-003: 404s when the line's drawing lives in another package than the URL names, without updating", async () => {
    const currentChain = chain({ data: CURRENT, error: null });
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_2" }, error: null });
    const db = mockDb([currentChain, drawingChain]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1", patch: { quantity: 55 } });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(result.error).toMatch(/in this package/);
    expect(db.from).toHaveBeenCalledTimes(2);
  });
});

describe("deleteTakeoffLine", () => {
  it("deletes the line", async () => {
    const lineChain = chain({ data: { id: "line_1", drawing_id: "dwg_1" }, error: null });
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_1" }, error: null });
    const deleteChain = chain({ data: null, error: null });
    const db = mockDb([lineChain, drawingChain, deleteChain]);
    const result = await deleteTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1" });
    expect(result).toEqual({ ok: true });
  });

  it("WPP1-003: 404s when the line sits on a different drawing than the URL names, without deleting", async () => {
    const lineChain = chain({ data: { id: "line_1", drawing_id: "dwg_9" }, error: null });
    const db = mockDb([lineChain]);
    const result = await deleteTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("WPP1-003: 404s when the line's drawing lives in another package than the URL names, without deleting", async () => {
    const lineChain = chain({ data: { id: "line_1", drawing_id: "dwg_1" }, error: null });
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_2" }, error: null });
    const db = mockDb([lineChain, drawingChain]);
    const result = await deleteTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.from).toHaveBeenCalledTimes(2);
  });

  it("slice 2: a line with progress history is RESTRICT-blocked into a 409, not a raw FK error", async () => {
    const lineChain = chain({ data: { id: "line_1", drawing_id: "dwg_1" }, error: null });
    const drawingChain = chain({ data: { id: "dwg_1", package_id: "pkg_1" }, error: null });
    const deleteChain = chain({ data: null, error: { code: "23503", message: "violates foreign key" } });
    const db = mockDb([lineChain, drawingChain, deleteChain]);
    const result = await deleteTakeoffLine(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/progress records/);
  });
});

describe("getPidTakeoffSummary", () => {
  it("404s on a missing drawing", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await getPidTakeoffSummary(db, { ownerId: OWNER, packageId: "pkg_1", pIdDrawingId: "missing" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it("WPP1-003: 404s when the P&ID lives in another package than the URL names", async () => {
    const db = mockDb([chain({ data: { id: "dwg_pid1", drawing_type: "p_id", package_id: "pkg_2" }, error: null })]);
    const result = await getPidTakeoffSummary(db, { ownerId: OWNER, packageId: "pkg_1", pIdDrawingId: "dwg_pid1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(result.error).toMatch(/in this package/);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("refuses to summarize a non-p_id drawing as if it were a P&ID", async () => {
    const db = mockDb([chain({ data: { id: "dwg_1", drawing_type: "isometric", package_id: "pkg_1" }, error: null })]);
    const result = await getPidTakeoffSummary(db, { ownerId: OWNER, packageId: "pkg_1", pIdDrawingId: "dwg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("combines the P&ID's own lines with every child drawing's lines into one summary", async () => {
    const pidChain = chain({ data: { id: "dwg_pid1", drawing_type: "p_id", package_id: "pkg_1" }, error: null });
    const childrenChain = chain({ data: [{ id: "dwg_iso1" }], error: null });
    const linesChain = chain({
      data: [
        {
          id: "line_1", owner_id: OWNER, drawing_id: "dwg_pid1", line_no: 1, description: "pipe A",
          quantity: "40", unit: "ft", category: "pipe", fab_location: "shop",
          field_weld_count: 1, requires_field_fit: false, created_at: "t1", updated_at: "t1",
        },
        {
          id: "line_2", owner_id: OWNER, drawing_id: "dwg_iso1", line_no: 1, description: "random piece",
          quantity: "10", unit: "ft", category: "pipe", fab_location: "field",
          field_weld_count: 0, requires_field_fit: true, created_at: "t1", updated_at: "t1",
        },
      ],
      error: null,
    });
    const db = mockDb([pidChain, childrenChain, linesChain]);
    const result = await getPidTakeoffSummary(db, { ownerId: OWNER, packageId: "pkg_1", pIdDrawingId: "dwg_pid1" });
    expect(result.ok).toBe(true);
    expect(result.summary.packageId).toBe("pkg_1");
    expect(result.summary.totals.lineCount).toBe(2);
    expect(result.summary.totals.totalQuantityByUnit.ft).toBe(50);
    expect(result.summary.shopFieldSplit.shop.totalQuantityByUnit.ft).toBe(40);
    expect(result.summary.shopFieldSplit.field.totalQuantityByUnit.ft).toBe(10);
    expect(result.summary.fwFfw.suggestedFieldWelds).toBe(1);
    expect(result.summary.fwFfw.suggestedFfwCount).toBe(1);
    // Confirms the children query was correctly scoped to this P&ID.
    expect(childrenChain.eq).toHaveBeenCalledWith("p_id_drawing_id", "dwg_pid1");
    expect(childrenChain.eq).toHaveBeenCalledWith("package_id", "pkg_1");
  });

  it("a P&ID with no child drawings yet still summarizes its own lines", async () => {
    const pidChain = chain({ data: { id: "dwg_pid1", drawing_type: "p_id", package_id: "pkg_1" }, error: null });
    const childrenChain = chain({ data: [], error: null });
    const linesChain = chain({ data: [], error: null });
    const db = mockDb([pidChain, childrenChain, linesChain]);
    const result = await getPidTakeoffSummary(db, { ownerId: OWNER, packageId: "pkg_1", pIdDrawingId: "dwg_pid1" });
    expect(result.ok).toBe(true);
    expect(result.summary.totals.lineCount).toBe(0);
  });
});
