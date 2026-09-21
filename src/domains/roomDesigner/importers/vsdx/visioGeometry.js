/**
 * VSDX geometry conversion: ShapeSheet Geometry rows → neutral path ops →
 * deterministically flattened polylines (inches, Visio Y-up space).
 *
 * Supported rows: MoveTo, LineTo, RelMoveTo, RelLineTo, ArcTo,
 * EllipticalArcTo, RelEllipticalArcTo, SplineStart, SplineKnot, PolylineTo
 * (endpoint only — its formula cell is out of scope in V1), Ellipse
 * (axis-aligned only).
 * Unsupported rows (InfiniteLine, NURBSTo, unknown types, formula-driven
 * coordinates that don't resolve to constants) produce a structured warning
 * and are skipped — never silently corrupted, never turned into zeros.
 *
 * Arc semantics (per Microsoft ShapeSheet docs):
 * - ArcTo: X/Y = arc endpoint; A = signed distance from the arc's midpoint
 *   to the chord midpoint (sagitta). V1 sign convention: positive A bulges
 *   toward the LEFT of the start→end direction in Y-up space.
 * - EllipticalArcTo: X/Y = endpoint; A/B = control point ON the arc
 *   (best placed mid-arc); C = angle (radians) from the x-axis to the
 *   ellipse's major axis; D = major/minor axis ratio. Solved exactly as the
 *   anisotropic circumcenter of start/end/control under the axis-ratio
 *   metric; falls back to a through-3-points cubic with a warning when
 *   degenerate.
 * - SplineStart/SplineKnot: V1 approximates the spline as a uniform
 *   Catmull-Rom interpolating curve through the stored control points
 *   (current point, SplineStart X/Y, each SplineKnot X/Y), converted exactly
 *   to cubic Bézier segments. Endpoints and every control point are
 *   preserved. The stored knot/degree cells are kept in provenance. This is
 *   documented as an approximation; a warning is emitted per shape.
 *
 * Flattening uses a geometric error tolerance (toleranceIn), not a fixed
 * segment count: adaptive subdivision for cubics, tolerance-derived angular
 * steps for arcs. Identical input always yields the identical point
 * sequence. Arc endpoints are snapped exactly to the row's endpoint cells
 * (no trig float residue). Angles are radians throughout.
 */

import { VsdxImportError } from "./vsdxErrors";
import { childElements, getAttr } from "./visioXml";
import { constantOf, resolveCell } from "./visioResolver";

export const FLATTEN_TOLERANCE_IN = 0.01;
export const MAX_SEGMENTS_PER_CURVE = 2048;
export const MAX_FLAT_POINTS = 32768;

const EPS = 1e-9;

function finitePoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Resolve one geometry-row cell against the shape's merged cell map. */
function rowCell(rowCells, shapeCells, name) {
  const el = rowCells.get(name);
  if (!el) return { state: "missing", value: undefined };
  return resolveCell(el, shapeCells);
}

function rowCellMap(rowEl) {
  const map = new Map();
  for (const cell of childElements(rowEl, "Cell")) {
    const name = getAttr(cell, "N");
    if (name) map.set(name, cell);
  }
  return map;
}

function requiredPoint(rowCells, shapeCells, names, warn, what) {
  const [nx, ny] = names;
  const x = constantOf(rowCell(rowCells, shapeCells, nx));
  const y = constantOf(rowCell(rowCells, shapeCells, ny));
  if (x == null || y == null) {
    warn(`${what}: missing or non-constant ${nx}/${ny} — row skipped.`);
    return null;
  }
  return { x, y };
}

/**
 * Solve a circular ArcTo: start P0, end P1, sagitta h (A cell).
 * Returns { cx, cy, r, a0, a1 } with a sweep passing through the arc midpoint.
 */
