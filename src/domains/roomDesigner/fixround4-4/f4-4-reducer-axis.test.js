// F4.4 probe (PR #668 fix round 4.4) — reducer-axis evidence is
// fabricated by a degenerate terminal segment. Every boundReducerAt
// call site computed the transition axis as atan2(neighbor - point)
// over the LITERAL terminal segment; with a duplicate terminal
// vertex the delta is (0,0) and atan2(0,0) = 0, so the query axis is
// fabricated as 0 deg whatever the run's physical approach, and
// boundReducerAt matches port directions within 20 deg. Executed by
// the local panel chair at head b8951b29 (round-4.3 panel review):
//
//   1. Junction gate: a 1-in branch truly approaching a 2-in host
//      at 90 deg with points [(50,0),(50,0),(50,60)] validates "ok"
//      through a reducer facing 0/180; without the duplicate it is
//      refused, and with the duplicate plus the CORRECTLY faced
//      90/270 reducer it is also refused — the fabrication cuts
//      both ways.
//   2. Nozzle gate: a 4-in run approaching the 8-in side-out face
//      at a true 15 deg behind a duplicate terminal binds a reducer
//      facing 341/161 (34 deg off the true 15/195 axis) because
//      fabricated 0 deg sits within 20 deg of 341.
//   3. Authoring: modeledConnectionsAtPoint reports axisDeg 0 for
//      the duplicated branch (90 for the genuine one), so
//      placeReducer persists the fabricated axis in rotationDeg.
//   4. Top face: a stub terminal offset 0.4 in in +y fabricates
//      90 deg and refuses the correctly authored reducer on a
//      genuine riser.
//
// These probes FAIL against the round-4.3 implementation and must
// PASS after the fix: the reducer query axis comes from the
// EFFECTIVE approach segment (the direction of the first
// evidence-bearing segment, per the F4.3 walk) at the junction and
// nozzle gates, and modeledConnectionsAtPoint reports the same
// effective axis. For vertical arrivals the plan axis is degenerate
// by geometry; the effective-segment read defines it
// deterministically (a genuine riser reads 0 under both the old
// literal read and the new effective read).

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { attachmentInterfaceErrors, connectionCompatibilityErrors } from "../pipeAttachments";
import { validatedJunctionEdge, verifiedAttachments } from "../pipeCrossings";
import { modeledConnectionsAtPoint, placeReducer } from "../pipeReducerModel";

beforeEach(() => {
  resetDesignerIds();
});

// ------------------------------------------------------------------
// Junction fixtures — host 2-in at elev 150 along y=0; branch 1-in
// junctioned at (50, 0) from its start end, truly approaching at
// 90 deg (the branch runs in +y from the tap). The reducer is
// authored on the GENUINE branch geometry (owners stamped from the
// real connection); the duplicate terminal vertex is inserted
// afterwards, mirroring a persisted literal shape.
// ------------------------------------------------------------------

function junctionDesign(rotationDeg, { duplicate = false } = {}) {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
    id: "h",
    diameterIn: 2,
    elevationIn: 150,
  });
  design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
    id: "b",
    diameterIn: 1,
    elevationIn: 150,
  });
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "b" ? { ...p, junctions: { start: { runId: "h" } } } : p,
    ),
  };
  design = placeReducer(design, 50, 0, {
    id: "r",
    inletSizeIn: 2,
    outletSizeIn: 1,
    rotationDeg,
  });
  if (duplicate) {
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "b"
          ? { ...p, points: [{ x: 50, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 60 }] }
          : p,
      ),
    };
  }
  return design;
}

const branchEdge = (design) =>
  validatedJunctionEdge(design, design.pipes.find((p) => p.id === "b"), "start");

describe("F4.4 junction gate: the query axis is the effective approach axis", () => {
  it("control: genuine branch + wrong-facing (0 deg) reducer is refused", () => {
    expect(branchEdge(junctionDesign(0)).status).toBe("reducer");
  });

  it("a duplicate terminal cannot make the wrong-facing reducer bind", () => {
    expect(branchEdge(junctionDesign(0, { duplicate: true })).status).toBe("reducer");
  });

  it("control: genuine branch + correctly faced (90 deg) reducer validates", () => {
    expect(branchEdge(junctionDesign(90)).status).toBe("ok");
  });

  it("a duplicate terminal cannot refuse the correctly faced reducer", () => {
    expect(branchEdge(junctionDesign(90, { duplicate: true })).status).toBe("ok");
  });
});

describe("F4.4 authoring: modeledConnectionsAtPoint reports the effective axis", () => {
  it("genuine branch reports 90 deg", () => {
    const conns = modeledConnectionsAtPoint(junctionDesign(90), 50, 0);
    const conn = conns.find((c) => c.runId === "b" && c.end === "start");
    expect(conn).toBeTruthy();
    expect(conn.axisDeg).toBeCloseTo(90, 6);
  });

  it("duplicated branch still reports the true 90 deg, not fabricated 0", () => {
    const conns = modeledConnectionsAtPoint(junctionDesign(90, { duplicate: true }), 50, 0);
    const conn = conns.find((c) => c.runId === "b" && c.end === "start");
    expect(conn).toBeTruthy();
    expect(conn.axisDeg).toBeCloseTo(90, 6);
  });
});

