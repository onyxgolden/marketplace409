// F2 probe (PR #668 fix round 3) — a verified nozzle point still
// exempts OTHER runs from vessel penetration. ChatGPT's finding at
// head c9e815a5: verifiedAttachmentPoints() collapses every verified
// attachment to Map<symbolId, [{x, y}]>, discarding the owning run,
// end, segment, and anchor. The vessel-penetration pass then skips
// ANY run segment with an endpoint near ANY point in that
// vessel-level list — one attached run creates a coordinate waiver
// for a different unattached run ending at the same nozzle point.
// The helper also verifies only resolved face, plan position, and
// elevation — not the normal/approach, nominal-size, and reducer
// checks connectionCompatibilityErrors() applies.
//
// These probes FAIL against the round-2 implementation and must PASS
// after the fix: verified tuples are retained keyed by run id +
// end/segment + symbol/anchor, derived through ONE shared
// full-interface predicate, and only the exact owner segment is
// exempt from penetration.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { connectionCompatibilityErrors } from "../pipeAttachments";
import {
  pipeCrossingErrors,
  verifiedAttachmentPoints,
  verifiedAttachments,
} from "../pipeCrossings";

beforeEach(() => {
  resetDesignerIds();
});

function vesselDesign() {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
  return design;
}

function attach(design, runId, end, anchorId) {
  return {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === runId
        ? { ...p, attachments: { ...(p.attachments || {}), [end]: { symbolId: "v", anchorId } } }
        : p,
    ),
  };
}

/** The verified owner: an 8-in run seated on the side-out face. */
function ownerDesign() {
  let design = vesselDesign();
  design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
    id: "rA",
    diameterIn: 8,
    elevationIn: 74.4,
  });
  design = attach(design, "rA", "end", "side-out");
  return design;
}

describe("F2 verified attachments are owned tuples from one full-interface predicate", () => {
  it("verified tuples retain run, end, segment, symbol, and anchor", () => {
    const design = ownerDesign();
    const tuples = verifiedAttachments(design);
    expect(tuples).toHaveLength(1);
    expect(tuples[0]).toMatchObject({
      runId: "rA",
      end: "end",
      segmentIndex: 0,
      symbolId: "v",
      anchorId: "side-out",
      x: 24,
      y: 0,
    });
    // The per-vessel map carries the same owned tuples, not bare points.
    const forVessel = verifiedAttachmentPoints(design).get("v");
    expect(forVessel).toHaveLength(1);
    expect(forVessel[0]).toMatchObject({ runId: "rA", end: "end", anchorId: "side-out" });
  });

  it("two-run negative: an unattached run sharing the owner's endpoint gets no waiver", () => {
    let design = ownerDesign();
    // A different run ends at the SAME nozzle point but owns no
    // attachment — and its only segment runs straight through the
    // vessel to the far side.
    design = addPipeRun(design, [{ x: 24, y: 0 }, { x: -200, y: 0 }], {
      id: "rB",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    expect(connectionCompatibilityErrors(design)).toEqual([]);
    const errors = pipeCrossingErrors(design);
    expect(errors.some((e) => e.includes("rB") && /passes through/.test(e))).toBe(true);
    // The owner's own segment stays exempt.
    expect(errors.some((e) => e.includes("rA") && /passes through/.test(e))).toBe(false);
  });

  it("the owner's exemption is segment-exact: its other segments are not waived", () => {
    let design = vesselDesign();
    // The owner attaches at its START on the side-out face; a later
    // segment of the same run dives diagonally through the footprint
    // to the vessel center. Only segment 0 (the attached approach)
    // may be exempt — the diving segment must still be flagged.
    design = addPipeRun(
      design,
      [{ x: 24, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 0 }],
      { id: "rA", diameterIn: 8, elevationIn: 74.4 },
    );
    design = attach(design, "rA", "start", "side-out");
    expect(connectionCompatibilityErrors(design)).toEqual([]);
    const errors = pipeCrossingErrors(design);
    expect(errors.some((e) => e.includes("rA") && /passes through/.test(e))).toBe(true);
  });

  it("full-interface predicate: a size-mismatched attachment is not verified", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
      id: "rC",
      diameterIn: 6, // face is 8 in, no reducer
      elevationIn: 74.4,
    });
    design = attach(design, "rC", "end", "side-out");
    expect(connectionCompatibilityErrors(design).some((e) => /reducer/i.test(e))).toBe(true);
    expect(verifiedAttachments(design)).toEqual([]);
    expect(verifiedAttachmentPoints(design).get("v") ?? []).toEqual([]);
  });

  it("full-interface predicate: an off-normal approach is not verified", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 24, y: 200 }, { x: 24, y: 0 }], {
      id: "rD",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "rD", "end", "side-out");
    expect(connectionCompatibilityErrors(design).some((e) => /normal|approach|axis/i.test(e))).toBe(
      true,
    );
    expect(verifiedAttachments(design)).toEqual([]);
  });
});