export function solveCircularArc(p0, p1, h) {
  const chord = dist(p0, p1);
  if (chord < EPS || Math.abs(h) < EPS) return null; // degenerate → straight line
  const half = chord / 2;
  const ah = Math.abs(h);
  const r = (ah * ah + half * half) / (2 * ah);
  const dx = (p1.x - p0.x) / chord;
  const dy = (p1.y - p0.y) / chord;
  // Left normal of the start→end direction (Y-up space).
  const nx = -dy;
  const ny = dx;
  const s = Math.sign(h);
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  // Arc midpoint sits |h| from the chord midpoint on the bulge side.
  const amx = mx + nx * s * ah;
  const amy = my + ny * s * ah;
  // Center is on the opposite side, (r - |h|) from the chord midpoint.
  const cx = mx - nx * s * (r - ah);
  const cy = my - ny * s * (r - ah);
  const a0 = Math.atan2(p0.y - cy, p0.x - cx);
  const a1 = Math.atan2(p1.y - cy, p1.x - cx);
  const am = Math.atan2(amy - cy, amx - cx);
  return { cx, cy, r, a0, a1, through: am };
}

/**
 * Solve an EllipticalArcTo exactly: start P0, end P1, on-arc control point
 * Pc, major-axis angle theta (radians), axis ratio (major/minor).
 * Returns { cx, cy, rx, ry, rot, a0, a1, through } or null when degenerate.
 */
export function solveEllipticalArc(p0, p1, pc, theta, ratio) {
  if (!(ratio > 0) || !Number.isFinite(theta)) return null;
  // Rotate into the ellipse's axis frame; the ellipse is axis-aligned there.
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);
  const rot = (p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  const q0 = rot(p0);
  const q1 = rot(p1);
  const q2 = rot(pc);
  // Anisotropic circumcenter under metric d² = dx² + ratio²·dy².
  const r2 = ratio * ratio;
  const a11 = 2 * (q1.x - q0.x);
  const a12 = 2 * r2 * (q1.y - q0.y);
  const b1 = q1.x * q1.x - q0.x * q0.x + r2 * (q1.y * q1.y - q0.y * q0.y);
  const a21 = 2 * (q2.x - q1.x);
  const a22 = 2 * r2 * (q2.y - q1.y);
  const b2 = q2.x * q2.x - q1.x * q1.x + r2 * (q2.y * q2.y - q1.y * q1.y);
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-12) return null;
  const u = (b1 * a22 - a12 * b2) / det;
  const v = (a11 * b2 - b1 * a21) / det;
  const a = Math.sqrt((q0.x - u) * (q0.x - u) + r2 * (q0.y - v) * (q0.y - v));
  if (!(a > 0) || !Number.isFinite(a)) return null;
  // Back to the original frame.
  const cos2 = Math.cos(theta);
  const sin2 = Math.sin(theta);
  const cx = u * cos2 - v * sin2;
  const cy = u * sin2 + v * cos2;
  const ang = (q) => Math.atan2(ratio * (q.y - v), q.x - u);
  return { cx, cy, rx: a, ry: a / ratio, rot: theta, a0: ang(q0), a1: ang(q1), through: ang(q2) };
}

/** Cubic Bézier through P0 → Pc (at t=0.5) → P1 (fallback curve). */
export function cubicThroughThreePoints(p0, pc, p1) {
  return {
    op: "cubic",
    x1: p0.x + (4 / 3) * (pc.x - p0.x),
    y1: p0.y + (4 / 3) * (pc.y - p0.y),
    x2: p1.x + (4 / 3) * (pc.x - p1.x),
    y2: p1.y + (4 / 3) * (pc.y - p1.y),
    x: p1.x,
    y: p1.y,
  };
}

/** Uniform Catmull-Rom through points → exact cubic Bézier ops per span. */
export function catmullRomToCubics(points) {
  const ops = [];
  if (points.length < 2) return ops;
  const get = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    ops.push({
      op: "cubic",
      x1: p1.x + (p2.x - p0.x) / 6,
      y1: p1.y + (p2.y - p0.y) / 6,
      x2: p2.x - (p3.x - p1.x) / 6,
      y2: p2.y - (p3.y - p1.y) / 6,
      x: p2.x,
      y: p2.y,
    });
  }
  return ops;
}

/**
 * Build neutral path ops from geometry rows.
 * Returns { subpaths: [{ ops, allLines }], warnings }.
 * ops: {op:'move'|'line', x, y} | {op:'cubic', x1,y1,x2,y2,x,y} | {op:'arc', ...solved}
 */
