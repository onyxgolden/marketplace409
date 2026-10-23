// PR668-003 probe — manway access ignores the grade datum and cannot
// report infeasible access. The reviewed rule is:
//
//   sillAboveGrade = parentBaseElevation + manwayLocalSillElevation - gradeElevation
//
// Current code uses only `manway.sillIn > 24` with "vessel base at grade".
// These probes FAIL against the current implementation and must PASS after
// the fix: explicit grade/base terms, access-envelope collision validation,
// bounded placement or a named unresolved-access finding, and the required
// raised-base / changed-grade / obstruction / infeasible fixtures.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { findSymbol } from "../symbolRegistry";
import {
  accessPackageWorld,
  sillAboveGradeIn,
  accessEnvelopeErrors,
} from "../vesselAccess";

beforeEach(() => {
  resetDesignerIds();
});

function vesselDesign(id = "v-1", patch = {}) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id });
  if (Object.keys(patch).length > 0) {
    design = {
      ...design,
      symbols: design.symbols.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    };
  }
  const symbol = findSymbol("processEquipment", "vertical-vessel");
  const inst = design.symbols.find((s) => s.id === id);
  return { design, symbol, inst };
}

describe("PR668-003 grade/base datum and access feasibility", () => {
  it("a raised vessel base triggers the access rule from the sill above GRADE", () => {
    // Catalog sill is 30 in above the base; base raised 36 in above
    // grade -> sill sits 66 in above grade -> catwalk required, even
    // though the local sill (30) barely clears the old 24-in rule.
    const { design, symbol, inst } = vesselDesign("v-raised", { baseElevationIn: 36 });
    expect(sillAboveGradeIn(design, inst)).toBeCloseTo(66, 9);
    expect(accessPackageWorld(symbol, inst, design)).not.toBeNull();
  });

  it("a raised grade suppresses the package when the sill is within 24 in of grade", () => {
    // Sill 30 in above the base; grade raised to 12 in -> 18 in above
    // grade -> NO catwalk.
    let { design, symbol, inst } = vesselDesign("v-grade");
    design = { ...design, gradeElevationIn: 12 };
    inst = design.symbols.find((s) => s.id === "v-grade");
    expect(sillAboveGradeIn(design, inst)).toBeCloseTo(18, 9);
    expect(accessPackageWorld(symbol, inst, design)).toBeNull();
  });

  it("a pipe crossing the deck envelope is a named obstruction finding", () => {
    let { design } = vesselDesign("v-obs");
    // Route a pipe straight through where the catwalk deck lands (deck
    // extends ~36 in south of the vessel edge at sill elevation 30).
    design = addPipeRun(design, [{ x: -200, y: 60 }, { x: 200, y: 60 }], {
      id: "through-deck",
      diameterIn: 2,
      elevationIn: 30,
    });
    const errors = accessEnvelopeErrors(design);
    expect(errors.some((e) => /obstruct|collision|access/i.test(e))).toBe(true);
  });

  it("an infeasible placement yields a named unresolved-access finding", () => {
    let { design } = vesselDesign("v-box");
    // Block every outward deck orientation: the manway faces south, so
    // drums to the south / south-east / south-west cover the reachable
    // compass; inward orientations are inside the vessel itself.
    for (const [x, y, id] of [[0, 90, "b-s"], [60, 78, "b-se"], [-60, 78, "b-sw"]]) {
      design = placeSymbol(design, "processEquipment", "horizontal-drum", x, y, { id });
    }
    const errors = accessEnvelopeErrors(design);
    expect(errors.some((e) => /unresolved|no feasible|infeasible/i.test(e))).toBe(true);
  });

  it("a clear deck placement reports no envelope errors", () => {
    const { design } = vesselDesign("v-clear");
    expect(accessEnvelopeErrors(design)).toEqual([]);
  });
});
