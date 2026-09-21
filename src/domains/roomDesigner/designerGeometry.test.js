import { describe, expect, it } from "vitest";
import {
  ALIGN_MODES,
  GRID_SPACING_OPTIONS,
  MAJOR_GRID_EVERY,
  alignFurniture,
  boundingBox,
  calibrateUnderlayScale,
  dimensionGeometry,
  distancePointToSegment,
  distributeFurniture,
  feetInchesLabel,
  footprintXBounds,
  ghostOpeningSpan,
  ghostRoomPolygon,
  gridSpacingLabel,
  isValidPoint,
  nearestPointOnSegment,
  offsetAlongWall,
  parseDimensionInput,
  pointInPolygon,
  polygonArea,
  rotatePoint,
  rotatedFootprintCorners,
  roomAreaSqFt,
  segmentIntersectionPoint,
  segmentsIntersect,
  snapPoint,
  snapScalar,
  underlayBounds,
  underlayContainsPoint,
  wallAngleDeg,
  wallDirection,
  wallLength,
  wallNormal,
  zoomToFitRect,
} from "./designerGeometry";

const wall = (x1, y1, x2, y2) => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

describe("designerGeometry — wall measurements", () => {
  it("measures a 12-foot wall as 144 inches", () => {
    expect(wallLength(wall(0, 0, 144, 0))).toBe(144);
  });

  it("measures a 3-4-5 triangle hypotenuse as 5", () => {
    expect(wallLength(wall(0, 0, 3, 4))).toBe(5);
  });

  it("returns 0 for missing or degenerate walls", () => {
    expect(wallLength(null)).toBe(0);
    expect(wallLength(wall(10, 10, 10, 10))).toBe(0);
    expect(wallLength({ a: { x: 0, y: 0 } })).toBe(0);
  });

  it("reports wall angle clockwise from east in screen space", () => {
    expect(wallAngleDeg(wall(0, 0, 100, 0))).toBeCloseTo(0);
    expect(wallAngleDeg(wall(0, 0, 0, 100))).toBeCloseTo(90);
    expect(wallAngleDeg(wall(0, 0, -100, 0))).toBeCloseTo(180);
    expect(wallAngleDeg(wall(0, 0, 100, 100))).toBeCloseTo(45);
  });

  it("computes unit direction and left-hand normal", () => {
    const dir = wallDirection(wall(0, 0, 144, 0));
    expect(dir.x).toBeCloseTo(1);
    expect(dir.y).toBeCloseTo(0);
    const normal = wallNormal(wall(0, 0, 144, 0));
    expect(normal.x).toBeCloseTo(0);
    expect(normal.y).toBeCloseTo(-1);
    // degenerate wall falls back to east
    expect(wallDirection(wall(5, 5, 5, 5))).toEqual({ x: 1, y: 0 });
  });
});

