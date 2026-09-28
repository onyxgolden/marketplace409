import { describe, expect, it } from "vitest";
import { FURNITURE_CATALOG } from "./furnitureCatalog";
import { composedCatalogIds, furnitureParts, shade } from "./designerFurnitureParts";

const dimsOf = (id) => {
  const e = FURNITURE_CATALOG.find((c) => c.id === id);
  return { widthIn: e.widthIn, depthIn: e.depthIn, heightIn: e.heightIn, color: e.color };
};

describe("designerFurnitureParts — shade", () => {
  it("darkens and lightens hex colors", () => {
    expect(shade("#808080", 0.5)).toBe("#404040");
    expect(shade("#808080", 2)).toBe("#ffffff");
  });
  it("passes through invalid input", () => {
    expect(shade("nope", 0.5)).toBe("nope");
  });
});

describe("designerFurnitureParts — coverage", () => {
  it("composes every catalog entry into at least one part", () => {
    for (const entry of FURNITURE_CATALOG) {
      const parts = furnitureParts(entry.id, dimsOf(entry.id));
      expect(parts.length, entry.id).toBeGreaterThan(0);
    }
  });
  it("falls back to a single box for unknown catalog ids", () => {
    const parts = furnitureParts("not-a-real-id", { widthIn: 30, depthIn: 20, heightIn: 40, color: "#123456" });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ shape: "box", w: 30, h: 40, d: 20 });
  });
  it("falls back to a single box for invalid dims", () => {
    expect(furnitureParts("sofa-3seat", null)).toHaveLength(1);
    expect(furnitureParts("sofa-3seat", { widthIn: 0, depthIn: 0, heightIn: 0 })).toHaveLength(1);
  });
  it("returns plain JSON (serializable, no functions)", () => {
    for (const id of composedCatalogIds()) {
      const parts = furnitureParts(id, dimsOf(id));
      expect(() => JSON.parse(JSON.stringify(parts)), id).not.toThrow();
      for (const p of parts) {
        expect(["box", "cyl"]).toContain(p.shape);
        expect(p.w).toBeGreaterThan(0);
        expect(p.h).toBeGreaterThan(0);
        expect(p.d).toBeGreaterThan(0);
      }
    }
  });
  it("keeps parts roughly inside the piece footprint", () => {
    for (const id of composedCatalogIds()) {
      const { widthIn: w, depthIn: d, heightIn: h } = dimsOf(id);
      for (const p of furnitureParts(id, dimsOf(id))) {
        // a rotX cylinder (e.g. washer door) faces forward: its depth is its thickness
        const effD = p.rotX ? p.h : p.d;
        expect(Math.abs(p.dx) + p.w / 2, `${id} x`).toBeLessThanOrEqual(w / 2 + 4);
        expect(Math.abs(p.dz) + effD / 2, `${id} z`).toBeLessThanOrEqual(d / 2 + 4);
        expect(p.dy - p.h / 2, `${id} bottom`).toBeGreaterThanOrEqual(-0.5);
        // headboards and TV screens intentionally rise above nominal height
        expect(p.dy + p.h / 2, `${id} top`).toBeLessThanOrEqual(h + 30);
      }
    }
  });
});

