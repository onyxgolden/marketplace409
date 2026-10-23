// D668-006 probe — firewater protection can be declared valid without
// supply. Exact shapes from the finding:
//   - directed spray aimed at a flammable vessel, ok standoff/boundary,
//     NO pipes or source -> assignment ok:true, zero errors today.
//   - a polygon of repeated identical points is accepted as a boundary.
//   - missing/malformed flammability silently becomes not-flammable.
//
// These probes FAIL against the current implementation and must PASS
// after the fix: a verified supply path (connected) to the firewater
// loop is required for valid protection; boundaries must be
// geometrically valid and nondegenerate; risk metadata is explicit and
// validated (unknown != absent requirement). Layout/connectivity
// validation only — effectiveness stays NOT_EVALUATED.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import {
  firewaterErrors,
  flammabilityOf,
  requiresSprayAssignment,
  sprayAssignmentStatus,
  unitBoundaryValid,
} from "../firewater";

beforeEach(() => {
  resetDesignerIds();
});

const GOOD_BOUNDARY = [
  { x: -100, y: -100 },
  { x: 500, y: -100 },
  { x: 500, y: 500 },
  { x: -100, y: 500 },
];

function sprayOnlyDesign() {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 100, 100, {
    id: "v-1",
    tag: "V-101",
  });
  design = placeSymbol(design, "piping", "spray-nozzle", 900, 900, { id: "fa-1", tag: "FA-101" });
  design = {
    ...design,
    unitBoundary: GOOD_BOUNDARY,
    symbols: design.symbols.map((s) =>
      s.id === "v-1"
        ? { ...s, flammable: true }
        : s.id === "fa-1"
          ? { ...s, protects: "v-1", aimAt: { x: 100, y: 100 } }
          : s,
    ),
  };
  return design;
}

describe("D668-006 firewater protection requires verified supply", () => {
  it("a spray with no pipes/source is NOT a valid assignment", () => {
    const design = sprayOnlyDesign();
    const spray = design.symbols.find((s) => s.id === "fa-1");
    const status = sprayAssignmentStatus(design, spray);
    expect(status.ok).toBe(false);
    expect(status.problems.some((p) => /supply|source|connect/i.test(p))).toBe(true);
    expect(status.effectiveness).toBe("NOT_EVALUATED");
  });

  it("a spray connected to the loop through modeled junctions IS valid", async () => {
    let design = sprayOnlyDesign();
    design = addPipeRun(design, [{ x: 0, y: 1000 }, { x: 1200, y: 1000 }], {
      id: "fw-main",
      diameterIn: 12,
      utility: "firewater",
      elevationIn: -36,
      underground: true,
      sourceOf: "firewater",
    });
    // 6-in take-off off the main, run to the spray assembly — buried
    // at the tap, rising to the assembly's inlet elevation at the
    // spray end (R6: the supply must bind a physical inlet, not just
    // reach the assembly in plan). addPipeRun does not carry elevIn;
    // it is patched on with the junction below.
    design = addPipeRun(design, [{ x: 900, y: 1000 }, { x: 900, y: 900 }], {
      id: "fw-takeoff",
      diameterIn: 6,
      utility: "firewater",
      elevationIn: -36,
      underground: true,
    });
    const pipes = design.pipes.map((p) =>
      p.id === "fw-takeoff"
        ? { ...p, elevIn: [-36, 0], junctions: { start: { runId: "fw-main" } } }
        : p,
    );
    design = { ...design, pipes };
    // 12 -> 6 transition at the tap needs its modeled reducer.
    const { placeReducer } = await import("../pipeReducerModel");
    design = placeReducer(design, 900, 1000, {
      id: "red-fw",
      inletSizeIn: 12,
      outletSizeIn: 6,
    });
    const spray = design.symbols.find((s) => s.id === "fa-1");
    const status = sprayAssignmentStatus(design, spray);
    expect(status.problems).toEqual([]);
    expect(status.ok).toBe(true);
  });

  it("a degenerate boundary (repeated identical points) is invalid", () => {
    expect(
      unitBoundaryValid({
        unitBoundary: [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }],
      }),
    ).toBe(false);
    expect(unitBoundaryValid({ unitBoundary: GOOD_BOUNDARY })).toBe(true);
  });

  it("malformed flammability is unknown risk, never silently not-flammable", () => {
    expect(flammabilityOf({ flammable: "yes" })).toBe("unknown");
    expect(flammabilityOf({ flammable: 1 })).toBe("unknown");
    expect(requiresSprayAssignment({ flammable: "yes" })).toBe(true);
  });

  it("malformed flammability is a named validation error", () => {
    const design = sprayOnlyDesign();
    const patched = {
      ...design,
      symbols: design.symbols.map((s) => (s.id === "v-1" ? { ...s, flammable: "yes" } : s)),
    };
    expect(firewaterErrors(patched).some((e) => /flammab/i.test(e))).toBe(true);
  });

  it("firewater errors name the missing supply on the unprotected vessel", () => {
    const errors = firewaterErrors(sprayOnlyDesign());
    expect(errors.some((e) => /supply|source|not connected/i.test(e))).toBe(true);
  });
});
