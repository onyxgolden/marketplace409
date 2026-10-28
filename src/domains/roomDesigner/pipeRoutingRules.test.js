// pipeRoutingRules.test.js — D10-01 grid/orthogonal routing foundation.
//
// Covers brief §D10-01: single-coordinate legs, vertical risers, epsilon
// and face-tolerance boundaries, reversals/retracing, endpoint ownership,
// phase-driven take-offs (never inferred from service), reference checks
// with named NOT_VERIFIED states, bounded preview candidates, legacy
// repair, and the one-transaction REPLACE_PIPE_ROUTE apply.

import { describe, expect, it } from "vitest";
import {
  ROUTE_AXIS_EPSILON_IN,
  classifyLeg,
  previewOrthogonalRoute,
  repairLegacyRoute,
  routeCheckStates,
  routeReferenceChecks,
  pipeRoutingRuleErrors,
  simplifyRouteLegs,
  validateBranchTakeoff,
  validateRouteEndpoints,
  validateRouteOrthogonality,
} from "./pipeRoutingRules";
import {
  addPipeRun,
  createEmptyDesign,
  replacePipeRoute,
} from "./designerDocument";
import { createInitialState, designerReducer } from "@/components/designer/designerReducer";

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

describe("validateRouteOrthogonality", () => {
  it("passes an axis-aligned L route", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(validateRouteOrthogonality(design, run)).toEqual([]);
  });

  it("flags a diagonal leg with its index", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    const findings = validateRouteOrthogonality(design, run);
    expect(codes(findings)).toEqual(["ROUTE_DIAGONAL_LEG"]);
    expect(findings[0].legIndex).toBe(0);
  });

  it("flags a sloped leg (plan + elevation change) as diagonal", () => {
    const { design, run } = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [30, 30, 60],
    );
    expect(codes(validateRouteOrthogonality(design, run))).toEqual(["ROUTE_DIAGONAL_LEG"]);
  });

  it("passes a vertical riser: duplicate plan points, different elevations", () => {
    const { design, run } = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [30, 30, 60, 60],
    );
    expect(validateRouteOrthogonality(design, run)).toEqual([]);
  });

  it("flags a degenerate leg (duplicate plan and elevation)", () => {
    const { design, run } = literal(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [30, 30, 30],
    );
    expect(codes(validateRouteOrthogonality(design, run))).toEqual(["ROUTE_DEGENERATE_LEG"]);
  });

  it("treats the 1e-6 axis epsilon as a frozen boundary", () => {
    expect(ROUTE_AXIS_EPSILON_IN).toBe(1e-6);
    const at = flat([
      { x: 0, y: 0 },
      { x: 100, y: 1e-6 },
    ]);
    expect(validateRouteOrthogonality(at.design, at.run)).toEqual([]);
    const over = flat([
      { x: 0, y: 0 },
      { x: 100, y: 1e-4 },
    ]);
    expect(codes(validateRouteOrthogonality(over.design, over.run))).toEqual([
      "ROUTE_DIAGONAL_LEG",
    ]);
  });

  it("flags an exact reversal", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
    ]);
    expect(codes(validateRouteOrthogonality(design, run))).toEqual(["ROUTE_REVERSAL"]);
  });

  it("flags a non-adjacent retrace without double-reporting the reversal", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 50, y: 100 },
      { x: 50, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(codes(validateRouteOrthogonality(design, run))).toEqual(["ROUTE_RETRACE"]);
  });

  it("passes co-linear forward legs", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(validateRouteOrthogonality(design, run)).toEqual([]);
  });

  it("classifies legs: axis, vertical, diagonal, degenerate", () => {
    expect(classifyLeg({ x: 0, y: 0, zIn: 30 }, { x: 10, y: 0, zIn: 30 }).kind).toBe("axis");
    expect(classifyLeg({ x: 0, y: 0, zIn: 30 }, { x: 0, y: 0, zIn: 60 }).kind).toBe("vertical");
    expect(classifyLeg({ x: 0, y: 0, zIn: 30 }, { x: 10, y: 10, zIn: 30 }).kind).toBe("diagonal");
    expect(classifyLeg({ x: 0, y: 0, zIn: 30 }, { x: 0, y: 0, zIn: 30 }).kind).toBe("degenerate");
  });
});

