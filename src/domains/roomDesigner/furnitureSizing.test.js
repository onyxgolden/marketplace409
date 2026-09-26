// furnitureSizing.test.js — standard and custom sizes for cabinets and furniture.

import { describe, expect, it } from "vitest";
import {
  createEmptyDesign,
  parseDesign,
  pieceSize,
  placeFurniture,
  resetFurnitureSize,
  resizeFurniture,
  serializeDesign,
  setFurnitureMount,
} from "./designerDocument";
import { listCatalog } from "./furnitureCatalog";
import { SIZE_FAMILIES, cleanMountIn, isMountedPiece, standardSizesFor } from "./furnitureSizing";
import { furnitureToBox } from "./designerThreeModel";

const cabinets = () => listCatalog().filter((e) => e.category === "cabinets");

describe("cabinet catalog", () => {
  it("covers base, wall, tall, and vanity cabinet types", () => {
    const families = new Set(cabinets().map((c) => c.sizeFamily));
    for (const f of ["base", "corner-base", "blind-base", "wall", "wall-corner", "bridge", "tall", "vanity", "linen", "bath-wall"]) {
      expect(families, f).toContain(f);
    }
    expect(cabinets().length).toBeGreaterThanOrEqual(18);
  });

  it.each(cabinets().map((c) => [c.id, c]))("%s: its default size is one of its family's standard sizes", (_id, c) => {
    const fam = SIZE_FAMILIES[c.sizeFamily];
    expect(fam, c.sizeFamily).toBeDefined();
    expect(fam.widths).toContain(c.widthIn);
    expect(fam.depths).toContain(c.depthIn);
    expect(fam.heights).toContain(c.heightIn);
    if (c.mountIn !== undefined) expect(fam.mounts).toContain(c.mountIn);
  });

  it("offers the common 3-inch width increments for base and wall cabinets", () => {
    expect(SIZE_FAMILIES.base.widths).toEqual([9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48]);
    expect(SIZE_FAMILIES.wall.widths).toEqual(SIZE_FAMILIES.base.widths);
    expect(SIZE_FAMILIES.wall.heights).toEqual([12, 15, 18, 24, 30, 36, 42]);
    expect(SIZE_FAMILIES.tall.heights).toEqual([84, 90, 96]);
  });

  it("gives standard sizes only to cabinets; ordinary furniture is custom-only", () => {
    expect(standardSizesFor("cabinet-wall-24")).toMatchObject({ family: "wall", mounts: [48, 54, 60, 66, 72] });
    expect(standardSizesFor("sofa-3seat")).toBeNull();
    expect(isMountedPiece("cabinet-wall-24")).toBe(true);
    expect(isMountedPiece("cabinet-base-24")).toBe(false);
  });
});

describe("custom sizes on placed pieces", () => {
  it("resizes width, depth and height on any furniture piece", () => {
    let d = placeFurniture(createEmptyDesign(), "sofa-3seat", 0, 0);
    d = resizeFurniture(d, d.furniture[0].id, 90, 38, 30.25);
    expect(pieceSize(d.furniture[0])).toMatchObject({ widthIn: 90, depthIn: 38, heightIn: 30.5, mountIn: 0 });
  });

  it("leaves a custom height alone when only the plan size changes (corner drag)", () => {
    let d = placeFurniture(createEmptyDesign(), "cabinet-pantry-24", 0, 0);
    d = resizeFurniture(d, d.furniture[0].id, 24, 24, 96);
    d = resizeFurniture(d, d.furniture[0].id, 30, 24);
    expect(pieceSize(d.furniture[0])).toMatchObject({ widthIn: 30, heightIn: 96 });
  });

  it("rejects an out-of-range height", () => {
    const d = placeFurniture(createEmptyDesign(), "desk", 0, 0);
    expect(() => resizeFurniture(d, d.furniture[0].id, 48, 24, 0)).toThrow(/Height/);
    expect(() => resizeFurniture(d, d.furniture[0].id, 48, 24, 600)).toThrow(/Height/);
  });

  it("mounts wall cabinets at their default height, and lets you change or clear it", () => {
    let d = placeFurniture(createEmptyDesign(), "cabinet-wall-24", 0, 0);
    const id = d.furniture[0].id;
    expect(pieceSize(d.furniture[0]).mountIn).toBe(54);
    d = setFurnitureMount(d, id, 60.2);
    expect(pieceSize(d.furniture[0]).mountIn).toBe(60);
    d = setFurnitureMount(d, id, null);
    expect(pieceSize(d.furniture[0]).mountIn).toBe(54);
    expect(() => setFurnitureMount(d, id, -1)).toThrow(/Mounting height/);
    expect(cleanMountIn(0)).toBe(0);
  });

  it("reset drops width, depth, height and mounting overrides", () => {
    let d = placeFurniture(createEmptyDesign(), "cabinet-wall-24", 0, 0);
    const id = d.furniture[0].id;
    d = setFurnitureMount(resizeFurniture(d, id, 36, 15, 42), id, 48);
    d = resetFurnitureSize(d, id);
    expect(pieceSize(d.furniture[0])).toEqual({ widthIn: 24, depthIn: 12, heightIn: 36, mountIn: 54 });
  });

  it("survives save and load", () => {
    let d = placeFurniture(createEmptyDesign(), "cabinet-wall-24", 0, 0);
    const id = d.furniture[0].id;
    d = setFurnitureMount(resizeFurniture(d, id, 33, 12, 42), id, 48);
    const back = parseDesign(serializeDesign(d));
    expect(pieceSize(back.furniture[0])).toEqual({ widthIn: 33, depthIn: 12, heightIn: 42, mountIn: 48 });
  });
});

describe("3D", () => {
  it("builds custom heights and hangs wall cabinets at their mounting height", () => {
    let d = placeFurniture(createEmptyDesign(), "cabinet-wall-24", 0, 0);
    d = resizeFurniture(d, d.furniture[0].id, 30, 12, 42);
    expect(furnitureToBox(d.furniture[0])).toMatchObject({ widthIn: 30, heightIn: 42, elevationIn: 54 });
    const base = placeFurniture(createEmptyDesign(), "cabinet-base-24", 0, 0);
    expect(furnitureToBox(base.furniture[0]).elevationIn).toBe(0);
  });
});
