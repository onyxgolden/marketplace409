// H1/G5 — home-plan import: calibration refusals, second-check rule,
// quarter-turn registration, and fractional dimension parsing. All values
// here are hand-authored test values; none are Highland measurements.

import { describe, expect, it } from "vitest";
import {
  calibrateUnderlayScale,
  checkUnderlayScale,
  MAX_CALIBRATION_LENGTH_IN,
  normalizeUnderlayRotationDeg,
  parseDimensionInput,
  underlayBounds,
  underlayContainsPoint,
  underlayPixelForPlanPoint,
  underlayPlanPointForPixel,
  underlayRotationDeg,
  UNDERLAY_SCALE_CHECK_WARNING,
} from "./designerGeometry";

// Test underlay: 800 x 400 px at 2 px/in -> 400 x 200 plan inches, at (10, 20).
const underlayAt = (over = {}) => ({
  x: 10,
  y: 20,
  widthPx: 800,
  heightPx: 400,
  pxPerIn: 2,
  ...over,
});

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe("H1 calibration refusals", () => {
  it("refuses zero-distance points with a named error", () => {
    expect(() => calibrateUnderlayScale(underlayAt(), { x: 5, y: 5 }, { x: 5, y: 5 }, 100))
      .toThrow("Calibration points must be distinct.");
  });

  it("refuses negative, zero, and nonfinite lengths with a named error", () => {
    const u = underlayAt();
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    for (const bad of [-5, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calibrateUnderlayScale(u, a, b, bad))
        .toThrow("Calibration length must be a finite positive number.");
    }
  });

  it("refuses oversized lengths with a named error", () => {
    expect(() =>
      calibrateUnderlayScale(underlayAt(), { x: 0, y: 0 }, { x: 10, y: 0 }, MAX_CALIBRATION_LENGTH_IN + 1),
    ).toThrow("too large");
  });

  it("calibrates: 314.4375 plan inches at 2 px/in is 628.875 real inches -> 1 px/in", () => {
    // 628.875 is the H1 calibration TEST INPUT value from the scope brief,
    // used here to prove the math — not a claim about any house.
    const ppi = calibrateUnderlayScale(underlayAt(), { x: 0, y: 0 }, { x: 314.4375, y: 0 }, 628.875);
    expect(ppi).toBeCloseTo(1, 9);
  });
});

describe("H1 second-check length", () => {
  // Span of 400 plan inches at 2 px/in: the calibrated span is 400 inches.
  const span = [{ x: 10, y: 20 }, { x: 410, y: 20 }];

  it("agreement within 1% passes silent and leaves the scale untouched", () => {
    const u = underlayAt();
    const result = checkUnderlayScale(u, span[0], span[1], 404);
    expect(result.impliedLengthIn).toBeCloseTo(400, 9);
    expect(result.differencePct).toBeCloseTo(0.990099, 4);
    expect(result.exceedsTolerance).toBe(false);
    expect(result.warning).toBeNull();
    expect(u.pxPerIn).toBe(2);
  });

  it("disagreement above 1% warns with the exact string and leaves the scale untouched", () => {
    const u = underlayAt();
    const result = checkUnderlayScale(u, span[0], span[1], 396);
    expect(result.exceedsTolerance).toBe(true);
    expect(result.warning).toBe(UNDERLAY_SCALE_CHECK_WARNING);
    expect(result.warning).toBe("reference scale differs—verify measurements");
    expect(u.pxPerIn).toBe(2);
  });

  it("refuses nonfinite and oversized check lengths", () => {
    const u = underlayAt();
    expect(() => checkUnderlayScale(u, span[0], span[1], Number.NaN))
      .toThrow("Check length must be a finite positive number.");
    expect(() => checkUnderlayScale(u, span[0], span[1], MAX_CALIBRATION_LENGTH_IN + 1))
      .toThrow("too large");
  });
});

