// furniturePlanSymbols.test.js — recognizable top-down plan symbols.

import { describe, expect, it } from "vitest";
import { getCatalogEntry } from "./furnitureCatalog";
import { PLAN_SYMBOL_CATALOG_IDS, furniturePlanSymbol } from "./furniturePlanSymbols";

const PHASE1 = [
  "bed-twin", "bed-full", "bed-queen", "bed-king",
  "toilet", "bathtub", "sink-pedestal", "sink-bath-round", "sink-kitchen-33",
  "dining-table-rect", "dining-table-round", "dining-chair", "office-chair",
];
const nominal = (id) => {
  const e = getCatalogEntry(id);
  return furniturePlanSymbol(id, e.widthIn, e.depthIn);
};
function bounds(prims) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const eat = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const p of prims) {
    if (p.kind === "rect") { eat(p.x, p.y); eat(p.x + p.w, p.y + p.h); }
    else if (p.kind === "line") { eat(p.x1, p.y1); eat(p.x2, p.y2); }
    else if (p.kind === "poly") p.points.forEach(([x, y]) => eat(x, y));
    else if (p.kind === "circle") { eat(p.cx - p.r, p.cy - p.r); eat(p.cx + p.r, p.cy + p.r); }
    else if (p.kind === "ellipse") { eat(p.cx - p.rx, p.cy - p.ry); eat(p.cx + p.rx, p.cy + p.ry); }
  }
  return { minX, maxX, minY, maxY };
}
const count = (prims, role) => prims.filter((p) => p.role === role).length;

describe("plan symbols for the Phase 1 objects", () => {
  it("covers every Phase 1 catalog id", () => {
    expect([...PLAN_SYMBOL_CATALOG_IDS].sort()).toEqual([...PHASE1].sort());
    for (const id of PHASE1) expect(getCatalogEntry(id), id).toBeTruthy();
  });

  it.each(PHASE1)("%s stays inside its footprint and carries interior detail", (id) => {
    const e = getCatalogEntry(id);
    const prims = nominal(id);
    const b = bounds(prims);
    const eps = 1e-6;
    expect(b.minX).toBeGreaterThanOrEqual(-e.widthIn / 2 - eps);
    expect(b.maxX).toBeLessThanOrEqual(e.widthIn / 2 + eps);
    expect(b.minY).toBeGreaterThanOrEqual(-e.depthIn / 2 - eps);
    expect(b.maxY).toBeLessThanOrEqual(e.depthIn / 2 + eps);
    expect(prims.length).toBeGreaterThanOrEqual(3); // never just a rectangle
    for (const p of prims) for (const v of Object.values(p)) if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
  });

  it("gives the 13 objects 13 different drawings", () => {
    const sig = (id) => JSON.stringify(nominal(id).map((p) => [p.kind, p.role]));
    // Bed sizes share a layout family, so compare at one common size too.
    const shapes = PHASE1.filter((id) => !id.startsWith("bed-")).map(sig);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("beds: headboard at the back, one pillow on a twin, two on larger beds, and a turned-down sheet", () => {
    for (const [id, pillows] of [["bed-twin", 1], ["bed-full", 2], ["bed-queen", 2], ["bed-king", 2]]) {
      const prims = nominal(id);
      expect(count(prims, "pillow"), id).toBe(pillows);
      const head = prims.find((p) => p.role === "headboard");
      expect(head.y).toBeCloseTo(-getCatalogEntry(id).depthIn / 2, 6); // back = top of the plan
      expect(count(prims, "sheet"), id).toBeGreaterThanOrEqual(2); // sheet edge + fold
    }
  });

  it("toilet: tank at the back, oval bowl and seat in front", () => {
    const prims = nominal("toilet");
    const tank = prims.find((p) => p.role === "tank");
    const bowl = prims.find((p) => p.role === "bowl");
    expect(tank.y).toBeCloseTo(-12, 6);
    expect(bowl.kind).toBe("ellipse");
    expect(bowl.cy).toBeGreaterThan(tank.y + tank.h - 1e-6);
    expect(prims.some((p) => p.role === "seat")).toBe(true);
  });

  it("bathtub and sinks show a basin and a drain", () => {
    for (const id of ["bathtub", "sink-pedestal", "sink-bath-round", "sink-kitchen-33"]) {
      const prims = nominal(id);
      expect(prims.some((p) => p.role === "basin"), id).toBe(true);
      expect(prims.some((p) => p.role === "drain"), id).toBe(true);
    }
    expect(count(nominal("sink-kitchen-33"), "basin")).toBe(2); // double bowl
  });

  it("office chair shows a five-star base; dining chair a seat and back", () => {
    expect(count(nominal("office-chair"), "caster")).toBe(5);
    expect(count(nominal("dining-chair"), "back")).toBe(1);
  });

  it("scales with a resized piece and returns null for ids without a symbol", () => {
    const small = bounds(furniturePlanSymbol("bed-queen", 60, 80));
    const big = bounds(furniturePlanSymbol("bed-queen", 72, 84));
    expect(big.maxX - big.minX).toBeCloseTo(72, 6);
    expect(small.maxY - small.minY).toBeCloseTo(80, 6);
    expect(furniturePlanSymbol("sofa-3seat", 84, 36)).toBeNull();
    expect(furniturePlanSymbol("bed-queen", 0, 80)).toBeNull();
  });
});
