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
});
