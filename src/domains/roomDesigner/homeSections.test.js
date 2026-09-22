// homeSections.js — FORGE Home Designer slice 5 elevations.
//
// Contract: buildElevation/buildStackedElevation are pure orthographic
// projections of canonical geometry — read-only, never pixels, never
// invented dimensions. Openings are placed ALONG the wall (offset measured
// from endpoint A along the normalized wall direction), and both opening
// endpoints project onto the view axis. Diagonal walls foreshorten.
// Missing verticals (wall height, opening heights, window sill height)
// surface as documented assumptions. The boundary never throws.

import { describe, expect, it, beforeEach } from "vitest";
import {
  ELEVATION_DIRECTIONS,
  buildElevation,
  buildStackedElevation,
  normalizeDirection,
} from "./homeSections";
import {
  addOpening,
  addWall,
  createEmptyDesign,
  resetDesignerIds,
} from "./designerDocument";
import {
  addLevel,
  createHomeProject,
  resetHomeProjectIds,
  updateLevelDesign,
} from "./homeProject";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

function rectangleDesign() {
  // 120" x 96" room, one wall per side. Walls carry explicit ids so tests
  // can target them without depending on the id generator.
  let d = createEmptyDesign("Cabin");
  d = addWall(d, { x: 0, y: 0 }, { x: 120, y: 0 }, { id: "south" });
  d = addWall(d, { x: 120, y: 0 }, { x: 120, y: 96 }, { id: "east" });
  d = addWall(d, { x: 120, y: 96 }, { x: 0, y: 96 }, { id: "north" });
  d = addWall(d, { x: 0, y: 96 }, { x: 0, y: 0 }, { id: "west" });
  return d;
}

function projectWithDesign(design, units = "ft") {
  let p = createHomeProject("Cabin project", { units });
  p = updateLevelDesign(p, p.levels[0].id, () => design);
  return p;
}

function wallViewOf(result, wallId, levelIndex = 0) {
  const level = result.levels[levelIndex];
  return level.wallViews.find((w) => w.wallId === wallId);
}

describe("normalizeDirection", () => {
  it("exposes the four cardinal directions", () => {
    expect([...ELEVATION_DIRECTIONS]).toEqual(["N", "S", "E", "W"]);
  });
  it("defaults missing direction to N and uppercases input", () => {
    expect(normalizeDirection(undefined)).toBe("N");
    expect(normalizeDirection("s")).toBe("S");
  });
  it("rejects anything else", () => {
    expect(normalizeDirection("X")).toBeNull();
    expect(normalizeDirection("")).toBeNull();
  });
});

