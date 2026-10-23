// F4.3 probe (PR #668 fix round 4.3) — a sub-tolerance terminal
// stub makes the approach checks in attachmentInterfaceErrors
// evidence-free. Found and executed by the local panel chair at
// head ec124986 (round-4.2 review):
//   Both approach checks read evidence from the LITERAL terminal
//   segment only. A terminal segment that is flat and <=
//   CONNECTION_FACE_TOLERANCE_IN in plan — including a zero-length
//   duplicate final vertex, the codebase's own riser
//   representation — satisfies neither the horizontal-approach
//   refusal (needs segPlanLen > TOL && flat) nor the F4.1
//   sloped-riser refusal (needs !flat), so NO approach check runs
//   at all; the side-face branch likewise runs the F2.1 signed
//   exterior check only when segPlanLen > TOL. The forbidden
//   approach hiding in the segment behind the stub is certified.
//
// These probes FAIL against the round-4.2 implementation and must
// PASS after the fix: approach evidence comes from the EFFECTIVE
// approach segment — walk inward past evidence-free terminal
// segments (flat within tolerance AND plan length at/below
// tolerance) and apply the existing checks (horizontal refusal,
// F4.1 verticality, F2.1 signed exterior, from-below) to the first
// segment with extent. Legitimate shapes — a horizontal leg
// ending in a true zero-plan riser, plan bends plus a riser, an
// exterior side approach (including one whose final vertex is
// duplicated) — keep verifying.

import { describe, expect, it, beforeEach } from "vitest";
import { createEmptyDesign, placeSymbol, resetDesignerIds } from "../designerDocument";
import { attachmentInterfaceErrors } from "../pipeAttachments";
import { pipeCrossingErrors, verifiedAttachments } from "../pipeCrossings";

beforeEach(() => {
  resetDesignerIds();
});

// ------------------------------------------------------------------
// Fixtures — vertical vessel at (0, 0). Top-out face at (0, 0),
// elevation 126, 8 in; side-out face at (24, 0), outward normal
// (+1, 0), elevation 74.4, 8 in (the F2.1/F4.1 fixture geometry).
// Runs are literal (addPipeRun collapses duplicate plan points —
// the duplicated vertex IS the shape under test).
// ------------------------------------------------------------------

function designWithRun(points, elevIn, end, anchorId) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
  const run = {
    id: "r",
    points,
    diameterIn: 8,
    elevIn,
    attachments: { [end]: { symbolId: "v", anchorId } },
  };
  return { ...design, pipes: [...design.pipes, run] };
}

const errorsFor = (design, end) =>
  attachmentInterfaceErrors(design, design.pipes.find((p) => p.id === "r"), end);

