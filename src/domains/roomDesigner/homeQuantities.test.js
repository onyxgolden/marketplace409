import { beforeEach, describe, expect, it } from "vitest";
import {
  convertArea,
  convertLength,
  formatArea,
  formatLength,
  measureHomeProject,
  measureLevelDesign,
  normalizeUnits,
  projectWithEditedDesign,
} from "./homeQuantities";
import {
  addLevel,
  createHomeProject,
  resetHomeProjectIds,
  updateLevelDesign,
} from "./homeProject";
import {
  addOpening,
  addPipeRun,
  addRoomFromTemplate,
  createEmptyDesign,
  resetDesignerIds,
  updateDesignSettings,
} from "./designerDocument";
import "./pipingCatalog";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

/** One 12x12 bedroom: 144 sq ft, 4 walls totaling 576 in. */
function bedroomDesign() {
  let d = createEmptyDesign("Bedroom level");
  d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 });
  return d;
}

describe("homeQuantities — units", () => {
  it("normalizes known units and defaults unknown to inches", () => {
    expect(normalizeUnits("in")).toBe("in");
    expect(normalizeUnits("ft")).toBe("ft");
    expect(normalizeUnits("m")).toBe("m");
    expect(normalizeUnits("cm")).toBe("in");
    expect(normalizeUnits(null)).toBe("in");
    expect(normalizeUnits("")).toBe("in");
  });

  it("converts lengths from inches", () => {
    expect(convertLength(144, "in")).toBe(144);
    expect(convertLength(144, "ft")).toBe(12);
    expect(convertLength(144, "m")).toBeCloseTo(3.6576, 4);
    expect(convertLength("nope", "ft")).toBe(0);
  });

  it("converts areas from square feet", () => {
    expect(convertArea(100, "in")).toBe(100);
    expect(convertArea(100, "ft")).toBe(100);
    expect(convertArea(100, "m")).toBeCloseTo(9.290304, 4);
  });

  it("formats lengths and areas for each unit", () => {
    expect(formatLength(150, "ft")).toBe("12' 6\"");
    expect(formatLength(150, "in")).toBe("150\u2033");
    expect(formatLength(150, "m")).toBe("3.81 m");
    expect(formatArea(192, "ft")).toBe("192 sq ft");
    expect(formatArea(192, "in")).toBe("192 sq ft");
    expect(formatArea(192, "m")).toBe("17.84 m\u00B2");
  });
});

describe("homeQuantities — measureLevelDesign", () => {
  it("measures a room level from geometry", () => {
    const m = measureLevelDesign(bedroomDesign());
    expect(m.roomCount).toBe(1);
    expect(m.rooms[0]).toMatchObject({ label: "Bedroom", areaSqFt: 144 });
    expect(m.grossRoomAreaSqFt).toBe(144);
    // net = 144 - (576 * 4.5 / 144) = 144 - 18 = 126
    expect(m.netRoomAreaSqFt).toBe(126);
    expect(m.wallCount).toBe(4);
    expect(m.totalWallLengthIn).toBe(576);
    expect(m.netWallLengthIn).toBe(576);
    // one face: 576 * 108 / 144 = 432
    expect(m.wallSurfaceAreaSqFt).toBe(432);
    expect(m.openingCount).toBe(0);
  });

  it("subtracts opening widths from net wall length", () => {
    let d = bedroomDesign();
    d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 36 }); // 36" door
    const m = measureLevelDesign(d);
    expect(m.doorCount).toBe(1);
    expect(m.openingCount).toBe(1);
    expect(m.totalOpeningWidthIn).toBe(36);
    expect(m.totalWallLengthIn).toBe(576);
    expect(m.netWallLengthIn).toBe(540);
  });

  it("measures an empty design as zeros", () => {
    const m = measureLevelDesign(createEmptyDesign());
    expect(m.roomCount).toBe(0);
    expect(m.grossRoomAreaSqFt).toBe(0);
    expect(m.netRoomAreaSqFt).toBe(0);
    expect(m.totalWallLengthIn).toBe(0);
    expect(m.netWallLengthIn).toBe(0);
    expect(m.wallSurfaceAreaSqFt).toBe(0);
  });

  it("returns null instead of throwing on a damaged design", () => {
    expect(measureLevelDesign(null)).toBeNull();
    expect(measureLevelDesign({ version: 999, walls: [] })).toBeNull();
  });
});

describe("homeQuantities — projectWithEditedDesign", () => {
  it("swaps the edited design into the current level only", () => {
    let p = createHomeProject("Edit test");
    const firstId = p.levels[0].id;
    p = addLevel(p, "Level 2");
    const edited = addRoomFromTemplate(createEmptyDesign(), "bedroom", { x: 0, y: 0 });
    const effective = projectWithEditedDesign(p, edited);
    expect(effective.levels[0].design).toBe(edited);
    expect(effective.levels[0].id).toBe(firstId);
    // the other level keeps its (empty) design
    expect(effective.levels[1].design.rooms).toEqual([]);
    // the input project is untouched
    expect(p.levels[0].design.rooms).toEqual([]);
  });

  it("returns null when there is nothing to measure", () => {
    expect(projectWithEditedDesign(null, createEmptyDesign())).toBeNull();
    expect(projectWithEditedDesign(createHomeProject("x"), null)).toBeNull();
  });

  it("reflects unsaved edits in the measurement", () => {
    let p = createHomeProject("Unsaved");
    const edited = bedroomDesign();
    const result = measureHomeProject(projectWithEditedDesign(p, edited));
    expect(result.ok).toBe(true);
    expect(result.totals.grossRoomAreaSqFt).toBe(144);
  });
});

