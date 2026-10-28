// pipeRoutingRules.fixround.test.js — D10-01 PR #687 fix-round probes
// (verdict NEEDS CHANGES, seven P2 findings D687-001..D687-007).
//
// Each finding has failing-before/passing-after public-path probes plus
// valid positives. These probes FAIL against the reviewed head c4a2131
// and must PASS after the fix. The supplied 37-test suite in
// pipeRoutingRules.test.js stays green alongside them (with the
// verdict-driven contract updates documented in that file).

import { describe, expect, it, beforeEach } from "vitest";
import {
  repairLegacyRoute,
  routeReferenceChecks,
  simplifyRouteLegs,
  validateBranchTakeoff,
  validateRouteEndpoints,
} from "./pipeRoutingRules";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  replacePipeRoute,
  resetDesignerIds,
} from "./designerDocument";
import { placeReducer } from "./pipeReducerModel";
import { attachmentInterfaceErrors } from "./pipeAttachments";
import { createInitialState, designerReducer } from "@/components/designer/designerReducer";

beforeEach(() => {
  resetDesignerIds();
});

const flat = (points, id = "p1", extra = {}) => {
  let design = createEmptyDesign("Plan");
  design = addPipeRun(design, points, { id, diameterIn: 2, elevationIn: 30, ...extra });
  return { design, run: design.pipes.find((p) => p.id === id) };
};

// Direct literal run (bypasses addPipeRun's plan dedupe) for degenerate
// and stored-elevation cases.
const literal = (points, elevIn, id = "p1", extra = {}) => {
  const design = createEmptyDesign("Plan");
  design.pipes = [{ id, points, elevIn, diameterIn: 2, elevationIn: 30, ...extra }];
  return { design, run: design.pipes[0] };
};

const codes = (findings) => findings.map((f) => f.code);

const withAttachment = (design, runId, end, symbolId, anchorId) => ({
  ...design,
  pipes: design.pipes.map((p) =>
    p.id === runId
      ? { ...p, attachments: { ...(p.attachments || {}), [end]: { symbolId, anchorId } } }
      : p,
  ),
});

const withJunction = (design, runId, end, hostId) => ({
  ...design,
  pipes: design.pipes.map((p) =>
    p.id === runId
      ? { ...p, junctions: { ...(p.junctions || {}), [end]: { runId: hostId } } }
      : p,
  ),
});

// ------------------------------------------------------------------
// D687-001: endpoints use the canonical owned-interface/junction
// predicate — elevation, size compatibility, junction ownership, and
// verified fittings — not endpoint XY proximity alone.
// ------------------------------------------------------------------
describe("D687-001 endpoints: canonical predicate", () => {
  it("a 2-in run at 30 is NOT connected to a 12-in run at 300 with no junction", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "a", diameterIn: 2, elevationIn: 30 });
    design = addPipeRun(design, [{ x: 100, y: 0 }, { x: 100, y: 50 }], { id: "b", diameterIn: 12, elevationIn: 300 });
    const a = design.pipes[0];
    // Old code called the end connected by XY proximity alone.
    expect(codes(validateRouteEndpoints(design, a))).toEqual([
      "ROUTE_UNCONNECTED_END",
      "ROUTE_UNCONNECTED_END",
    ]);
  });

  it("a coincident end with no junction record stays unresolved", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "a", elevationIn: 30 });
    design = addPipeRun(design, [{ x: 100, y: 0 }, { x: 100, y: 50 }], { id: "b", elevationIn: 30 });
    const a = design.pipes[0];
    expect(codes(validateRouteEndpoints(design, a))).toEqual([
      "ROUTE_UNCONNECTED_END",
      "ROUTE_UNCONNECTED_END",
    ]);
  });

  it("valid positive: same-size owned partners verify", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "a", elevationIn: 30 });
    design = addPipeRun(design, [{ x: 100, y: 0 }, { x: 100, y: 50 }], { id: "b", elevationIn: 30 });
    design = withJunction(design, "a", "end", "b");
    const a = design.pipes[0];
    // Only the start end is unconnected; the recorded junction verifies.
    expect(codes(validateRouteEndpoints(design, a))).toEqual(["ROUTE_UNCONNECTED_END"]);
  });

  it("valid positive: owned-reducer partners verify", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "a", diameterIn: 2, elevationIn: 30 });
    design = addPipeRun(design, [{ x: 100, y: 0 }, { x: 200, y: 0 }], { id: "b", diameterIn: 12, elevationIn: 30 });
    design = withJunction(design, "a", "end", "b");
    // The reducer owns exactly this pair: outlet (smaller, 2 in) toward
    // run a's end (west), inlet (larger, 12 in) toward run b's start.
    design = placeReducer(design, 100, 0, { id: "red", inletSizeIn: 12, outletSizeIn: 2, rotationDeg: 180 });
    const a = design.pipes[0];
    expect(codes(validateRouteEndpoints(design, a))).toEqual(["ROUTE_UNCONNECTED_END"]);
  });

  it("a mixed-size junction with NO owned reducer stays unresolved", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "a", diameterIn: 2, elevationIn: 30 });
    design = addPipeRun(design, [{ x: 100, y: 0 }, { x: 200, y: 0 }], { id: "b", diameterIn: 12, elevationIn: 30 });
    design = withJunction(design, "a", "end", "b");
    const a = design.pipes[0];
    expect(codes(validateRouteEndpoints(design, a))).toEqual([
      "ROUTE_UNCONNECTED_END",
      "ROUTE_UNCONNECTED_END",
    ]);
  });

  it("a junction at a different elevation stays unresolved", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "a", elevationIn: 30 });
    design = addPipeRun(design, [{ x: 100, y: 0 }, { x: 100, y: 50 }], { id: "b", elevationIn: 300 });
    design = withJunction(design, "a", "end", "b");
    const a = design.pipes[0];
    expect(codes(validateRouteEndpoints(design, a))).toEqual([
      "ROUTE_UNCONNECTED_END",
      "ROUTE_UNCONNECTED_END",
    ]);
  });
});