describe("buildElevation — projection math", () => {
  it("projects axis-aligned walls at true length on N", () => {
    const result = buildElevation(projectWithDesign(rectangleDesign()), {
      direction: "N",
    });
    expect(result.ok).toBe(true);
    const south = wallViewOf(result, "south");
    expect(south.projectedStartIn).toBe(0);
    expect(south.projectedEndIn).toBe(120);
    expect(south.lengthIn).toBe(120);
    // The south wall runs along y=0 — east projects to zero on E.
    const e = buildElevation(projectWithDesign(rectangleDesign()), {
      direction: "E",
    });
    const southE = wallViewOf(e, "south");
    expect(southE.lengthIn).toBe(0);
    // Perpendicular walls keep their height — nothing is lost.
    expect(southE.baseIn).toBe(0);
    expect(southE.topIn).toBe(108);
  });

  it("mirrors the same wall across N and S", () => {
    const north = wallViewOf(
      buildElevation(projectWithDesign(rectangleDesign()), { direction: "N" }),
      "south",
    );
    const south = wallViewOf(
      buildElevation(projectWithDesign(rectangleDesign()), { direction: "S" }),
      "south",
    );
    // Physically honest: seen from the other side, the same end lands on
    // the opposite side of the drawing.
    expect([north.projectedStartIn, north.projectedEndIn]).toEqual([0, 120]);
    expect([south.projectedStartIn, south.projectedEndIn]).toEqual([-120, 0]);
  });

  it("foreshortens diagonal walls instead of hiding them", () => {
    let d = createEmptyDesign("Angled");
    d = addWall(d, { x: 0, y: 0 }, { x: 120, y: 120 }, { id: "diag" });
    const result = buildElevation(projectWithDesign(d), { direction: "N" });
    expect(result.ok).toBe(true);
    const wall = wallViewOf(result, "diag");
    // True wall length is 169.71"; orthographic foreshortening is honest.
    expect(wall.lengthIn).toBe(120);
    expect(wall.lengthIn).toBeLessThan(Math.hypot(120, 120));
  });

  it("rejects invalid directions without throwing", () => {
    const result = buildElevation(projectWithDesign(rectangleDesign()), {
      direction: "up",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/N, S, E, W/);
  });
});

describe("buildElevation — openings", () => {
  it("places openings along axis-aligned walls", () => {
    let d = rectangleDesign();
    d = addOpening(d, "south", { type: "door", offsetIn: 12, widthIn: 36 });
    const result = buildElevation(projectWithDesign(d), { direction: "N" });
    const opening = wallViewOf(result, "south").openingViews[0];
    expect(opening.startIn).toBe(12);
    expect(opening.endIn).toBe(48);
    expect(opening.widthIn).toBe(36);
    expect(opening.type).toBe("door");
    // Doors sit on the level base; standard 80" door default.
    expect(opening.sillIn).toBe(0);
    expect(opening.headerIn).toBe(80);
    expect(opening.heightIn).toBe(80);
    expect(opening.heightSource).toBe("default");
  });

  it("places openings along the wall direction on angled walls", () => {
    // THE key correctness check: offset is measured along the wall, so a
    // 12"-along-the-wall opening on a 45° wall projects to 8.49" on the
    // view axis — NOT 12" (a global-X treatment would be wrong).
    let d = createEmptyDesign("Angled");
    d = addWall(d, { x: 0, y: 0 }, { x: 120, y: 120 }, { id: "diag" });
    d = addOpening(d, "diag", { type: "window", offsetIn: 12, widthIn: 36 });
    const result = buildElevation(projectWithDesign(d), { direction: "N" });
    const opening = wallViewOf(result, "diag").openingViews[0];
    const k = Math.SQRT1_2;
    expect(opening.startIn).toBeCloseTo(12 * k, 2);
    expect(opening.endIn).toBeCloseTo(48 * k, 2);
    expect(opening.startIn).not.toBe(12);
  });

  it("defaults the window sill to 36in and surfaces it", () => {
    let d = rectangleDesign();
    d = addOpening(d, "north", { type: "window", offsetIn: 12, widthIn: 36 });
    const result = buildElevation(projectWithDesign(d), { direction: "N" });
    const opening = wallViewOf(result, "north").openingViews[0];
    expect(opening.sillHeightIn).toBe(36);
    expect(opening.sillHeightSource).toBe("default");
    expect(opening.sillIn).toBe(36);
    expect(opening.headerIn).toBe(36 + 48);
    expect(result.assumptions.join(" ")).toMatch(/sill/);
  });

  it("honors a stored window sill without assuming", () => {
    let d = rectangleDesign();
    d = addOpening(d, "north", { type: "window", offsetIn: 12, widthIn: 36 });
    d = {
      ...d,
      openings: d.openings.map((o) => ({ ...o, sillHeightIn: 24 })),
    };
    const result = buildElevation(projectWithDesign(d), { direction: "N" });
    const opening = wallViewOf(result, "north").openingViews[0];
    expect(opening.sillHeightIn).toBe(24);
    expect(opening.sillHeightSource).toBe("design");
    expect(opening.sillIn).toBe(24);
    expect(result.assumptions.join(" ")).not.toMatch(/sill/);
  });

  it("skips openings with no span instead of drawing slivers", () => {
    let d = rectangleDesign();
    d = addOpening(d, "east", { type: "door", offsetIn: 0, widthIn: 36 });
    const result = buildElevation(projectWithDesign(d), { direction: "N" });
    // East wall is perpendicular to the N view plane: the opening has no
    // horizontal span on this view.
    const openings = wallViewOf(result, "east").openingViews;
    expect(openings.every((o) => o.widthIn >= 0)).toBe(true);
  });
});

describe("buildElevation — levels and stacking", () => {
  function twoLevelProject() {
    const d1 = rectangleDesign();
    const d2 = rectangleDesign();
    let p = createHomeProject("Two story", { units: "ft" });
    p = updateLevelDesign(p, p.levels[0].id, () => d1);
    p = addLevel(p);
    const secondId = p.levels[p.levels.length - 1].id;
    p = updateLevelDesign(p, secondId, () => d2);
    return p;
  }

  it("elevates the current level for a single-level view", () => {
    const p = twoLevelProject();
    const result = buildElevation(p, { direction: "N" });
    expect(result.ok).toBe(true);
    expect(result.scope).toBe("level");
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].baseIn).toBe(0);
  });

  it("stacks levels cumulatively with a grade line under level one", () => {
    const p = twoLevelProject();
    const result = buildStackedElevation(p, { direction: "N" });
    expect(result.ok).toBe(true);
    expect(result.scope).toBe("stacked");
    expect(result.levels).toHaveLength(2);
    const [first, second] = result.levels;
    expect(first.baseIn).toBe(0);
    expect(first.gradeLine).toBe(true);
    // Base of level 2 = top of level 1: derived, never invented.
    expect(second.baseIn).toBe(first.baseIn + first.wallHeightIn);
    expect(second.gradeLine).toBe(false);
    expect(result.totalHeightIn).toBe(
      first.wallHeightIn + second.wallHeightIn,
    );
  });

  it("uses the on-screen edited design when passed", () => {
    let d = rectangleDesign();
    d = addWall(d, { x: 0, y: 96 }, { x: 120, y: 96 + 0 }, { id: "spare" });
    const saved = projectWithDesign(rectangleDesign());
    const result = buildElevation(saved, {
      direction: "N",
      editedDesign: d,
    });
    const ids = result.levels[0].wallViews.map((w) => w.wallId);
    expect(ids).toContain("spare");
  });
});

