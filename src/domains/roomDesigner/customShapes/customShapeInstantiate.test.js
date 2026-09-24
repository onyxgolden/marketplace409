// customShapeInstantiate.test.js — placing a saved shape back into a design.
//
// The contract that matters: a placed shape is made of ORDINARY design
// entities with fresh ids, its internal references (room→walls,
// opening→wall) still point at its own copies, and inserting a shape into the
// very design it came from does not collide.

import { describe, expect, it, beforeEach } from "vitest";
import { buildShapeRecords, insertShape, insertShapeCentered } from "./customShapeInstantiate";
import { captureSelection } from "./customShapeCapture";
import { CustomShapeError } from "./customShapeErrors";
import {
  addOpening,
  addRoomFromTemplate,
  createEmptyDesign,
  resetDesignerIds,
  validateDesign,
} from "../designerDocument";

beforeEach(() => {
  resetDesignerIds();
});

/** A saved-shape-like record for a 12x12 bedroom with a door. */
function bedroomShape() {
  let d = addRoomFromTemplate(createEmptyDesign("Plan"), "bedroom", { x: 60, y: 60 });
  const room = d.rooms[0];
  d = addOpening(d, room.wallIds[0], { type: "door", offsetIn: 24, widthIn: 36 });
  const capture = captureSelection(d, { kind: "room", id: room.id }, []);
  return { id: "shape-1", name: "Bedroom", ...capture, favorite: false };
}

describe("buildShapeRecords", () => {
  it("translates the shape to the requested top-left", () => {
    const records = buildShapeRecords(bedroomShape(), { x: 300, y: 400 });
    const xs = records.rooms[0].polygon.map((p) => p.x);
    const ys = records.rooms[0].polygon.map((p) => p.y);
    expect(Math.min(...xs)).toBe(300);
    expect(Math.min(...ys)).toBe(400);
    expect(Math.max(...xs)).toBe(444); // 300 + 144
  });

  it("gives every entity a fresh id", () => {
    const shape = bedroomShape();
    const records = buildShapeRecords(shape, { x: 0, y: 0 });
    const originalIds = new Set([
      ...shape.entities.walls.map((w) => w.id),
      ...shape.entities.rooms.map((r) => r.id),
      ...shape.entities.openings.map((o) => o.id),
    ]);
    const newIds = [
      ...records.walls.map((w) => w.id),
      ...records.rooms.map((r) => r.id),
      ...records.openings.map((o) => o.id),
    ];
    for (const id of newIds) expect(originalIds.has(id)).toBe(false);
    expect(new Set(newIds).size).toBe(newIds.length);
  });

  it("re-points the room at its own new walls", () => {
    const records = buildShapeRecords(bedroomShape(), { x: 0, y: 0 });
    const wallIds = new Set(records.walls.map((w) => w.id));
    expect(records.rooms[0].wallIds).toHaveLength(4);
    for (const id of records.rooms[0].wallIds) expect(wallIds.has(id)).toBe(true);
  });

  it("re-points each opening at its own new wall", () => {
    const records = buildShapeRecords(bedroomShape(), { x: 0, y: 0 });
    const wallIds = new Set(records.walls.map((w) => w.id));
    expect(records.openings).toHaveLength(1);
    expect(wallIds.has(records.openings[0].wallId)).toBe(true);
  });

  it("drops an opening whose wall was not captured, rather than dangling it", () => {
    const shape = bedroomShape();
    shape.entities.openings.push({ id: "orphan", wallId: "never-captured", type: "door", offsetIn: 1, widthIn: 30 });
    const records = buildShapeRecords(shape, { x: 0, y: 0 });
    expect(records.openings).toHaveLength(1);
    expect(records.openings.map((o) => o.id)).not.toContain("orphan");
  });

  it("never mutates the saved shape", () => {
    const shape = bedroomShape();
    const snapshot = JSON.stringify(shape);
    buildShapeRecords(shape, { x: 250, y: 250 });
    expect(JSON.stringify(shape)).toBe(snapshot);
  });

  it("produces different ids for two placements of the same shape", () => {
    const shape = bedroomShape();
    const a = buildShapeRecords(shape, { x: 0, y: 0 }, { instanceId: "one" });
    const b = buildShapeRecords(shape, { x: 0, y: 0 }, { instanceId: "two" });
    expect(a.walls[0].id).not.toBe(b.walls[0].id);
  });

  it("refuses a bad shape or point", () => {
    expect(() => buildShapeRecords(null, { x: 0, y: 0 })).toThrow(CustomShapeError);
    expect(() => buildShapeRecords(bedroomShape(), null)).toThrow(/valid point/);
    expect(() => buildShapeRecords(bedroomShape(), { x: NaN, y: 0 })).toThrow(/valid point/);
  });
});

