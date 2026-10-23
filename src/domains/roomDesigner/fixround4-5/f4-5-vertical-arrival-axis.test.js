// F4.5 probe (PR #668 fix round 4.5) — tolerance-valid near-vertical
// arrivals fabricate the reducer plan axis from sub-tolerance plan
// noise. ChatGPT's round-4.4 verdict (executed at 79fcd98e):
// effectiveApproachSegment reported axisDeg = atan2(planDy, planDx)
// even when the plan projection was within CONNECTION_FACE_TOLERANCE_IN
// while the elevation change was material — so a genuine riser with
// 0.4-in plan drift reported axis 90 deg and boundReducerAt refused
// the correctly owned 0-deg reducer, and authoring published 90 for
// the noisy run vs 0 for the exactly vertical one. The same defect
// lived in firewater.js's spray-inlet reducer query (a literal
// terminal-segment read at the old lines 542-568).
//
// These probes FAIL against the round-4.4 implementation and must
// PASS after the fix: when the effective approach changes elevation
// beyond tolerance with plan projection at/below tolerance, the
// reported axis is the conventional vertical-arrival axis (0) at the
// nozzle gate, the junction gate, authoring, and the spray-inlet
// reducer path. Genuine planar approaches (plan beyond tolerance)
// keep their true axes.
//
// Direction note: the helper's axis points from the attached end
// INTO the run (far vertex minus near vertex), so the fabricated
// axis is the INVERSE of the drift direction — north/south/east
// drifts fabricate -90/+90/180 deg (the harm cases), while a west
// drift fabricates 0 and binds under both implementations (control),
// as does the exactly vertical run.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { attachmentInterfaceErrors } from "../pipeAttachments";
import {
  effectiveApproachSegment,
  verifiedAttachments,
} from "../pipeCrossings";
import { modeledConnectionsAtPoint, placeReducer } from "../pipeReducerModel";
import { verifiedSpraySupply } from "../firewater";

beforeEach(() => {
  resetDesignerIds();
});

// ------------------------------------------------------------------
// Top-nozzle fixtures — vertical vessel at (0,0); top-out face at
// (0,0), elevation 126, 8 in. A 4-in run arrives on a near-vertical
// terminal: far vertex (0,0) at elevation 186, attached end drifted
// by `drift` ({x,y}, |drift| <= 0.5 in) at elevation 126. The
// correctly owned reducer is authored with the vertical-arrival
// convention rotationDeg: 0.
// ------------------------------------------------------------------

function topNozzleReducerDesign({ drift, end }) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
  const points =
    end === "end"
      ? [
          { x: 0, y: 0 },
          { x: drift.x, y: drift.y },
        ]
      : [
          { x: drift.x, y: drift.y },
          { x: 0, y: 0 },
        ];
  const elevIn = end === "end" ? [186, 126] : [126, 186];
  const run = {
    id: "r",
    points,
    diameterIn: 4,
    elevIn,
    attachments: { [end]: { symbolId: "v", anchorId: "top-out" } },
  };
  design = { ...design, pipes: [...design.pipes, run] };
  design = placeReducer(design, drift.x, drift.y, {
    id: "red",
    inletSizeIn: 8,
    outletSizeIn: 4,
    rotationDeg: 0,
  });
  return design;
}

const topReducerErrors = (design, end) =>
  attachmentInterfaceErrors(design, design.pipes.find((p) => p.id === "r"), end).filter((e) =>
    /reducer/i.test(e),
  );

const DRIFTS = {
  north: { x: 0, y: 0.4 },
  south: { x: 0, y: -0.4 },
  east: { x: 0.4, y: 0 },
};
const WEST_DRIFT = { x: -0.4, y: 0 };

