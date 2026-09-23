// Pure 3D scene description for the FORGE room/layout designer.
//
// Converts a 2D design document into renderable primitives WITHOUT touching
// WebGL, so the geometry stays unit-testable. The React component
// (DesignerViewport3D) maps these descriptors to three.js meshes.
//
// Plan coordinates map to three.js as x -> x, y -> z (plan "down" becomes
// +z, which reads naturally in an orbit view). All units are inches.

import { getCatalogEntry } from "./furnitureCatalog";
import {
  nearestPointOnSegment,
  wallDirection,
  wallLength,
} from "./designerGeometry";
import { findWall, pieceSize } from "./designerDocument";

export const WINDOW_SILL_IN = 36;
export const WINDOW_HEADER_IN = 84;

/**
 * Split a wall into solid segments around its openings.
 * Doors leave a full-height gap; windows leave a gap between the sill and
 * header, with solid boxes below and above. Returns segment descriptors:
 * { a, b, y0In, y1In, wallId, kind: "wall"|"sill"|"header", openingId? }
 */
export function splitWallByOpenings(wall, openings, { wallHeightIn }) {
  const length = wallLength(wall);
  const dir = wallDirection(wall);
  const at = (offsetIn) => ({
    x: wall.a.x + dir.x * offsetIn,
    y: wall.a.y + dir.y * offsetIn,
  });
  const sorted = [...openings]
    .filter((o) => o.wallId === wall.id)
    .sort((p, q) => p.offsetIn - q.offsetIn);

  const segments = [];
  let cursor = 0;
  const pushSolid = (from, to, kind, openingId) => {
    if (to - from < 0.5) return;
    segments.push({
      a: at(from),
      b: at(to),
      y0In: 0,
      y1In: wallHeightIn,
      wallId: wall.id,
      kind,
      ...(openingId ? { openingId } : {}),
    });
  };

  for (const opening of sorted) {
    const start = Math.max(opening.offsetIn, 0);
    const end = Math.min(opening.offsetIn + opening.widthIn, length);
    if (end <= start) continue;
    pushSolid(cursor, start, "wall");
    if (opening.type === "window") {
      const sillTop = Math.min(WINDOW_SILL_IN, wallHeightIn);
      const headerBottom = Math.min(WINDOW_HEADER_IN, wallHeightIn);
      if (sillTop > 0.5) {
        segments.push({
          a: at(start), b: at(end), y0In: 0, y1In: sillTop,
          wallId: wall.id, kind: "sill", openingId: opening.id,
        });
      }
      if (headerBottom < wallHeightIn - 0.5) {
        segments.push({
          a: at(start), b: at(end), y0In: headerBottom, y1In: wallHeightIn,
          wallId: wall.id, kind: "header", openingId: opening.id,
        });
      }
    }
    // doors: full-height gap, no segments emitted
    cursor = end;
  }
  pushSolid(cursor, length, "wall");
  return segments;
}

/** Window glass descriptors: one plane per window opening, spanning the gap
 * between the sill and header at the wall centerline.
 * { a, b, y0In, y1In, thicknessIn, wallId, openingId } */
export function windowGlassForWall(wall, openings, { wallHeightIn, wallThicknessIn }) {
  const length = wallLength(wall);
  const dir = wallDirection(wall);
  const glass = [];
  for (const opening of openings || []) {
    if (opening.wallId !== wall.id || opening.type !== "window") continue;
    const start = Math.max(opening.offsetIn, 0);
    const end = Math.min(opening.offsetIn + opening.widthIn, length);
    if (end - start < 0.5) continue;
    const y0In = Math.min(WINDOW_SILL_IN, wallHeightIn);
    const y1In = Math.min(WINDOW_HEADER_IN, wallHeightIn);
    if (y1In - y0In < 0.5) continue;
    glass.push({
      a: { x: wall.a.x + dir.x * start, y: wall.a.y + dir.y * start },
      b: { x: wall.a.x + dir.x * end, y: wall.a.y + dir.y * end },
      y0In,
      y1In,
      thicknessIn: wallThicknessIn,
      wallId: wall.id,
      openingId: opening.id,
    });
  }
  return glass;
}

/** Furniture piece -> 3D box descriptor. */
export function furnitureToBox(piece) {
  const catalog = getCatalogEntry(piece.catalogId);
  if (!catalog) return null;
  const { widthIn, depthIn } = pieceSize(piece);
  return {
    kind: "furniture",
    id: piece.id,
    catalogId: piece.catalogId,
    label: catalog.label,
    x: piece.x,
    z: piece.y,
    widthIn,
    depthIn,
    heightIn: catalog.heightIn,
    // screen-space clockwise degrees -> three.js counter-clockwise radians
    rotY: (-piece.rotationDeg * Math.PI) / 180,
    color: catalog.color,
    symbol: catalog.symbol,
  };
}

/**
 * Full scene descriptor for a design:
 * { walls: [...segments], glass: [...window panes], furniture: [...boxes], floor: {minX,minZ,maxX,maxZ}|null }
 */
export function buildThreeScene(design) {
  if (!design || !Array.isArray(design.walls)) {
    throw new Error("Not a room-designer document.");
  }
  const wallHeightIn = design.settings?.wallHeightIn ?? 108;
  const wallThicknessIn = design.settings?.wallThicknessIn ?? 4.5;

  const walls = [];
  const glass = [];
  for (const wall of design.walls) {
    const segments = splitWallByOpenings(wall, design.openings || [], { wallHeightIn });
    for (const s of segments) {
      walls.push({ ...s, thicknessIn: wallThicknessIn });
    }
    glass.push(...windowGlassForWall(wall, design.openings || [], { wallHeightIn, wallThicknessIn }));
  }
  const furniture = (design.furniture || [])
    .map(furnitureToBox)
    .filter(Boolean);

  let floor = null;
  const xs = [];
  const zs = [];
  for (const wall of design.walls) {
    xs.push(wall.a.x, wall.b.x);
    zs.push(wall.a.y, wall.b.y);
  }
  for (const f of furniture) {
    xs.push(f.x - f.widthIn / 2, f.x + f.widthIn / 2);
    zs.push(f.z - f.depthIn / 2, f.z + f.depthIn / 2);
  }
  if (xs.length > 0) {
    const pad = 24;
    floor = {
      minX: Math.min(...xs) - pad,
      maxX: Math.max(...xs) + pad,
      minZ: Math.min(...zs) - pad,
      maxZ: Math.max(...zs) + pad,
    };
  }
  return { walls, glass, furniture, floor };
}

/** Find the wall whose centerline is nearest to a plan point (for picking). */
export function pickWallAt(design, point, maxDistanceIn = 12) {
  let best = null;
  let bestDistance = maxDistanceIn;
  for (const wall of design.walls || []) {
    const { point: nearest } = nearestPointOnSegment(point, wall.a, wall.b);
    const distance = Math.hypot(point.x - nearest.x, point.y - nearest.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = wall;
    }
  }
  return best;
}

export { findWall };
