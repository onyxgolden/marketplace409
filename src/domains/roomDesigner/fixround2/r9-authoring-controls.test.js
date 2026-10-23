// R9 probe (PR #668 fix round 2) — authoring/repair controls absent.
// The fix-round-1 domain commands exist (setPipeUtility, setPipeSource,
// assignSprayTarget, setUnitBoundary, setReducerSizes, addUtilityRun)
// but no inspector control reaches them: an ordinary non-seed user
// cannot create or repair a D8/D9 design from the UI. Round 2 wires
// them through the reducer (undoable document actions) and adds the
// missing domain commands (spray aim, manway delete/restore, nozzle
// tombstone delete/restore, legacy retrofit).
//
// These probes FAIL against the round-1 implementation (the actions
// and domain commands do not exist) and must PASS after the fix.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  addUtilityRun,
  assignSprayTarget,
  createEmptyDesign,
  parseDesign,
  placeSymbol,
  resetDesignerIds,
  serializeDesign,
  setPipeSource,
  setSprayAim,
  setSymbolManwayDeleted,
  setSymbolNozzleTombstone,
  setUnitBoundary,
} from "../designerDocument";
import { anchorsOf } from "../pipeAttachments";
import { manwaySpec } from "../vesselAccess";
import { findSymbol } from "../symbolRegistry";
import { createInitialState, designerReducer } from "../../../components/designer/designerReducer";

beforeEach(() => {
  resetDesignerIds();
});

function baseDesign() {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v", tag: "V-101" });
  design = placeSymbol(design, "piping", "spray-nozzle", 900, 900, { id: "fa", tag: "FA-101" });
  design = placeSymbol(design, "piping", "reducer", 50, 0, { id: "red" });
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], { id: "run-1", diameterIn: 2 });
  return design;
}

describe("R9 domain authoring commands for D8/D9 repair", () => {
  it("setSprayAim records (and clears) the authored aim point", () => {
    let design = baseDesign();
    design = setSprayAim(design, "fa", { x: 0, y: 0 });
    expect(design.symbols.find((s) => s.id === "fa").aimAt).toEqual({ x: 0, y: 0 });
    design = setSprayAim(design, "fa", null);
    expect(design.symbols.find((s) => s.id === "fa").aimAt).toBeUndefined();
    expect(() => setSprayAim(design, "v", { x: 0, y: 0 })).toThrow();
  });

  it("manway delete/restore rides the tombstone, never the catalog", () => {
    let design = baseDesign();
    const symbol = findSymbol("processEquipment", "vertical-vessel");
    design = setSymbolManwayDeleted(design, "v", true);
    let inst = design.symbols.find((s) => s.id === "v");
    expect(manwaySpec(symbol, inst)).toBeNull();
    design = setSymbolManwayDeleted(design, "v", false);
    inst = design.symbols.find((s) => s.id === "v");
    expect(manwaySpec(symbol, inst)).toMatchObject({ diameterIn: 24, sillIn: 30 });
  });

  it("nozzle tombstone delete/restore removes and returns one anchor", () => {
    let design = baseDesign();
    design = setSymbolNozzleTombstone(design, "v", "side-out", true);
    let inst = design.symbols.find((s) => s.id === "v");
    expect(anchorsOf(inst).map((a) => a.id)).not.toContain("side-out");
    expect(anchorsOf(inst)).toHaveLength(6);
    design = setSymbolNozzleTombstone(design, "v", "side-out", false);
    inst = design.symbols.find((s) => s.id === "v");
    expect(anchorsOf(inst).map((a) => a.id)).toContain("side-out");
    expect(anchorsOf(inst)).toHaveLength(7);
  });

  it("an ordinary user builds D8/D9 from commands alone, then saves and reopens", () => {
    let design = baseDesign();
    // D8: utility identity + the three services' defaults + source.
    design = addUtilityRun(design, "plant-water", [{ x: 0, y: 500 }, { x: 400, y: 500 }], { id: "hdr" });
    expect(design.pipes.find((p) => p.id === "hdr").diameterIn).toBe(2);
    design = addUtilityRun(design, "plant-air", [{ x: 0, y: 520 }, { x: 400, y: 520 }], { id: "hdr-air", kind: "branch" });
    expect(design.pipes.find((p) => p.id === "hdr-air").diameterIn).toBe(1);
    design = addUtilityRun(design, "nitrogen", [{ x: 0, y: 540 }, { x: 400, y: 540 }], { id: "hdr-n2" });
    design = setPipeSource(design, "hdr", "plant-water");
    expect(design.pipes.find((p) => p.id === "hdr").sourceOf).toBe("plant-water");
    // D9: spray target + aim + the unit boundary.
    design = assignSprayTarget(design, "fa", "v");
    design = setSprayAim(design, "fa", { x: 0, y: 0 });
    design = setUnitBoundary(design, [
      { x: -100, y: -100 },
      { x: 500, y: -100 },
      { x: 500, y: 500 },
      { x: -100, y: 500 },
    ]);
    const reopened = parseDesign(serializeDesign(design));
    expect(reopened.pipes.find((p) => p.id === "hdr").sourceOf).toBe("plant-water");
    expect(reopened.symbols.find((s) => s.id === "fa").aimAt).toEqual({ x: 0, y: 0 });
  });
});