export function buildPath(rows, shapeCells, { provenance, onWarning }) {
  const warn = (message) => onWarning(`${provenance}: ${message}`);
  const subpaths = [];
  let current = null; // current op list
  let currentPoint = null;
  let splineWarned = false;

  const ensureSubpath = (pt, kind) => {
    if (!current) {
      current = [];
      subpaths.push({ ops: current, allLines: true });
      current.push({ op: "move", x: pt.x, y: pt.y });
    } else if (kind === "move") {
      current = [];
      subpaths.push({ ops: current, allLines: true });
      current.push({ op: "move", x: pt.x, y: pt.y });
    }
    currentPoint = { ...pt };
  };
  const pushOp = (op) => {
    current.push(op);
    if (op.op === "arc") {
      if (Number.isFinite(op.ex) && Number.isFinite(op.ey)) {
        currentPoint = { x: op.ex, y: op.ey };
      } else {
        const arcStart = op.full ? 0 : sweepThrough(op.a0, op.a1, op.through).start;
        const sweep = op.full ? Math.PI * 2 : sweepThrough(op.a0, op.a1, op.through).sweep;
        currentPoint = pointOnArc(op, arcStart + sweep);
      }
    } else {
      currentPoint = { x: op.x, y: op.y };
    }
  };

  // Spline state: SplineStart opens a spline, SplineKnots extend it.
  let splinePoints = null;

  const flushSpline = () => {
    if (!splinePoints || splinePoints.length < 2) {
      splinePoints = null;
      return;
    }
    if (!splineWarned) {
      warn("SplineStart/SplineKnot spline approximated as an interpolating curve through its control points (V1).");
      splineWarned = true;
    }
    for (const op of catmullRomToCubics(splinePoints)) {
      if (!current) {
        current = [];
        subpaths.push({ ops: current, allLines: false });
        current.push({ op: "move", x: splinePoints[0].x, y: splinePoints[0].y });
        currentPoint = { ...splinePoints[0] };
      }
      pushOp(op);
    }
    splinePoints = null;
  };

  for (const row of rows) {
    if (row.del) continue;
    const type = row.type;
    const cells = rowCellMap(row.el);
    const isSplineRow = type === "SplineStart" || type === "SplineKnot";
    if (!isSplineRow) flushSpline();

    switch (type) {
      case "MoveTo": {
        const pt = requiredPoint(cells, shapeCells, ["X", "Y"], warn, "MoveTo");
        if (pt) ensureSubpath(pt, "move");
        break;
      }
      case "LineTo": {
        const pt = requiredPoint(cells, shapeCells, ["X", "Y"], warn, "LineTo");
        if (!pt) break;
        if (!currentPoint) {
          warn("LineTo with no current point — treated as MoveTo.");
          ensureSubpath(pt, "move");
        } else {
          ensureSubpath(currentPoint, "line");
          pushOp({ op: "line", x: pt.x, y: pt.y });
        }
        break;
      }
      case "RelMoveTo":
      case "RelLineTo": {
        const dx = constantOf(rowCell(cells, shapeCells, "X"));
        const dy = constantOf(rowCell(cells, shapeCells, "Y"));
        if (dx == null || dy == null) {
          warn(`${type}: missing or non-constant offset — row skipped.`);
          break;
        }
        if (!currentPoint) {
          warn(`${type} with no current point — row skipped.`);
          break;
        }
        const pt = finitePoint(currentPoint.x + dx, currentPoint.y + dy);
        if (!pt) {
          warn(`${type}: non-finite result — row skipped.`);
          break;
        }
        if (type === "RelMoveTo") ensureSubpath(pt, "move");
        else {
          ensureSubpath(currentPoint, "line");
          pushOp({ op: "line", x: pt.x, y: pt.y });
        }
        break;
      }
      case "ArcTo": {
        const pt = requiredPoint(cells, shapeCells, ["X", "Y"], warn, "ArcTo");
        const h = constantOf(rowCell(cells, shapeCells, "A"));
        if (!pt || h == null) {
          if (pt && h == null) warn("ArcTo: missing or non-constant bow (A) — row skipped.");
          break;
        }
        if (!currentPoint) {
          warn("ArcTo with no current point — row skipped.");
          break;
        }
        ensureSubpath(currentPoint, "line");
        const solved = solveCircularArc(currentPoint, pt, h);
        if (solved) pushOp({ op: "arc", ...solved, ex: pt.x, ey: pt.y });
        else pushOp({ op: "line", x: pt.x, y: pt.y });
        break;
      }
      case "EllipticalArcTo":
      case "RelEllipticalArcTo": {
        const relative = type === "RelEllipticalArcTo";
        const base = currentPoint || { x: 0, y: 0 };
        const get = (name) => constantOf(rowCell(cells, shapeCells, name));
        let X = get("X");
        let Y = get("Y");
        let A = get("A");
        let B = get("B");
        const C = get("C");
        const D = get("D");
        if ([X, Y, A, B, C, D].some((v) => v == null)) {
          warn(`${type}: missing or non-constant cell — row skipped.`);
          break;
        }
        if (!currentPoint) {
          warn(`${type} with no current point — row skipped.`);
          break;
        }
        if (relative) {
          X += base.x; Y += base.y; A += base.x; B += base.y;
        }
        ensureSubpath(currentPoint, "line");
        const solved = solveEllipticalArc(currentPoint, { x: X, y: Y }, { x: A, y: B }, C, D);
        if (solved) pushOp({ op: "arc", ...solved, ex: X, ey: Y });
        else {
          warn(`${type}: degenerate ellipse parameters — approximated with a through-points cubic.`);
          pushOp(cubicThroughThreePoints(currentPoint, { x: A, y: B }, { x: X, y: Y }));
        }
        break;
      }
      case "SplineStart": {
        const pt = requiredPoint(cells, shapeCells, ["X", "Y"], warn, "SplineStart");
        if (!pt) break;
        if (!currentPoint) {
          warn("SplineStart with no current point — spline skipped.");
          break;
        }
        splinePoints = [{ ...currentPoint }, pt];
        break;
      }
      case "SplineKnot": {
        const pt = requiredPoint(cells, shapeCells, ["X", "Y"], warn, "SplineKnot");
        if (!pt) break;
        if (!splinePoints) {
          warn("SplineKnot without a preceding SplineStart — treated as LineTo.");
          if (!currentPoint) {
            ensureSubpath(pt, "move");
          } else {
            ensureSubpath(currentPoint, "line");
            pushOp({ op: "line", x: pt.x, y: pt.y });
          }
          break;
        }
        splinePoints.push(pt);
        break;
      }
      case "PolylineTo": {
        const pt = requiredPoint(cells, shapeCells, ["X", "Y"], warn, "PolylineTo");
        if (!pt) break;
        warn("PolylineTo formula data is not evaluated in V1 — endpoint kept as a line vertex.");
        if (!currentPoint) ensureSubpath(pt, "move");
        else {
          ensureSubpath(currentPoint, "line");
          pushOp({ op: "line", x: pt.x, y: pt.y });
        }
        break;
      }
      case "Ellipse": {
        // Full-ellipse row: X/Y = center, A/B and C/D = points on the ellipse.
        const cx = constantOf(rowCell(cells, shapeCells, "X"));
        const cy = constantOf(rowCell(cells, shapeCells, "Y"));
        const ax = constantOf(rowCell(cells, shapeCells, "A"));
        const ay = constantOf(rowCell(cells, shapeCells, "B"));
        const bx = constantOf(rowCell(cells, shapeCells, "C"));
        const by = constantOf(rowCell(cells, shapeCells, "D"));
        if ([cx, cy, ax, ay, bx, by].some((v) => v == null)) {
          warn("Ellipse: missing or non-constant cell — row skipped.");
          break;
        }
        const horizA = Math.abs(ay - cy) < EPS;
        const vertA = Math.abs(ax - cx) < EPS;
        const horizB = Math.abs(by - cy) < EPS;
        const vertB = Math.abs(bx - cx) < EPS;
        let rx = null;
        let ry = null;
        if (horizA && vertB) { rx = Math.abs(ax - cx); ry = Math.abs(by - cy); }
        else if (vertA && horizB) { rx = Math.abs(bx - cx); ry = Math.abs(ay - cy); }
        if (!(rx > 0) || !(ry > 0)) {
          warn("Ellipse: only axis-aligned full ellipses are supported in V1 — row skipped.");
          break;
        }
        // An Ellipse row draws the whole ellipse as a fresh closed subpath,
        // seeded at its rightmost point.
        current = [];
        subpaths.push({ ops: current, allLines: false });
        current.push({ op: "move", x: cx + rx, y: cy });
        current.push({ op: "arc", cx, cy, rx, ry, rot: 0, a0: 0, a1: Math.PI * 2, through: Math.PI, full: true, ex: cx + rx, ey: cy });
        currentPoint = { x: cx + rx, y: cy };
        break;
      }
      case "InfiniteLine":
      case "NURBSTo":
        warn(`${type} rows are not supported in V1 — row skipped.`);
        break;
      default:
        warn(`Unsupported geometry row type '${type || "(unnamed)"}' — row skipped.`);
        break;
    }
  }
  flushSpline();

  for (const sp of subpaths) {
    sp.allLines = sp.ops.every((op) => op.op === "move" || op.op === "line");
  }
  return { subpaths, warnings: [] };
}

