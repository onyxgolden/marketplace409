import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

function stateWithWall() {
  let state = createInitialState(createEmptyDesign("Test"));
  state = designerReducer(state, {
    type: "ADD_WALL", a: { x: 0, y: 0 }, b: { x: 144, y: 0 },
  });
  return state;
}

describe("designerReducer", () => {
  it("adds a wall and marks the design dirty", () => {
    const state = stateWithWall();
    expect(state.design.walls).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it("switches tools and clears selection", () => {
    let state = stateWithWall();
    state = designerReducer(state, {
      type: "SELECT", selection: { kind: "wall", id: state.design.walls[0].id },
    });
    state = designerReducer(state, { type: "SET_TOOL", tool: "wall" });
    expect(state.tool).toBe("wall");
    expect(state.selection).toBeNull();
  });

  it("ignores unknown tools", () => {
    const state = createInitialState();
    expect(designerReducer(state, { type: "SET_TOOL", tool: "laser" }).tool).toBe("select");
  });

  it("drops a room template at a point", () => {
    let state = createInitialState();
    state = designerReducer(state, {
      type: "ADD_ROOM", templateId: "kitchen", at: { x: 0, y: 0 },
    });
    expect(state.design.walls).toHaveLength(4);
    expect(state.design.rooms[0].label).toBe("Kitchen");
  });

  it("cuts an opening and deletes it via selection", () => {
    let state = stateWithWall();
    const wallId = state.design.walls[0].id;
    state = designerReducer(state, {
      type: "ADD_OPENING", wallId, openingType: "door", offsetIn: 36,
    });
    expect(state.design.openings).toHaveLength(1);
    const openingId = state.design.openings[0].id;
    state = designerReducer(state, { type: "SELECT", selection: { kind: "opening", id: openingId } });
    state = designerReducer(state, { type: "DELETE_SELECTION" });
    expect(state.design.openings).toHaveLength(0);
    expect(state.selection).toBeNull();
  });

  it("places and rotates furniture", () => {
    let state = createInitialState();
    state = designerReducer(state, {
      type: "PLACE_FURNITURE", catalogId: "desk", x: 50, y: 60, rotationDeg: 45,
    });
    expect(state.design.furniture[0]).toMatchObject({ catalogId: "desk", rotationDeg: 45 });
    const id = state.design.furniture[0].id;
    state = designerReducer(state, { type: "ROTATE_FURNITURE", furnitureId: id, rotationDeg: 90 });
    expect(state.design.furniture[0].rotationDeg).toBe(90);
  });

  it("renames and marks saved", () => {
    let state = stateWithWall();
    state = designerReducer(state, { type: "RENAME", name: "New name" });
    expect(state.design.name).toBe("New name");
    state = designerReducer(state, { type: "MARK_SAVED" });
    expect(state.dirty).toBe(false);
  });

  it("toggles 2d/3d view", () => {    const state = createInitialState();
    expect(designerReducer(state, { type: "SET_VIEW", view: "3d" }).view).toBe("3d");
    expect(designerReducer(state, { type: "SET_VIEW", view: "bogus" }).view).toBe("2d");
  });

  it("loads a fresh design while keeping the current view", () => {
    let state = createInitialState();
    state = designerReducer(state, { type: "SET_VIEW", view: "3d" });
    state = designerReducer(state, { type: "LOAD_DESIGN", design: createEmptyDesign("Other") });
    expect(state.design.name).toBe("Other");
    expect(state.view).toBe("3d");
    expect(state.dirty).toBe(false);
  });

  it("resizes an opening", () => {
    let state = stateWithWall();
    const wallId = state.design.walls[0].id;
    state = designerReducer(state, {
      type: "ADD_OPENING", wallId, openingType: "window", offsetIn: 36,
    });
    const id = state.design.openings[0].id;
    state = designerReducer(state, { type: "RESIZE_OPENING", openingId: id, widthIn: 60 });
    expect(state.design.openings[0].widthIn).toBe(60);
  });

  it("deletes any object directly via DELETE_OBJECT", () => {
    let state = stateWithWall();
    const wallId = state.design.walls[0].id;
    state = designerReducer(state, {
      type: "DELETE_OBJECT", target: { kind: "wall", id: wallId },
    });
    expect(state.design.walls).toHaveLength(0);
    expect(state.selection).toBeNull();
  });

  it("toggles furniture in the multi-selection", () => {
    let state = createInitialState();
    for (const [id, x] of [["desk", 10], ["armchair", 30]]) {
      state = designerReducer(state, { type: "PLACE_FURNITURE", catalogId: id, x, y: 10 });
    }
    const [a, b] = state.design.furniture;
    state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: a.id } });
    state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: b.id } });
    expect(state.multiSelection.map((m) => m.id)).toEqual([a.id, b.id]);
    expect(state.selection).toBeNull();
    // toggling again removes it
    state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: a.id } });
    expect(state.multiSelection.map((m) => m.id)).toEqual([b.id]);
    // non-furniture targets are ignored
    state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "wall", id: "w" } });
    expect(state.multiSelection).toHaveLength(1);
  });

  it("aligns multi-selected furniture left/center/right", () => {
    let state = createInitialState();
    for (const [id, x] of [["desk", 10], ["armchair", 40], ["sofa-3seat", 100]]) {
      state = designerReducer(state, { type: "PLACE_FURNITURE", catalogId: id, x, y: 10 });
    }
    for (const f of state.design.furniture) {
      state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: f.id } });
    }
    state = designerReducer(state, { type: "ALIGN_FURNITURE", mode: "left" });
    expect(state.design.furniture.map((f) => f.x)).toEqual([10, 10, 10]);
    state = designerReducer(state, { type: "ALIGN_FURNITURE", mode: "right" });
    expect(state.design.furniture.map((f) => f.x)).toEqual([10, 10, 10]);
    expect(state.dirty).toBe(true);
  });

  it("distributes multi-selected furniture evenly", () => {
    let state = createInitialState();
    for (const [id, x] of [["desk", 0], ["armchair", 10], ["sofa-3seat", 100]]) {
      state = designerReducer(state, { type: "PLACE_FURNITURE", catalogId: id, x, y: 10 });
    }
    for (const f of state.design.furniture) {
      state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: f.id } });
    }
    state = designerReducer(state, { type: "DISTRIBUTE_FURNITURE" });
    expect(state.design.furniture.map((f) => f.x)).toEqual([0, 50, 100]);
  });

  it("deletes multi-selected furniture with DELETE_SELECTION", () => {
    let state = createInitialState();
    for (const [id, x] of [["desk", 10], ["armchair", 30]]) {
      state = designerReducer(state, { type: "PLACE_FURNITURE", catalogId: id, x, y: 10 });
    }
    for (const f of state.design.furniture) {
      state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: f.id } });
    }
    state = designerReducer(state, { type: "DELETE_SELECTION" });
    expect(state.design.furniture).toHaveLength(0);
    expect(state.multiSelection).toEqual([]);
  });

  it("sets wall material, room finish, and furniture unit cost", () => {
    let state = stateWithWall();
    const wallId = state.design.walls[0].id;
    state = designerReducer(state, { type: "SET_WALL_MATERIAL", wallId, material: "2x4 stud" });
    expect(state.design.walls[0].material).toBe("2x4 stud");
    expect(state.dirty).toBe(true);

    state = designerReducer(state, { type: "ADD_ROOM", templateId: "kitchen", at: { x: 200, y: 0 } });
    const roomId = state.design.rooms[0].id;
    state = designerReducer(state, { type: "SET_ROOM_FINISH", roomId, finish: "tile" });
    expect(state.design.rooms[0].finish).toBe("tile");

    state = designerReducer(state, { type: "PLACE_FURNITURE", catalogId: "desk", x: 50, y: 50 });
    const fid = state.design.furniture[0].id;
    state = designerReducer(state, { type: "SET_FURNITURE_COST", furnitureId: fid, costPerUnit: 249.99 });
    expect(state.design.furniture[0].costPerUnit).toBe(249.99);
  });
});

