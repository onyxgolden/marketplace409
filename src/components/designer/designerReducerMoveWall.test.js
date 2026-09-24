// designerReducerMoveWall.test.js — MOVE_WALL.
//
// Mirrors MOVE_ROOM: guarded on the wall still existing, and coalesced so a
// whole drag collapses into ONE undo step.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import {
  addOpening,
  addWall,
  createEmptyDesign,
  findWall,
  validateDesign,
} from "@/domains/roomDesigner/designerDocument";

function start() {
  let design = addWall(createEmptyDesign("Plan"), { x: 0, y: 0 }, { x: 120, y: 0 }, { id: "w1" });
  design = addOpening(design, "w1", { type: "door", offsetIn: 24, widthIn: 36 });
  return createInitialState(design);
}

const move = (state, dx, dy, coalesce = "move-wall:w1") =>
  designerReducer(state, { type: "MOVE_WALL", wallId: "w1", dx, dy, coalesce });

describe("MOVE_WALL", () => {
  it("translates the wall and marks the design dirty", () => {
    const next = move(start(), 10, 20);
    expect(findWall(next.design, "w1").a).toEqual({ x: 10, y: 20 });
    expect(findWall(next.design, "w1").b).toEqual({ x: 130, y: 20 });
    expect(next.dirty).toBe(true);
    expect(next.designRevision).toBe(1);
  });

  it("carries the opening along and leaves the design valid", () => {
    const next = move(start(), -40, 15);
    expect(next.design.openings[0].offsetIn).toBe(24);
    expect(next.design.openings[0].wallId).toBe("w1");
    expect(validateDesign(next.design)).toEqual([]);
  });

  it("collapses a whole drag into one undo step", () => {
    let state = start();
    const before = state.design;
    for (let i = 0; i < 12; i += 1) state = move(state, 1, 0);
    expect(findWall(state.design, "w1").a.x).toBe(12);
    expect(state.past).toHaveLength(1);
    const undone = designerReducer(state, { type: "UNDO" });
    expect(undone.design).toEqual(before);
  });

  it("starts a new undo step for a separate drag", () => {
    let state = move(start(), 5, 0);
    state = move(state, 5, 0, "move-wall:w1#2");
    expect(state.past).toHaveLength(2);
  });

  it("ignores a wall that is no longer in the design", () => {
    const state = start();
    const next = designerReducer(state, {
      type: "MOVE_WALL", wallId: "gone", dx: 5, dy: 5, coalesce: "move-wall:gone",
    });
    expect(next).toBe(state);
  });

  it("does not mutate the previous design", () => {
    const state = start();
    const snapshot = JSON.stringify(state.design);
    move(state, 30, 30);
    expect(JSON.stringify(state.design)).toBe(snapshot);
  });

  it("keeps the selection through a drag", () => {
    let state = designerReducer(start(), {
      type: "SELECT", selection: { kind: "wall", id: "w1" },
    });
    state = move(state, 6, 6);
    expect(state.selection).toEqual({ kind: "wall", id: "w1" });
  });
});
