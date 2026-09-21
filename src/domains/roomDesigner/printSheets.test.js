// Printable sheet catalog + document operations: placement fixes the plan
// region and fit scale once; later edits never silently alter them.

import {
  addSheet,
  createEmptyDesign,
  deleteSheet,
  designContentBounds,
  computeFitScale,
  findSheet,
  fitScaleLabel,
  moveSheet,
  addWall,
  sheetsOf,
  sheetPlanBounds,
  updateDesignSettings,
  updateSheetFormat,
  validateDesign,
} from "./designerDocument";
import {
  PRINT_MARGIN_IN,
  SHEET_CATALOG,
  sheetDimensions,
  sheetSizeLabel,
  getSheetSize,
} from "./sheetCatalog";

describe("sheet catalog", () => {
  it("stores portrait dimensions only and swaps for landscape", () => {
    for (const entry of SHEET_CATALOG) {
      const portrait = sheetDimensions(entry.id, "portrait");
      const landscape = sheetDimensions(entry.id, "landscape");
      expect(portrait).toEqual({ widthIn: entry.widthIn, heightIn: entry.heightIn });
      expect(landscape).toEqual({ widthIn: entry.heightIn, heightIn: entry.widthIn });
    }
  });

  it("covers Letter, Tabloid, and ARCH A through E", () => {
    expect(SHEET_CATALOG.map((s) => s.id)).toEqual([
      "letter",
      "tabloid",
      "arch-a",
      "arch-b",
      "arch-c",
      "arch-d",
      "arch-e",
    ]);
    expect(getSheetSize("letter")).toMatchObject({ widthIn: 8.5, heightIn: 11 });
    expect(getSheetSize("tabloid")).toMatchObject({ widthIn: 11, heightIn: 17 });
    expect(getSheetSize("arch-e")).toMatchObject({ widthIn: 36, heightIn: 48 });
  });

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(SHEET_CATALOG)).toBe(true);
    expect(() => getSheetSize("nope")).toThrow();
    expect(() => sheetDimensions("letter", "diagonal")).toThrow();
  });

  it("labels sizes for the UI", () => {
    expect(sheetSizeLabel("letter", "portrait")).toBe("Letter · 8.5″ × 11″ · portrait");
    expect(sheetSizeLabel("arch-d", "landscape")).toBe("ARCH D · 36″ × 24″ · landscape");
  });
});

describe("computeFitScale", () => {
  it("is the uniform min of the two printable-area ratios (never distorts)", () => {
    // 8.5x11 Letter, 0.5" margins -> 7.5 x 10 printable.
    const fit = computeFitScale(8.5, 11, 200, 100);
    expect(fit).toBeCloseTo(Math.min(7.5 / 200, 10 / 100), 12);
    // Tall content is height-constrained: single uniform value.
    const fit2 = computeFitScale(8.5, 11, 50, 400);
    expect(fit2).toBeCloseTo(10 / 400, 12);
  });

  it("rejects paper too small for the margin", () => {
    expect(() => computeFitScale(0.9, 11, 100, 100)).toThrow();
  });

  it("pads degenerate content so the scale stays finite", () => {
    expect(computeFitScale(8.5, 11, 0, 0)).toBeCloseTo(Math.min(7.5, 10), 12);
  });

  it("exposes the margin constant", () => {
    expect(PRINT_MARGIN_IN).toBe(0.5);
  });
});

describe("fitScaleLabel", () => {
  it("labels the EXACT computed ratio, never a rounded architectural scale", () => {
    // Exact 1" = 54" stays 1" = 54".
    expect(fitScaleLabel(1 / 54)).toBe('Fit scale: 1" = 54"');
    // Exact 1" = 53.7" keeps the decimal (matches the architect brief example).
    expect(fitScaleLabel(1 / 53.7)).toBe('Fit scale: 1" = 53.7"');
    expect(fitScaleLabel(1)).toBe('Fit scale: 1" = 1"');
  });

  it("rejects non-positive scales", () => {
    expect(() => fitScaleLabel(0)).toThrow();
  });
});

describe("designContentBounds", () => {
  it("returns null for an empty design", () => {
    expect(designContentBounds(createEmptyDesign())).toBeNull();
  });

  it("bounds wall endpoints", () => {
    let design = addWall(createEmptyDesign(), { x: 10, y: 20 }, { x: 110, y: 60 });
    expect(designContentBounds(design)).toEqual({ x: 10, y: 20, widthIn: 100, heightIn: 40 });
  });

  it("ignores non-finite coordinates instead of poisoning the bounds", () => {
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 100, y: 50 });
    design = { ...design, walls: [...design.walls, { id: "w-x", a: { x: NaN, y: 0 }, b: { x: 0, y: 0 } }] };
    expect(designContentBounds(design)).toEqual({ x: 0, y: 0, widthIn: 100, heightIn: 50 });
  });
});