// ------------------------------------------------------------------
// D687-002: repair filters bounded candidates against both owned
// endpoints; feasibility is derived, never a caller-supplied flag.
// ------------------------------------------------------------------
describe("D687-002 repair: candidates must meet owned endpoints", () => {
  it("the obliqueFace flag is ignored: a free diagonal run still repairs", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    const result = repairLegacyRoute(design, run, { obliqueFace: true });
    expect(result.repaired).toBe(true);
    expect(result.route).not.toBeNull();
  });

  it("executed vertical-vessel top-out: a valid riser is NOT destroyed", () => {
    let design = createEmptyDesign("Plan");
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    // Original: riser 126 -> 162 at the top-out face, then a diagonal
    // plan leg at 162. The riser itself is valid and must survive.
    const run = {
      id: "r",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      elevIn: [126, 162, 162],
      diameterIn: 8,
      elevationIn: 126,
      attachments: { start: { symbolId: "v", anchorId: "top-out" } },
    };
    design = { ...design, pipes: [run] };
    expect(attachmentInterfaceErrors(design, run, "start")).toEqual([]);
    const result = repairLegacyRoute(design, run);
    expect(result.repaired).toBe(false);
    expect(result.route).toBeNull();
    expect(codes(result.findings)).toEqual(["ROUTE_UNRESOLVED"]);
  });

  it("a junctioned diagonal repairs when a candidate still verifies", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 50 }], { id: "a", elevationIn: 30 });
    design = addPipeRun(design, [{ x: 100, y: 50 }, { x: 200, y: 50 }], { id: "b", elevationIn: 30 });
    design = withJunction(design, "a", "end", "b");
    const a = design.pipes[0];
    const result = repairLegacyRoute(design, a);
    expect(result.repaired).toBe(true);
    const repairedDesign = { ...design, pipes: [result.route, design.pipes[1]] };
    expect(codes(validateRouteEndpoints(repairedDesign, result.route))).toEqual([
      "ROUTE_UNCONNECTED_END",
    ]);
  });

  it("a junction no candidate can meet stays unresolved with old geometry", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 50 }], { id: "a", elevationIn: 30 });
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 200, y: 50 }], { id: "b", elevationIn: 30 });
    design = withJunction(design, "a", "end", "b");
    const a = design.pipes[0];
    const before = JSON.stringify(a);
    const result = repairLegacyRoute(design, a);
    expect(result.repaired).toBe(false);
    expect(result.route).toBeNull();
    expect(codes(result.findings)).toEqual(["ROUTE_UNRESOLVED"]);
    expect(JSON.stringify(design.pipes[0])).toBe(before);
  });
});

