import { describe, expect, it } from "vitest";
import {
  WCAG_AA_LARGE_TEXT_RATIO, WCAG_AA_NORMAL_TEXT_RATIO, contrastRatio, isLargeText, parseComputedRgb, relativeLuminance,
} from "../contrastMath.mjs";

describe("relativeLuminance", () => {
  it("is 1 for pure white and 0 for pure black", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white (the maximum possible ratio)", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
  });

  it("is 1:1 for identical colors", () => {
    expect(contrastRatio({ r: 128, g: 128, b: 128 }, { r: 128, g: 128, b: 128 })).toBeCloseTo(1, 5);
  });

  it("is symmetric regardless of argument order", () => {
    const a = { r: 30, g: 60, b: 90 };
    const b = { r: 200, g: 210, b: 220 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("fails a real light-gray-on-white pairing against the WCAG AA normal-text threshold", () => {
    // #cccccc on white is a well-known real-world "looks fine, fails WCAG" pairing (~1.6:1).
    expect(contrastRatio({ r: 204, g: 204, b: 204 }, { r: 255, g: 255, b: 255 })).toBeLessThan(WCAG_AA_NORMAL_TEXT_RATIO);
  });

  it("passes a real dark-gray-on-white pairing", () => {
    expect(contrastRatio({ r: 51, g: 51, b: 51 }, { r: 255, g: 255, b: 255 })).toBeGreaterThan(WCAG_AA_NORMAL_TEXT_RATIO);
  });
});

describe("isLargeText", () => {
  it("treats 24px+ as large regardless of weight", () => {
    expect(isLargeText({ fontSizePx: 24, fontWeight: "400" })).toBe(true);
    expect(isLargeText({ fontSizePx: 30, fontWeight: "400" })).toBe(true);
  });

  it("treats 18.66px+ bold as large but not 18.66px regular", () => {
    expect(isLargeText({ fontSizePx: 19, fontWeight: "700" })).toBe(true);
    expect(isLargeText({ fontSizePx: 19, fontWeight: "400" })).toBe(false);
  });

  it("treats ordinary body text as not large", () => {
    expect(isLargeText({ fontSizePx: 14, fontWeight: "400" })).toBe(false);
  });

  it("the large-text threshold is a lower ratio bar than normal text (WCAG's own relationship)", () => {
    expect(WCAG_AA_LARGE_TEXT_RATIO).toBeLessThan(WCAG_AA_NORMAL_TEXT_RATIO);
  });
});

describe("parseComputedRgb", () => {
  it("parses rgb()", () => {
    expect(parseComputedRgb("rgb(255, 0, 128)")).toEqual({ r: 255, g: 0, b: 128 });
  });

  it("parses rgba() with nonzero alpha, ignoring alpha", () => {
    expect(parseComputedRgb("rgba(10, 20, 30, 0.87)")).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("returns null for fully transparent rgba", () => {
    expect(parseComputedRgb("rgba(0, 0, 0, 0)")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(parseComputedRgb("transparent")).toBeNull();
    expect(parseComputedRgb("")).toBeNull();
    expect(parseComputedRgb(undefined)).toBeNull();
  });
});
