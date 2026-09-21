/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { parseXml, childElements, getAttr } from "./visioXml.js";
import { cellElementMap } from "./visioResolver.js";
import {
  buildPath,
  catmullRomToCubics,
  flattenPath,
  solveCircularArc,
  solveEllipticalArc,
} from "./visioGeometry.js";
import { cellXml } from "./testUtils/vsdxFixture.js";

const row = (type, cells) => `<Row T="${type}">${cells}</Row>`;
const move = (x, y) => row("MoveTo", cellXml("X", { v: x }) + cellXml("Y", { v: y }));
const line = (x, y) => row("LineTo", cellXml("X", { v: x }) + cellXml("Y", { v: y }));
const arc = (x, y, a) =>
  row("ArcTo", cellXml("X", { v: x }) + cellXml("Y", { v: y }) + cellXml("A", { v: a }));

function rowsFromXml(inner, shapeCellsXml = "") {
  const doc = parseXml(`<Section N="Geometry" IX="1">${inner}</Section>`, "g.xml");
  const rows = childElements(doc.documentElement, "Row").map((el) => ({
    type: getAttr(el, "T"),
    del: getAttr(el, "Del") === "1",
    el,
  }));
  const shapeDoc = parseXml(`<Shape>${shapeCellsXml}</Shape>`, "s.xml");
  return { rows, shapeCells: cellElementMap(shapeDoc.documentElement) };
}

function build(inner, shapeCellsXml = "") {
  const { rows, shapeCells } = rowsFromXml(inner, shapeCellsXml);
  const warnings = [];
  const { subpaths } = buildPath(rows, shapeCells, {
    provenance: "test",
    onWarning: (m) => warnings.push(m),
  });
  return { subpaths, warnings };
}

const distTo = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

describe("visioGeometry segments", () => {
  it("builds a closed rectangle from MoveTo/LineTo", () => {
    const { subpaths, warnings } = build(move(0, 0) + line(4, 0) + line(4, 2) + line(0, 2) + line(0, 0));
    expect(warnings).toEqual([]);
    expect(subpaths).toHaveLength(1);
    const flat = flattenPath(subpaths);
    expect(flat).toHaveLength(1);
    expect(flat[0].closed).toBe(true);
    expect(flat[0].points).toHaveLength(4);
    expect(flat[0].allLines).toBe(true);
  });

  it("handles relative rows", () => {
    const inner =
      move(1, 1) +
      `<Row T="RelLineTo">${cellXml("X", { v: 3 })}${cellXml("Y", { v: 0 })}</Row>` +
      `<Row T="RelMoveTo">${cellXml("X", { v: 0 })}${cellXml("Y", { v: 5 })}</Row>` +
      line(9, 9);
    const { subpaths } = build(inner);
    const flat = flattenPath(subpaths);
    expect(flat).toHaveLength(2);
    expect(flat[0].points[1]).toMatchObject({ x: 4, y: 1 });
    expect(flat[1].points[0]).toMatchObject({ x: 4, y: 6 });
  });

  it("treats a leading LineTo as a MoveTo with a warning", () => {
    const { warnings } = build(line(3, 4));
    expect(warnings.some((w) => /no current point/i.test(w))).toBe(true);
  });

  it("skips rows whose coordinates are unsupported formulas", () => {
    const inner =
      move(0, 0) +
      `<Row T="LineTo">${cellXml("X", { f: "Width*0.5" })}${cellXml("Y", { v: 2 })}</Row>` +
      line(5, 5);
    const { subpaths, warnings } = build(inner, cellXml("Width", { v: 4 }));
    expect(warnings.some((w) => /non-constant/i.test(w))).toBe(true);
    const flat = flattenPath(subpaths);
    // Only the MoveTo + surviving LineTo remain.
    expect(flat[0].points.at(-1)).toMatchObject({ x: 5, y: 5 });
  });

  it("warns on unsupported rows but keeps the rest of the path", () => {
    const inner = move(0, 0) + `<Row T="NURBSTo">${cellXml("X", { v: 1 })}</Row>` + line(2, 2);
    const { subpaths, warnings } = build(inner);
    expect(warnings.some((w) => /NURBSTo/i.test(w))).toBe(true);
    const flat = flattenPath(subpaths);
    expect(flat[0].points.at(-1)).toMatchObject({ x: 2, y: 2 });
  });

  it("warns on unknown row types", () => {
    const { warnings } = build(move(0, 0) + `<Row T="Mystery">${cellXml("X", { v: 1 })}</Row>`);
    expect(warnings.some((w) => /Mystery/i.test(w))).toBe(true);
  });

  it("keeps PolylineTo endpoints with a V1 warning", () => {
    const inner = move(0, 0) + `<Row T="PolylineTo">${cellXml("X", { v: 3 })}${cellXml("Y", { v: 3 })}</Row>`;
    const { warnings } = build(inner);
    expect(warnings.some((w) => /PolylineTo/i.test(w))).toBe(true);
  });
});

