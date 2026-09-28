// temaInstances.test.js — optional TEMA fields on placed symbol instances:
// configuration, drawing mode, size, and replace-with-detailed.

import { describe, expect, it } from "vitest";
import {
  DESIGN_VERSION,
  createEmptyDesign,
  parseDesign,
  placeSymbol,
  rotateSymbol,
  serializeDesign,
  setSymbolLayer,
  setSymbolTag,
  validateDesign,
} from "./designerDocument";
import { TEMA_PRESETS } from "./temaTypes";
import {
  DRAWING_MODES,
  initialTemaFields,
  instanceDrawingMode,
  nearestConnectionAnchor,
  replaceWithDetailedVersion,
  setSymbolDrawingMode,
  setSymbolSize,
  setSymbolTemaConfig,
  supportsDrawingModes,
  temaInstanceErrors,
} from "./temaInstances";
import { findSymbol } from "./symbolRegistry";
import { temaAnchorsWorld } from "./temaGeometry";

const D = "processEquipment";
const hxSymbol = () => findSymbol(D, "tema-exchanger");

function withExchanger() {
  const design = placeSymbol(createEmptyDesign(), D, "tema-exchanger", 120, 60, { id: "hx", tag: "E-101" });
  return setSymbolTemaConfig(design, "hx", initialTemaFields(hxSymbol()).tema);
}

describe("placement", () => {
  it("stores the default configuration on a new exchanger, but no mode (default look)", () => {
    expect(initialTemaFields(hxSymbol())).toEqual({ tema: { ...TEMA_PRESETS.AES } });
    expect(initialTemaFields(findSymbol(D, "tema-front-a"))).toEqual({});
    expect(initialTemaFields(findSymbol(D, "centrifugal-pump"))).toEqual({});
    const inst = withExchanger().symbols[0];
    expect(inst.tema).toEqual({ front: "A", shell: "E", rear: "S", tubePasses: 2 });
    expect(inst.drawingMode).toBeUndefined();
  });
});

describe("setSymbolTemaConfig", () => {
  it("saves a valid configuration and survives serialize/parse without a version bump", () => {
    const design = setSymbolTemaConfig(withExchanger(), "hx", { front: "b", shell: "e", rear: "u", tubePasses: 4 });
    expect(design.symbols[0].tema).toEqual({ front: "B", shell: "E", rear: "U", tubePasses: 4 });
    const reopened = parseDesign(serializeDesign(design));
    expect(reopened.version).toBe(DESIGN_VERSION);
    expect(DESIGN_VERSION).toBe(1);
    expect(reopened.symbols[0].tema).toEqual({ front: "B", shell: "E", rear: "U", tubePasses: 4 });
    expect(validateDesign(reopened)).toEqual([]);
  });

  it("refuses blocked combinations and leaves the design unchanged", () => {
    const design = withExchanger();
    expect(() => setSymbolTemaConfig(design, "hx", { front: "B", shell: "E", rear: "U", tubePasses: 1 })).toThrow(/even number/);
    expect(() => setSymbolTemaConfig(design, "hx", { front: "Q", shell: "E", rear: "S" })).toThrow(/Front head/);
    expect(design.symbols[0].tema).toEqual({ ...TEMA_PRESETS.AES });
  });

  it("allows unusual (warned) combinations", () => {
    const design = setSymbolTemaConfig(withExchanger(), "hx", { front: "N", shell: "E", rear: "S", tubePasses: 2 });
    expect(design.symbols[0].tema.front).toBe("N");
  });

  it("only applies to configurable exchangers", () => {
    const design = placeSymbol(createEmptyDesign(), D, "centrifugal-pump", 0, 0, { id: "p" });
    expect(() => setSymbolTemaConfig(design, "p", TEMA_PRESETS.AES)).toThrow(/configurable TEMA/);
    expect(() => setSymbolTemaConfig(design, "nope", TEMA_PRESETS.AES)).toThrow(/Unknown symbol instance/);
  });
});

describe("drawing mode", () => {
  it("defaults to the catalog look and toggles without losing anything", () => {
    const hx = hxSymbol();
    expect(DRAWING_MODES).toEqual(["detailed", "pid"]);
    expect(supportsDrawingModes(hx)).toBe(true);
    expect(supportsDrawingModes(findSymbol(D, "shell-tube-exchanger"))).toBe(false);
    let design = setSymbolTemaConfig(withExchanger(), "hx", TEMA_PRESETS.BEU);
    design = rotateSymbol(design, "hx", 90);
    design = setSymbolSize(design, "hx", { widthIn: 240, depthIn: 48 });
    expect(instanceDrawingMode(hx, design.symbols[0])).toBe("detailed");
    const before = design.symbols[0];
    design = setSymbolDrawingMode(design, "hx", "pid");
    expect(instanceDrawingMode(hx, design.symbols[0])).toBe("pid");
    design = setSymbolDrawingMode(design, "hx", "detailed");
    const after = design.symbols[0];
    expect({ ...after, drawingMode: undefined }).toEqual({ ...before, drawingMode: undefined });
    expect(after).toMatchObject({ tema: { ...TEMA_PRESETS.BEU }, rotationDeg: 90, widthIn: 240, depthIn: 48, tag: "E-101", x: 120, y: 60 });
  });

  it("rejects unknown modes and symbols without two drawings", () => {
    expect(() => setSymbolDrawingMode(withExchanger(), "hx", "fancy")).toThrow(/Drawing mode/);
    const design = placeSymbol(createEmptyDesign(), D, "centrifugal-pump", 0, 0, { id: "p" });
    expect(() => setSymbolDrawingMode(design, "p", "pid")).toThrow(/only one drawing/);
    expect(instanceDrawingMode(findSymbol(D, "centrifugal-pump"), design.symbols[0])).toBeNull();
  });
});

