import { beforeEach, describe, expect, it } from "vitest";
import {
  addOpening,
  addRoomFromTemplate,
  addWall,
  addWallRect,
  calibrateUnderlay,
  createEmptyDesign,
  deleteFurniture,
  deleteOpening,
  deleteRoom,
  deleteWall,
  getRoomTemplate,
  moveFurniture,
  moveFurnitureMany,
  moveOpening,
  moveRoom,
  moveUnderlay,
  moveWallEndpoint,
  parseDesign,
  pieceSize,
  placeFurniture,
  removeUnderlay,
  renameDesign,
  resetDesignerIds,
  resetFurnitureSize,
  resizeFurniture,
  resizeOpening,
  rotateFurniture,
  serializeDesign,
  setFurnitureUnitCost,
  setRoomFinish,
  setUnderlay,
  setWallMaterial,
  totalRoomAreaSqFt,
  totalWallLengthIn,
  updateDesignSettings,
  updateUnderlay,
  validateDesign,
  wallRectSegments,
} from "./designerDocument";
import { ROOM_TEMPLATES } from "./designerDocument";

beforeEach(() => resetDesignerIds());

function wallDesign() {
  let d = createEmptyDesign("Test");
  d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
  d = addWall(d, { x: 144, y: 0 }, { x: 144, y: 120 }, { id: "wall_b" });
  return d;
}

describe("designerDocument — walls", () => {
  it("creates an empty design with defaults", () => {
    const d = createEmptyDesign("Kitchen");
    expect(d.version).toBe(1);
    expect(d.name).toBe("Kitchen");
    expect(d.walls).toEqual([]);
    expect(d.settings.wallHeightIn).toBe(108);
    expect(d.settings.wallThicknessIn).toBe(4.5);
  });

  it("adds walls and keeps the design immutable", () => {
    const d0 = createEmptyDesign();
    const d1 = addWall(d0, { x: 0, y: 0 }, { x: 144, y: 0 });
    expect(d0.walls).toHaveLength(0);
    expect(d1.walls).toHaveLength(1);
    expect(d1.walls[0].a).toEqual({ x: 0, y: 0 });
  });

  it("rejects degenerate walls", () => {
    const d = createEmptyDesign();
    expect(() => addWall(d, { x: 0, y: 0 }, { x: 0, y: 0 })).toThrow(/too short/);
    expect(() => addWall(d, null, { x: 1, y: 1 })).toThrow(/valid points/);
  });

  describe("wallRectSegments", () => {
    // All four drag directions must produce the same closed rectangle.
    const corners = [
      [{ x: 0, y: 0 }, { x: 144, y: 120 }], // ↘
      [{ x: 144, y: 120 }, { x: 0, y: 0 }], // ↖
      [{ x: 144, y: 0 }, { x: 0, y: 120 }], // ↙
      [{ x: 0, y: 120 }, { x: 144, y: 0 }], // ↗
    ];
    it.each(corners)("closes the rectangle for drag %j", (a, b) => {
      const segs = wallRectSegments(a, b);
      expect(segs).toHaveLength(4);
      // Exact closure: each segment starts where the previous ended.
      for (let i = 0; i < 4; i++) {
        expect(segs[i].b).toEqual(segs[(i + 1) % 4].a);
      }
      // No zero-length segments; all four corners visited.
      const pts = [segs[0].a, segs[0].b, segs[1].b, segs[2].b];
      expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(4);
      for (const seg of segs) {
        expect(Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y)).toBeGreaterThan(0);
      }
    });

    it("rejects invalid corners", () => {
      expect(() => wallRectSegments(null, { x: 1, y: 1 })).toThrow(/valid points/);
      expect(() => wallRectSegments({ x: 0, y: 0 }, { x: NaN, y: 1 })).toThrow(/valid points/);
    });
  });

  describe("addWallRect", () => {
    it("adds four closed walls atomically with unique ids", () => {
      const d0 = createEmptyDesign();
      const d1 = addWallRect(d0, { x: 0, y: 0 }, { x: 144, y: 120 });
      expect(d0.walls).toHaveLength(0); // immutable input
      expect(d1.walls).toHaveLength(4);
      const ids = d1.walls.map((w) => w.id);
      expect(new Set(ids).size).toBe(4);
      // Closure across the wall records.
      for (let i = 0; i < 4; i++) {
        expect(d1.walls[i].b).toEqual(d1.walls[(i + 1) % 4].a);
      }
    });

    it("rejects rectangles under 1 inch on either side, adding nothing", () => {
      const d0 = createEmptyDesign();
      expect(() => addWallRect(d0, { x: 0, y: 0 }, { x: 0.5, y: 120 })).toThrow(/too small/);
      expect(() => addWallRect(d0, { x: 0, y: 0 }, { x: 144, y: 0.5 })).toThrow(/too small/);
      expect(() => addWallRect(d0, { x: 10, y: 10 }, { x: 10, y: 10 })).toThrow(/too small/);
      expect(d0.walls).toHaveLength(0);
    });

    it("preserves existing walls and design data", () => {
      let d = addWall(createEmptyDesign(), { x: -50, y: -50 }, { x: -10, y: -50 });
      d = addWallRect(d, { x: 0, y: 0 }, { x: 144, y: 120 });
      expect(d.walls).toHaveLength(5);
      expect(d.walls[0].a).toEqual({ x: -50, y: -50 });
      expect(d.settings.wallHeightIn).toBe(108);
    });
  });

  it("moves a wall endpoint (resize by dragging)", () => {
    let d = wallDesign();
    const id = d.walls[0].id;
    d = moveWallEndpoint(d, id, "b", { x: 200, y: 0 });
    expect(d.walls[0].b).toEqual({ x: 200, y: 0 });
  });

  it("refuses to collapse a wall under 1 inch", () => {
    const d = wallDesign();
    const id = d.walls[0].id;
    expect(() => moveWallEndpoint(d, id, "b", { x: 0.5, y: 0 })).toThrow(/collapse/);
    expect(() => moveWallEndpoint(d, "nope", "b", { x: 1, y: 1 })).toThrow(/Unknown wall/);
  });

  it("deletes a wall along with its openings", () => {
    let d = wallDesign();
    const wallId = d.walls[0].id;
    d = addOpening(d, wallId, { type: "door", offsetIn: 36 });
    expect(d.openings).toHaveLength(1);
    d = deleteWall(d, wallId);
    expect(d.walls).toHaveLength(1);
    expect(d.openings).toHaveLength(0);
  });

  it("sums total wall length", () => {
    expect(totalWallLengthIn(wallDesign())).toBe(264); // 144 + 120
  });
});