/** Normalize an angle sweep: from a0, passing through `through`, to a1. Returns { start, sweep }. */
function sweepThrough(a0, a1, through) {
  const TAU = Math.PI * 2;
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  const n0 = norm(a0);
  const n1 = norm(a1);
  const nt = norm(through);
  // Counter-clockwise distance from n0 to nt and n0 to n1.
  const ccwTo = (from, to) => (to - from + TAU) % TAU;
  const dT = ccwTo(n0, nt);
  const d1 = ccwTo(n0, n1);
  if (dT <= d1) return { start: n0, sweep: d1 }; // CCW passes through
  return { start: n0, sweep: d1 - TAU }; // CW passes through (negative sweep)
}

function pointOnArc(arc, t) {
  const { cx, cy, rx, ry, rot } = arc;
  const ex = (rx != null ? rx : arc.r) * Math.cos(t);
  const ey = (ry != null ? ry : arc.r) * Math.sin(t);
  const cos = Math.cos(rot || 0);
  const sin = Math.sin(rot || 0);
  return { x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos };
}

/** Flatten one cubic Bézier with adaptive subdivision. Appends to `out`.
 * The budget is PER CURVE: when it is exhausted the exact endpoint is still
 * emitted and budget.capped is set so the caller can warn. */
function flattenCubic(p0, c1, c2, p1, toleranceIn, out, budget) {
  // Flatness: max distance of control points from the chord, scaled.
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chordLen = Math.hypot(dx, dy);
  const distToChord = (p) => {
    if (chordLen < EPS) return Math.hypot(p.x - p0.x, p.y - p0.y);
    return Math.abs(dy * p.x - dx * p.y + p1.x * p0.y - p1.y * p0.x) / chordLen;
  };
  if (budget.count >= budget.max) {
    budget.capped = true;
    out.push({ ...p1 });
    return;
  }
  if (Math.max(distToChord(c1), distToChord(c2)) <= toleranceIn) {
    budget.count += 1;
    out.push({ ...p1 });
    return;
  }
  // de Casteljau split at t=0.5.
  const m = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const q0 = m(p0, c1);
  const q1 = m(c1, c2);
  const q2 = m(c2, p1);
  const r0 = m(q0, q1);
  const r1 = m(q1, q2);
  const s = m(r0, r1);
  flattenCubic(p0, q0, r0, s, toleranceIn, out, budget);
  flattenCubic(s, r1, q2, p1, toleranceIn, out, budget);
}