describe("visioGeometry arcs", () => {
  it("solves a circular ArcTo through its endpoints with the right sagitta", () => {
    const solved = solveCircularArc({ x: 0, y: 0 }, { x: 4, y: 0 }, 1);
    expect(solved.r).toBeCloseTo(2.5, 9);
    // Arc midpoint sits one unit above the chord midpoint.
    const mid = {
      x: solved.cx + solved.r * Math.cos(solved.through),
      y: solved.cy + solved.r * Math.sin(solved.through),
    };
    expect(mid.x).toBeCloseTo(2, 9);
    expect(mid.y).toBeCloseTo(1, 9);
  });

  it("flattens ArcTo within tolerance, endpoints exact", () => {
    const { subpaths } = build(move(0, 0) + arc(4, 0, 1));
    const flat = flattenPath(subpaths, { toleranceIn: 0.001 });
    const pts = flat[0].points;
    expect(pts[0]).toMatchObject({ x: 0, y: 0 });
    expect(pts.at(-1)).toMatchObject({ x: 4, y: 0 });
    // Sagitta: highest point ≈ 1 above the chord.
    const top = Math.max(...pts.map((p) => p.y));
    expect(top).toBeCloseTo(1, 2);
    expect(flat[0].allLines).toBe(false);
  });

  it("negative bow bulges the other way", () => {
    const { subpaths } = build(move(0, 0) + arc(4, 0, -1));
    const pts = flattenPath(subpaths, { toleranceIn: 0.001 })[0].points;
    const bottom = Math.min(...pts.map((p) => p.y));
    expect(bottom).toBeCloseTo(-1, 2);
  });

  it("solves an elliptical arc through start, end, and control point", () => {
    const solved = solveEllipticalArc({ x: 4, y: 0 }, { x: -4, y: 0 }, { x: 0, y: 3 }, 0, 2);
    expect(solved).not.toBeNull();
    // Every defining point lies on the solved ellipse.
    for (const p of [
      { x: 4, y: 0 },
      { x: -4, y: 0 },
      { x: 0, y: 3 },
    ]) {
      const dx = (p.x - solved.cx) / solved.rx;
      const dy = (p.y - solved.cy) / solved.ry;
      expect(dx * dx + dy * dy).toBeCloseTo(1, 6);
    }
  });

  it("flattens EllipticalArcTo with exact endpoints and near control point", () => {
    const inner =
      move(4, 0) +
      row(
        "EllipticalArcTo",
        cellXml("X", { v: -4 }) +
          cellXml("Y", { v: 0 }) +
          cellXml("A", { v: 0 }) +
          cellXml("B", { v: 3 }) +
          cellXml("C", { v: 0 }) +
          cellXml("D", { v: 2 }),
      );
    const { subpaths, warnings } = build(inner);
    expect(warnings).toEqual([]);
    const pts = flattenPath(subpaths)[0].points;
    expect(pts[0]).toMatchObject({ x: 4, y: 0 });
    expect(pts.at(-1)).toMatchObject({ x: -4, y: 0 });
    // The true arc passes exactly through the control point; the polyline
    // approximates it within tolerance, so measure segment distance.
    const segDist = (p, a, b) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return distTo(p, { x: a.x + t * dx, y: a.y + t * dy });
    };
    const nearControl = Math.min(
      ...pts.slice(1).map((p, i) => segDist({ x: 0, y: 3 }, pts[i], p)),
    );
    expect(nearControl).toBeLessThan(0.02);
  });

  it("flattens an axis-aligned full Ellipse row as a closed loop", () => {
    const inner = row(
      "Ellipse",
      cellXml("X", { v: 0 }) +
        cellXml("Y", { v: 0 }) +
        cellXml("A", { v: 4 }) +
        cellXml("B", { v: 0 }) +
        cellXml("C", { v: 0 }) +
        cellXml("D", { v: 2 }),
    );
    const { subpaths } = build(inner);
    const flat = flattenPath(subpaths);
    expect(flat[0].closed).toBe(true);
    for (const p of flat[0].points) {
      expect((p.x / 4) ** 2 + (p.y / 2) ** 2).toBeCloseTo(1, 2);
    }
  });
});

