import { describe, expect, it } from "vitest";
import { measureAreaSummary } from "./measureArea";

describe("measureAreaSummary", () => {
  it("returns null for fewer than three points, since that is not an area", () => {
    expect(measureAreaSummary([])).toBeNull();
    expect(measureAreaSummary([{ x: 0, y: 0 }, { x: 120, y: 0 }])).toBeNull();
  });

  it("computes a 12 ft by 10 ft rectangle as 120 sq ft with a 264 in perimeter", () => {
    const rect = [{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 120 }, { x: 0, y: 120 }];
    const result = measureAreaSummary(rect);
    expect(result.areaSqFt).toBeCloseTo(120, 6);
    expect(result.perimeterIn).toBeCloseTo(528, 6);
  });

  it("gives the same area whichever way round the corners are traced", () => {
    const clockwise = [{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 120 }, { x: 0, y: 120 }];
    const counter = [...clockwise].reverse();
    expect(measureAreaSummary(counter).areaSqFt).toBeCloseTo(measureAreaSummary(clockwise).areaSqFt, 9);
  });

  it("handles an L-shaped room without double-counting", () => {
    // 12 ft square with a 6 ft by 6 ft notch removed from one corner: 144 - 36 = 108 sq ft.
    const lShape = [
      { x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 72 },
      { x: 72, y: 72 }, { x: 72, y: 144 }, { x: 0, y: 144 },
    ];
    expect(measureAreaSummary(lShape).areaSqFt).toBeCloseTo(108, 6);
  });
});
