// Area and perimeter of a traced polygon, for the Measure tool's Area mode.
// Pure: no React, no design data. Points are plan inches, the same space the Designer uses everywhere.

import { polygonArea } from "@/domains/roomDesigner/designerGeometry";

/**
 * Area (sq ft) and closed perimeter (inches) of a polygon given as plan-inch points.
 * Returns null when there are fewer than three points, since that is not an area.
 */
export function measureAreaSummary(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  let perimeterIn = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    perimeterIn += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return { areaSqFt: polygonArea(points) / 144, perimeterIn };
}
