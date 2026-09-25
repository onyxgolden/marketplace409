// customShapeLibrary.test.js — save / rename / delete / favorite.

import { describe, expect, it } from "vitest";
import {
  addShape,
  createEmptyLibrary,
  favoriteShapes,
  findShape,
  listShapesForDisplay,
  moveFavorite,
  orderedFavoriteIds,
  removeShape,
  renameShape,
  setShapeFavorite,
  toggleShapeFavorite,
} from "./customShapeLibrary";
import { CustomShapeError, MAX_LIBRARY_SIZE, MAX_SHAPE_NAME_LENGTH } from "./customShapeErrors";

const capture = (overrides = {}) => ({
  entities: {
    walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } }],
    rooms: [], openings: [], furniture: [], pipes: [], symbols: [],
  },
  bounds: { widthIn: 120, heightIn: 0 },
  counts: { walls: 1, rooms: 0, openings: 0, furniture: 0, pipes: 0, symbols: 0, total: 1 },
  ...overrides,
});

const withShape = (name = "Bay window", now = 1000) =>
  addShape(createEmptyLibrary(), capture(), name, { now });

describe("addShape", () => {
  it("saves a named shape with its geometry, bounds and counts", () => {
    const library = withShape("Bay window");
    expect(library.shapes).toHaveLength(1);
    const [shape] = library.shapes;
    expect(shape.name).toBe("Bay window");
    expect(shape.bounds).toEqual({ widthIn: 120, heightIn: 0 });
    expect(shape.counts.total).toBe(1);
    expect(shape.entities.walls).toHaveLength(1);
    expect(shape.favorite).toBe(false);
    expect(shape.createdAt).toBe(1000);
  });

  it("normalizes the name and requires one", () => {
    expect(withShape("  Bay   window  ").shapes[0].name).toBe("Bay window");
    expect(() => withShape("")).toThrow(/name/);
    expect(() => withShape("   ")).toThrow(/name/);
    expect(() => addShape(createEmptyLibrary(), capture(), null)).toThrow(/name/);
  });

  it("caps an over-long name", () => {
    const shape = withShape("x".repeat(200)).shapes[0];
    expect(shape.name).toHaveLength(MAX_SHAPE_NAME_LENGTH);
  });

  it("refuses a duplicate name, case-insensitively", () => {
    const library = withShape("Bay window");
    expect(() => addShape(library, capture(), "bay WINDOW")).toThrow(/already have a shape/);
  });

  it("deep-copies the captured geometry so later edits cannot reach into it", () => {
    const source = capture();
    const library = addShape(createEmptyLibrary(), source, "Bay window");
    source.entities.walls[0].a.x = 999;
    expect(library.shapes[0].entities.walls[0].a.x).toBe(0);
  });

  it("does not mutate the library it is given", () => {
    const library = createEmptyLibrary();
    addShape(library, capture(), "Bay window");
    expect(library.shapes).toHaveLength(0);
  });

  it("gives each shape a distinct id", () => {
    let library = withShape("One");
    library = addShape(library, capture(), "Two");
    library = addShape(library, capture(), "Three");
    expect(new Set(library.shapes.map((s) => s.id)).size).toBe(3);
  });

  it("refuses once the library is full", () => {
    let library = createEmptyLibrary();
    for (let i = 0; i < MAX_LIBRARY_SIZE; i += 1) {
      library = addShape(library, capture(), `Shape ${i}`);
    }
    expect(() => addShape(library, capture(), "One too many")).toThrow(/library is full/);
  });

  it("refuses a bad library or an empty capture", () => {
    expect(() => addShape(null, capture(), "x")).toThrow(CustomShapeError);
    expect(() => addShape({ version: 99, shapes: [] }, capture(), "x")).toThrow(/bad version/);
    expect(() => addShape(createEmptyLibrary(), null, "x")).toThrow(/nothing captured/);
  });
});

describe("renameShape", () => {
  it("renames and stamps updatedAt", () => {
    const library = renameShape(withShape("Bay window", 1000), "shape-x", "Nope");
    // Unknown id is a no-op...
    expect(library.shapes[0].name).toBe("Bay window");

    const original = withShape("Bay window", 1000);
    const renamed = renameShape(original, original.shapes[0].id, "  Bow  window ", { now: 2000 });
    expect(renamed.shapes[0].name).toBe("Bow window");
    expect(renamed.shapes[0].updatedAt).toBe(2000);
    expect(renamed.shapes[0].createdAt).toBe(1000);
  });

  it("refuses a blank or duplicate name", () => {
    let library = withShape("Bay window");
    library = addShape(library, capture(), "Dormer");
    const id = library.shapes[0].id;
    expect(() => renameShape(library, id, "  ")).toThrow(/needs a name/);
    expect(() => renameShape(library, id, "dormer")).toThrow(/already have a shape/);
    // Renaming a shape to its own name is fine.
    expect(renameShape(library, id, "Bay window").shapes[0].name).toBe("Bay window");
  });
});

describe("removeShape", () => {
  it("removes by id and ignores an unknown one", () => {
    const library = withShape("Bay window");
    const id = library.shapes[0].id;
    expect(removeShape(library, id).shapes).toHaveLength(0);
    expect(removeShape(library, "nope")).toBe(library);
  });
});

