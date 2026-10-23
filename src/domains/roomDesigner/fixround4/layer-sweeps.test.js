// Layer sweeps (PR #668 fix round 4, Jason's "fix that layer" word) —
// F1.1/F2.1/F3.1 are instances of defect families. These probes
// freeze the other CONFIRMED instances of the identity-key family
// found by sweeping src/domains/roomDesigner + src/components/designer
// for identity/equality/dedup computed by delimiter-joined strings:
//
//   K4 crossServiceErrors pair dedup: [a, b].sort().join("|") —
//      pairs ("a|b","c") and ("a","b|c") both key "a|b|c", so the
//      second cross-service misconnection error is suppressed.
//   K5 pipeCrossingErrors crossing dedup:
//      `${aRunId}|${bRunId}|${x}|${y}` — same collision class
//      suppresses a distinct crossing error.
//   K6 pipeCrossingErrors overlap dedup: `${ra.id}|${rb.id}` — same.
//   K7 reconcilePipeAttachments face cache: `${inst.id}::${anchorId}`
//      — instance "a::b"/anchor "c" and instance "a"/anchor "b::c"
//      share the key "a::b::c", so the second run end is stamped
//      with the FIRST face's elevation.
//
// Each probe FAILS against the round-3 implementation and must PASS
// after the fix (canonical JSON tuple keys — no delimiter joins).

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { reconcilePipeAttachments } from "../pipeAttachments";
import { crossServiceErrors, pipeCrossingErrors } from "../pipeCrossings";

beforeEach(() => {
  resetDesignerIds();
});

function run(design, id, points, opts = {}) {
  return addPipeRun(design, points, { id, ...opts });
}

describe("K4 cross-service pair dedup cannot suppress a second misconnection", () => {
  it("both colliding pairs report", () => {
    let design = createEmptyDesign();
    design = run(design, "c", [{ x: 0, y: 0 }, { x: 100, y: 0 }], { utility: "plant-air" });
    design = run(design, "b|c", [{ x: 0, y: 50 }, { x: 100, y: 50 }], { utility: "plant-air" });
    design = run(design, "a|b", [{ x: 0, y: 0 }, { x: 0, y: 40 }], { utility: "plant-water" });
    design = run(design, "a", [{ x: 0, y: 50 }, { x: 0, y: 90 }], { utility: "plant-water" });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "a|b"
          ? { ...p, junctions: { start: { runId: "c" } } }
          : p.id === "a"
            ? { ...p, junctions: { start: { runId: "b|c" } } }
            : p,
      ),
    };
    const errors = crossServiceErrors(design);
    expect(errors.some((e) => e.includes("a|b") && e.includes("run c"))).toBe(true);
    expect(errors.some((e) => e.includes("run a (") && e.includes("b|c"))).toBe(true);
  });
});

describe("K5/K6 crossing and overlap dedup cannot suppress distinct pairs", () => {
  it("both colliding crossing pairs report", () => {
    let design = createEmptyDesign();
    // Two horizontal runs on y = 3 and two vertical runs on x = 2,
    // all at the default elevation: four unresolved crossings at
    // (2, 3). Pairs ("x|1","y") and ("x","1|y") share the legacy
    // dedup key "x|1|y|2|3".
    design = run(design, "x|1", [{ x: -100, y: 3 }, { x: 100, y: 3 }]);
    design = run(design, "x", [{ x: -100, y: 3 }, { x: 100, y: 3 }]);
    design = run(design, "y", [{ x: 2, y: -100 }, { x: 2, y: 100 }]);
    design = run(design, "1|y", [{ x: 2, y: -100 }, { x: 2, y: 100 }]);
    const errors = pipeCrossingErrors(design).filter((e) => /crosses pipe run/.test(e));
    expect(errors.some((e) => e.includes("x|1") && e.includes("run y "))).toBe(true);
    expect(errors.some((e) => e.includes("run x crosses") && e.includes("1|y"))).toBe(true);
  });

  it("both colliding overlapping pairs report", () => {
    let design = createEmptyDesign();
    // Four collinear runs on y = 0 with overlapping ranges, same
    // elevation. Pairs ("p|q","r") and ("p","q|r") share the legacy
    // dedup key "p|q|r".
    design = run(design, "p|q", [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    design = run(design, "r", [{ x: 10, y: 0 }, { x: 110, y: 0 }]);
    design = run(design, "p", [{ x: 20, y: 0 }, { x: 120, y: 0 }]);
    design = run(design, "q|r", [{ x: 30, y: 0 }, { x: 130, y: 0 }]);
    const errors = pipeCrossingErrors(design).filter((e) => /overlap along the same route/.test(e));
    expect(errors.some((e) => e.includes("p|q") && e.includes("and r overlap"))).toBe(true);
    expect(errors.some((e) => e.includes("runs p and q|r overlap"))).toBe(true);
  });
});

describe("K7 reconcile face cache cannot return another instance's face", () => {
  it("each attached end is stamped with its OWN face elevation", () => {
    let design = createEmptyDesign();
    // Instance "a::b" (height 120 -> side-face elevation 74.4) with
    // authored nozzle "c"; instance "a" (height 200 -> elevation
    // 124) with authored nozzle "b::c". Both legacy cache keys are
    // "a::b::c".
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "a::b" });
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 500, 0, { id: "a" });
    design = {
      ...design,
      symbols: design.symbols.map((s) =>
        s.id === "a::b"
          ? { ...s, heightIn: 120, nozzles: [{ id: "c", fx: 1, fy: 0, sizeIn: 8 }] }
          : s.id === "a"
            ? { ...s, heightIn: 200, nozzles: [{ id: "b::c", fx: 1, fy: 0, sizeIn: 8 }] }
            : s,
      ),
    };
    design = run(design, "r1", [{ x: 200, y: 0 }, { x: 24, y: 0 }], { diameterIn: 8 });
    design = run(design, "r2", [{ x: 700, y: 0 }, { x: 524, y: 0 }], { diameterIn: 8 });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "r1"
          ? { ...p, attachments: { end: { symbolId: "a::b", anchorId: "c" } } }
          : p.id === "r2"
            ? { ...p, attachments: { end: { symbolId: "a", anchorId: "b::c" } } }
            : p,
      ),
    };
    const next = reconcilePipeAttachments(design);
    const r1 = next.pipes.find((p) => p.id === "r1");
    const r2 = next.pipes.find((p) => p.id === "r2");
    const endElev = (r) => r.elevIn[r.points.length - 1];
    expect(endElev(r1)).toBeCloseTo(74.4, 6);
    expect(endElev(r2)).toBeCloseTo(124, 6);
  });
});