describe("designerDocument — room templates", () => {
  it("drops a 12x12 bedroom as four walls plus a labeled polygon", () => {
    let d = createEmptyDesign();
    d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 });
    expect(d.walls).toHaveLength(4);
    expect(d.rooms).toHaveLength(1);
    expect(d.rooms[0].label).toBe("Bedroom");
    expect(totalRoomAreaSqFt(d)).toBe(144); // 12ft x 12ft
  });

  it("rejects unknown templates and bad origins", () => {
    const d = createEmptyDesign();
    expect(() => addRoomFromTemplate(d, "castle", { x: 0, y: 0 })).toThrow(/Unknown room template/);
    expect(() => addRoomFromTemplate(d, "bedroom", null)).toThrow(/valid point/);
  });

  it("deleting a template room removes its four walls", () => {
    let d = createEmptyDesign();
    d = addRoomFromTemplate(d, "bathroom", { x: 0, y: 0 });
    const roomId = d.rooms[0].id;
    d = deleteRoom(d, roomId);
    expect(d.rooms).toHaveLength(0);
    expect(d.walls).toHaveLength(0);
  });

  it("ships a sane template set", () => {
    expect(ROOM_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(getRoomTemplate("kitchen").widthIn).toBe(120);
  });
});

describe("designerDocument — openings", () => {
  it("cuts a door into a wall with a default 36-inch width", () => {
    let d = wallDesign();
    const wallId = d.walls[0].id;
    d = addOpening(d, wallId, { type: "door", offsetIn: 36 });
    expect(d.openings[0]).toMatchObject({ wallId, type: "door", offsetIn: 36, widthIn: 36 });
  });

  it("clamps openings that would overhang the wall", () => {
    let d = wallDesign();
    const wallId = d.walls[0].id; // 144in wall
    d = addOpening(d, wallId, { type: "window", offsetIn: 140, widthIn: 48 });
    const o = d.openings[0];
    expect(o.offsetIn + o.widthIn).toBeLessThanOrEqual(144);
  });

  it("moves and resizes openings within the wall", () => {
    let d = wallDesign();
    const wallId = d.walls[0].id;
    d = addOpening(d, wallId, { type: "door", offsetIn: 10 });
    const id = d.openings[0].id;
    d = moveOpening(d, id, 60);
    expect(d.openings[0].offsetIn).toBe(60);
    d = resizeOpening(d, id, 30);
    expect(d.openings[0].widthIn).toBe(30);
    d = deleteOpening(d, id);
    expect(d.openings).toHaveLength(0);
  });

  it("rejects bad opening types and unknown walls", () => {
    const d = wallDesign();
    expect(() => addOpening(d, d.walls[0].id, { type: "portal" })).toThrow(/door.*window/);
    expect(() => addOpening(d, "ghost", { type: "door" })).toThrow(/Unknown wall/);
  });
});

