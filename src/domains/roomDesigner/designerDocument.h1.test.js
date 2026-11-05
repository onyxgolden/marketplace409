// H1/G5 — home-plan import at the document layer: record fields, lock /
// show-hide / print / rotation patches, rotation-aware calibration, the
// named Underlay.calibratedHighlandSurrogate acceptance, undo restoring
// the prior underlay, and save/reopen persistence. All dimensions here
// are hand-authored test values; 628.875 is the scope brief's calibration
// TEST INPUT value, not a claim about any house.

import { describe, expect, it } from "vitest";
import {
  addWall,
  buildUnderlayRecord,
  calibrateUnderlay,
  createEmptyDesign,
  setUnderlay,
  updateUnderlay,
} from "./designerDocument";
import { underlayPixelForPlanPoint, underlayPlanPointForPixel } from "./designerGeometry";
import {
  addLevel,
  createHomeProject,
  switchLevel,
  updateLevelDesign,
} from "./homeProject";
import { createInitialState, designerReducer } from "@/components/designer/designerReducer";

// Minimal 1x1 transparent PNG data URL (real bytes), reused as the
// surrogate image payload. The surrogate's DIMENSIONS are the record's
// widthPx/heightPx below, not this pixel's.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Synthetic surrogate (scope brief §6.3): hand-authored test values,
// labeled as such. Deliberately NOT the Highland artifact's dimensions.
const surrogate = (over = {}) => ({
  name: "surrogate-plan.png",
  mimeType: "image/png",
  dataUrl: TINY_PNG,
  widthPx: 800,
  heightPx: 600,
  ...over,
});

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe("H1 underlay record", () => {
  it("carries the H1 fields with safe defaults", () => {
    const record = buildUnderlayRecord(surrogate());
    expect(record.locked).toBe(false);
    expect(record.rotationDeg).toBe(0);
    expect(record.visible).toBe(true);
    expect(record.printInclude).toBe(true);
    expect(record.scaleCheck).toBeNull();
    expect(record.x).toBe(0);
    expect(record.y).toBe(0);
  });

  it("honors an explicit locked home import and quarter-turn rotations", () => {
    const record = buildUnderlayRecord(surrogate({ locked: true, rotationDeg: 90 }));
    expect(record.locked).toBe(true);
    expect(record.rotationDeg).toBe(90);
  });

  it("refuses non-quarter-turn rotations and active-content data URLs", () => {
    expect(() => buildUnderlayRecord(surrogate({ rotationDeg: 45 })))
      .toThrow("quarter turn");
    expect(() =>
      buildUnderlayRecord(surrogate({ dataUrl: "data:image/svg+xml,<svg></svg>" })),
    ).toThrow("SVG and HTML");
    expect(() =>
      buildUnderlayRecord(surrogate({ dataUrl: "data:text/html,<h1>x</h1>" })),
    ).toThrow("SVG and HTML");
  });

  it("patches lock, visibility, print inclusion, rotation, and scale check", () => {
    let design = setUnderlay(createEmptyDesign("T"), surrogate());
    design = updateUnderlay(design, { locked: true });
    expect(design.underlay.locked).toBe(true);
    design = updateUnderlay(design, { visible: false });
    expect(design.underlay.visible).toBe(false);
    design = updateUnderlay(design, { printInclude: false });
    expect(design.underlay.printInclude).toBe(false);
    design = updateUnderlay(design, { rotationDeg: 270 });
    expect(design.underlay.rotationDeg).toBe(270);
    expect(() => updateUnderlay(design, { rotationDeg: 45 })).toThrow("quarter turn");
    const check = { checkLengthIn: 396, impliedLengthIn: 400, differencePct: 1.01, warning: "reference scale differs—verify measurements" };
    design = updateUnderlay(design, { scaleCheck: check });
    expect(design.underlay.scaleCheck).toEqual(check);
    expect(() => updateUnderlay(design, { scaleCheck: { checkLengthIn: "x" } }))
      .toThrow("scale check");
    design = updateUnderlay(design, { scaleCheck: null });
    expect(design.underlay.scaleCheck).toBeNull();
  });
});