describe("homeQuantities — measureHomeProject", () => {
  it("rolls per-level measurements up to project totals", () => {
    let p = createHomeProject("Two-story", { units: "ft" });
    const firstId = p.levels[0].id;
    p = updateLevelDesign(p, firstId, () => bedroomDesign());
    p = addLevel(p, "Level 2");
    const secondId = p.levels[1].id;
    let d2 = createEmptyDesign("Level 2");
    d2 = addRoomFromTemplate(d2, "bathroom", { x: 0, y: 0 }); // 8x6 = 48 sq ft
    p = updateLevelDesign(p, secondId, () => d2);

    const result = measureHomeProject(p);
    expect(result.ok).toBe(true);
    expect(result.projectName).toBe("Two-story");
    expect(result.units).toBe("ft");
    expect(result.levelCount).toBe(2);
    expect(result.levels[0]).toMatchObject({
      id: firstId,
      name: "Level 1",
      grossRoomAreaSqFt: 144,
    });
    expect(result.levels[1]).toMatchObject({
      id: secondId,
      name: "Level 2",
      grossRoomAreaSqFt: 48,
    });
    // bathroom: 4 walls, 2x96 + 2x72 = 336 in
    expect(result.totals.roomCount).toBe(2);
    expect(result.totals.grossRoomAreaSqFt).toBe(192);
    expect(result.totals.wallCount).toBe(8);
    expect(result.totals.totalWallLengthIn).toBe(576 + 336);
  });

  it("never throws on corrupt input — returns ok:false", () => {
    expect(measureHomeProject(null)).toMatchObject({ ok: false });
    expect(measureHomeProject(undefined)).toMatchObject({ ok: false });
    expect(measureHomeProject({})).toMatchObject({ ok: false });
    expect(measureHomeProject({ version: 1, levels: [], currentLevelId: "x" })).toMatchObject({
      ok: false,
    });
    const bad = measureHomeProject("not a project");
    expect(bad.ok).toBe(false);
    expect(typeof bad.error).toBe("string");
    expect(bad.error.length).toBeGreaterThan(0);
  });

  it("reports a damaged level by name instead of crashing", () => {
    let p = createHomeProject("Damaged");
    // Sneak a damaged design past the mutators by editing the level directly.
    p = { ...p, levels: [{ ...p.levels[0], design: { version: 999, walls: [] } }] };
    const result = measureHomeProject(p);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("level_1");
  });
});

describe("homeQuantities — review fixes (PR #308)", () => {
  it("deducts opening areas from net wall surface", () => {
    let d = bedroomDesign();
    d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 36 }); // 36" x 80" = 20 sq ft
    const m = measureLevelDesign(d);
    expect(m.totalOpeningAreaSqFt).toBe(20);
    // gross one-face surface: 576 * 108 / 144 = 432; minus 20 = 412
    expect(m.wallSurfaceAreaSqFt).toBe(412);
  });

  it("deducts window areas with the documented window default height", () => {
    let d = bedroomDesign();
    d = addOpening(d, d.walls[0].id, { type: "window", offsetIn: 36, widthIn: 48 }); // 48" x 48" = 16 sq ft
    const m = measureLevelDesign(d);
    expect(m.totalOpeningAreaSqFt).toBe(16);
    expect(m.wallSurfaceAreaSqFt).toBe(416); // 432 - 16
    expect(m.assumptions).toContain("Opening heights defaulted (doors 80″, windows 48″)");
  });

  it("flags defaulted wall height/thickness as assumptions, not silent values", () => {
    const noSettings = { ...createEmptyDesign(), settings: undefined };
    const m = measureLevelDesign(noSettings);
    expect(m.wallHeightIn).toBe(108);
    expect(m.wallHeightSource).toBe("default");
    expect(m.wallThicknessSource).toBe("default");
    expect(m.assumptions).toContain("Default wall height 9 ft (not set in design)");
    expect(m.assumptions).toContain("Default wall thickness 4.5 in (not set in design)");
  });

  it("records design settings as the value source when present", () => {
    const d = updateDesignSettings(bedroomDesign(), { wallHeightIn: 120, wallThicknessIn: 6 });
    const m = measureLevelDesign(d);
    expect(m.wallHeightIn).toBe(120);
    expect(m.wallHeightSource).toBe("design");
    expect(m.wallThicknessSource).toBe("design");
    expect(m.assumptions).toEqual([]);
    expect(m.wallSurfaceAreaSqFt).toBe(480); // 576 * 120 / 144, no openings
  });

  it("reports pipe run totals from geometry", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 144, y: 0 }], { diameterIn: 2 });
    const m = measureLevelDesign(d);
    expect(m.pipeRunCount).toBe(1);
    expect(m.totalPipeLengthIn).toBe(144);
  });

  it("merges assumptions across levels in project totals", () => {
    let p = createHomeProject("Assumptions");
    const firstId = p.levels[0].id;
    const noSettings = { ...bedroomDesign(), settings: undefined };
    p = updateLevelDesign(p, firstId, () => noSettings);
    const result = measureHomeProject(p);
    expect(result.ok).toBe(true);
    expect(result.totals.assumptions).toContain("Default wall height 9 ft (not set in design)");
  });
});
