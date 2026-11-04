import { describe, it, expect } from "vitest";
import {
  validateDrawingInput,
  validateTakeoffLineInput,
  computeShopFieldEstimates,
  computeFwFfwSuggestions,
  computePidTakeoffSummary,
  DRAWING_TYPES,
  TAKEOFF_CATEGORIES,
  FAB_LOCATIONS,
} from "./takeoff.js";

function line(overrides = {}) {
  return {
    drawingId: "dwg_1",
    lineNo: 1,
    description: "6in CS pipe",
    quantity: 40,
    unit: "ft",
    category: "pipe",
    fabLocation: "shop",
    fieldWeldCount: 0,
    requiresFieldFit: false,
    ...overrides,
  };
}

describe("validateDrawingInput", () => {
  it("accepts a valid p_id drawing with no pIdDrawingId", () => {
    const result = validateDrawingInput({
      packageId: "pkg_1", drawingNumber: "P-101", drawingType: "p_id",
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("accepts a valid isometric with pIdDrawingId set", () => {
    const result = validateDrawingInput({
      packageId: "pkg_1", drawingNumber: "ISO-001", drawingType: "isometric", pIdDrawingId: "dwg_pid1",
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("rejects a p_id drawing that sets pIdDrawingId", () => {
    const result = validateDrawingInput({
      packageId: "pkg_1", drawingNumber: "P-101", drawingType: "p_id", pIdDrawingId: "dwg_pid1",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("rolls up to itself"))).toBe(true);
  });

  it("rejects a cut_sheet/isometric missing pIdDrawingId", () => {
    const result = validateDrawingInput({
      packageId: "pkg_1", drawingNumber: "CS-001", drawingType: "cut_sheet",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("pIdDrawingId is required"))).toBe(true);
  });

  it("rejects a missing packageId, drawingNumber, and an invalid drawingType all at once", () => {
    const result = validateDrawingInput({});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("packageId is required.");
    expect(result.errors).toContain("drawingNumber is required.");
    expect(result.errors.some((e) => e.startsWith("drawingType must be one of"))).toBe(true);
  });

  it("DRAWING_TYPES is exactly the three slice-1 kinds", () => {
    expect(DRAWING_TYPES).toEqual(["p_id", "cut_sheet", "isometric"]);
  });
});

describe("validateTakeoffLineInput", () => {
  it("accepts a fully valid line", () => {
    expect(validateTakeoffLineInput(line())).toEqual({ ok: true, errors: [] });
  });

  it("rejects a non-positive quantity", () => {
    const result = validateTakeoffLineInput(line({ quantity: 0 }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("quantity must be a positive number.");
  });

  it("rejects a negative quantity", () => {
    expect(validateTakeoffLineInput(line({ quantity: -5 })).ok).toBe(false);
  });

  it("rejects an invalid category", () => {
    const result = validateTakeoffLineInput(line({ category: "pasta" }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith("category must be one of"))).toBe(true);
  });

  it("rejects an invalid fabLocation", () => {
    const result = validateTakeoffLineInput(line({ fabLocation: "moon" }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith("fabLocation must be one of"))).toBe(true);
  });

  it("rejects a non-empty-string description", () => {
    expect(validateTakeoffLineInput(line({ description: "   " })).ok).toBe(false);
    expect(validateTakeoffLineInput(line({ description: "" })).ok).toBe(false);
  });

  it("rejects a fractional or negative fieldWeldCount", () => {
    expect(validateTakeoffLineInput(line({ fieldWeldCount: 1.5 })).ok).toBe(false);
    expect(validateTakeoffLineInput(line({ fieldWeldCount: -1 })).ok).toBe(false);
  });

  it("rejects a non-boolean requiresFieldFit", () => {
    expect(validateTakeoffLineInput(line({ requiresFieldFit: "yes" })).ok).toBe(false);
  });

  it("allows fieldWeldCount/requiresFieldFit to be omitted (honest default, not inferred)", () => {
    const input = line();
    delete input.fieldWeldCount;
    delete input.requiresFieldFit;
    expect(validateTakeoffLineInput(input)).toEqual({ ok: true, errors: [] });
  });

  it("TAKEOFF_CATEGORIES and FAB_LOCATIONS are the documented vocabularies", () => {
    expect(TAKEOFF_CATEGORIES).toEqual(["pipe", "fitting", "valve", "support", "other"]);
    expect(FAB_LOCATIONS).toEqual(["shop", "field"]);
  });
});

describe("computeShopFieldEstimates", () => {
  it("splits lines into independent shop and field quantity breakdowns", () => {
    const lines = [
      line({ lineNo: 1, fabLocation: "shop", category: "pipe", quantity: 40, unit: "ft" }),
      line({ lineNo: 2, fabLocation: "shop", category: "fitting", quantity: 6, unit: "ea" }),
      line({ lineNo: 3, fabLocation: "field", category: "pipe", quantity: 10, unit: "ft" }),
    ];
    const result = computeShopFieldEstimates(lines);
    expect(result.shop.lineCount).toBe(2);
    expect(result.shop.totalQuantityByUnit).toEqual({ ft: 40, ea: 6 });
    expect(result.shop.byCategory.pipe.totalQuantityByUnit).toEqual({ ft: 40 });
    expect(result.shop.byCategory.fitting.totalQuantityByUnit).toEqual({ ea: 6 });
    expect(result.field.lineCount).toBe(1);
    expect(result.field.totalQuantityByUnit).toEqual({ ft: 10 });
    // Shop and field are independent totals, never blended into one number.
    expect(result.shop.totalQuantityByUnit.ft).not.toBe(result.field.totalQuantityByUnit.ft);
  });

  it("sums same-unit quantities within one category correctly", () => {
    const lines = [
      line({ lineNo: 1, category: "pipe", quantity: 10, unit: "ft", fabLocation: "shop" }),
      line({ lineNo: 2, category: "pipe", quantity: 15, unit: "ft", fabLocation: "shop" }),
    ];
    const result = computeShopFieldEstimates(lines);
    expect(result.shop.byCategory.pipe.totalQuantityByUnit.ft).toBe(25);
    expect(result.shop.byCategory.pipe.lineCount).toBe(2);
  });

  it("an empty line set produces empty-but-well-shaped estimates, not an error", () => {
    const result = computeShopFieldEstimates([]);
    expect(result.shop).toEqual({ lineCount: 0, totalQuantityByUnit: {}, byCategory: {} });
    expect(result.field).toEqual({ lineCount: 0, totalQuantityByUnit: {}, byCategory: {} });
  });

  it("an all-shop line set produces a zero field estimate (not omitted, not null)", () => {
    const result = computeShopFieldEstimates([line({ fabLocation: "shop" })]);
    expect(result.field).toEqual({ lineCount: 0, totalQuantityByUnit: {}, byCategory: {} });
  });
});

describe("computeFwFfwSuggestions", () => {
  it("sums declared field-weld counts across lines", () => {
    const lines = [
      line({ lineNo: 1, fieldWeldCount: 2 }),
      line({ lineNo: 2, fieldWeldCount: 3 }),
      line({ lineNo: 3, fieldWeldCount: 0 }),
    ];
    expect(computeFwFfwSuggestions(lines).suggestedFieldWelds).toBe(5);
  });

  it("counts FFW lines and names each one — never a bare count with no traceability", () => {
    const lines = [
      line({ lineNo: 1, requiresFieldFit: true, description: "random, verify in field" }),
      line({ lineNo: 2, requiresFieldFit: false }),
      line({ lineNo: 3, requiresFieldFit: true, description: "another random" }),
    ];
    const result = computeFwFfwSuggestions(lines);
    expect(result.suggestedFfwCount).toBe(2);
    expect(result.ffwLines).toEqual([
      { drawingId: "dwg_1", lineNo: 1, description: "random, verify in field" },
      { drawingId: "dwg_1", lineNo: 3, description: "another random" },
    ]);
  });

  it("an FFW suggestion never includes a cut length — a random is not a fixed length", () => {
    const result = computeFwFfwSuggestions([line({ requiresFieldFit: true })]);
    expect(result.ffwLines[0]).not.toHaveProperty("cutLength");
    expect(result.ffwLines[0]).not.toHaveProperty("length");
  });

  it("no declared inputs produces zero suggestions, not a guess", () => {
    const result = computeFwFfwSuggestions([line(), line({ lineNo: 2 })]);
    expect(result.suggestedFieldWelds).toBe(0);
    expect(result.suggestedFfwCount).toBe(0);
    expect(result.ffwLines).toEqual([]);
  });
});

describe("computePidTakeoffSummary", () => {
  it("combines totals, shop/field split, and FW/FFW into one summary for a P&ID", () => {
    const lines = [
      line({ lineNo: 1, drawingId: "dwg_pid1", fabLocation: "shop", quantity: 40, unit: "ft", fieldWeldCount: 1 }),
      line({ lineNo: 1, drawingId: "dwg_iso1", fabLocation: "field", quantity: 10, unit: "ft", requiresFieldFit: true, description: "random" }),
    ];
    const summary = computePidTakeoffSummary({ pIdDrawingId: "dwg_pid1", lines });
    expect(summary.pIdDrawingId).toBe("dwg_pid1");
    expect(summary.totals.lineCount).toBe(2);
    expect(summary.totals.totalQuantityByUnit.ft).toBe(50);
    expect(summary.shopFieldSplit.shop.totalQuantityByUnit.ft).toBe(40);
    expect(summary.shopFieldSplit.field.totalQuantityByUnit.ft).toBe(10);
    expect(summary.fwFfw.suggestedFieldWelds).toBe(1);
    expect(summary.fwFfw.suggestedFfwCount).toBe(1);
    expect(summary.fwFfw.ffwLines[0].drawingId).toBe("dwg_iso1");
  });

  it("throws on a missing pIdDrawingId rather than silently summarizing nothing", () => {
    expect(() => computePidTakeoffSummary({ lines: [] })).toThrow(TypeError);
  });

  it("a P&ID with zero takeoff lines yet produces an honest empty summary, not an error", () => {
    const summary = computePidTakeoffSummary({ pIdDrawingId: "dwg_pid1", lines: [] });
    expect(summary.totals.lineCount).toBe(0);
    expect(summary.fwFfw.suggestedFieldWelds).toBe(0);
  });
});
