// F4.1 probe (PR #668 fix round 4.2) — "riser" verification still
// accepts an arbitrarily sloped terminal segment. ChatGPT's round-4
// re-review at head 6fc6d47d (F4.1, P2):
//   attachmentInterfaceErrors (pipeAttachments.js) and
//   verifiedSpraySupply (firewater.js) prove only elevation
//   DIRECTION for a vertical face/inlet: a top nozzle accepts any
//   non-flat segment whose preceding elevation is at/above the face,
//   and a below-fed spray inlet accepts any terminal segment whose
//   preceding elevation is lower. Neither requires the terminal
//   segment to be VERTICAL in plan. ChatGPT's executed spray
//   counterexample: penultimate vertex (0, 500, -36) -> inlet
//   endpoint (0, 1000, 0) — a 500-inch plan run gaining 36 inches —
//   returns ok:true. Top-nozzle plan offsets of 1 and 500 inches
//   likewise return no interface errors.
//
// These probes FAIL against the round-4.1 implementation and must
// PASS after the fix: for a vertical face/inlet the terminal
// physical-route segment must be vertical within
// CONNECTION_FACE_TOLERANCE_IN (plan projection at or below
// tolerance) and on the correct exterior side. Zero-plan-length
// vertical positives (the codebase's riser representation —
// duplicate plan point, per-vertex elevIn) keep verifying for both
// endpoint conventions; long (500 in) and short (1 in) sloped
// terminals are refused for both conventions, at the top nozzle
// and at the spray inlet.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { attachmentInterfaceErrors } from "../pipeAttachments";
import { verifiedAttachments } from "../pipeCrossings";
import { sprayAssignmentStatus, verifiedSpraySupply } from "../firewater";
import { placeReducer } from "../pipeReducerModel";

beforeEach(() => {
  resetDesignerIds();
});

// ------------------------------------------------------------------
// Top nozzle (vertical face) — vertical vessel at (0, 0); its
// top-out face sits at (0, 0), elevation 126, 8 in (the F2.1
// fixture's catalog geometry).
// ------------------------------------------------------------------

function topNozzleDesign(points, elevIn, end) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
  const run = {
    id: "r",
    points,
    diameterIn: 8,
    elevIn,
    attachments: { [end]: { symbolId: "v", anchorId: "top-out" } },
  };
  return { ...design, pipes: [...design.pipes, run] };
}

const topErrors = (design) =>
  attachmentInterfaceErrors(design, design.pipes.find((p) => p.id === "r"), "end");
const topErrorsStart = (design) =>
  attachmentInterfaceErrors(design, design.pipes.find((p) => p.id === "r"), "start");

describe("F4.1 top nozzle: the terminal segment must be a vertical riser", () => {
  it("zero-plan-length vertical positives verify for both endpoint conventions", () => {
    // End convention: drop from above into the face.
    const endDesign = topNozzleDesign(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [186, 126],
      "end",
    );
    expect(topErrors(endDesign)).toEqual([]);
    expect(verifiedAttachments(endDesign)).toHaveLength(1);
    // Start convention: rise from the face upward.
    const startDesign = topNozzleDesign(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [126, 186],
      "start",
    );
    expect(topErrorsStart(startDesign)).toEqual([]);
    expect(verifiedAttachments(startDesign)).toHaveLength(1);
  });

  it("a 500-inch sloped terminal segment is refused (end convention)", () => {
    const design = topNozzleDesign(
      [
        { x: 500, y: 0 },
        { x: 0, y: 0 },
      ],
      [162, 126],
      "end",
    );
    const errors = topErrors(design);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /riser|vertical|sloped/i.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("a 500-inch sloped terminal segment is refused (start convention)", () => {
    const design = topNozzleDesign(
      [
        { x: 0, y: 0 },
        { x: 500, y: 0 },
      ],
      [126, 162],
      "start",
    );
    const errors = topErrorsStart(design);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /riser|vertical|sloped/i.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("a 1-inch sloped terminal segment is refused (both conventions)", () => {
    const endDesign = topNozzleDesign(
      [
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ],
      [162, 126],
      "end",
    );
    expect(topErrors(endDesign).length).toBeGreaterThan(0);
    expect(verifiedAttachments(endDesign)).toEqual([]);
    const startDesign = topNozzleDesign(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [126, 162],
      "start",
    );
    expect(topErrorsStart(startDesign).length).toBeGreaterThan(0);
    expect(verifiedAttachments(startDesign)).toEqual([]);
  });
});

// ------------------------------------------------------------------
// Spray inlet (vertical, below-fed) — the F3 fixture layout: vessel
// at (1000, 1000), spray s at (0, 1000), buried 12-in source main
// along y = 0 at -36, 6-in take-off junctioned onto the main at
// (0, 0) with its tap reducer. The take-off's points/elevIn are
// patched on (addPipeRun does not carry elevIn and collapses
// duplicate plan points — the riser is a duplicate plan point with
// its own elevation, the codebase's riser representation).
// ------------------------------------------------------------------

const BOUNDARY_AROUND_VESSEL = [
  { x: 900, y: 900 },
  { x: 1100, y: 900 },
  { x: 1100, y: 1100 },
  { x: 900, y: 1100 },
];

function spraySupplyDesign({ branchPoints, branchElevIn, inletEnd }) {
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
    diameterIn: 6,
    utility: "firewater",
  });
  // The junction sits on whichever take-off end lands on the main.
  const junctionEnd = inletEnd === "end" ? "start" : "end";
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "takeoff"
        ? {
            ...p,
            points: branchPoints,
            elevIn: branchElevIn,
            junctions: { [junctionEnd]: { runId: "main" } },
          }
        : p,
    ),
  };
  design = placeReducer(design, 0, 0, { id: "tap-red", inletSizeIn: 12, outletSizeIn: 6 });
  design = {
    ...design,
    symbols: design.symbols.map((s) =>
      s.id === "s" ? { ...s, inletRunId: "takeoff", inletEnd } : s,
    ),
  };
  return design;
}

