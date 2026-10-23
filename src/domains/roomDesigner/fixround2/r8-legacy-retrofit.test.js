// R8 probe (PR #668 fix round 2) — legacy retrofit and generated-
// component lifecycle are incomplete. ChatGPT's executed probe
// (legacy): a pre-feature-shaped saved vessel (only id / domain /
// symbolId / x / y / rotationDeg / layer) immediately gains 7 anchors
// + a manway (fx 0, fy 1, diameter 24, sill 30) + access on load —
// generated components materialize in a document that never had them,
// with no version gate and no explicit retrofit. Separately, the
// inspector's manway rows dereference manwaySpec(...) unguarded and
// crash on a tombstoned manway.
//
// These probes FAIL against the round-1 implementation and must PASS
// after the fix: loading a pre-marker document stamps its instances
// as legacy (generated nozzle/manway/downcomer/utility components
// stay OFF), and an explicit undoable retrofit enables them.

import { describe, expect, it, beforeEach } from "vitest";
import {
  createEmptyDesign,
  parseDesign,
  placeSymbol,
  resetDesignerIds,
  retrofitDesignComponents,
  serializeDesign,
  DESIGN_COMPONENTS_VERSION,
} from "../designerDocument";
import { findSymbol } from "../symbolRegistry";
import { anchorsOf, connectionFaceForAnchor } from "../pipeAttachments";
import { accessPackageWorld, manwaySpec } from "../vesselAccess";
import { downcomerLevels } from "../downcomers";

beforeEach(() => {
  resetDesignerIds();
});

/** A pre-feature document: no components marker, bare instances. */
function legacyJson() {
  const doc = {
    version: 1,
    name: "Legacy",
    settings: { wallHeightIn: 108, wallThicknessIn: 4.5, gridIn: 6, snapEnabled: true },
    walls: [],
    rooms: [],
    openings: [],
    furniture: [],
    pipes: [],
    symbols: [
      { id: "v", domain: "processEquipment", symbolId: "vertical-vessel", x: 0, y: 0, rotationDeg: 0, layer: "equipment" },
      { id: "c", domain: "processEquipment", symbolId: "column", x: 500, y: 0, rotationDeg: 0, layer: "equipment" },
    ],
    orgCharts: [],
    underlay: null,
    sheets: [],
    decks: [],
    cameraViews: [],
    annotations: [],
    mode: "industrial",
  };
  return JSON.stringify(doc);
}

describe("R8 legacy documents are version-gated until an explicit retrofit", () => {
  it("new documents carry the components marker", () => {
    expect(createEmptyDesign().componentsVersion).toBe(DESIGN_COMPONENTS_VERSION);
  });

  it("a pre-marker document loads with generated components gated OFF", () => {
    const design = parseDesign(legacyJson());
    const vessel = design.symbols.find((s) => s.id === "v");
    expect(vessel.legacyComponents).toBe(true);
    const symbol = findSymbol(vessel.domain, vessel.symbolId);
    // No materialized anchors, manway, or access package on load.
    expect(anchorsOf(vessel)).toEqual([]);
    expect(manwaySpec(symbol, vessel)).toBeNull();
    expect(accessPackageWorld(symbol, vessel, design)).toBeNull();
    expect(connectionFaceForAnchor(symbol, vessel, "side-out")).toBeNull();
    // Downcomer levels stay off too.
    const column = design.symbols.find((s) => s.id === "c");
    const columnSymbol = findSymbol(column.domain, column.symbolId);
    expect(downcomerLevels(columnSymbol, column, design)).toEqual([]);
  });

  it("the explicit retrofit enables the generated components", () => {
    const design = retrofitDesignComponents(parseDesign(legacyJson()));
    const vessel = design.symbols.find((s) => s.id === "v");
    expect(vessel.legacyComponents).toBeUndefined();
    const symbol = findSymbol(vessel.domain, vessel.symbolId);
    // 4 catalog nozzles + 3 utility ports, the catalog manway, access.
    expect(anchorsOf(vessel)).toHaveLength(7);
    expect(manwaySpec(symbol, vessel)).toMatchObject({ diameterIn: 24, sillIn: 30 });
    expect(accessPackageWorld(symbol, vessel, design)).not.toBeNull();
    const column = design.symbols.find((s) => s.id === "c");
    const columnSymbol = findSymbol(column.domain, column.symbolId);
    expect(downcomerLevels(columnSymbol, column, design).length).toBeGreaterThan(0);
  });

  it("a current document round-trips with no legacy stamps", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    const parsed = parseDesign(serializeDesign(design));
    const vessel = parsed.symbols.find((s) => s.id === "v");
    expect(vessel.legacyComponents).toBeUndefined();
    expect(anchorsOf(vessel)).toHaveLength(7);
  });

  it("an authored nozzle override on a legacy instance is user data, not generated", () => {
    const doc = JSON.parse(legacyJson());
    doc.symbols[0].nozzles = [{ id: "custom-1", fx: 1, fy: 0, sizeIn: 4 }];
    const design = parseDesign(JSON.stringify(doc));
    const vessel = design.symbols.find((s) => s.id === "v");
    // The authored override survives the gate; the generated sets
    // (catalog defaults are replaced by the override, downcomer and
    // utility additions) stay off.
    expect(anchorsOf(vessel).map((a) => a.id)).toEqual(["custom-1"]);
  });

  it("a tombstoned manway resolves to null (the inspector guard contract)", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    design = {
      ...design,
      symbols: design.symbols.map((s) => (s.id === "v" ? { ...s, manway: null } : s)),
    };
    const symbol = findSymbol("processEquipment", "vertical-vessel");
    const inst = design.symbols.find((s) => s.id === "v");
    expect(manwaySpec(symbol, inst)).toBeNull();
    expect(accessPackageWorld(symbol, inst, design)).toBeNull();
  });
});
