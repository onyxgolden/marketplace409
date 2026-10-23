// R1 probe (PR #668 fix round 2) — reducers are proximity waivers:
// invalid transitions prove supply. ChatGPT's executed counterexamples
// (pr668-fixround-reviewer-probes-2026-10-23.json):
//   missingReducer:    a 2-in plant-water host + 1-in branch at
//                      elevation 150 — compatibility reports the missing
//                      reducer, yet runReachesSource is already TRUE.
//   unconnectedReducer: a reducer placed at the same plan point with
//                      sizes 2/1 and rotation 0 makes compatibility []
//                      although its 3D descriptor elevation is 0 and its
//                      geometry is a vertical frustum independent of
//                      the run axis.
//
// These probes FAIL against the round-1 implementation and must PASS
// after the fix: a reducer binds a transition only through OWNED
// inlet/outlet interfaces — plan position, elevation, axis orientation,
// and per-side sizes all verified — and the connection graph builds
// supply edges only for bound transitions.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { connectionCompatibilityErrors } from "../pipeAttachments";
import { runReachesSource } from "../pipeCrossings";
import { boundReducerAt, placeReducer, reducerInterfaces } from "../pipeReducerModel";
import { fittingDescriptors } from "../designerThreeModel";

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

const SIDES = [
  { sizeIn: 1, dirDeg: 90 }, // branch side: away from the tap, +y
  { sizeIn: 2, dirDeg: 270 }, // host side: through the tap, -y
];

