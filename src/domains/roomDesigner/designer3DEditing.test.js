// designer3DEditing.test.js — P1-B: pick, drag and size entities from the 3D view.
//
// Every returned action is also applied through the real domain functions
// the reducer calls, so a passing test means the gesture actually edits the
// document, not just that it produced an object of the right shape. The
// reducer-level undo contract is covered in
// src/components/designer/designerReducer.3dEditing.test.js.

import { beforeEach, describe, expect, it } from "vitest";
import {
  addOpening,
  addWall,
  createEmptyDesign,
  moveFurniture,
  moveOpening,
  moveWall,
  moveWallEndpoint,
  placeFurniture,
  resetDesignerIds,
  resizeFurniture,
  resizeOpening,
} from "./designerDocument";
import { wallLength } from "./designerGeometry";
import {
  beginDrag3D,
  dragStep3D,
  isClickGesture,
  planPointFromWorld,
  popupAnchorForSelection,
  selectionFromPick,
  sizeEditAction,
  sizeFieldsForSelection,
} from "./designer3DEditing";

beforeEach(() => {
  resetDesignerIds();
});

/** 10' wall along +x with a 36" door at 24", plus a sofa at (60, 60). Grid 6". */
function fixture({ snapEnabled = true } = {}) {
  let design = createEmptyDesign("Plan");
  design = { ...design, settings: { ...design.settings, gridIn: 6, snapEnabled } };
  design = addWall(design, { x: 0, y: 0 }, { x: 120, y: 0 });
  const wallId = design.walls[0].id;
  design = addOpening(design, wallId, { type: "door", offsetIn: 24, widthIn: 36 });
  design = placeFurniture(design, "sofa-3seat", 60, 60);
  return {
    design,
    wallId,
    openingId: design.openings[0].id,
    furnitureId: design.furniture[0].id,
  };
}

/** Apply an action the way the reducer does, via the same domain functions. */
function apply(design, action) {
  switch (action.type) {
    case "MOVE_WALL": return moveWall(design, action.wallId, action.dx, action.dy);
    case "MOVE_WALL_ENDPOINT": return moveWallEndpoint(design, action.wallId, action.end, action.point);
    case "MOVE_FURNITURE": return moveFurniture(design, action.furnitureId, action.x, action.y);
    case "MOVE_OPENING": return moveOpening(design, action.openingId, action.offsetIn);
    case "RESIZE_OPENING": return resizeOpening(design, action.openingId, action.widthIn);
    case "RESIZE_FURNITURE": return resizeFurniture(design, action.furnitureId, action.widthIn, action.depthIn);
    default: throw new Error(`unhandled ${action.type}`);
  }
}

describe("selectionFromPick", () => {
  it("maps tagged walls, openings and furniture to selections", () => {
    expect(selectionFromPick({ entityKind: "wall", entityId: "w1" })).toEqual({ kind: "wall", id: "w1" });
    expect(selectionFromPick({ entityKind: "opening", entityId: "o1" })).toEqual({ kind: "opening", id: "o1" });
    expect(selectionFromPick({ entityKind: "furniture", entityId: "f1" })).toEqual({ kind: "furniture", id: "f1" });
  });

  it("returns null for untagged or non-editable meshes (floor, stairs)", () => {
    expect(selectionFromPick(undefined)).toBeNull();
    expect(selectionFromPick({})).toBeNull();
    expect(selectionFromPick({ entityKind: "stairs", entityId: "s1" })).toBeNull();
    expect(selectionFromPick({ entityKind: "wall" })).toBeNull();
  });
});