// ------------------------------------------------------------------
// D687-003: take-off verification needs the design, a named host, and
// a signed top/bottom approach. Missing evidence is UNVERIFIED.
// ------------------------------------------------------------------
describe("D687-003 take-off: physical evidence, not labels alone", () => {
  const headerDesign = () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], { id: "h", elevationIn: 100 });
    return design;
  };
  const branchDesign = (points, elevIn, extra) => {
    let design = headerDesign();
    const h = design.pipes[0];
    const b = {
      id: "b",
      points,
      elevIn,
      diameterIn: 2,
      elevationIn: 100,
      branchRole: "header-takeoff",
      junctions: { start: { runId: "h" } },
      ...extra,
    };
    return { design: { ...design, pipes: [h, b] }, run: b };
  };

  it("liquid/bottom with a descending verified approach passes", () => {
    const { design, run } = branchDesign(
      [
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [100, 60, 60],
      { phase: "liquid", takeoff: "bottom" },
    );
    expect(validateBranchTakeoff(design, run).state).toBe("PASS");
  });

  it("vapor/top with an ascending verified approach passes", () => {
    const { design, run } = branchDesign(
      [
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [100, 140, 140],
      { phase: "vapor", takeoff: "top" },
    );
    expect(validateBranchTakeoff(design, run).state).toBe("PASS");
  });

  it("liquid/bottom with an ascending verified approach mismatches", () => {
    const { design, run } = branchDesign(
      [
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [100, 140, 140],
      { phase: "liquid", takeoff: "bottom" },
    );
    const result = validateBranchTakeoff(design, run);
    expect(result.state).toBe("BRANCH_TAKEOFF_MISMATCH");
    expect(codes(result.findings)).toEqual(["BRANCH_TAKEOFF_MISMATCH"]);
  });

  it("a level verified approach is unverified, not a pass", () => {
    const { design, run } = branchDesign(
      [
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [100, 100],
      { phase: "liquid", takeoff: "bottom" },
    );
    const result = validateBranchTakeoff(design, run);
    expect(result.state).toBe("BRANCH_TAKEOFF_UNVERIFIED");
    expect(codes(result.findings)).toEqual(["BRANCH_TAKEOFF_UNVERIFIED"]);
  });

  it("a junction naming a missing host is unverified", () => {
    const { design, run } = branchDesign(
      [
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [100, 60, 60],
      { phase: "liquid", takeoff: "bottom", junctions: { start: { runId: "ghost" } } },
    );
    expect(validateBranchTakeoff(design, run).state).toBe("BRANCH_TAKEOFF_UNVERIFIED");
  });

  it("no referenced end at all is unverified", () => {
    const { design, run } = branchDesign(
      [
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [100, 60, 60],
      { phase: "liquid", takeoff: "bottom", junctions: {} },
    );
    expect(validateBranchTakeoff(design, run).state).toBe("BRANCH_TAKEOFF_UNVERIFIED");
  });

  it("an attached top-out take-off with a rising leg passes", () => {
    let design = createEmptyDesign("Plan");
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    const run = {
      id: "b",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      elevIn: [126, 186, 186],
      diameterIn: 8,
      elevationIn: 126,
      branchRole: "header-takeoff",
      phase: "vapor",
      takeoff: "top",
      attachments: { start: { symbolId: "v", anchorId: "top-out" } },
    };
    design = { ...design, pipes: [run] };
    expect(validateBranchTakeoff(design, run).state).toBe("PASS");
  });
});

// ------------------------------------------------------------------
// D687-004: closed typed reference schedules. Unknown provisions,
// empty loop geometry, non-U loops, and non-boolean operator-side
// values never qualify.
// ------------------------------------------------------------------
describe("D687-004 reference checks: closed schedules", () => {
  it("a loop provision with empty loopPoints is unverified", () => {
    const result = routeReferenceChecks({
      id: "p1",
      flexibility: { required: true, provision: "loop", loopPoints: [] },
    });
    expect(result.flexibility.state).toBe("FLEXIBILITY_NOT_VERIFIED");
  });

  it("an unknown provision name is unverified", () => {
    const result = routeReferenceChecks({
      id: "p1",
      flexibility: { required: true, provision: "banana" },
    });
    expect(result.flexibility.state).toBe("FLEXIBILITY_NOT_VERIFIED");
  });

  it("an L-path is not a U loop", () => {
    const result = routeReferenceChecks({
      id: "p1",
      flexibility: {
        required: true,
        provision: "loop",
        loopPoints: [
          { x: 0, y: 0, zIn: 30 },
          { x: 0, y: 20, zIn: 30 },
          { x: 20, y: 20, zIn: 30 },
        ],
      },
    });
    expect(result.flexibility.state).toBe("FLEXIBILITY_LOOP_SHAPE");
    expect(codes(result.flexibility.findings)).toEqual(["FLEXIBILITY_LOOP_SHAPE"]);
  });

  it("a genuine U loop passes", () => {
    const result = routeReferenceChecks({
      id: "p1",
      flexibility: {
        required: true,
        provision: "loop",
        loopPoints: [
          { x: 0, y: 0, zIn: 30 },
          { x: 0, y: 20, zIn: 30 },
          { x: 20, y: 20, zIn: 30 },
          { x: 20, y: 0, zIn: 30 },
        ],
      },
    });
    expect(result.flexibility.state).toBe("PASS");
  });

  it('operatorSide "false" (string) is unverified, never a pass', () => {
    const result = routeReferenceChecks({
      id: "p1",
      valveStations: [{ parallelTo: "rack", operatorSide: "false" }],
    });
    expect(result.valves.state).toBe("VALVE_ARRANGEMENT_UNVERIFIED");
  });

  it('parallelTo "other" is a mismatch', () => {
    const result = routeReferenceChecks({
      id: "p1",
      valveStations: [{ parallelTo: "other", operatorSide: true }],
    });
    expect(result.valves.state).toBe("VALVE_ARRANGEMENT_MISMATCH");
  });

  it("meter: authored lengths with no route geometry are unverified", () => {
    const result = routeReferenceChecks({
      id: "p1",
      diameterIn: 4,
      isMeterRun: true,
      meterSchedule: { upstreamDiameters: 10, downstreamDiameters: 5 },
      meterStraightUpstreamIn: 40,
      meterStraightDownstreamIn: 20,
    });
    expect(result.meter.state).toBe("METER_SCHEDULE_NOT_VERIFIED");
  });

  it("meter: one straight interval covering the sum passes", () => {
    const { design, run } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 4,
      isMeterRun: true,
      meterSchedule: { upstreamDiameters: 10, downstreamDiameters: 5 },
      meterStraightUpstreamIn: 40,
      meterStraightDownstreamIn: 20,
    });
    expect(routeReferenceChecks(design, run).meter.state).toBe("PASS");
  });

  it("meter: two distinct intervals meeting the two requirements pass", () => {
    const { design, run } = flat(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 20 },
        { x: 100, y: 20 },
      ],
      "p1",
      {
        diameterIn: 4,
        isMeterRun: true,
        meterSchedule: { upstreamDiameters: 10, downstreamDiameters: 5 },
        meterStraightUpstreamIn: 40,
        meterStraightDownstreamIn: 20,
      },
    );
    expect(routeReferenceChecks(design, run).meter.state).toBe("PASS");
  });

  it("meter: intervals too short for the requirements are unverified", () => {
    const { design, run } = flat([{ x: 0, y: 0 }, { x: 30, y: 0 }], "p1", {
      diameterIn: 4,
      isMeterRun: true,
      meterSchedule: { upstreamDiameters: 10, downstreamDiameters: 5 },
      meterStraightUpstreamIn: 40,
      meterStraightDownstreamIn: 20,
    });
    expect(routeReferenceChecks(design, run).meter.state).toBe("METER_SCHEDULE_NOT_VERIFIED");
  });
});

