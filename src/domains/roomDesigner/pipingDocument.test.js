import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  deletePipeRun,
  deleteSymbol,
  findPipeRun,
  findSymbolInstance,
  movePipeVertex,
  moveSymbol,
  placeSymbol,
  resetDesignerIds,
  rotateSymbol,
  setPipeFields,
  setSymbolLayer,
  setSymbolTag,
  validateDesign,
} from "./designerDocument";
import { getSymbolSet } from "./symbolRegistry";
import "./pipingCatalog";

beforeEach(() => {
  resetDesignerIds();
});

const RUN = [
  { x: 0, y: 0 },
  { x: 120, y: 0 },
  { x: 120, y: 60 },
];

describe("piping document — pipe runs", () => {
  it("adds a run with diameter, material, service, and layer", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, RUN, { diameterIn: 4, material: "Carbon steel", service: "Steam", layer: "piping" });
    expect(d.pipes).toHaveLength(1);
    const run = d.pipes[0];
    expect(run.diameterIn).toBe(4);
    expect(run.material).toBe("Carbon steel");
    expect(run.service).toBe("Steam");
    expect(run.layer).toBe("piping");
    expect(run.points).toHaveLength(3);
  });

  it("collapses near-duplicate consecutive vertices", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100.1, y: 0 }]);
    expect(d.pipes[0].points).toHaveLength(2);
  });

  it("rejects runs with fewer than two distinct points", () => {
    const d = createEmptyDesign();
    expect(() => addPipeRun(d, [{ x: 0, y: 0 }])).toThrow(/two distinct points/);
    expect(() => addPipeRun(d, [{ x: 0, y: 0 }, { x: 0.1, y: 0 }])).toThrow(/two distinct points/);
  });

  it("rejects bad diameters and falls back unknown layers", () => {
    const d = createEmptyDesign();
    expect(() => addPipeRun(d, RUN, { diameterIn: 0 })).toThrow(/diameter/i);
    expect(() => addPipeRun(d, RUN, { diameterIn: 60 })).toThrow(/diameter/i);
    const withBadLayer = addPipeRun(d, RUN, { layer: "nope" });
    expect(withBadLayer.pipes[0].layer).toBe("piping");
  });

  it("deletes a run and finds runs by id", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, RUN);
    const id = d.pipes[0].id;
    expect(findPipeRun(d, id)).toBeDefined();
    d = deletePipeRun(d, id);
    expect(d.pipes).toHaveLength(0);
    expect(findPipeRun(d, id)).toBeUndefined();
  });

  it("patches run fields; blank material/service clears them", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, RUN, { diameterIn: 2, material: "PVC", service: "Drain/waste" });
    const id = d.pipes[0].id;
    d = setPipeFields(d, id, { diameterIn: 3, material: "", layer: "equipment" });
    const run = findPipeRun(d, id);
    expect(run.diameterIn).toBe(3);
    expect(run.material).toBeUndefined();
    expect(run.service).toBe("Drain/waste");
    expect(run.layer).toBe("equipment");
    expect(() => setPipeFields(d, "missing", { diameterIn: 2 })).toThrow(/Unknown pipe run/);
  });

  it("moves a single vertex", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, RUN);
    const id = d.pipes[0].id;
    d = movePipeVertex(d, id, 1, { x: 120, y: 30 });
    expect(findPipeRun(d, id).points[1]).toEqual({ x: 120, y: 30 });
    expect(() => movePipeVertex(d, id, 9, { x: 0, y: 0 })).toThrow(/out of range/);
    expect(() => movePipeVertex(d, id, 0, { x: NaN, y: 0 })).toThrow(/valid point/);
  });
});

describe("piping document — symbol instances", () => {
  it("registers the piping symbol set with the expected symbols", () => {
    const set = getSymbolSet("piping");
    expect(set.title).toBe("Piping");
    const ids = set.symbols.map((s) => s.id);
    for (const id of [
      "gate-valve", "ball-valve", "check-valve", "pump", "tank",
      "elbow", "tee", "reducer", "flow-arrow", "equipment-tag",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("places a symbol with its catalog default layer", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "piping", "pump", 100, 200, { tag: "P-101" });
    expect(d.symbols).toHaveLength(1);
    const inst = d.symbols[0];
    expect(inst.domain).toBe("piping");
    expect(inst.symbolId).toBe("pump");
    expect(inst.layer).toBe("equipment"); // catalog default
    expect(inst.tag).toBe("P-101");
  });

  it("honors an explicit layer and normalizes rotation", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "piping", "gate-valve", 10, 10, { rotationDeg: 450, layer: "annotations" });
    expect(d.symbols[0].rotationDeg).toBe(90);
    expect(d.symbols[0].layer).toBe("annotations");
  });

  it("rejects unknown symbols and bad positions", () => {
    const d = createEmptyDesign();
    expect(() => placeSymbol(d, "piping", "nope", 0, 0)).toThrow(/Unknown symbol/);
    expect(() => placeSymbol(d, "nope", "pump", 0, 0)).toThrow(/Unknown symbol/);
    expect(() => placeSymbol(d, "piping", "pump", NaN, 0)).toThrow(/valid/);
  });

  it("moves, rotates, retags, relayers, and deletes instances", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "piping", "gate-valve", 0, 0);
    const id = d.symbols[0].id;
    d = moveSymbol(d, id, 50, 60);
    expect(findSymbolInstance(d, id)).toMatchObject({ x: 50, y: 60 });
    d = rotateSymbol(d, id, 180);
    expect(findSymbolInstance(d, id).rotationDeg).toBe(180);
    d = setSymbolTag(d, id, "XV-200");
    expect(findSymbolInstance(d, id).tag).toBe("XV-200");
    d = setSymbolTag(d, id, "  ");
    expect(findSymbolInstance(d, id).tag).toBeUndefined();
    d = setSymbolLayer(d, id, "equipment");
    expect(findSymbolInstance(d, id).layer).toBe("equipment");
    expect(() => setSymbolLayer(d, id, "nope")).toThrow(/Unknown layer/);
    d = deleteSymbol(d, id);
    expect(d.symbols).toHaveLength(0);
    expect(() => moveSymbol(d, id, 0, 0)).toThrow(/Unknown symbol instance/);
  });
});

describe("piping document — validation", () => {
  it("flags degenerate runs and unknown symbols", () => {
    let d = createEmptyDesign();
    d = { ...d, pipes: [{ id: "p1", points: [{ x: 0, y: 0 }], diameterIn: 2, layer: "piping" }] };
    d = { ...d, symbols: [{ id: "s1", domain: "piping", symbolId: "nope", x: 0, y: 0, rotationDeg: 0, layer: "piping" }] };
    const errors = validateDesign(d);
    expect(errors.some((e) => e.includes("p1"))).toBe(true);
    expect(errors.some((e) => e.includes("s1"))).toBe(true);
  });

  it("accepts a well-formed piping design", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, RUN, { diameterIn: 2 });
    d = placeSymbol(d, "piping", "gate-valve", 60, 0);
    expect(validateDesign(d)).toEqual([]);
  });

  it("old designs without pipes/symbols still validate", () => {
    const legacy = { version: 1, name: "old", settings: {}, walls: [], rooms: [], openings: [], furniture: [] };
    expect(validateDesign(legacy)).toEqual([]);
  });
});
