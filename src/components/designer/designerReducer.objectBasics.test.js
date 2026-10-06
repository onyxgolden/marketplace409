// designerReducer.objectBasics.test.js — copy/paste, duplicate, flip, delete,
// and numeric rotation through the reducer. Each edit is one undo step, so
// undo restores the design exactly.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import {
  addDeck,
  addOpening,
  addRoomFromTemplate,
  addSheet,
  addWall,
  createEmptyDesign,
  placeFurniture,
  placeSymbol,
} from "@/domains/roomDesigner/designerDocument";

function stateWith(build) {
  return createInitialState(build(createEmptyDesign("Objects")));
}
const select = (state, kind, id) => designerReducer(state, { type: "SELECT", selection: { kind, id } });
const selectHouse = (state) => designerReducer(state, { type: "SELECT_HOUSE" });
const act = (state, action) => designerReducer(state, action);

/** A small house: a room, a loose wall with a window, a bed, a pump, and a deck. */
function sampleHouse(d) {
  let design = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 });
  design = addWall(design, { x: 200, y: 0 }, { x: 320, y: 0 });
  design = addOpening(design, design.walls[design.walls.length - 1].id, { type: "window", offsetIn: 20, widthIn: 36 });
  design = placeFurniture(design, "bed-queen", 60, 60, 0);
  design = placeSymbol(design, "processEquipment", "centrifugal-pump", 400, 400, { id: "pump-1" });
  return addDeck(design, { x: 500, y: 0 }, { x: 620, y: 96 });
}

describe("DUPLICATE_SELECTION (Ctrl+D)", () => {
  it("copies the selected furniture a foot away, selects the copy, and makes one undo step", () => {
    let state = stateWith((d) => placeFurniture(d, "bed-queen", 100, 100, 0));
    const original = state.design.furniture[0];
    state = select(state, "furniture", original.id);
    const before = state.design;
    state = act(state, { type: "DUPLICATE_SELECTION" });
    expect(state.design.furniture).toHaveLength(2);
    const copy = state.design.furniture.find((f) => f.id !== original.id);
    expect(copy).toMatchObject({ x: 112, y: 112 });
    expect(state.selection).toEqual({ kind: "furniture", id: copy.id });
    expect(state.past).toHaveLength(1);
    state = act(state, { type: "UNDO" });
    expect(state.design).toEqual(before);
    state = act(state, { type: "REDO" });
    expect(state.design.furniture).toHaveLength(2);
  });

  it("does nothing when nothing is selected", () => {
    const state = stateWith((d) => placeFurniture(d, "bed-queen", 0, 0, 0));
    expect(act(state, { type: "DUPLICATE_SELECTION" })).toBe(state);
  });

  it("duplicates the whole house as a group that moves on its own", () => {
    let state = stateWith(sampleHouse);
    const originalWall = state.design.walls[0];
    state = selectHouse(state);
    state = act(state, { type: "DUPLICATE_SELECTION" });
    expect(state.selection.kind).toBe("group");
    expect(state.design.walls).toHaveLength(initialWallCount() * 2);
    // Original walls are where they were.
    expect(state.design.walls.find((w) => w.id === originalWall.id)).toEqual(originalWall);
    // Nudging moves only the copy.
    state = act(state, { type: "NUDGE_SELECTION", dx: 1, dy: 0 });
    const copiedWall = state.design.walls.find((w) => w.id !== originalWall.id && w.a.x === originalWall.a.x + 12 + 6);
    expect(copiedWall).toBeDefined();
    expect(state.design.walls.find((w) => w.id === originalWall.id)).toEqual(originalWall);
  });
});

describe("COPY_SELECTION and PASTE_CLIPBOARD (Ctrl+C / Ctrl+V)", () => {
  it("pastes the copied object again each time, one foot further out", () => {
    let state = stateWith((d) => placeFurniture(d, "toilet", 100, 100, 0));
    state = select(state, "furniture", state.design.furniture[0].id);
    state = act(state, { type: "COPY_SELECTION" });
    state = act(state, { type: "PASTE_CLIPBOARD" });
    expect(state.design.furniture).toHaveLength(2);
    expect(state.design.furniture[1]).toMatchObject({ x: 112, y: 112 });
    state = act(state, { type: "PASTE_CLIPBOARD" });
    expect(state.design.furniture).toHaveLength(3);
    expect(state.design.furniture[2]).toMatchObject({ x: 124, y: 124 });
    expect(state.selection.id).toBe(state.design.furniture[2].id);
  });

  it("pastes nothing when nothing has been copied", () => {
    const state = stateWith((d) => placeFurniture(d, "toilet", 0, 0, 0));
    expect(act(state, { type: "PASTE_CLIPBOARD" })).toBe(state);
  });

  it("copying with nothing selected changes nothing", () => {
    const state = stateWith((d) => placeFurniture(d, "toilet", 0, 0, 0));
    expect(act(state, { type: "COPY_SELECTION" })).toBe(state);
  });
});

