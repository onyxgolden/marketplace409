/**
 * The SOLE coordinate conversion boundary for the VSDX importer.
 *
 * Visio space: inches, origin bottom-left, Y-up.
 * Designer space: inches, origin top-left, Y-down.
 *
 *   designerX = visioX
 *   designerY = pageHeightIn − visioY
 *
 * No other module negates, flips, or mirrors Y. Transforms, geometry, and
 * arcs are all computed in Visio Y-up space; only finished polylines cross
 * this boundary.
 */

import { applyToPoint } from "./visioTransforms";

/**
 * Convert a page-space (Visio Y-up) point to Designer (Y-down) coordinates.
 */
export function toDesignerPoint(visioPoint, pageHeightIn) {
  return {
    x: round6(visioPoint.x),
    y: round6(pageHeightIn - visioPoint.y),
  };
}

/**
 * Convert a flattened polyline: apply the shape's page-space transform first,
 * then cross the Y boundary. Returns [{x,y}...] in Designer inches.
 */
export function toDesignerPolyline(visioPoints, pageMatrix, pageHeightIn) {
  return visioPoints.map((p) => toDesignerPoint(applyToPoint(pageMatrix, p), pageHeightIn));
}

/** Designer-space bounds of a set of polylines, or null when empty. */
export function designerBounds(polylines) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of polylines) {
    for (const p of line) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
