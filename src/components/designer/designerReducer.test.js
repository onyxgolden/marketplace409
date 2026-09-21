import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { createSaveScheduler } from "./saveScheduler";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";
import { footprintXBounds } from "@/domains/roomDesigner/designerGeometry";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";

// Rotated footprint x-bounds of a placed furniture piece (placed pieces
// carry only catalogId; nominal dims resolve from the catalog).
function boundsOf(f) {
  const entry = getCatalogEntry(f.catalogId);
  return footprintXBounds({ ...f, widthIn: entry.widthIn, depthIn: entry.depthIn });
}

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

  it("selects the wall-rect tool (regression: toolbar button must activate it)", () => {
    // PR #273 added the Wall rect toolbar button but forgot the reducer's
    // TOOLS whitelist, so clicking it silently kept the previous tool.
    const state = createInitialState();
    const next = designerReducer(state, { type: "SET_TOOL", tool: "wallrect" });
    expect(next.tool).toBe("wallrect");
    expect(next.selection).toBeNull();
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

  it("resizes furniture via RESIZE_FURNITURE and restores via RESET_FURNITURE_SIZE", () => {
    let state = createInitialState();
    state = designerReducer(state, {
      type: "PLACE_FURNITURE", catalogId: "cabinet-base-24", x: 50, y: 60,
    });
    const id = state.design.furniture[0].id;
    const rev = state.designRevision;
    state = designerReducer(state, { type: "RESIZE_FURNITURE", furnitureId: id, widthIn: 30, depthIn: 26 });
    expect(state.design.furniture[0]).toMatchObject({ widthIn: 30, depthIn: 26 });
    expect(state.dirty).toBe(true);
    expect(state.designRevision).toBe(rev + 1);
    state = designerReducer(state, { type: "RESET_FURNITURE_SIZE", furnitureId: id });
    expect(state.design.furniture[0]).not.toHaveProperty("widthIn");
  });

  it("rejects out-of-range RESIZE_FURNITURE in the reducer (domain backstop)", () => {
    let state = createInitialState();
    state = designerReducer(state, {
      type: "PLACE_FURNITURE", catalogId: "cabinet-base-24", x: 50, y: 60,
    });
    const id = state.design.furniture[0].id;
    // a corner drag past the 1"–480" footprint bounds must not reach the
    // document: the reducer throws rather than storing invalid sizes
    expect(() =>
      designerReducer(state, { type: "RESIZE_FURNITURE", furnitureId: id, widthIn: 0.5, depthIn: 26 })
    ).toThrow(/must be between/);
    expect(() =>
      designerReducer(state, { type: "RESIZE_FURNITURE", furnitureId: id, widthIn: 500, depthIn: 26 })
    ).toThrow(/must be between/);
    expect(state.design.furniture[0]).not.toHaveProperty("widthIn");
  });

  it("renames and marks saved when the save revision is current", () => {
    let state = stateWithWall();
    state = designerReducer(state, { type: "RENAME", name: "New name" });
    expect(state.design.name).toBe("New name");
    state = designerReducer(state, { type: "MARK_SAVED", savedRevision: state.designRevision });
    expect(state.dirty).toBe(false);
  });

  it("does NOT clear dirty when an edit landed while the save was in flight", () => {
    let state = stateWithWall();
    state = designerReducer(state, { type: "RENAME", name: "Edit A" });
    const revisionSentWithSave = state.designRevision;
    // User keeps editing while PUT(Edit A) is in flight → newer revision.
    state = designerReducer(state, { type: "RENAME", name: "Edit B" });
    expect(state.designRevision).toBe(revisionSentWithSave + 1);
    // Stale completion for Edit A must not claim Edit B is saved.
    state = designerReducer(state, { type: "MARK_SAVED", savedRevision: revisionSentWithSave });
    expect(state.dirty).toBe(true);
    expect(state.design.name).toBe("Edit B");
    // The save for Edit B completing later does clear dirty.
    state = designerReducer(state, { type: "MARK_SAVED", savedRevision: state.designRevision });
    expect(state.dirty).toBe(false);
  });

  it("keeps dirty when MARK_SAVED carries no revision", () => {
    let state = stateWithWall();
    state = designerReducer(state, { type: "RENAME", name: "Edit" });
    state = designerReducer(state, { type: "MARK_SAVED" });
    expect(state.dirty).toBe(true);
  });

  it("serializes overlapping saves so a stale revision never overwrites a newer one", async () => {
    const schedule = createSaveScheduler();
    let state = createInitialState(createEmptyDesign("Test"));
    const dispatch = (action) => { state = designerReducer(state, action); };
    // Drive the document to revision 5.
    for (let i = 1; i <= 5; i++) dispatch({ type: "RENAME", name: `Edit ${i}` });
    expect(state.designRevision).toBe(5);
    expect(state.dirty).toBe(true);

    // Mock server: each PUT stays in flight until the test releases it, and
    // the "database" records writes in completion order.
    const putBodies = [];
    const putGates = [];
    const persistedRevisions = [];
    const mockPut = async (body) => {
      putBodies.push(body);
      const gate = {};
      gate.promise = new Promise((resolve) => { gate.release = resolve; });
      putGates.push(gate);
      await gate.promise;
      persistedRevisions.push(body.designRevision);
    };

    // Same wiring as DesignerScreen: snapshot the freshest state at send
    // time, then mark saved with the snapshotted revision.
    const save = () => schedule(async () => {
      const snapshot = state;
      await mockPut({ designRevision: snapshot.designRevision });
      dispatch({ type: "MARK_SAVED", savedRevision: snapshot.designRevision });
    });

    // Save rev 5 begins; its PUT stays in flight. (The scheduled task starts
    // on a microtask, so flush before asserting it began.)
    const first = save();
    await new Promise((r) => setTimeout(r, 0));
    expect(putBodies).toHaveLength(1);

    // Edit → rev 6, then a second save is requested while the first is in flight.
    dispatch({ type: "RENAME", name: "Edit 6" });
    expect(state.designRevision).toBe(6);
    const second = save();

    // Serialized: the second PUT must not start while the first is in
    // flight, so the slow first PUT can never land after (and overwrite) rev 6.
    await new Promise((r) => setTimeout(r, 0));
    expect(putBodies).toHaveLength(1);

    // The rev-5 PUT completes; the edit that landed in flight must stay dirty.
    putGates[0].release();
    await first;
    expect(state.dirty).toBe(true);
    expect(persistedRevisions).toEqual([5]);

    // The queued save now runs and snapshots the freshest revision (6).
    await new Promise((r) => setTimeout(r, 0));
    expect(putBodies).toHaveLength(2);
    expect(putBodies[1].designRevision).toBe(6);

    // Rev 6 persists; dirty clears only now, and the final persisted
    // document is rev 6 — rev 5 never lands after rev 6.
    putGates[1].release();
    await second;
    expect(state.dirty).toBe(false);
    expect(persistedRevisions).toEqual([5, 6]);
    expect(persistedRevisions[persistedRevisions.length - 1]).toBe(6);
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

  it("aligns multi-selected furniture by rotated footprint EDGES, not centers", () => {
    // desk 48x24 (left edge x-24), armchair 36x36 (left edge x-18),
    // sofa-3seat 84x36 (left edge x-42)
    const selectAll = (s) => {
      for (const f of s.design.furniture) {
        s = designerReducer(s, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: f.id } });
      }
      return s;
    };
    const placeThree = () => {
      let s = createInitialState();
      for (const [id, x] of [["desk", 10], ["armchair", 40], ["sofa-3seat", 100]]) {
        s = designerReducer(s, { type: "PLACE_FURNITURE", catalogId: id, x, y: 10 });
      }
      return selectAll(s);
    };
    let state = designerReducer(placeThree(), { type: "ALIGN_FURNITURE", mode: "left" });
    const leftEdges = state.design.furniture.map((f) => boundsOf(f).left);
    // min left edge: desk at 10-24 = -14
    for (const edge of leftEdges) expect(edge).toBeCloseTo(-14, 9);
    // centers are NOT collapsed: this was the old (wrong) behavior
    expect(state.design.furniture.map((f) => f.x)).not.toEqual([10, 10, 10]);
    expect(state.dirty).toBe(true);

    state = designerReducer(placeThree(), { type: "ALIGN_FURNITURE", mode: "right" });
    const rightEdges = state.design.furniture.map((f) => boundsOf(f).right);
    // max right edge: sofa at 100+42 = 142
    for (const edge of rightEdges) expect(edge).toBeCloseTo(142, 9);
    expect(state.dirty).toBe(true);
  });

  it("aligns rotated furniture against its rotated footprint edges", () => {
    let state = createInitialState();
    for (const [id, x] of [["desk", 10], ["sofa-3seat", 200]]) {
      state = designerReducer(state, { type: "PLACE_FURNITURE", catalogId: id, x, y: 10 });
    }
    const sofa = state.design.furniture.find((f) => f.catalogId === "sofa-3seat");
    state = designerReducer(state, { type: "ROTATE_FURNITURE", furnitureId: sofa.id, rotationDeg: 90 });
    for (const f of state.design.furniture) {
      state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: f.id } });
    }
    state = designerReducer(state, { type: "ALIGN_FURNITURE", mode: "left" });
    // 90°-rotated 84x36 sofa has a 36-inch-wide footprint: its left edge is
    // x-18, so the group's left edge is the desk's 10-24 = -14 and the sofa
    // must move to x = -14 + 18 = 4.
    const sofaAfter = state.design.furniture.find((f) => f.catalogId === "sofa-3seat");
    expect(sofaAfter.x).toBeCloseTo(4, 9);
  });

  it("distributes equal free gaps between multi-selected furniture", () => {
    let state = createInitialState();
    for (const [id, x] of [["desk", 0], ["armchair", 50], ["sofa-3seat", 300]]) {
      state = designerReducer(state, { type: "PLACE_FURNITURE", catalogId: id, x, y: 10 });
    }
    for (const f of state.design.furniture) {
      state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: f.id } });
    }
    state = designerReducer(state, { type: "DISTRIBUTE_FURNITURE" });
    const byCatalog = Object.fromEntries(
      state.design.furniture.map((f) => [f.catalogId, f]),
    );
    expect(byCatalog.desk.x).toBe(0); // leftmost stays
    expect(byCatalog["sofa-3seat"].x).toBe(300); // rightmost stays
    // desk right edge 24, sofa left edge 258, armchair 36 wide →
    // equal gaps of (258-24-36)/2 = 99
    const gap1 = boundsOf(byCatalog.armchair).left - boundsOf(byCatalog.desk).right;
    const gap2 = boundsOf(byCatalog["sofa-3seat"]).left - boundsOf(byCatalog.armchair).right;
    expect(gap1).toBeCloseTo(99, 6);
    expect(gap2).toBeCloseTo(99, 6);
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