describe("designerGeometry — point/segment math", () => {
  it("measures perpendicular distance to a segment", () => {
    expect(distancePointToSegment({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
  });

  it("clamps to endpoints past the segment ends", () => {
    expect(distancePointToSegment({ x: 110, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
    expect(distancePointToSegment({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
  });

  it("finds the nearest point and parameter t on a segment", () => {
    const { point, t } = nearestPointOnSegment({ x: 25, y: 30 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(point.x).toBeCloseTo(25);
    expect(point.y).toBeCloseTo(0);
    expect(t).toBeCloseTo(0.25);
  });

  it("offsetAlongWall reports inches from wall.a", () => {
    expect(offsetAlongWall({ x: 36, y: 5 }, wall(0, 0, 144, 0))).toBeCloseTo(36);
    expect(offsetAlongWall({ x: 200, y: 0 }, wall(0, 0, 144, 0))).toBeCloseTo(144);
    expect(offsetAlongWall({ x: -50, y: 0 }, wall(0, 0, 144, 0))).toBeCloseTo(0);
  });
});

describe("designerGeometry — snapping", () => {
  it("snaps to the 6-inch grid by default", () => {
    const { point, snappedTo } = snapPoint({ x: 10, y: 14 });
    expect(point).toEqual({ x: 12, y: 12 });
    expect(snappedTo).toBe("grid");
  });

  it("prefers a nearby endpoint over the grid", () => {
    const { point, snappedTo } = snapPoint(
      { x: 101, y: 2 },
      { snapTargets: [{ x: 100, y: 0 }, { x: 500, y: 500 }] },
    );
    expect(point).toEqual({ x: 100, y: 0 });
    expect(snappedTo).toBe("endpoint");
  });

  it("ignores endpoints outside the snap radius", () => {
    const { snappedTo } = snapPoint(
      { x: 50, y: 50 },
      { snapTargets: [{ x: 100, y: 100 }], snapRadiusIn: 9 },
    );
    expect(snappedTo).toBe("grid");
  });

  it("rejects invalid input safely", () => {
    expect(isValidPoint(null)).toBe(false);
    expect(isValidPoint({ x: NaN, y: 0 })).toBe(false);
    expect(snapPoint(null).point).toEqual({ x: 0, y: 0 });
  });
});

describe("designerGeometry — Visio-style grid", () => {
  it("offers 6-inch and 1-foot grid presets with a major line every 5 minor lines", () => {
    expect(GRID_SPACING_OPTIONS).toEqual([6, 12]);
    expect(MAJOR_GRID_EVERY).toBe(5);
  });

  it("labels grid spacings like Visio (6″ / 1′)", () => {
    expect(gridSpacingLabel(6)).toBe("6″");
    expect(gridSpacingLabel(12)).toBe("1′");
    expect(gridSpacingLabel(24)).toBe("2′");
    expect(gridSpacingLabel(0)).toBe("—");
  });

  it("snaps to a 1-foot grid when gridIn is 12", () => {
    const { point, snappedTo } = snapPoint({ x: 10, y: 14 }, { gridIn: 12 });
    expect(point).toEqual({ x: 12, y: 12 });
    expect(snappedTo).toBe("grid");
  });

  it("returns the raw point when grid snapping is off", () => {
    const { point, snappedTo } = snapPoint({ x: 10.4, y: 14.7 }, { snapToGrid: false });
    expect(point).toEqual({ x: 10.4, y: 14.7 });
    expect(snappedTo).toBe("none");
  });

  it("keeps endpoint snapping even when grid snapping is off", () => {
    const { point, snappedTo } = snapPoint(
      { x: 101, y: 2 },
      { snapToGrid: false, snapTargets: [{ x: 100, y: 0 }] },
    );
    expect(point).toEqual({ x: 100, y: 0 });
    expect(snappedTo).toBe("endpoint");
  });

  it("snaps scalar values (door/window offsets) to the grid", () => {
    expect(snapScalar(10, 6)).toBe(12);
    expect(snapScalar(14, 12)).toBe(12);
    expect(snapScalar(0, 6)).toBe(0);
    // invalid input passes through untouched
    expect(snapScalar(NaN, 6)).toBeNaN();
    expect(snapScalar(10, 0)).toBe(10);
  });
});

describe("designerGeometry — dimension lines", () => {
  it("builds a parallel dimension line with slash ticks for an east wall", () => {
    const dim = dimensionGeometry(wall(0, 0, 144, 0), 10);
    expect(dim).not.toBeNull();
    // wallNormal for an east wall points up (screen space): line sits above
    expect(dim.lineA).toEqual({ x: 0, y: -10 });
    expect(dim.lineB).toEqual({ x: 144, y: -10 });
    // ticks are 6-inch 45° slashes centered on each end
    for (const tick of [dim.tickA, dim.tickB]) {
      const len = Math.hypot(tick.b.x - tick.a.x, tick.b.y - tick.a.y);
      expect(len).toBeCloseTo(6);
    }
    expect(dim.tickA.a.x).toBeCloseTo(-dim.tickA.b.x);
    expect(dim.length).toBe(144);
    expect(dim.labelAngle).toBeCloseTo(0);
    // label sits just past the dimension line
    expect(dim.labelPos.y).toBeLessThan(-10);
    expect(dim.labelPos.x).toBeCloseTo(72);
  });

  it("normalizes the label angle for readability", () => {
    expect(dimensionGeometry(wall(0, 0, 0, 144), 10).labelAngle).toBeCloseTo(90);
    // west wall (180°) flips to 0° so the text isn't upside down
    expect(dimensionGeometry(wall(144, 0, 0, 0), 10).labelAngle).toBeCloseTo(0);
  });

  it("returns null for degenerate walls", () => {
    expect(dimensionGeometry(wall(5, 5, 5, 5), 10)).toBeNull();
  });
});

describe("designerGeometry — align and distribute", () => {
  const pieces = (xs) => xs.map((x, i) => ({ id: `p${i}`, x, y: i * 10 }));
  const withDims = (xs, dims) =>
    xs.map((x, i) => ({ id: `p${i}`, x, y: 0, ...dims[i] }));
  const xBounds = (p) => footprintXBounds(p);

  it("aligns dimension-less pieces by center (point footprints)", () => {
    expect(alignFurniture(pieces([10, 30, 60]), "left").map((p) => p.x)).toEqual([10, 10, 10]);
    expect(alignFurniture(pieces([10, 30, 60]), "right").map((p) => p.x)).toEqual([60, 60, 60]);
    expect(alignFurniture(pieces([10, 30, 60]), "center").map((p) => p.x)).toEqual([35, 35, 35]);
  });

  it("aligns left/right against rotated footprint EDGES, not centers", () => {
    // desk (48x24) at x=10: left edge -14. armchair (36x36) at x=40: left edge 22.
    // loveseat (60x36) rotated 90° at x=100: footprint 36 wide, left edge 82.
    // All three footprint widths differ so no two centers coincide after align.
    const list = withDims([10, 40, 100], [
      { widthIn: 48, depthIn: 24, rotationDeg: 0 },
      { widthIn: 36, depthIn: 36, rotationDeg: 0 },
      { widthIn: 36, depthIn: 20, rotationDeg: 90 }, // footprint 20 wide
    ]);
    const left = alignFurniture(list, "left");
    for (const p of left) expect(xBounds(p).left).toBeCloseTo(-14, 9);
    // centers must NOT be collapsed onto one line anymore
    expect(new Set(left.map((p) => p.x)).size).toBe(3);

    const right = alignFurniture(list, "right");
    // right edges: desk 34, armchair 58, loveseat 110 → target 110
    for (const p of right) expect(xBounds(p).right).toBeCloseTo(110, 9);
  });

  it("aligns centers for center mode with mixed widths", () => {
    // 20-wide at x=0, 60-wide at x=100 → bbox [-10, 130], center 60
    const list = withDims([0, 100], [
      { widthIn: 20, depthIn: 20, rotationDeg: 0 },
      { widthIn: 60, depthIn: 20, rotationDeg: 0 },
    ]);
    const out = alignFurniture(list, "center");
    expect(out.map((p) => p.x)).toEqual([60, 60]);
  });

  it("treats a 90°-rotated piece's footprint with swapped width/depth", () => {
    const unrotated = { id: "a", x: 0, y: 0, widthIn: 84, depthIn: 36, rotationDeg: 0 };
    const rotated = { id: "b", x: 0, y: 0, widthIn: 84, depthIn: 36, rotationDeg: 90 };
    expect(xBounds(unrotated).left).toBe(-42);
    expect(xBounds(unrotated).right).toBe(42);
    expect(xBounds(rotated).left).toBeCloseTo(-18, 9);
    expect(xBounds(rotated).right).toBeCloseTo(18, 9);
  });

  it("leaves y coordinates and ids untouched when aligning", () => {
    const out = alignFurniture(pieces([10, 30]), "left");
    expect(out.map((p) => p.y)).toEqual([0, 10]);
    expect(out.map((p) => p.id)).toEqual(["p0", "p1"]);
  });

  it("rejects unknown align modes and passes through small lists", () => {
    expect(() => alignFurniture(pieces([10, 30]), "top")).toThrow(/Unknown align mode/);
    expect(alignFurniture(pieces([10]), "left")).toEqual(pieces([10]));
    expect(ALIGN_MODES).toEqual(["left", "center", "right"]);
  });

  it("distributes dimension-less pieces by center, outermost fixed", () => {
    const out = distributeFurniture(pieces([0, 10, 100]));
    expect(out.map((p) => p.x)).toEqual([0, 50, 100]);
  });

  it("distributes equal FREE GAPS between rotated footprints, not centers", () => {
    // desk (48x24) x=0, armchair (36x36) x=50, sofa (84x36) x=300.
    // Outermost fixed; free space between desk's right edge (24) and sofa's
    // left edge (258), minus the 36-inch armchair: (258-24-36)/2 = 99 gaps.
    const list = withDims([0, 50, 300], [
      { widthIn: 48, depthIn: 24, rotationDeg: 0 },
      { widthIn: 36, depthIn: 36, rotationDeg: 0 },
      { widthIn: 84, depthIn: 36, rotationDeg: 0 },
    ]);
    const out = distributeFurniture(list);
    const byId = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(byId.p0.x).toBe(0); // leftmost stays
    expect(byId.p2.x).toBe(300); // rightmost stays
    const gap1 = xBounds(byId.p1).left - xBounds(byId.p0).right;
    const gap2 = xBounds(byId.p2).left - xBounds(byId.p1).right;
    expect(gap1).toBeCloseTo(99, 6);
    expect(gap2).toBeCloseTo(99, 6);
    // The old center-based math would have put the armchair at 150 (the
    // midpoint), visibly overlapping neither gap equally:
    expect(byId.p1.x).not.toBe(150);
  });

  it("keeps the outermost pieces fixed and preserves input order", () => {
    const out = distributeFurniture(pieces([100, 0, 25, 75]));
    const byId = Object.fromEntries(out.map((p) => [p.id, p.x]));
    expect(byId.p1).toBe(0); // leftmost stays
    expect(byId.p0).toBe(100); // rightmost stays
    expect(out.map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(byId.p2).toBeCloseTo(33.333, 2);
    expect(byId.p3).toBeCloseTo(66.667, 2);
  });

  it("leaves fewer than 3 pieces unchanged when distributing", () => {
    expect(distributeFurniture(pieces([0, 100]))).toEqual(pieces([0, 100]));
  });
});

describe("designerGeometry — intersections", () => {
  it("detects a crossing pair of segments", () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
    ).toBe(true);
  });

  it("rejects touching endpoints and parallel segments", () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }),
    ).toBe(false);
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    ).toBe(false);
  });

  it("returns the crossing point of two diagonals", () => {
    const hit = segmentIntersectionPoint(
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 },
    );
    expect(hit.x).toBeCloseTo(5);
    expect(hit.y).toBeCloseTo(5);
  });

  it("returns null when segments do not cross", () => {
    expect(
      segmentIntersectionPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    ).toBeNull();
  });
});

describe("designerGeometry — areas and labels", () => {
  it("computes polygon area with the shoelace formula", () => {
    // 12ft x 10ft rectangle = 144in x 120in = 17280 sq in
    const rect = [
      { x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 120 }, { x: 0, y: 120 },
    ];
    expect(polygonArea(rect)).toBe(17280);
  });

  it("converts a 12x10 room to 120 sq ft", () => {
    const room = {
      polygon: [
        { x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 120 }, { x: 0, y: 120 },
      ],
    };
    expect(roomAreaSqFt(room)).toBe(120);
  });

  it("returns 0 for degenerate polygons", () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }])).toBe(0);
    expect(roomAreaSqFt(null)).toBe(0);
  });

  it("formats dimension labels as feet and inches", () => {
    expect(feetInchesLabel(144)).toBe("12' 0\"");
    expect(feetInchesLabel(150)).toBe("12' 6\"");
    expect(feetInchesLabel(7)).toBe("0' 7\"");
    expect(feetInchesLabel(NaN)).toBe("—");
  });

  it("computes a bounding box", () => {
    expect(
      boundingBox([{ x: 10, y: 20 }, { x: 30, y: 5 }, { x: -4, y: 40 }]),
    ).toEqual({ minX: -4, minY: 5, maxX: 30, maxY: 40 });
    expect(boundingBox([])).toBeNull();
  });
});