// ------------------------------------------------------------------
// Nozzle fixtures — vertical vessel at (0,0); side-out face at
// (24, 0), normal +x, elevation 74.4, 8 in. A 4-in run approaches
// at a true 15 deg (direction from the face into the run); the
// reducer faces 341/161 — 34 deg off the true 15/195 axis.
// ------------------------------------------------------------------

const NOZZLE_FAR = { x: 24 + 100 * Math.cos((15 * Math.PI) / 180), y: 100 * Math.sin((15 * Math.PI) / 180) };

function nozzleDesign({ duplicate = false } = {}) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
  const points = duplicate
    ? [NOZZLE_FAR, { x: 24, y: 0 }, { x: 24, y: 0 }]
    : [NOZZLE_FAR, { x: 24, y: 0 }];
  const run = {
    id: "r",
    points,
    diameterIn: 4,
    elevIn: points.map(() => 74.4),
    attachments: { end: { symbolId: "v", anchorId: "side-out" } },
  };
  design = { ...design, pipes: [...design.pipes, run] };
  return design;
}

function nozzleDesignWithReducer() {
  // Author the 341/161 reducer against the GENUINE geometry, then
  // insert the duplicate terminal vertex.
  let design = nozzleDesign();
  design = placeReducer(design, 24, 0, {
    id: "r",
    inletSizeIn: 8,
    outletSizeIn: 4,
    rotationDeg: 341,
  });
  return {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "r"
        ? {
            ...p,
            points: [NOZZLE_FAR, { x: 24, y: 0 }, { x: 24, y: 0 }],
            elevIn: [74.4, 74.4, 74.4],
          }
        : p,
    ),
  };
}

const reducerErrorsFor = (design) =>
  attachmentInterfaceErrors(design, design.pipes.find((p) => p.id === "r"), "end").filter((e) =>
    /reducer/i.test(e),
  );

describe("F4.4 nozzle gate: a duplicate terminal cannot fabricate the axis", () => {
  it("control: genuine 15 deg approach refuses the 341/161 reducer", () => {
    let design = nozzleDesign();
    design = placeReducer(design, 24, 0, {
      id: "r",
      inletSizeIn: 8,
      outletSizeIn: 4,
      rotationDeg: 341,
    });
    expect(reducerErrorsFor(design).length).toBeGreaterThan(0);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("duplicated terminal: the 341/161 reducer is still refused (no false bind)", () => {
    const design = nozzleDesignWithReducer();
    expect(reducerErrorsFor(design).length).toBeGreaterThan(0);
    expect(verifiedAttachments(design)).toEqual([]);
    expect(
      connectionCompatibilityErrors(design).some((e) => e.includes("run r") && /reducer/i.test(e)),
    ).toBe(true);
  });
});

// ------------------------------------------------------------------
// Top-face fixtures — vertical vessel top-out at (0,0), elevation
// 126, 8 in. A 4-in run arrives on a genuine riser (leg at 186,
// riser vertex at the face point); the correctly authored reducer
// faces 0/180 — the axis both the literal read (atan2(0,0)) and
// the effective read assign a vertical arrival. The stub variant
// moves the attached end 0.4 in in +y behind a sub-tolerance
// terminal segment.
// ------------------------------------------------------------------

function topFaceDesign({ stub = false } = {}) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
  const run = {
    id: "r",
    points: [{ x: 200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    diameterIn: 4,
    elevIn: [186, 186, 126],
    attachments: { end: { symbolId: "v", anchorId: "top-out" } },
  };
  design = { ...design, pipes: [...design.pipes, run] };
  design = placeReducer(design, 0, 0, {
    id: "r",
    inletSizeIn: 8,
    outletSizeIn: 4,
    rotationDeg: 0,
  });
  if (stub) {
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "r"
          ? {
              ...p,
              points: [{ x: 200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0.4 }],
              elevIn: [186, 186, 126, 126],
            }
          : p,
      ),
    };
  }
  return design;
}

describe("F4.4 top face: a stub terminal cannot refuse the correctly authored reducer", () => {
  it("control: genuine riser + correctly authored reducer verifies clean", () => {
    const design = topFaceDesign();
    expect(
      attachmentInterfaceErrors(design, design.pipes.find((p) => p.id === "r"), "end"),
    ).toEqual([]);
    expect(verifiedAttachments(design)).toHaveLength(1);
  });

  it("stub terminal offset 0.4 in in +y: the correct reducer still binds", () => {
    const design = topFaceDesign({ stub: true });
    expect(
      attachmentInterfaceErrors(design, design.pipes.find((p) => p.id === "r"), "end"),
    ).toEqual([]);
    expect(verifiedAttachments(design)).toHaveLength(1);
  });
});