describe("F4.5 top nozzle: sub-tolerance drift cannot refuse the 0-deg reducer", () => {
  for (const end of ["end", "start"]) {
    for (const [name, drift] of Object.entries(DRIFTS)) {
      it(`${name} drift (${end} convention): the correctly owned 0-deg reducer binds`, () => {
        const design = topNozzleReducerDesign({ drift, end });
        expect(topReducerErrors(design, end)).toEqual([]);
        expect(verifiedAttachments(design)).toHaveLength(1);
      });
    }
    it(`west drift (${end} convention): binds under both implementations (control)`, () => {
      const design = topNozzleReducerDesign({ drift: WEST_DRIFT, end });
      expect(topReducerErrors(design, end)).toEqual([]);
      expect(verifiedAttachments(design)).toHaveLength(1);
    });
    it(`exact vertical (${end} convention): binds under both implementations (control)`, () => {
      const design = topNozzleReducerDesign({ drift: { x: 0, y: 0 }, end });
      expect(topReducerErrors(design, end)).toEqual([]);
      expect(verifiedAttachments(design)).toHaveLength(1);
    });
    it(`boundary 0.5-in drift (${end} convention): conventional axis`, () => {
      const design = topNozzleReducerDesign({ drift: { x: 0, y: 0.5 }, end });
      expect(topReducerErrors(design, end)).toEqual([]);
      expect(verifiedAttachments(design)).toHaveLength(1);
    });
  }
});

describe("F4.5 authoring: a near-vertical arrival publishes the conventional axis", () => {
  it("noisy riser publishes 0, not the noise direction", () => {
    const design = topNozzleReducerDesign({ drift: { x: 0, y: 0.4 }, end: "end" });
    const conns = modeledConnectionsAtPoint(design, 0, 0.4);
    const conn = conns.find((c) => c.runId === "r" && c.end === "end");
    expect(conn).toBeTruthy();
    expect(conn.axisDeg).toBeCloseTo(0, 6);
  });
  it("exact vertical still publishes 0 (control)", () => {
    const design = topNozzleReducerDesign({ drift: { x: 0, y: 0 }, end: "end" });
    const conns = modeledConnectionsAtPoint(design, 0, 0);
    const conn = conns.find((c) => c.runId === "r" && c.end === "end");
    expect(conn).toBeTruthy();
    expect(conn.axisDeg).toBeCloseTo(0, 6);
  });
});

describe("F4.5 helper: the vertical-arrival rule lives in effectiveApproachSegment", () => {
  const run = (points, elevIn) => ({ id: "r", points, elevIn });
  const design = { pipes: [] };
  it("plan 0.5 / elev 60 reports the conventional 0", () => {
    const a = effectiveApproachSegment(
      design,
      run(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0.5 },
        ],
        [186, 126],
      ),
      "end",
    );
    expect(a.foundEvidence).toBe(true);
    expect(a.axisDeg).toBeCloseTo(0, 6);
  });
  it("plan 0.6 / elev 60 keeps the true plan direction", () => {
    const a = effectiveApproachSegment(
      design,
      run(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0.6 },
        ],
        [186, 126],
      ),
      "end",
    );
    expect(a.foundEvidence).toBe(true);
    // Into-the-run direction for the end convention: (0,0.6)-(0,0)
    // read from the end is (0,-0.6) -> -90 deg.
    expect(a.axisDeg).toBeCloseTo(-90, 6);
  });
  it("flat horizontal leg keeps its true plan direction (control)", () => {
    const a = effectiveApproachSegment(
      design,
      run(
        [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
        [150, 150],
      ),
      "end",
    );
    expect(a.foundEvidence).toBe(true);
    // Into-the-run direction for the end convention: (0,0)-(200,0)
    // read from the end is (-200,0) -> 180 deg.
    expect(a.axisDeg).toBeCloseTo(180, 6);
  });
});

// ------------------------------------------------------------------
// Genuine planar approach — the axis must NOT change. Side-out face
// at (24,0), normal +x, elevation 74.4, 8 in; 4-in run approaches at
// a true 15 deg (within the 20-deg exterior-side tolerance); reducer
// authored at 15.
// ------------------------------------------------------------------

function planarNozzleDesign() {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
  const far = { x: 24 + 100 * Math.cos(Math.PI / 12), y: 100 * Math.sin(Math.PI / 12) };
  const run = {
    id: "r",
    points: [far, { x: 24, y: 0 }],
    diameterIn: 4,
    elevIn: [74.4, 74.4],
    attachments: { end: { symbolId: "v", anchorId: "side-out" } },
  };
  design = { ...design, pipes: [...design.pipes, run] };
  design = placeReducer(design, 24, 0, {
    id: "red",
    inletSizeIn: 8,
    outletSizeIn: 4,
    rotationDeg: 15,
  });
  return design;
}

