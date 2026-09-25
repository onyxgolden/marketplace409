// processEquipmentCatalog.test.js — the process-engineering equipment symbol set.

import { describe, expect, it } from "vitest";
import "./designerDocument"; // registers every symbol set, as the app does
import { getSymbolSet } from "./symbolRegistry";
import {
  PROCESS_EQUIPMENT,
  PROCESS_EQUIPMENT_CATEGORIES,
  PROCESS_EQUIPMENT_DOMAIN,
  PROCESS_SHAPES_3D,
} from "./processEquipmentCatalog";
import { PIPE_LAYERS } from "./pipingGeometry";

describe("process equipment catalog", () => {
  it("registers as its own symbol domain", () => {
    const set = getSymbolSet(PROCESS_EQUIPMENT_DOMAIN);
    expect(set.title).toBe("Process equipment");
    expect(set.symbols).toHaveLength(PROCESS_EQUIPMENT.length);
  });

  it("covers every category, with unique ids and glyphs", () => {
    const cats = new Set(PROCESS_EQUIPMENT.map((e) => e.category));
    expect([...cats]).toEqual([...PROCESS_EQUIPMENT_CATEGORIES]);
    expect(new Set(PROCESS_EQUIPMENT.map((e) => e.id)).size).toBe(PROCESS_EQUIPMENT.length);
    expect(new Set(PROCESS_EQUIPMENT.map((e) => e.glyph)).size).toBe(PROCESS_EQUIPMENT.length);
  });

  it.each(PROCESS_EQUIPMENT.map((e) => [e.id, e]))("%s is complete, plausible planning data", (_id, e) => {
    for (const k of ["widthIn", "depthIn"]) {
      expect(e[k]).toBeGreaterThan(0);
      expect(e[k]).toBeLessThanOrEqual(480); // plot footprint up to 40'
    }
    expect(e.heightIn).toBeGreaterThan(0);
    expect(e.heightIn).toBeLessThanOrEqual(1200); // flare stacks run to 100'

    expect(PROCESS_SHAPES_3D).toContain(e.shape3d);
    expect(e.tagPrefix).toMatch(/^[A-Z]{1,3}$/);
    expect(PIPE_LAYERS).toContain(e.defaultLayer);
    expect(e.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.isFrozen(e)).toBe(true);
  });

  it("uses generic industry names only (no model numbers or trademarks)", () => {
    for (const e of PROCESS_EQUIPMENT) {
      expect(e.label).not.toMatch(/\d{3,}|™|®/);
    }
  });
});

describe("coverage for refinery and chemical-plant work", () => {
  const ids = new Set(PROCESS_EQUIPMENT.map((e) => e.id));
  const has = (...list) => list.forEach((id) => expect(ids, id).toContain(id));

  it("has 100+ items across the 12 categories", () => {
    expect(PROCESS_EQUIPMENT.length).toBeGreaterThanOrEqual(100);
    expect(PROCESS_EQUIPMENT_CATEGORIES).toHaveLength(12);
  });

  it("covers pumps, compressors, and drivers", () => {
    has("centrifugal-pump", "vertical-can-pump", "submersible-pump", "gear-pump", "screw-pump",
      "metering-pump", "progressive-cavity-pump", "plunger-pump");
    has("centrifugal-compressor", "recip-compressor", "screw-compressor", "axial-compressor",
      "liquid-ring-vacuum-pump", "steam-ejector");
    has("electric-motor", "steam-turbine", "gas-turbine", "turboexpander", "diesel-engine", "gearbox");
  });

  it("covers fired equipment, exchangers, columns, and reactors", () => {
    has("fired-heater", "cylindrical-heater", "reformer-furnace", "cracking-furnace", "package-boiler",
      "firetube-boiler", "waste-heat-boiler", "thermal-oxidizer", "flare-stack", "stack");
    has("shell-tube-exchanger", "kettle-reboiler", "double-pipe-exchanger", "surface-condenser", "spiral-exchanger");
    has("packed-column", "absorber", "stripper", "vacuum-column",
      "fixed-bed-reactor", "fluidized-bed-reactor", "catalyst-regenerator", "tubular-reactor");
  });

  it("covers vessels, storage, separation, solids, and utilities", () => {
    has("knockout-drum", "three-phase-separator", "reflux-accumulator", "pressure-sphere", "lpg-bullet",
      "floating-roof-tank", "dome-roof-tank");
    has("desalter", "coalescer", "desiccant-dryer", "evaporator", "crystallizer", "filter-press",
      "baghouse", "electrostatic-precipitator", "wet-scrubber", "api-separator");
    has("bucket-elevator", "screw-conveyor", "rotary-valve", "crusher", "ball-mill");
    has("deaerator", "chiller-package");
  });

  it("keeps motors (M) and mixers (AG/MX) on distinct tag codes", () => {
    const prefix = (id) => PROCESS_EQUIPMENT.find((e) => e.id === id).tagPrefix;
    expect(prefix("electric-motor")).toBe("M");
    expect(prefix("agitated-tank")).toBe("AG");
    expect(prefix("static-mixer")).toBe("MX");
  });
});