describe("FLIP_SELECTION", () => {
  it("mirrors the whole house left to right and undoes in one step", () => {
    let state = stateWith(sampleHouse);
    const before = state.design;
    state = selectHouse(state);
    state = act(state, { type: "FLIP_SELECTION", axis: "horizontal" });
    expect(state.design.walls[0].a.x).not.toBe(before.walls[0].a.x);
    expect(state.selection).toEqual({ kind: "house", id: "house" });
    state = act(state, { type: "UNDO" });
    expect(state.design).toEqual(before);
  });

  it("flips a single piece of furniture in place and negates its angle", () => {
    let state = stateWith((d) => placeFurniture(d, "bed-queen", 100, 100, 30));
    state = select(state, "furniture", state.design.furniture[0].id);
    state = act(state, { type: "FLIP_SELECTION", axis: "vertical" });
    expect(state.design.furniture[0]).toMatchObject({ x: 100, y: 100, rotationDeg: 330 });
  });
});

describe("DELETE_SELECTION", () => {
  it("removes the whole house but keeps paper sheets, and undo restores it exactly", () => {
    let state = stateWith((d) => addSheet(sampleHouse(d), "letter", "portrait", { x: 0, y: 700 }));
    const before = state.design;
    state = selectHouse(state);
    state = act(state, { type: "DELETE_SELECTION" });
    expect(state.design.walls).toEqual([]);
    expect(state.design.rooms).toEqual([]);
    expect(state.design.openings).toEqual([]);
    expect(state.design.furniture).toEqual([]);
    expect(state.design.symbols).toEqual([]);
    expect(state.design.decks).toEqual([]);
    expect(state.design.sheets).toHaveLength(1);
    expect(state.selection).toBeNull();
    state = act(state, { type: "UNDO" });
    expect(state.design).toEqual(before);
  });

  it("removes a selected opening and keeps its wall", () => {
    let state = stateWith((d) => {
      const withWall = addWall(d, { x: 0, y: 0 }, { x: 120, y: 0 });
      return addOpening(withWall, withWall.walls[0].id, { type: "door", offsetIn: 10, widthIn: 36 });
    });
    const wall = state.design.walls[0];
    const opening = state.design.openings[0];
    state = select(state, "opening", opening.id);
    state = act(state, { type: "DELETE_SELECTION" });
    expect(state.design.openings).toEqual([]);
    expect(state.design.walls).toEqual([wall]);
  });

  it("removes every furniture piece in a multi-select", () => {
    let state = stateWith((d) => placeFurniture(placeFurniture(d, "toilet", 0, 0, 0), "bed-queen", 50, 50, 0));
    const ids = state.design.furniture.map((f) => f.id);
    state = act(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: ids[0] } });
    state = act(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: ids[1] } });
    state = act(state, { type: "DELETE_SELECTION" });
    expect(state.design.furniture).toEqual([]);
  });

  it("does nothing when nothing is selected", () => {
    const state = stateWith((d) => placeFurniture(d, "toilet", 0, 0, 0));
    expect(act(state, { type: "DELETE_SELECTION" })).toBe(state);
  });
});

describe("numeric rotation (ROTATE_FURNITURE / ROTATE_SYMBOL)", () => {
  it("sets the exact typed angle, including decimals", () => {
    let state = stateWith((d) => placeFurniture(d, "toilet", 0, 0, 0));
    const id = state.design.furniture[0].id;
    state = act(state, { type: "ROTATE_FURNITURE", furnitureId: id, rotationDeg: 37.5 });
    expect(state.design.furniture[0].rotationDeg).toBe(37.5);
  });

  it("wraps angles into 0 to 359", () => {
    let state = stateWith((d) => placeFurniture(d, "toilet", 0, 0, 0));
    const id = state.design.furniture[0].id;
    state = act(state, { type: "ROTATE_FURNITURE", furnitureId: id, rotationDeg: -90 });
    expect(state.design.furniture[0].rotationDeg).toBe(270);
    state = act(state, { type: "ROTATE_FURNITURE", furnitureId: id, rotationDeg: 405 });
    expect(state.design.furniture[0].rotationDeg).toBe(45);
  });

  it("sets a placed symbol's exact angle and undoes it", () => {
    let state = stateWith((d) => placeSymbol(d, "processEquipment", "centrifugal-pump", 0, 0, { id: "pump-1" }));
    state = act(state, { type: "ROTATE_SYMBOL", symbolId: "pump-1", rotationDeg: 120 });
    expect(state.design.symbols[0].rotationDeg).toBe(120);
    state = act(state, { type: "UNDO" });
    expect(state.design.symbols[0].rotationDeg).toBe(0);
  });
});

function initialWallCount() {
  return stateWith(sampleHouse).design.walls.length;
}