describe("designerDocument — furniture", () => {
  it("places, moves, rotates, and deletes a catalog piece", () => {
    let d = createEmptyDesign();
    d = placeFurniture(d, "bed-queen", 100, 100, 90);
    expect(d.furniture[0]).toMatchObject({ catalogId: "bed-queen", x: 100, y: 100, rotationDeg: 90 });
    const id = d.furniture[0].id;
    d = moveFurniture(d, id, 120, 130);
    expect(d.furniture[0]).toMatchObject({ x: 120, y: 130 });
    d = rotateFurniture(d, id, 450); // normalizes to 90
    expect(d.furniture[0].rotationDeg).toBe(90);
    d = deleteFurniture(d, id);
    expect(d.furniture).toHaveLength(0);
  });

  it("rejects unknown catalog pieces", () => {
    const d = createEmptyDesign();
    expect(() => placeFurniture(d, "hover-sofa", 0, 0)).toThrow(/Unknown catalog piece/);
  });
});

describe("designerDocument — furniture resize", () => {
  it("pieceSize resolves catalog dims, then per-piece overrides", () => {
    let d = createEmptyDesign();
    d = placeFurniture(d, "bed-queen", 100, 100);
    const id = d.furniture[0].id;
    expect(pieceSize(d.furniture[0])).toEqual({ widthIn: 60, depthIn: 80 });
    d = resizeFurniture(d, id, 72, 84);
    expect(pieceSize(d.furniture[0])).toEqual({ widthIn: 72, depthIn: 84 });
    // other pieces keep catalog size
    d = placeFurniture(d, "toilet", 0, 0);
    expect(pieceSize(d.furniture[1])).toEqual({ widthIn: 28, depthIn: 24 });
  });

  it("rounds to half-inch and rejects out-of-range sizes", () => {
    let d = createEmptyDesign();
    d = placeFurniture(d, "sofa-3seat", 0, 0);
    const id = d.furniture[0].id;
    d = resizeFurniture(d, id, 83.7, 35.2);
    expect(d.furniture[0]).toMatchObject({ widthIn: 83.5, depthIn: 35 });
    for (const [w, dd] of [[0, 36], [-5, 36], [36, 0], [36, -1], [36, 481], [481, 36]]) {
      expect(() => resizeFurniture(d, id, w, dd)).toThrow(/must be between/);
    }
    for (const bad of [NaN, Infinity, "wide", undefined]) {
      expect(() => resizeFurniture(d, id, bad, 36)).toThrow();
    }
    expect(() => resizeFurniture(d, "furniture-nope", 36, 36)).toThrow(/Unknown furniture/);
  });

  it("resetFurnitureSize drops overrides, restoring catalog size", () => {
    let d = createEmptyDesign();
    d = placeFurniture(d, "cabinet-base-24", 10, 10);
    const id = d.furniture[0].id;
    d = resizeFurniture(d, id, 30, 30);
    expect(d.furniture[0]).toHaveProperty("widthIn", 30);
    d = resetFurnitureSize(d, id);
    expect(d.furniture[0]).not.toHaveProperty("widthIn");
    expect(d.furniture[0]).not.toHaveProperty("depthIn");
    expect(pieceSize(d.furniture[0])).toEqual({ widthIn: 24, depthIn: 24 });
    expect(() => resetFurnitureSize(d, "furniture-nope")).toThrow(/Unknown furniture/);
  });

  it("keeps round pieces round when resized through the exact-size path", () => {
    let d = createEmptyDesign();
    d = placeFurniture(d, "water-heater", 0, 0);
    const id = d.furniture[0].id;
    // exact-size inputs go straight through resizeFurniture — no canvas drag
    d = resizeFurniture(d, id, 30, 20);
    expect(pieceSize(d.furniture[0])).toEqual({ widthIn: 30, depthIn: 30 });
    d = resizeFurniture(d, id, 20, 36);
    expect(pieceSize(d.furniture[0])).toEqual({ widthIn: 36, depthIn: 36 });
  });

  it("keeps size overrides through serialize/parse round trips", () => {
    let d = createEmptyDesign();
    d = placeFurniture(d, "sink-kitchen-33", 5, 5);
    d = resizeFurniture(d, d.furniture[0].id, 36, 24);
    const again = parseDesign(serializeDesign(d));
    expect(pieceSize(again.furniture[0])).toEqual({ widthIn: 36, depthIn: 24 });
  });
});

