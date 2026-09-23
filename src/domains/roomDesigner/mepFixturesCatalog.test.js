import { describe, expect, it } from "vitest";
import { MEP_FIXTURE_CATEGORIES, MEP_FIXTURES } from "./mepFixturesCatalog";
import { getSymbolSet } from "./symbolRegistry";
import { PIPE_LAYERS } from "./pipingGeometry";

const EXPECTED_IDS = [
  "outlet-duplex",
  "switch",
  "load-center",
  "hose-bib",
  "floor-drain",
  "smoke-detector",
];

describe("mepFixturesCatalog", () => {
  it("registers the mepFixtures symbol set", () => {
    const set = getSymbolSet("mepFixtures");
    expect(set).toBeDefined();
    expect(set.title).toBe("MEP fixtures");
    expect(set.symbols.length).toBe(EXPECTED_IDS.length);
  });

  it("ships every required electrical and plumbing fixture", () => {
    const set = getSymbolSet("mepFixtures");
    const ids = set.symbols.map((s) => s.id);
    for (const id of EXPECTED_IDS) expect(ids).toContain(id);
  });

  it("keeps entries declarative — data only, no functions", () => {
    for (const item of MEP_FIXTURES) {
      for (const value of Object.values(item)) {
        expect(typeof value).not.toBe("function");
      }
      expect(typeof item.glyph).toBe("string");
    }
  });

  it("has unique ids, positive dimensions, known categories, and valid layers", () => {
    const seen = new Set();
    for (const item of MEP_FIXTURES) {
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
      expect(item.widthIn).toBeGreaterThan(0);
      expect(item.depthIn).toBeGreaterThan(0);
      expect(MEP_FIXTURE_CATEGORIES).toContain(item.category);
      expect(PIPE_LAYERS).toContain(item.defaultLayer);
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });
});
