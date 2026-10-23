import { describe, expect, it } from "vitest";
import {
  DOWNCOMER_SPACING_IN,
  downcomerLevels,
  downcomerPropsErrors,
  isColumnSymbol,
  setDowncomerLevelProps,
} from "./downcomers";
import { PROCESS_EQUIPMENT as CATALOG } from "./processEquipmentCatalog";
import {
  createEmptyDesign,
  parseDesign,
  placeSymbol,
  serializeDesign,
} from "./designerDocument";

const withHeight = (design, id, heightIn) => ({
  ...design,
  symbols: design.symbols.map((s) => (s.id === id ? { ...s, heightIn } : s)),
});

const byId = (id) => CATALOG.find((s) => s.id === id);
const D = "processEquipment";

// D6: columns carry DOWNCOMER levels every 10 ft — each level is a
// tray level with flanged piping nozzles (including the product draw
// outlet), an entry manway, and platform access per the D5 rule. Level
// properties (temperature + product) are user-entered data only.
describe("column downcomer levels", () => {
  it("only the five column symbols carry downcomers", () => {
    for (const id of ["column", "packed-column", "absorber", "stripper", "vacuum-column"]) {
      expect(isColumnSymbol(byId(id)), id).toBe(true);
    }
    expect(isColumnSymbol(byId("vertical-vessel"))).toBe(false);
    expect(isColumnSymbol(byId("centrifugal-pump"))).toBe(false);
  });

  it("level count and elevations derive from the column height", () => {
    const column = byId("column"); // 360 in tall
    const levels = downcomerLevels(column, { symbolId: "column", x: 0, y: 0 });
    expect(levels.map((l) => l.index)).toEqual([1, 2, 3]);
    expect(levels.map((l) => l.elevationIn)).toEqual([120, 240, 360]);

    const tall = byId("packed-column"); // 480 in tall
    expect(downcomerLevels(tall, { symbolId: "packed-column", x: 0, y: 0 })).toHaveLength(4);

    // 350 in: levels at 120 and 240 only; level identity is the
    // elevation-derived index, so 20 ft is always level 2.
    const custom = { ...column };
    const short = downcomerLevels(custom, { symbolId: "column", x: 0, y: 0, heightIn: 350 });
    expect(short.map((l) => l.elevationIn)).toEqual([120, 240]);

    // Under one spacing: no levels at all.
    expect(downcomerLevels(column, { symbolId: "column", x: 0, y: 0, heightIn: 119 })).toEqual([]);
    expect(DOWNCOMER_SPACING_IN).toBe(120);
  });

  it("each level carries a draw outlet, a second nozzle, a manway, and a platform", () => {
    const levels = downcomerLevels(byId("column"), { symbolId: "column", x: 1000, y: 1000 });
    for (const level of levels) {
      const draw = level.anchors.find((a) => a.id === `downcomer-${level.index}-draw`);
      const other = level.anchors.find((a) => a.id === `downcomer-${level.index}-nozzle`);
      expect(draw).toBeTruthy();
      expect(draw.sizeIn).toBe(6);
      expect(draw.elevationIn).toBe(level.elevationIn);
      expect(other.sizeIn).toBe(8);
      // Draw and nozzle sit on opposite sides of the shell.
      expect(Math.sign(draw.x - 1000)).toBe(-Math.sign(other.x - 1000));
      expect(level.manway.diameterIn).toBe(24);
      expect(level.manway.sillIn).toBe(level.elevationIn);
      expect(level.platform).not.toBeNull();
      expect(level.platform.deck.elevationIn).toBe(level.elevationIn);
    }
    // Ladders chain: grade -> level 1 -> level 2 -> level 3.
    expect(levels[0].platform.ladder.fromIn).toBe(0);
    expect(levels[1].platform.ladder.fromIn).toBe(120);
    expect(levels[2].platform.ladder.fromIn).toBe(240);
    expect(levels[2].platform.ladder.toIn).toBe(360);
  });

  it("level properties default blank — nothing is invented", () => {
    const levels = downcomerLevels(byId("column"), { symbolId: "column", x: 0, y: 0 });
    for (const level of levels) {
      expect(level.temperature).toBeNull();
      expect(level.product).toBe("");
      expect(level.label).toBe("");
    }
  });

  it("properties round-trip: set, edit, clear, serialize", () => {
    let design = placeSymbol(createEmptyDesign(), D, "column", 500, 500, { id: "c1" });
    design = setDowncomerLevelProps(design, "c1", 2, {
      temperature: 350,
      temperatureUnit: "F",
      product: "Light cycle oil",
    });
    const inst = () => design.symbols.find((s) => s.id === "c1");
    expect(inst().downcomerProps).toEqual({
      2: { temperature: 350, temperatureUnit: "F", product: "Light cycle oil" },
    });
    const level = downcomerLevels(byId("column"), inst()).find((l) => l.index === 2);
    expect(level.label).toBe("Light cycle oil · 350°F");

    // Zero is a valid temperature, not a blank. (Writes carry the
    // complete property set for the level.)
    design = setDowncomerLevelProps(design, "c1", 2, {
      temperature: 0,
      temperatureUnit: "C",
      product: "Light cycle oil",
    });
    expect(inst().downcomerProps[2].temperature).toBe(0);
    expect(inst().downcomerProps[2].product).toBe("Light cycle oil");

    // Serialize -> parse preserves the properties exactly.
    const back = parseDesign(serializeDesign(design));
    expect(back.symbols.find((s) => s.id === "c1").downcomerProps).toEqual(inst().downcomerProps);

    // Clearing every field removes the entry.
    design = setDowncomerLevelProps(design, "c1", 2, { temperature: null, product: "" });
    expect(inst().downcomerProps).toBeUndefined();
  });

  it("invalid property writes throw instead of corrupting the design", () => {
    let design = placeSymbol(createEmptyDesign(), D, "column", 500, 500, { id: "c1" });
    design = placeSymbol(design, D, "vertical-vessel", 900, 500, { id: "v1" });
    expect(() => setDowncomerLevelProps(design, "missing", 1, {})).toThrow();
    expect(() => setDowncomerLevelProps(design, "v1", 1, {})).toThrow();
    expect(() => setDowncomerLevelProps(design, "c1", 9, {})).toThrow();
    expect(() => setDowncomerLevelProps(design, "c1", 1, { temperature: "hot" })).toThrow();
    expect(() => setDowncomerLevelProps(design, "c1", 1, { temperatureUnit: "K" })).toThrow();
  });

  it("shrinking a column preserves orphaned level data and flags it — never silently discards", () => {
    let design = placeSymbol(createEmptyDesign(), D, "column", 500, 500, { id: "c1" });
    design = setDowncomerLevelProps(design, "c1", 3, { temperature: 410, product: "Overhead gas" });
    expect(downcomerPropsErrors(design)).toEqual([]);
    // Shrink below the 30-ft level: the edited data survives and the
    // design reports it as orphaned instead of dropping it.
    design = withHeight(design, "c1", 240);
    const inst = design.symbols.find((s) => s.id === "c1");
    expect(inst.downcomerProps[3]).toEqual({ temperature: 410, temperatureUnit: "F", product: "Overhead gas" });
    const errors = downcomerPropsErrors(design);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/level 3/);
    // Growing back reattaches the same data to the same level.
    design = withHeight(design, "c1", 360);
    expect(downcomerPropsErrors(design)).toEqual([]);
  });
});