describe("designerDocument — shape data hooks", () => {
  it("stores an optional wall material at creation and via setter", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 }, { material: "2x4 stud" });
    expect(d.walls[0].material).toBe("2x4 stud");
    d = setWallMaterial(d, d.walls[0].id, "  brick veneer  ");
    expect(d.walls[0].material).toBe("brick veneer");
    // blank clears the field
    d = setWallMaterial(d, d.walls[0].id, "   ");
    expect(d.walls[0].material).toBeUndefined();
    expect(() => setWallMaterial(d, "nope", "x")).toThrow(/Unknown wall/);
  });

  it("stores an optional room finish", () => {
    let d = createEmptyDesign();
    d = addRoomFromTemplate(d, "kitchen", { x: 0, y: 0 });
    const roomId = d.rooms[0].id;
    expect(d.rooms[0].finish).toBeUndefined();
    d = setRoomFinish(d, roomId, "hardwood");
    expect(d.rooms[0].finish).toBe("hardwood");
    d = setRoomFinish(d, roomId, "");
    expect(d.rooms[0].finish).toBeUndefined();
    expect(() => setRoomFinish(d, "nope", "x")).toThrow(/Unknown room/);
  });

  it("stores an optional furniture unit cost with validation", () => {
    let d = createEmptyDesign();
    d = placeFurniture(d, "sofa-3seat", 60, 60);
    const id = d.furniture[0].id;
    expect(d.furniture[0].costPerUnit).toBeUndefined();
    d = setFurnitureUnitCost(d, id, 499.99);
    expect(d.furniture[0].costPerUnit).toBe(499.99);
    d = setFurnitureUnitCost(d, id, undefined);
    expect(d.furniture[0].costPerUnit).toBeUndefined();
    expect(() => setFurnitureUnitCost(d, id, -5)).toThrow(/non-negative/);
    expect(() => setFurnitureUnitCost(d, id, NaN)).toThrow(/non-negative/);
    expect(() => setFurnitureUnitCost(d, "nope", 10)).toThrow(/Unknown furniture/);
  });

  it("keeps shape data through serialization", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    d = setWallMaterial(d, d.walls[0].id, "2x6 stud");
    d = placeFurniture(d, "desk", 60, 60);
    d = setFurnitureUnitCost(d, d.furniture[0].id, 199.5);
    const revived = parseDesign(serializeDesign(d));
    expect(revived.walls[0].material).toBe("2x6 stud");
    expect(revived.furniture[0].costPerUnit).toBe(199.5);
    expect(validateDesign(revived)).toEqual([]);
  });
});

