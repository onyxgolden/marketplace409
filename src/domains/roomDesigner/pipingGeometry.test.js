import { describe, expect, it } from "vitest";
import {
  MIN_PIPE_SEGMENT_IN,
  PIPE_DIAMETERS_IN,
  PIPE_LAYERS,
  PIPE_MATERIALS,
  PIPE_SERVICES,
  applyOrthoSnap,
  dedupeConsecutivePoints,
  longestPipeSegment,
  pipeLengthByDiameter,
  pipeRunLengthIn,
} from "./pipingGeometry";

describe("pipingGeometry — pipeRunLengthIn", () => {
  it("sums polyline segment lengths", () => {
    expect(pipeRunLengthIn([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }])).toBe(70);
  });

  it("returns 0 for fewer than two points", () => {
    expect(pipeRunLengthIn([])).toBe(0);
    expect(pipeRunLengthIn([{ x: 1, y: 2 }])).toBe(0);
  });

  it("ignores invalid points", () => {
    expect(pipeRunLengthIn([{ x: 0, y: 0 }, null, { x: 10, y: 0 }])).toBe(10);
  });
});

describe("pipingGeometry — dedupeConsecutivePoints", () => {
  it("collapses the doubled final click of a double-click-to-finish", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100.2, y: 0.1 }, // accidental double of the last vertex
    ];
    const clean = dedupeConsecutivePoints(pts);
    expect(clean).toHaveLength(2);
    expect(clean[1]).toEqual({ x: 100, y: 0 });
  });

  it("keeps genuinely distinct vertices", () => {
    const pts = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }];
    expect(dedupeConsecutivePoints(pts)).toHaveLength(3);
  });

  it("drops invalid points and returns fresh copies", () => {
    const clean = dedupeConsecutivePoints([{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 10, y: 0 }]);
    expect(clean).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(clean[0]).not.toBeUndefined();
  });

  it("uses the minimum segment threshold", () => {
    expect(MIN_PIPE_SEGMENT_IN).toBeGreaterThan(0);
  });
});

describe("pipingGeometry — applyOrthoSnap", () => {
  it("locks to horizontal when the pointer is mostly horizontal", () => {
    expect(applyOrthoSnap({ x: 0, y: 0 }, { x: 100, y: 12 })).toEqual({ x: 100, y: 0 });
  });

  it("locks to vertical when the pointer is mostly vertical", () => {
    expect(applyOrthoSnap({ x: 0, y: 0 }, { x: 12, y: 100 })).toEqual({ x: 0, y: 100 });
  });

  it("prefers horizontal on an exact diagonal", () => {
    expect(applyOrthoSnap({ x: 5, y: 5 }, { x: 15, y: 15 })).toEqual({ x: 15, y: 5 });
  });

  it("handles a zero-length move", () => {
    expect(applyOrthoSnap({ x: 7, y: 7 }, { x: 7, y: 7 })).toEqual({ x: 7, y: 7 });
  });

  it("falls back to the candidate when the previous vertex is invalid", () => {
    expect(applyOrthoSnap(null, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });
});

describe("pipingGeometry — pipeLengthByDiameter", () => {
  it("groups total length by nominal diameter", () => {
    const runs = [
      { diameterIn: 2, points: [{ x: 0, y: 0 }, { x: 120, y: 0 }] },
      { diameterIn: 4, points: [{ x: 0, y: 0 }, { x: 0, y: 96 }] },
      { diameterIn: 2, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }] },
    ];
    expect(pipeLengthByDiameter(runs)).toEqual({ 2: 240, 4: 96 });
  });

  it("skips runs without a positive diameter", () => {
    expect(pipeLengthByDiameter([{ diameterIn: 0, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] }])).toEqual({});
    expect(pipeLengthByDiameter([])).toEqual({});
  });
});

describe("pipingGeometry — longestPipeSegment", () => {
  it("returns the longest segment for label placement", () => {
    const seg = longestPipeSegment([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 50 }]);
    expect(seg.length).toBe(50);
    expect(seg.a).toEqual({ x: 10, y: 0 });
    expect(seg.b).toEqual({ x: 10, y: 50 });
  });

  it("returns null when there is no segment", () => {
    expect(longestPipeSegment([{ x: 0, y: 0 }])).toBeNull();
    expect(longestPipeSegment([])).toBeNull();
  });
});

describe("pipingGeometry — presets", () => {
  it("offers standard diameters, materials, services, and layers", () => {
    expect(PIPE_DIAMETERS_IN).toContain(2);
    expect(PIPE_DIAMETERS_IN).toContain(0.5);
    expect(PIPE_MATERIALS).toContain("Carbon steel");
    expect(PIPE_SERVICES).toContain("Process");
    expect(PIPE_LAYERS).toEqual(["piping", "equipment", "annotations"]);
  });
});
