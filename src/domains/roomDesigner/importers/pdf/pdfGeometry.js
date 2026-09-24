/**
 * Pure geometry for the PDF importer: 2-D affine matrices and curve
 * flattening. No pdf.js, no DOM — every function here is a plain-numbers
 * transform, which is what makes the conversion unit-testable.
 *
 * Matrices use the PDF / pdf.js convention, a flat 6-tuple
 *   [a, b, c, d, e, f]  ⇒  x' = a·x + c·y + e,  y' = b·x + d·y + f
 * which is the same ordering as a PDF `cm` operator and as
 * pdf.js's OPS.transform arguments, so operator arguments can be consumed
 * without re-ordering.
 *
 * Flattening tolerance is expressed in PDF points (1/72 inch) because that
 * is the space curves arrive in; the caller converts to inches afterwards at
 * the single coordinate boundary (pdfCoordinates.js).
 */

import { PdfImportError } from "./pdfErrors";

export const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 1, 0, 0]);

/** Flattening chord tolerance in PDF points (~1/100 inch). */
export const FLATTEN_TOLERANCE_PT = 0.72;

/** Hard cap on segments produced for a single curve. */
export const MAX_SEGMENTS_PER_CURVE = 64;

/** Hard cap on de Casteljau subdivision depth for a single curve. */
export const MAX_CURVE_DEPTH = 24;

/** Hard cap on points in one flattened subpath (pathological-file guard). */
export const MAX_POINTS_PER_SUBPATH = 20000;

const EPS = 1e-9;

export function isFinitePoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** m1 then m2 (i.e. apply m1 first): the product used when pushing a `cm`. */
export function multiplyMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function applyMatrix(m, point) {
  return {
    x: m[0] * point.x + m[2] * point.y + m[4],
    y: m[1] * point.x + m[3] * point.y + m[5],
  };
}

/**
 * Uniform scale magnitude of a matrix: the geometric mean of the two axis
 * scales (|det|^(1/2)). Used to convert stroke widths, which are defined in
 * user space, into page space without picking an arbitrary axis.
 */
export function matrixScale(m) {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
  return Math.sqrt(det);
}