describe("designerDocument — moveFurnitureMany", () => {
  it("moves several pieces at once and keeps the rest", () => {
    let d = createEmptyDesign();
    d = placeFurniture(d, "desk", 10, 10);
    d = placeFurniture(d, "armchair", 30, 10);
    d = placeFurniture(d, "sofa-3seat", 60, 10);
    const [a, b] = d.furniture;
    d = moveFurnitureMany(d, [{ id: a.id, x: 0, y: 0 }, { id: b.id, x: 100, y: 0 }]);
    expect(d.furniture[0]).toMatchObject({ x: 0, y: 0 });
    expect(d.furniture[1]).toMatchObject({ x: 100, y: 0 });
    expect(d.furniture[2]).toMatchObject({ x: 60, y: 10 });
  });

  it("rejects empty or invalid position lists", () => {
    let d = createEmptyDesign();
    d = placeFurniture(d, "desk", 10, 10);
    expect(() => moveFurnitureMany(d, [])).toThrow(/No matching/);
    expect(() => moveFurnitureMany(d, [{ id: "nope", x: 1, y: 1 }])).toThrow(/No matching/);
  });
});

describe("designerDocument — settings, validation, serialization", () => {
  it("renames and updates settings with guards", () => {
    let d = createEmptyDesign();
    d = renameDesign(d, "Master bath");
    expect(d.name).toBe("Master bath");
    d = updateDesignSettings(d, { wallHeightIn: 96 });
    expect(d.settings.wallHeightIn).toBe(96);
    expect(() => updateDesignSettings(d, { wallHeightIn: -1 })).toThrow(/positive/);
  });

  it("defaults grid snapping on and toggles it with validation", () => {
    let d = createEmptyDesign();
    expect(d.settings.gridIn).toBe(6);
    expect(d.settings.snapEnabled).toBe(true);
    d = updateDesignSettings(d, { snapEnabled: false });
    expect(d.settings.snapEnabled).toBe(false);
    d = updateDesignSettings(d, { gridIn: 12 });
    expect(d.settings.gridIn).toBe(12);
    expect(() => updateDesignSettings(d, { snapEnabled: "yes" })).toThrow(/boolean/);
    expect(() => updateDesignSettings(d, { gridIn: 0 })).toThrow(/positive/);
  });

  it("backfills snapEnabled for documents saved before the grid toggle", () => {
    let d = createEmptyDesign();
    delete d.settings.snapEnabled;
    d = updateDesignSettings(d, { wallHeightIn: 96 });
    expect(d.settings.snapEnabled).toBe(true);
  });

  it("validates a healthy design with no errors", () => {
    let d = wallDesign();
    d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 36 });
    d = placeFurniture(d, "desk", 72, 60);
    expect(validateDesign(d)).toEqual([]);
  });

  it("flags dangling references and overhangs", () => {
    const d = {
      ...createEmptyDesign(),
      openings: [{ id: "o1", wallId: "ghost", type: "door", offsetIn: 0, widthIn: 36 }],
      furniture: [{ id: "f1", catalogId: "ghost-piece", x: 0, y: 0, rotationDeg: 0 }],
    };
    const errors = validateDesign(d);
    expect(errors.join(" ")).toMatch(/missing wall/);
    expect(errors.join(" ")).toMatch(/unknown catalog piece/);
    expect(validateDesign(null)).toHaveLength(1);
  });

  it("round-trips through JSON with a version check", () => {
    let d = wallDesign();
    d = placeFurniture(d, "sofa-3seat", 72, 60, 180);
    const restored = parseDesign(serializeDesign(d));
    expect(restored).toEqual(d);
    expect(() => parseDesign("{nope")).toThrow(/valid JSON/);
    expect(() => parseDesign(JSON.stringify({ version: 999 }))).toThrow(/version or shape/);
  });
});

