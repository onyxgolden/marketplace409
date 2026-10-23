// R2 probe (PR #668 fix round 2) — false equipment attachments
// suppress vessel penetration. ChatGPT's executed counterexample
// (fakeFaceInsideVessel): a vertical vessel at (0, 0) whose side-out
// face sits at (24, 0), elevation 74.4, size 8; an 8-in run from
// (200, 0) to the vessel CENTER (0, 0) carrying a side-out end
// reference at the right elevation yields compatibility [] and
// collision []. A nonexistent anchor id also yields compatibility [],
// and a horizontal run into the upward top flange at elevation 126 is
// accepted despite the wrong axis.
//
// These probes FAIL against the round-1 implementation and must PASS
// after the fix: every reference resolves or is reported stale; the
// run end must sit ON the named face (position, elevation, normal /
// axis); only that localized verified interface exempts penetration.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { connectionCompatibilityErrors } from "../pipeAttachments";
import { pipeCrossingErrors, verifiedAttachmentPoints } from "../pipeCrossings";

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

describe("R2 attachments verify against the named face, not the vessel box", () => {
  it("fakeFaceInsideVessel: end at the vessel center is not on the face", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 0, y: 0 }], {
      id: "r1",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "r1", "end", "side-out");
    expect(connectionCompatibilityErrors(design).length).toBeGreaterThan(0);
    expect(
      pipeCrossingErrors(design).some((e) => /passes through/.test(e)),
    ).toBe(true);
    expect(verifiedAttachmentPoints(design).get("v") ?? []).toEqual([]);
  });

  it("a nonexistent anchor id is a stale reference, not a silent pass", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
      id: "r1",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "r1", "end", "no-such-nozzle");
    expect(connectionCompatibilityErrors(design).some((e) => /stale|does not exist/i.test(e))).toBe(true);
  });

  it("a missing vessel instance is a stale reference", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
      id: "r1",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "r1"
          ? { ...p, attachments: { end: { symbolId: "ghost", anchorId: "side-out" } } }
          : p,
      ),
    };
    expect(connectionCompatibilityErrors(design).some((e) => /stale|does not exist/i.test(e))).toBe(true);
  });

  it("a horizontal run into the upward top flange has the wrong axis", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 0, y: 0 }], {
      id: "r1",
      diameterIn: 8,
      elevationIn: 126, // top-out face elevation: base 0 + height 120 + neck 6
    });
    design = attach(design, "r1", "end", "top-out");
    expect(connectionCompatibilityErrors(design).length).toBeGreaterThan(0);
  });

  it("positive: an end seated on the side face along its normal validates and exempts locally", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
      id: "r1",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "r1", "end", "side-out");
    expect(connectionCompatibilityErrors(design)).toEqual([]);
    expect(pipeCrossingErrors(design)).toEqual([]);
    // F2 (fix round 3): verified attachments are owned tuples keyed
    // by run/end/segment/anchor, not bare plan points.
    expect(verifiedAttachmentPoints(design).get("v")).toEqual([
      {
        runId: "r1",
        end: "end",
        segmentIndex: 0,
        symbolId: "v",
        anchorId: "side-out",
        x: 24,
        y: 0,
      },
    ]);
  });

  it("positive: a riser arriving at the top face validates", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 0, y: 0 }], {
      id: "r1",
      diameterIn: 8,
    });
    // The riser is a zero-plan-length vertex pair (the same form the
    // crossing-jog inserter authors) — patched in directly because
    // addPipeRun dedupes consecutive points.
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "r1"
          ? {
              ...p,
              points: [{ x: 200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
              elevIn: [30, 30, 126],
            }
          : p,
      ),
    };
    design = attach(design, "r1", "end", "top-out");
    expect(connectionCompatibilityErrors(design)).toEqual([]);
  });

  it("a side-face connection arriving across the normal is rejected", () => {
    let design = vesselDesign();
    // End sits ON the side-out face point (24, 0) but arrives along y
    // (perpendicular to the face normal (1, 0)).
    design = addPipeRun(design, [{ x: 24, y: 200 }, { x: 24, y: 0 }], {
      id: "r1",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "r1", "end", "side-out");
    expect(connectionCompatibilityErrors(design).some((e) => /axis|normal|approach/i.test(e))).toBe(true);
  });
});