/** Flatten one arc op with tolerance-derived angular steps. Appends to `out`.
 * The budget is PER CURVE. When it is exhausted the row's exact endpoint is
 * still emitted and budget.capped is set — a curve is never silently
 * truncated. */
function flattenArc(arc, toleranceIn, out, budget) {
  const r = Math.max(arc.rx != null ? arc.rx : arc.r, arc.ry != null ? arc.ry : arc.r);
  if (!(r > 0)) return;
  const { start, sweep } = arc.full
    ? { start: 0, sweep: Math.PI * 2 }
    : sweepThrough(arc.a0, arc.a1, arc.through);
  const total = Math.abs(sweep);
  if (total < EPS) return;
  // Sagitta s = r(1 − cos(θ/2)) ≤ tol  →  θ ≤ 2·acos(1 − tol/r).
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - Math.min(toleranceIn, r) / r)));
  const needed = Math.max(1, Math.ceil(total / Math.max(step, 1e-6)));
  const n = Math.min(budget.max, needed);
  if (needed > budget.max) {
    // The tolerance cannot be satisfied within the per-curve cap: sample
    // anyway (endpoint preserved below), but flag the approximation.
    budget.capped = true;
  }
  let completed = true;
  for (let i = 1; i <= n; i += 1) {
    if (budget.count >= budget.max) {
      completed = false;
      break;
    }
    budget.count += 1;
    out.push(pointOnArc(arc, start + (sweep * i) / n));
  }
  if (!completed) {
    // Budget exhausted mid-curve: keep the exact endpoint so the curve's
    // span is never silently truncated, and flag the approximation.
    budget.capped = true;
    if (Number.isFinite(arc.ex) && Number.isFinite(arc.ey)) {
      out.push({ x: arc.ex, y: arc.ey });
    } else {
      out.push(pointOnArc(arc, start + sweep));
    }
    return;
  }
  if (out.length > 0) {
    // Snap the final sample to the row's exact endpoint: trig evaluation of
    // the end angle leaves float residue (e.g. y = -4.4e-16 instead of 0).
    // Only when the arc flattened fully — never after a budget cut.
    if (Number.isFinite(arc.ex) && Number.isFinite(arc.ey)) {
      out[out.length - 1] = { x: arc.ex, y: arc.ey };
    }
  }
}

