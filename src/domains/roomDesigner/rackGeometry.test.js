// rackGeometry.test.js — parametric pipe rack / sleeper rack: bents,
// tiers, top-of-steel elevation, and the structural members drawn in 3D
// and on the plan. Stored as an optional `rack` object on the instance.

import { beforeEach, describe, expect, it } from "vitest";
import {
  RACK_LIMITS,
  rackBentOffsets,
  rackErrors,
  rackLabel,
  rackMembers3D,
  rackParams,
  rackTopIn,
  setRackParams,
} from "./rackGeometry";
import { createEmptyDesign, parseDesign, placeSymbol, resetDesignerIds, serializeDesign, validateDesign } from "./designerDocument";
import { findSymbol } from "./symbolRegistry";

beforeEach(() => resetDesignerIds());

const pipeRack = () => findSymbol("processEquipment", "pipe-rack");
const sleeper = () => findSymbol("processEquipment", "sleeper-rack");

describe("catalog", () => {
  it("offers a pipe rack and a sleeper rack under Structures", () => {
    expect(pipeRack()).toMatchObject({ category: "Structures", rack: { kind: "pipe" }, shape3d: "rack" });
    expect(sleeper()).toMatchObject({ category: "Structures", rack: { kind: "sleeper" }, shape3d: "rack" });
  });
});

describe("rackParams", () => {
  it("uses catalog defaults: pipe rack 2 tiers, TOS 15'-0\", 6'-0\" between tiers, 20'-0\" bents", () => {
    const p = rackParams(pipeRack(), {});
    expect(p).toMatchObject({ kind: "pipe", tiers: 2, elevationIn: 180, tierSpacingIn: 72, bentSpacingIn: 240, lengthIn: 480, widthIn: 240 });
  });

  it("sleeper rack defaults: 1 level at TOS 1'-6\", sleepers every 10'-0\"", () => {
    expect(rackParams(sleeper(), {})).toMatchObject({ kind: "sleeper", tiers: 1, elevationIn: 18, bentSpacingIn: 120 });
  });

  it("reads instance size and rack overrides; ignores out-of-range values", () => {
    const p = rackParams(pipeRack(), { widthIn: 960, depthIn: 180, rack: { tiers: 3, elevationIn: 240, tierSpacingIn: 99999 } });
    expect(p).toMatchObject({ lengthIn: 960, widthIn: 180, tiers: 3, elevationIn: 240, tierSpacingIn: 72 });
  });

  it("a sleeper rack is always one level", () => {
    expect(rackParams(sleeper(), { rack: { tiers: 3 } }).tiers).toBe(1);
  });
});

describe("bents and height", () => {
  it("spaces bents evenly with spans no longer than requested, both ends included", () => {
    expect(rackBentOffsets(480, 240)).toEqual([-240, 0, 240]);
    const odd = rackBentOffsets(500, 240);
    [-250, -250 / 3, 250 / 3, 250].forEach((v, i) => expect(odd[i]).toBeCloseTo(v, 9));
    expect(odd).toHaveLength(4);
    expect(rackBentOffsets(100, 240)).toEqual([-50, 50]);
  });

  it("top of steel = first tier + spacing between tiers", () => {
    expect(rackTopIn(rackParams(pipeRack(), { rack: { tiers: 3 } }))).toBe(180 + 2 * 72);
  });
});

