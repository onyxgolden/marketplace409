// pdfGeometry.test.js — matrix algebra and curve flattening.

import { describe, expect, it, vi } from "vitest";
import {
  FLATTEN_TOLERANCE_PT,
  IDENTITY_MATRIX,
  MAX_CURVE_DEPTH,
  MAX_POINTS_PER_SUBPATH,
  MAX_SEGMENTS_PER_CURVE,
  applyMatrix,
  dedupePoints,
  flattenCubic,
  flattenSubpath,
  isFiniteMatrix,
  matrixScale,
  multiplyMatrix,
  simplifyPolyline,
} from "./pdfGeometry";
import { PdfImportError } from "./pdfErrors";

describe("matrix algebra", () => {
  it("leaves points untouched under the identity", () => {
    expect(applyMatrix(IDENTITY_MATRIX, { x: 3, y: -7 })).toEqual({ x: 3, y: -7 });
  });

  it("uses the PDF [a b c d e f] convention", () => {
    // Scale 2 in x, 3 in y, then translate (10, 20).
    expect(applyMatrix([2, 0, 0, 3, 10, 20], { x: 1, y: 1 })).toEqual({ x: 12, y: 23 });
  });

  it("multiplies so that m1 is applied before m2", () => {
    const scale = [2, 0, 0, 2, 0, 0];
    const translate = [1, 0, 0, 1, 100, 0];
    // scale first, then translate: 3*2 + 100
    expect(applyMatrix(multiplyMatrix(scale, translate), { x: 3, y: 0 }).x).toBe(106);
    // translate first, then scale: (3 + 100) * 2
    expect(applyMatrix(multiplyMatrix(translate, scale), { x: 3, y: 0 }).x).toBe(206);
  });

  it("reports the uniform scale magnitude, rotation-invariant", () => {
    expect(matrixScale([3, 0, 0, 3, 0, 0])).toBeCloseTo(3, 12);
    expect(matrixScale([2, 0, 0, 8, 0, 0])).toBeCloseTo(4, 12); // geometric mean
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    expect(matrixScale([2 * c, 2 * s, -2 * s, 2 * c, 0, 0])).toBeCloseTo(2, 12);
    // A mirrored matrix has a negative determinant but a positive scale.
    expect(matrixScale([1, 0, 0, -1, 0, 0])).toBeCloseTo(1, 12);
  });

  it("rejects malformed matrices", () => {
    expect(isFiniteMatrix([1, 0, 0, 1, 0, 0])).toBe(true);
    expect(isFiniteMatrix([1, 0, 0, 1, 0])).toBe(false);
    expect(isFiniteMatrix([1, 0, 0, 1, 0, NaN])).toBe(false);
    expect(isFiniteMatrix(null)).toBe(false);
  });
});

describe("dedupePoints", () => {
  it("drops consecutive duplicates but keeps a later revisit", () => {
    const points = [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 },
    ];
    expect(dedupePoints(points)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }]);
  });
});

describe("simplifyPolyline", () => {
  it("collapses a collinear run to its endpoints", () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    expect(simplifyPolyline(line, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }]);
  });

  it("keeps a corner that exceeds the tolerance", () => {
    const line = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    expect(simplifyPolyline(line, 0.1)).toHaveLength(3);
  });

  it("discards a deviation within tolerance", () => {
    const line = [{ x: 0, y: 0 }, { x: 5, y: 0.05 }, { x: 10, y: 0 }];
    expect(simplifyPolyline(line, 0.5)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it("always keeps both endpoints", () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const simplified = simplifyPolyline(line, 1000);
    expect(simplified).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }]);
  });

  it("passes short polylines and bad tolerances through unchanged", () => {
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyPolyline(two, 1)).toEqual(two);
    expect(simplifyPolyline(two, 0)).toEqual(two);
    expect(simplifyPolyline(null, 1)).toEqual([]);
  });

  it("handles a long polyline without blowing the call stack", () => {
    const many = Array.from({ length: 50000 }, (_, i) => ({ x: i, y: i % 2 ? 0.001 : 0 }));
    expect(() => simplifyPolyline(many, 0.5)).not.toThrow();
    expect(simplifyPolyline(many, 0.5)).toHaveLength(2);
  });
});

