// pdfCoordinates.test.js — the single coordinate boundary.
//
// The expected matrices below are a PINNED ORACLE: they were captured from
// pdfjs-dist 5.7's own `page.getViewport({ scale: 1/72 }).transform` for real
// PDFs built with these page boxes and /Rotate values. The importer's vector
// path and its raster path must land in the same place at the same size, and
// that only holds while this pure matrix equals pdf.js's viewport transform.
// If a pdf.js upgrade changes the viewport algebra, these tests fail — which
// is the point.

import { describe, expect, it } from "vitest";
import {
  PDF_POINTS_PER_INCH,
  designerBounds,
  designerPageSize,
  pageToDesignerMatrix,
  roundDesignerPoint,
} from "./pdfCoordinates";
import { applyMatrix } from "./pdfGeometry";

const S = 1 / 72; // inches per point

/** [viewBox, rotation, expected transform, expected size] from real pdf.js. */
const PDFJS_ORACLE = [
  { viewBox: [0, 0, 612, 792], rotation: 0, transform: [S, 0, 0, -S, 0, 11], size: [8.5, 11] },
  { viewBox: [0, 0, 612, 792], rotation: 90, transform: [0, S, S, 0, 0, 0], size: [11, 8.5] },
  { viewBox: [0, 0, 612, 792], rotation: 180, transform: [-S, 0, 0, S, 8.5, 0], size: [8.5, 11] },
  { viewBox: [0, 0, 612, 792], rotation: 270, transform: [0, -S, -S, 0, 11, 8.5], size: [11, 8.5] },
  {
    viewBox: [20, 30, 632, 822],
    rotation: 0,
    transform: [S, 0, 0, -S, -20 / 72, 822 / 72],
    size: [8.5, 11],
  },
  {
    viewBox: [20, 30, 632, 822],
    rotation: 90,
    transform: [0, S, S, 0, -30 / 72, -20 / 72],
    size: [11, 8.5],
  },
  { viewBox: [0, 0, 1224, 792], rotation: 270, transform: [0, -S, -S, 0, 11, 17], size: [11, 17] },
];

describe("pageToDesignerMatrix", () => {
  it("matches pdf.js's viewport transform for every page rotation", () => {
    for (const oracle of PDFJS_ORACLE) {
      const m = pageToDesignerMatrix({ viewBox: oracle.viewBox, rotation: oracle.rotation });
      m.forEach((value, i) => {
        expect(value, `rotation ${oracle.rotation} term ${i}`).toBeCloseTo(oracle.transform[i], 12);
      });
    }
  });

  it("matches pdf.js's page size (post-rotation) for every rotation", () => {
    for (const oracle of PDFJS_ORACLE) {
      const size = designerPageSize({ viewBox: oracle.viewBox, rotation: oracle.rotation });
      expect(size.widthIn).toBeCloseTo(oracle.size[0], 9);
      expect(size.heightIn).toBeCloseTo(oracle.size[1], 9);
    }
  });

  it("puts the PDF origin (bottom-left, Y-up) at the Designer top-left corner", () => {
    const m = pageToDesignerMatrix({ viewBox: [0, 0, 612, 792] });
    // PDF (0,0) is the bottom-left, which is 11 inches DOWN in Designer space.
    expect(roundDesignerPoint(applyMatrix(m, { x: 0, y: 0 }))).toEqual({ x: 0, y: 11 });
    // PDF top-left corner → Designer origin.
    expect(roundDesignerPoint(applyMatrix(m, { x: 0, y: 792 }))).toEqual({ x: 0, y: 0 });
    // PDF top-right → 8.5 inches across, still at the top.
    expect(roundDesignerPoint(applyMatrix(m, { x: 612, y: 792 }))).toEqual({ x: 8.5, y: 0 });
  });

  it("converts 72 points to exactly one inch", () => {
    const m = pageToDesignerMatrix({ viewBox: [0, 0, 612, 792] });
    const a = applyMatrix(m, { x: 0, y: 792 });
    const b = applyMatrix(m, { x: PDF_POINTS_PER_INCH, y: 792 });
    expect(b.x - a.x).toBeCloseTo(1, 12);
  });

  it("honours /UserUnit", () => {
    const m = pageToDesignerMatrix({ viewBox: [0, 0, 612, 792], userUnit: 2 });
    const a = applyMatrix(m, { x: 0, y: 792 });
    const b = applyMatrix(m, { x: 72, y: 792 });
    expect(b.x - a.x).toBeCloseTo(2, 12);
  });

  it("shifts a CropBox whose origin is not zero so page content stays registered", () => {
    const m = pageToDesignerMatrix({ viewBox: [20, 30, 632, 822] });
    // The box's own top-left corner maps to the Designer origin.
    expect(roundDesignerPoint(applyMatrix(m, { x: 20, y: 822 }))).toEqual({ x: 0, y: 0 });
  });

  it("treats a damaged or missing page box as US Letter instead of poisoning coordinates", () => {
    for (const bad of [null, undefined, [], [0, 0, 612], [0, 0, NaN, 792]]) {
      const size = designerPageSize({ viewBox: bad });
      expect(size).toEqual({ widthIn: 8.5, heightIn: 11 });
    }
  });

  it("accepts page box corners given in either order", () => {
    expect(designerPageSize({ viewBox: [612, 792, 0, 0] })).toEqual({ widthIn: 8.5, heightIn: 11 });
  });

  it("treats a non-multiple-of-90 rotation as upright rather than throwing", () => {
    // pdf.js itself throws here; the importer must degrade instead.
    expect(() => pageToDesignerMatrix({ viewBox: [0, 0, 612, 792], rotation: 45 })).not.toThrow();
    expect(designerPageSize({ viewBox: [0, 0, 612, 792], rotation: 45 })).toEqual({
      widthIn: 8.5,
      heightIn: 11,
    });
  });

  it("normalizes negative and over-360 rotations", () => {
    const negative = pageToDesignerMatrix({ viewBox: [0, 0, 612, 792], rotation: -90 });
    const positive = pageToDesignerMatrix({ viewBox: [0, 0, 612, 792], rotation: 270 });
    expect(negative).toEqual(positive);
    const wrapped = pageToDesignerMatrix({ viewBox: [0, 0, 612, 792], rotation: 450 });
    expect(wrapped).toEqual(pageToDesignerMatrix({ viewBox: [0, 0, 612, 792], rotation: 90 }));
  });
});

describe("designerBounds", () => {
  it("measures bounds across polylines in both accepted shapes", () => {
    const asArrays = [[{ x: 0, y: 0 }, { x: 10, y: 4 }], [{ x: -2, y: 7 }]];
    const asObjects = [{ points: [{ x: 0, y: 0 }, { x: 10, y: 4 }] }, { points: [{ x: -2, y: 7 }] }];
    const expected = { minX: -2, minY: 0, maxX: 10, maxY: 7, width: 12, height: 7 };
    expect(designerBounds(asArrays)).toEqual(expected);
    expect(designerBounds(asObjects)).toEqual(expected);
  });

  it("ignores non-finite points and returns null when nothing is measurable", () => {
    expect(designerBounds([[{ x: NaN, y: 1 }]])).toBeNull();
    expect(designerBounds([])).toBeNull();
    expect(designerBounds(null)).toBeNull();
    expect(designerBounds([[{ x: NaN, y: 0 }, { x: 3, y: 3 }]])).toEqual({
      minX: 3, minY: 3, maxX: 3, maxY: 3, width: 0, height: 0,
    });
  });
});