describe("favorites", () => {
  it("stars and unstars a shape", () => {
    const library = withShape("Bay window", 1000);
    const id = library.shapes[0].id;
    const starred = setShapeFavorite(library, id, true, { now: 2000 });
    expect(findShape(starred, id).favorite).toBe(true);
    expect(findShape(starred, id).updatedAt).toBe(2000);
    expect(findShape(setShapeFavorite(starred, id, false), id).favorite).toBe(false);
  });

  it("toggles", () => {
    const library = withShape("Bay window");
    const id = library.shapes[0].id;
    expect(findShape(toggleShapeFavorite(library, id), id).favorite).toBe(true);
    expect(findShape(toggleShapeFavorite(toggleShapeFavorite(library, id), id), id).favorite).toBe(false);
  });

  it("is a no-op when the state already matches, so no needless updatedAt churn", () => {
    const library = withShape("Bay window");
    const id = library.shapes[0].id;
    expect(setShapeFavorite(library, id, false)).toBe(library);
  });

  it("ignores an unknown id", () => {
    const library = withShape("Bay window");
    expect(setShapeFavorite(library, "nope", true)).toBe(library);
    expect(toggleShapeFavorite(library, "nope")).toBe(library);
  });

  it("lists favorites", () => {
    let library = withShape("Bay window");
    library = addShape(library, capture(), "Dormer");
    library = setShapeFavorite(library, library.shapes[1].id, true);
    expect(favoriteShapes(library).map((s) => s.name)).toEqual(["Dormer"]);
  });

  it("does not mutate the library", () => {
    const library = withShape("Bay window");
    setShapeFavorite(library, library.shapes[0].id, true);
    expect(library.shapes[0].favorite).toBe(false);
  });
});

describe("listShapesForDisplay", () => {
  it("puts favorites first (in Favorites order), then the rest by name", () => {
    let library = createEmptyLibrary();
    for (const name of ["Zebra", "Alpha", "Mango", "Beta"]) {
      library = addShape(library, capture(), name);
    }
    library = setShapeFavorite(library, library.shapes.find((s) => s.name === "Mango").id, true);
    library = setShapeFavorite(library, library.shapes.find((s) => s.name === "Zebra").id, true);
    expect(listShapesForDisplay(library).map((s) => s.name)).toEqual([
      "Mango", "Zebra", "Alpha", "Beta",
    ]);
  });

  it("sorts case-insensitively", () => {
    let library = createEmptyLibrary();
    for (const name of ["beta", "Alpha", "gamma"]) library = addShape(library, capture(), name);
    expect(listShapesForDisplay(library).map((s) => s.name)).toEqual(["Alpha", "beta", "gamma"]);
  });

  it("handles an empty or missing library", () => {
    expect(listShapesForDisplay(createEmptyLibrary())).toEqual([]);
    expect(listShapesForDisplay(null)).toEqual([]);
    expect(favoriteShapes(null)).toEqual([]);
  });
});

describe("Favorites order", () => {
  /** Library with shapes A..D, then starred in the given order. */
  function starred(order) {
    let library = createEmptyLibrary();
    for (const name of ["A", "B", "C", "D"]) library = addShape(library, capture(), name);
    const id = (name) => library.shapes.find((s) => s.name === name).id;
    for (const name of order) library = setShapeFavorite(library, id(name), true);
    return { library, id };
  }
  const names = (library) => favoriteShapes(library).map((s) => s.name);

  it("lists favorites in the order they were starred, not by name", () => {
    const { library } = starred(["C", "A", "D"]);
    expect(names(library)).toEqual(["C", "A", "D"]);
    expect(listShapesForDisplay(library).map((s) => s.name)).toEqual(["C", "A", "D", "B"]);
  });

  it("moves a favorite up and down, clamped at the ends", () => {
    const { library, id } = starred(["C", "A", "D"]);
    expect(names(moveFavorite(library, id("D"), -1))).toEqual(["C", "D", "A"]);
    expect(names(moveFavorite(library, id("C"), 1))).toEqual(["A", "C", "D"]);
    expect(names(moveFavorite(library, id("A"), -5))).toEqual(["A", "C", "D"]);
    expect(moveFavorite(library, id("C"), -1)).toBe(library); // already first
    expect(moveFavorite(library, id("B"), 1)).toBe(library); // not starred
    expect(moveFavorite(library, "nope", 1)).toBe(library);
  });

  it("unstarring removes a shape from the order; re-starring adds it at the end", () => {
    const { library, id } = starred(["C", "A", "D"]);
    const without = setShapeFavorite(library, id("C"), false);
    expect(names(without)).toEqual(["A", "D"]);
    expect(names(setShapeFavorite(without, id("C"), true))).toEqual(["A", "D", "C"]);
  });

  it("deleting a starred shape drops it from the order", () => {
    const { library, id } = starred(["C", "A"]);
    const next = removeShape(library, id("C"));
    expect(next.favoriteOrder).toEqual([id("A")]);
  });

  it("reconciles a stale or missing stored order against the stars", () => {
    const { library, id } = starred(["C", "A"]);
    // Order names a deleted id and omits a starred one; no order at all also works.
    const messy = { ...library, favoriteOrder: ["gone", id("A"), id("A")] };
    expect(orderedFavoriteIds(messy)).toEqual([id("A"), id("C")]);
    const legacy = { ...library };
    delete legacy.favoriteOrder;
    expect(orderedFavoriteIds(legacy)).toEqual([id("A"), id("C")]);
  });
});