describe("designerGeometry — rotation", () => {
  it("rotates a point 90 degrees clockwise around an origin", () => {
    const out = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(10);
  });

  it("produces four footprint corners for unrotated furniture", () => {
    const corners = rotatedFootprintCorners({ x: 0, y: 0, widthIn: 60, depthIn: 30 });
    expect(corners).toHaveLength(4);
    expect(corners[0].x).toBeCloseTo(-30);
    expect(corners[0].y).toBeCloseTo(-15);
    expect(corners[2].x).toBeCloseTo(30);
    expect(corners[2].y).toBeCloseTo(15);
  });

  it("rotates the footprint bounding area with the piece", () => {
    const corners = rotatedFootprintCorners({ x: 0, y: 0, widthIn: 60, depthIn: 30, rotationDeg: 90 });
    const box = boundingBox(corners);
    // 60-wide piece rotated 90° now spans 30 in x and 60 in y
    expect(box.maxX - box.minX).toBeCloseTo(30);
    expect(box.maxY - box.minY).toBeCloseTo(60);
  });
});

describe("designerGeometry — background underlay", () => {
  // Image 1000x500 px at 2 px/in, anchored at plan (10, 20):
  // covers x 10..510, y 20..270.
  const underlay = { x: 10, y: 20, widthPx: 1000, heightPx: 500, pxPerIn: 2 };

  it("calibrates pixels-per-inch from two clicks and a real distance", () => {
    // Clicks 200 plan inches apart = 400 image px; real distance 100 in → 4 px/in.
    expect(calibrateUnderlayScale(underlay, { x: 0, y: 0 }, { x: 200, y: 0 }, 100)).toBeCloseTo(4);
    // Diagonal clicks work too: 300-400-500 triangle, 500 px at 2 px/in = 250 plan in.
    expect(
      calibrateUnderlayScale(underlay, { x: 0, y: 0 }, { x: 150, y: 200 }, 125),
    ).toBeCloseTo(4);
  });

  it("rejects degenerate calibration inputs", () => {
    expect(() => calibrateUnderlayScale(underlay, { x: 0, y: 0 }, { x: 0, y: 0 }, 100)).toThrow(/distinct/);
    expect(() => calibrateUnderlayScale(underlay, { x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toThrow(/positive/);
    expect(() => calibrateUnderlayScale(underlay, { x: 0, y: 0 }, { x: 10, y: 0 }, -5)).toThrow(/positive/);
    expect(() => calibrateUnderlayScale({ pxPerIn: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, 100)).toThrow(/scale/);
    expect(() => calibrateUnderlayScale(underlay, null, { x: 10, y: 0 }, 100)).toThrow(/points/);
  });

  it("computes plan bounds from the anchor and scale", () => {
    expect(underlayBounds(underlay)).toEqual({ minX: 10, minY: 20, maxX: 510, maxY: 270 });
    expect(underlayBounds(null)).toBeNull();
    expect(underlayBounds({ ...underlay, pxPerIn: 0 })).toBeNull();
  });

  it("hit-tests points against the image bounds", () => {
    expect(underlayContainsPoint(underlay, { x: 100, y: 100 })).toBe(true);
    expect(underlayContainsPoint(underlay, { x: 10, y: 20 })).toBe(true);
    expect(underlayContainsPoint(underlay, { x: 510, y: 270 })).toBe(true);
    expect(underlayContainsPoint(underlay, { x: 9, y: 100 })).toBe(false);
    expect(underlayContainsPoint(underlay, { x: 511, y: 100 })).toBe(false);
    expect(underlayContainsPoint(underlay, { x: 100, y: 271 })).toBe(false);
    expect(underlayContainsPoint(null, { x: 100, y: 100 })).toBe(false);
  });

  it("parses feet/inches dimensions", () => {
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

  it("returns NaN for unparseable dimensions", () => {
    for (const s of ["", "abc", "12x", "--5", "'\""]) {
      expect(parseDimensionInput(s)).toBeNaN();
    }
    expect(parseDimensionInput(null)).toBeNaN();
  });
});

describe("zoomToFitRect", () => {
  it("fits the rect and centers it in the viewport", () => {
    const view = zoomToFitRect(
      { x: 10, y: 20, widthIn: 100, heightIn: 50 },
      { w: 1000, h: 800 },
      { paddingPx: 0, minScale: 0.35, maxScale: 12 },
    );
    // scale = min(1000/100, 800/50) = 10; rect maps to x 0..1000, y 150..650.
    expect(view.scale).toBe(10);
    expect(view.ox).toBe(-100);
    expect(view.oy).toBe(-50);
    const toScreen = (p) => ({ x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale });
    expect(toScreen({ x: 10, y: 20 })).toEqual({ x: 0, y: 150 });
    expect(toScreen({ x: 110, y: 70 })).toEqual({ x: 1000, y: 650 });
  });

  it("respects padding and clamps to maxScale for tiny rects", () => {
    const view = zoomToFitRect(
      { x: 0, y: 0, widthIn: 2, heightIn: 2 },
      { w: 1000, h: 800 },
      { paddingPx: 100, minScale: 0.35, maxScale: 12 },
    );
    // Unclamped scale would be min(800/2, 600/2) = 300 -> clamped to 12.
    expect(view.scale).toBe(12);
    // Still centered: rect center (1,1) maps to viewport center (500, 400).
    expect(view.ox + 1 * view.scale).toBe(500);
    expect(view.oy + 1 * view.scale).toBe(400);
  });

  it("clamps to minScale for huge rects", () => {
    const view = zoomToFitRect(
      { x: 0, y: 0, widthIn: 100000, heightIn: 100000 },
      { w: 1000, h: 800 },
      { paddingPx: 0, minScale: 0.35, maxScale: 12 },
    );
    expect(view.scale).toBe(0.35);
  });

  it("throws on degenerate rects, viewports, or scale bounds", () => {
    const rect = { x: 0, y: 0, widthIn: 10, heightIn: 10 };
    const vp = { w: 100, h: 100 };
    expect(() => zoomToFitRect({ ...rect, widthIn: 0 }, vp)).toThrow();
    expect(() => zoomToFitRect({ ...rect, heightIn: -3 }, vp)).toThrow();
    expect(() => zoomToFitRect(rect, { w: 0, h: 100 })).toThrow();
    expect(() => zoomToFitRect(rect, vp, { minScale: 2, maxScale: 1 })).toThrow();
  });
});

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  it("detects interior and exterior points of a square", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 1, y: 99 }, square)).toBe(true);
    expect(pointInPolygon({ x: -1, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 101, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 50, y: 101 }, square)).toBe(false);
  });
  it("handles concave polygons (L-shape notch is outside)", () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 20, y: 20 }, lShape)).toBe(true); // top arm
    expect(pointInPolygon({ x: 20, y: 80 }, lShape)).toBe(true); // stem
    expect(pointInPolygon({ x: 70, y: 70 }, lShape)).toBe(false); // notch
  });
  it("rejects degenerate and invalid input", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, [])).toBe(false);
    expect(pointInPolygon({ x: 50, y: 50 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(false);
    expect(pointInPolygon({ x: 50, y: 50 }, null)).toBe(false);
    expect(pointInPolygon(null, square)).toBe(false);
    expect(pointInPolygon({ x: NaN, y: 50 }, square)).toBe(false);
  });
});