describe("setSymbolSize", () => {
  it("sets a per-instance footprint and rejects bad numbers", () => {
    let design = setSymbolSize(withExchanger(), "hx", { widthIn: 300 });
    expect(design.symbols[0]).toMatchObject({ widthIn: 300 });
    expect(design.symbols[0].depthIn).toBeUndefined();
    design = setSymbolSize(design, "hx", { depthIn: 36 });
    expect(design.symbols[0]).toMatchObject({ widthIn: 300, depthIn: 36 });
    expect(() => setSymbolSize(design, "hx", { widthIn: 0 })).toThrow(/positive/);
    expect(() => setSymbolSize(design, "hx", { depthIn: Number.NaN })).toThrow(/positive/);
  });
});

describe("replaceWithDetailedVersion", () => {
  it("swaps a simple shell-and-tube for the TEMA exchanger, keeping position, rotation, size, tag and layer", () => {
    let design = placeSymbol(createEmptyDesign(), D, "shell-tube-exchanger", 40, 80, { id: "old", tag: "E-205", rotationDeg: 45 });
    design = setSymbolLayer(design, "old", "annotations");
    design = replaceWithDetailedVersion(design, "old");
    expect(design.symbols).toHaveLength(1);
    expect(design.symbols[0]).toEqual({
      id: "old",
      domain: D,
      symbolId: "tema-exchanger",
      x: 40,
      y: 80,
      rotationDeg: 45,
      layer: "annotations",
      tag: "E-205",
      widthIn: 144, // the simple symbol's nominal footprint, kept
      depthIn: 30,
      tema: { ...TEMA_PRESETS.AES },
    });
    expect(validateDesign(design)).toEqual([]);
  });

  it("maps a kettle reboiler to BKU and keeps an instance size override", () => {
    let design = placeSymbol(createEmptyDesign(), D, "kettle-reboiler", 0, 0, { id: "k", widthIn: 200, depthIn: 70 });
    design = replaceWithDetailedVersion(design, "k");
    expect(design.symbols[0]).toMatchObject({ symbolId: "tema-exchanger", widthIn: 200, depthIn: 70, tema: { front: "B", shell: "K", rear: "U", tubePasses: 2 } });
  });

  it("refuses symbols that have no detailed version", () => {
    const design = placeSymbol(createEmptyDesign(), D, "centrifugal-pump", 0, 0, { id: "p" });
    expect(() => replaceWithDetailedVersion(design, "p")).toThrow(/no detailed version/);
  });
});

describe("validation of saved TEMA fields", () => {
  it("flags blocked configurations, stray tema fields and unknown modes", () => {
    const hx = hxSymbol();
    const pump = findSymbol(D, "centrifugal-pump");
    expect(temaInstanceErrors({ id: "a", tema: { front: "B", shell: "E", rear: "U", tubePasses: 1 } }, hx)[0]).toMatch(/even number/);
    expect(temaInstanceErrors({ id: "a", tema: TEMA_PRESETS.AES }, pump)[0]).toMatch(/not a configurable TEMA/);
    expect(temaInstanceErrors({ id: "a", drawingMode: "3d" }, hx)[0]).toMatch(/drawing mode/);
    expect(temaInstanceErrors({ id: "a" }, pump)).toEqual([]);
    const design = setSymbolTag(withExchanger(), "hx", "E-101");
    design.symbols[0] = { ...design.symbols[0], tema: { front: "B", shell: "E", rear: "U", tubePasses: 1 } };
    expect(validateDesign(design).join(" ")).toMatch(/even number/);
  });

  it("keeps old drawings valid and byte-identical through save/load", () => {
    const design = placeSymbol(createEmptyDesign(), D, "shell-tube-exchanger", 10, 20, { id: "s", tag: "E-101" });
    const json = serializeDesign(design);
    expect(serializeDesign(parseDesign(json))).toBe(json);
    expect(validateDesign(parseDesign(json))).toEqual([]);
  });
});

describe("nearestConnectionAnchor", () => {
  it("finds the closest nozzle within the radius, in plan coordinates", () => {
    let design = placeSymbol(createEmptyDesign(), D, "tema-exchanger", 100, 100, { id: "hx" });
    design = setSymbolTemaConfig(design, "hx", TEMA_PRESETS.AES);
    const anchors = temaAnchorsWorld(hxSymbol(), design.symbols[0]);
    const tubeIn = anchors.find((a) => a.id === "tube-in");
    const hit = nearestConnectionAnchor(design, { x: tubeIn.x + 3, y: tubeIn.y - 2 }, 6);
    expect(hit).toMatchObject({ symbolInstanceId: "hx", anchorId: "tube-in", x: tubeIn.x, y: tubeIn.y });
    expect(nearestConnectionAnchor(design, { x: tubeIn.x, y: tubeIn.y - 30 }, 6)).toBeNull();
  });

  it("ignores symbols without connection anchors", () => {
    const design = placeSymbol(createEmptyDesign(), D, "centrifugal-pump", 0, 0, { id: "p" });
    expect(nearestConnectionAnchor(design, { x: 0, y: 0 }, 100)).toBeNull();
  });

  it("gives the same anchors in detailed and P&ID mode", () => {
    let design = placeSymbol(createEmptyDesign(), D, "tema-exchanger", 0, 0, { id: "hx", rotationDeg: 90 });
    design = setSymbolTemaConfig(design, "hx", TEMA_PRESETS.BEM);
    const detailed = temaAnchorsWorld(hxSymbol(), design.symbols[0]);
    const pid = temaAnchorsWorld(hxSymbol(), setSymbolDrawingMode(design, "hx", "pid").symbols[0]);
    expect(pid).toEqual(detailed);
  });
});
