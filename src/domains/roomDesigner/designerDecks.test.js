import { describe, expect, it } from "vitest";
import {
  DECK_DEFAULT_DROP_IN,
  addDeck,
  createEmptyDesign,
  deleteDeck,
  setDeckDrop,
} from "./designerDocument";
import { buildThreeScene } from "./designerThreeModel";

describe("decks", () => {
  it("adds a rectangle that defaults to a 4 inch drop below the threshold", () => {
    const design = addDeck(createEmptyDesign("Test"), { x: 0, y: 0 }, { x: 144, y: 96 });
    expect(design.decks).toHaveLength(1);
    expect(design.decks[0].dropIn).toBe(DECK_DEFAULT_DROP_IN);
    expect(DECK_DEFAULT_DROP_IN).toBe(4);
  });

  it("rejects a deck with a side under 12 inches", () => {
    expect(() => addDeck(createEmptyDesign("Test"), { x: 0, y: 0 }, { x: 144, y: 6 })).toThrow(/too small/);
  });

  it("clamps the drop to 0..24 and falls back to the default for non-numbers", () => {
    let design = addDeck(createEmptyDesign("Test"), { x: 0, y: 0 }, { x: 96, y: 96 }, { dropIn: 99 });
    expect(design.decks[0].dropIn).toBe(24);
    design = setDeckDrop(design, design.decks[0].id, -3);
    expect(design.decks[0].dropIn).toBe(0);
    design = setDeckDrop(design, design.decks[0].id, "not a number");
    expect(design.decks[0].dropIn).toBe(DECK_DEFAULT_DROP_IN);
  });

  it("deletes a deck by id", () => {
    const design = addDeck(createEmptyDesign("Test"), { x: 0, y: 0 }, { x: 96, y: 96 });
    expect(deleteDeck(design, design.decks[0].id).decks).toEqual([]);
  });

  it("puts the deck top at minus its drop in the 3D scene", () => {
    const design = addDeck(createEmptyDesign("Test"), { x: 0, y: 0 }, { x: 144, y: 96 }, { dropIn: 4 });
    const scene = buildThreeScene(design);
    expect(scene.decks).toEqual([
      { minX: 0, maxX: 144, minZ: 0, maxZ: 96, topYIn: -4 },
    ]);
  });
});
