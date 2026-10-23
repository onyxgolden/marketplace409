
import { describe, expect, it, beforeEach } from "vitest";
import { buildElevation } from "./homeSections";
import {
  addPipeRun,
  addWall,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "./designerDocument";
import {
  createHomeProject,
  resetHomeProjectIds,
  updateLevelDesign,
} from "./homeProject";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

// Elevation projection of piping and vessel access (D2/D5): pipe
// segments render at their modeled centerline elevations, steps
// between segments render as risers, firewater runs carry their
// service flag, and a high-sill vessel's access package (manway,
// catwalk, ladder) projects alongside. A design without pipes keeps
// the legacy level shape and limitation text.
describe("elevation pipe + access projection", () => {
  function rectangleDesign() {
    let d = createEmptyDesign("Cabin");
    d = addWall(d, { x: 0, y: 0 }, { x: 120, y: 0 }, { id: "south" });
    d = addWall(d, { x: 120, y: 0 }, { x: 120, y: 96 }, { id: "east" });
    d = addWall(d, { x: 120, y: 96 }, { x: 0, y: 96 }, { id: "north" });
    d = addWall(d, { x: 0, y: 96 }, { x: 0, y: 0 }, { id: "west" });
    return d;
  }

  function projectWithDesign(design) {
    let p = createHomeProject("Cabin project", { units: "ft" });
    p = updateLevelDesign(p, p.levels[0].id, () => design);
    return p;
  }

  function pipedDesign() {
    let d = rectangleDesign();
    // A run that steps up mid-route: segments at 30, then 66.
    d = addPipeRun(d, [{ x: 24, y: 200 }, { x: 120, y: 200 }, { x: 240, y: 200 }, { x: 360, y: 200 }], {
      id: "stepped",
      diameterIn: 6,
      elevationIn: 30,
    });
    // Per-vertex profile is a post-add patch (same as the FCCU sample's addRun).
    d = { ...d, pipes: d.pipes.map((p) => (p.id === "stepped" ? { ...p, elevIn: [30, 30, 66, 66] } : p)) };
    // A buried firewater run with an explicit source inlet.
    d = addPipeRun(d, [{ x: -48, y: 400 }, { x: 24, y: 400 }], {
      id: "fwsrc",
      diameterIn: 12,
      elevationIn: -36,
    });
    d = addPipeRun(d, [{ x: 24, y: 400 }, { x: 360, y: 400 }], {
      id: "fw",
      diameterIn: 12,
      elevationIn: -36,
    });
    d = {
      ...d,
      pipes: d.pipes.map((p) => {
        if (p.id === "fwsrc") {
          return { ...p, utility: "firewater", sourceOf: "firewater", junctions: { end: { runId: "fw" } } };
        }
        if (p.id === "fw") return { ...p, utility: "firewater" };
        return p;
      }),
    };
    // A vessel whose manway sill (30 in) triggers the access package.
    d = placeSymbol(d, "processEquipment", "vertical-vessel", 600, 200, { id: "v1" });
    return d;
  }

  it("projects pipe segments at their stepped elevations with a riser at the step", () => {
    const result = buildElevation(projectWithDesign(pipedDesign()), { direction: "S" });
    expect(result.ok).toBe(true);
    const level = result.levels[0];
    expect(level.pipeViews).toBeTruthy();
    const segs = level.pipeViews.filter((v) => v.kind === "pipe" && v.runId === "stepped");
    expect(segs.map((s) => s.elevIn)).toEqual([30, 66, 66]);
    const risers = level.pipeViews.filter((v) => v.kind === "riser" && v.runId === "stepped");
    expect(risers).toHaveLength(1);
    // South elevation looks north with u = -x, so the x=120 step
    // (where the run first rises) lands at u = -120.
    expect(risers[0]).toMatchObject({ u: -120, fromIn: 30, toIn: 66 });
    expect(result.limitations.join(" ")).toMatch(/Pipes are drawn in elevation views/);
  });

  it("marks firewater pipe views with the firewater flag (rendered red in the view)", () => {
    const result = buildElevation(projectWithDesign(pipedDesign()), { direction: "S" });
    const fwSegs = result.levels[0].pipeViews.filter((v) => v.kind === "pipe" && v.runId === "fw");
    expect(fwSegs).toHaveLength(1);
    expect(fwSegs[0].firewater).toBe(true);
    expect(fwSegs[0].elevIn).toBe(-36);
  });

  it("projects the manway access package (manway, catwalk, ladder) for a high-sill vessel", () => {
    const result = buildElevation(projectWithDesign(pipedDesign()), { direction: "S" });
    const kinds = (result.levels[0].accessViews || []).map((v) => v.kind);
    expect(kinds).toContain("manway");
    expect(kinds).toContain("catwalk");
    expect(kinds).toContain("ladder");
  });

  it("a design without pipes keeps the legacy level shape and limitation text", () => {
    const result = buildElevation(projectWithDesign(rectangleDesign()), { direction: "S" });
    expect(result.ok).toBe(true);
    expect(result.levels[0].pipeViews).toBeUndefined();
    expect(result.levels[0].accessViews).toBeUndefined();
    expect(result.limitations.join(" ")).toMatch(/Pipes are not drawn/);
  });
});