describe("simplifyRouteLegs", () => {
  it("drops straight-forward middle vertices and keeps turns", () => {
    const route = [
      { x: 0, y: 0, zIn: 30 },
      { x: 50, y: 0, zIn: 30 },
      { x: 100, y: 0, zIn: 30 },
      { x: 100, y: 50, zIn: 30 },
    ];
    expect(simplifyRouteLegs(route)).toEqual([
      { x: 0, y: 0, zIn: 30 },
      { x: 100, y: 0, zIn: 30 },
      { x: 100, y: 50, zIn: 30 },
    ]);
  });

  it("never simplifies a reversal away", () => {
    const route = [
      { x: 0, y: 0, zIn: 30 },
      { x: 100, y: 0, zIn: 30 },
      { x: 50, y: 0, zIn: 30 },
    ];
    expect(simplifyRouteLegs(route)).toHaveLength(3);
  });
});

describe("validateRouteEndpoints", () => {
  it("flags both ends of an unconnected run", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(codes(validateRouteEndpoints(design, run))).toEqual([
      "ROUTE_UNCONNECTED_END",
      "ROUTE_UNCONNECTED_END",
    ]);
  });

  it("treats the 0.5-in junction tolerance as a frozen boundary", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "a", elevationIn: 30 });
    design = addPipeRun(design, [{ x: 100.5, y: 0 }, { x: 100.5, y: 50 }], { id: "b", elevationIn: 30 });
    const a = design.pipes[0];
    expect(validateRouteEndpoints(design, a).filter((f) => f.code === "ROUTE_UNCONNECTED_END")).toHaveLength(1);
    // Only the start end is unconnected; the end touches run b exactly
    // at the tolerance.
    let design2 = createEmptyDesign("Plan");
    design2 = addPipeRun(design2, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "a", elevationIn: 30 });
    design2 = addPipeRun(design2, [{ x: 100.6, y: 0 }, { x: 100.6, y: 50 }], { id: "b", elevationIn: 30 });
    const a2 = design2.pipes[0];
    expect(validateRouteEndpoints(design2, a2).filter((f) => f.code === "ROUTE_UNCONNECTED_END")).toHaveLength(2);
  });

  it("flags an attachment naming a face that does not resolve", () => {
    const { design, run } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1");
    const claimed = { ...run, attachments: { start: { symbolId: "ghost", anchorId: "nope" } } };
    const design2 = { ...design, pipes: [claimed] };
    expect(codes(validateRouteEndpoints(design2, claimed))).toContain("ROUTE_FACE_UNRESOLVED");
  });
});

describe("validateBranchTakeoff", () => {
  it("is not applicable to non-header runs", () => {
    expect(validateBranchTakeoff({ id: "p1" }).state).toBe("NOT_APPLICABLE");
  });

  it("requires a scheduled phase and never infers it from service", () => {
    const run = { id: "p1", branchRole: "header-takeoff", service: "steam" };
    const result = validateBranchTakeoff(run);
    expect(result.state).toBe("BRANCH_PHASE_UNVERIFIED");
    expect(codes(result.findings)).toEqual(["BRANCH_PHASE_UNVERIFIED"]);
  });

  it("passes liquid-bottom and vapor/steam-top, mismatches the rest", () => {
    expect(
      validateBranchTakeoff({ id: "p1", branchRole: "header-takeoff", phase: "liquid", takeoff: "bottom" }).state,
    ).toBe("PASS");
    expect(
      validateBranchTakeoff({ id: "p1", branchRole: "header-takeoff", phase: "vapor", takeoff: "top" }).state,
    ).toBe("PASS");
    expect(
      validateBranchTakeoff({ id: "p1", branchRole: "header-takeoff", phase: "steam", takeoff: "top" }).state,
    ).toBe("PASS");
    expect(
      validateBranchTakeoff({ id: "p1", branchRole: "header-takeoff", phase: "liquid", takeoff: "top" }).state,
    ).toBe("BRANCH_TAKEOFF_MISMATCH");
    expect(
      validateBranchTakeoff({ id: "p1", branchRole: "header-takeoff", phase: "vapor", takeoff: "bottom" }).state,
    ).toBe("BRANCH_TAKEOFF_MISMATCH");
  });

  it("flags a known phase with no scheduled take-off direction", () => {
    expect(
      validateBranchTakeoff({ id: "p1", branchRole: "header-takeoff", phase: "liquid" }).state,
    ).toBe("BRANCH_TAKEOFF_UNVERIFIED");
  });

  it("stores phase/take-off through addPipeRun", () => {
    const { run } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      branchRole: "header-takeoff",
      phase: "liquid",
      takeoff: "bottom",
    });
    expect(run.phase).toBe("liquid");
    expect(run.takeoff).toBe("bottom");
    expect(validateBranchTakeoff(run).state).toBe("PASS");
  });
});