describe("rackMembers3D", () => {
  it("pipe rack: 2 columns per bent up to the top tier, a beam per bent per tier, struts, knee braces", () => {
    const p = rackParams(pipeRack(), {}); // 3 bents, 2 tiers
    const m = rackMembers3D(p);
    const count = (k) => m.filter((x) => x.kind === k).length;
    expect(count("column")).toBe(6);
    expect(count("beam")).toBe(6);
    expect(count("strut")).toBe(2 * 2 * 2); // 2 bays × 2 lines × 2 tiers
    expect(count("brace")).toBe(6); // 2 knee braces per bent
    const col = m.find((x) => x.kind === "column");
    expect(col.y - col.sy / 2).toBeCloseTo(0); // stands on grade
    expect(col.y + col.sy / 2).toBeCloseTo(rackTopIn(p));
    const beamTops = [...new Set(m.filter((x) => x.kind === "beam").map((b) => b.y + b.sy / 2))].sort((a, b) => a - b);
    expect(beamTops).toEqual([180, 252]); // beams' top of steel at each tier elevation
    for (const x of m) {
      expect(Math.abs(x.x) + x.sx / 2).toBeLessThanOrEqual(p.lengthIn / 2 + 1e-6);
      expect(Math.abs(x.z) + x.sz / 2).toBeLessThanOrEqual(p.widthIn / 2 + 1e-6);
    }
  });

  it("sleeper rack: a sleeper beam and two piers per bent, TOS at the elevation", () => {
    const p = rackParams(sleeper(), {}); // 480 long, 120 spacing -> 5 sleepers
    const m = rackMembers3D(p);
    expect(m.filter((x) => x.kind === "sleeper")).toHaveLength(5);
    expect(m.filter((x) => x.kind === "pier")).toHaveLength(10);
    expect(m.filter((x) => x.kind === "column")).toHaveLength(0);
    const s = m.find((x) => x.kind === "sleeper");
    expect(s.y + s.sy / 2).toBeCloseTo(18);
  });
});

describe("rackLabel", () => {
  it("reads like a drawing note", () => {
    expect(rackLabel(rackParams(pipeRack(), {}))).toBe(`TOS EL 15' 0" · 2 tiers @ 6' 0"`);
    expect(rackLabel(rackParams(pipeRack(), { rack: { tiers: 1 } }))).toBe(`TOS EL 15' 0" · 1 tier`);
    expect(rackLabel(rackParams(sleeper(), {}))).toBe(`SLEEPERS · TOS EL 1' 6"`);
  });
});

describe("setRackParams", () => {
  function withRack(id = "pipe-rack") {
    return placeSymbol(createEmptyDesign("R"), "processEquipment", id, 0, 0, { id: "r1" });
  }

  it("stores only the changed fields, round-trips and validates clean", () => {
    let d = setRackParams(withRack(), "r1", { elevationIn: 240, tiers: 3 });
    expect(d.symbols[0].rack).toEqual({ elevationIn: 240, tiers: 3 });
    d = setRackParams(d, "r1", { tierSpacingIn: 96 });
    expect(d.symbols[0].rack).toEqual({ elevationIn: 240, tiers: 3, tierSpacingIn: 96 });
    const back = parseDesign(serializeDesign(d));
    expect(back.symbols[0].rack).toEqual(d.symbols[0].rack);
    expect(validateDesign(back)).toEqual([]);
  });

  it("rejects out-of-range values, non-racks and a multi-tier sleeper", () => {
    const d = withRack();
    expect(() => setRackParams(d, "r1", { tiers: 0 })).toThrow(/tiers/);
    expect(() => setRackParams(d, "r1", { elevationIn: RACK_LIMITS.pipe.elevationIn[1] + 1 })).toThrow(/elevation/i);
    expect(() => setRackParams(d, "nope", { tiers: 2 })).toThrow(/Unknown/);
    const pump = placeSymbol(d, "processEquipment", "centrifugal-pump", 0, 0, { id: "p1" });
    expect(() => setRackParams(pump, "p1", { tiers: 2 })).toThrow(/not a rack/);
    expect(() => setRackParams(withRack("sleeper-rack"), "r1", { tiers: 2 })).toThrow(/tiers/);
  });

  it("validateDesign reports stored values outside the limits", () => {
    const d = withRack();
    const bad = { ...d, symbols: [{ ...d.symbols[0], rack: { tiers: 42 } }] };
    expect(rackErrors(bad).some((e) => /tiers/.test(e))).toBe(true);
    expect(validateDesign(bad).some((e) => /tiers/.test(e))).toBe(true);
  });
});
