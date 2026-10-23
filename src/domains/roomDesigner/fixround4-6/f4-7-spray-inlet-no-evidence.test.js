// F4.7 probe (PR #668 fix round 4.6) — the spray-inlet gate verifies a
// route the shared helper classifies as having no approach evidence.
// ChatGPT's round-4.5 verdict (executed at 3c48c71d, a direct
// control-flow proof): at the exact connection-face tolerance
// boundary — 0.5 in below in elevation and <= 0.5 in away in plan —
// verifiedSpraySupply's rise predicate
// (`neighborNode.zIn <= node.zIn - CONNECTION_FACE_TOLERANCE_IN`) and
// its verticality check add no problem, effectiveApproachSegment
// reports foundEvidence:false, and the round-4.5 reducer block
// (`if (approach && approach.foundEvidence)`) silently skips the
// reducer check AND adds no no-approach error — so the gate returns
// ok:true. In the mixed-size case the owned-reducer requirement is
// bypassed too.
//
// These probes FAIL against the round-4.5 implementation and must
// PASS after the fix: the spray-inlet gate fails closed whenever the
// effective approach is null or foundEvidence is false, BEFORE size
// equality or reducer matching (the F4.6 rule already enforced at
// nozzles, junctions, and authoring).

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { placeReducer } from "../pipeReducerModel";
import { verifiedSpraySupply } from "../firewater";

beforeEach(() => {
  resetDesignerIds();
});

// Boundary fixture. The terminal spray segment sits at the exact
// connection-face tolerance boundary: `riseIn` below the inlet in
// elevation, `planOffset` away in plan. The inlet is at (0,1000),
// elevation 0 (the spray symbol default).
//
// The rest of the route reaches the firewater source through a
// junction DECLARED ON THE MAIN HEADER's side. The branch's own ends
// carry no approach evidence by construction, and under F4.6 a
// branch-declared junction would (correctly) refuse as "no-approach";
// the header's approach is evidence-bearing, so the source path is
// valid and the probes isolate the inlet-side control flow. Main and
// branch share the same nominal size so the source junction needs no
// tap reducer.
function sprayBoundaryDesign({
  planOffset,
  riseIn,
  inletEnd,
  branchSizeIn,
  inletSizeIn,
  withReducer = false,
  chain = false,
}) {
  const mainY = 1000 - planOffset;
  // For the two-segment chain each segment sits at the boundary in
  // elevation (0.5 in) and within tolerance in plan, so the whole
  // route is evidence-free while the terminal neighbor still passes
  // the rise predicate (exactly 0.5 in below the inlet). The main
  // header drops to the branch start elevation so the declared
  // junction's faces still meet.
  const startElev = chain ? -1.0 : -riseIn;
  let design = createEmptyDesign();
  design = placeSymbol(design, "piping", "spray-nozzle", 0, 1000, {
    id: "s",
    tag: "FA-901",
  });
  design = {
    ...design,
    symbols: design.symbols.map((s) =>
      s.id === "s"
        ? { ...s, inletRunId: "takeoff", inletEnd, inletSizeIn }
        : s,
    ),
  };
  design = addPipeRun(design, [{ x: 0, y: mainY }, { x: 1200, y: mainY }], {
    id: "main",
    diameterIn: branchSizeIn,
    elevationIn: startElev,
    utility: "firewater",
    sourceOf: "firewater",
    underground: true,
  });
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "main" ? { ...p, junctions: { start: { runId: "takeoff" } } } : p,
    ),
  };
  // Literal branch object: the 0-plan-offset variant is a duplicate
  // plan point with its own elevation (the codebase's riser
  // representation); addPipeRun dedupes consecutive duplicate plan
  // points, so the literal form is required.
  const inletPt = { x: 0, y: 1000 };
  const startPt = { x: 0, y: mainY };
  const midPt = { x: 0, y: mainY + planOffset / 2 };
  const segPoints =
    inletEnd === "end"
      ? chain
        ? [startPt, midPt, inletPt]
        : [startPt, inletPt]
      : chain
        ? [inletPt, midPt, startPt]
        : [inletPt, startPt];
  const segElev =
    inletEnd === "end"
      ? chain
        ? [startElev, startElev + 0.5, startElev + 1.0]
        : [startElev, startElev + riseIn]
      : chain
        ? [startElev + 1.0, startElev + 0.5, startElev]
        : [startElev + riseIn, startElev];
  const branch = {
    id: "takeoff",
    points: segPoints,
    diameterIn: branchSizeIn,
    elevIn: segElev,
    utility: "firewater",
  };
  design = { ...design, pipes: [...design.pipes, branch] };
  if (withReducer) {
    // Hand-authored reducer record (NOT via placeReducer): under F4.6,
    // modeledConnectionsAtPoint omits ends whose route carries no
    // evidence, so placeReducer correctly refuses to author a
    // transition on this evidence-free end — that refusal is the
    // intended defense-in-depth. The probe authors the identical
    // record placeReducer would have persisted (same portOwners
    // convention: the outlet owns the smaller side's interface, the
    // inlet the larger side's) to prove the pre-fix BYPASS: the
    // round-4.5 reducer block skips the query entirely when
    // foundEvidence is false, so even a properly owned reducer is
    // never consulted and the gate verifies clean. Post-fix the
    // evidence gate refuses before reducer matching, owned or not.
    design = placeSymbol(design, "piping", "reducer", 0, 1000, {
      id: "inlet-red",
      rotationDeg: 180,
    });
    design = {
      ...design,
      symbols: design.symbols.map((s) =>
        s.id === "inlet-red"
          ? {
              ...s,
              inletSizeIn: 6,
              outletSizeIn: 4,
              elevationIn: 0,
              portOwners: {
                inlet: { kind: "run-end", runId: "takeoff", end: inletEnd },
                outlet: { kind: "spray-inlet", symbolId: "s", anchorId: "inlet" },
              },
            }
          : s,
      ),
    };
  }
  return design;
}