describe("routeReferenceChecks", () => {
  it("flexibility: missing provision, unverified, pass, non-orthogonal loop", () => {
    expect(routeReferenceChecks({ id: "p1", flexibility: { required: true } }).flexibility.state).toBe(
      "FLEXIBILITY_PROVISION_MISSING",
    );
    expect(routeReferenceChecks({ id: "p1" }).flexibility.state).toBe("FLEXIBILITY_NOT_VERIFIED");
    expect(routeReferenceChecks({ id: "p1", flexibility: { required: false } }).flexibility.state).toBe("PASS");
    expect(
      routeReferenceChecks({
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
      }).flexibility.state,
    ).toBe("PASS");
    expect(
      routeReferenceChecks({
        id: "p1",
        flexibility: {
          required: true,
          provision: "loop",
          loopPoints: [
            { x: 0, y: 0, zIn: 30 },
            { x: 20, y: 20, zIn: 30 },
          ],
        },
      }).flexibility.state,
    ).toBe("FLEXIBILITY_LOOP_NONORTHOGONAL");
  });

  it("meter: no invented multiplier — missing schedule is NOT_VERIFIED even with a known diameter", () => {
    expect(routeReferenceChecks({ id: "p1", diameterIn: 4, isMeterRun: true }).meter.state).toBe(
      "METER_SCHEDULE_NOT_VERIFIED",
    );
    expect(routeReferenceChecks({ id: "p1", diameterIn: 4 }).meter.state).toBe("NOT_APPLICABLE");
    const pass = routeReferenceChecks({
      id: "p1",
      diameterIn: 4,
      isMeterRun: true,
      meterSchedule: { upstreamDiameters: 10, downstreamDiameters: 5 },
      meterStraightUpstreamIn: 40,
      meterStraightDownstreamIn: 20,
    });
    expect(pass.meter.state).toBe("PASS");
    const short = routeReferenceChecks({
      id: "p1",
      diameterIn: 4,
      isMeterRun: true,
      meterSchedule: { upstreamDiameters: 10, downstreamDiameters: 5 },
      meterStraightUpstreamIn: 39,
      meterStraightDownstreamIn: 20,
    });
    expect(short.meter.state).toBe("METER_STRAIGHT_LENGTH_SHORT");
  });

  it("valves: parallel + operator side pass; wrong side mismatches; missing data unverified", () => {
    expect(routeReferenceChecks({ id: "p1" }).valves.state).toBe("NOT_APPLICABLE");
    expect(
      routeReferenceChecks({ id: "p1", valveStations: [{ parallelTo: "rack", operatorSide: true }] }).valves.state,
    ).toBe("PASS");
    expect(
      routeReferenceChecks({ id: "p1", valveStations: [{ parallelTo: "rack", operatorSide: false }] }).valves.state,
    ).toBe("VALVE_ARRANGEMENT_MISMATCH");
    expect(
      routeReferenceChecks({ id: "p1", valveStations: [{ parallelTo: "rack" }] }).valves.state,
    ).toBe("VALVE_ARRANGEMENT_UNVERIFIED");
  });
});

