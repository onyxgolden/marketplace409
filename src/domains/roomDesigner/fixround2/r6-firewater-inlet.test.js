// R6 probe (PR #668 fix round 2) — firewater "supply" is plan
// proximity, not a verified 3D inlet; the unit boundary lacks a
// simplicity check. ChatGPT's executed counterexamples:
//   sprayNoRiser: a firewater source run at elevation -36 ends at the
//     spray assembly's plan point 36 in below its inlet (descriptor
//     elevation 0) with no riser — status ok: true, problems: [],
//     firewater errors [].
//   selfIntersectingBoundary: the bowtie polygon
//     [(0,0),(10,10),(0,10),(8,0)] is accepted as a unit boundary.
//
// These probes FAIL against the round-1 implementation and must PASS
// after the fix: supply requires a bound physical inlet — the branch
// end must reach the assembly inlet elevation through the modeled
// route (riser included) and the source path — and the boundary must
// be a simple nondegenerate polygon before outside placement is
// claimed. Effectiveness stays NOT_EVALUATED.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import {
  firewaterErrors,
  hydrantPlacements,
  sprayAssignmentStatus,
  unitBoundaryValid,
} from "../firewater";
import { placeReducer } from "../pipeReducerModel";

beforeEach(() => {
  resetDesignerIds();
});

const BOUNDARY_AROUND_VESSEL = [
  { x: 900, y: 900 },
  { x: 1100, y: 900 },
  { x: 1100, y: 1100 },
  { x: 900, y: 1100 },
];

function sprayDesign() {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 1000, 1000, {
    id: "v",
    tag: "V-101",
  });
  design = placeSymbol(design, "piping", "spray-nozzle", 0, 1000, { id: "s", tag: "FA-101" });
  design = {
    ...design,
    unitBoundary: BOUNDARY_AROUND_VESSEL,
    symbols: design.symbols.map((sy) =>
      sy.id === "v"
        ? { ...sy, flammable: true }
        : sy.id === "s"
          ? { ...sy, protects: "v", aimAt: { x: 1000, y: 1000 } }
          : sy,
    ),
  };
  return design;
}

describe("R6 firewater supply binds a physical inlet; boundary must be simple", () => {
  it("sprayNoRiser: a branch ending 36 in under the inlet is not supply", () => {
    let design = sprayDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 0, y: 1000 }], {
      id: "source",
      diameterIn: 6,
      elevationIn: -36,
      utility: "firewater",
      sourceOf: "firewater",
    });
    const spray = design.symbols.find((s) => s.id === "s");
    const status = sprayAssignmentStatus(design, spray);
    expect(status.ok).toBe(false);
    expect(status.problems.some((p) => /elevation|riser|inlet/i.test(p))).toBe(true);
    expect(status.effectiveness).toBe("NOT_EVALUATED");
    expect(firewaterErrors(design).length).toBeGreaterThan(0);
  });

  it("a modeled riser to the inlet elevation completes a verified supply path", () => {
    let design = sprayDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 1200, y: 0 }], {
      id: "main",
      diameterIn: 12,
      elevationIn: -36,
      utility: "firewater",
      sourceOf: "firewater",
      underground: true,
    });
    // Take-off: buried at the main, running buried to the assembly's
    // plan position, then a zero-plan-length vertical riser vertex
    // (duplicate plan point, per-vertex elevation) up to the assembly
    // inlet (0). (F4.1 rebuild: the round-2 fixture's single segment
    // rose over its whole plan run — a sloped terminal F4.1 now
    // refuses; assertions unchanged.)
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 0, y: 1000 }], {
      id: "takeoff",
      diameterIn: 6,
      utility: "firewater",
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "takeoff"
          ? {
              ...p,
              points: [
                { x: 0, y: 0 },
                { x: 0, y: 1000 },
                { x: 0, y: 1000 },
              ],
              elevIn: [-36, -36, 0],
              junctions: { start: { runId: "main" } },
            }
          : p,
      ),
    };
    design = placeReducer(design, 0, 0, { id: "red", inletSizeIn: 12, outletSizeIn: 6 });
    // F3: author the take-off end as the assembly's inlet connection.
    design = {
      ...design,
      symbols: design.symbols.map((s) =>
        s.id === "s" ? { ...s, inletRunId: "takeoff", inletEnd: "end" } : s,
      ),
    };
    const spray = design.symbols.find((s) => s.id === "s");
    const status = sprayAssignmentStatus(design, spray);
    expect(status.problems).toEqual([]);
    expect(status.ok).toBe(true);
  });

  it("selfIntersectingBoundary: a bowtie polygon is not a valid boundary", () => {
    expect(
      unitBoundaryValid({
        unitBoundary: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
          { x: 8, y: 0 },
        ],
      }),
    ).toBe(false);
    expect(unitBoundaryValid({ unitBoundary: BOUNDARY_AROUND_VESSEL })).toBe(true);
  });

  it("a hydrant branch that never rises to the hydrant inlet does not serve it", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 1000, y: 0 }], {
      id: "main",
      diameterIn: 12,
      elevationIn: -36,
      utility: "firewater",
      underground: true,
      sourceOf: "firewater",
    });
    design = placeSymbol(design, "piping", "fire-hydrant", 500, 72, { id: "h1" });
    design = {
      ...design,
      symbols: design.symbols.map((s) =>
        s.id === "h1" ? { ...s, stationRunId: "main" } : s,
      ),
    };
    design = addPipeRun(design, [{ x: 500, y: 0 }, { x: 500, y: 72 }], {
      id: "branch",
      diameterIn: 6,
      elevationIn: -36,
      utility: "firewater",
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "branch" ? { ...p, junctions: { start: { runId: "main" } } } : p,
      ),
    };
    const flat = hydrantPlacements(design).find((h) => h.hydrantId === "h1");
    expect(flat.servedByBranch).toBe(false);
    // The same branch with a modeled riser to the inlet (grade 0) serves.
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "branch" ? { ...p, elevationIn: undefined, elevIn: [-36, 0] } : p,
      ),
    };
    const risered = hydrantPlacements(design).find((h) => h.hydrantId === "h1");
    expect(risered.servedByBranch).toBe(true);
  });
});
