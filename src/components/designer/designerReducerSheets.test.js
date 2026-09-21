// Regression: sheet edits drive dirty tracking, save/reload normalization,
// and undo/redo through the designer reducer.

import { createInitialState, designerReducer } from "./designerReducer";
import { addWall, createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

const reduce = (state, action) => designerReducer(state, action);
const fresh = () => createInitialState(createEmptyDesign());

describe("sheet actions in the reducer", () => {
  it("ADD_SHEET marks dirty, bumps the revision, and selects the new sheet", () => {
    const s1 = reduce(fresh(), { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    expect(s1.design.sheets).toHaveLength(1);
    expect(s1.dirty).toBe(true);
    expect(s1.designRevision).toBe(1);
    expect(s1.selection).toEqual({ kind: "sheet", id: s1.design.sheets[0].id });
  });

  it("MOVE_SHEET / UPDATE_SHEET_FORMAT / DELETE_SHEET all touch dirty + revision", () => {
    let s = reduce(fresh(), { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    const id = s.design.sheets[0].id;
    s = reduce(s, { type: "MARK_SAVED", savedRevision: s.designRevision });
    expect(s.dirty).toBe(false);
    // Grid snap is on by default: off-grid drop points re-seat on the grid.
    s = reduce(s, { type: "MOVE_SHEET", sheetId: id, x: 10, y: 20, coalesce: "move-sheet" });
    expect(s.dirty).toBe(true);
    expect(s.design.sheets[0].x).toBe(12);
    expect(s.design.sheets[0].y).toBe(18);
    s = reduce(s, { type: "UPDATE_SHEET_FORMAT", sheetId: id, orientation: "landscape" });
    expect(s.design.sheets[0].orientation).toBe("landscape");
    s = reduce(s, { type: "DELETE_SHEET", sheetId: id });
    expect(s.design.sheets).toHaveLength(0);
    expect(s.selection).toBeNull();
  });

  it("MOVE_SHEET keeps raw coordinates when snap is disabled", () => {
    let s = reduce(fresh(), { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    const id = s.design.sheets[0].id;
    s = reduce(s, {
      type: "UPDATE_SETTINGS",
      settings: { ...s.design.settings, snapEnabled: false },
    });
    s = reduce(s, { type: "MOVE_SHEET", sheetId: id, x: 10, y: 20, coalesce: "move-sheet" });
    expect(s.design.sheets[0].x).toBe(10);
    expect(s.design.sheets[0].y).toBe(20);
  });

  it("DELETE_SELECTION deletes a selected sheet and clears the selection", () => {
    let s = reduce(fresh(), { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    s = reduce(s, { type: "DELETE_SELECTION" });
    expect(s.design.sheets).toHaveLength(0);
    expect(s.selection).toBeNull();
  });

  it("ignores MOVE/DELETE/UPDATE for unknown sheet ids", () => {
    const s0 = fresh();
    expect(reduce(s0, { type: "MOVE_SHEET", sheetId: "sheet-1", x: 1, y: 1 })).toBe(s0);
    expect(reduce(s0, { type: "DELETE_SHEET", sheetId: "sheet-1" })).toBe(s0);
    expect(reduce(s0, { type: "UPDATE_SHEET_FORMAT", sheetId: "sheet-1" })).toBe(s0);
  });
});

describe("save/reload normalization", () => {
  it("old documents missing sheets load with sheets: []", () => {
    const legacy = { ...createEmptyDesign() };
    delete legacy.sheets;
    const s = reduce(fresh(), { type: "LOAD_DESIGN", design: legacy });
    expect(s.design.sheets).toEqual([]);
  });

  it("LOAD_DESIGN resets the undo/redo stacks", () => {
    let s = reduce(fresh(), { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: "LOAD_DESIGN", design: createEmptyDesign() });
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
    expect(s.design.sheets).toEqual([]);
  });

  it("MARK_SAVED only clears dirty when the revision is still current", () => {
    let s = reduce(fresh(), { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    const stale = reduce(s, { type: "MARK_SAVED", savedRevision: s.designRevision - 1 });
    expect(stale.dirty).toBe(true);
    const clean = reduce(s, { type: "MARK_SAVED", savedRevision: s.designRevision });
    expect(clean.dirty).toBe(false);
  });
});

describe("undo/redo", () => {
  it("undoes and redoes sheet add/move/delete", () => {
    let s = fresh();
    s = reduce(s, { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    const id = s.design.sheets[0].id;
    s = reduce(s, { type: "MOVE_SHEET", sheetId: id, x: 10, y: 20, coalesce: "move-sheet:x" });
    // Undo the move.
    s = reduce(s, { type: "UNDO" });
    expect(s.design.sheets[0].x).not.toBe(10);
    // Undo the add.
    s = reduce(s, { type: "UNDO" });
    expect(s.design.sheets).toHaveLength(0);
    // Redo the add, then the move.
    s = reduce(s, { type: "REDO" });
    expect(s.design.sheets).toHaveLength(1);
    s = reduce(s, { type: "REDO" });
    // Grid snap is on: the move re-seats on the 6″ grid (10 -> 12).
    expect(s.design.sheets[0].x).toBe(12);
    // Undo once more, then delete instead: redo stack must clear.
    s = reduce(s, { type: "UNDO" });
    s = reduce(s, { type: "DELETE_SHEET", sheetId: id });
    expect(s.design.sheets).toHaveLength(0);
    const afterRedo = reduce(s, { type: "REDO" });
    expect(afterRedo.design.sheets).toHaveLength(0);
  });

  it("is a no-op with empty stacks", () => {
    const s0 = fresh();
    expect(reduce(s0, { type: "UNDO" })).toBe(s0);
    expect(reduce(s0, { type: "REDO" })).toBe(s0);
  });

  it("marks the document dirty and clears the selection", () => {
    let s = reduce(fresh(), { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    s = reduce(s, { type: "MARK_SAVED", savedRevision: s.designRevision });
    s = reduce(s, { type: "UNDO" });
    expect(s.dirty).toBe(true);
    expect(s.selection).toBeNull();
  });

  it("undoes wall edits too (general history, not sheet-only)", () => {
    let s = fresh();
    const before = s.design.walls.length;
    s = reduce(s, { type: "ADD_WALL", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    expect(s.design.walls).toHaveLength(before + 1);
    s = reduce(s, { type: "UNDO" });
    expect(s.design.walls).toHaveLength(before);
    s = reduce(s, { type: "REDO" });
    expect(s.design.walls).toHaveLength(before + 1);
  });
});

describe("drag coalescing", () => {
  it("collapses a whole sheet drag into one undo step", () => {
    let s = reduce(fresh(), { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    const id = s.design.sheets[0].id;
    const pastAfterAdd = s.past.length;
    const key = `move-sheet:${id}`;
    for (let i = 1; i <= 5; i += 1) {
      s = reduce(s, { type: "MOVE_SHEET", sheetId: id, x: i * 10, y: i * 10, coalesce: key });
    }
    // Grid snap is on: the final drop (50, 50) re-seats to (48, 48).
    expect(s.design.sheets[0].x).toBe(48);
    // Five dispatches, one stack entry for the drag.
    expect(s.past.length).toBe(pastAfterAdd + 1);
    s = reduce(s, { type: "UNDO" });
    expect(s.design.sheets[0].x).not.toBe(50);
    expect(s.past.length).toBe(pastAfterAdd);
  });

  it("a new gesture (different key) starts a new undo step", () => {
    let s = reduce(fresh(), { type: "ADD_SHEET", sizeId: "letter", orientation: "portrait" });
    const id = s.design.sheets[0].id;
    s = reduce(s, { type: "MOVE_SHEET", sheetId: id, x: 10, y: 10, coalesce: "move-sheet:1" });
    const afterFirst = s.past.length;
    s = reduce(s, { type: "MOVE_SHEET", sheetId: id, x: 20, y: 20, coalesce: "move-sheet:2" });
    expect(s.past.length).toBe(afterFirst + 1);
  });

  it("wall-endpoint drags also coalesce without changing their geometry", () => {
    let s = reduce(createInitialState(addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 10, y: 0 })), {
      type: "NOOP",
    });
    const wallId = s.design.walls[0].id;
    const past0 = s.past.length;
    for (let i = 1; i <= 3; i += 1) {
      s = reduce(s, {
        type: "MOVE_WALL_ENDPOINT",
        wallId,
        end: "b",
        point: { x: 10 + i, y: 0 },
        coalesce: `move-wall-endpoint:${wallId}:b`,
      });
    }
    expect(s.design.walls[0].b.x).toBe(13);
    expect(s.past.length).toBe(past0 + 1);
    s = reduce(s, { type: "UNDO" });
    expect(s.design.walls[0].b.x).toBe(10);
  });
});
