// designerDocumentMoveWall.test.js — rigid whole-wall translation.
//
// The user-facing bug: click-hold-drag on a wall body did nothing, because
// only endpoint handles had a drag. moveWall is the domain half of the fix.
//
// The contract that matters: BOTH endpoints move by the same delta (so length
// and angle are preserved exactly), and openings ride along for free because
// they are stored as an offset ALONG the wall, not as absolute points. That
// second property is the reason no opening arithmetic appears in moveWall, so
// it is asserted here rather than assumed.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addOpening,
  addWall,
  createEmptyDesign,
  findWall,
  moveWall,
  resetDesignerIds,
  validateDesign,
} from "./designerDocument";
import { wallLength } from "./designerGeometry";

beforeEach(() => {
  resetDesignerIds();
});

/** A 10-foot horizontal wall with a 3-foot door 2 feet along it. */
function wallWithDoor() {
  let design = createEmptyDesign("Plan");
  design = addWall(design, { x: 0, y: 0 }, { x: 120, y: 0 }, { id: "w1" });
  design = addOpening(design, "w1", { type: "door", offsetIn: 24, widthIn: 36 });
  return design;
}

describe("moveWall", () => {
  it("translates both endpoints by the same delta", () => {
    const design = wallWithDoor();
    const moved = moveWall(design, "w1", 15, -25);
    const wall = findWall(moved, "w1");
    expect(wall.a).toEqual({ x: 15, y: -25 });
    expect(wall.b).toEqual({ x: 135, y: -25 });
  });

  it("preserves length and angle exactly, including for a diagonal wall", () => {
    let design = createEmptyDesign("Plan");
    design = addWall(design, { x: 10, y: 10 }, { x: 70, y: 90 }, { id: "diag" });
    const before = findWall(design, "diag");
    const moved = findWall(moveWall(design, "diag", -33.5, 12.25), "diag");
    expect(wallLength(moved)).toBeCloseTo(wallLength(before), 12);
    const angle = (w) => Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
    expect(angle(moved)).toBeCloseTo(angle(before), 12);
    // The vector between endpoints is untouched.
    expect(moved.b.x - moved.a.x).toBeCloseTo(before.b.x - before.a.x, 12);
    expect(moved.b.y - moved.a.y).toBeCloseTo(before.b.y - before.a.y, 12);
  });

  it("carries openings along, at the same offset and width", () => {
    const design = wallWithDoor();
    const opening = design.openings[0];
    const moved = moveWall(design, "w1", 40, 60);
    const movedOpening = moved.openings[0];
    // The record itself is untouched — no opening arithmetic happens.
    expect(movedOpening).toEqual(opening);
    expect(movedOpening.wallId).toBe("w1");
    expect(movedOpening.offsetIn).toBe(24);
    expect(movedOpening.widthIn).toBe(36);
  });

  it("puts the opening's real endpoints in the wall's new position", () => {
    // The absolute span an offset-along-the-wall opening resolves to. This is
    // what the canvas draws, so it is what proves the door rode along.
    const span = (opening, walls) => {
      const wall = walls.find((w) => w.id === opening.wallId);
      const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
      const ux = (wall.b.x - wall.a.x) / length;
      const uy = (wall.b.y - wall.a.y) / length;
      return {
        g1: { x: wall.a.x + ux * opening.offsetIn, y: wall.a.y + uy * opening.offsetIn },
        g2: {
          x: wall.a.x + ux * (opening.offsetIn + opening.widthIn),
          y: wall.a.y + uy * (opening.offsetIn + opening.widthIn),
        },
      };
    };
    const design = wallWithDoor();
    const before = span(design.openings[0], design.walls);
    const moved = moveWall(design, "w1", 40, 60);
    const after = span(moved.openings[0], moved.walls);
    // Absolute position shifted by exactly the delta...
    expect(after.g1.x).toBeCloseTo(before.g1.x + 40, 9);
    expect(after.g1.y).toBeCloseTo(before.g1.y + 60, 9);
    expect(after.g2.x).toBeCloseTo(before.g2.x + 40, 9);
    expect(after.g2.y).toBeCloseTo(before.g2.y + 60, 9);
    // ...and the door is still the same size, still on its wall.
    expect(Math.hypot(after.g2.x - after.g1.x, after.g2.y - after.g1.y)).toBeCloseTo(36, 9);
  });

  it("leaves the moved design valid, openings still attached", () => {
    const moved = moveWall(wallWithDoor(), "w1", -200, -200);
    expect(validateDesign(moved)).toEqual([]);
  });

  it("returns the design unchanged for an unknown wall id", () => {
    const design = wallWithDoor();
    expect(moveWall(design, "nope", 10, 10)).toBe(design);
  });

  it("does not mutate the input design", () => {
    const design = wallWithDoor();
    const snapshot = JSON.stringify(design);
    moveWall(design, "w1", 10, 10);
    expect(JSON.stringify(design)).toBe(snapshot);
  });

  it("leaves other walls untouched", () => {
    let design = wallWithDoor();
    design = addWall(design, { x: 0, y: 50 }, { x: 60, y: 50 }, { id: "other" });
    const moved = moveWall(design, "w1", 7, 7);
    expect(findWall(moved, "other")).toEqual(findWall(design, "other"));
  });

  it("is a no-op for a zero delta but still returns a new design object", () => {
    const design = wallWithDoor();
    const moved = moveWall(design, "w1", 0, 0);
    expect(moved).not.toBe(design);
    expect(findWall(moved, "w1")).toEqual(findWall(design, "w1"));
  });

  it("composes: successive moves add up", () => {
    let design = wallWithDoor();
    design = moveWall(design, "w1", 10, 5);
    design = moveWall(design, "w1", -4, 20);
    expect(findWall(design, "w1").a).toEqual({ x: 6, y: 25 });
  });

  it("rejects a non-finite delta rather than corrupting geometry", () => {
    const design = wallWithDoor();
    expect(() => moveWall(design, "w1", NaN, 0)).toThrow(/finite/);
    expect(() => moveWall(design, "w1", 0, Infinity)).toThrow(/finite/);
    expect(() => moveWall(design, "w1", undefined, 0)).toThrow(/finite/);
  });

  it("refuses a non-designer document", () => {
    expect(() => moveWall({}, "w1", 1, 1)).toThrow(/room-designer document/);
  });
});
