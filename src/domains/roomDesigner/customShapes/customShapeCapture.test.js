// customShapeCapture.test.js — a selection becomes a reusable shape.
//
// The contract that matters: capture follows the document's OWNERSHIP edges
// (a room brings its walls, their openings and the furniture standing in it),
// and the result is position-independent — a shape has no location, only a
// size.

import { describe, expect, it, beforeEach } from "vitest";
import {
  captureBounds,
  captureSelection,
  collectSelectedEntities,
  countEntities,
  normalizeToOrigin,
} from "./customShapeCapture";
import { CustomShapeError, MAX_SHAPE_ENTITIES } from "./customShapeErrors";
import {
  addOpening,
  addRoomFromTemplate,
  addWall,
  createEmptyDesign,
  placeFurniture,
  placeSymbol,
  addPipeRun,
  resetDesignerIds,
} from "../designerDocument";

beforeEach(() => {
  resetDesignerIds();
});

/** A 12x12 bedroom at (60,60) with a door and a bed inside it. */
function designWithFurnishedRoom() {
  let d = addRoomFromTemplate(createEmptyDesign("Plan"), "bedroom", { x: 60, y: 60 });
  const room = d.rooms[0];
  d = addOpening(d, room.wallIds[0], { type: "door", offsetIn: 24, widthIn: 36 });
  d = placeFurniture(d, "bed-queen", 120, 120); // inside the room
  d = placeFurniture(d, "sofa-3seat", 600, 600); // far outside it
  return d;
}

describe("collectSelectedEntities", () => {
  it("brings a room's walls, their openings and the furniture inside it", () => {
    const d = designWithFurnishedRoom();
    const room = d.rooms[0];
    const captured = collectSelectedEntities(d, { kind: "room", id: room.id }, []);
    expect(captured.rooms).toHaveLength(1);
    expect(captured.walls).toHaveLength(4);
    expect(captured.openings).toHaveLength(1);
    // The bed inside travels; the sofa outside does not.
    expect(captured.furniture.map((f) => f.catalogId)).toEqual(["bed-queen"]);
  });

  it("brings a wall's openings with it", () => {
    let d = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 120, y: 0 }, { id: "w1" });
    d = addOpening(d, "w1", { type: "window", offsetIn: 20, widthIn: 40 });
    const captured = collectSelectedEntities(d, { kind: "wall", id: "w1" }, []);
    expect(captured.walls).toHaveLength(1);
    expect(captured.openings).toHaveLength(1);
    expect(captured.openings[0].wallId).toBe("w1");
  });

  it("captures a single furniture piece", () => {
    const d = placeFurniture(createEmptyDesign(), "desk", 40, 40);
    const piece = d.furniture[0];
    const captured = collectSelectedEntities(d, { kind: "furniture", id: piece.id }, []);
    expect(captured.furniture).toEqual([piece]);
  });

  it("captures every multi-selected piece, ignoring the single selection", () => {
    let d = placeFurniture(createEmptyDesign(), "desk", 40, 40);
    d = placeFurniture(d, "office-chair", 60, 60);
    const [a, b] = d.furniture;
    const captured = collectSelectedEntities(
      d,
      { kind: "wall", id: "ignored" },
      [{ kind: "furniture", id: a.id }, { kind: "furniture", id: b.id }],
    );
    expect(captured.furniture.map((f) => f.id).sort()).toEqual([a.id, b.id].sort());
    expect(captured.walls).toEqual([]);
  });

  it("captures a symbol and a pipe run", () => {
    let d = placeSymbol(createEmptyDesign(), "piping", "gate-valve", 10, 10);
    const symbol = d.symbols[0];
    expect(collectSelectedEntities(d, { kind: "symbol", id: symbol.id }, []).symbols).toHaveLength(1);

    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 60, y: 0 }], { diameterIn: 2, layer: "piping" });
    const run = d.pipes[0];
    expect(collectSelectedEntities(d, { kind: "pipe", id: run.id }, []).pipes).toHaveLength(1);
  });

  it("refuses an opening, which cannot stand on its own", () => {
    const d = designWithFurnishedRoom();
    const opening = d.openings[0];
    expect(() => collectSelectedEntities(d, { kind: "opening", id: opening.id }, []))
      .toThrow(/hole in a wall/);
  });

  it("refuses when nothing is selected", () => {
    expect(() => collectSelectedEntities(createEmptyDesign(), null, []))
      .toThrow(/Select something/);
  });

  it("refuses a kind that cannot be a shape", () => {
    expect(() => collectSelectedEntities(createEmptyDesign(), { kind: "sheet", id: "s1" }, []))
      .toThrow(/cannot be saved as a shape/);
  });

  it("reports an entity that has since been deleted", () => {
    expect(() => collectSelectedEntities(createEmptyDesign(), { kind: "wall", id: "gone" }, []))
      .toThrow(/no longer in the design/);
  });
});