describe("F4.5 genuine planar approach: the true axis is unchanged", () => {
  it("a true 15-deg approach still binds its 15-deg reducer", () => {
    const design = planarNozzleDesign();
    expect(topReducerErrors(design, "end")).toEqual([]);
    expect(verifiedAttachments(design)).toHaveLength(1);
  });
  it("authoring still reports 15 deg", () => {
    const design = planarNozzleDesign();
    const conns = modeledConnectionsAtPoint(design, 24, 0);
    const conn = conns.find((c) => c.runId === "r" && c.end === "end");
    expect(conn).toBeTruthy();
    expect(conn.axisDeg).toBeCloseTo(15, 6);
  });
});

// ------------------------------------------------------------------
// Spray inlet — branch 6-in below-fed riser into the assembly inlet
// at (0,1000), elevation 0; the inlet is authored 4-in so the reducer
// block engages. The correctly owned reducer is authored with the
// outlet facing the inlet (rotationDeg 180 — the branch is the larger
// side, so the domain orients the outlet away from the run); the
// plan-axis convention under test is still the vertical-arrival 0.
// ------------------------------------------------------------------

const BOUNDARY_AROUND_VESSEL = [
  { x: 900, y: 900 },
  { x: 1100, y: 900 },
  { x: 1100, y: 1100 },
  { x: 900, y: 1100 },
];

function sprayReducerDesign({ drift, inletEnd, badRise = false }) {
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
          ? { ...sy, protects: "v", aimAt: { x: 1000, y: 1000 }, inletSizeIn: 4 }
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
  const junctionEnd = inletEnd === "end" ? "start" : "end";
  const branchPoints =
    inletEnd === "end"
      ? [
          { x: 0, y: 0 },
          { x: drift.x, y: 1000 + drift.y },
          { x: 0, y: 1000 },
        ]
      : [
          { x: 0, y: 1000 },
          { x: drift.x, y: 1000 + drift.y },
          { x: 0, y: 0 },
        ];
  const branchElevIn =
    inletEnd === "end" ? [-36, -36, 0] : badRise ? [0, 36, -36] : [0, -36, -36];
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
  // Author the correctly owned reducer at the inlet. The branch
  // (6 in) is the LARGER side here, so the outlet (4 in) faces the
  // inlet: the domain's own convention (placeReducer with no
  // rotationDeg) orients it at axis+180 = 180 for a 0-deg axis.
  // Authored explicitly so the pre-fix run cannot inherit the
  // fabricated axis through the authoring read.
  design = placeReducer(design, 0, 1000, {
    id: "inlet-red",
    inletSizeIn: 6,
    outletSizeIn: 4,
    rotationDeg: 180,
  });
  return design;
}

const sprayOf = (design) => design.symbols.find((s) => s.id === "s");

describe("F4.5 spray inlet: drift cannot refuse the correctly owned reducer", () => {
  for (const inletEnd of ["end", "start"]) {
    for (const [name, drift] of Object.entries(DRIFTS)) {
      it(`${name} drift (${inletEnd} convention): the 0-deg inlet reducer binds`, () => {
        const design = sprayReducerDesign({ drift, inletEnd });
        const supply = verifiedSpraySupply(design, sprayOf(design));
        expect(supply.problems).toEqual([]);
        expect(supply.ok).toBe(true);
      });
    }
    it(`exact vertical (${inletEnd} convention): binds under both implementations (control)`, () => {
      const design = sprayReducerDesign({ drift: { x: 0, y: 0 }, inletEnd });
      const supply = verifiedSpraySupply(design, sprayOf(design));
      expect(supply.problems).toEqual([]);
      expect(supply.ok).toBe(true);
    });
  }
  it("a genuinely descending branch is still refused (control)", () => {
    const design = sprayReducerDesign({ drift: { x: 0, y: 0 }, inletEnd: "start", badRise: true });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.ok).toBe(false);
    expect(supply.problems.some((p) => /rise|below/i.test(p))).toBe(true);
  });
});
