// designerReducer.flipDoor.test.js — FLIP_DOOR flips a door's hinge side or
// swing face; each flip is one undo step.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { addOpening, addWall, createEmptyDesign, placeFurniture, placeSymbol } from "@/domains/roomDesigner/designerDocument";

function withOpening(type = "door") {
  let d = addWall(createEmptyDesign("Flip"), { x: 0, y: 0 }, { x: 120, y: 0 });
  d = addOpening(d, d.walls[0].id, { type, offsetIn: 24 });
  return { state: createInitialState(d), id: d.openings[0].id };
}
const flip = (state, openingId, part) => designerReducer(state, { type: "FLIP_DOOR", openingId, part });

describe("FLIP_DOOR", () => {
  it("toggles the hinge side and the swing face independently", () => {
    let { state, id } = withOpening();
    state = flip(state, id, "hinge");
    expect(state.design.openings[0]).toMatchObject({ hinge: "end" });
    state = flip(state, id, "swing");
    expect(state.design.openings[0]).toMatchObject({ hinge: "end", swing: "negative" });
    state = flip(state, id, "hinge");
    expect(state.design.openings[0]).toMatchObject({ hinge: "start", swing: "negative" });
  });

  it("is one undo step per flip and marks the design dirty", () => {
    let { state, id } = withOpening();
    state = flip(state, id, "swing");
    expect(state.dirty).toBe(true);
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.openings[0].swing).toBeUndefined();
  });

  it("ignores windows, unknown openings and unknown parts", () => {
    const w = withOpening("window");
    expect(flip(w.state, w.id, "hinge")).toBe(w.state);
    const { state, id } = withOpening();
    expect(flip(state, "nope", "hinge")).toBe(state);
    expect(flip(state, id, "sideways")).toBe(state);
  });
});

describe("rotation-handle drags", () => {
  it("coalesce into one undo step for furniture", () => {
    let state = createInitialState(placeFurniture(createEmptyDesign("R"), "bed-queen", 100, 100, 0));
    const id = state.design.furniture[0].id;
    for (const deg of [15, 30, 45]) {
      state = designerReducer(state, { type: "ROTATE_FURNITURE", furnitureId: id, rotationDeg: deg, coalesce: `rotate:${id}` });
    }
    expect(state.design.furniture[0].rotationDeg).toBe(45);
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.furniture[0].rotationDeg).toBe(0);
  });

  it("coalesce into one undo step for process-equipment symbols", () => {
    let state = createInitialState(placeSymbol(createEmptyDesign("R"), "processEquipment", "centrifugal-pump", 0, 0, { id: "p1" }));
    for (const deg of [300, 315]) {
      state = designerReducer(state, { type: "ROTATE_SYMBOL", symbolId: "p1", rotationDeg: deg, coalesce: "rotate:p1" });
    }
    expect(state.design.symbols[0].rotationDeg).toBe(315);
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.symbols[0].rotationDeg).toBe(0);
  });
});
