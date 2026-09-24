// customShapeTools.test.js — saved shapes as left-palette tools.
//
// Custom shapes join the palette the way designerToolbar.js documented:
// registerToolCategory() at runtime. The payoff is that the palette's
// existing favorites, collapse state and grouping work on them unchanged.

import { describe, expect, it, beforeEach } from "vitest";
import {
  CUSTOM_SHAPE_CATEGORY_ID,
  customShapeToolDefs,
  customShapeToolId,
  registerCustomShapeCategory,
  shapeIdFromToolId,
} from "./customShapeTools";
import { addShape, createEmptyLibrary, setShapeFavorite } from "./customShapeLibrary";
import {
  getToolCategories,
  groupToolsByCategory,
  resetToolCategories,
} from "../designerToolbar";

const ICON = () => null;

const capture = (widthIn = 144, heightIn = 144) => ({
  entities: { walls: [], rooms: [], openings: [], furniture: [], pipes: [], symbols: [] },
  bounds: { widthIn, heightIn },
  counts: { total: 0 },
});

function libraryWith(names) {
  let library = createEmptyLibrary();
  for (const name of names) library = addShape(library, capture(), name);
  return library;
}

beforeEach(() => {
  resetToolCategories();
});

describe("tool ids", () => {
  it("round-trips a shape id", () => {
    expect(shapeIdFromToolId(customShapeToolId("shape-abc"))).toBe("shape-abc");
  });

  it("returns null for anything that is not a custom-shape tool", () => {
    expect(shapeIdFromToolId("wall")).toBeNull();
    expect(shapeIdFromToolId(null)).toBeNull();
    expect(shapeIdFromToolId(42)).toBeNull();
  });

  it("is stable for a given shape, so a favorite survives a reload", () => {
    expect(customShapeToolId("shape-abc")).toBe(customShapeToolId("shape-abc"));
  });
});

describe("customShapeToolDefs", () => {
  it("builds one tool per shape, carrying the shape id", () => {
    const library = libraryWith(["Bay window"]);
    const [tool] = customShapeToolDefs(library, ICON);
    expect(tool.label).toBe("Bay window");
    expect(tool.customShapeId).toBe(library.shapes[0].id);
    expect(tool.id).toBe(customShapeToolId(library.shapes[0].id));
    expect(tool.icon).toBe(ICON);
  });

  it("puts the size in the hint", () => {
    let library = createEmptyLibrary();
    library = addShape(library, capture(144, 240), "Bedroom");
    expect(customShapeToolDefs(library, ICON)[0].hint).toContain("12' × 20'");
  });

  it("omits the size for a shape with none", () => {
    let library = createEmptyLibrary();
    library = addShape(library, capture(0, 0), "Flat");
    expect(customShapeToolDefs(library, ICON)[0].hint).toBe('Click the plan to place "Flat"');
  });

  it("orders favorites first", () => {
    let library = libraryWith(["Zebra", "Alpha"]);
    library = setShapeFavorite(library, library.shapes.find((s) => s.name === "Zebra").id, true);
    expect(customShapeToolDefs(library, ICON).map((t) => t.label)).toEqual(["Zebra", "Alpha"]);
  });

  it("carries the shape's favorite state onto the tool", () => {
    let library = libraryWith(["Bay window"]);
    expect(customShapeToolDefs(library, ICON)[0].favorite).toBe(false);
    library = setShapeFavorite(library, library.shapes[0].id, true);
    expect(customShapeToolDefs(library, ICON)[0].favorite).toBe(true);
  });

  it("returns nothing for an empty library", () => {
    expect(customShapeToolDefs(createEmptyLibrary(), ICON)).toEqual([]);
  });
});

describe("registerCustomShapeCategory", () => {
  it("registers a category the palette groups by", () => {
    const library = libraryWith(["Bay window", "Dormer"]);
    registerCustomShapeCategory(library);
    const category = getToolCategories().find((c) => c.id === CUSTOM_SHAPE_CATEGORY_ID);
    expect(category.label).toBe("My shapes");
    expect(category.toolIds).toHaveLength(2);
  });

  it("groups the shape tools into that category alongside the built-ins", () => {
    const library = libraryWith(["Bay window"]);
    registerCustomShapeCategory(library);
    const toolDefs = [
      { id: "select", label: "Select", icon: ICON },
      { id: "erase", label: "Erase", icon: ICON },
      { id: "pan", label: "Pan", icon: ICON },
      { id: "wall", label: "Wall", icon: ICON },
      ...customShapeToolDefs(library, ICON),
    ];
    const grouped = groupToolsByCategory(toolDefs);
    const custom = grouped.categories.find((c) => c.id === CUSTOM_SHAPE_CATEGORY_ID);
    expect(custom.tools.map((t) => t.label)).toEqual(["Bay window"]);
    // The built-in House category is untouched.
    expect(grouped.categories.find((c) => c.id === "house").tools.map((t) => t.label)).toEqual(["Wall"]);
    // Nothing fell through to ungrouped.
    expect(grouped.ungrouped).toEqual([]);
  });

  it("replaces the previous registration, so it is safe on every change", () => {
    registerCustomShapeCategory(libraryWith(["One", "Two", "Three"]));
    registerCustomShapeCategory(libraryWith(["Only"]));
    const category = getToolCategories().find((c) => c.id === CUSTOM_SHAPE_CATEGORY_ID);
    expect(category.toolIds).toHaveLength(1);
  });

  it("hides the category when the library is empty", () => {
    registerCustomShapeCategory(createEmptyLibrary());
    const grouped = groupToolsByCategory([
      { id: "select", label: "Select", icon: ICON },
      { id: "wall", label: "Wall", icon: ICON },
    ]);
    // groupToolsByCategory skips empty categories.
    expect(grouped.categories.find((c) => c.id === CUSTOM_SHAPE_CATEGORY_ID)).toBeUndefined();
  });
});
