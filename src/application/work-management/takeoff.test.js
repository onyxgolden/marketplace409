import { describe, expect, it, vi } from "vitest";
import {
  createDrawing, listDrawingsForPackage, updateDrawing, deleteDrawing,
  createTakeoffLine, listTakeoffLinesForDrawing, updateTakeoffLine, deleteTakeoffLine,
  getPidTakeoffSummary,
} from "./takeoff.js";

// Supabase-shaped chain mock, same shape as workLinks.test.js: one chain
// per db.from() call, consumed in order.
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
  it("refuses to delete a P&ID that still has child drawings rolled up to it", async () => {
    const childrenChain = chain({ data: [{ id: "dwg_child" }], error: null });
    const db = mockDb([childrenChain]);
    const result = await deleteDrawing(db, { ownerId: OWNER, drawingId: "dwg_pid1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/rolled up/);
  });

  it("refuses to delete a drawing that still has takeoff lines", async () => {
    const childrenChain = chain({ data: [], error: null });
    const linesChain = chain({ data: [{ id: "line_1" }], error: null });
    const db = mockDb([childrenChain, linesChain]);
    const result = await deleteDrawing(db, { ownerId: OWNER, drawingId: "dwg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/takeoff lines/);
  });

  it("deletes cleanly when there are no children or lines", async () => {
    const childrenChain = chain({ data: [], error: null });
    const linesChain = chain({ data: [], error: null });
    const deleteChain = chain({ data: null, error: null });
    const db = mockDb([childrenChain, linesChain, deleteChain]);
    const result = await deleteDrawing(db, { ownerId: OWNER, drawingId: "dwg_1" });
    expect(result).toEqual({ ok: true });
  });
});

describe("updateDrawing", () => {
  const CURRENT_PID = {
    id: "dwg_pid1", owner_id: OWNER, package_id: "pkg_1", drawing_number: "P-101",
    drawing_type: "p_id", title: null, p_id_drawing_id: null,
    created_at: "t1", updated_at: "t1",
  };
  const CURRENT_CUT = {
    id: "dwg_cut1", owner_id: OWNER, package_id: "pkg_1", drawing_number: "CS-001",
    drawing_type: "cut_sheet", title: "Cut sheet", p_id_drawing_id: "dwg_pid1",
    created_at: "t1", updated_at: "t1",
  };

  it("updates only the supplied fields and re-validates the merged result", async () => {
    const currentChain = chain({ data: CURRENT_PID, error: null });
    const updateChain = chain({ data: { ...CURRENT_PID, drawing_number: "P-102", updated_at: "t2" }, error: null });
    const db = mockDb([currentChain, updateChain]);
    const result = await updateDrawing(db, { ownerId: OWNER, drawingId: "dwg_pid1", patch: { drawingNumber: "P-102" } });
    expect(result.ok).toBe(true);
    expect(result.drawing.drawingNumber).toBe("P-102");
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ drawing_number: "P-102" }));
  });

  it("rejects an update that would make the drawing invalid (e.g. blank number)", async () => {
    const currentChain = chain({ data: CURRENT_PID, error: null });
    const db = mockDb([currentChain]);
    const result = await updateDrawing(db, { ownerId: OWNER, drawingId: "dwg_pid1", patch: { drawingNumber: "  " } });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("refuses a no-op patch with no editable fields", async () => {
    const db = mockDb([]);
    const result = await updateDrawing(db, { ownerId: OWNER, drawingId: "dwg_pid1", patch: { drawingType: "cut_sheet" } });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("404s on a missing drawing", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await updateDrawing(db, { ownerId: OWNER, drawingId: "missing", patch: { title: "New title" } });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it("re-points a cut sheet to another P&ID after confirming the target is a p_id", async () => {
    const currentChain = chain({ data: CURRENT_CUT, error: null });
    const pidLookupChain = chain({ data: { id: "dwg_pid2", drawing_type: "p_id" }, error: null });
    const updateChain = chain({ data: { ...CURRENT_CUT, p_id_drawing_id: "dwg_pid2", updated_at: "t2" }, error: null });
    const db = mockDb([currentChain, pidLookupChain, updateChain]);
    const result = await updateDrawing(db, { ownerId: OWNER, drawingId: "dwg_cut1", patch: { pIdDrawingId: "dwg_pid2" } });
    expect(result.ok).toBe(true);
    expect(result.drawing.pIdDrawingId).toBe("dwg_pid2");
  });

  it("refuses to re-point a cut sheet to a drawing that is not a p_id", async () => {
    const currentChain = chain({ data: CURRENT_CUT, error: null });
    const pidLookupChain = chain({ data: { id: "dwg_other", drawing_type: "isometric" }, error: null });
    const db = mockDb([currentChain, pidLookupChain]);
    const result = await updateDrawing(db, { ownerId: OWNER, drawingId: "dwg_cut1", patch: { pIdDrawingId: "dwg_other" } });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(result.error).toMatch(/drawingType is p_id/);
  });

  it("refuses to set a rollup target on a p_id drawing", async () => {
    const currentChain = chain({ data: CURRENT_PID, error: null });
    const db = mockDb([currentChain]);
    const result = await updateDrawing(db, { ownerId: OWNER, drawingId: "dwg_pid1", patch: { pIdDrawingId: "dwg_pid2" } });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(result.error).toMatch(/must not be set on a p_id/);
  });

  it("maps a unique-violation into a clear 409, not a raw DB error", async () => {
    const currentChain = chain({ data: CURRENT_PID, error: null });
    const updateChain = chain({ data: null, error: { code: "23505", message: "duplicate key" } });
    const db = mockDb([currentChain, updateChain]);
    const result = await updateDrawing(db, { ownerId: OWNER, drawingId: "dwg_pid1", patch: { drawingNumber: "P-999" } });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/already exists/);
  });
});

describe("createTakeoffLine", () => {
  const input = {
    drawingId: "dwg_1", description: "6in CS pipe", quantity: 40, unit: "ft",
    category: "pipe", fabLocation: "shop",
  };

  it("auto-assigns the next lineNo when none is supplied", async () => {
    const drawingChain = chain({ data: { id: "dwg_1" }, error: null });
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
    const result = await createTakeoffLine(db, { ownerId: OWNER, actor: ACTOR, input });
    expect(result.ok).toBe(true);
    expect(result.line.lineNo).toBe(4);
    expect(result.line.quantity).toBe(40);
  });

  it("starts at lineNo 1 for a drawing with no existing lines", async () => {
    const drawingChain = chain({ data: { id: "dwg_1" }, error: null });
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
      ownerId: OWNER, actor: ACTOR,
      input: { drawingId: "dwg_1", description: "x", quantity: 1, unit: "ea", category: "other", fabLocation: "field" },
    });
    expect(result.line.lineNo).toBe(1);
  });

  it("404s on a missing drawing", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await createTakeoffLine(db, { ownerId: OWNER, actor: ACTOR, input });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it("rejects an invalid line (e.g. bad category) without inserting", async () => {
    const drawingChain = chain({ data: { id: "dwg_1" }, error: null });
    const maxLineChain = chain({ data: [], error: null });
    const db = mockDb([drawingChain, maxLineChain]);
    const result = await createTakeoffLine(db, { ownerId: OWNER, actor: ACTOR, input: { ...input, category: "bogus" } });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
  });
});

describe("listTakeoffLinesForDrawing", () => {
  it("returns every line on a drawing, camelCased, in line-number order", async () => {
    const rows = [{
      id: "line_1", owner_id: OWNER, drawing_id: "dwg_1", line_no: 1, description: "pipe",
      quantity: "10", unit: "ft", category: "pipe", fab_location: "shop",
      field_weld_count: 0, requires_field_fit: false, created_at: "t1", updated_at: "t1",
    }];
    const db = mockDb([chain({ data: rows, error: null })]);
    const result = await listTakeoffLinesForDrawing(db, { ownerId: OWNER, drawingId: "dwg_1" });
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ id: "line_1", lineNo: 1, quantity: 10 });
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
    const updateChain = chain({ data: { ...CURRENT, quantity: "55", updated_at: "t2" }, error: null });
    const db = mockDb([currentChain, updateChain]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, lineId: "line_1", patch: { quantity: 55 } });
    expect(result.ok).toBe(true);
    expect(result.line.quantity).toBe(55);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ quantity: 55 }));
  });

  it("rejects an update that would make the line invalid (e.g. negative quantity)", async () => {
    const currentChain = chain({ data: CURRENT, error: null });
    const db = mockDb([currentChain]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, lineId: "line_1", patch: { quantity: -5 } });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("refuses a no-op patch with no editable fields", async () => {
    const db = mockDb([]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, lineId: "line_1", patch: {} });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("404s on a missing line", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await updateTakeoffLine(db, { ownerId: OWNER, lineId: "missing", patch: { quantity: 1 } });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });
});

