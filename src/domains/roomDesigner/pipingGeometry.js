// Pure piping geometry for the FORGE designer (Phase 2: piping mode).
//
// Pipe runs are polylines in plan inches: [{x, y}, ...]. All functions
// here are pure and unit-tested; the document operations that use them
// live in designerDocument.js.

import { isValidPoint } from "./designerGeometry";

/** Nominal pipe sizes offered for new runs, in inches. */
export const PIPE_DIAMETERS_IN = Object.freeze([
  0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8, 10, 12, 16,
]);

/** Common pipe materials offered as presets (free text stays allowed). */
export const PIPE_MATERIALS = Object.freeze([
  "Carbon steel",
  "Stainless steel",
  "Copper",
  "PVC",
  "CPVC",
  "HDPE",
  "Galvanized steel",
  "Cast iron",
]);

/** Common line services offered as presets (free text stays allowed). */
export const PIPE_SERVICES = Object.freeze([
  "Process",
  "Steam",
  "Condensate",
  "Cooling water",
  "Chilled water",
  "Instrument air",
  "Natural gas",
  "Drain/waste",
]);

/** Discipline layers, Visio-style: objects carry one; the canvas can
 *  filter each layer's visibility. */
export const PIPE_LAYERS = Object.freeze(["piping", "equipment", "annotations"]);

/** Vertices closer than this are treated as the same point (inches). */
export const MIN_PIPE_SEGMENT_IN = 0.5;

/** Total centerline length of a pipe-run polyline, in inches. */
export function pipeRunLengthIn(points) {
  const pts = (points || []).filter(isValidPoint);
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return total;
}

/**
 * Drop invalid points and collapse consecutive points closer than
 * minDistIn (e.g. the doubled final click of a double-click-to-finish).
 * Returns fresh {x, y} points.
 */
export function dedupeConsecutivePoints(points, minDistIn = MIN_PIPE_SEGMENT_IN) {
  const pts = (points || []).filter(isValidPoint);
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDistIn) {
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

/**
 * Orthogonal (90°) snap for pipe vertices: when the user draws with the
 * ortho option on, the new vertex locks to the horizontal or vertical
 * line through the previous vertex, whichever the pointer is closer to.
 * Pure.
 */
export function applyOrthoSnap(prev, candidate) {
  const fallback = isValidPoint(candidate) ? { x: candidate.x, y: candidate.y } : { x: 0, y: 0 };
  if (!isValidPoint(prev)) return fallback;
  const dx = candidate.x - prev.x;
  const dy = candidate.y - prev.y;
  if (dx === 0 && dy === 0) return { x: prev.x, y: prev.y };
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: candidate.x, y: prev.y }
    : { x: prev.x, y: candidate.y };
}

/**
 * Total pipe length grouped by nominal diameter: { "2": 240, "4": 96 }
 * with lengths in inches. Diameters are normalized to 2-decimal keys so
 * 2 and 2.0 group together.
 */
export function pipeLengthByDiameter(pipeRuns) {
  const totals = {};
  for (const run of pipeRuns || []) {
    const d = Number(run?.diameterIn);
    if (!(d > 0)) continue;
    const key = String(Math.round(d * 100) / 100);
    totals[key] = (totals[key] || 0) + pipeRunLengthIn(run.points);
  }
  return totals;
}

/**
 * The longest segment of a run ({ a, b, length }), used to place the
 * dimension label. Null when the run has fewer than two valid points.
 */
export function longestPipeSegment(points) {
  const pts = (points || []).filter(isValidPoint);
  let best = null;
  for (let i = 1; i < pts.length; i += 1) {
    const length = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (!best || length > best.length) best = { a: pts[i - 1], b: pts[i], length };
  }
  return best;
}