describe("designerFurnitureParts — signature compositions", () => {
  it("sofa: base + cushion + back + two arms", () => {
    const parts = furnitureParts("sofa-3seat", dimsOf("sofa-3seat"));
    expect(parts).toHaveLength(5);
    const arms = parts.filter((p) => Math.abs(p.dx) > 20);
    expect(arms).toHaveLength(2);
  });
  it("bed: frame + headboard + mattress + two pillows", () => {
    const parts = furnitureParts("bed-queen", dimsOf("bed-queen"));
    expect(parts).toHaveLength(5);
    const pillows = parts.filter((p) => p.color === "#ffffff");
    expect(pillows).toHaveLength(2);
    const headboard = parts.find((p) => p.dz < -30);
    expect(headboard).toBeDefined();
  });
  it("toilet: tank + lid + handle + pedestal + bowl + seat lid (Phase 1 recognizable toilet)", () => {
    const parts = furnitureParts("toilet", dimsOf("toilet"));
    expect(parts).toHaveLength(6);
    expect(parts.some((p) => p.color === "#ffffff")).toBe(true);
  });
  it("dining table: top + four legs", () => {
    const parts = furnitureParts("dining-table-rect", dimsOf("dining-table-rect"));
    expect(parts).toHaveLength(5);
    const legs = parts.filter((p) => p.w === 3 && p.h < 28);
    expect(legs).toHaveLength(4);
  });
  it("round table uses cylinders", () => {
    const parts = furnitureParts("dining-table-round", dimsOf("dining-table-round"));
    expect(parts.some((p) => p.shape === "cyl")).toBe(true);
  });
  it("floor lamp shade is marked as a glow part", () => {
    const parts = furnitureParts("floor-lamp", dimsOf("floor-lamp"));
    expect(parts.some((p) => p.glow)).toBe(true);
  });
});

describe("designerFurnitureParts — recognizable procedural fixtures (Phase 1)", () => {
  const within = (id) => {
    const d = dimsOf(id);
    for (const p of furnitureParts(id, d)) {
      expect(Math.abs(p.dx) + p.w / 2, `${id} x`).toBeLessThanOrEqual(d.widthIn / 2 + 1e-6);
      expect(Math.abs(p.dz) + (p.shape === "cyl" ? p.d : p.d) / 2, `${id} z`).toBeLessThanOrEqual(d.depthIn / 2 + 1e-6);
      expect(p.dy - p.h / 2, `${id} y`).toBeGreaterThanOrEqual(-1e-6);
    }
  };

  it("toilet: tank at the back, a tapered oval pedestal and bowl, and a lid — not three boxes", () => {
    const parts = furnitureParts("toilet", dimsOf("toilet"));
    const tank = parts.find((p) => p.role === "tank");
    const bowl = parts.find((p) => p.role === "bowl");
    expect(tank.shape).toBe("box");
    expect(tank.dz).toBeLessThan(0); // back
    expect(bowl.shape).toBe("cyl");
    expect(bowl.d).toBeGreaterThan(bowl.w); // oval, longer front-to-back
    expect(bowl.wTop).toBeGreaterThan(bowl.w); // flares outward
    expect(parts.some((p) => p.role === "pedestal" && p.shape === "cyl")).toBe(true);
    expect(parts.some((p) => p.role === "lid")).toBe(true);
    within("toilet");
  });

  it("round dining table: round top on a pedestal and base", () => {
    const parts = furnitureParts("dining-table-round", dimsOf("dining-table-round"));
    expect(parts.map((p) => p.role)).toEqual(expect.arrayContaining(["top", "pedestal", "base"]));
    expect(parts.every((p) => p.shape === "cyl")).toBe(true);
    within("dining-table-round");
  });

  it("round bath sink: flared bowl with a recessed basin and faucet", () => {
    const parts = furnitureParts("sink-bath-round", dimsOf("sink-bath-round"));
    const bowl = parts.find((p) => p.role === "bowl");
    expect(bowl.wTop).toBeGreaterThan(bowl.w);
    expect(parts.some((p) => p.role === "basin")).toBe(true);
    expect(parts.some((p) => p.role === "faucet")).toBe(true);
    within("sink-bath-round");
  });

  it("kitchen sink: rim with two recessed basins and a faucet", () => {
    const parts = furnitureParts("sink-kitchen-33", dimsOf("sink-kitchen-33"));
    expect(parts.filter((p) => p.role === "basin")).toHaveLength(2);
    expect(parts.some((p) => p.role === "faucet")).toBe(true);
    within("sink-kitchen-33");
  });

  it("existing round cylinders keep d === w (unchanged rendering)", () => {
    for (const id of ["water-heater", "floor-lamp", "office-chair"]) {
      for (const p of furnitureParts(id, dimsOf(id)).filter((q) => q.shape === "cyl")) {
        expect(p.wTop, id).toBeUndefined();
      }
    }
  });
});
