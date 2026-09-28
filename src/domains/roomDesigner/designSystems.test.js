// designSystems.test.js — named systems (e.g. "Cooling water") that color
// every pipe run and piece of equipment in them, per-object color
// overrides, and underground pipe. All fields optional: a design without
// them draws exactly as before.

import { beforeEach, describe, expect, it } from "vitest";
import {
  SYSTEM_PALETTE,
  addSystem,
  deleteSystem,
  effectiveColor,
  setMemberColor,
  setMemberSystem,
  setPipeUnderground,
  systemErrors,
  systemLegend,
  updateSystem,
} from "./designSystems";
import {
  addPipeRun,
  createEmptyDesign,
  parseDesign,
  placeSymbol,
  resetDesignerIds,
  serializeDesign,
  validateDesign,
} from "./designerDocument";

beforeEach(() => resetDesignerIds());

function plant() {
  let d = createEmptyDesign("Plant");
  d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 120, y: 0 }], { id: "cw-supply" });
  d = addPipeRun(d, [{ x: 0, y: 60 }, { x: 120, y: 60 }], { id: "steam" });
  d = placeSymbol(d, "processEquipment", "centrifugal-pump", 200, 0, { id: "p1" });
  d = placeSymbol(d, "processEquipment", "centrifugal-pump", 200, 60, { id: "p2" });
  return d;
}