describe("R9 reducer actions wire the inspector controls", () => {
  const state = () => createInitialState(baseDesign());

  it("SET_PIPE_UTILITY sets and clears a run's service identity", () => {
    let s = state();
    s = designerReducer(s, { type: "SET_PIPE_UTILITY", pipeId: "run-1", utility: "plant-air" });
    expect(s.design.pipes.find((p) => p.id === "run-1").utility).toBe("plant-air");
    s = designerReducer(s, { type: "SET_PIPE_UTILITY", pipeId: "run-1", utility: null });
    expect(s.design.pipes.find((p) => p.id === "run-1").utility).toBeUndefined();
    const before = s;
    s = designerReducer(s, { type: "SET_PIPE_UTILITY", pipeId: "run-1", utility: "bogus" });
    expect(s).toBe(before); // soft-fail: unknown service changes nothing
  });

  it("SET_PIPE_SOURCE designates and clears the source run", () => {
    let s = state();
    s = designerReducer(s, { type: "SET_PIPE_UTILITY", pipeId: "run-1", utility: "firewater" });
    s = designerReducer(s, { type: "SET_PIPE_SOURCE", pipeId: "run-1", serviceId: "firewater" });
    expect(s.design.pipes.find((p) => p.id === "run-1").sourceOf).toBe("firewater");
    s = designerReducer(s, { type: "SET_PIPE_SOURCE", pipeId: "run-1", serviceId: null });
    expect(s.design.pipes.find((p) => p.id === "run-1").sourceOf).toBeUndefined();
  });

  it("SET_REDUCER_SIZES edits a placed reducer's declared transition", () => {
    let s = state();
    s = designerReducer(s, { type: "SET_REDUCER_SIZES", symbolId: "red", inletSizeIn: 12, outletSizeIn: 6 });
    const red = s.design.symbols.find((x) => x.id === "red");
    expect(red).toMatchObject({ inletSizeIn: 12, outletSizeIn: 6 });
  });

  it("ASSIGN_SPRAY_TARGET and SET_SPRAY_AIM author the D9 assignment", () => {
    let s = state();
    s = designerReducer(s, { type: "ASSIGN_SPRAY_TARGET", symbolId: "fa", vesselId: "v" });
    s = designerReducer(s, { type: "SET_SPRAY_AIM", symbolId: "fa", aimAt: { x: 0, y: 0 } });
    const fa = s.design.symbols.find((x) => x.id === "fa");
    expect(fa.protects).toBe("v");
    expect(fa.aimAt).toEqual({ x: 0, y: 0 });
  });

  it("SET_UNIT_BOUNDARY authors and clears the design boundary", () => {
    let s = state();
    const polygon = [
      { x: -100, y: -100 },
      { x: 500, y: -100 },
      { x: 500, y: 500 },
      { x: -100, y: 500 },
    ];
    s = designerReducer(s, { type: "SET_UNIT_BOUNDARY", polygon });
    expect(s.design.unitBoundary).toEqual(polygon);
    s = designerReducer(s, { type: "SET_UNIT_BOUNDARY", polygon: null });
    expect(s.design.unitBoundary).toBeUndefined();
  });

  it("component edit actions: manway delete, nozzle tombstone, retrofit", () => {
    let s = state();
    s = designerReducer(s, { type: "SET_SYMBOL_MANWAY_DELETED", symbolId: "v", deleted: true });
    expect(s.design.symbols.find((x) => x.id === "v").manway).toBeNull();
    s = designerReducer(s, { type: "SET_SYMBOL_MANWAY_DELETED", symbolId: "v", deleted: false });
    expect(s.design.symbols.find((x) => x.id === "v").manway).toBeUndefined();
    s = designerReducer(s, { type: "SET_SYMBOL_NOZZLE_TOMBSTONE", symbolId: "v", anchorId: "side-out", deleted: true });
    expect(s.design.symbols.find((x) => x.id === "v").nozzleTombstones).toEqual(["side-out"]);
    s = designerReducer(s, { type: "SET_SYMBOL_NOZZLE_TOMBSTONE", symbolId: "v", anchorId: "side-out", deleted: false });
    expect(s.design.symbols.find((x) => x.id === "v").nozzleTombstones).toBeUndefined();
  });

  it("RETROFIT_COMPONENTS enables a legacy document's components in one undoable action", () => {
    const legacy = {
      ...createEmptyDesign(),
      componentsVersion: undefined,
      symbols: [
        { id: "v", domain: "processEquipment", symbolId: "vertical-vessel", x: 0, y: 0, rotationDeg: 0, layer: "equipment", legacyComponents: true },
      ],
    };
    let s = createInitialState(legacy);
    s = designerReducer(s, { type: "RETROFIT_COMPONENTS" });
    expect(s.design.symbols.find((x) => x.id === "v").legacyComponents).toBeUndefined();
    expect(anchorsOf(s.design.symbols.find((x) => x.id === "v"))).toHaveLength(7);
  });
});
