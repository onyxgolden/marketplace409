// F1 probe (PR #668 fix round 3) — a reducer's "owned interfaces"
// are still not owned by either participating connection. ChatGPT's
// counterexample at head c9e815a5: reducerInterfaces() exposes only
// derived port ids + shared plan point/elevation/directions/sizes —
// no run id, endpoint id, host segment id, nozzle id, or authored
// connection reference. boundReducerAt() binds by proximity /
// elevation / orientation / size only, connectionAtPoint() returns
// the FIRST qualifying endpoint, and validatedJunctionEdge() asks
// boundReducerAt() without the participating run/end identities. One
// reducer at a coincident same-elevation same-axis transition can
// therefore authorize multiple unrelated compatible transitions; the
// second inherits a graph edge + utility-source reachability.
//
// These probes FAIL against the round-2 implementation and must PASS
// after the fix: both reducer ports persist stable ownership
// references (run id + endpoint / host-interface id, or nozzle id),
// validatedJunctionEdge() and nozzle compatibility validate the
// EXACT pair, ambiguous placement is rejected instead of first-match,
// and one reducer cannot service a second coincident transition.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { connectionCompatibilityErrors } from "../pipeAttachments";
import { runReachesSource, validatedJunctionEdge } from "../pipeCrossings";
import { boundReducerAt, placeReducer, reducerInterfaces } from "../pipeReducerModel";

beforeEach(() => {
  resetDesignerIds();
});

/** Host 2-in plant-water source + 1-in branch junctioned at (50, 0), elev 150. */
function transitionDesign() {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
    id: "h",
    diameterIn: 2,
    elevationIn: 150,
    utility: "plant-water",
    sourceOf: "plant-water",
  });
  design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
    id: "b",
    diameterIn: 1,
    elevationIn: 150,
    utility: "plant-water",
  });
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "b" ? { ...p, junctions: { start: { runId: "h" } } } : p,
    ),
  };
  return design;
}

/** A second, unrelated 1-in branch coincident with b's transition. */
function addCoincidentBranch(design) {
  let next = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
    id: "b2",
    diameterIn: 1,
    elevationIn: 150,
    utility: "plant-water",
  });
  next = {
    ...next,
    pipes: next.pipes.map((p) =>
      p.id === "b2" ? { ...p, junctions: { start: { runId: "h" } } } : p,
    ),
  };
  return next;
}

const SIDES_B = [
  { sizeIn: 1, dirDeg: 90, owner: { kind: "run-end", runId: "b", end: "start" } },
  { sizeIn: 2, dirDeg: 270, owner: { kind: "run-segment", runId: "h", segmentIndex: 0 } },
];