describe("H1 calibration registration", () => {
  it("rotation 0 reproduces the legacy anchor formula exactly", () => {
    // Underlay at (10, 20), 2 px/in, 800 px wide. Clicks 314.4375 plan
    // inches apart, calibrated to 628.875 -> 1 px/in.
    let design = setUnderlay(createEmptyDesign("T"), surrogate({ pxPerIn: 2 }));
    design = updateUnderlay(design, { x: 10, y: 20 });
    const before = design.underlay;
    const clickA = { x: 50, y: 60 };
    const clickB = { x: 364.4375, y: 60 };
    const pixelBefore = underlayPixelForPlanPoint(before, clickA);
    const calibrated = calibrateUnderlay(design, clickA, clickB, 628.875);
    expect(calibrated.underlay.pxPerIn).toBeCloseTo(1, 9);
    // Legacy formula: x' = 50 - (50-10)*2 = -30; y' = 60 - (60-20)*2 = -20.
    expect(calibrated.underlay.x).toBeCloseTo(-30, 9);
    expect(calibrated.underlay.y).toBeCloseTo(-20, 9);
    const pixelAfter = underlayPixelForPlanPoint(calibrated.underlay, clickA);
    expect(near(pixelAfter.px, pixelBefore.px)).toBe(true);
    expect(near(pixelAfter.py, pixelBefore.py)).toBe(true);
  });

  it("rotation 90 keeps the first calibration point registered to its pixel", () => {
    let design = setUnderlay(createEmptyDesign("T"), surrogate({ pxPerIn: 2, rotationDeg: 90 }));
    const before = design.underlay;
    const clickA = underlayPlanPointForPixel(before, 100, 50);
    const clickB = underlayPlanPointForPixel(before, 100 + 628.875, 50);
    const pixelBefore = underlayPixelForPlanPoint(before, clickA);
    const calibrated = calibrateUnderlay(design, clickA, clickB, 628.875);
    expect(calibrated.underlay.pxPerIn).toBeCloseTo(1, 9);
    expect(calibrated.underlay.rotationDeg).toBe(90);
    const pixelAfter = underlayPixelForPlanPoint(calibrated.underlay, clickA);
    expect(near(pixelAfter.px, pixelBefore.px)).toBe(true);
    expect(near(pixelAfter.py, pixelBefore.py)).toBe(true);
  });
});