/**
 * Flatten built subpaths to polylines.
 * Returns [{ points: [{x,y}...], closed, allLines }].
 *
 * Each curve op (cubic or arc) gets its OWN segment budget
 * (maxSegmentsPerCurve): one curve can never starve a later curve in the
 * same subpath. When a curve's budget is exhausted its exact endpoint is
 * still emitted and a structured approximation warning is reported through
 * onWarning — the tolerance is never silently unmet.
 */
export function flattenPath(subpaths, { toleranceIn = FLATTEN_TOLERANCE_IN, maxSegmentsPerCurve = MAX_SEGMENTS_PER_CURVE, onWarning } = {}) {
  const result = [];
  let cappedCurves = 0;
  for (const sp of subpaths) {
    const points = [];
    let cursor = null;
    for (const op of sp.ops) {
      if (op.op === "move") {
        cursor = { x: op.x, y: op.y };
        points.push({ ...cursor });
      } else if (op.op === "line") {
        cursor = { x: op.x, y: op.y };
        points.push({ ...cursor });
      } else if (op.op === "cubic") {
        const p0 = cursor || { x: op.x1, y: op.y1 };
        const budget = { count: 0, max: maxSegmentsPerCurve, capped: false };
        flattenCubic(p0, { x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 }, { x: op.x, y: op.y }, toleranceIn, points, budget);
        if (budget.capped) cappedCurves += 1;
        cursor = { x: op.x, y: op.y };
      } else if (op.op === "arc") {
        const arcStart = op.full ? 0 : sweepThrough(op.a0, op.a1, op.through).start;
        const startPt = pointOnArc(op, arcStart);
        if (!cursor || dist(cursor, startPt) > 1e-6) {
          cursor = { ...startPt };
          points.push({ ...cursor });
        }
        const budget = { count: 0, max: maxSegmentsPerCurve, capped: false };
        flattenArc(op, toleranceIn, points, budget);
        if (budget.capped) cappedCurves += 1;
        const end = points[points.length - 1];
        cursor = end ? { ...end } : cursor;
      }
      if (points.length > MAX_FLAT_POINTS) {
        throw new VsdxImportError("A shape's geometry exceeds the flattened-point cap — the file may be pathological.", {
          code: "geometry-too-large",
        });
      }
    }
    // Dedupe consecutive points.
    const clean = [];
    for (const p of points) {
      const last = clean[clean.length - 1];
      if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) clean.push(p);
    }
    if (clean.length === 0) continue;
    const first = clean[0];
    const last = clean[clean.length - 1];
    const closed = clean.length > 2 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6;
    result.push({ points: closed ? clean.slice(0, -1) : clean, closed, allLines: sp.allLines });
  }
  if (cappedCurves > 0 && typeof onWarning === "function") {
    onWarning(
      `${cappedCurves} curve${cappedCurves === 1 ? "" : "s"} hit the ${maxSegmentsPerCurve}-segment-per-curve cap — the ${toleranceIn}-inch flattening tolerance may not be met; geometry is approximated.`,
    );
  }
  return result;
}
