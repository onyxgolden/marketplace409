// F3 probe (PR #668 fix round 3) — directed-spray supply has no
// authored assembly-inlet connection. ChatGPT's finding at head
// c9e815a5: sprayAssignmentStatus() treats ANY firewater run endpoint
// within HYDRANT_BRANCH_TAP_TOLERANCE_IN (12 in) of the assembly, at
// the same elevation and source-reachable, as connected. There is no
// assembly inlet face/port, no attachment reference, no
// normal/orientation check, and no inlet nominal-size/reducer check.
//
// These probes FAIL against the round-2 implementation and must PASS
// after the fix: each assembly models a stable inlet interface
// (`<sprayId>::inlet`), the branch end's attachment to that inlet is
// authored (spray.inletRunId / spray.inletEnd, via the
// connectSprayInlet authoring command), supply verification reuses
// the full face/size/orientation/reducer checks, and traversal
// depends on that verified edge. An unreferenced same-elevation
// endpoint proves nothing.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { sprayAssignmentStatus, sprayInletInterface } from "../firewater";
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

/**
 * Main (source, buried) + a riser take-off ending AT the spray
 * point: a buried horizontal leg to the spray's plan position, then
 * a zero-plan-length vertical riser vertex (duplicate plan point,
 * per-vertex elevation) up to the inlet elevation. (F4.1 rebuild:
 * the round-3 fixture's single segment rose over its whole 1000-in
 * plan run — a sloped terminal F4.1 now refuses; assertions
 * unchanged.)
 */
function suppliedDesign({ takeoffDiameterIn = 6, takeoffElevIn = [-36, -36, 0] } = {}) {
  let design = sprayDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 1200, y: 0 }], {
    id: "main",
    diameterIn: 12,
    elevationIn: -36,
    utility: "firewater",
    sourceOf: "firewater",
    underground: true,
  });
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 0, y: 1000 }], {
    id: "takeoff",
    diameterIn: takeoffDiameterIn,
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
            elevIn: takeoffElevIn,
            junctions: { start: { runId: "main" } },
          }
        : p,
    ),
  };
  design = placeReducer(design, 0, 0, {
    id: "tap-red",
    inletSizeIn: 12,
    outletSizeIn: takeoffDiameterIn,
  });
  return design;
}

function withInletRef(design, extra = {}) {
  return {
    ...design,
    symbols: design.symbols.map((s) =>
      s.id === "s" ? { ...s, inletRunId: "takeoff", inletEnd: "end", ...extra } : s,
    ),
  };
}

describe("F3 spray supply requires an authored assembly-inlet connection", () => {
  it("the assembly models a stable inlet interface", () => {
    const design = sprayDesign();
    const spray = design.symbols.find((s) => s.id === "s");
    const inlet = sprayInletInterface(spray);
    expect(inlet).toMatchObject({
      id: "s::inlet",
      anchorId: "inlet",
      x: 0,
      y: 1000,
      elevationIn: 0,
      sizeIn: 6,
    });
  });

  it("unreferenced negative: a source-reachable riser ending at the assembly proves no supply", () => {
    const design = suppliedDesign();
    const spray = design.symbols.find((s) => s.id === "s");
    const status = sprayAssignmentStatus(design, spray);
    expect(status.ok).toBe(false);
    expect(status.problems.some((p) => /inlet/i.test(p) && /author|referenc|attach/i.test(p))).toBe(
      true,
    );
    expect(status.effectiveness).toBe("NOT_EVALUATED");
  });

  it("an authored inlet connection completes the verified supply path", () => {
    const design = withInletRef(suppliedDesign());
    const spray = design.symbols.find((s) => s.id === "s");
    const status = sprayAssignmentStatus(design, spray);
    expect(status.problems).toEqual([]);
    expect(status.ok).toBe(true);
  });

  it("the connectSprayInlet authoring command stamps the reference and rejects strangers", async () => {
    const { connectSprayInlet } = await import("../designerDocument");
    expect(typeof connectSprayInlet).toBe("function");
    let design = suppliedDesign();
    design = connectSprayInlet(design, "s", { runId: "takeoff", end: "end" });
    const spray = design.symbols.find((s) => s.id === "s");
    expect(spray.inletRunId).toBe("takeoff");
    expect(spray.inletEnd).toBe("end");
    expect(sprayAssignmentStatus(design, spray).ok).toBe(true);
    // A run whose end does not land on the inlet cannot be authored.
    expect(() => connectSprayInlet(design, "s", { runId: "main", end: "end" })).toThrow();
  });

  it("inlet size mismatch is flagged; a reducer owned by the inlet pair binds it", () => {
    let design = withInletRef(suppliedDesign(), { inletSizeIn: 4 });
    let spray = design.symbols.find((s) => s.id === "s");
    let status = sprayAssignmentStatus(design, spray);
    expect(status.ok).toBe(false);
    expect(status.problems.some((p) => /size|reducer/i.test(p))).toBe(true);
    // A reducer modeled at the inlet, owned by the branch end + the
    // assembly inlet, binds the 6 -> 4 transition.
    design = placeReducer(design, 0, 1000, {
      id: "inlet-red",
      inletSizeIn: 6,
      outletSizeIn: 4,
    });
    spray = design.symbols.find((s) => s.id === "s");
    status = sprayAssignmentStatus(design, spray);
    expect(status.problems).toEqual([]);
    expect(status.ok).toBe(true);
  });

  it("orientation: a flat horizontal branch at the inlet elevation is not a riser approach", () => {
    let design = sprayDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 1200, y: 0 }], {
      id: "main",
      diameterIn: 12,
      elevationIn: 0,
      utility: "firewater",
      sourceOf: "firewater",
    });
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 0, y: 1000 }], {
      id: "takeoff",
      diameterIn: 6,
      elevationIn: 0,
      utility: "firewater",
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "takeoff" ? { ...p, junctions: { start: { runId: "main" } } } : p,
      ),
    };
    design = placeReducer(design, 0, 0, { id: "tap-red", inletSizeIn: 12, outletSizeIn: 6 });
    design = withInletRef(design);
    const spray = design.symbols.find((s) => s.id === "s");
    const status = sprayAssignmentStatus(design, spray);
    expect(status.ok).toBe(false);
    expect(status.problems.some((p) => /riser|orientation|approach/i.test(p))).toBe(true);
  });
});
