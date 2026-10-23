// R3 probe (PR #668 fix round 2) — the "shared physical profile" is
// not shared by validation and rendering. ChatGPT's executed
// counterexample (slopedCollision): a route (-100, 0, z0) -> (100, 0,
// z100) physically passes through a perpendicular pipe at (0, 0, 50);
// round-1 findPipeCrossings reports elevA 100 vs 50, resolved: true,
// errors [] — because it reads the flat max-of-endpoints segment
// elevations instead of interpolating the physical route, and the
// renderer draws the segment flat at 100.
//
// These probes FAIL against the round-1 implementation and must PASS
// after the fix: crossings interpolate the physical route at the
// intersection; self-crossings and collinear overlaps use the same
// profile; developed length is the true 3D length; the 3D descriptor
// joints sit at the true vertex elevations; elevation sections
// project both endpoint elevations of a sloped segment.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  resetDesignerIds,
} from "../designerDocument";
import {
  developedRunLengthIn,
  findPipeCrossings,
  pipeCrossingErrors,
} from "../pipeCrossings";
import { pipeDescriptors } from "../designerThreeModel";
import { buildElevation } from "../homeSections";
import { createHomeProject, resetHomeProjectIds, updateLevelDesign } from "../homeProject";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

function slopedDesign(crossElevationIn = 50) {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: -100, y: 0 }, { x: 100, y: 0 }], {
    id: "slope",
    diameterIn: 2,
  });
  design = {
    ...design,
    pipes: design.pipes.map((p) => (p.id === "slope" ? { ...p, elevIn: [0, 100] } : p)),
  };
  design = addPipeRun(design, [{ x: 0, y: -100 }, { x: 0, y: 100 }], {
    id: "cross",
    diameterIn: 2,
    elevationIn: crossElevationIn,
  });
  return design;
}

describe("R3 one physical profile for validation, lengths, and views", () => {
  it("slopedCollision: the crossing elevation is interpolated from the route", () => {
    const design = slopedDesign();
    const crossings = findPipeCrossings(design);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].elevAIn).toBeCloseTo(50, 6);
    expect(crossings[0].elevBIn).toBeCloseTo(50, 6);
    expect(crossings[0].resolved).toBe(false);
    expect(pipeCrossingErrors(design).some((e) => /crosses/.test(e))).toBe(true);
  });

  it("a slope that genuinely clears the crossing pipe resolves", () => {
    let design = slopedDesign();
    design = {
      ...design,
      pipes: design.pipes.map((p) => (p.id === "cross" ? { ...p, elevationIn: 20 } : p)),
    };
    const crossings = findPipeCrossings(design);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].elevAIn).toBeCloseTo(50, 6);
    expect(crossings[0].resolved).toBe(true);
    expect(pipeCrossingErrors(design).some((e) => /crosses/.test(e))).toBe(false);
  });

  it("developed length is the true 3D length of a sloped route", () => {
    const design = slopedDesign();
    const run = design.pipes.find((p) => p.id === "slope");
    expect(developedRunLengthIn(design, run)).toBeCloseTo(Math.hypot(200, 100), 6);
  });

  it("3D descriptor joints sit at the true vertex elevations", () => {
    const design = slopedDesign();
    const descriptor = pipeDescriptors(design).find((p) => p.id === "slope");
    expect(descriptor.segments[0]).toMatchObject({ y0In: 0, y1In: 100 });
    expect(descriptor.joints[0].yIn).toBe(0);
    expect(descriptor.joints[1].yIn).toBe(100);
  });

  it("elevation sections project both endpoint elevations of a sloped segment", () => {
    // Cross at 150 (above the slope): at the default 50 the two runs
    // genuinely collide at the crossing (see slopedCollision), and
    // updateLevelDesign rightly refuses an invalid level design.
    let design = slopedDesign(150);
    let project = createHomeProject("Slope project", { units: "ft" });
    project = updateLevelDesign(project, project.levels[0].id, () => design);
    const result = buildElevation(project, { direction: "S" });
    expect(result.ok).toBe(true);
    const views = result.levels[0].pipeViews.filter((v) => v.kind === "pipe" && v.runId === "slope");
    expect(views).toHaveLength(1);
    expect(views[0].elev0In).toBe(0);
    expect(views[0].elev1In).toBe(100);
  });

  it("a run crossing ITSELF on a slope is judged at the interpolated elevation", () => {
    let design = createEmptyDesign();
    // A loop-back: segment 0 slopes 0 -> 100 across the plan origin;
    // segment 2 crosses it flat at elevation 50.
    design = addPipeRun(
      design,
      [
        { x: -100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: -100 },
      ],
      { id: "selfx", diameterIn: 2 },
    );
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "selfx" ? { ...p, elevIn: [0, 100, 100, 50, 50] } : p,
      ),
    };
    expect(pipeCrossingErrors(design).some((e) => /crosses itself/.test(e))).toBe(true);
  });
});