describe("ghostRoomPolygon", () => {
  it("returns the template footprint corners at the origin", () => {
    expect(ghostRoomPolygon({ widthIn: 144, depthIn: 96 }, { x: 60, y: 60 })).toEqual([
      { x: 60, y: 60 },
      { x: 204, y: 60 },
      { x: 204, y: 156 },
      { x: 60, y: 156 },
    ]);
  });

  it("matches the addRoomFromTemplate footprint contract", () => {
    const poly = ghostRoomPolygon({ widthIn: 120, depthIn: 144 }, { x: 0, y: 0 });
    expect(poly).toHaveLength(4);
    expect(poly[2]).toEqual({ x: 120, y: 144 });
  });

  it("throws on an invalid template or origin", () => {
    expect(() => ghostRoomPolygon({ widthIn: 0, depthIn: 96 }, { x: 0, y: 0 })).toThrow();
    expect(() => ghostRoomPolygon({ widthIn: 144 }, { x: 0, y: 0 })).toThrow();
    expect(() => ghostRoomPolygon(null, { x: 0, y: 0 })).toThrow();
    expect(() => ghostRoomPolygon({ widthIn: 144, depthIn: 96 }, null)).toThrow();
    expect(() => ghostRoomPolygon({ widthIn: 144, depthIn: 96 }, { x: NaN, y: 0 })).toThrow();
  });
});

