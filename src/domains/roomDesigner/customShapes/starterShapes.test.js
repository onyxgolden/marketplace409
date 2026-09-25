// starterShapes.test.js — the ready-made favorites every library starts with.

import { describe, expect, it } from "vitest";
import { createEmptyDesign, validateDesign } from "../designerDocument";
import { insertShapeCentered } from "./customShapeInstantiate";
import {
  addShape,
  createEmptyLibrary,
  favoriteShapes,
  removeShape,
  setShapeFavorite,
} from "./customShapeLibrary";
import { MAX_LIBRARY_SIZE } from "./customShapeErrors";
import { loadLibrary, saveLibrary } from "./customShapeStorage";
import { STARTER_ID_PREFIX, buildStarterShapes, seedStarterFavorites } from "./starterShapes";

const capture = () => ({
  entities: {
    walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } }],
    rooms: [], openings: [], furniture: [], pipes: [], symbols: [],
  },
  bounds: { widthIn: 120, heightIn: 0 },
  counts: { walls: 1, rooms: 0, openings: 0, furniture: 0, pipes: 0, symbols: 0, total: 1 },
});

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

describe("buildStarterShapes", () => {
  const starters = buildStarterShapes();

  it("ships 8-10 uniquely named, starred starters with stable ids", () => {
    expect(starters.length).toBeGreaterThanOrEqual(8);
    expect(starters.length).toBeLessThanOrEqual(10);
    expect(new Set(starters.map((s) => s.name)).size).toBe(starters.length);
    for (const s of starters) {
      expect(s.id.startsWith(STARTER_ID_PREFIX)).toBe(true);
      expect(s.favorite).toBe(true);
      expect(s.counts.total).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    expect(buildStarterShapes()).toEqual(starters);
  });

  it.each(buildStarterShapes().map((s) => [s.name, s]))("%s places into a design that validates", (_name, shape) => {
    const placed = insertShapeCentered(createEmptyDesign("Plan"), shape, { x: 240, y: 240 });
    expect(validateDesign(placed)).toEqual([]);
    const total = ["walls", "rooms", "openings", "furniture"].reduce((n, k) => n + placed[k].length, 0);
    expect(total).toBe(shape.counts.total);
  });

  it("walled starters carry their room, four walls and a door", () => {
    for (const s of starters.filter((x) => x.entities.rooms.length > 0)) {
      expect(s.entities.walls).toHaveLength(4);
      expect(s.entities.openings.filter((o) => o.type === "door")).toHaveLength(1);
      expect(s.entities.furniture.length).toBeGreaterThan(0);
    }
  });
});

describe("seedStarterFavorites", () => {
  it("adds every starter to Favorites, after the user's own favorites", () => {
    let library = addShape(createEmptyLibrary(), capture(), "My porch");
    library = setShapeFavorite(library, library.shapes[0].id, true);
    const seeded = seedStarterFavorites(library);
    const favs = favoriteShapes(seeded);
    expect(favs[0].name).toBe("My porch");
    expect(favs).toHaveLength(1 + buildStarterShapes().length);
    expect(seeded.starterSeeded).toBe(true);
  });

  it("runs once: a deleted starter is not re-added on the next load", () => {
    const seeded = seedStarterFavorites(createEmptyLibrary());
    const trimmed = removeShape(seeded, seeded.shapes[0].id);
    const storage = memoryStorage();
    saveLibrary(trimmed, storage, "u1");
    const reloaded = seedStarterFavorites(loadLibrary(storage, "u1"));
    expect(reloaded.shapes).toHaveLength(seeded.shapes.length - 1);
  });

  it("skips a starter whose name the user already uses", () => {
    const [first] = buildStarterShapes();
    const library = addShape(createEmptyLibrary(), capture(), first.name.toUpperCase());
    const seeded = seedStarterFavorites(library);
    expect(seeded.shapes.filter((s) => s.name.toLowerCase() === first.name.toLowerCase())).toHaveLength(1);
  });

  it("never pushes the library past its size limit", () => {
    let library = createEmptyLibrary();
    for (let i = 0; i < MAX_LIBRARY_SIZE - 2; i += 1) library = addShape(library, capture(), `Shape ${i}`);
    expect(seedStarterFavorites(library).shapes).toHaveLength(MAX_LIBRARY_SIZE);
  });
});