describe("H1 quarter-turn rotation", () => {
  it("legacy records and non-quarter-turn values read as 0", () => {
    expect(underlayRotationDeg({})).toBe(0);
    expect(underlayRotationDeg({ rotationDeg: 45 })).toBe(0);
    expect(underlayRotationDeg({ rotationDeg: 90 })).toBe(90);
    expect(underlayRotationDeg({ rotationDeg: 360 })).toBe(0);
  });

  it("normalize accepts quarter turns (including wraps) and refuses the rest", () => {
    expect(normalizeUnderlayRotationDeg(0)).toBe(0);
    expect(normalizeUnderlayRotationDeg(450)).toBe(90);
    expect(normalizeUnderlayRotationDeg(270)).toBe(270);
    expect(() => normalizeUnderlayRotationDeg(45)).toThrow("quarter turn");
    expect(() => normalizeUnderlayRotationDeg(30)).toThrow("quarter turn");
  });

  it("rotation 0 maps pixels exactly as the legacy formula", () => {
    const u = underlayAt();
    expect(underlayPlanPointForPixel(u, 0, 0)).toEqual({ x: 10, y: 20 });
    expect(underlayPlanPointForPixel(u, 800, 400)).toEqual({ x: 410, y: 220 });
    expect(underlayBounds(u)).toEqual({ minX: 10, minY: 20, maxX: 410, maxY: 220 });
  });

  it("rotation 90 swaps the box and rotates about the center", () => {
    const u = underlayAt({ rotationDeg: 90 });
    expect(underlayBounds(u)).toEqual({ minX: 10, minY: 20, maxX: 210, maxY: 420 });
    // Top-left image corner travels to the top-right of the rotated box.
    expect(underlayPlanPointForPixel(u, 0, 0)).toEqual({ x: 210, y: 20 });
    expect(underlayPlanPointForPixel(u, 800, 400)).toEqual({ x: 10, y: 420 });
    // Center pixel stays at the center.
    const center = underlayPlanPointForPixel(u, 400, 200);
    expect(center.x).toBeCloseTo(110, 9);
    expect(center.y).toBeCloseTo(220, 9);
  });

  it("pixel/plan mapping round-trips for every quarter turn", () => {
    for (const deg of [0, 90, 180, 270]) {
      const u = underlayAt({ rotationDeg: deg });
      for (const [px, py] of [[0, 0], [800, 0], [0, 400], [800, 400], [123, 321]]) {
        const plan = underlayPlanPointForPixel(u, px, py);
        const back = underlayPixelForPlanPoint(u, plan);
        expect(near(back.px, px)).toBe(true);
        expect(near(back.py, py)).toBe(true);
      }
    }
  });

  it("containsPoint is rotation-aware", () => {
    const u = underlayAt({ rotationDeg: 90 });
    expect(underlayContainsPoint(u, { x: 110, y: 220 })).toBe(true);
    expect(underlayContainsPoint(u, { x: 500, y: 500 })).toBe(false);
    // The unrotated box's far corner is outside the rotated box.
    expect(underlayContainsPoint(u, { x: 410, y: 220 })).toBe(false);
  });
});

describe("H1 fractional dimension parsing", () => {
  it("parses the printed overall form 52' 4 7/8\" as 628.875", () => {
    expect(parseDimensionInput("52' 4 7/8\"")).toBeCloseTo(628.875, 9);
  });

  it("parses bare and whole fractions", () => {
    expect(parseDimensionInput("7/8\"")).toBeCloseTo(0.875, 9);
    expect(parseDimensionInput("4 7/8")).toBeCloseTo(4.875, 9);
    expect(parseDimensionInput("12' 6 1/2\"")).toBeCloseTo(150.5, 9);
  });

  it("keeps every legacy form working", () => {
    expect(parseDimensionInput("12'6\"")).toBe(150);
    expect(parseDimensionInput("12' 6\"")).toBe(150);
    expect(parseDimensionInput("12.5'")).toBe(150);
    expect(parseDimensionInput("12.5 ft")).toBe(150);
    expect(parseDimensionInput("10 ft")).toBe(120);
    expect(parseDimensionInput("12'")).toBe(144);
    expect(parseDimensionInput("150\"")).toBe(150);
    expect(parseDimensionInput("150 in")).toBe(150);
    expect(parseDimensionInput("150")).toBe(150);
  });

  it("still refuses garbage and zero denominators", () => {
    expect(parseDimensionInput("abc")).toBeNaN();
    expect(parseDimensionInput("")).toBeNaN();
    expect(parseDimensionInput("4 7/0\"")).toBeNaN();
  });
});
