// pdfScale.test.js — the scale math that makes an import true to scale.
//
// A PDF knows its paper size but not its plot scale, so everything here is
// about turning "one paper inch" into "N real inches" and applying that
// without moving the drawing off its anchor.

import { describe, expect, it } from "vitest";
import {
  MAX_SCALE_FACTOR,
  MIN_SCALE_FACTOR,
  PLOT_SCALE_PRESETS,
  UNCALIBRATED_FACTOR,
  applyScaleToPolylines,
  assertUsableFactor,
  describeScale,
  findPlotScalePreset,
  longestStraightRun,
  scaleFromKnownDistance,
  scaleFromTwoPoints,
} from "./pdfScale";

describe("plot scale presets", () => {
  it('maps 1/4" = 1\'-0" to 48 real inches per paper inch', () => {
    expect(findPlotScalePreset("arch-1-4").factor).toBe(48);
  });

  it("maps every architectural preset to the scale its label claims", () => {
    // paperInchesPerFoot × factor must always be 12 inches of real length.
    const cases = [
      ["arch-1-4", 0.25], ["arch-1-8", 0.125], ["arch-3-16", 0.1875],
      ["arch-1-2", 0.5], ["arch-3-4", 0.75], ["arch-1-16", 0.0625], ["arch-1-in", 1],
    ];
    for (const [id, paperInchesPerFoot] of cases) {
      const preset = findPlotScalePreset(id);
      expect(paperInchesPerFoot * preset.factor, id).toBeCloseTo(12, 9);
    }
  });

  it('maps engineering scales: 1" = 20\' is 240 inches per paper inch', () => {
    expect(findPlotScalePreset("eng-1-20").factor).toBe(240);
    expect(findPlotScalePreset("eng-1-30").factor).toBe(360);
  });

  it("maps metric ratios directly", () => {
    expect(findPlotScalePreset("metric-1-50").factor).toBe(50);
    expect(findPlotScalePreset("metric-1-100").factor).toBe(100);
  });

  it("treats full size as the uncalibrated identity", () => {
    expect(findPlotScalePreset("full").factor).toBe(UNCALIBRATED_FACTOR);
  });

  it("has unique ids and only positive factors", () => {
    const ids = PLOT_SCALE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of PLOT_SCALE_PRESETS) {
      expect(preset.factor, preset.id).toBeGreaterThan(0);
      expect(preset.label.length, preset.id).toBeGreaterThan(0);
    }
  });

  it("returns null for an unknown preset id", () => {
    expect(findPlotScalePreset("nope")).toBeNull();
    expect(findPlotScalePreset(undefined)).toBeNull();
  });
});

describe("scaleFromKnownDistance", () => {
  it("derives the factor from a measured and a real distance", () => {
    // A wall 2.5 paper inches long that is really 10 feet → 48×.
    expect(scaleFromKnownDistance(2.5, 120)).toBe(48);
  });

  it("returns 1 when the measurement already matches reality", () => {
    expect(scaleFromKnownDistance(36, 36)).toBe(1);
  });

  it("rejects non-positive or non-finite inputs", () => {
    expect(() => scaleFromKnownDistance(0, 120)).toThrow(/positive/);
    expect(() => scaleFromKnownDistance(-1, 120)).toThrow(/positive/);
    expect(() => scaleFromKnownDistance(NaN, 120)).toThrow(/positive/);
    expect(() => scaleFromKnownDistance(2.5, 0)).toThrow(/positive/);
    expect(() => scaleFromKnownDistance(2.5, -120)).toThrow(/positive/);
  });
});