describe("F1 reducer ports persist ownership and bind only their exact pair", () => {
  it("placeReducer persists stable ownership references for both ports", () => {
    let design = transitionDesign();
    design = placeReducer(design, 50, 0, {
      id: "r",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 90,
    });
    const inst = design.symbols.find((s) => s.id === "r");
    expect(inst.portOwners).toBeTruthy();
    const owners = [inst.portOwners.inlet, inst.portOwners.outlet];
    // One port is owned by the branch run end; the other by the host
    // interface it taps. Neither is a bare derived port id.
    expect(owners).toContainEqual({ kind: "run-end", runId: "b", end: "start" });
    expect(owners).toContainEqual({ kind: "run-segment", runId: "h", segmentIndex: 0 });
    // reducerInterfaces surfaces the same ownership per port.
    const ifaces = reducerInterfaces(inst);
    const portOwners = ifaces.ports.map((p) => p.owner);
    expect(portOwners).toContainEqual({ kind: "run-end", runId: "b", end: "start" });
    expect(portOwners).toContainEqual({ kind: "run-segment", runId: "h", segmentIndex: 0 });
  });

  it("one reducer cannot service a second coincident transition", () => {
    let design = transitionDesign();
    design = placeReducer(design, 50, 0, {
      id: "r",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 90,
    });
    expect(runReachesSource(design, "b", "plant-water")).toBe(true);
    // A second, unrelated compatible transition at the same point,
    // same elevation, same axis, same sizes.
    design = addCoincidentBranch(design);
    // The owned transition still validates; the coincident one does not.
    expect(runReachesSource(design, "b", "plant-water")).toBe(true);
    expect(runReachesSource(design, "b2", "plant-water")).toBe(false);
    const b2 = design.pipes.find((p) => p.id === "b2");
    expect(validatedJunctionEdge(design, b2, "start").status).toBe("reducer");
    const errs = connectionCompatibilityErrors(design);
    expect(errs.some((e) => e.includes("b2") && /reducer/i.test(e))).toBe(true);
    expect(errs.some((e) => e.includes("run b ") && /reducer/i.test(e))).toBe(false);
    // Owner-aware binding agrees: b's exact pair binds, b2's does not.
    expect(
      boundReducerAt(design, { x: 50, y: 0, elevationIn: 150, sides: SIDES_B })?.id,
    ).toBe("r");
    const sidesB2 = SIDES_B.map((s) =>
      s.owner.kind === "run-end" ? { ...s, owner: { ...s.owner, runId: "b2" } } : s,
    );
    expect(boundReducerAt(design, { x: 50, y: 0, elevationIn: 150, sides: sidesB2 })).toBeNull();
  });

  it("ambiguous placement is rejected instead of selecting the first connection", () => {
    let design = transitionDesign();
    design = addCoincidentBranch(design);
    expect(() =>
      placeReducer(design, 50, 0, { id: "r", inletSizeIn: 2, outletSizeIn: 1, rotationDeg: 90 }),
    ).toThrow(/ambig/i);
    // Naming the participating run end disambiguates — and the
    // resulting reducer binds ONLY that pair.
    design = placeReducer(design, 50, 0, {
      id: "r",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 90,
      forRun: { runId: "b2", end: "start" },
    });
    expect(runReachesSource(design, "b2", "plant-water")).toBe(true);
    expect(runReachesSource(design, "b", "plant-water")).toBe(false);
  });

  it("a reducer owned by one nozzle connection does not waive a second run's claim on the same face", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
      id: "runA",
      diameterIn: 6,
      elevationIn: 74.4,
    });
    design = addPipeRun(design, [{ x: 300, y: 0 }, { x: 24, y: 0 }], {
      id: "runB",
      diameterIn: 6,
      elevationIn: 74.4,
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "runA" || p.id === "runB"
          ? { ...p, attachments: { end: { symbolId: "v", anchorId: "side-out" } } }
          : p,
      ),
    };
    // Both runs mismatch the 8-in face and both flag a missing reducer.
    expect(
      connectionCompatibilityErrors(design).filter((e) => /reducer/i.test(e)).length,
    ).toBe(2);
    // A reducer modeled at the connection binds the FIRST authored
    // connection only (runA is the connection at the point when the
    // reducer is placed — runB is added after).
    let bound = createEmptyDesign();
    bound = placeSymbol(bound, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    bound = addPipeRun(bound, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
      id: "runA",
      diameterIn: 6,
      elevationIn: 74.4,
    });
    bound = {
      ...bound,
      pipes: bound.pipes.map((p) =>
        p.id === "runA"
          ? { ...p, attachments: { end: { symbolId: "v", anchorId: "side-out" } } }
          : p,
      ),
    };
    bound = placeReducer(bound, 24, 0, { id: "r2", inletSizeIn: 8, outletSizeIn: 6, rotationDeg: 0 });
    expect(connectionCompatibilityErrors(bound)).toEqual([]);
    // runB arrives later, coincident and compatible in every
    // geometric respect — it still owns no reducer.
    bound = addPipeRun(bound, [{ x: 300, y: 0 }, { x: 24, y: 0 }], {
      id: "runB",
      diameterIn: 6,
      elevationIn: 74.4,
    });
    bound = {
      ...bound,
      pipes: bound.pipes.map((p) =>
        p.id === "runB"
          ? { ...p, attachments: { end: { symbolId: "v", anchorId: "side-out" } } }
          : p,
      ),
    };
    const errs = connectionCompatibilityErrors(bound);
    expect(errs.some((e) => e.includes("runB") && /reducer/i.test(e))).toBe(true);
    expect(errs.some((e) => e.includes("runA") && /reducer/i.test(e))).toBe(false);
  });
});
