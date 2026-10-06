// designerObjectOps.test.js — whole-selection edits: duplicate/paste, flip,
// delete, and move, for a single object, the furniture multi-select, the
// whole house, or a pasted group.

import { describe, expect, it } from "vitest";
import {
  addDeck,
  addOpening,
  addPipeRun,
  addRoomFromTemplate,
  addWall,
  createEmptyDesign,
  placeFurniture,
  placeSymbol,
} from "./designerDocument";
import {
  DUPLICATE_OFFSET_IN,
  copyScope,
  deleteScope,
  flipScope,
  pasteBundle,
  scopeOfSelection,
  translateScope,
} from "./designerObjectOps";

const ALL_KEYS = ["walls", "rooms", "furniture", "symbols", "pipes", "orgCharts", "decks", "annotations"];

function scopeWith(partial) {
  const scope = Object.fromEntries(ALL_KEYS.map((k) => [k, []]));
  return { ...scope, ...partial };
}

/** Copy the scope and paste it offset by (dx, dy); returns the new design and its new scope. */
function duplicate(design, scope, dx = DUPLICATE_OFFSET_IN, dy = DUPLICATE_OFFSET_IN) {
  return pasteBundle(design, copyScope(design, scope), { dx, dy });
}

describe("DUPLICATE_OFFSET_IN", () => {
  it("is a visible but small offset, about one foot", () => {
    expect(DUPLICATE_OFFSET_IN).toBe(12);
  });
});

describe("duplicate (copy + paste)", () => {
  it("places a furniture copy offset from the original and leaves the original alone", () => {
    const design = placeFurniture(createEmptyDesign(), "bed-queen", 100, 100, 30);
    const original = design.furniture[0];
    const { design: next, scope } = duplicate(design, scopeWith({ furniture: [original.id] }));
    expect(next.furniture).toHaveLength(2);
    const copy = next.furniture.find((f) => f.id !== original.id);
    expect(copy).toMatchObject({ catalogId: "bed-queen", x: 112, y: 112, rotationDeg: 30 });
    expect(next.furniture.find((f) => f.id === original.id)).toMatchObject({ x: 100, y: 100 });
    expect(scope.furniture).toEqual([copy.id]);
  });

  it("copies a wall and its openings, and the copy's opening follows the copied wall", () => {
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 120, y: 0 });
    const wallId = design.walls[0].id;
    design = addOpening(design, wallId, { type: "window", offsetIn: 30, widthIn: 36 });
    const { design: next, scope } = duplicate(design, scopeWith({ walls: [wallId] }));
    const copy = next.walls.find((w) => w.id !== wallId);
    expect(copy.a).toEqual({ x: 12, y: 12 });
    expect(copy.b).toEqual({ x: 132, y: 12 });
    expect(next.openings).toHaveLength(2);
    const copiedOpening = next.openings.find((o) => o.wallId === copy.id);
    expect(copiedOpening).toMatchObject({ type: "window", offsetIn: 30, widthIn: 36 });
    expect(scope.walls).toEqual([copy.id]);
  });

  it("copies a room with its four walls, and the copied room points at the copied walls", () => {
    const design = addRoomFromTemplate(createEmptyDesign(), "bedroom", { x: 0, y: 0 });
    const room = design.rooms[0];
    const { design: next } = duplicate(design, scopeWith({ rooms: [room.id], walls: room.wallIds }));
    expect(next.rooms).toHaveLength(2);
    const copy = next.rooms.find((r) => r.id !== room.id);
    expect(copy.polygon[0]).toEqual({ x: DUPLICATE_OFFSET_IN, y: DUPLICATE_OFFSET_IN });
    expect(copy.wallIds).toHaveLength(4);
    for (const wallId of copy.wallIds) {
      expect(next.walls.some((w) => w.id === wallId)).toBe(true);
      expect(room.wallIds).not.toContain(wallId);
    }
  });

  it("copies symbols, and moves a copied deck beside the original when the offset would overlap it", () => {
    let design = placeSymbol(createEmptyDesign(), "processEquipment", "centrifugal-pump", 0, 0, { id: "pump-1" });
    design = addDeck(design, { x: 0, y: 0 }, { x: 120, y: 96 });
    const deck = design.decks[0];
    const { design: next } = duplicate(design, scopeWith({ symbols: ["pump-1"], decks: [deck.id] }));
    expect(next.symbols.find((s) => s.id !== "pump-1")).toMatchObject({ x: DUPLICATE_OFFSET_IN, y: DUPLICATE_OFFSET_IN });
    expect(next.decks).toHaveLength(2);
    const copy = next.decks.find((d) => d.id !== deck.id);
    const overlaps = copy.a.x < deck.b.x && copy.b.x > deck.a.x && copy.a.y < deck.b.y && copy.b.y > deck.a.y;
    expect(overlaps).toBe(false);
    expect(Math.abs(copy.b.x - copy.a.x)).toBe(120);
  });
});