describe("scaleFromTwoPoints", () => {
  it("measures between two points and scales to the real distance", () => {
    // 3-4-5 triangle: a 5-inch paper span that is really 20 feet → 48×.
    expect(scaleFromTwoPoints({ x: 0, y: 0 }, { x: 3, y: 4 }, 240)).toBe(48);
  });

  it("mirrors the underlay calibrator's rejections", () => {
    expect(() => scaleFromTwoPoints({ x: 1, y: 1 }, { x: 1, y: 1 }, 120)).toThrow(/distinct/);
    expect(() => scaleFromTwoPoints(null, { x: 1, y: 1 }, 120)).toThrow(/valid/);
    expect(() => scaleFromTwoPoints({ x: 0, y: 0 }, { x: NaN, y: 1 }, 120)).toThrow(/valid/);
    expect(() => scaleFromTwoPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toThrow(/positive/);
  });
});

describe("assertUsableFactor", () => {
  it("accepts factors inside the supported range", () => {
    expect(assertUsableFactor(48)).toBe(48);
    expect(assertUsableFactor(MIN_SCALE_FACTOR)).toBe(MIN_SCALE_FACTOR);
    expect(assertUsableFactor(MAX_SCALE_FACTOR)).toBe(MAX_SCALE_FACTOR);
  });

  it("refuses factors that would produce an absurd plan", () => {
    expect(() => assertUsableFactor(MAX_SCALE_FACTOR * 2)).toThrow(/range/);
    expect(() => assertUsableFactor(MIN_SCALE_FACTOR / 2)).toThrow(/range/);
    expect(() => assertUsableFactor(0)).toThrow(/positive/);
    expect(() => assertUsableFactor(-1)).toThrow(/positive/);
    expect(() => assertUsableFactor(NaN)).toThrow(/positive/);
  });
});

describe("applyScaleToPolylines", () => {
  const line = [{ points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] }];

  it("scales about the origin by default", () => {
    expect(applyScaleToPolylines(line, 12)[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 12, y: 24 },
    ]);
  });

  it("holds the anchor point fixed, like the underlay calibrator does", () => {
    const anchor = { x: 1, y: 2 };
    const scaled = applyScaleToPolylines(line, 48, anchor)[0].points;
    // The anchor is one of the points, so it must not move at all.
    expect(scaled[1]).toEqual({ x: 1, y: 2 });
    expect(scaled[0]).toEqual({ x: 1 - 48, y: 2 - 96 });
  });

  it("preserves relative geometry: lengths scale by exactly the factor", () => {
    const before = Math.hypot(1, 2);
    const scaled = applyScaleToPolylines(line, 37.5, { x: 5, y: -3 })[0].points;
    const after = Math.hypot(scaled[1].x - scaled[0].x, scaled[1].y - scaled[0].y);
    expect(after / before).toBeCloseTo(37.5, 9);
  });

  it("keeps the closed flag and other polyline fields", () => {
    const closed = [{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: true }];
    expect(applyScaleToPolylines(closed, 2)[0].closed).toBe(true);
  });

  it("accepts and returns bare point arrays too", () => {
    expect(applyScaleToPolylines([[{ x: 1, y: 1 }]], 3)).toEqual([[{ x: 3, y: 3 }]]);
  });

  it("never mutates or aliases the input, even at factor 1", () => {
    const input = [{ points: [{ x: 1, y: 1 }] }];
    const out = applyScaleToPolylines(input, 1);
    expect(out).toEqual(input);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0].points[0]).not.toBe(input[0].points[0]);
    out[0].points[0].x = 99;
    expect(input[0].points[0].x).toBe(1);
  });

  it("rejects a bad factor or anchor", () => {
    expect(() => applyScaleToPolylines(line, 0)).toThrow(/positive/);
    expect(() => applyScaleToPolylines(line, 2, { x: NaN, y: 0 })).toThrow(/anchor/);
  });

  it("handles an empty or missing list", () => {
    expect(applyScaleToPolylines([], 2)).toEqual([]);
    expect(applyScaleToPolylines(null, 2)).toEqual([]);
  });
});

describe("describeScale", () => {
  it("names a known plot scale", () => {
    expect(describeScale(48)).toBe('1/4" = 1\'-0"');
    expect(describeScale(100)).toBe("1:100");
  });

  it("says plainly when nothing was scaled", () => {
    expect(describeScale(1)).toBe("Full size (1:1)");
  });

  it("falls back to a ratio for an arbitrary calibrated factor", () => {
    expect(describeScale(37.5)).toBe("1:37.5");
  });

  it("does not pretend to know a bad factor", () => {
    expect(describeScale(0)).toBe("unknown scale");
    expect(describeScale(NaN)).toBe("unknown scale");
  });
});

describe("longestStraightRun", () => {
  it("finds the longest single segment across all polylines", () => {
    const run = longestStraightRun([
      { points: [{ x: 0, y: 0 }, { x: 3, y: 0 }] },
      { points: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 4, y: 10 }] },
    ]);
    expect(run.lengthIn).toBe(10);
    expect(run.a).toEqual({ x: 0, y: 0 });
    expect(run.b).toEqual({ x: 0, y: 10 });
  });

  it("returns null when there is no segment to measure", () => {
    expect(longestStraightRun([])).toBeNull();
    expect(longestStraightRun([{ points: [{ x: 1, y: 1 }] }])).toBeNull();
    expect(longestStraightRun(null)).toBeNull();
  });

  it("skips non-finite points", () => {
    const run = longestStraightRun([{ points: [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 2, y: 0 }] }]);
    expect(run).toBeNull();
  });

  it("copies its points so callers cannot mutate the source geometry", () => {
    const source = [{ points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] }];
    const run = longestStraightRun(source);
    run.a.x = 99;
    expect(source[0].points[0].x).toBe(0);
  });
});