// ------------------------------------------------------------------
// D687-005: routing metadata is admitted detached and typed; the
// caller's objects never alias the saved design.
// ------------------------------------------------------------------
describe("D687-005 metadata admission: detached and typed", () => {
  it("mutating the caller's flexibility after add does not change the design", () => {
    const flex = {
      required: true,
      provision: "loop",
      loopPoints: [
        { x: 0, y: 0, zIn: 30 },
        { x: 0, y: 20, zIn: 30 },
        { x: 20, y: 20, zIn: 30 },
        { x: 20, y: 0, zIn: 30 },
      ],
    };
    const { run } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", { flexibility: flex });
    flex.provision = "banana";
    flex.loopPoints.push({ x: 99, y: 99, zIn: 30 });
    expect(run.flexibility.provision).toBe("loop");
    expect(run.flexibility.loopPoints).toHaveLength(4);
  });

  it("mutating the caller's meter schedule and valve stations after add does not change the design", () => {
    const sched = { upstreamDiameters: 10, downstreamDiameters: 5 };
    const stations = [{ parallelTo: "rack", operatorSide: true }];
    const { run } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      isMeterRun: true,
      meterSchedule: sched,
      valveStations: stations,
    });
    sched.upstreamDiameters = 99;
    stations[0].operatorSide = false;
    stations.push({ parallelTo: "other", operatorSide: true });
    expect(run.meterSchedule.upstreamDiameters).toBe(10);
    expect(run.valveStations).toHaveLength(1);
    expect(run.valveStations[0].operatorSide).toBe(true);
  });

  it('isMeterRun "false" (string) is rejected, not coerced to true', () => {
    let design = createEmptyDesign("Plan");
    expect(() =>
      addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "p1", isMeterRun: "false" }),
    ).toThrow();
    const ok = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "p1", isMeterRun: false });
    expect(ok.pipes[0].isMeterRun).toBe(false);
  });

  it("stored metadata survives a JSON serialization round-trip", () => {
    const { design } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      flexibility: { required: true, provision: "offset" },
      isMeterRun: true,
      meterSchedule: { upstreamDiameters: 10, downstreamDiameters: 5 },
      valveStations: [{ parallelTo: "rack", operatorSide: true }],
    });
    const restored = JSON.parse(JSON.stringify(design));
    const run = restored.pipes[0];
    expect(run.flexibility).toEqual({ required: true, provision: "offset" });
    expect(run.meterSchedule).toEqual({ upstreamDiameters: 10, downstreamDiameters: 5 });
    expect(run.valveStations).toEqual([{ parallelTo: "rack", operatorSide: true }]);
  });

  it("REPLACE_PIPE_ROUTE preserves metadata and UNDO restores route and metadata", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 50 }], {
      id: "p1",
      elevationIn: 30,
      flexibility: { required: true, provision: "offset" },
      meterSchedule: { upstreamDiameters: 10, downstreamDiameters: 5 },
    });
    const state = createInitialState(design);
    const next = designerReducer(state, {
      type: "REPLACE_PIPE_ROUTE",
      pipeId: "p1",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      elevIn: [30, 30, 30],
    });
    const run = next.design.pipes.find((p) => p.id === "p1");
    expect(run.flexibility).toEqual({ required: true, provision: "offset" });
    expect(run.meterSchedule).toEqual({ upstreamDiameters: 10, downstreamDiameters: 5 });
    const undone = designerReducer(next, { type: "UNDO" });
    const restored = undone.design.pipes.find((p) => p.id === "p1");
    expect(restored.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(restored.flexibility).toEqual({ required: true, provision: "offset" });
  });
});