describe("addSheet / moveSheet / deleteSheet / updateSheetFormat", () => {
  const designWithWall = () =>
    addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 200, y: 100 });

  it("new documents start with no sheets", () => {
    expect(createEmptyDesign().sheets).toEqual([]);
  });

  it("old documents without sheets read as []", () => {
    const legacy = { ...createEmptyDesign() };
    delete legacy.sheets;
    expect(sheetsOf(legacy)).toEqual([]);
    expect(findSheet(legacy, "sheet-1")).toBeUndefined();
  });

  it("fits the frame around current content with a uniform fit scale", () => {
    // Snap off: this test pins the exact fit/centering math, not placement.
    const design = updateDesignSettings(designWithWall(), { snapEnabled: false });
    const withSheet = addSheet(design, "letter", "portrait");
    const sheet = withSheet.sheets[0];
    expect(sheet.sizeId).toBe("letter");
    expect(sheet.orientation).toBe("portrait");
    // Letter portrait: 8.5x11 paper, 7.5x10 printable. Content is 200x100.
    const expectedFit = Math.min(7.5 / 200, 10 / 100);
    expect(sheet.fitScale).toBeCloseTo(expectedFit, 12);
    // Frame is centered on the content and represents the physical paper:
    // plan width = full paper width / fit scale. The content exactly fills
    // the printable area (7.5" of 8.5"), leaving the 0.5" margins blank.
    expect(sheet.planWidthIn).toBeCloseTo(8.5 / expectedFit, 9);
    expect(sheet.planHeightIn).toBeCloseTo(11 / expectedFit, 9);
    const bounds = sheetPlanBounds(sheet);
    expect(bounds.x).toBeCloseTo(100 - sheet.planWidthIn / 2, 9);
    expect(bounds.y).toBeCloseTo(50 - sheet.planHeightIn / 2, 9);
  });

  it("an empty design gets a 1:1 paper-size frame centered at the origin", () => {
    // Snap off: pins the exact 1:1 centering math, not placement.
    const design = updateDesignSettings(createEmptyDesign(), { snapEnabled: false });
    const withSheet = addSheet(design, "tabloid", "landscape");
    const sheet = withSheet.sheets[0];
    expect(sheet.fitScale).toBe(1);
    expect(sheet.planWidthIn).toBe(17);
    expect(sheet.planHeightIn).toBe(11);
    expect(sheet.x).toBe(-8.5);
    expect(sheet.y).toBe(-5.5);
  });

  it("accepts an explicit top-left anchor", () => {
    // Snap off: pins anchor passthrough, not placement.
    const design = updateDesignSettings(designWithWall(), { snapEnabled: false });
    const withSheet = addSheet(design, "letter", "portrait", { x: 5, y: 7 });
    expect(withSheet.sheets[0].x).toBe(5);
    expect(withSheet.sheets[0].y).toBe(7);
  });

  it("moveSheet moves only the anchor; bounds and scale stay fixed", () => {
    // Snap off: pins the move semantics, not placement.
    const design = updateDesignSettings(designWithWall(), { snapEnabled: false });
    const withSheet = addSheet(design, "letter", "portrait");
    const before = withSheet.sheets[0];
    const moved = moveSheet(withSheet, before.id, 42, 43);
    const after = findSheet(moved, before.id);
    expect(after.x).toBe(42);
    expect(after.y).toBe(43);
    expect(after.planWidthIn).toBe(before.planWidthIn);
    expect(after.planHeightIn).toBe(before.planHeightIn);
    expect(after.fitScale).toBe(before.fitScale);
  });

  it("later content additions never alter the fixed frame or scale", () => {
    const withSheet = addSheet(designWithWall(), "letter", "portrait");
    const sheetId = withSheet.sheets[0].id;
    const bigger = addWall(withSheet, { x: -1000, y: -1000 }, { x: 2000, y: 2000 });
    const sheet = findSheet(bigger, sheetId);
    const original = findSheet(withSheet, sheetId);
    expect(sheet).toEqual(original);
  });

  it("deleteSheet removes only that sheet", () => {
    let design = addSheet(designWithWall(), "letter", "portrait");
    design = addSheet(design, "tabloid", "landscape");
    const [first, second] = design.sheets;
    const after = deleteSheet(design, first.id);
    expect(after.sheets.map((s) => s.id)).toEqual([second.id]);
  });

  it("updateSheetFormat keeps the frame center and re-fixes scale against current content", () => {
    let design = addSheet(designWithWall(), "letter", "portrait");
    const before = design.sheets[0];
    const centerX = before.x + before.planWidthIn / 2;
    const centerY = before.y + before.planHeightIn / 2;
    design = updateSheetFormat(design, before.id, { orientation: "landscape" });
    const after = findSheet(design, before.id);
    expect(after.orientation).toBe("landscape");
    // Landscape letter: 11x8.5 paper, 10x7.5 printable; content 200x100.
    const expectedFit = Math.min(10 / 200, 7.5 / 100);
    expect(after.fitScale).toBeCloseTo(expectedFit, 12);
    expect(after.x + after.planWidthIn / 2).toBeCloseTo(centerX, 9);
    expect(after.y + after.planHeightIn / 2).toBeCloseTo(centerY, 9);
  });

  it("throws on unknown size or missing sheet", () => {
    expect(() => addSheet(createEmptyDesign(), "a0", "portrait")).toThrow();
    const design = addSheet(createEmptyDesign(), "letter", "portrait");
    expect(() => moveSheet(design, "sheet-999", 0, 0)).toThrow();
    expect(() => updateSheetFormat(design, "sheet-999", { orientation: "landscape" })).toThrow();
  });

  it("validateDesign flags sheets with bad geometry", () => {
    const design = addSheet(createEmptyDesign(), "letter", "portrait");
    const sheet = design.sheets[0];
    const bad = { ...design, sheets: [{ ...sheet, fitScale: 0 }] };
    expect(validateDesign(bad).length).toBeGreaterThan(0);
    expect(validateDesign(design)).toEqual([]);
  });

  it("survives a JSON save/reload round trip unchanged", () => {
    const design = addSheet(designWithWall(), "arch-d", "landscape");
    const reloaded = JSON.parse(JSON.stringify(design));
    expect(reloaded.sheets).toEqual(design.sheets);
    expect(sheetPlanBounds(reloaded.sheets[0])).toEqual(sheetPlanBounds(design.sheets[0]));
  });
});

