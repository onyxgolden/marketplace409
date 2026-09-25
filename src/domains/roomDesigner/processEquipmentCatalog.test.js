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
    for (const k of ["widthIn", "depthIn", "heightIn"]) {
      expect(e[k]).toBeGreaterThan(0);
      expect(e[k]).toBeLessThanOrEqual(480); // nothing taller/wider than 40'
    }
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