describe("F4.3 top nozzle: a degenerate terminal cannot hide a horizontal approach", () => {
  it("chair #1: 500-in horizontal run at face elevation behind a zero-length terminal (end)", () => {
    const design = designWithRun(
      [
        { x: -500, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [126, 126, 126],
      "end",
      "top-out",
    );
    expect(errorsFor(design, "end").length).toBeGreaterThan(0);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("chair #2: the same geometry under the start convention", () => {
    const design = designWithRun(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: -500, y: 0 },
      ],
      [126, 126, 126],
      "start",
      "top-out",
    );
    expect(errorsFor(design, "start").length).toBeGreaterThan(0);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("chair #3: 500-in horizontal run at face elevation behind a 0.3-in stub (end)", () => {
    const design = designWithRun(
      [
        { x: -500, y: 0 },
        { x: -0.3, y: 0 },
        { x: 0, y: 0 },
      ],
      [126, 126, 126],
      "end",
      "top-out",
    );
    expect(errorsFor(design, "end").length).toBeGreaterThan(0);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("a riser arriving from below behind a zero-length terminal is refused (walked from-below)", () => {
    const design = designWithRun(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [60, 126, 126],
      "end",
      "top-out",
    );
    const errors = errorsFor(design, "end");
    expect(errors.some((e) => /from below/i.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });
});

describe("F4.3 side face: a degenerate terminal cannot re-admit a through-vessel approach", () => {
  it("chair #4: through-vessel approach behind a zero-length terminal (end)", () => {
    const design = designWithRun(
      [
        { x: -200, y: 0 },
        { x: 24, y: 0 },
        { x: 24, y: 0 },
      ],
      [74.4, 74.4, 74.4],
      "end",
      "side-out",
    );
    expect(errorsFor(design, "end").length).toBeGreaterThan(0);
    expect(verifiedAttachments(design)).toEqual([]);
    // With no verified tuple, the through-vessel segment earns no
    // penetration exemption (the F2.1 harm, restored).
    expect(
      pipeCrossingErrors(design).some((e) => e.includes("r") && /passes through/.test(e)),
    ).toBe(true);
  });

  it("chair #5: through-vessel approach behind a zero-length terminal (start)", () => {
    const design = designWithRun(
      [
        { x: 24, y: 0 },
        { x: 24, y: 0 },
        { x: -200, y: 0 },
      ],
      [74.4, 74.4, 74.4],
      "start",
      "side-out",
    );
    expect(errorsFor(design, "start").length).toBeGreaterThan(0);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("chair #6: through-vessel approach behind a 0.3-in stub (end)", () => {
    const design = designWithRun(
      [
        { x: -200, y: 0 },
        { x: 23.7, y: 0 },
        { x: 24, y: 0 },
      ],
      [74.4, 74.4, 74.4],
      "end",
      "side-out",
    );
    expect(errorsFor(design, "end").length).toBeGreaterThan(0);
    expect(verifiedAttachments(design)).toEqual([]);
  });
});

describe("F4.3 legitimate shapes keep verifying", () => {
  it("horizontal leg + true zero-plan riser vertex at the top nozzle (both conventions)", () => {
    const endDesign = designWithRun(
      [
        { x: 200, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [186, 186, 126],
      "end",
      "top-out",
    );
    expect(errorsFor(endDesign, "end")).toEqual([]);
    expect(verifiedAttachments(endDesign)).toHaveLength(1);

    const startDesign = designWithRun(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      [126, 186, 186],
      "start",
      "top-out",
    );
    expect(errorsFor(startDesign, "start")).toEqual([]);
    expect(verifiedAttachments(startDesign)).toHaveLength(1);
  });

  it("plan bends at constant elevation ending in a true riser verify", () => {
    const design = designWithRun(
      [
        { x: 300, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [186, 186, 186, 126],
      "end",
      "top-out",
    );
    expect(errorsFor(design, "end")).toEqual([]);
    expect(verifiedAttachments(design)).toHaveLength(1);
  });

  it("a duplicated vertex in front of a true riser still verifies (both conventions)", () => {
    const endDesign = designWithRun(
      [
        { x: 200, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [186, 186, 126, 126],
      "end",
      "top-out",
    );
    expect(errorsFor(endDesign, "end")).toEqual([]);
    expect(verifiedAttachments(endDesign)).toHaveLength(1);

    const startDesign = designWithRun(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      [126, 126, 186, 186],
      "start",
      "top-out",
    );
    expect(errorsFor(startDesign, "start")).toEqual([]);
    expect(verifiedAttachments(startDesign)).toHaveLength(1);
  });

  it("side-face exterior approach with a genuine terminal segment verifies", () => {
    const design = designWithRun(
      [
        { x: 200, y: 0 },
        { x: 24, y: 0 },
      ],
      [74.4, 74.4],
      "end",
      "side-out",
    );
    expect(errorsFor(design, "end")).toEqual([]);
    expect(verifiedAttachments(design)).toHaveLength(1);
  });

  it("side-face exterior approach behind a duplicated final vertex verifies — now by being checked", () => {
    const endDesign = designWithRun(
      [
        { x: 200, y: 0 },
        { x: 24, y: 0 },
        { x: 24, y: 0 },
      ],
      [74.4, 74.4, 74.4],
      "end",
      "side-out",
    );
    expect(errorsFor(endDesign, "end")).toEqual([]);
    expect(verifiedAttachments(endDesign)).toHaveLength(1);

    const startDesign = designWithRun(
      [
        { x: 24, y: 0 },
        { x: 24, y: 0 },
        { x: 200, y: 0 },
      ],
      [74.4, 74.4, 74.4],
      "start",
      "side-out",
    );
    expect(errorsFor(startDesign, "start")).toEqual([]);
    expect(verifiedAttachments(startDesign)).toHaveLength(1);
  });
});
