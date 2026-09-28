// temaExchangerCatalog.test.js — TEMA entries registered in the process-equipment domain.

import { describe, expect, it } from "vitest";
import { findSymbol } from "./symbolRegistry";
import { PROCESS_EQUIPMENT, PROCESS_EQUIPMENT_CATEGORIES, PROCESS_EQUIPMENT_DOMAIN } from "./processEquipmentCatalog";
import {
  TEMA_CATEGORIES,
  TEMA_CATEGORY_GROUP,
  TEMA_EQUIPMENT,
  detailedVersionFor,
} from "./temaExchangerCatalog";
import { TEMA_PRESETS } from "./temaTypes";

const byCategory = (cat) => TEMA_EQUIPMENT.filter((e) => e.category === cat);

describe("TEMA catalog entries", () => {
  it("adds one configurable exchanger plus the 20 component shapes in their own categories", () => {
    expect(TEMA_CATEGORIES).toEqual(["TEMA exchangers", "TEMA front heads", "TEMA shells", "TEMA rear heads"]);
    expect(byCategory("TEMA exchangers").map((e) => e.id)).toEqual(["tema-exchanger"]);
    expect(byCategory("TEMA front heads")).toHaveLength(5);
    expect(byCategory("TEMA shells")).toHaveLength(7);
    expect(byCategory("TEMA rear heads")).toHaveLength(8);
    for (const e of TEMA_EQUIPMENT) expect(e.categoryGroup).toBe(TEMA_CATEGORY_GROUP);
  });

  it("registers every entry in the process-equipment domain after the existing catalog", () => {
    for (const e of TEMA_EQUIPMENT) {
      expect(findSymbol(PROCESS_EQUIPMENT_DOMAIN, e.id), e.id).toBeTruthy();
    }
    expect(PROCESS_EQUIPMENT.slice(-TEMA_EQUIPMENT.length).map((e) => e.id)).toEqual(TEMA_EQUIPMENT.map((e) => e.id));
    expect(PROCESS_EQUIPMENT_CATEGORIES.slice(-4)).toEqual(TEMA_CATEGORIES);
  });

  it("keeps the front and rear N heads as separate shapes", () => {
    const front = findSymbol(PROCESS_EQUIPMENT_DOMAIN, "tema-front-n");
    const rear = findSymbol(PROCESS_EQUIPMENT_DOMAIN, "tema-rear-n");
    expect(front.tema).toEqual({ kind: "component", position: "front", letter: "N", defaultMode: "detailed" });
    expect(rear.tema).toEqual({ kind: "component", position: "rear", letter: "N", defaultMode: "detailed" });
    expect(front.label).not.toBe(rear.label);
  });

  it("gives the assembled exchanger an AES default, the E tag prefix, and detailed drawing", () => {
    const hx = findSymbol(PROCESS_EQUIPMENT_DOMAIN, "tema-exchanger");
    expect(hx.tema.kind).toBe("assembly");
    expect(hx.tema.defaultConfig).toEqual(TEMA_PRESETS.AES);
    expect(hx.tema.defaultMode).toBe("detailed");
    expect(hx.tagPrefix).toBe("E");
    expect(hx.shape3d).toBe("hcyl");
  });

  it("leaves the existing simple exchanger entries untouched", () => {
    const st = findSymbol(PROCESS_EQUIPMENT_DOMAIN, "shell-tube-exchanger");
    expect(st).toMatchObject({ glyph: "hx-shell-tube", widthIn: 144, depthIn: 30, category: "Heat exchangers" });
    expect(st.tema).toBeUndefined();
    expect(findSymbol(PROCESS_EQUIPMENT_DOMAIN, "kettle-reboiler").tema).toBeUndefined();
  });
});

describe("detailedVersionFor", () => {
  it("maps the simple shell-and-tube and kettle symbols to the TEMA exchanger", () => {
    expect(detailedVersionFor(PROCESS_EQUIPMENT_DOMAIN, "shell-tube-exchanger")).toEqual({
      symbolId: "tema-exchanger", tema: TEMA_PRESETS.AES,
    });
    expect(detailedVersionFor(PROCESS_EQUIPMENT_DOMAIN, "kettle-reboiler")).toEqual({
      symbolId: "tema-exchanger", tema: { front: "B", shell: "K", rear: "U", tubePasses: 2 },
    });
  });

  it("returns null for symbols without a detailed version", () => {
    expect(detailedVersionFor(PROCESS_EQUIPMENT_DOMAIN, "centrifugal-pump")).toBeNull();
    expect(detailedVersionFor(PROCESS_EQUIPMENT_DOMAIN, "tema-exchanger")).toBeNull();
    expect(detailedVersionFor("piping", "shell-tube-exchanger")).toBeNull();
  });
});
