import { describe, expect, it } from "vitest";
import {
  addDeck,
  addOpening,
  addWall,
  createEmptyDesign,
  translateHouse,
} from "./designerDocument";

const lengthOf = (w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

function sampleHouse() {
  let d = createEmptyDesign("Test");
  d = addWall(d, { x: 0, y: 0 }, { x: 240, y: 0 });
  d = addWall(d, { x: 240, y: 0 }, { x: 240, y: 180 });
  d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 60 });
  d = addDeck(d, { x: 240, y: 0 }, { x: 336, y: 96 });
  return d;
}

describe("translateHouse", () => {
  it("moves every wall by the same offset and keeps each wall's length", () => {
    const before = sampleHouse();
    const after = translateHouse(before, 120, -48);
    before.walls.forEach((w, i) => {
      expect(after.walls[i].a).toEqual({ x: w.a.x + 120, y: w.a.y - 48 });
      expect(after.walls[i].b).toEqual({ x: w.b.x + 120, y: w.b.y - 48 });
      expect(lengthOf(after.walls[i])).toBeCloseTo(lengthOf(w));
    });
  });

  it("moves the deck with the house", () => {
    const before = sampleHouse();
    const after = translateHouse(before, 10, 20);
    expect(after.decks[0].a).toEqual({ x: 250, y: 20 });
    expect(after.decks[0].b).toEqual({ x: 346, y: 116 });
  });

  it("moves annotation points, which carry legacy stair geometry", () => {
    const before = { ...sampleHouse(), annotations: [{ id: "ann_1", kind: "path", closed: true, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }] }] };
    const after = translateHouse(before, 5, 7);
    expect(after.annotations[0].points).toEqual([{ x: 15, y: 17 }, { x: 45, y: 17 }]);
  });

  it("leaves openings untouched because they ride their walls", () => {
    const before = sampleHouse();
    const after = translateHouse(before, 50, 50);
    expect(after.openings).toEqual(before.openings);
  });

  it("does not change the input design", () => {
    const before = sampleHouse();
    const snapshot = JSON.parse(JSON.stringify(before));
    translateHouse(before, 30, 30);
    expect(before).toEqual(snapshot);
  });
});
