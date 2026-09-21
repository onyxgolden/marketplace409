import { beforeEach, describe, expect, it } from "vitest";
import {
  addOpening,
  addRoomFromTemplate,
  addWall,
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
  moveUnderlay,
  moveWallEndpoint,
  parseDesign,
  placeFurniture,
  removeUnderlay,
  renameDesign,
  resetDesignerIds,
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