// ------------------------------------------------------------------
// D687-006: omitted elevIn across a vertex-count change derives (or
// refuses) — the old elevation array is never retained.
// ------------------------------------------------------------------
describe("D687-006 elevations: derive or refuse, never stale", () => {
  it("domain: 2-vertex [30,100] replaced by 3 plan points derives [30,65,100]", () => {
    const { design, run } = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [30, 100],
    );
    const next = replacePipeRoute(design, run.id, [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    const replaced = next.pipes.find((p) => p.id === run.id);
    expect(replaced.points).toHaveLength(3);
    expect(replaced.elevIn).toEqual([30, 65, 100]);
  });

  it("domain: omitted elevIn with a moved endpoint throws", () => {
    const { design, run } = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [30, 100],
    );
    expect(() =>
      replacePipeRoute(design, run.id, [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 110, y: 0 },
      ]),
    ).toThrow();
  });

  it("domain: omitted elevIn with an interior vertex on a riser throws (ambiguous)", () => {
    const { design, run } = literal(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [30, 60, 60],
    );
    expect(() =>
      replacePipeRoute(design, run.id, [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toThrow();
  });

  it("domain: omitted elevIn with an interior vertex off the old route throws", () => {
    const { design, run } = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [30, 100],
    );
    expect(() =>
      replacePipeRoute(design, run.id, [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 0 },
      ]),
    ).toThrow();
  });

  it("reducer: omitted elevIn derives, and UNDO restores points and elevations", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "p1", elevationIn: 30 });
    // Store the sloped [30,100] profile directly (addPipeRun stores a
    // single elevation; the slope lives in elevIn).
    design = {
      ...design,
      pipes: design.pipes.map((p) => (p.id === "p1" ? { ...p, elevIn: [30, 100] } : p)),
    };
    const state = createInitialState(design);
    const next = designerReducer(state, {
      type: "REPLACE_PIPE_ROUTE",
      pipeId: "p1",
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
    });
    const run = next.design.pipes.find((p) => p.id === "p1");
    expect(run.points).toHaveLength(3);
    expect(run.elevIn).toEqual([30, 65, 100]);
    const undone = designerReducer(next, { type: "UNDO" });
    const restored = undone.design.pipes.find((p) => p.id === "p1");
    expect(restored.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(restored.elevIn).toEqual([30, 100]);
  });

  it("reducer: omitted elevIn with a moved endpoint throws instead of going stale", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "p1", elevationIn: 30 });
    const state = createInitialState(design);
    expect(() =>
      designerReducer(state, {
        type: "REPLACE_PIPE_ROUTE",
        pipeId: "p1",
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 110, y: 0 },
        ],
      }),
    ).toThrow();
  });

  it("save/load: a replaced design round-trips points and elevations through JSON", () => {
    const { design, run } = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [30, 100],
    );
    const next = replacePipeRoute(design, run.id, [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    const restored = JSON.parse(JSON.stringify(next));
    const replaced = restored.pipes.find((p) => p.id === run.id);
    expect(replaced.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(replaced.elevIn).toEqual([30, 65, 100]);
  });
});

