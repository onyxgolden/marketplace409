import { describe, expect, it } from "vitest";
import {
  FURNITURE_CATALOG,
  FURNITURE_CATEGORIES,
  ROOM_TEMPLATES,
  catalogByCategory,
  getCatalogEntry,
  listCatalog,
  validateCatalog,
} from "./furnitureCatalog";
import { findSymbol, getSymbolSet, listSymbolSets } from "./symbolRegistry";
import { rotatedFootprintCorners } from "./designerGeometry";

const NEW_FIXTURE_IDS = [
  // kitchen
  "cabinet-base-24",
  "cabinet-sink-36",
  "cabinet-wall-24",
  "cabinet-pantry-24",
  "sink-kitchen-33",
  // bath
  "shower-48x36",
  "sink-pedestal",
  "sink-bath-round",
  // laundry
  "water-heater",
  "utility-sink",
];

describe("furnitureCatalog", () => {
  it("ships a non-trivial starter catalog", () => {
    expect(listCatalog().length).toBeGreaterThanOrEqual(25);
  });

  it("passes its own validation — unique ids, known categories, positive dimensions", () => {
    expect(validateCatalog()).toEqual([]);
  });

  it("looks up entries by id", () => {
    const sofa = getCatalogEntry("sofa-3seat");
    expect(sofa.label).toBe("Sofa (3-seat)");
    expect(sofa.widthIn).toBe(84);
    expect(sofa.depthIn).toBe(36);
    expect(getCatalogEntry("not-a-piece")).toBeUndefined();
  });

  it("covers the core remodel-planning pieces", () => {
    for (const id of [
      "sofa-3seat", "dining-table-rect", "bed-queen", "refrigerator",
      "range", "washer", "dryer", "toilet", "bathtub", "desk",
    ]) {
      expect(getCatalogEntry(id), id).toBeDefined();
    }
  });

  it("groups by category in a stable order", () => {
    const groups = catalogByCategory();
    expect(groups.map((g) => g.category)).toEqual(
      FURNITURE_CATEGORIES.filter((c) =>
        FURNITURE_CATALOG.some((item) => item.category === c),
      ),
    );
    for (const group of groups) {
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.category).toBe(group.category);
      }
    }
  });

  it("keeps catalog entries immutable", () => {
    expect(Object.isFrozen(getCatalogEntry("desk"))).toBe(true);
  });

  it("registers the furniture set in the symbol registry", () => {
    const set = getSymbolSet("furniture");
    expect(set.title).toBe("Furniture");
    expect(set.symbols).toHaveLength(FURNITURE_CATALOG.length);
    expect(findSymbol("furniture", "sofa-3seat").widthIn).toBe(84);
  });

  it("registers the rooms set in the symbol registry", () => {
    const set = getSymbolSet("rooms");
    expect(set.title).toBe("Rooms");
    expect(set.symbols.map((s) => s.id)).toEqual(ROOM_TEMPLATES.map((t) => t.id));
    for (const symbol of set.symbols) {
      expect(symbol.widthIn).toBeGreaterThan(0);
      expect(symbol.depthIn).toBeGreaterThan(0);
    }
  });

  it("exposes both sets via listSymbolSets", () => {
    expect(listSymbolSets().map((s) => s.domain)).toEqual(["furniture", "rooms"]);
  });

  describe("kitchen/bath fixture expansion", () => {
    it("resolves every new fixture id", () => {
      for (const id of NEW_FIXTURE_IDS) {
        expect(getCatalogEntry(id), id).toBeDefined();
      }
    });

    it("gives every new fixture valid dims, a known category, and a supported shape", () => {
      for (const id of NEW_FIXTURE_IDS) {
        const item = getCatalogEntry(id);
        expect(FURNITURE_CATEGORIES, id).toContain(item.category);
        for (const dim of ["widthIn", "depthIn", "heightIn"]) {
          expect(typeof item[dim] === "number" && item[dim] > 0, `${id}.${dim}`).toBe(true);
        }
        expect(["rect", "circle"], id).toContain(item.symbol);
        expect(item.label.length, id).toBeGreaterThan(0);
        expect(item.color, id).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it("matches standard real-world sizes", () => {
      const dims = (id) => {
        const { widthIn, depthIn, heightIn } = getCatalogEntry(id);
        return { widthIn, depthIn, heightIn };
      };
      expect(dims("cabinet-base-24")).toEqual({ widthIn: 24, depthIn: 24, heightIn: 34 });
      expect(dims("cabinet-sink-36")).toEqual({ widthIn: 36, depthIn: 24, heightIn: 34 });
      expect(dims("cabinet-wall-24")).toEqual({ widthIn: 24, depthIn: 12, heightIn: 36 });
      expect(dims("cabinet-pantry-24")).toEqual({ widthIn: 24, depthIn: 24, heightIn: 84 });
      expect(dims("sink-kitchen-33")).toEqual({ widthIn: 33, depthIn: 22, heightIn: 10 });
      expect(dims("shower-48x36")).toEqual({ widthIn: 48, depthIn: 36, heightIn: 78 });
      expect(dims("sink-pedestal")).toEqual({ widthIn: 22, depthIn: 20, heightIn: 34 });
      expect(dims("water-heater")).toEqual({ widthIn: 24, depthIn: 24, heightIn: 60 });
      expect(dims("utility-sink")).toEqual({ widthIn: 24, depthIn: 20, heightIn: 36 });
    });

    it("has no duplicate ids anywhere in the catalog", () => {
      const ids = listCatalog().map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(validateCatalog()).toEqual([]);
    });

    it("swaps the rotated footprint on a 90-degree turn for non-square fixtures", () => {
      const bounds = (id, rotationDeg) => {
        const { widthIn, depthIn } = getCatalogEntry(id);
        const corners = rotatedFootprintCorners({ x: 0, y: 0, widthIn, depthIn, rotationDeg });
        const xs = corners.map((p) => p.x);
        const ys = corners.map((p) => p.y);
        return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      };
      for (const id of NEW_FIXTURE_IDS) {
        const item = getCatalogEntry(id);
        if (item.symbol === "circle" || item.widthIn === item.depthIn) continue;
        const b0 = bounds(id, 0);
        const b90 = bounds(id, 90);
        expect(b0.w, id).toBeCloseTo(item.widthIn, 6);
        expect(b0.h, id).toBeCloseTo(item.depthIn, 6);
        expect(b90.w, id).toBeCloseTo(item.depthIn, 6);
        expect(b90.h, id).toBeCloseTo(item.widthIn, 6);
      }
    });

    it("keeps circle fixtures rotation-invariant", () => {
      for (const id of NEW_FIXTURE_IDS) {
        const item = getCatalogEntry(id);
        if (item.symbol !== "circle") continue;
        const corners = rotatedFootprintCorners({
          x: 10, y: -5, widthIn: item.widthIn, depthIn: item.depthIn, rotationDeg: 90,
        });
        const radius = Math.min(item.widthIn, item.depthIn) / 2;
        for (const p of corners) {
          expect(Math.hypot(p.x - 10, p.y + 5), id).toBeLessThanOrEqual(radius * Math.SQRT2 + 1e-9);
        }
      }
    });

    it("registers the new fixtures in the symbol registry", () => {
      const set = getSymbolSet("furniture");
      for (const id of NEW_FIXTURE_IDS) {
        expect(findSymbol("furniture", id), id).toBeDefined();
      }
      expect(set.symbols).toHaveLength(FURNITURE_CATALOG.length);
    });

    it("groups the new fixtures under their catalog categories", () => {
      const groups = catalogByCategory();
      const expected = {
        kitchen: ["cabinet-base-24", "cabinet-sink-36", "cabinet-wall-24", "cabinet-pantry-24", "sink-kitchen-33"],
        bath: ["shower-48x36", "sink-pedestal", "sink-bath-round"],
        laundry: ["water-heater", "utility-sink"],
      };
      for (const [category, ids] of Object.entries(expected)) {
        const group = groups.find((g) => g.category === category);
        expect(group, category).toBeDefined();
        for (const id of ids) {
          expect(group.items.some((item) => item.id === id), id).toBe(true);
        }
      }
    });
  });
});
