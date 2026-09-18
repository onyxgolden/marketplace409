import { describe, expect, test } from "vitest";
import { buildPieSlices, sliceToPath } from "../pieChartGeometry";

describe("buildPieSlices", () => {
  test("returns empty for zero or negative total", () => {
    expect(buildPieSlices([])).toEqual([]);
    expect(buildPieSlices([{ label: "a", valueCents: 0 }])).toEqual([]);
  });

  test("splits two equal entries into two half-circle slices", () => {
    const slices = buildPieSlices([
      { label: "a", valueCents: 100 },
      { label: "b", valueCents: 100 },
    ]);
    expect(slices).toHaveLength(2);
    expect(slices[0].fraction).toBeCloseTo(0.5);
    expect(slices[1].fraction).toBeCloseTo(0.5);
    // Slices are contiguous: first slice's end angle is the second slice's start angle.
    expect(slices[0].endAngle).toBeCloseTo(slices[1].startAngle);
  });

  test("a single entry covers the full circle (2*PI of arc)", () => {
    const slices = buildPieSlices([{ label: "only", valueCents: 500 }]);
    expect(slices).toHaveLength(1);
    expect(slices[0].fraction).toBeCloseTo(1);
    expect(slices[0].endAngle - slices[0].startAngle).toBeCloseTo(2 * Math.PI);
  });
});

describe("sliceToPath", () => {
  test("draws a two-arc full circle for a single 100% slice", () => {
    const [slice] = buildPieSlices([{ label: "only", valueCents: 500 }]);
    const path = sliceToPath(slice, 50, 50, 40);
    expect(path).toContain("A 40,40");
    expect(path.startsWith("M")).toBe(true);
  });

  test("draws a standard wedge path for a partial slice", () => {
    const slices = buildPieSlices([
      { label: "a", valueCents: 100 },
      { label: "b", valueCents: 300 },
    ]);
    const path = sliceToPath(slices[0], 50, 50, 40);
    expect(path.startsWith("M 50,50 L")).toBe(true);
    expect(path).toContain("Z");
  });
});
