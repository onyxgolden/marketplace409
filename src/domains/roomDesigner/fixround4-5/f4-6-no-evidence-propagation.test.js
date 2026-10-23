// F4.6 probe (PR #668 fix round 4.5) — foundEvidence:false is not
// propagated: only attachmentInterfaceErrors consumed the refusal
// flag; validatedJunctionEdge and modeledConnectionsAtPoint still
// read .axisDeg without requiring evidence. ChatGPT's executed
// repro at 79fcd98e: a junction branch with points [{50,0},{50,0}]
// (all duplicate) validated "ok" through an owned 0/180 reducer and
// modeledConnectionsAtPoint emitted axisDeg:0 — an unknown approach
// represented as a verified 0-degree transition that authoring could
// persist.
//
// These probes FAIL against the round-4.4 implementation and must
// PASS after the fix: when foundEvidence is false, the junction
// edge refuses with an explicit no-approach status (never "ok", no
// reducer match) and authoring publishes no usable transition axis
// for that connection. Genuine planar and genuine vertical-riser
// junctions keep validating and authoring normally.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import {
  attachmentInterfaceErrors,
  connectionCompatibilityErrors,
} from "../pipeAttachments";
import { validatedJunctionEdge, verifiedAttachments } from "../pipeCrossings";
import { modeledConnectionsAtPoint, placeReducer } from "../pipeReducerModel";

beforeEach(() => {
  resetDesignerIds();
});

// ------------------------------------------------------------------
// Exhausted-junction fixtures — host 2-in h from (0,0) to (200,0) at
// elevation 150; branch b tapped at (50,0). The tapped end's route is
// ALL-DEGENERATE (every segment within the connection-face tolerance
// in plan and elevation), so effectiveApproachSegment reports
// foundEvidence:false. For the mixed-size form a 0/180 reducer is
// authored on the GENUINE branch geometry first (mirroring ChatGPT's
// executed repro), then the route is degenerated.
// ------------------------------------------------------------------

function exhaustedJunctionDesign({ end = "start", sameSize = false } = {}) {
  const bDia = sameSize ? 2 : 1;
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
    id: "h",
    diameterIn: 2,
    elevationIn: 150,
  });
  design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
    id: "b",
    diameterIn: bDia,
    elevationIn: 150,
  });
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "b" ? { ...p, junctions: { [end]: { runId: "h" } } } : p,
    ),
  };
  if (!sameSize) {
    design = placeReducer(design, 50, 0, {
      id: "r",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 0,
    });
  }
  // Degenerate the tapped end's route: every segment evidence-free.
  const points =
    end === "start"
      ? [
          { x: 50, y: 0 },
          { x: 50, y: 0 },
        ]
      : [
          { x: 50, y: 0.3 },
          { x: 50, y: 0 },
          { x: 50, y: 0 },
        ];
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "b" ? { ...p, points, elevIn: points.map(() => 150) } : p,
    ),
  };
  return design;
}

const branchOf = (design) => design.pipes.find((p) => p.id === "b");

describe("F4.6 junction gate: an exhausted approach cannot validate", () => {
  it("mixed sizes: the all-duplicate branch does not validate through the owned 0/180 reducer", () => {
    const design = exhaustedJunctionDesign({ end: "start" });
    const edge = validatedJunctionEdge(design, branchOf(design), "start");
    expect(edge.status).not.toBe("ok");
    expect(edge.status).toBe("no-approach");
  });
  it("same sizes: the exhausted tap is refused explicitly (end convention)", () => {
    const design = exhaustedJunctionDesign({ end: "end", sameSize: true });
    const edge = validatedJunctionEdge(design, branchOf(design), "end");
    expect(edge.status).not.toBe("ok");
    expect(edge.status).toBe("no-approach");
  });
  it("the refusal is named in connectionCompatibilityErrors", () => {
    const design = exhaustedJunctionDesign({ end: "start" });
    const errors = connectionCompatibilityErrors(design);
    expect(errors.some((e) => /no approach evidence/i.test(e))).toBe(true);
  });
});

describe("F4.6 authoring: an exhausted approach publishes no usable axis", () => {
  it("the exhausted branch emits no connection at the tap", () => {
    const design = exhaustedJunctionDesign({ end: "start" });
    const conns = modeledConnectionsAtPoint(design, 50, 0);
    expect(conns.find((c) => c.runId === "b" && c.end === "start")).toBeUndefined();
  });
  it("placeReducer on the exhausted tap persists no owned transition", () => {
    const design = exhaustedJunctionDesign({ end: "start" });
    const next = placeReducer(design, 50, 0, {
      id: "r2",
      inletSizeIn: 2,
      outletSizeIn: 1,
      forRun: { runId: "b", end: "start" },
    });
    const placed = next.symbols.find((s) => s.id === "r2");
    expect(placed).toBeTruthy();
    expect(placed.portOwners == null).toBe(true);
  });
});

// ------------------------------------------------------------------
// Positive controls — genuine approaches keep validating and
// authoring through the same code paths.
// ------------------------------------------------------------------

function genuineBranchDesign({ riser = false } = {}) {
  // 1-in branch on the 2-in host at (50,0), elev 150; reducer
  // authored with the correct axis (90 for the planar branch, 0 for
  // the genuine vertical riser per the F4.5 convention).
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
    id: "h",
    diameterIn: 2,
    elevationIn: 150,
  });
  const points = riser
    ? [
        { x: 50, y: 0 },
        { x: 50, y: 0 },
      ]
    : [
        { x: 50, y: 0 },
        { x: 50, y: 60 },
      ];
  const elevIn = riser ? [150, 210] : [150, 150];
  // NOTE: the riser variant is built as a literal run object —
  // addPipeRun rejects (then dedupes) duplicate plan points, and the
  // duplicate plan point with its own elevation IS the codebase's
  // riser representation.
  const run = { id: "b", points, diameterIn: 1, elevIn };
  design = { ...design, pipes: [...design.pipes, run] };
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "b"
        ? { ...p, elevIn, junctions: { start: { runId: "h" } } }
        : p,
    ),
  };
  design = placeReducer(design, 50, 0, {
    id: "r",
    inletSizeIn: 2,
    outletSizeIn: 1,
    rotationDeg: riser ? 0 : 90,
  });
  return design;
}

describe("F4.6 controls: genuine approaches are untouched", () => {
  it("genuine planar branch still validates", () => {
    const design = genuineBranchDesign();
    expect(validatedJunctionEdge(design, branchOf(design), "start").status).toBe("ok");
  });
  it("genuine vertical-riser branch still validates with the conventional axis", () => {
    const design = genuineBranchDesign({ riser: true });
    expect(validatedJunctionEdge(design, branchOf(design), "start").status).toBe("ok");
  });
  it("genuine riser branch still authors axis 0", () => {
    const design = genuineBranchDesign({ riser: true });
    const conns = modeledConnectionsAtPoint(design, 50, 0);
    const conn = conns.find((c) => c.runId === "b" && c.end === "start");
    expect(conn).toBeTruthy();
    expect(conn.axisDeg).toBeCloseTo(0, 6);
  });
  it("all-degenerate nozzle route stays refused (F4.3 regression guard)", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    const run = {
      id: "r",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      diameterIn: 4,
      elevIn: [126, 126],
      attachments: { end: { symbolId: "v", anchorId: "top-out" } },
    };
    design = { ...design, pipes: [...design.pipes, run] };
    const errors = attachmentInterfaceErrors(design, run, "end");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /no approach evidence/i.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });
});