describe("designerDocument — background underlay", () => {
  const image = {
    name: "plot.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    widthPx: 1200,
    heightPx: 800,
  };

  it("imports an underlay with sensible defaults", () => {
    const d = setUnderlay(createEmptyDesign(), image);
    expect(d.underlay.name).toBe("plot.png");
    expect(d.underlay.mimeType).toBe("image/png");
    expect(d.underlay.dataUrl).toBe(image.dataUrl);
    expect(d.underlay.opacity).toBe(0.5);
    expect(d.underlay.locked).toBe(false);
    expect(d.underlay.x).toBe(0);
    expect(d.underlay.y).toBe(0);
    // 1200 px wide image starts at a 600-inch plan width
    expect(d.underlay.pxPerIn).toBeCloseTo(2);
  });

  it("rejects non-image data URLs and bad dimensions", () => {
    expect(() =>
      setUnderlay(createEmptyDesign(), { ...image, dataUrl: "data:text/plain;base64,xx" }),
    ).toThrow(/PNG\/JPEG/);
    expect(() => setUnderlay(createEmptyDesign(), { ...image, widthPx: 0 })).toThrow(/dimensions/);
    expect(() => setUnderlay(createEmptyDesign(), { ...image, heightPx: -1 })).toThrow(/dimensions/);
  });

  it("updates opacity (clamped) and lock state", () => {
    let d = setUnderlay(createEmptyDesign(), image);
    d = updateUnderlay(d, { opacity: 0.8, locked: true });
    expect(d.underlay.opacity).toBe(0.8);
    expect(d.underlay.locked).toBe(true);
    d = updateUnderlay(d, { opacity: 5 });
    expect(d.underlay.opacity).toBe(1);
    d = updateUnderlay(d, { opacity: -1 });
    expect(d.underlay.opacity).toBe(0);
    d = updateUnderlay(d, { locked: false });
    expect(d.underlay.locked).toBe(false);
  });

  it("moves the underlay anchor and removes the underlay", () => {
    let d = setUnderlay(createEmptyDesign(), image);
    d = moveUnderlay(d, 100, 200);
    expect(d.underlay.x).toBe(100);
    expect(d.underlay.y).toBe(200);
    expect(() => moveUnderlay(d, Number.NaN, 0)).toThrow(/finite/);
    d = removeUnderlay(d);
    expect(d.underlay).toBeNull();
  });

  it("throws when operating without an underlay", () => {
    const d = createEmptyDesign();
    expect(() => updateUnderlay(d, { opacity: 0.5 })).toThrow(/no background underlay/);
    expect(() => moveUnderlay(d, 1, 2)).toThrow(/no background underlay/);
    expect(() => calibrateUnderlay(d, { x: 0, y: 0 }, { x: 1, y: 1 }, 12)).toThrow(/no background underlay/);
  });

  it("calibrates the scale from two clicks and a real distance", () => {
    let d = setUnderlay(createEmptyDesign(), image); // pxPerIn = 2
    d = calibrateUnderlay(d, { x: 0, y: 0 }, { x: 200, y: 0 }, 100);
    expect(d.underlay.pxPerIn).toBeCloseTo(4);
    // anchor stays put; only the scale changes
    expect(d.underlay.x).toBe(0);
  });

  it("keeps the first calibration point registered to the same image pixel", () => {
    let d = setUnderlay(createEmptyDesign(), image); // pxPerIn = 2
    d = moveUnderlay(d, 100, 200);
    const before = d.underlay;
    const clickA = { x: 400, y: 300 };
    const clickB = { x: 600, y: 300 };
    // clickA sits on the image at pixel (px = (400-100)*2, py = (300-200)*2).
    const pixelBefore = {
      px: (clickA.x - before.x) * before.pxPerIn,
      py: (clickA.y - before.y) * before.pxPerIn,
    };
    d = calibrateUnderlay(d, clickA, clickB, 100);
    expect(d.underlay.pxPerIn).toBeCloseTo(4);
    // The same image pixel must still sit under clickA after rescaling --
    // the top-left anchor moved instead of pivoting around the image corner.
    expect(d.underlay.x).not.toBe(before.x);
    expect((clickA.x - d.underlay.x) * d.underlay.pxPerIn).toBeCloseTo(pixelBefore.px, 6);
    expect((clickA.y - d.underlay.y) * d.underlay.pxPerIn).toBeCloseTo(pixelBefore.py, 6);
  });

  it("survives serialization", () => {
    let d = setUnderlay(createEmptyDesign(), image);
    d = updateUnderlay(d, { locked: true, opacity: 0.7 });
    const restored = parseDesign(serializeDesign(d));
    expect(restored.underlay).toEqual(d.underlay);
  });
});