describe("routeCheckStates", () => {
  it("never reports all-clear while a required check lacks inputs", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    // Orthogonal geometry passes, but ends are unconnected and
    // flexibility is unverified: no all-clear.
    const states = routeCheckStates(design, run);
    expect(states.allClear).toBe(false);
    expect(states.checks.orthogonal).toBe("PASS");
    expect(states.checks.flexibility).toBe("FLEXIBILITY_NOT_VERIFIED");
  });

  it("reports all-clear only when every applicable check passes", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "a", elevationIn: 30, flexibility: { required: false } });
    design = addPipeRun(design, [{ x: 100, y: 0 }, { x: 100, y: 50 }], { id: "b", elevationIn: 30 });
    design = addPipeRun(design, [{ x: 100, y: 50 }, { x: 0, y: 0 }], { id: "c", elevationIn: 30 });
    const a = design.pipes[0];
    const states = routeCheckStates(design, a);
    expect(states.checks.endpoints).toBe("PASS");
    expect(states.allClear).toBe(true);
  });

  it("aggregates findings as grep-able strings", () => {
    const { design } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    const errors = pipeRoutingRuleErrors(design);
    expect(errors.some((e) => e.startsWith("ROUTE_DIAGONAL_LEG:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("ROUTE_UNCONNECTED_END:"))).toBe(true);
  });
});

describe("previewOrthogonalRoute", () => {
  it("proposes X-first and Y-first candidates that are orthogonal by construction", () => {
    const { candidates, findings } = previewOrthogonalRoute({
      from: { x: 0, y: 0, zIn: 30 },
      to: { x: 100, y: 50, zIn: 30 },
      diameterIn: 2,
      service: "Process",
    });
    expect(findings).toEqual([]);
    expect(candidates.map((c) => c.id)).toEqual(["x-first", "y-first"]);
    expect(candidates[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(candidates[1].points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
    for (const c of candidates) {
      const { design, run } = literal(c.points, c.elevIn, "p1");
      expect(validateRouteOrthogonality(design, run)).toEqual([]);
      expect(c.preserved.diameterIn).toBe(2);
      expect(c.preserved.service).toBe("Process");
      expect(c.revalidate).toEqual([]);
    }
  });

  it("carries an elevation change as a vertical riser with revalidation markers", () => {
    const { candidates } = previewOrthogonalRoute({
      from: { x: 0, y: 0, zIn: 30 },
      to: { x: 100, y: 0, zIn: 60 },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(candidates[0].elevIn).toEqual([30, 30, 60]);
    expect(candidates[0].revalidate).toEqual(["D10-02-supports", "D10-03-access"]);
  });

  it("dedupes to one candidate when endpoints are already aligned", () => {
    const { candidates } = previewOrthogonalRoute({
      from: { x: 0, y: 0, zIn: 30 },
      to: { x: 0, y: 50, zIn: 30 },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
    ]);
  });

  it("refuses coincident endpoints with ROUTE_UNRESOLVED and no diagonal fallback", () => {
    const { candidates, findings } = previewOrthogonalRoute({
      from: { x: 10, y: 10, zIn: 30 },
      to: { x: 10, y: 10, zIn: 30 },
    });
    expect(candidates).toEqual([]);
    expect(codes(findings)).toEqual(["ROUTE_UNRESOLVED"]);
  });
});

describe("repairLegacyRoute", () => {
  it("reroutes a diagonal run and never mutates the original", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    const before = JSON.stringify(run);
    const result = repairLegacyRoute(design, run);
    expect(result.repaired).toBe(true);
    expect(JSON.stringify(run)).toBe(before);
    const repaired = { ...result.route };
    const design2 = { ...design, pipes: [repaired] };
    expect(validateRouteOrthogonality(design2, repaired)).toEqual([]);
    expect(repaired.diameterIn).toBe(2);
  });

  it("leaves an already-compliant run alone", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const result = repairLegacyRoute(design, run);
    expect(result).toEqual({ route: null, repaired: false, findings: [] });
  });

  it("leaves an oblique-face route unresolved with old geometry standing", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    const result = repairLegacyRoute(design, run, { obliqueFace: true });
    expect(result.route).toBeNull();
    expect(result.repaired).toBe(false);
    expect(codes(result.findings)).toEqual(["ROUTE_UNRESOLVED"]);
  });
});

describe("replacePipeRoute", () => {
  it("replaces points and elevations without collapsing a riser", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const next = replacePipeRoute(
      design,
      run.id,
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [30, 30, 60, 60],
    );
    const replaced = next.pipes.find((p) => p.id === run.id);
    expect(replaced.points).toHaveLength(4);
    expect(replaced.elevIn).toEqual([30, 30, 60, 60]);
    expect(replaced.diameterIn).toBe(2);
  });

  it("rejects short routes, mismatched elevations and unknown runs", () => {
    const { design, run } = flat([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(() => replacePipeRoute(design, run.id, [{ x: 0, y: 0 }])).toThrow();
    expect(() => replacePipeRoute(design, run.id, [{ x: 0, y: 0 }, { x: 1, y: 0 }], [30])).toThrow();
    expect(() => replacePipeRoute(design, "nope", [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toThrow();
  });
});

describe("REPLACE_PIPE_ROUTE", () => {
  function start() {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 50 }], { id: "p1", elevationIn: 30 });
    return createInitialState(design);
  }

  it("applies a preview in one undoable transaction", () => {
    const state = start();
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
    expect(run.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(run.elevIn).toEqual([30, 30, 30]);
    expect(next.dirty).toBe(true);
    const undone = designerReducer(next, { type: "UNDO" });
    expect(undone.design.pipes.find((p) => p.id === "p1").points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
  });

  it("ignores an unknown pipe run", () => {
    const state = start();
    expect(designerReducer(state, { type: "REPLACE_PIPE_ROUTE", pipeId: "nope", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })).toBe(state);
  });
});