describe("designerReducer — MOVE_ROOM", () => {
  function stateWithRoom() {
    let state = createInitialState(createEmptyDesign("Test"));
    state = designerReducer(state, {
      type: "ADD_ROOM", templateId: "bedroom", at: { x: 0, y: 0 },
    });
    return state;
  }

  it("moves the room polygon and its walls, and ignores unknown rooms", () => {
    let state = stateWithRoom();
    const roomId = state.design.rooms[0].id;
    state = designerReducer(state, {
      type: "MOVE_ROOM", roomId, dx: 12, dy: 24, coalesce: `move-room:${roomId}`,
    });
    const room = state.design.rooms[0];
    expect(room.polygon[0]).toEqual({ x: 12, y: 24 });
    const wall = state.design.walls.find((w) => w.id === room.wallIds[0]);
    expect(wall.a).toEqual({ x: 12, y: 24 });
    expect(state.dirty).toBe(true);
    const unchanged = state;
    state = designerReducer(state, {
      type: "MOVE_ROOM", roomId: "room_nope", dx: 1, dy: 1,
    });
    expect(state).toBe(unchanged);
  });

  it("coalesces one room drag into a single undo step", () => {
    let state = stateWithRoom();
    const roomId = state.design.rooms[0].id;
    const pastBefore = state.past.length;
    const key = `move-room:${roomId}`;
    state = designerReducer(state, { type: "MOVE_ROOM", roomId, dx: 6, dy: 0, coalesce: key });
    state = designerReducer(state, { type: "MOVE_ROOM", roomId, dx: 6, dy: 0, coalesce: key });
    state = designerReducer(state, { type: "MOVE_ROOM", roomId, dx: 6, dy: 0, coalesce: key });
    expect(state.past.length).toBe(pastBefore + 1);
    expect(state.design.rooms[0].polygon[0]).toEqual({ x: 18, y: 0 });
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.rooms[0].polygon[0]).toEqual({ x: 0, y: 0 });
    state = designerReducer(state, { type: "REDO" });
    expect(state.design.rooms[0].polygon[0]).toEqual({ x: 18, y: 0 });
  });
});
