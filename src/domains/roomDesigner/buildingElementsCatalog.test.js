import { describe, expect, it } from "vitest";
import { BUILDING_ELEMENTS, BUILDING_ELEMENT_CATEGORIES } from "./buildingElementsCatalog";
import { getSymbolSet } from "./symbolRegistry";
import { PIPE_LAYERS } from "./pipingGeometry";

const EXPECTED_IDS = [
  "door-single",
  "door-double",
  "door-sliding",
  "door-pocket",
  "door-bifold",
  "window-single-hung",
  "window-double-hung",
  "window-casement",
  "window-sliding",
  "window-picture",
  "window-awning",
  "stairs-straight",
  "stairs-l",
  "stairs-u",
  "railing",
  "column",
  "fireplace",
];

describe("buildingElementsCatalog", () => {
  it("registers the buildingElements symbol set", () => {
    const set = getSymbolSet("buildingElements");
    expect(set).toBeDefined();
    expect(set.title).toBe("Building elements");
    expect(set.symbols.length).toBe(EXPECTED_IDS.length);
  });

  it("ships every required door, window, stair, and structure symbol", () => {
    const set = getSymbolSet("buildingElements");
    const ids = set.symbols.map((s) => s.id);
    for (const id of EXPECTED_IDS) expect(ids).toContain(id);
  });

  it("keeps entries declarative — data only, no functions", () => {
    for (const item of BUILDING_ELEMENTS) {
      for (const value of Object.values(item)) {
        expect(typeof value).not.toBe("function");
      }
      expect(typeof item.glyph).toBe("string");
    }
  });

  it("has unique ids, positive dimensions, known categories, and valid layers", () => {
    const seen = new Set();
    for (const item of BUILDING_ELEMENTS) {
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
      expect(item.widthIn).toBeGreaterThan(0);
      expect(item.depthIn).toBeGreaterThan(0);
      expect(BUILDING_ELEMENT_CATEGORIES).toContain(item.category);
      expect(PIPE_LAYERS).toContain(item.defaultLayer);
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("orders categories doors -> windows -> stairs -> structure", () => {
    expect([...BUILDING_ELEMENT_CATEGORIES]).toEqual([
      "doors",
      "windows",
      "stairs",
      "structure",
    ]);
  });
});