describe("sheet grid snapping", () => {
  // Default design settings: gridIn 6, snapEnabled true.
  it("addSheet snaps an explicit anchor to the grid", () => {
    const design = addSheet(createEmptyDesign(), "letter", "portrait", { x: 5, y: 7 });
    expect(design.sheets[0].x).toBe(6);
    expect(design.sheets[0].y).toBe(6);
  });

  it("addSheet snaps the computed anchor on an empty design", () => {
    const design = addSheet(createEmptyDesign(), "tabloid", "landscape");
    // Raw 1:1 anchor would be (-8.5, -5.5); grid 6″ re-seats it.
    expect(design.sheets[0].x).toBe(-6);
    expect(design.sheets[0].y).toBe(-6);
  });

  it("moveSheet snaps the anchor to the grid", () => {
    let design = addSheet(createEmptyDesign(), "letter", "portrait");
    const id = design.sheets[0].id;
    design = moveSheet(design, id, 10, 20);
    expect(findSheet(design, id).x).toBe(12);
    expect(findSheet(design, id).y).toBe(18);
  });

  it("already-on-grid anchors are untouched", () => {
    let design = addSheet(createEmptyDesign(), "letter", "portrait", { x: 12, y: -18 });
    expect(design.sheets[0].x).toBe(12);
    expect(design.sheets[0].y).toBe(-18);
    design = moveSheet(design, design.sheets[0].id, 30, 30);
    expect(design.sheets[0].x).toBe(30);
    expect(design.sheets[0].y).toBe(30);
  });

  it("snapEnabled=false preserves raw placement on add and move", () => {
    const unsnapped = updateDesignSettings(createEmptyDesign(), { snapEnabled: false });
    let design = addSheet(unsnapped, "letter", "portrait", { x: 5, y: 7 });
    expect(design.sheets[0].x).toBe(5);
    expect(design.sheets[0].y).toBe(7);
    design = moveSheet(design, design.sheets[0].id, 10, 20);
    expect(design.sheets[0].x).toBe(10);
    expect(design.sheets[0].y).toBe(20);
  });

  it("snapping honors a custom grid spacing", () => {
    const wide = updateDesignSettings(createEmptyDesign(), { gridIn: 12 });
    const design = addSheet(wide, "letter", "portrait", { x: 14, y: 14 });
    expect(design.sheets[0].x).toBe(12);
    expect(design.sheets[0].y).toBe(12);
  });
});