describe("systems", () => {
  it("a new design has no systems and every member draws its default color", () => {
    const d = plant();
    expect(d.systems).toBeUndefined();
    expect(effectiveColor(d, d.pipes[0], "#7dd3fc")).toBe("#7dd3fc");
    expect(systemLegend(d)).toEqual([]);
  });

  it("adds, renames and recolors a system; ids are stable and unique", () => {
    let d = addSystem(plant(), { name: "Cooling water", color: "#22c55e" });
    d = addSystem(d, { name: "Steam", color: "#ef4444" });
    expect(d.systems.map((s) => s.id)).toEqual(["system_1", "system_2"]);
    d = updateSystem(d, "system_1", { name: "CW", color: "#16a34a" });
    expect(d.systems[0]).toEqual({ id: "system_1", name: "CW", color: "#16a34a" });
  });

  it("pipes AND equipment in a system take its color; an object's own color wins", () => {
    let d = addSystem(plant(), { name: "Cooling water", color: "#22c55e" });
    d = setMemberSystem(d, { kind: "pipe", id: "cw-supply" }, "system_1");
    d = setMemberSystem(d, { kind: "symbol", id: "p1" }, "system_1");
    const pipe = d.pipes.find((p) => p.id === "cw-supply");
    const pump = d.symbols.find((s) => s.id === "p1");
    expect(effectiveColor(d, pipe, "#7dd3fc")).toBe("#22c55e");
    expect(effectiveColor(d, pump, "#60a5fa")).toBe("#22c55e");
    d = setMemberColor(d, { kind: "symbol", id: "p1" }, "#f97316");
    expect(effectiveColor(d, d.symbols.find((s) => s.id === "p1"), "#60a5fa")).toBe("#f97316");
    d = setMemberColor(d, { kind: "symbol", id: "p1" }, null);
    expect(effectiveColor(d, d.symbols.find((s) => s.id === "p1"), "#60a5fa")).toBe("#22c55e");
  });

  it("any process-equipment item can take its own color without a system", () => {
    const d = setMemberColor(plant(), { kind: "symbol", id: "p2" }, "#a855f7");
    expect(effectiveColor(d, d.symbols.find((s) => s.id === "p2"), "#60a5fa")).toBe("#a855f7");
  });

  it("recoloring a system recolors every member at once", () => {
    let d = addSystem(plant(), { name: "Steam", color: "#ef4444" });
    d = setMemberSystem(d, { kind: "pipe", id: "steam" }, "system_1");
    d = setMemberSystem(d, { kind: "symbol", id: "p2" }, "system_1");
    d = updateSystem(d, "system_1", { color: "#f59e0b" });
    expect(effectiveColor(d, d.pipes.find((p) => p.id === "steam"), "x")).toBe("#f59e0b");
    expect(effectiveColor(d, d.symbols.find((s) => s.id === "p2"), "x")).toBe("#f59e0b");
  });

  it("deleting a system unassigns its members and deletes nothing else", () => {
    let d = addSystem(plant(), { name: "Steam", color: "#ef4444" });
    d = setMemberSystem(d, { kind: "pipe", id: "steam" }, "system_1");
    d = setMemberSystem(d, { kind: "symbol", id: "p2" }, "system_1");
    d = deleteSystem(d, "system_1");
    expect(d.systems).toEqual([]);
    expect(d.pipes).toHaveLength(2);
    expect(d.symbols).toHaveLength(2);
    expect(d.pipes.find((p) => p.id === "steam").systemId).toBeUndefined();
    expect(d.symbols.find((s) => s.id === "p2").systemId).toBeUndefined();
  });

  it("legend lists only systems in use, with member counts, in system order", () => {
    let d = addSystem(plant(), { name: "Cooling water", color: "#22c55e" });
    d = addSystem(d, { name: "Unused", color: "#64748b" });
    d = addSystem(d, { name: "Steam", color: "#ef4444" });
    d = setMemberSystem(d, { kind: "pipe", id: "steam" }, "system_3");
    d = setMemberSystem(d, { kind: "pipe", id: "cw-supply" }, "system_1");
    d = setMemberSystem(d, { kind: "symbol", id: "p1" }, "system_1");
    expect(systemLegend(d)).toEqual([
      { id: "system_1", name: "Cooling water", color: "#22c55e", count: 2 },
      { id: "system_3", name: "Steam", color: "#ef4444", count: 1 },
    ]);
  });

  it("marks and clears underground pipe", () => {
    let d = setPipeUnderground(plant(), "cw-supply", true);
    expect(d.pipes.find((p) => p.id === "cw-supply").underground).toBe(true);
    d = setPipeUnderground(d, "cw-supply", false);
    expect("underground" in d.pipes.find((p) => p.id === "cw-supply")).toBe(false);
  });

  it("round-trips through save/reopen and validates clean", () => {
    let d = addSystem(plant(), { name: "Cooling water", color: "#22c55e" });
    d = setMemberSystem(d, { kind: "pipe", id: "cw-supply" }, "system_1");
    d = setMemberColor(d, { kind: "symbol", id: "p2" }, "#a855f7");
    d = setPipeUnderground(d, "cw-supply", true);
    const back = parseDesign(serializeDesign(d));
    expect(back.systems).toEqual(d.systems);
    expect(back.pipes.find((p) => p.id === "cw-supply")).toMatchObject({ systemId: "system_1", underground: true });
    expect(validateDesign(back)).toEqual([]);
  });

  it("rejects bad input", () => {
    const d = addSystem(plant(), { name: "Steam", color: "#ef4444" });
    expect(() => addSystem(d, { name: "", color: "#000000" })).toThrow(/name/i);
    expect(() => addSystem(d, { name: "steam", color: "#000000" })).toThrow(/already/i);
    expect(() => addSystem(d, { name: "X", color: "red" })).toThrow(/color/i);
    expect(() => updateSystem(d, "nope", { name: "Y" })).toThrow(/Unknown system/);
    expect(() => setMemberSystem(d, { kind: "pipe", id: "steam" }, "nope")).toThrow(/Unknown system/);
    expect(() => setMemberSystem(d, { kind: "wall", id: "w" }, null)).toThrow(/pipe or symbol/);
    expect(() => setMemberColor(d, { kind: "symbol", id: "p1" }, "#12345")).toThrow(/color/i);
    expect(() => setMemberColor(d, { kind: "symbol", id: "zz" }, null)).toThrow(/Unknown/);
  });

  it("offers a starter palette of valid, distinct colors", () => {
    expect(SYSTEM_PALETTE.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SYSTEM_PALETTE).size).toBe(SYSTEM_PALETTE.length);
    for (const c of SYSTEM_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("systemErrors (via validateDesign)", () => {
  it("reports dangling system ids, bad colors and duplicate names", () => {
    const d = plant();
    const bad = {
      ...d,
      systems: [{ id: "s1", name: "A", color: "#000000" }, { id: "s2", name: "a", color: "blue" }],
      pipes: d.pipes.map((p, i) => (i === 0 ? { ...p, systemId: "ghost", color: "#zzzzzz" } : p)),
    };
    const errors = systemErrors(bad);
    expect(errors.some((e) => /ghost/.test(e))).toBe(true);
    expect(errors.some((e) => /blue/.test(e))).toBe(true);
    expect(errors.some((e) => /#zzzzzz/.test(e))).toBe(true);
    expect(errors.some((e) => /duplicate/i.test(e))).toBe(true);
    expect(validateDesign(bad).length).toBeGreaterThanOrEqual(errors.length);
  });
});