describe("gesture helpers", () => {
  it("maps world (x, z) to plan (x, y)", () => {
    expect(planPointFromWorld({ x: 10, y: 50, z: -4 })).toEqual({ x: 10, y: -4 });
  });

  it("treats small pointer travel as a click and larger travel as an orbit", () => {
    expect(isClickGesture({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(true);
    expect(isClickGesture({ x: 100, y: 100 }, { x: 140, y: 100 })).toBe(false);
    expect(isClickGesture(null, { x: 0, y: 0 })).toBe(false);
  });
});

describe("beginDrag3D", () => {
  it("returns null for nothing selected or a missing entity", () => {
    const { design } = fixture();
    expect(beginDrag3D(null, design, { x: 0, y: 0 })).toBeNull();
    expect(beginDrag3D({ kind: "wall", id: "nope" }, design, { x: 0, y: 0 })).toBeNull();
    expect(beginDrag3D({ kind: "room", id: "r" }, design, { x: 0, y: 0 })).toBeNull();
  });
});

describe("dragStep3D — wall", () => {
  it("moves the wall rigidly by whole grid steps, keeping it on the grid", () => {
    const { design, wallId } = fixture();
    let drag = beginDrag3D({ kind: "wall", id: wallId }, design, { x: 50, y: 1 });
    const step = dragStep3D(drag, design, { x: 62, y: 25 });
    expect(step.action).toMatchObject({ type: "MOVE_WALL", wallId, coalesce: `move-wall:${wallId}` });
    const moved = apply(design, step.action);
    const wall = moved.walls[0];
    // Grab (50, 1) snaps to (48, 0); pointer (62, 25) snaps to (60, 24):
    // the wall moves (12, 24) and `a` stays on the 6" grid.
    expect(wall.a).toEqual({ x: 12, y: 24 });
    expect(wallLength(wall)).toBe(120);
    drag = step.drag;
    // Sub-grid jitter doesn't dispatch anything.
    expect(dragStep3D(drag, moved, { x: 61, y: 25 }).action).toBeNull();
  });

  it("uses the same coalesce key on every step so one drag is one undo", () => {
    const { design, wallId } = fixture();
    let current = design;
    let drag = beginDrag3D({ kind: "wall", id: wallId }, design, { x: 0, y: 0 });
    const keys = [];
    for (const p of [{ x: 12, y: 0 }, { x: 24, y: 6 }, { x: 36, y: 12 }]) {
      const step = dragStep3D(drag, current, p);
      drag = step.drag;
      keys.push(step.action.coalesce);
      current = apply(current, step.action);
    }
    expect(current.walls[0].a).toEqual({ x: 36, y: 12 });
    expect(new Set(keys)).toEqual(new Set([`move-wall:${wallId}`]));
  });
});

describe("dragStep3D — furniture", () => {
  it("moves the piece with the grab offset, snapped to grid", () => {
    const { design, furnitureId } = fixture();
    const drag = beginDrag3D({ kind: "furniture", id: furnitureId }, design, { x: 70, y: 65 });
    const { action } = dragStep3D(drag, design, { x: 101, y: 90 });
    expect(action).toMatchObject({ type: "MOVE_FURNITURE", furnitureId, x: 90, y: 84 });
    const piece = apply(design, action).furniture[0];
    expect({ x: piece.x, y: piece.y }).toEqual({ x: 90, y: 84 });
  });

  it("skips snapping when the design has snap turned off", () => {
    const { design, furnitureId } = fixture({ snapEnabled: false });
    const drag = beginDrag3D({ kind: "furniture", id: furnitureId }, design, { x: 60, y: 60 });
    expect(dragStep3D(drag, design, { x: 71.5, y: 63.25 }).action).toMatchObject({ x: 71.5, y: 63.25 });
  });
});

describe("dragStep3D — opening", () => {
  it("slides the opening along its wall, ignoring pointer distance off the wall", () => {
    const { design, openingId } = fixture();
    const drag = beginDrag3D({ kind: "opening", id: openingId }, design, { x: 40, y: 0 });
    const { action } = dragStep3D(drag, design, { x: 70, y: 30 });
    expect(action).toMatchObject({ type: "MOVE_OPENING", openingId, offsetIn: 54 });
    expect(apply(design, action).openings[0].offsetIn).toBe(54);
  });
});

describe("sizeFieldsForSelection", () => {
  it("describes wall length, opening width and furniture width/depth", () => {
    const { design, wallId, openingId, furnitureId } = fixture();
    expect(sizeFieldsForSelection({ kind: "wall", id: wallId }, design)).toEqual({
      title: "Wall",
      fields: [{ key: "lengthIn", label: "Length", valueIn: 120 }],
    });
    expect(sizeFieldsForSelection({ kind: "opening", id: openingId }, design)).toEqual({
      title: "Door",
      fields: [{ key: "widthIn", label: "Width", valueIn: 36 }],
    });
    expect(sizeFieldsForSelection({ kind: "furniture", id: furnitureId }, design)).toEqual({
      title: "Sofa (3-seat)",
      fields: [
        { key: "widthIn", label: "Width", valueIn: 84 },
        { key: "depthIn", label: "Depth", valueIn: 36 },
      ],
    });
    expect(sizeFieldsForSelection({ kind: "room", id: "r" }, design)).toBeNull();
    expect(sizeFieldsForSelection(null, design)).toBeNull();
  });
});

describe("sizeEditAction", () => {
  it("sets wall length by moving endpoint b along the wall, accepting feet-inches", () => {
    const { design, wallId } = fixture();
    const { action } = sizeEditAction({ kind: "wall", id: wallId }, design, "lengthIn", `12'6"`);
    expect(action).toEqual({ type: "MOVE_WALL_ENDPOINT", wallId, end: "b", point: { x: 150, y: 0 } });
    const wall = apply(design, action).walls[0];
    expect(wall.a).toEqual({ x: 0, y: 0 });
    expect(wallLength(wall)).toBe(150);
  });

  it("refuses a wall length that would cut off its openings", () => {
    const { design, wallId } = fixture();
    const result = sizeEditAction({ kind: "wall", id: wallId }, design, "lengthIn", "40");
    expect(result.action).toBeUndefined();
    expect(result.error).toMatch(/at least 60"/);
  });

  it("resizes an opening", () => {
    const { design, openingId } = fixture();
    const { action } = sizeEditAction({ kind: "opening", id: openingId }, design, "widthIn", "32");
    expect(apply(design, action).openings[0].widthIn).toBe(32);
  });

  it("resizes one furniture axis and keeps the other", () => {
    const { design, furnitureId } = fixture();
    const { action } = sizeEditAction({ kind: "furniture", id: furnitureId }, design, "depthIn", "3'");
    expect(action).toMatchObject({ widthIn: 84, depthIn: 36 });
    const wider = sizeEditAction({ kind: "furniture", id: furnitureId }, design, "widthIn", "96").action;
    const piece = apply(design, wider).furniture[0];
    expect([piece.widthIn, piece.depthIn]).toEqual([96, 36]);
  });

  it("returns an error, never an action, for unparseable or out-of-range input", () => {
    const { design, furnitureId, wallId } = fixture();
    expect(sizeEditAction({ kind: "wall", id: wallId }, design, "lengthIn", "abc").error).toBeTruthy();
    expect(sizeEditAction({ kind: "wall", id: wallId }, design, "lengthIn", "0").error).toBeTruthy();
    expect(sizeEditAction({ kind: "furniture", id: furnitureId }, design, "widthIn", "600").error).toMatch(/between/);
    expect(sizeEditAction({ kind: "room", id: "r" }, design, "widthIn", "10").error).toBeTruthy();
  });
});

describe("popupAnchorForSelection", () => {
  it("pins above the wall midpoint, the opening center, and the furniture top", () => {
    const { design, wallId, openingId, furnitureId } = fixture();
    const h = design.settings.wallHeightIn ?? 108;
    expect(popupAnchorForSelection({ kind: "wall", id: wallId }, design)).toEqual({ x: 60, y: h + 6, z: 0 });
    expect(popupAnchorForSelection({ kind: "opening", id: openingId }, design)).toEqual({ x: 42, y: h + 6, z: 0 });
    expect(popupAnchorForSelection({ kind: "furniture", id: furnitureId }, design)).toEqual({ x: 60, y: 34 + 12, z: 60 });
    expect(popupAnchorForSelection({ kind: "wall", id: "gone" }, design)).toBeNull();
  });
});