describe("flattenSubpath", () => {
  const lineSubpath = {
    ops: [{ op: "move", x: 0, y: 0 }, { op: "line", x: 10, y: 0 }],
    closed: false,
  };

  it("transforms points before returning them", () => {
    const flat = flattenSubpath(lineSubpath, [2, 0, 0, 2, 5, 5]);
    expect(flat.points).toEqual([{ x: 5, y: 5 }, { x: 25, y: 5 }]);
    expect(flat.closed).toBe(false);
  });

  it("flattens a cubic into chords within tolerance of the true curve", () => {
    // Symmetric cubic from (0,0) to (100,0) bulging to y = 75 at t = 0.5.
    const flat = flattenSubpath(
      {
        ops: [
          { op: "move", x: 0, y: 0 },
          { op: "cubic", x1: 0, y1: 100, x2: 100, y2: 100, x: 100, y: 0 },
        ],
        closed: false,
      },
      IDENTITY_MATRIX,
    );
    expect(flat.points.length).toBeGreaterThan(4);
    expect(flat.points[0]).toEqual({ x: 0, y: 0 });
    expect(flat.points[flat.points.length - 1]).toEqual({ x: 100, y: 0 });
    // Apex of this cubic is at 3/4 of the control height.
    const apex = Math.max(...flat.points.map((p) => p.y));
    expect(apex).toBeGreaterThan(75 - FLATTEN_TOLERANCE_PT);
    expect(apex).toBeLessThanOrEqual(75 + 1e-9);
  });

  it("flattens a straight cubic into a single chord", () => {
    const flat = flattenSubpath(
      {
        ops: [
          { op: "move", x: 0, y: 0 },
          { op: "cubic", x1: 10, y1: 0, x2: 20, y2: 0, x: 30, y: 0 },
        ],
        closed: false,
      },
      IDENTITY_MATRIX,
    );
    expect(flat.points).toEqual([{ x: 0, y: 0 }, { x: 30, y: 0 }]);
  });

  it("converts a quadratic through the equivalent cubic", () => {
    const flat = flattenSubpath(
      {
        ops: [
          { op: "move", x: 0, y: 0 },
          { op: "quadratic", x1: 50, y1: 100, x: 100, y: 0 },
        ],
        closed: false,
      },
      IDENTITY_MATRIX,
    );
    // A quadratic's apex is half the control height.
    const apex = Math.max(...flat.points.map((p) => p.y));
    expect(apex).toBeCloseTo(50, 0);
    expect(flat.points[flat.points.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it("flattens in the transformed space, so a scaled-up curve gains detail", () => {
    const curve = {
      ops: [
        { op: "move", x: 0, y: 0 },
        { op: "cubic", x1: 0, y1: 10, x2: 10, y2: 10, x: 10, y: 0 },
      ],
      closed: false,
    };
    const small = flattenSubpath(curve, IDENTITY_MATRIX);
    const large = flattenSubpath(curve, [50, 0, 0, 50, 0, 0]);
    expect(large.points.length).toBeGreaterThan(small.points.length);
  });

  it("drops a closing duplicate point and reports closure as a flag", () => {
    const flat = flattenSubpath(
      {
        ops: [
          { op: "move", x: 0, y: 0 },
          { op: "line", x: 10, y: 0 },
          { op: "line", x: 10, y: 10 },
          { op: "line", x: 0, y: 0 },
        ],
        closed: true,
      },
      IDENTITY_MATRIX,
    );
    expect(flat.closed).toBe(true);
    expect(flat.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  });

  it("keeps an explicitly closed subpath closed without a duplicate point", () => {
    const flat = flattenSubpath(
      {
        ops: [
          { op: "move", x: 0, y: 0 },
          { op: "line", x: 10, y: 0 },
          { op: "line", x: 10, y: 10 },
        ],
        closed: true,
      },
      IDENTITY_MATRIX,
    );
    expect(flat.closed).toBe(true);
    expect(flat.points).toHaveLength(3);
  });

  it("returns null when nothing drawable survives", () => {
    expect(flattenSubpath({ ops: [], closed: false }, IDENTITY_MATRIX)).toBeNull();
    expect(
      flattenSubpath({ ops: [{ op: "move", x: NaN, y: 0 }], closed: false }, IDENTITY_MATRIX),
    ).toBeNull();
  });

  it("drops non-finite points and warns", () => {
    const onWarning = vi.fn();
    const flat = flattenSubpath(
      {
        ops: [
          { op: "move", x: 0, y: 0 },
          { op: "line", x: Infinity, y: 0 },
          { op: "line", x: 10, y: 0 },
        ],
        closed: false,
      },
      IDENTITY_MATRIX,
      { onWarning },
    );
    expect(flat.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("non-finite"));
  });

  it("flattens a huge but smooth curve without exceeding the segment budget", () => {
    const onWarning = vi.fn();
    // A quarter-circle cubic of radius 1e6 needs thousands of chords to meet
    // the tolerance, so it must hit the cap — and the cap must BOUND the work,
    // not merely stop counting it.
    const R = 1e6;
    const k = 0.5523 * R;
    const flat = flattenSubpath(
      {
        ops: [
          { op: "move", x: 0, y: 0 },
          { op: "cubic", x1: 0, y1: k, x2: R - k, y2: R, x: R, y: R },
        ],
        closed: false,
      },
      IDENTITY_MATRIX,
      { onWarning },
    );
    // Budget + the unwinding leaves it produces, never an exponential tree.
    expect(flat.points.length).toBeLessThanOrEqual(MAX_SEGMENTS_PER_CURVE * 2);
    expect(flat.points.length).toBeGreaterThan(MAX_SEGMENTS_PER_CURVE);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("segment cap"));
  });

  it("does not over-tessellate a curve that is already flat at this scale", () => {
    // A big symmetric S-curve is genuinely well approximated by a few long
    // chords: adaptive flattening must not spend the whole budget on it.
    const flat = flattenSubpath(
      {
        ops: [
          { op: "move", x: 0, y: 0 },
          { op: "cubic", x1: 1e6, y1: 1e6, x2: -1e6, y2: -1e6, x: 1, y: 0 },
        ],
        closed: false,
      },
      IDENTITY_MATRIX,
    );
    expect(flat.points.length).toBeLessThan(8);
  });

  it("keeps a subdivision-bound curve's work proportional to the budget", () => {
    const budget = { count: 0, max: MAX_SEGMENTS_PER_CURVE, capped: false };
    const out = [];
    const R = 1e6;
    const k = 0.5523 * R;
    flattenCubic(
      { x: 0, y: 0 }, { x: 0, y: k }, { x: R - k, y: R }, { x: R, y: R },
      0.72, out, budget,
    );
    expect(budget.capped).toBe(true);
    expect(budget.count).toBeLessThanOrEqual(MAX_SEGMENTS_PER_CURVE + MAX_CURVE_DEPTH);
  });

  it("refuses a subpath that exceeds the flattened-point cap", () => {
    const ops = [{ op: "move", x: 0, y: 0 }];
    for (let i = 0; i < MAX_POINTS_PER_SUBPATH + 10; i += 1) {
      ops.push({ op: "line", x: i + 1, y: (i % 2) * 5 });
    }
    expect(() => flattenSubpath({ ops, closed: false }, IDENTITY_MATRIX)).toThrow(PdfImportError);
    expect(() => flattenSubpath({ ops, closed: false }, IDENTITY_MATRIX)).toThrow(/pathological/);
  });
});
