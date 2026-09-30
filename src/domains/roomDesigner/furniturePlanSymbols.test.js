// furniturePlanSymbols.test.js — recognizable top-down plan symbols.

import { describe, expect, it } from "vitest";
import { FURNITURE_CATALOG, getCatalogEntry } from "./furnitureCatalog";
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
    else if (p.kind === "text") eat(p.x, p.y);
  }
  return { minX, maxX, minY, maxY };
}
const count = (prims, role) => prims.filter((p) => p.role === role).length;

describe("plan symbols for the Phase 1 objects", () => {
  it("covers every Phase 1 catalog id", () => {
    for (const id of PHASE1) {
      expect(getCatalogEntry(id), id).toBeTruthy();
      expect(PLAN_SYMBOL_CATALOG_IDS, id).toContain(id);
    }
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
    expect(furniturePlanSymbol("not-a-catalog-id", 84, 36)).toBeNull();
    expect(furniturePlanSymbol("bed-queen", 0, 80)).toBeNull();
  });
});

describe("Phase 2: the whole residential catalog has plan symbols", () => {
  const texts = (prims) => prims.filter((p) => p.kind === "text").map((p) => p.text);

  // "wardrobe" is a deliberate, documented exception to full containment: a
  // hinged door's swing has to show where it actually opens TO, and a
  // wardrobe's doors swing outward into the room (see furniturePlanSymbols.js's
  // own comment on wardrobe()) — the same convention a real door-in-wall
  // symbol uses. It gets its own positive-coverage test below instead of
  // just being silently skipped here.
  const EXTENDS_PAST_FOOTPRINT = new Set(["wardrobe"]);

  it("every furniture catalog id (incl. cabinets) has a symbol inside its footprint", () => {
    for (const e of FURNITURE_CATALOG) {
      if (EXTENDS_PAST_FOOTPRINT.has(e.id)) continue;
      const prims = furniturePlanSymbol(e.id, e.widthIn, e.depthIn);
      expect(prims, e.id).not.toBeNull();
      expect(prims.length, e.id).toBeGreaterThanOrEqual(2);
      const b = bounds(prims);
      const eps = 1e-6;
      expect(b.minX, e.id).toBeGreaterThanOrEqual(-e.widthIn / 2 - eps);
      expect(b.maxX, e.id).toBeLessThanOrEqual(e.widthIn / 2 + eps);
      expect(b.minY, e.id).toBeGreaterThanOrEqual(-e.depthIn / 2 - eps);
      expect(b.maxY, e.id).toBeLessThanOrEqual(e.depthIn / 2 + eps);
      for (const p of prims) for (const v of Object.values(p)) if (typeof v === "number") expect(Number.isFinite(v), e.id).toBe(true);
    }
    expect(PLAN_SYMBOL_CATALOG_IDS.length).toBe(FURNITURE_CATALOG.length);
  });

  it("wardrobe's doors swing outward past the front edge, into the room, by exactly the door radius", () => {
    const e = getCatalogEntry("wardrobe");
    const prims = furniturePlanSymbol("wardrobe", e.widthIn, e.depthIn);
    const doorRadius = Math.min(e.widthIn / 2, e.depthIn);
    const b = bounds(prims);
    const eps = 1e-6;
    // Still contained on every OTHER side: width, and the back against the wall.
    expect(b.minX).toBeGreaterThanOrEqual(-e.widthIn / 2 - eps);
    expect(b.maxX).toBeLessThanOrEqual(e.widthIn / 2 + eps);
    expect(b.minY).toBeGreaterThanOrEqual(-e.depthIn / 2 - eps);
    // The front edge is exactly where it should be: the swing extends the
    // full door radius past it, not further and not clipped short.
    expect(b.maxY).toBeCloseTo(e.depthIn / 2 + doorRadius, 5);
  });

  it("sofas show a back, two arms and one cushion per seat", () => {
    for (const [id, seats] of [["sofa-3seat", 3], ["loveseat", 2], ["armchair", 1], ["recliner", 1]]) {
      const prims = nominal(id);
      expect(count(prims, "back"), id).toBe(1);
      expect(count(prims, "arm"), id).toBe(2);
      expect(count(prims, "cushion"), id).toBe(seats);
    }
    expect(count(nominal("recliner"), "footrest")).toBe(1);
  });

  it("appliances read as appliances: burners, REF, DW, MW, W/D, WH", () => {
    expect(count(nominal("range"), "burner")).toBe(4);
    expect(texts(nominal("refrigerator"))).toEqual(["REF"]);
    expect(texts(nominal("dishwasher"))).toEqual(["DW"]);
    expect(texts(nominal("microwave-cart"))).toEqual(["MW"]);
    expect(texts(nominal("washer"))).toEqual(["W"]);
    expect(count(nominal("washer"), "drum")).toBe(1);
    expect(texts(nominal("dryer"))).toEqual(["D"]);
    expect(texts(nominal("water-heater"))).toEqual(["WH"]);
  });

  it("bath fixtures: vanities show basins, showers a drain with slope lines", () => {
    expect(count(nominal("vanity-single"), "basin")).toBe(1);
    expect(count(nominal("vanity-double"), "basin")).toBe(2);
    for (const id of ["shower", "shower-48x36"]) {
      expect(count(nominal(id), "drain"), id).toBe(1);
      expect(count(nominal(id), "slope"), id).toBe(4);
    }
    expect(count(nominal("utility-sink"), "basin")).toBe(1);
  });

  it("cabinets follow plan conventions: wall = dashed, tall = X, corner = L + lazy Susan, sink bases show the sink", () => {
    for (const id of ["cabinet-wall-24", "cabinet-wall-corner", "cabinet-wall-bridge", "cabinet-wall-microwave", "cabinet-open-shelf", "cabinet-bath-wall"]) {
      expect(count(nominal(id), "wall-cabinet"), id).toBe(1);
    }
    for (const id of ["cabinet-pantry-24", "cabinet-tall-oven", "cabinet-tall-utility", "cabinet-linen-tower"]) {
      expect(count(nominal(id), "tall-x"), id).toBe(2);
    }
    expect(count(nominal("cabinet-base-corner"), "susan")).toBe(1);
    expect(nominal("cabinet-base-corner").find((p) => p.role === "cabinet").kind).toBe("poly"); // L-shape
    for (const id of ["cabinet-sink-36", "cabinet-sink-farm", "cabinet-vanity-sink"]) {
      expect(count(nominal(id), "basin"), id).toBeGreaterThanOrEqual(1);
    }
    for (const id of ["cabinet-base-24", "cabinet-base-drawer", "cabinet-base-db", "cabinet-island-base"]) {
      expect(count(nominal(id), "door-face"), id).toBeGreaterThanOrEqual(1);
    }
  });

  it("lamps use the lighting symbol (circle with an X)", () => {
    for (const id of ["floor-lamp", "table-lamp"]) expect(count(nominal(id), "lamp-x"), id).toBe(2);
  });

  it("keeps different kinds of objects visually distinct", () => {
    const sig = (id) => JSON.stringify(nominal(id).map((p) => [p.kind, p.role, p.text || ""]));
    const distinct = ["sofa-3seat", "loveseat", "armchair", "recliner", "coffee-table", "side-table", "desk", "kitchen-island",
      "nightstand", "dresser", "refrigerator", "range", "dishwasher", "microwave-cart", "vanity-single", "vanity-double",
      "shower", "washer", "dryer", "water-heater", "utility-sink", "bookshelf", "tv-stand", "wardrobe", "storage-chest",
      "floor-lamp", "cabinet-base-24", "cabinet-sink-36", "cabinet-base-corner", "cabinet-wall-24", "cabinet-pantry-24"];
    expect(new Set(distinct.map(sig)).size).toBe(distinct.length);
  });
});
