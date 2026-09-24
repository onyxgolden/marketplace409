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
import { findSymbol } from "./symbolRegistry";
import { STAIR_ANNOTATION_SOURCE } from "./sampleProjects";

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
 * Stairs: native 3D stair descriptors from the building-elements stair
 * symbols (stairs-straight / stairs-l / stairs-u), with a legacy fallback
 * for the sample's pre-symbol stair annotations.
 *
 * Pure and serializable: plain JSON, no three.js, camera-independent —
 * the same contract as furnitureToBox. The renderer owns geometry.
 *
 * Local frame (arch review: explicit convention): origin at the stair
 * footprint center; local +x is the ascent direction of the first run;
 * local +z is the stair width. Multi-run parts carry their own dir
 * ("positive-x" | "negative-x" | "positive-z" | "negative-z").
 *
 * Descriptor:
 * { kind:"stairs", id, type, x, z, rotY, axis:"local-x",
 *   runDirection:"positive-x", widthIn, runIn, riseIn, baseElevationIn,
 *   validGeometry, warnings[], parts[] }
 * Run part:
 * { kind:"run", x0, z0, dx, dz, dir, widthIn, y0, riseIn, steps, treadIn, riserIn }
 *   (x0,z0) = plan corner where the ascent starts; dx/dz signed extents.
 * Landing part:
 * { kind:"landing", x0, z0, dx, dz, y0, thicknessIn } (y0 = top surface).
 *
 * baseElevationIn is the slice-2 hook: 0 today (single-level 3D has no
 * upper slab), the level's elevation when levels stack. warnings is
 * non-blocking honesty metadata — the renderer still draws unrealistic
 * geometry, it just doesn't pretend it's valid.
 */

/** Max riser height (in) used when deriving step counts. */
export const STAIR_MAX_RISER_IN = 7.75;
/** Recommended minimum tread depth (in); shallower runs warn, never block. */
export const STAIR_MIN_TREAD_IN = 10;

const STAIR_SYMBOL_TYPES = Object.freeze({
  "stairs-straight": "straight",
  "stairs-l": "l",
  "stairs-u": "u",
});

function stairRunPart({ x0, z0, dx, dz, dir, widthIn, y0, riseIn }) {
  // Run length is along the ascent axis named by dir; the other axis is width.
  const length = dir === "positive-x" || dir === "negative-x" ? Math.abs(dx) : Math.abs(dz);
  const steps = Math.max(1, Math.ceil(riseIn / STAIR_MAX_RISER_IN));
  const treadIn = length / steps;
  const riserIn = riseIn / steps;
  return { kind: "run", x0, z0, dx, dz, dir, widthIn, y0, riseIn, steps, treadIn, riserIn };
}

function stairLandingPart({ x0, z0, dx, dz, y0, thicknessIn = 4 }) {
  return { kind: "landing", x0, z0, dx, dz, y0, thicknessIn };
}

function straightStairParts(runIn, widthIn, riseIn) {
  return [
    stairRunPart({ x0: -runIn / 2, z0: -widthIn / 2, dx: runIn, dz: widthIn, dir: "positive-x", widthIn, y0: 0, riseIn }),
  ];
}

function lStairParts(w, d, riseIn) {
  const runW = 0.55 * d;
  const half = riseIn / 2;
  return [
    stairRunPart({ x0: -w / 2, z0: -d / 2, dx: 0.625 * w, dz: runW, dir: "positive-x", widthIn: runW, y0: 0, riseIn: half }),
    stairLandingPart({ x0: w / 8, z0: -d / 2, dx: runW, dz: runW, y0: half }),
    stairRunPart({ x0: w / 8, z0: -d / 2 + runW, dx: runW, dz: d / 2 - (-d / 2 + runW), dir: "positive-z", widthIn: runW, y0: half, riseIn: half }),
  ];
}

function uStairParts(w, d, riseIn) {
  const runW = 0.325 * d;
  const half = riseIn / 2;
  return [
    stairRunPart({ x0: w / 2, z0: -d / 2, dx: -w, dz: runW, dir: "negative-x", widthIn: runW, y0: 0, riseIn: half }),
    stairLandingPart({ x0: -w / 2, z0: -d / 2, dx: 2 * runW, dz: 2 * runW, y0: half }),
    stairRunPart({ x0: -w / 2, z0: d / 2 - runW, dx: w, dz: runW, dir: "positive-x", widthIn: runW, y0: half, riseIn: half }),
  ];
}

/** Non-blocking geometry honesty: warn, never refuse to describe. */
function stairWarnings(parts) {
  const warnings = [];
  for (const p of parts) {
    if (p.kind === "run" && p.treadIn < STAIR_MIN_TREAD_IN) {
      warnings.push(
        `Tread depth ${p.treadIn.toFixed(1)}" below recommended minimum ${STAIR_MIN_TREAD_IN}" — drawn as designed, verify against code.`,
      );
    }
  }
  return warnings;
}