// ------------------------------------------------------------------
// D687-007: simplify only verified collinear forward single-axis legs.
// Diagonal, malformed, turn, and reversal vertices survive.
// ------------------------------------------------------------------
describe("D687-007 simplify: verified collinear forward only", () => {
  it("the verdict case keeps all three points (both legs diagonal)", () => {
    expect(
      simplifyRouteLegs([
        { x: 0, y: 0, zIn: 30 },
        { x: 50, y: 40, zIn: 30 },
        { x: 100, y: 0, zIn: 30 },
      ]),
    ).toEqual([
      { x: 0, y: 0, zIn: 30 },
      { x: 50, y: 40, zIn: 30 },
      { x: 100, y: 0, zIn: 30 },
    ]);
  });

  it("valid positive: straight-forward middle vertices still drop", () => {
    expect(
      simplifyRouteLegs([
        { x: 0, y: 0, zIn: 30 },
        { x: 50, y: 0, zIn: 30 },
        { x: 100, y: 0, zIn: 30 },
      ]),
    ).toEqual([
      { x: 0, y: 0, zIn: 30 },
      { x: 100, y: 0, zIn: 30 },
    ]);
  });

  it("valid positive: turns are kept", () => {
    expect(
      simplifyRouteLegs([
        { x: 0, y: 0, zIn: 30 },
        { x: 100, y: 0, zIn: 30 },
        { x: 100, y: 50, zIn: 30 },
      ]),
    ).toEqual([
      { x: 0, y: 0, zIn: 30 },
      { x: 100, y: 0, zIn: 30 },
      { x: 100, y: 50, zIn: 30 },
    ]);
  });

  it("valid positive: a reversal is kept", () => {
    expect(
      simplifyRouteLegs([
        { x: 0, y: 0, zIn: 30 },
        { x: 100, y: 0, zIn: 30 },
        { x: 50, y: 0, zIn: 30 },
      ]),
    ).toEqual([
      { x: 0, y: 0, zIn: 30 },
      { x: 100, y: 0, zIn: 30 },
      { x: 50, y: 0, zIn: 30 },
    ]);
  });

  it("valid positive: vertical collinear forward legs still drop", () => {
    expect(
      simplifyRouteLegs([
        { x: 0, y: 0, zIn: 30 },
        { x: 0, y: 0, zIn: 60 },
        { x: 0, y: 0, zIn: 90 },
      ]),
    ).toEqual([
      { x: 0, y: 0, zIn: 30 },
      { x: 0, y: 0, zIn: 90 },
    ]);
  });

  it("valid positive: a vertical-then-horizontal turn is kept", () => {
    expect(
      simplifyRouteLegs([
        { x: 0, y: 0, zIn: 30 },
        { x: 0, y: 0, zIn: 60 },
        { x: 100, y: 0, zIn: 60 },
      ]),
    ).toEqual([
      { x: 0, y: 0, zIn: 30 },
      { x: 0, y: 0, zIn: 60 },
      { x: 100, y: 0, zIn: 60 },
    ]);
  });

  it("malformed points are preserved, never silently dropped", () => {
    const result = simplifyRouteLegs([
      { x: 0, y: 0, zIn: 30 },
      { x: Number.NaN, y: 0, zIn: 30 },
      { x: 100, y: 0, zIn: 30 },
    ]);
    expect(result).toHaveLength(3);
    expect(Number.isNaN(result[1].x)).toBe(true);
  });
});