describe("pipe attachments on copy", () => {
  // A pipe end attached to a pump's nozzle must not snap back to the original
  // pump after a copy: it follows the copied pump, or the link is dropped.
  const attached = (symbolId) => ({ start: { symbolId, anchorId: "tube-in" } });

  it("re-points a copied pipe at the copied equipment when both are copied together", () => {
    let design = placeSymbol(createEmptyDesign(), "processEquipment", "centrifugal-pump", 0, 0, { id: "pump-1" });
    design = addPipeRun(design, [{ x: 0, y: 40 }, { x: 60, y: 40 }], { id: "pipe-1" });
    design = { ...design, pipes: design.pipes.map((p) => ({ ...p, attachments: attached("pump-1") })) };
    const { design: next, scope } = duplicate(design, scopeWith({ symbols: ["pump-1"], pipes: ["pipe-1"] }));
    const copyPump = next.symbols.find((s) => s.id !== "pump-1");
    const copyPipe = next.pipes.find((p) => p.id !== "pipe-1");
    expect(scope.pipes).toEqual([copyPipe.id]);
    expect(copyPipe.attachments).toEqual({ start: { symbolId: copyPump.id, anchorId: "tube-in" } });
  });

  it("drops the link when the equipment it was attached to is not part of the copy", () => {
    let design = placeSymbol(createEmptyDesign(), "processEquipment", "centrifugal-pump", 0, 0, { id: "pump-1" });
    design = addPipeRun(design, [{ x: 0, y: 40 }, { x: 60, y: 40 }], { id: "pipe-1" });
    design = { ...design, pipes: design.pipes.map((p) => ({ ...p, attachments: attached("pump-1") })) };
    const { design: next } = duplicate(design, scopeWith({ pipes: ["pipe-1"] }));
    const copyPipe = next.pipes.find((p) => p.id !== "pipe-1");
    expect(copyPipe.attachments).toBeUndefined();
    expect(next.pipes.find((p) => p.id === "pipe-1").attachments).toEqual(attached("pump-1"));
  });
});

describe("flip", () => {
  it("mirrors points across the selection's center for a horizontal flip", () => {
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 100, y: 0 });
    design = placeFurniture(design, "bed-queen", 50, 20, 30);
    const scope = scopeWith({ walls: [design.walls[0].id], furniture: [design.furniture[0].id] });
    const next = flipScope(design, scope, "horizontal");
    // Bounding box x: 0..100, center 50. Wall ends swap sides.
    expect(next.walls[0].a).toEqual({ x: 100, y: 0 });
    expect(next.walls[0].b).toEqual({ x: 0, y: 0 });
    // Piece sits on the axis, so only its angle changes (mirror reverses rotation).
    expect(next.furniture[0]).toMatchObject({ x: 50, y: 20, rotationDeg: 150 });
  });

  it("mirrors points across the selection's center for a vertical flip", () => {
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 100, y: 0 });
    design = placeFurniture(design, "bed-queen", 50, 20, 0);
    const scope = scopeWith({ walls: [design.walls[0].id], furniture: [design.furniture[0].id] });
    const next = flipScope(design, scope, "vertical");
    // Bounding box y: 0..20, center 10.
    expect(next.walls[0].a).toEqual({ x: 0, y: 20 });
    expect(next.walls[0].b).toEqual({ x: 100, y: 20 });
    expect(next.furniture[0]).toMatchObject({ x: 50, y: 0 });
    const rotated = placeFurniture(createEmptyDesign(), "bed-queen", 50, 20, 30);
    const flippedUpDown = flipScope(rotated, scopeWith({ furniture: [rotated.furniture[0].id] }), "vertical");
    expect(flippedUpDown.furniture[0].rotationDeg).toBe(330);
  });

  it("flipping twice restores the original geometry", () => {
    let design = addWall(createEmptyDesign(), { x: 3, y: 7 }, { x: 90, y: 41 });
    design = placeFurniture(design, "bed-queen", 20, 60, 45);
    const scope = scopeWith({ walls: [design.walls[0].id], furniture: [design.furniture[0].id] });
    const twice = flipScope(flipScope(design, scope, "horizontal"), scope, "horizontal");
    expect(twice.walls[0]).toEqual(design.walls[0]);
    expect(twice.furniture[0]).toMatchObject({ x: 20, y: 60, rotationDeg: 45 });
  });

  it("leaves objects outside the selection untouched", () => {
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 100, y: 0 });
    design = addWall(design, { x: 0, y: 200 }, { x: 100, y: 200 });
    const [first, second] = design.walls;
    const next = flipScope(design, scopeWith({ walls: [first.id] }), "vertical");
    expect(next.walls.find((w) => w.id === second.id)).toEqual(second);
  });

  it("keeps openings on their walls, at the same distance from the wall's start", () => {
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 120, y: 0 });
    const wallId = design.walls[0].id;
    design = addOpening(design, wallId, { type: "door", offsetIn: 10, widthIn: 36 });
    const next = flipScope(design, scopeWith({ walls: [wallId] }), "horizontal");
    expect(next.openings[0]).toMatchObject({ wallId, offsetIn: 10, widthIn: 36 });
  });
});