const sprayOf = (design) => design.symbols.find((s) => s.id === "s");
const noEvidence = (supply) =>
  supply.problems.some((p) => /no approach evidence/i.test(p));

// ------------------------------------------------------------------
// Harm probes — must FAIL pre-fix (the gate verifies clean) and PASS
// post-fix (named no-approach-evidence refusal).
// ------------------------------------------------------------------

describe("F4.7 spray inlet: exact-boundary route refuses (equal-size)", () => {
  for (const inletEnd of ["end", "start"]) {
    for (const planOffset of [0.5, 0]) {
      it(`0.5-in rise, ${planOffset}-in plan, ${inletEnd} convention: named no-evidence refusal`, () => {
        const design = sprayBoundaryDesign({
          planOffset,
          riseIn: 0.5,
          inletEnd,
          branchSizeIn: 4,
          inletSizeIn: 4,
        });
        const supply = verifiedSpraySupply(design, sprayOf(design));
        expect(supply.ok).toBe(false);
        expect(noEvidence(supply)).toBe(true);
      });
    }
  }
});

describe("F4.7 spray inlet: exact-boundary route refuses (mixed-size)", () => {
  for (const inletEnd of ["end", "start"]) {
    it(`0.5-in rise, 0.5-in plan, ${inletEnd} convention, no owned reducer: named refusal (owned-reducer requirement bypassed pre-fix)`, () => {
      const design = sprayBoundaryDesign({
        planOffset: 0.5,
        riseIn: 0.5,
        inletEnd,
        branchSizeIn: 6,
        inletSizeIn: 4,
      });
      const supply = verifiedSpraySupply(design, sprayOf(design));
      expect(supply.ok).toBe(false);
      expect(noEvidence(supply)).toBe(true);
    });
  }
  it("0.5-in rise, 0.5-in plan, end convention, WITH owned reducer: still refused (evidence gate precedes reducer matching)", () => {
    const design = sprayBoundaryDesign({
      planOffset: 0.5,
      riseIn: 0.5,
      inletEnd: "end",
      branchSizeIn: 6,
      inletSizeIn: 4,
      withReducer: true,
    });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.ok).toBe(false);
    expect(noEvidence(supply)).toBe(true);
  });
});

describe("F4.7 spray inlet: within-tolerance chain refuses", () => {
  it("two 0.25-in segments (0.25 plan + 0.25 elev each), end convention, equal-size: named refusal", () => {
    const design = sprayBoundaryDesign({
      planOffset: 0.5,
      riseIn: 0.25,
      inletEnd: "end",
      branchSizeIn: 4,
      inletSizeIn: 4,
      chain: true,
    });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.ok).toBe(false);
    expect(noEvidence(supply)).toBe(true);
  });
});

// ------------------------------------------------------------------
// Positive controls — must PASS in both runs.
// ------------------------------------------------------------------

describe("F4.7 controls: genuine approaches are unaffected", () => {
  it("beyond-tolerance riser (36-in rise, 0.5-in plan), end convention, equal-size: verifies", () => {
    const design = sprayBoundaryDesign({
      planOffset: 0.5,
      riseIn: 36,
      inletEnd: "end",
      branchSizeIn: 4,
      inletSizeIn: 4,
    });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.problems).toEqual([]);
    expect(supply.ok).toBe(true);
  });
  it("beyond-tolerance riser, mixed-size WITH owned reducer: verifies", () => {
    const design = sprayBoundaryDesign({
      planOffset: 0.5,
      riseIn: 36,
      inletEnd: "end",
      branchSizeIn: 6,
      inletSizeIn: 4,
      withReducer: true,
    });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.problems).toEqual([]);
    expect(supply.ok).toBe(true);
  });
  it("beyond-tolerance riser, mixed-size WITHOUT owned reducer: missing-reducer error only (never the no-evidence error)", () => {
    const design = sprayBoundaryDesign({
      planOffset: 0.5,
      riseIn: 36,
      inletEnd: "end",
      branchSizeIn: 6,
      inletSizeIn: 4,
    });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.ok).toBe(false);
    expect(supply.problems.some((p) => /without a reducer owned/i.test(p))).toBe(true);
    expect(noEvidence(supply)).toBe(false);
  });
  it("just-below-boundary (0.49-in rise, 0.5-in plan): refused in both runs", () => {
    const design = sprayBoundaryDesign({
      planOffset: 0.5,
      riseIn: 0.49,
      inletEnd: "end",
      branchSizeIn: 4,
      inletSizeIn: 4,
    });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.ok).toBe(false);
  });
});
