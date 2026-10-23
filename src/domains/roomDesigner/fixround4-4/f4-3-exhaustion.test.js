// F4.3-exhaustion probe (PR #668 fix round 4.4) — the round-4.3
// effective-approach walk repairs approaches HIDDEN BEHIND
// degenerate terminal segments, but when the walk reaches the
// route boundary without finding any evidence-bearing segment it
// records nothing: the subsequent checks read sub-tolerance
// geometry and produce no error, so an all-degenerate or
// within-tolerance-only route earns the verified tuple with no
// approach evidence anywhere. ChatGPT's executed counterexample
// at head b8951b29 (round-4.3 verdict): two identical points at
// the top-out face, elevIn [126,126] (and [126,126.5]), verify
// under BOTH endpoint conventions.
//
// These probes FAIL against the round-4.3 implementation and must
// PASS after the fix: the walk tracks whether an evidence-bearing
// segment was found; when none exists, attachmentInterfaceErrors
// returns a named exhaustion error and the claim is excluded from
// verifiedAttachments. Legitimate duplicate-terminal geometry
// backed by a real approach (the round-4.3 positives) still
// verifies — this is NOT a rejection of duplicate vertices.

import { describe, expect, it, beforeEach } from "vitest";
import { createEmptyDesign, placeSymbol, resetDesignerIds } from "../designerDocument";
import { attachmentInterfaceErrors } from "../pipeAttachments";
import { verifiedAttachments } from "../pipeCrossings";

beforeEach(() => {
  resetDesignerIds();
});

// ------------------------------------------------------------------
// Fixtures — vertical vessel at (0, 0). Top-out face at (0, 0),
// elevation 126, 8 in; side-out face at (24, 0), elevation 74.4,
// 8 in (the F2.1/F4.1/F4.3 fixture geometry). Runs are literal.
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

const EXHAUSTION = /no approach evidence/i;

describe("F4.3 exhaustion: all-degenerate routes at the top face refuse", () => {
  it("ChatGPT counterexample: two identical points, elevIn [126,126] (end)", () => {
    const design = designWithRun([{ x: 0, y: 0 }, { x: 0, y: 0 }], [126, 126], "end", "top-out");
    const errors = errorsFor(design, "end");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("ChatGPT counterexample: two identical points, elevIn [126,126] (start)", () => {
    const design = designWithRun([{ x: 0, y: 0 }, { x: 0, y: 0 }], [126, 126], "start", "top-out");
    const errors = errorsFor(design, "start");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("ChatGPT counterexample: two identical points, elevIn [126,126.5] (end)", () => {
    const design = designWithRun(
      [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      [126, 126.5],
      "end",
      "top-out",
    );
    const errors = errorsFor(design, "end");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("ChatGPT counterexample: two identical points, elevIn [126,126.5] (start)", () => {
    const design = designWithRun(
      [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      [126.5, 126],
      "start",
      "top-out",
    );
    const errors = errorsFor(design, "start");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });
});

describe("F4.3 exhaustion: within-tolerance-only chains refuse", () => {
  it("a chain of sub-tolerance segments totaling 0.4 in of plan drift (end)", () => {
    const design = designWithRun(
      [{ x: -0.4, y: 0 }, { x: -0.2, y: 0 }, { x: 0, y: 0 }],
      [126, 126, 126],
      "end",
      "top-out",
    );
    const errors = errorsFor(design, "end");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("a chain of sub-tolerance segments totaling 0.4 in of plan drift (start)", () => {
    const design = designWithRun(
      [{ x: 0, y: 0 }, { x: -0.2, y: 0 }, { x: -0.4, y: 0 }],
      [126, 126, 126],
      "start",
      "top-out",
    );
    const errors = errorsFor(design, "start");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("a chain whose every segment is within tolerance in elevation too (end)", () => {
    const design = designWithRun(
      [{ x: -0.4, y: 0 }, { x: -0.2, y: 0 }, { x: 0, y: 0 }],
      [126.4, 126.2, 126],
      "end",
      "top-out",
    );
    const errors = errorsFor(design, "end");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("a longer within-tolerance chain (2 in over five segments) names the exhaustion (end)", () => {
    const design = designWithRun(
      [
        { x: -2, y: 0 },
        { x: -1.6, y: 0 },
        { x: -1.2, y: 0 },
        { x: -0.8, y: 0 },
        { x: -0.4, y: 0 },
        { x: 0, y: 0 },
      ],
      [126, 126, 126, 126, 126, 126],
      "end",
      "top-out",
    );
    const errors = errorsFor(design, "end");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });
});

describe("F4.3 exhaustion: the side face has the same hole", () => {
  it("all-degenerate route at the side-out face (end)", () => {
    const design = designWithRun(
      [{ x: 24, y: 0 }, { x: 24, y: 0 }],
      [74.4, 74.4],
      "end",
      "side-out",
    );
    const errors = errorsFor(design, "end");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("all-degenerate route at the side-out face (start)", () => {
    const design = designWithRun(
      [{ x: 24, y: 0 }, { x: 24, y: 0 }],
      [74.4, 74.4],
      "start",
      "side-out",
    );
    const errors = errorsFor(design, "start");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("within-tolerance-only chain at the side-out face (end)", () => {
    const design = designWithRun(
      [{ x: 24.4, y: 0 }, { x: 24.2, y: 0 }, { x: 24, y: 0 }],
      [74.4, 74.4, 74.4],
      "end",
      "side-out",
    );
    const errors = errorsFor(design, "end");
    expect(errors.some((e) => EXHAUSTION.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
  });
});

describe("F4.3 exhaustion: duplicate terminals backed by real approaches still verify", () => {
  it("horizontal leg + true zero-plan riser vertex at the top nozzle (end)", () => {
    const design = designWithRun(
      [{ x: 200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
      [186, 186, 126],
      "end",
      "top-out",
    );
    expect(errorsFor(design, "end")).toEqual([]);
    expect(verifiedAttachments(design)).toHaveLength(1);
  });

  it("side-face exterior approach behind a duplicated final vertex (end)", () => {
    const design = designWithRun(
      [{ x: 200, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 0 }],
      [74.4, 74.4, 74.4],
      "end",
      "side-out",
    );
    expect(errorsFor(design, "end")).toEqual([]);
    expect(verifiedAttachments(design)).toHaveLength(1);
  });
});