describe("delete", () => {
  it("removes walls with their openings, furniture, and symbols", () => {
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 120, y: 0 });
    const wallId = design.walls[0].id;
    design = addOpening(design, wallId, { type: "window", offsetIn: 10, widthIn: 36 });
    design = placeFurniture(design, "bed-queen", 20, 20, 0);
    design = placeSymbol(design, "processEquipment", "centrifugal-pump", 0, 0, { id: "pump-1" });
    const next = deleteScope(design, scopeWith({
      walls: [wallId],
      furniture: [design.furniture[0].id],
      symbols: ["pump-1"],
    }));
    expect(next.walls).toEqual([]);
    expect(next.openings).toEqual([]);
    expect(next.furniture).toEqual([]);
    expect(next.symbols).toEqual([]);
  });

  it("removes a room together with its four walls", () => {
    const design = addRoomFromTemplate(createEmptyDesign(), "bedroom", { x: 0, y: 0 });
    const room = design.rooms[0];
    const next = deleteScope(design, scopeWith({ rooms: [room.id], walls: room.wallIds }));
    expect(next.rooms).toEqual([]);
    expect(next.walls).toEqual([]);
  });
});

describe("move (translate)", () => {
  it("moves only the scoped objects by the same offset", () => {
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 100, y: 0 });
    design = placeFurniture(design, "bed-queen", 50, 50, 0);
    const next = translateScope(design, scopeWith({ walls: [design.walls[0].id] }), 6, -6);
    expect(next.walls[0]).toMatchObject({ a: { x: 6, y: -6 }, b: { x: 106, y: -6 } });
    expect(next.furniture[0]).toMatchObject({ x: 50, y: 50 });
  });
});

describe("scopeOfSelection", () => {
  it("covers every element for the whole house, without sheets", () => {
    let design = addRoomFromTemplate(createEmptyDesign(), "bedroom", { x: 0, y: 0 });
    design = placeFurniture(design, "bed-queen", 20, 20, 0);
    const scope = scopeOfSelection(design, { kind: "house", id: "house" }, []);
    expect(scope.rooms).toEqual([design.rooms[0].id]);
    expect(scope.walls).toHaveLength(4);
    expect(scope.furniture).toHaveLength(1);
    expect(scope).not.toHaveProperty("sheets");
  });

  it("includes a room's own walls when the room is selected", () => {
    const design = addRoomFromTemplate(createEmptyDesign(), "bedroom", { x: 0, y: 0 });
    const scope = scopeOfSelection(design, { kind: "room", id: design.rooms[0].id }, []);
    expect(scope.walls).toEqual(design.rooms[0].wallIds);
  });

  it("covers the furniture multi-select", () => {
    let design = placeFurniture(createEmptyDesign(), "bed-queen", 0, 0, 0);
    design = placeFurniture(design, "toilet", 50, 50, 0);
    const multi = design.furniture.map((f) => ({ kind: "furniture", id: f.id }));
    const scope = scopeOfSelection(design, null, multi);
    expect(scope.furniture).toHaveLength(2);
  });

  it("returns null for openings, sheets, nothing selected, or a deleted object", () => {
    const design = createEmptyDesign();
    expect(scopeOfSelection(design, null, [])).toBeNull();
    expect(scopeOfSelection(design, { kind: "opening", id: "opening_1" }, [])).toBeNull();
    expect(scopeOfSelection(design, { kind: "sheet", id: "sheet_1" }, [])).toBeNull();
    expect(scopeOfSelection(design, { kind: "wall", id: "gone" }, [])).toBeNull();
  });
});