describe("designerDocument — moveRoom", () => {
  function roomDesign() {
    let d = createEmptyDesign("Test");
    d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 }); // 144x144 at origin
    return d;
  }

  it("translates the polygon and all four walls by the delta", () => {
    let d = roomDesign();
    const roomId = d.rooms[0].id;
    d = moveRoom(d, roomId, 12, 24);
    const room = d.rooms[0];
    expect(room.polygon).toEqual([
      { x: 12, y: 24 },
      { x: 156, y: 24 },
      { x: 156, y: 168 },
      { x: 12, y: 168 },
    ]);
    // Bedroom template walls: tl→tr, tr→br, br→bl, bl→tl.
    const wallsById = Object.fromEntries(d.walls.map((w) => [w.id, w]));
    expect(room.wallIds).toHaveLength(4);
    expect(wallsById[room.wallIds[0]].a).toEqual({ x: 12, y: 24 });
    expect(wallsById[room.wallIds[0]].b).toEqual({ x: 156, y: 24 });
    expect(wallsById[room.wallIds[1]].a).toEqual({ x: 156, y: 24 });
    expect(wallsById[room.wallIds[1]].b).toEqual({ x: 156, y: 168 });
    expect(wallsById[room.wallIds[2]].a).toEqual({ x: 156, y: 168 });
    expect(wallsById[room.wallIds[2]].b).toEqual({ x: 12, y: 168 });
    expect(wallsById[room.wallIds[3]].a).toEqual({ x: 12, y: 168 });
    expect(wallsById[room.wallIds[3]].b).toEqual({ x: 12, y: 24 });
    // Room area is preserved by a pure translation.
    expect(totalRoomAreaSqFt(d)).toBe(144);
  });

  it("keeps openings riding on the moved walls (offsetIn unchanged)", () => {
    let d = roomDesign();
    const roomId = d.rooms[0].id;
    const wallId = d.rooms[0].wallIds[0];
    d = addOpening(d, wallId, { type: "door", offsetIn: 30, widthIn: 36 });
    d = moveRoom(d, roomId, 10, 10);
    const opening = d.openings[0];
    expect(opening.wallId).toBe(wallId);
    expect(opening.offsetIn).toBe(30);
    expect(opening.widthIn).toBe(36);
    const wall = d.walls.find((w) => w.id === wallId);
    expect(wall.a).toEqual({ x: 10, y: 10 });
  });

  it("leaves other rooms and hand-drawn walls untouched", () => {
    let d = roomDesign();
    d = addWall(d, { x: 500, y: 500 }, { x: 600, y: 500 });
    const otherWall = d.walls[d.walls.length - 1];
    d = addRoomFromTemplate(d, "bathroom", { x: 300, y: 300 });
    const otherRoomId = d.rooms[1].id;
    const movedId = d.rooms[0].id;
    d = moveRoom(d, movedId, 5, 5);
    expect(d.walls.find((w) => w.id === otherWall.id).a).toEqual({ x: 500, y: 500 });
    expect(d.rooms[1].polygon[0]).toEqual({ x: 300, y: 300 });
    expect(d.rooms.find((r) => r.id === otherRoomId)).toBe(d.rooms[1]);
  });

  it("does not mutate the input design", () => {
    const d = roomDesign();
    const roomId = d.rooms[0].id;
    const next = moveRoom(d, roomId, 12, 24);
    expect(d.rooms[0].polygon[0]).toEqual({ x: 0, y: 0 });
    expect(d.walls[0].a).toEqual({ x: 0, y: 0 });
    expect(next).not.toBe(d);
  });

  it("rejects unknown rooms and non-finite deltas", () => {
    const d = roomDesign();
    expect(() => moveRoom(d, "room_nope", 1, 1)).toThrow(/Unknown room/);
    expect(() => moveRoom(d, d.rooms[0].id, NaN, 1)).toThrow(/finite/);
    expect(() => moveRoom(d, d.rooms[0].id, 1, Infinity)).toThrow(/finite/);
  });
});