function legacyStairBoxes(annotations) {
  const boxes = [];
  for (const a of annotations || []) {
    if (a.source !== STAIR_ANNOTATION_SOURCE || a.kind !== "path" || !a.closed) continue;
    const xs = a.points.map((p) => p.x);
    const ys = a.points.map((p) => p.y);
    if (xs.length === 0) continue;
    boxes.push({
      id: a.id,
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys),
    });
  }
  return boxes;
}

/**
 * Legacy stair annotation -> descriptor. Convention (documented): the run
 * follows the box's long axis, ascending toward increasing plan Y. Only
 * the Maplewood sample ever carries these annotations; native symbols
 * always win when both exist.
 */
function legacyStairDescriptor(box, riseIn) {
  const wX = box.x2 - box.x1;
  const wY = box.y2 - box.y1;
  const alongY = wY >= wX;
  const run = alongY ? wY : wX;
  const width = alongY ? wX : wY;
  const parts = straightStairParts(run, width, riseIn);
  const warnings = stairWarnings(parts);
  return {
    kind: "stairs",
    id: `legacy-${box.id}`,
    type: "straight",
    x: (box.x1 + box.x2) / 2,
    z: (box.y1 + box.y2) / 2,
    rotY: alongY ? -Math.PI / 2 : 0, // local +x -> plan +y, like rotationDeg 90
    axis: "local-x",
    runDirection: "positive-x",
    widthIn: width,
    runIn: run,
    riseIn,
    baseElevationIn: 0,
    validGeometry: warnings.length === 0,
    warnings,
    parts,
    legacy: true,
  };
}

/**
 * Stair descriptors for a design document. Native stair symbol placements
 * (priority 1); legacy stair annotations only when no native stair exists
 * (priority 2, arch review). Returns [] when the design has no stairs.
 */
export function stairsDescriptors(design) {
  if (!design) return [];
  const riseIn = design.settings?.wallHeightIn ?? 108;
  const out = [];
  for (const s of design.symbols || []) {
    const type = STAIR_SYMBOL_TYPES[s.symbolId];
    if (!type) continue;
    const symbol = findSymbol(s.domain, s.symbolId);
    const run = s.widthIn ?? symbol?.widthIn;
    const width = s.depthIn ?? symbol?.depthIn;
    if (!run || !width) continue;
    const parts =
      type === "straight"
        ? straightStairParts(run, width, riseIn)
        : type === "l"
          ? lStairParts(run, width, riseIn)
          : uStairParts(run, width, riseIn);
    const warnings = stairWarnings(parts);
    out.push({
      kind: "stairs",
      id: s.id,
      type,
      x: s.x,
      z: s.y,
      // screen-space clockwise degrees -> three.js counter-clockwise radians
      rotY: (-(s.rotationDeg || 0) * Math.PI) / 180,
      axis: "local-x",
      runDirection: "positive-x",
      widthIn: width,
      runIn: run,
      riseIn,
      baseElevationIn: 0,
      validGeometry: warnings.length === 0,
      warnings,
      parts,
    });
  }
  if (out.length === 0) {
    for (const box of legacyStairBoxes(design.annotations)) {
      out.push(legacyStairDescriptor(box, riseIn));
    }
  }
  return out;
}

/**
 * Full scene descriptor for a design:
 * { walls: [...segments], glass: [...window panes], furniture: [...boxes], stairs: [...], floor: {minX,minZ,maxX,maxZ}|null }
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
  const stairs = stairsDescriptors(design);

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
  return { walls, glass, furniture, stairs, floor };
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

// ---------------------------------------------------------------------------
// Selection <-> 3D highlight mapping (P1-A: split-screen view sync)
//
// The 3D viewport tags every mesh it builds with a registry key so a 2D
// selection can find and highlight the matching mesh(es) without rebuilding
// the scene. This mapping — which registry key(s) a given 2D selection
// corresponds to — is pure and framework-free, so it belongs here rather
// than in the DesignerViewport3D component, and is unit-testable against
// plain design objects with no Three.js or DOM involved.
// ---------------------------------------------------------------------------

/** Registry key for a highlightable 3D entity. */
export function highlightRegistryKey(kind, id) {
  return `${kind}:${id}`;
}

/**
 * Which highlight-registry keys does a 2D selection correspond to in 3D?
 *
 * A room has no 3D mesh of its own — it highlights via its own walls. An
 * opening highlights via its window glass/sill/header (a door is an open
 * gap with no mesh, so it has nothing to highlight — that is correct
 * behavior, not a gap in coverage). Symbols and pipes have no 3D
 * representation yet (buildThreeScene does not emit meshes for them), so
 * selecting one maps to no keys — a deliberate no-op, not an oversight.
 */
export function highlightKeysForSelection(selection, design) {
  if (!selection || !selection.kind) return [];
  if (selection.kind === "wall") return [highlightRegistryKey("wall", selection.id)];
  if (selection.kind === "opening") return [highlightRegistryKey("opening", selection.id)];
  if (selection.kind === "furniture") return [highlightRegistryKey("furniture", selection.id)];
  if (selection.kind === "room") {
    const room = (design?.rooms || []).find((r) => r.id === selection.id);
    return (room?.wallIds || []).map((id) => highlightRegistryKey("wall", id));
  }
  return [];
}