describe("normalizeToOrigin", () => {
  it("moves the captured geometry's bounding box to (0,0)", () => {
    const entities = {
      walls: [{ id: "w", a: { x: 100, y: 200 }, b: { x: 220, y: 200 } }],
      rooms: [], openings: [], furniture: [], pipes: [], symbols: [],
    };
    const { entities: moved, bounds } = normalizeToOrigin(entities);
    expect(moved.walls[0].a).toEqual({ x: 0, y: 0 });
    expect(moved.walls[0].b).toEqual({ x: 120, y: 0 });
    expect(bounds).toEqual({ widthIn: 120, heightIn: 0 });
  });

  it("moves every entity kind by the same offset", () => {
    const entities = {
      walls: [{ id: "w", a: { x: 10, y: 10 }, b: { x: 20, y: 10 } }],
      rooms: [{ id: "r", polygon: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }],
      openings: [{ id: "o", wallId: "w", offsetIn: 2, widthIn: 3 }],
      furniture: [{ id: "f", x: 15, y: 15 }],
      pipes: [{ id: "p", points: [{ x: 10, y: 20 }] }],
      symbols: [{ id: "s", x: 20, y: 10 }],
    };
    const { entities: moved } = normalizeToOrigin(entities);
    expect(moved.walls[0].a).toEqual({ x: 0, y: 0 });
    expect(moved.rooms[0].polygon[1]).toEqual({ x: 10, y: 10 });
    expect(moved.furniture[0]).toMatchObject({ x: 5, y: 5 });
    expect(moved.pipes[0].points[0]).toEqual({ x: 0, y: 10 });
    expect(moved.symbols[0]).toMatchObject({ x: 10, y: 0 });
    // Openings are offsets along a wall, not points — untouched.
    expect(moved.openings[0]).toEqual({ id: "o", wallId: "w", offsetIn: 2, widthIn: 3 });
  });

  it("does not mutate the input", () => {
    const entities = {
      walls: [{ id: "w", a: { x: 5, y: 5 }, b: { x: 15, y: 5 } }],
      rooms: [], openings: [], furniture: [], pipes: [], symbols: [],
    };
    const snapshot = JSON.stringify(entities);
    normalizeToOrigin(entities);
    expect(JSON.stringify(entities)).toBe(snapshot);
  });

  it("handles a set with no geometry", () => {
    const empty = { walls: [], rooms: [], openings: [], furniture: [], pipes: [], symbols: [] };
    expect(normalizeToOrigin(empty).bounds).toBeNull();
    expect(captureBounds(empty)).toBeNull();
  });
});

describe("captureSelection", () => {
  it("returns position-independent entities, bounds and counts", () => {
    const d = designWithFurnishedRoom();
    const capture = captureSelection(d, { kind: "room", id: d.rooms[0].id }, []);
    // A 12x12 bedroom, wherever it was standing.
    expect(capture.bounds).toEqual({ widthIn: 144, heightIn: 144 });
    expect(capture.counts).toMatchObject({ rooms: 1, walls: 4, openings: 1, furniture: 1 });
    expect(capture.counts.total).toBe(7);
    // Normalized: nothing remembers it used to be at (60,60).
    const xs = capture.entities.rooms[0].polygon.map((p) => p.x);
    expect(Math.min(...xs)).toBe(0);
  });

  it("captures the same shape regardless of where the original stood", () => {
    const here = captureSelection(
      addRoomFromTemplate(createEmptyDesign(), "bedroom", { x: 0, y: 0 }),
      { kind: "room", id: "room_5" }, [],
    );
    resetDesignerIds();
    const there = captureSelection(
      addRoomFromTemplate(createEmptyDesign(), "bedroom", { x: 900, y: -400 }),
      { kind: "room", id: "room_5" }, [],
    );
    expect(there.entities.rooms[0].polygon).toEqual(here.entities.rooms[0].polygon);
    expect(there.bounds).toEqual(here.bounds);
  });

  it("refuses an empty selection", () => {
    const d = createEmptyDesign();
    expect(() => captureSelection(d, { kind: "furniture", id: "gone" }, []))
      .toThrow(CustomShapeError);
  });

  it("refuses a selection larger than one shape may hold", () => {
    // Multi-select is furniture-only, so drive the cap with furniture.
    let design = createEmptyDesign();
    const multi = [];
    for (let i = 0; i <= MAX_SHAPE_ENTITIES; i += 1) {
      design = placeFurniture(design, "desk", i, 0);
      multi.push({ kind: "furniture", id: design.furniture[design.furniture.length - 1].id });
    }
    expect(multi.length).toBe(MAX_SHAPE_ENTITIES + 1);
    expect(() => captureSelection(design, null, multi)).toThrow(/more than the 2000/);
  });

  it("accepts a selection exactly at the cap", () => {
    let design = createEmptyDesign();
    const multi = [];
    for (let i = 0; i < MAX_SHAPE_ENTITIES; i += 1) {
      design = placeFurniture(design, "desk", i, 0);
      multi.push({ kind: "furniture", id: design.furniture[design.furniture.length - 1].id });
    }
    expect(captureSelection(design, null, multi).counts.total).toBe(MAX_SHAPE_ENTITIES);
  });
});