const sprayOf = (design) => design.symbols.find((s) => s.id === "s");

describe("F4.1 spray inlet: the terminal segment must be a vertical riser", () => {
  it("zero-plan-length vertical positives verify for both endpoint conventions", () => {
    const endDesign = spraySupplyDesign({
      branchPoints: [
        { x: 0, y: 0 },
        { x: 0, y: 1000 },
        { x: 0, y: 1000 },
      ],
      branchElevIn: [-36, -36, 0],
      inletEnd: "end",
    });
    expect(verifiedSpraySupply(endDesign, sprayOf(endDesign))).toMatchObject({
      ok: true,
      problems: [],
    });
    expect(sprayAssignmentStatus(endDesign, sprayOf(endDesign)).ok).toBe(true);

    const startDesign = spraySupplyDesign({
      branchPoints: [
        { x: 0, y: 1000 },
        { x: 0, y: 1000 },
        { x: 0, y: 0 },
      ],
      branchElevIn: [0, -36, -36],
      inletEnd: "start",
    });
    expect(verifiedSpraySupply(startDesign, sprayOf(startDesign))).toMatchObject({
      ok: true,
      problems: [],
    });
    expect(sprayAssignmentStatus(startDesign, sprayOf(startDesign)).ok).toBe(true);
  });

  it("ChatGPT's counterexample: a 500-inch plan run gaining 36 in proves no supply (end)", () => {
    const design = spraySupplyDesign({
      branchPoints: [
        { x: 0, y: 0 },
        { x: 0, y: 500 },
        { x: 0, y: 1000 },
      ],
      branchElevIn: [-36, -36, 0],
      inletEnd: "end",
    });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.ok).toBe(false);
    expect(supply.problems.some((p) => /riser|vertical|sloped/i.test(p))).toBe(true);
    expect(sprayAssignmentStatus(design, sprayOf(design)).ok).toBe(false);
  });

  it("a 500-inch sloped terminal segment proves no supply (start convention)", () => {
    const design = spraySupplyDesign({
      branchPoints: [
        { x: 0, y: 1000 },
        { x: 0, y: 500 },
        { x: 0, y: 0 },
      ],
      branchElevIn: [0, -36, -36],
      inletEnd: "start",
    });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.ok).toBe(false);
    expect(supply.problems.some((p) => /riser|vertical|sloped/i.test(p))).toBe(true);
    expect(sprayAssignmentStatus(design, sprayOf(design)).ok).toBe(false);
  });

  it("a 1-inch sloped terminal segment proves no supply (both conventions)", () => {
    const endDesign = spraySupplyDesign({
      branchPoints: [
        { x: 0, y: 0 },
        { x: 0, y: 999 },
        { x: 0, y: 1000 },
      ],
      branchElevIn: [-36, -36, 0],
      inletEnd: "end",
    });
    expect(verifiedSpraySupply(endDesign, sprayOf(endDesign)).ok).toBe(false);
    const startDesign = spraySupplyDesign({
      branchPoints: [
        { x: 0, y: 1000 },
        { x: 0, y: 999 },
        { x: 0, y: 0 },
      ],
      branchElevIn: [0, -36, -36],
      inletEnd: "start",
    });
    expect(verifiedSpraySupply(startDesign, sprayOf(startDesign)).ok).toBe(false);
  });
});