describe("insertShape", () => {
  it("adds ordinary, valid design entities", () => {
    const design = insertShape(createEmptyDesign("Plan"), bedroomShape(), { x: 0, y: 0 });
    expect(design.walls).toHaveLength(4);
    expect(design.rooms).toHaveLength(1);
    expect(design.openings).toHaveLength(1);
    expect(validateDesign(design)).toEqual([]);
  });

  it("does not mutate the design", () => {
    const design = createEmptyDesign("Plan");
    const snapshot = JSON.stringify(design);
    insertShape(design, bedroomShape(), { x: 10, y: 10 });
    expect(JSON.stringify(design)).toBe(snapshot);
  });

  it("can be inserted into the very design it was captured from", () => {
    let d = addRoomFromTemplate(createEmptyDesign("Plan"), "bedroom", { x: 60, y: 60 });
    const room = d.rooms[0];
    d = addOpening(d, room.wallIds[0], { type: "door", offsetIn: 24, widthIn: 36 });
    const capture = captureSelection(d, { kind: "room", id: room.id }, []);
    const shape = { id: "shape-1", name: "Bedroom", ...capture };

    const after = insertShape(d, shape, { x: 400, y: 400 });
    expect(after.rooms).toHaveLength(2);
    expect(after.walls).toHaveLength(8);
    expect(after.openings).toHaveLength(2);
    expect(new Set(after.walls.map((w) => w.id)).size).toBe(8);
    expect(validateDesign(after)).toEqual([]);
  });

  it("stays valid when inserted many times", () => {
    let design = createEmptyDesign("Plan");
    const shape = bedroomShape();
    for (let i = 0; i < 5; i += 1) {
      design = insertShape(design, shape, { x: i * 200, y: 0 }, { instanceId: `i${i}` });
    }
    expect(design.rooms).toHaveLength(5);
    expect(new Set(design.walls.map((w) => w.id)).size).toBe(20);
    expect(validateDesign(design)).toEqual([]);
  });

  it("round-trips: capture then insert reproduces the geometry, only moved", () => {
    let d = addRoomFromTemplate(createEmptyDesign("Plan"), "bedroom", { x: 60, y: 60 });
    const room = d.rooms[0];
    const capture = captureSelection(d, { kind: "room", id: room.id }, []);
    const shape = { id: "s", name: "Bedroom", ...capture };
    const placed = insertShape(createEmptyDesign("Other"), shape, { x: 60, y: 60 });
    // Same polygon, same wall segments, at the original location.
    expect(placed.rooms[0].polygon).toEqual(room.polygon);
    const seg = (w) => `${w.a.x},${w.a.y}->${w.b.x},${w.b.y}`;
    expect(placed.walls.map(seg).sort()).toEqual(d.walls.map(seg).sort());
  });
});

describe("insertShapeCentered", () => {
  it("centers the shape's bounding box on the point", () => {
    const design = insertShapeCentered(createEmptyDesign("Plan"), bedroomShape(), { x: 500, y: 500 });
    const xs = design.rooms[0].polygon.map((p) => p.x);
    const ys = design.rooms[0].polygon.map((p) => p.y);
    // 144x144 centred on (500,500) spans 428..572.
    expect(Math.min(...xs)).toBe(428);
    expect(Math.max(...xs)).toBe(572);
    expect(Math.min(...ys)).toBe(428);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(500);
  });

  it("refuses a bad shape or point", () => {
    expect(() => insertShapeCentered(createEmptyDesign(), null, { x: 0, y: 0 })).toThrow(CustomShapeError);
    expect(() => insertShapeCentered(createEmptyDesign(), bedroomShape(), null)).toThrow(/valid point/);
  });
});
