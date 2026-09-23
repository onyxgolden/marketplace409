import { describe, expect, it } from "vitest";
import { SITE_OUTDOOR_CATEGORIES, SITE_OUTDOOR_SYMBOLS } from "./siteOutdoorCatalog";
import { getSymbolSet } from "./symbolRegistry";
import { PIPE_LAYERS } from "./pipingGeometry";

const EXPECTED_IDS = [
  "deck",
  "patio",
  "driveway",
  "walkway",
  "fence",
  "garden-bed",
  "pool-rect",
  "shed",
];

describe("siteOutdoorCatalog", () => {
  it("registers the siteOutdoor symbol set", () => {
    const set = getSymbolSet("siteOutdoor");
    expect(set).toBeDefined();
    expect(set.title).toBe("Site & outdoor");
    expect(set.symbols.length).toBe(EXPECTED_IDS.length);
  });

  it("ships every required surface, structure, and landscape symbol", () => {
    const set = getSymbolSet("siteOutdoor");
    const ids = set.symbols.map((s) => s.id);
    for (const id of EXPECTED_IDS) expect(ids).toContain(id);
  });

  it("keeps entries declarative — data only, no functions", () => {
    for (const item of SITE_OUTDOOR_SYMBOLS) {
      for (const value of Object.values(item)) {
        expect(typeof value).not.toBe("function");
      }
      expect(typeof item.glyph).toBe("string");
    }
  });

  it("has unique ids, positive dimensions, known categories, and valid layers", () => {
    const seen = new Set();
    for (const item of SITE_OUTDOOR_SYMBOLS) {
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
      expect(item.widthIn).toBeGreaterThan(0);
      expect(item.depthIn).toBeGreaterThan(0);
      expect(SITE_OUTDOOR_CATEGORIES).toContain(item.category);
      expect(PIPE_LAYERS).toContain(item.defaultLayer);
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });
});
