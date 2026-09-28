// designerShapeSearch.test.js — one search across palette tools, the
// furniture catalog, and every registered symbol domain.

import { describe, expect, it } from "vitest";
import { FURNITURE_CATALOG } from "./furnitureCatalog";
import { listSymbolSets } from "./symbolRegistry";
import "./processEquipmentCatalog";
import "./mepFixturesCatalog";
import "./buildingElementsCatalog";
import "./siteOutdoorCatalog";
import "./pipingCatalog";
import { buildShapeSearchIndex, searchShapes } from "./designerShapeSearch";

const tools = [
  { id: "wall", label: "Wall" },
  { id: "door", label: "Door" },
  { id: "room-bedroom", label: "Bedroom" },
  { id: "custom-shape:abc", label: "My kitchen island" },
];
const index = buildShapeSearchIndex({ tools, furniture: FURNITURE_CATALOG, symbolSets: listSymbolSets() });
const ids = (q, limit) => searchShapes(index, q, limit).map((r) => `${r.kind}:${r.domain || ""}:${r.id}`);

describe("searchShapes", () => {
  it("finds furniture, tools and symbols by name, case-insensitively", () => {
    expect(ids("toilet")).toContain("catalog:furniture:toilet");
    expect(ids("WALL")[0]).toBe("tool::wall");
    expect(ids("centrifugal pump")).toContain("symbol:processEquipment:centrifugal-pump");
    expect(ids("TEMA")).toContain("symbol:processEquipment:tema-exchanger");
  });

  it("ranks exact, then prefix, then word-start, then substring matches", () => {
    const r = ids("bed");
    // "Bedroom" (tool, prefix) and beds (word-start "... bed") come before substring-only hits.
    const firstBed = r.findIndex((x) => x.includes("bed-"));
    const bedroom = r.indexOf("tool::room-bedroom");
    expect(bedroom).toBeGreaterThanOrEqual(0);
    expect(firstBed).toBeGreaterThanOrEqual(0);
    expect(bedroom).toBeLessThan(firstBed);
  });

  it("matches every word of a multi-word query, in any order", () => {
    expect(ids("bed queen")).toContain("catalog:furniture:bed-queen");
    expect(ids("queen bed")).toContain("catalog:furniture:bed-queen");
    expect(ids("queen sofa")).toEqual([]);
  });

  it("searches categories too (e.g. 'bath' finds bath fixtures)", () => {
    expect(ids("bath")).toEqual(expect.arrayContaining(["catalog:furniture:bathtub", "catalog:furniture:toilet"]));
  });

  it("includes saved custom shapes offered as tools", () => {
    expect(ids("kitchen island")).toContain("tool::custom-shape:abc");
  });

  it("returns nothing for a blank query and respects the limit", () => {
    expect(ids("   ")).toEqual([]);
    expect(ids("a", 5)).toHaveLength(5);
  });

  it("lists each result's human-readable name and where it lives", () => {
    const [first] = searchShapes(index, "toilet");
    expect(first).toMatchObject({ kind: "catalog", id: "toilet", label: "Toilet", group: expect.any(String) });
  });
});