describe("R1 reducer owned interfaces gate the connection graph", () => {
  it("missingReducer: no reducer -> the size warning AND no supply edge", () => {
    const design = transitionDesign();
    expect(connectionCompatibilityErrors(design).some((e) => /reducer/i.test(e))).toBe(true);
    expect(runReachesSource(design, "b", "plant-water")).toBe(false);
  });

  it("unconnectedReducer: a coincident raw reducer with no elevation binds nothing", () => {
    let design = transitionDesign();
    design = placeSymbol(design, "piping", "reducer", 50, 0, { id: "r", rotationDeg: 0 });
    design = {
      ...design,
      symbols: design.symbols.map((s) =>
        s.id === "r" ? { ...s, inletSizeIn: 2, outletSizeIn: 1 } : s,
      ),
    };
    // The 3D descriptor still reads elevation 0 — the instance carries
    // no bound interface elevation, so nothing may validate.
    const descriptor = fittingDescriptors(design).find((f) => f.id === "r");
    expect(descriptor.elevationIn).toBe(0);
    expect(boundReducerAt(design, { x: 50, y: 0, elevationIn: 150, sides: SIDES })).toBeNull();
    expect(connectionCompatibilityErrors(design).some((e) => /reducer/i.test(e))).toBe(true);
    expect(runReachesSource(design, "b", "plant-water")).toBe(false);
  });

  it("a reducer modeled at the connection (placeReducer) binds: stamped elevation, supply proven", () => {
    let design = transitionDesign();
    design = placeReducer(design, 50, 0, {
      id: "r",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 90,
    });
    const inst = design.symbols.find((s) => s.id === "r");
    // Placing the reducer AT the connection binds it to that
    // connection: the interface elevation is the junction's own.
    expect(inst.elevationIn).toBe(150);
    const bound = boundReducerAt(design, { x: 50, y: 0, elevationIn: 150, sides: SIDES });
    expect(bound?.id).toBe("r");
    expect(connectionCompatibilityErrors(design)).toEqual([]);
    expect(runReachesSource(design, "b", "plant-water")).toBe(true);
  });

  it("wrong elevation: a bound-shape reducer at the wrong elevation binds nothing", () => {
    let design = transitionDesign();
    design = placeReducer(design, 50, 0, {
      id: "r",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 90,
    });
    design = {
      ...design,
      symbols: design.symbols.map((s) => (s.id === "r" ? { ...s, elevationIn: 0 } : s)),
    };
    expect(boundReducerAt(design, { x: 50, y: 0, elevationIn: 150, sides: SIDES })).toBeNull();
    expect(connectionCompatibilityErrors(design).some((e) => /reducer/i.test(e))).toBe(true);
    expect(runReachesSource(design, "b", "plant-water")).toBe(false);
  });

  it("wrong orientation: axis across the transition binds nothing", () => {
    let design = transitionDesign();
    design = placeReducer(design, 50, 0, {
      id: "r",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 0, // axis east-west; the transition axis is north-south
    });
    expect(boundReducerAt(design, { x: 50, y: 0, elevationIn: 150, sides: SIDES })).toBeNull();
    expect(connectionCompatibilityErrors(design).some((e) => /reducer/i.test(e))).toBe(true);
    expect(runReachesSource(design, "b", "plant-water")).toBe(false);
  });

  it("wrong side sizes: the port facing the branch must carry the branch size", () => {
    let design = transitionDesign();
    design = placeReducer(design, 50, 0, {
      id: "r",
      inletSizeIn: 1,
      outletSizeIn: 2, // outlet faces the branch (rotation 90) but is 2 in, branch is 1 in
      rotationDeg: 90,
    });
    expect(boundReducerAt(design, { x: 50, y: 0, elevationIn: 150, sides: SIDES })).toBeNull();
    expect(runReachesSource(design, "b", "plant-water")).toBe(false);
  });

  it("reducer interfaces expose owned ports with position, elevation, direction, size", () => {
    let design = transitionDesign();
    design = placeReducer(design, 50, 0, {
      id: "r",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 90,
    });
    const inst = design.symbols.find((s) => s.id === "r");
    const ifaces = reducerInterfaces(inst);
    expect(ifaces.elevationIn).toBe(150);
    const byPort = new Map(ifaces.ports.map((p) => [p.port, p]));
    expect(byPort.get("outlet")).toMatchObject({ sizeIn: 1, dirDeg: 90, x: 50, y: 0, elevationIn: 150 });
    expect(byPort.get("inlet")).toMatchObject({ sizeIn: 2, dirDeg: 270, x: 50, y: 0, elevationIn: 150 });
    // The 3D descriptor renders those same interfaces.
    const descriptor = fittingDescriptors(design).find((f) => f.id === "r");
    expect(descriptor.elevationIn).toBe(150);
    expect(descriptor.interfaces).toHaveLength(2);
  });

  it("nozzle-side transition: a raw coincident reducer does not waive a size mismatch", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
      id: "run",
      diameterIn: 6,
      elevationIn: 74.4,
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "run" ? { ...p, attachments: { end: { symbolId: "v", anchorId: "side-out" } } } : p,
      ),
    };
    expect(connectionCompatibilityErrors(design).some((e) => /reducer/i.test(e))).toBe(true);
    // A raw reducer symbol dropped on the face (no bound elevation)
    // changes nothing.
    design = placeSymbol(design, "piping", "reducer", 24, 0, { id: "r", rotationDeg: 0 });
    design = {
      ...design,
      symbols: design.symbols.map((s) =>
        s.id === "r" ? { ...s, inletSizeIn: 8, outletSizeIn: 6 } : s,
      ),
    };
    expect(connectionCompatibilityErrors(design).some((e) => /reducer/i.test(e))).toBe(true);
    // A reducer modeled at the connection binds and clears the finding.
    design = {
      ...design,
      symbols: design.symbols.filter((s) => s.id !== "r"),
    };
    design = placeReducer(design, 24, 0, { id: "r2", inletSizeIn: 8, outletSizeIn: 6, rotationDeg: 0 });
    expect(design.symbols.find((s) => s.id === "r2").elevationIn).toBeCloseTo(74.4, 6);
    expect(connectionCompatibilityErrors(design)).toEqual([]);
  });
});
