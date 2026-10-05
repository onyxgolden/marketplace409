import { describe, expect, it } from "vitest";
import {
  DECK_DEFAULT_DROP_IN,
  DECK_MATERIALS,
  addDeck,
  createEmptyDesign,
  deleteDeck,
  setDeckDrop,
  setDeckMaterial,
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
      { minX: 0, maxX: 144, minZ: 0, maxZ: 96, topYIn: -4, thicknessIn: 5.5, color: "#a0744a" },
    ]);
  });

  it("defaults to a wood platform and lets the material change to a concrete pad", () => {
    let design = addDeck(createEmptyDesign("Test"), { x: 0, y: 0 }, { x: 96, y: 96 });
    expect(design.decks[0].material).toBe("wood");
    design = setDeckMaterial(design, design.decks[0].id, "concrete");
    expect(design.decks[0].material).toBe("concrete");
    const scene = buildThreeScene(design);
    expect(scene.decks[0].thicknessIn).toBe(4);
    expect(scene.decks[0].color).toBe(DECK_MATERIALS.concrete.color);
  });

  it("falls back to wood for an unknown material", () => {
    let design = addDeck(createEmptyDesign("Test"), { x: 0, y: 0 }, { x: 96, y: 96 }, { material: "gravel" });
    expect(design.decks[0].material).toBe("wood");
    design = setDeckMaterial(design, design.decks[0].id, "tile");
    expect(design.decks[0].material).toBe("wood");
  });
});
