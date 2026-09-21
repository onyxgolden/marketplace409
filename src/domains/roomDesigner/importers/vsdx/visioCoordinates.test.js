import { describe, expect, it } from "vitest";
import { designerBounds, toDesignerPoint, toDesignerPolyline } from "./visioCoordinates.js";
import { translation, rotation, multiply } from "./visioTransforms.js";

describe("visioCoordinates", () => {
  it("converts exactly once: Y flips around the page height, X untouched", () => {
    // Page is 11in tall. A Visio point 2in above the bottom lands 9in below
    // the Designer's top-left origin.
    expect(toDesignerPoint({ x: 3, y: 2 }, 11)).toEqual({ x: 3, y: 9 });
    expect(toDesignerPoint({ x: 0, y: 0 }, 11)).toEqual({ x: 0, y: 11 });
    expect(toDesignerPoint({ x: 8.5, y: 11 }, 11)).toEqual({ x: 8.5, y: 0 });
  });

  it("is its own inverse", () => {
    const p = { x: 1.25, y: 7.75 };
    const there = toDesignerPoint(p, 11);
    const back = { x: there.x, y: 11 - there.y };
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("applies the page transform BEFORE the Y conversion, never after", () => {
    // A shape rotated 90° about the origin in Visio space, then converted.
    const pageMatrix = rotation(Math.PI / 2);
    const [a, b] = toDesignerPolyline(
      [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      pageMatrix,
      11,
    );
    // Rotation first: (1,0)→(0,1), (2,0)→(0,2). Then Y-flip: y → 11−y.
    expect(a).toEqual({ x: 0, y: 10 });
    expect(b).toEqual({ x: 0, y: 9 });
  });

  it("keeps composed transforms in Visio space across the boundary", () => {
    // Nested group: translate then rotate, page height 8.5.
    const pageMatrix = multiply(translation(5, 1), rotation(Math.PI));
    const [p] = toDesignerPolyline([{ x: 1, y: 1 }], pageMatrix, 8.5);
    // Rotate 180°: (1,1)→(−1,−1); translate: →(4,0); flip: y → 8.5−0.
    expect(p).toEqual({ x: 4, y: 8.5 });
  });

  it("rounds to 6 decimals to keep downstream JSON stable", () => {
    expect(toDesignerPoint({ x: 1 / 3, y: 2 / 3 }, 11).x).toBe(0.333333);
  });

  it("designerBounds measures Designer-space extents", () => {
    expect(designerBounds([])).toBeNull();
    expect(
      designerBounds([
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      ]),
    ).toEqual({ minX: 1, minY: 2, maxX: 3, maxY: 4, width: 2, height: 2 });
  });
});
