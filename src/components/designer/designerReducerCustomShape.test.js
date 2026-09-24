// designerReducerCustomShape.test.js — arming and placing a saved shape.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { createEmptyDesign, validateDesign } from "@/domains/roomDesigner/designerDocument";

const shapeOf = (widthIn = 144, heightIn = 144) => ({
  id: "shape-1",
  name: "Bay window",
  bounds: { widthIn, heightIn },
  entities: {
    walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: widthIn, y: 0 } }],
    rooms: [], openings: [], furniture: [], pipes: [], symbols: [],
  },
});

describe("SET_PENDING_CUSTOM_SHAPE", () => {
  it("arms the custom-shape tool with the shape", () => {
    const state = designerReducer(createInitialState(), {
      type: "SET_PENDING_CUSTOM_SHAPE", shape: shapeOf(),
    });
    expect(state.tool).toBe("custom-shape");
    expect(state.pendingCustomShape).toEqual(shapeOf());
  });

  it("ignores a missing or malformed shape", () => {
    const start = createInitialState();
    expect(designerReducer(start, { type: "SET_PENDING_CUSTOM_SHAPE", shape: null })).toBe(start);
    expect(designerReducer(start, { type: "SET_PENDING_CUSTOM_SHAPE", shape: {} })).toBe(start);
  });
});

describe("PLACE_CUSTOM_SHAPE", () => {
  it("centers the shape on the click point and merges it in one undo step", () => {
    let state = designerReducer(createInitialState(), {
      type: "SET_PENDING_CUSTOM_SHAPE", shape: shapeOf(144, 96),
    });
    state = designerReducer(state, { type: "PLACE_CUSTOM_SHAPE", x: 500, y: 500 });
    expect(state.design.walls).toHaveLength(1);
    const wall = state.design.walls[0];
    // A 144x96 shape centered on (500,500) spans x 428..572.
    expect(wall.a.x).toBe(428);
    expect(wall.b.x).toBe(572);
    expect(validateDesign(state.design)).toEqual([]);
    expect(state.past).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it("accepts a shape passed directly on the action, not just the pending one", () => {
    const state = designerReducer(createInitialState(), {
      type: "PLACE_CUSTOM_SHAPE", shape: shapeOf(), x: 0, y: 0,
    });
    expect(state.design.walls).toHaveLength(1);
  });

  it("is a no-op with nothing to place", () => {
    const start = createInitialState();
    expect(designerReducer(start, { type: "PLACE_CUSTOM_SHAPE", x: 0, y: 0 })).toBe(start);
  });

  it("does not crash on a damaged shape mid-click", () => {
    const start = createInitialState();
    const next = designerReducer(start, {
      type: "PLACE_CUSTOM_SHAPE",
      shape: { id: "bad", entities: null },
      x: 0, y: 0,
    });
    expect(next).toBe(start);
  });

  it("places multiple copies without id collisions", () => {
    let state = designerReducer(createInitialState(), {
      type: "SET_PENDING_CUSTOM_SHAPE", shape: shapeOf(),
    });
    state = designerReducer(state, { type: "PLACE_CUSTOM_SHAPE", x: 0, y: 0 });
    state = designerReducer(state, { type: "PLACE_CUSTOM_SHAPE", x: 300, y: 0 });
    expect(state.design.walls).toHaveLength(2);
    expect(new Set(state.design.walls.map((w) => w.id)).size).toBe(2);
    expect(validateDesign(state.design)).toEqual([]);
  });

  it("does not mutate the design it started from", () => {
    let state = designerReducer(createInitialState(), {
      type: "SET_PENDING_CUSTOM_SHAPE", shape: shapeOf(),
    });
    const snapshot = JSON.stringify(state.design);
    designerReducer(state, { type: "PLACE_CUSTOM_SHAPE", x: 0, y: 0 });
    expect(JSON.stringify(state.design)).toBe(snapshot);
  });
});