describe("Underlay.calibratedHighlandSurrogate", () => {
  it("calibrates with 628.875 entered and keeps registration across rotation, level switch, and reopen", () => {
    // Surrogate: 800 x 600 test px at 2 px/in, anchored at the origin.
    let design = setUnderlay(createEmptyDesign("Surrogate"), surrogate({ pxPerIn: 2 }));
    const clickA = { x: 50, y: 50 };
    const clickB = { x: 364.4375, y: 50 };
    design = calibrateUnderlay(design, clickA, clickB, 628.875);
    expect(design.underlay.pxPerIn).toBeCloseTo(1, 9);
    expect(design.underlay.widthPx / design.underlay.pxPerIn).toBeCloseTo(800, 9);
    const pixelBefore = underlayPixelForPlanPoint(design.underlay, clickA);

    // Rotation: rotating must not disturb the calibrated scale, and a
    // recalibration after rotation keeps the same pixel registered.
    design = updateUnderlay(design, { rotationDeg: 90 });
    expect(design.underlay.pxPerIn).toBeCloseTo(1, 9);
    const rotatedA = underlayPlanPointForPixel(design.underlay, pixelBefore.px, pixelBefore.py);
    const rotatedB = underlayPlanPointForPixel(design.underlay, pixelBefore.px + 628.875, pixelBefore.py);
    design = calibrateUnderlay(design, rotatedA, rotatedB, 628.875);
    const pixelAfterRotation = underlayPixelForPlanPoint(design.underlay, rotatedA);
    expect(near(pixelAfterRotation.px, pixelBefore.px)).toBe(true);
    expect(near(pixelAfterRotation.py, pixelBefore.py)).toBe(true);

    // Level switch: the underlay rides its own level, untouched by the
    // other level, and identical when switching back.
    let project = createHomeProject("Surrogate project");
    const level1Id = project.levels[0].id;
    project = updateLevelDesign(project, level1Id, () => design);
    project = addLevel(project, "Second level");
    const level2Id = project.levels.find((l) => l.id !== level1Id).id;
    const toSecond = switchLevel(project, design, level2Id);
    expect(toSecond.design.underlay).toBeNull();
    const back = switchLevel(toSecond.project, toSecond.design, level1Id);
    expect(back.design.underlay).toEqual(design.underlay);

    // Reopen: a JSON save/reopen round trip preserves position, scale,
    // rotation, lock, opacity, and print inclusion exactly.
    const reopened = JSON.parse(JSON.stringify(back.design));
    for (const field of ["x", "y", "pxPerIn", "rotationDeg", "locked", "opacity", "printInclude", "visible", "widthPx", "heightPx"]) {
      expect(reopened.underlay[field]).toBe(back.design.underlay[field]);
    }
  });

  it("import creates zero native walls and zero native rooms", () => {
    let design = createEmptyDesign("Counts");
    design = addWall(design, { x: 0, y: 0 }, { x: 120, y: 0 });
    design = addWall(design, { x: 120, y: 0 }, { x: 120, y: 96 });
    design = {
      ...design,
      rooms: [{ id: "room-1", label: "Test room", polygon: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }] }],
    };
    const wallsBefore = design.walls.length;
    const roomsBefore = design.rooms.length;
    const imported = setUnderlay(design, surrogate({ locked: true }));
    expect(imported.walls.length).toBe(wallsBefore);
    expect(imported.rooms.length).toBe(roomsBefore);
    expect(imported.underlay.locked).toBe(true);
    // And no area, finish, or dimension is derived from the underlay:
    // the record carries no room, wall, area, or quantity fields.
    expect(imported.underlay).not.toHaveProperty("rooms");
    expect(imported.underlay).not.toHaveProperty("areaSqFt");
  });

  it("undo restores the prior underlay after a replacement", () => {
    let state = createInitialState(setUnderlay(createEmptyDesign("Undo"), surrogate({ name: "first.png" })));
    const first = state.design.underlay;
    state = designerReducer(state, {
      type: "SET_UNDERLAY",
      underlay: surrogate({ name: "second.png", locked: true }),
    });
    expect(state.design.underlay.name).toBe("second.png");
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.underlay.name).toBe(first.name);
    expect(state.design.underlay.dataUrl).toBe(first.dataUrl);
  });

  it("lock, opacity, show/hide, reposition, and print inclusion compose", () => {
    let design = setUnderlay(createEmptyDesign("Controls"), surrogate({ locked: true }));
    expect(design.underlay.locked).toBe(true);
    design = updateUnderlay(design, { locked: false, x: 30, y: 40 });
    expect(design.underlay.x).toBe(30);
    expect(design.underlay.y).toBe(40);
    design = updateUnderlay(design, { locked: true, opacity: 0 });
    expect(design.underlay.opacity).toBe(0);
    design = updateUnderlay(design, { opacity: 1 });
    expect(design.underlay.opacity).toBe(1);
    design = updateUnderlay(design, { visible: false });
    expect(design.underlay.visible).toBe(false);
    design = updateUnderlay(design, { printInclude: false });
    expect(design.underlay.printInclude).toBe(false);
    design = updateUnderlay(design, { visible: true, printInclude: true });
    expect(design.underlay.visible).toBe(true);
    expect(design.underlay.printInclude).toBe(true);
  });
});
