// F2.1 probe (PR #668 fix round 4) — an inside-to-outside approach
// still earns an owner-specific vessel-penetration exemption.
// ChatGPT's round-3 re-review at head 7a243870: the shared predicate
// attachmentInterfaceErrors proves axis alignment with Math.abs(dot)
// against the nozzle's outward normal. That admits a run arriving
// THROUGH the vessel interior; the owner-exact exemption from fix
// round 3 then skips that run's segment entirely.
//
// These probes FAIL against the round-3 implementation and must PASS
// after the fix: the approach check is signed (exterior side only)
// for both endpoint conventions and for rotated vessels, top
// (vertical) faces are met from above, valid exterior approaches keep
// verifying, and the original owner/stranger negatives still hold.

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
import { pipeCrossingErrors, verifiedAttachments } from "../pipeCrossings";

beforeEach(() => {
  resetDesignerIds();
});

function vesselDesign(extra = {}) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, {
    id: "v",
    ...extra,
  });
  return design;
}

function attach(design, runId, end, anchorId, symbolId = "v") {
  return {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === runId
        ? { ...p, attachments: { ...(p.attachments || {}), [end]: { symbolId, anchorId } } }
        : p,
    ),
  };
}

describe("F2.1 the approach must arrive from the exterior side", () => {
  it("ChatGPT's probe: a run through the vessel to the side-out face verifies nothing", () => {
    let design = vesselDesign();
    // Side-out face at (24, 0), outward normal (+1, 0), 8-in, elev 74.4.
    // The run arrives from (-200, 0) — through the vessel interior.
    design = addPipeRun(design, [{ x: -200, y: 0 }, { x: 24, y: 0 }], {
      id: "thru",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "thru", "end", "side-out");
    const run = design.pipes.find((p) => p.id === "thru");
    expect(attachmentInterfaceErrors(design, run, "end").length).toBeGreaterThan(0);
    expect(connectionCompatibilityErrors(design).length).toBeGreaterThan(0);
    // No verified tuple -> no penetration exemption for its segment.
    expect(verifiedAttachments(design)).toEqual([]);
    expect(
      pipeCrossingErrors(design).some((e) => e.includes("thru") && /passes through/.test(e)),
    ).toBe(true);
  });

  it("start convention: leaving the face into the vessel is not an approach", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 24, y: 0 }, { x: -200, y: 0 }], {
      id: "thru",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "thru", "start", "side-out");
    const run = design.pipes.find((p) => p.id === "thru");
    expect(attachmentInterfaceErrors(design, run, "start").length).toBeGreaterThan(0);
    expect(verifiedAttachments(design)).toEqual([]);
  });

  it("valid exterior approaches still verify, both conventions", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
      id: "in-end",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "in-end", "end", "side-out");
    design = addPipeRun(design, [{ x: 24, y: 0 }, { x: 200, y: 0 }], {
      id: "in-start",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "in-start", "start", "side-out");
    expect(connectionCompatibilityErrors(design)).toEqual([]);
    expect(verifiedAttachments(design)).toHaveLength(2);
    expect(pipeCrossingErrors(design).some((e) => /passes through/.test(e))).toBe(false);
  });

  it("rotated vessel: the signed check follows the face's own normal", () => {
    // Rotated 180 deg: the side-out face sits at (-24, 0) with
    // outward normal (-1, 0).
    let design = vesselDesign({ rotationDeg: 180 });
    design = addPipeRun(design, [{ x: -200, y: 0 }, { x: -24, y: 0 }], {
      id: "ext",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    design = attach(design, "ext", "end", "side-out");
    expect(connectionCompatibilityErrors(design)).toEqual([]);
    expect(verifiedAttachments(design)).toHaveLength(1);

    let bad = vesselDesign({ rotationDeg: 180 });
    bad = addPipeRun(bad, [{ x: 200, y: 0 }, { x: -24, y: 0 }], {
      id: "thru",
      diameterIn: 8,
      elevationIn: 74.4,
    });
    bad = attach(bad, "thru", "end", "side-out");
    const run = bad.pipes.find((p) => p.id === "thru");
    expect(attachmentInterfaceErrors(bad, run, "end").length).toBeGreaterThan(0);
    expect(verifiedAttachments(bad)).toEqual([]);
  });

  it("a top nozzle is met from above: a riser arriving from below is refused", () => {
    // Top-out face at (0, 0), elevation 0 + 120 + 6 = 126.
    const riser = (elevIn) => ({
      id: "riser",
      points: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      diameterIn: 8,
      elevIn,
      attachments: { end: { symbolId: "v", anchorId: "top-out" } },
    });
    let below = vesselDesign();
    below = { ...below, pipes: [...below.pipes, riser([66, 126])] };
    const belowRun = below.pipes.find((p) => p.id === "riser");
    expect(attachmentInterfaceErrors(below, belowRun, "end").length).toBeGreaterThan(0);
    expect(verifiedAttachments(below)).toEqual([]);

    let above = vesselDesign();
    above = { ...above, pipes: [...above.pipes, riser([186, 126])] };
    const aboveRun = above.pipes.find((p) => p.id === "riser");
    expect(attachmentInterfaceErrors(above, aboveRun, "end")).toEqual([]);
    expect(verifiedAttachments(above)).toHaveLength(1);
  });
});