describe("designerReducer — background underlay", () => {
  const image = {
    name: "plot.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,xx",
    widthPx: 1200,
    heightPx: 800,
  };

  function stateWithUnderlay() {
    let state = createInitialState(createEmptyDesign("Test"));
    return designerReducer(state, { type: "SET_UNDERLAY", underlay: image });
  }

  it("imports an underlay and marks the design dirty", () => {
    const state = stateWithUnderlay();
    expect(state.design.underlay.name).toBe("plot.png");
    expect(state.dirty).toBe(true);
  });

  it("collects calibration points and restarts on the third click", () => {
    let state = stateWithUnderlay();
    state = designerReducer(state, { type: "SET_TOOL", tool: "calibrate" });
    expect(state.tool).toBe("calibrate");
    state = designerReducer(state, { type: "ADD_CALIBRATION_POINT", point: { x: 0, y: 0 } });
    expect(state.calibration).toEqual({ a: { x: 0, y: 0 } });
    state = designerReducer(state, { type: "ADD_CALIBRATION_POINT", point: { x: 200, y: 0 } });
    expect(state.calibration.b).toEqual({ x: 200, y: 0 });
    state = designerReducer(state, { type: "ADD_CALIBRATION_POINT", point: { x: 5, y: 5 } });
    expect(state.calibration).toEqual({ a: { x: 5, y: 5 } });
  });

  it("applies calibration: rescales, clears points, returns to select", () => {
    let state = stateWithUnderlay();
    state = designerReducer(state, { type: "SET_TOOL", tool: "calibrate" });
    state = designerReducer(state, { type: "ADD_CALIBRATION_POINT", point: { x: 0, y: 0 } });
    state = designerReducer(state, { type: "ADD_CALIBRATION_POINT", point: { x: 200, y: 0 } });
    state = designerReducer(state, { type: "APPLY_CALIBRATION", realDistanceIn: 100 });
    expect(state.design.underlay.pxPerIn).toBeCloseTo(4);
    expect(state.calibration).toBeNull();
    expect(state.tool).toBe("select");
  });

  it("ignores calibration actions without an underlay or points", () => {
    const fresh = createInitialState(createEmptyDesign("Test"));
    expect(
      designerReducer(fresh, { type: "ADD_CALIBRATION_POINT", point: { x: 1, y: 1 } }),
    ).toBe(fresh);
    const withUnderlay = stateWithUnderlay();
    expect(
      designerReducer(withUnderlay, { type: "APPLY_CALIBRATION", realDistanceIn: 100 }),
    ).toBe(withUnderlay);
  });

  it("clears calibration points when leaving the calibrate tool", () => {
    let state = stateWithUnderlay();
    state = designerReducer(state, { type: "SET_TOOL", tool: "calibrate" });
    state = designerReducer(state, { type: "ADD_CALIBRATION_POINT", point: { x: 1, y: 1 } });
    state = designerReducer(state, { type: "SET_TOOL", tool: "select" });
    expect(state.calibration).toBeNull();
  });

  it("removes the underlay and exits calibrate mode", () => {
    let state = stateWithUnderlay();
    state = designerReducer(state, { type: "SET_TOOL", tool: "calibrate" });
    state = designerReducer(state, { type: "REMOVE_UNDERLAY" });
    expect(state.design.underlay).toBeNull();
    expect(state.tool).toBe("select");
    expect(state.calibration).toBeNull();
  });

  it("moves and patches the underlay", () => {
    let state = stateWithUnderlay();
    state = designerReducer(state, { type: "MOVE_UNDERLAY", x: 30, y: 40 });
    expect(state.design.underlay.x).toBe(30);
    expect(state.design.underlay.y).toBe(40);
    state = designerReducer(state, { type: "UPDATE_UNDERLAY", patch: { locked: true, opacity: 0.3 } });
    expect(state.design.underlay.locked).toBe(true);
    expect(state.design.underlay.opacity).toBe(0.3);
  });
});