describe("deleteTakeoffLine", () => {
  it("deletes the line", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await deleteTakeoffLine(db, { ownerId: OWNER, lineId: "line_1" });
    expect(result).toEqual({ ok: true });
  });
});

describe("getPidTakeoffSummary", () => {
  it("404s on a missing drawing", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await getPidTakeoffSummary(db, { ownerId: OWNER, pIdDrawingId: "missing" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it("refuses to summarize a non-p_id drawing as if it were a P&ID", async () => {
    const db = mockDb([chain({ data: { id: "dwg_1", drawing_type: "isometric", package_id: "pkg_1" }, error: null })]);
    const result = await getPidTakeoffSummary(db, { ownerId: OWNER, pIdDrawingId: "dwg_1" });
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
    const result = await getPidTakeoffSummary(db, { ownerId: OWNER, pIdDrawingId: "dwg_pid1" });
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
  });

  it("a P&ID with no child drawings yet still summarizes its own lines", async () => {
    const pidChain = chain({ data: { id: "dwg_pid1", drawing_type: "p_id", package_id: "pkg_1" }, error: null });
    const childrenChain = chain({ data: [], error: null });
    const linesChain = chain({ data: [], error: null });
    const db = mockDb([pidChain, childrenChain, linesChain]);
    const result = await getPidTakeoffSummary(db, { ownerId: OWNER, pIdDrawingId: "dwg_pid1" });
    expect(result.ok).toBe(true);
    expect(result.summary.totals.lineCount).toBe(0);
  });
});
