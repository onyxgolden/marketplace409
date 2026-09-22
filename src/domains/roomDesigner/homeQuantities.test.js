import { beforeEach, describe, expect, it } from "vitest";
import {
  convertArea,
  convertLength,
  formatArea,
  formatLength,
  measureHomeProject,
  measureLevelDesign,
  normalizeUnits,
} from "./homeQuantities";
import {
  addLevel,
  createHomeProject,
  resetHomeProjectIds,
  updateLevelDesign,
} from "./homeProject";
import {
  addOpening,
  addRoomFromTemplate,
  createEmptyDesign,
  resetDesignerIds,
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