describe("ghostOpeningSpan", () => {
  const walls = [
    { id: "w1", a: { x: 0, y: 0 }, b: { x: 240, y: 0 } },
    { id: "w2", a: { x: 0, y: 100 }, b: { x: 0, y: 220 } },
  ];

  it("lays the span on the nearest wall with the snapped offset", () => {
    const span = ghostOpeningSpan(walls, { x: 61, y: 3 }, { widthIn: 36, gridIn: 6 });
    expect(span.wallId).toBe("w1");
    expect(span.offsetIn).toBe(60); // raw 61 snaps to the 6" grid
    expect(span.widthIn).toBe(36);
    expect(span.g1).toEqual({ x: 60, y: 0 });
    expect(span.g2).toEqual({ x: 96, y: 0 });
  });

  it("picks the nearer wall when two are in range", () => {
    const span = ghostOpeningSpan(walls, { x: 2, y: 150 }, { widthIn: 48, gridIn: 6 });
    expect(span.wallId).toBe("w2");
    // Offset 50 from wall.a snaps to 48 on the 6" grid.
    expect(span.g1).toEqual({ x: 0, y: 148 });
    expect(span.g2).toEqual({ x: 0, y: 196 });
  });

  it("keeps the raw offset when snapping is off", () => {
    const span = ghostOpeningSpan(walls, { x: 61, y: 3 }, { widthIn: 36, gridIn: 6, snapOffset: false });
    expect(span.offsetIn).toBe(61);
    expect(span.g1.x).toBe(61);
    expect(span.g2.x).toBe(97);
  });

  it("returns null when no wall is within tolerance", () => {
    expect(ghostOpeningSpan(walls, { x: 400, y: 400 }, { widthIn: 36 })).toBeNull();
    expect(ghostOpeningSpan(walls, null, { widthIn: 36 })).toBeNull();
  });

  it("returns null for a degenerate wall", () => {
    const degenerate = [{ id: "w0", a: { x: 10, y: 10 }, b: { x: 10, y: 10 } }];
    expect(ghostOpeningSpan(degenerate, { x: 10, y: 12 }, { widthIn: 36 })).toBeNull();
  });

  it("throws on a non-positive width", () => {
    expect(() => ghostOpeningSpan(walls, { x: 61, y: 3 }, { widthIn: 0 })).toThrow();
    expect(() => ghostOpeningSpan(walls, { x: 61, y: 3 }, {})).toThrow();
  });
});