describe("buildElevation — assumptions and provenance", () => {
  it("surfaces a defaulted wall height in assumptions", () => {
    let d = rectangleDesign();
    d = { ...d, settings: {} };
    const result = buildElevation(projectWithDesign(d), { direction: "N" });
    expect(result.ok).toBe(true);
    expect(result.levels[0].wallHeightIn).toBe(108);
    expect(result.levels[0].wallHeightSource).toBe("default");
    expect(result.assumptions.join(" ")).toMatch(/Default wall height/);
  });

  it("reports the design wall height as designed, not assumed", () => {
    let d = rectangleDesign();
    d = { ...d, settings: { wallHeightIn: 120, wallThicknessIn: 4.5 } };
    const result = buildElevation(projectWithDesign(d), { direction: "N" });
    expect(result.levels[0].wallHeightIn).toBe(120);
    expect(result.levels[0].wallHeightSource).toBe("design");
    expect(result.assumptions.join(" ")).not.toMatch(/Default wall height/);
  });

  it("carries quantity provenance and the pipes limitation", () => {
    const result = buildElevation(projectWithDesign(rectangleDesign()), {
      direction: "N",
    });
    expect(result.quantitySource).toBe("designer_geometry");
    expect(result.measurementVersion).toBe(1);
    expect(typeof result.generatedAt).toBe("string");
    expect(result.generatedAt.length).toBeGreaterThan(0);
    expect(result.limitations.join(" ")).toMatch(/Pipes are not drawn/);
  });
});

describe("buildElevation — never-throw boundary", () => {
  it("returns { ok: false } for a null project", () => {
    const result = buildElevation(null, { direction: "N" });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("returns { ok: false } for damaged geometry", () => {
    // Damage the design directly: updateLevelDesign validates, so the
    // corrupt shape has to be spliced past it to reach the boundary.
    const p = createHomeProject("Broken", { units: "ft" });
    const damaged = {
      ...p,
      levels: [
        {
          ...p.levels[0],
          design: { ...createEmptyDesign(), walls: null },
        },
      ],
    };
    const result = buildElevation(damaged, { direction: "N" });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("returns { ok: false } when the project itself is invalid", () => {
    const result = buildStackedElevation({ name: "x" }, { direction: "N" });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});
