// D668-002 probe — a downward jog clears validation but renders
// unchanged. Two perpendicular buried 2-in runs at -36 in: the generated
// downward profile includes -39.375, but each horizontal segment uses the
// MAX endpoint elevation, so all rendered segments stay at -36 with no
// risers; the crossing also disappears from the error lists because the
// intersection is now a vertex excluded by the proper-intersection test.
//
// These probes FAIL against the current implementation and must PASS
// after the fix: a shared physical segment/riser profile consumed by BOTH
// validation and rendering. Freeze this exact negative, an upward
// positive, and repeated-application idempotence.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  resetDesignerIds,
} from "../designerDocument";
import {
  applyCrossingJogs,
  findPipeCrossings,
  pipeCrossingErrors,
  physicalRouteIn,
  requiredSeparationIn,
} from "../pipeCrossings";
import { pipeDescriptors } from "../designerThreeModel";

beforeEach(() => {
  resetDesignerIds();
});

// The exact counterexample: two perpendicular buried 2-in runs at -36 in.
function buriedCrossing() {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], {
    id: "a",
    diameterIn: 2,
    elevationIn: -36,
    underground: true,
  });
  design = addPipeRun(design, [{ x: 500, y: 100 }, { x: 500, y: 900 }], {
    id: "b",
    diameterIn: 2,
    elevationIn: -36,
    underground: true,
  });
  return design;
}

describe("D668-002 downward jog: shared physical profile", () => {
  it("the generated downward jog LOWERS the rendered pipe (the exact negative)", () => {
    let design = applyCrossingJogs(buriedCrossing(), "b");
    const run = design.pipes.find((p) => p.id === "b");
    // The profile must dip below the base elevation somewhere.
    const route = physicalRouteIn(design, run);
    const minZ = Math.min(...route.map((n) => n.zIn));
    expect(minZ).toBeLessThan(-36);
    // And the 3D descriptor must show it: a segment/riser below -36.
    const descriptor = pipeDescriptors(design).find((p) => p.id === "b");
    const lows = [
      ...descriptor.segments.map((s) => Math.min(s.y0In ?? s.yIn, s.y1In ?? s.yIn)),
      ...descriptor.risers.map((r) => r.y0In),
    ];
    expect(Math.min(...lows)).toBeLessThan(-36);
  });

  it("the jogged underpass still validates as a RESOLVED crossing", () => {
    const design = applyCrossingJogs(buriedCrossing(), "b");
    // No unresolved-crossing errors: the underpass clears by the
    // required separation.
    expect(pipeCrossingErrors(design)).toEqual([]);
    // The crossing is still DETECTED (not silently dropped) and resolved.
    const crossings = findPipeCrossings(design).filter(
      (c) =>
        (c.aRunId === "a" && c.bRunId === "b") || (c.aRunId === "b" && c.bRunId === "a"),
    );
    expect(crossings.length).toBeGreaterThan(0);
    expect(crossings.every((c) => c.resolved)).toBe(true);
  });

  it("an upward jog raises the rendered pipe (positive partner)", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], {
      id: "a",
      diameterIn: 2,
      elevationIn: 30,
    });
    design = addPipeRun(design, [{ x: 500, y: 100 }, { x: 500, y: 900 }], {
      id: "b",
      diameterIn: 2,
      elevationIn: 30,
    });
    design = applyCrossingJogs(design, "b");
    const run = design.pipes.find((p) => p.id === "b");
    const route = physicalRouteIn(design, run);
    const maxZ = Math.max(...route.map((n) => n.zIn));
    expect(maxZ).toBeGreaterThan(30);
    expect(pipeCrossingErrors(design)).toEqual([]);
  });

  it("repeated application is idempotent", () => {
    const once = applyCrossingJogs(buriedCrossing(), "b");
    const twice = applyCrossingJogs(once, "b");
    const r1 = once.pipes.find((p) => p.id === "b");
    const r2 = twice.pipes.find((p) => p.id === "b");
    expect(r2.points).toEqual(r1.points);
    expect(r2.elevIn).toEqual(r1.elevIn);
  });

  it("the jogged profile dips by the required separation", () => {
    const design = applyCrossingJogs(buriedCrossing(), "b");
    const run = design.pipes.find((p) => p.id === "b");
    const route = physicalRouteIn(design, run);
    const minZ = Math.min(...route.map((n) => n.zIn));
    const expected = -36 - requiredSeparationIn(2, 2);
    expect(minZ).toBeCloseTo(expected, 6);
  });
});
