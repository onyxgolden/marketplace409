// designerReducer.3dEditing.test.js — P1-B: a whole 3D drag is one undo step.
//
// dragStep3D emits the same coalesce keys the 2D canvas uses; this asserts
// the reducer actually folds them into a single history entry.

import { beforeEach, describe, expect, it } from "vitest";
import { addWall, createEmptyDesign, resetDesignerIds } from "@/domains/roomDesigner/designerDocument";
import { beginDrag3D, dragStep3D, sizeEditAction } from "@/domains/roomDesigner/designer3DEditing";
import { createInitialState, designerReducer } from "./designerReducer";

beforeEach(() => {
  resetDesignerIds();
});

function wallState() {
  let design = createEmptyDesign("Plan");
  design = { ...design, settings: { ...design.settings, gridIn: 6 } };
  design = addWall(design, { x: 0, y: 0 }, { x: 120, y: 0 });
  return createInitialState(design);
}

describe("3D editing through the reducer", () => {
  it("folds a multi-step 3D wall drag into one undo", () => {
    let state = wallState();
    const wallId = state.design.walls[0].id;
    let drag = beginDrag3D({ kind: "wall", id: wallId }, state.design, { x: 0, y: 0 });
    for (const p of [{ x: 12, y: 0 }, { x: 24, y: 6 }, { x: 36, y: 12 }]) {
      const step = dragStep3D(drag, state.design, p);
      drag = step.drag;
      state = designerReducer(state, step.action);
    }
    expect(state.design.walls[0].a).toEqual({ x: 36, y: 12 });
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.walls[0].a).toEqual({ x: 0, y: 0 });
  });

  it("makes a typed size edit its own undo step", () => {
    let state = wallState();
    const wallId = state.design.walls[0].id;
    const { action } = sizeEditAction({ kind: "wall", id: wallId }, state.design, "lengthIn", "15'");
    state = designerReducer(state, action);
    expect(state.design.walls[0].b).toEqual({ x: 180, y: 0 });
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.walls[0].b).toEqual({ x: 120, y: 0 });
  });
});