describe("visioGeometry splines", () => {
  const splineInner =
    move(0, 0) +
    row("SplineStart", cellXml("X", { v: 1 }) + cellXml("Y", { v: 1 })) +
    row("SplineKnot", cellXml("X", { v: 2 }) + cellXml("Y", { v: 0 })) +
    row("SplineKnot", cellXml("X", { v: 3 }) + cellXml("Y", { v: 1 }));

  it("preserves spline endpoints and control points, and warns once", () => {
    const { subpaths, warnings } = build(splineInner);
    expect(warnings.filter((w) => /Spline/i.test(w))).toHaveLength(1);
    const pts = flattenPath(subpaths)[0].points;
    expect(distTo(pts[0], { x: 0, y: 0 })).toBeLessThan(1e-9);
    expect(distTo(pts.at(-1), { x: 3, y: 1 })).toBeLessThan(1e-9);
    for (const c of [
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ]) {
      expect(Math.min(...pts.map((p) => distTo(p, c)))).toBeLessThan(0.05);
    }
  });

  it("is deterministic across runs", () => {
    const a = flattenPath(build(splineInner).subpaths);
    const b = flattenPath(build(splineInner).subpaths);
    expect(a).toEqual(b);
  });

  it("catmullRomToCubics passes through every control point", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 3, y: 1 },
      { x: 4, y: 4 },
    ];
    const ops = catmullRomToCubics(points);
    expect(ops).toHaveLength(3);
    // Cubic endpoints are the control points (start of first, end of each).
    expect({ x: ops[0].x, y: ops[0].y }).toMatchObject({ x: 1, y: 2 });
    expect({ x: ops[2].x, y: ops[2].y }).toMatchObject({ x: 4, y: 4 });
  });
});

describe("visioGeometry flattening", () => {
  it("is deterministic for curved paths", () => {
    const inner = move(0, 0) + arc(4, 0, 1.5) + line(6, 2);
    const a = flattenPath(build(inner).subpaths, { toleranceIn: 0.01 });
    const b = flattenPath(build(inner).subpaths, { toleranceIn: 0.01 });
    expect(a).toEqual(b);
  });

  it("respects a tiny segment budget without hanging", () => {
    const inner = move(0, 0) + arc(4, 0, 1);
    const flat = flattenPath(build(inner).subpaths, { toleranceIn: 1e-9, maxSegmentsPerCurve: 10 });
    expect(flat[0].points.length).toBeLessThanOrEqual(12);
    expect(flat[0].points.at(-1)).toMatchObject({ x: 4, y: 0 });
  });

  it("dedupes consecutive points", () => {
    const { subpaths } = build(move(0, 0) + line(0, 0) + line(5, 0));
    const flat = flattenPath(subpaths);
    expect(flat[0].points).toHaveLength(2);
  });

  it("gives every curve its own budget: later curves never vanish under a shared cap", () => {
    // Two full circles (r=100) in ONE subpath with a 12-segment-per-curve
    // budget. A shared budget would let the first circle eat the whole cap
    // and starve the second; per-curve budgets must keep both.
    const twoCircles = [
      {
        ops: [
          { op: "move", x: 100, y: 0 },
          { op: "arc", cx: 0, cy: 0, rx: 100, ry: 100, rot: 0, full: true, ex: 100, ey: 0 },
          { op: "arc", cx: 300, cy: 0, rx: 100, ry: 100, rot: 0, full: true, ex: 300, ey: 0 },
        ],
        allLines: false,
      },
    ];
    const warnings = [];
    const flat = flattenPath(twoCircles, {
      toleranceIn: 0.01,
      maxSegmentsPerCurve: 12,
      onWarning: (message) => warnings.push(message),
    });
    const pts = flat[0].points;
    // Both exact endpoints survive despite the cap …
    const has = (x, y) => pts.some((p) => p.x === x && p.y === y);
    expect(has(100, 0)).toBe(true);
    expect(has(300, 0)).toBe(true);
    // … the second circle still has its own samples …
    const secondCircleSamples = pts.filter((p) => p.x > 200);
    expect(secondCircleSamples.length).toBeGreaterThan(4);
    // … and the tolerance shortfall is surfaced, not silent.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/2 curves.*12-segment-per-curve cap/i);
  });

  it("caps a cubic without losing its exact endpoint", () => {
    const s = [
      {
        ops: [
          { op: "move", x: 0, y: 0 },
          { op: "cubic", x1: 100, y1: 0, x2: 0, y2: 100, x: 100, y: 100 },
        ],
        allLines: false,
      },
    ];
    const warnings = [];
    const flat = flattenPath(s, {
      toleranceIn: 1e-9,
      maxSegmentsPerCurve: 8,
      onWarning: (m) => warnings.push(m),
    });
    const last = flat[0].points.at(-1);
    expect(last).toMatchObject({ x: 100, y: 100 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/1 curve.*8-segment-per-curve cap/i);
  });
});
