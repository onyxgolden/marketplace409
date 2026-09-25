// customShapePlacement.test.js — where a one-tap favorite lands, and what it selects.

import { describe, expect, it } from "vitest";
import { addWall, createEmptyDesign, placeFurniture } from "../designerDocument";
import { oneTapPlacementPoint, placedSelection } from "./customShapePlacement";

const design = (settings = {}) => {
  const d = createEmptyDesign("Plan");
  return { ...d, settings: { ...d.settings, gridIn: 6, ...settings } };
};

describe("oneTapPlacementPoint", () => {
  it("uses the 2D viewport center in 2D and split, the 3D floor center in 3D", () => {
    const args = { planCenter: { x: 100, y: 200 }, floorCenter: { x: 400, y: 500 }, design: design() };
    expect(oneTapPlacementPoint({ ...args, view: "2d" })).toEqual({ x: 102, y: 198 });
    expect(oneTapPlacementPoint({ ...args, view: "split" })).toEqual({ x: 102, y: 198 });
    expect(oneTapPlacementPoint({ ...args, view: "3d" })).toEqual({ x: 402, y: 498 });
  });

  it("falls back to the other pane, then the design's center, then a default", () => {
    expect(oneTapPlacementPoint({ view: "3d", planCenter: { x: 60, y: 60 }, floorCenter: null, design: design() })).toEqual({ x: 60, y: 60 });
    let d = addWall(design(), { x: 0, y: 0 }, { x: 120, y: 0 });
    d = placeFurniture(d, "armchair", 60, 120);
    expect(oneTapPlacementPoint({ view: "2d", design: d })).toEqual({ x: 60, y: 60 });
    expect(oneTapPlacementPoint({ view: "2d", design: design() })).toEqual({ x: 240, y: 240 });
  });

  it("does not snap when the design has snap off", () => {
    expect(oneTapPlacementPoint({ view: "2d", planCenter: { x: 101.5, y: 7 }, design: design({ snapEnabled: false }) }))
      .toEqual({ x: 101.5, y: 7 });
  });
});

describe("placedSelection", () => {
  it("selects only what was added, preferring furniture, then room, then wall", () => {
    const before = placeFurniture(design(), "armchair", 0, 0);
    const oneMore = placeFurniture(before, "sofa-3seat", 100, 100);
    expect(placedSelection(before, oneMore)).toEqual({
      selection: { kind: "furniture", id: oneMore.furniture[1].id }, multiSelection: [],
    });
    const wallOnly = addWall(before, { x: 0, y: 0 }, { x: 60, y: 0 });
    expect(placedSelection(before, wallOnly).selection).toEqual({ kind: "wall", id: wallOnly.walls[0].id });
    expect(placedSelection(before, before)).toEqual({ selection: null, multiSelection: [] });
  });
});
