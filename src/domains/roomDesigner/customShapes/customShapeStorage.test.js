// customShapeStorage.test.js — local persistence.
//
// Follows the Designer's established defensive-read pattern: any corrupt or
// unexpected stored value degrades to an empty library rather than throwing,
// and a single bad shape never poisons the rest.

import { describe, expect, it } from "vitest";
import {
  SHAPE_LIBRARY_STORAGE_KEY,
  loadLibrary,
  parseLibrary,
  saveLibrary,
} from "./customShapeStorage";
import { addShape, createEmptyLibrary, setShapeFavorite } from "./customShapeLibrary";

/** An in-memory stand-in for localStorage. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  };
}

const capture = () => ({
  entities: {
    walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } }],
    rooms: [], openings: [], furniture: [], pipes: [], symbols: [],
  },
  bounds: { widthIn: 120, heightIn: 0 },
  counts: { walls: 1, total: 1 },
});

describe("round trip", () => {
  it("saves and reloads a library unchanged", () => {
    let library = addShape(createEmptyLibrary(), capture(), "Bay window", { now: 1000 });
    library = setShapeFavorite(library, library.shapes[0].id, true, { now: 2000 });
    const storage = fakeStorage();
    expect(saveLibrary(library, storage)).toBe(true);
    const loaded = loadLibrary(storage);
    expect(loaded.shapes).toHaveLength(1);
    expect(loaded.shapes[0].name).toBe("Bay window");
    expect(loaded.shapes[0].favorite).toBe(true);
    expect(loaded.shapes[0].entities.walls[0].b).toEqual({ x: 120, y: 0 });
  });

  it("uses a versioned key", () => {
    expect(SHAPE_LIBRARY_STORAGE_KEY).toMatch(/\.v1$/);
    const storage = fakeStorage();
    saveLibrary(createEmptyLibrary(), storage);
    expect(storage._map.has(SHAPE_LIBRARY_STORAGE_KEY)).toBe(true);
  });

  it("keeps favorites across a reload — the point of persisting them", () => {
    let library = addShape(createEmptyLibrary(), capture(), "One");
    library = addShape(library, capture(), "Two");
    library = setShapeFavorite(library, library.shapes[1].id, true);
    const storage = fakeStorage();
    saveLibrary(library, storage);
    const loaded = loadLibrary(storage);
    expect(loaded.shapes.filter((s) => s.favorite).map((s) => s.name)).toEqual(["Two"]);
  });
});

describe("parseLibrary — corrupt input degrades, never throws", () => {
  it("returns an empty library for missing or non-JSON data", () => {
    for (const raw of [null, undefined, "", "not-json{{{", "[1,2,3]", '"a string"', "42"]) {
      expect(parseLibrary(raw).shapes, String(raw)).toEqual([]);
    }
  });

  it("returns an empty library for a wrong version", () => {
    expect(parseLibrary(JSON.stringify({ version: 99, shapes: [{ id: "a" }] })).shapes).toEqual([]);
  });

  it("returns an empty library when shapes is not an array", () => {
    expect(parseLibrary(JSON.stringify({ version: 1, shapes: {} })).shapes).toEqual([]);
  });

  it("drops individual unusable shapes but keeps the good ones", () => {
    const raw = JSON.stringify({
      version: 1,
      shapes: [
        null,
        { id: "", name: "no id", entities: {} },
        { id: "a", name: "", entities: {} },
        { id: "b", name: "No entities" },
        { id: "c", name: "Good", entities: { walls: [] } },
        { id: "d", name: "Bad bucket", entities: { walls: "nope" } },
      ],
    });
    expect(parseLibrary(raw).shapes.map((s) => s.name)).toEqual(["Good"]);
  });

  it("drops duplicate ids, keeping the first", () => {
    const raw = JSON.stringify({
      version: 1,
      shapes: [
        { id: "a", name: "First", entities: { walls: [] } },
        { id: "a", name: "Second", entities: { walls: [] } },
      ],
    });
    expect(parseLibrary(raw).shapes.map((s) => s.name)).toEqual(["First"]);
  });

  it("fills in buckets and fields a hand-edited record left out", () => {
    const raw = JSON.stringify({
      version: 1,
      shapes: [{ id: "a", name: "  Patchy  ", entities: { walls: [{ id: "w" }] } }],
    });
    const [shape] = parseLibrary(raw).shapes;
    expect(shape.name).toBe("Patchy");
    expect(shape.entities.rooms).toEqual([]);
    expect(shape.entities.symbols).toEqual([]);
    expect(shape.bounds).toEqual({ widthIn: 0, heightIn: 0 });
    expect(shape.favorite).toBe(false);
    expect(shape.counts.total).toBe(1);
  });

  it("treats a non-boolean favorite as not favorited", () => {
    const raw = JSON.stringify({
      version: 1,
      shapes: [{ id: "a", name: "A", favorite: "yes", entities: { walls: [] } }],
    });
    expect(parseLibrary(raw).shapes[0].favorite).toBe(false);
  });
});

describe("storage failures", () => {
  it("reports a write that storage refused, without throwing", () => {
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveLibrary(createEmptyLibrary(), refusing)).toBe(false);
  });

  it("returns an empty library when reading throws", () => {
    const refusing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(loadLibrary(refusing).shapes).toEqual([]);
  });

  it("works with no storage at all (SSR)", () => {
    expect(loadLibrary(null).shapes).toEqual([]);
    expect(saveLibrary(createEmptyLibrary(), null)).toBe(false);
  });
});