/** Is the matrix usable? Guards against non-finite operator arguments. */
export function isFiniteMatrix(m) {
  return Array.isArray(m) && m.length === 6 && m.every((v) => Number.isFinite(v));
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Perpendicular distance from `p` to the infinite line through a→b, or the
 * point distance when a and b coincide. Flatness measure for curve recursion.
 */
function distanceToLine(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return dist(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/**
 * Adaptive cubic Bézier flattening: subdivide while either control point is
 * farther than `tolerance` from the chord. Appends to `out` (never the start
 * point, which the caller already emitted).
 *
 * The segment budget BOUNDS THE RECURSION, it does not merely count it. Every
 * leaf — including one emitted because the budget ran out — increments
 * `budget.count`, so once the budget is spent no node can subdivide and the
 * subdivision tree collapses to leaves: total work is O(budget.max) whatever
 * the control points are. A budget that only counted flat leaves would leave
 * the tree free to expand exponentially while the count stood still, which on
 * a hostile file is a hung tab rather than a coarse curve.
 *
 * `depth` is a second, independent guard against a branch that never reaches
 * the flatness test because subdivision has stalled in floating point.
 */
export function flattenCubic(p0, p1, p2, p3, tolerance, out, budget, depth = 0) {
  const exhausted = budget.count >= budget.max || depth >= MAX_CURVE_DEPTH;
  const flat =
    distanceToLine(p1, p0, p3) <= tolerance && distanceToLine(p2, p0, p3) <= tolerance;
  if (exhausted || flat) {
    if (exhausted && !flat) budget.capped = true;
    budget.count += 1;
    out.push({ x: p3.x, y: p3.y });
    return;
  }
  // de Casteljau split at t = 0.5
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  flattenCubic(p0, p01, p012, p0123, tolerance, out, budget, depth + 1);
  flattenCubic(p0123, p123, p23, p3, tolerance, out, budget, depth + 1);
}

/** Quadratic Bézier → equivalent cubic, then flattened. */
export function flattenQuadratic(p0, p1, p2, tolerance, out, budget) {
  const c1 = { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) };
  const c2 = { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) };
  flattenCubic(p0, c1, c2, p2, tolerance, out, budget);
}

/** Drop consecutive duplicate points (within EPS). */
export function dedupePoints(points, epsilon = 1e-6) {
  const clean = [];
  for (const p of points) {
    const last = clean[clean.length - 1];
    if (!last || Math.abs(last.x - p.x) > epsilon || Math.abs(last.y - p.y) > epsilon) {
      clean.push(p);
    }
  }
  return clean;
}

/**
 * Collapse runs of nearly-collinear points, so a flattened curve or a
 * stair-stepped export does not become dozens of one-pixel wall segments.
 * Ramer–Douglas–Peucker with an explicit tolerance; endpoints are kept.
 */
export function simplifyPolyline(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2 || !(tolerance > 0)) {
    return Array.isArray(points) ? [...points] : [];
  }
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Iterative RDP: an explicit stack keeps deep polylines off the call stack.
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    if (end <= start + 1) continue;
    let worst = -1;
    let worstDistance = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToLine(points[i], points[start], points[end]);
      if (d > worstDistance) {
        worstDistance = d;
        worst = i;
      }
    }
    if (worstDistance > tolerance && worst > 0) {
      keep[worst] = true;
      stack.push([start, worst], [worst, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Flatten one parsed subpath (see pdfPageOps.js) into a polyline in PAGE
 * space: every point is pushed through `matrix` first, then curves are
 * flattened. Transforming before flattening is deliberate — flattening in
 * user space and transforming afterwards would apply the tolerance in the
 * wrong space, so a scaled-down form XObject would be over-tessellated and a
 * scaled-up one visibly faceted.
 *
 * Returns { points, closed } with consecutive duplicates removed, or null
 * when the subpath has no drawable geometry.
 */
export function flattenSubpath(subpath, matrix, { tolerance = FLATTEN_TOLERANCE_PT, onWarning } = {}) {
  const tp = (x, y) => applyMatrix(matrix, { x, y });
  const points = [];
  let cursor = null;
  let capped = false;

  for (const op of subpath.ops || []) {
    if (op.op === "move" || op.op === "line") {
      cursor = tp(op.x, op.y);
      points.push(cursor);
    } else if (op.op === "cubic") {
      const p0 = cursor || tp(op.x1, op.y1);
      const budget = { count: 0, max: MAX_SEGMENTS_PER_CURVE, capped: false };
      flattenCubic(p0, tp(op.x1, op.y1), tp(op.x2, op.y2), tp(op.x, op.y), tolerance, points, budget);
      if (budget.capped) capped = true;
      cursor = points[points.length - 1] || cursor;
    } else if (op.op === "quadratic") {
      const p0 = cursor || tp(op.x1, op.y1);
      const budget = { count: 0, max: MAX_SEGMENTS_PER_CURVE, capped: false };
      flattenQuadratic(p0, tp(op.x1, op.y1), tp(op.x, op.y), tolerance, points, budget);
      if (budget.capped) capped = true;
      cursor = points[points.length - 1] || cursor;
    }
    if (points.length > MAX_POINTS_PER_SUBPATH) {
      throw new PdfImportError(
        "A path exceeds the flattened-point cap — the PDF may be pathological.",
        { code: "geometry-too-large" },
      );
    }
  }

  if (capped && typeof onWarning === "function") {
    onWarning(
      `A curve hit the ${MAX_SEGMENTS_PER_CURVE}-segment cap — that curve is approximated more coarsely than the ${FLATTEN_TOLERANCE_PT}pt tolerance.`,
    );
  }

  const finite = points.filter(isFinitePoint);
  if (finite.length !== points.length && typeof onWarning === "function") {
    onWarning("A path contained non-finite coordinates; those points were dropped.");
  }
  const clean = dedupePoints(finite);
  if (clean.length === 0) return null;

  // An explicitly closed subpath whose last point already equals the first
  // carries the duplicate only as a drawing artifact: drop it and record
  // closure as a flag, matching the VSDX importer's polyline contract.
  let closed = !!subpath.closed;
  if (clean.length > 2) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
      clean.pop();
      closed = true;
    }
  }
  if (clean.length === 0) return null;
  return { points: clean, closed };
}
