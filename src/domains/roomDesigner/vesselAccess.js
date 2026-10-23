// Vessel manways and their access package (catwalk + ladder).
//
// Every vessel catalog entry carries a manway spec:
//   manway: { fx, fy, diameterIn, sillIn }
// (fx, fy) is the manway center on the footprint in the same fractional
// frame as nozzle specs (pipeAttachments.js); diameterIn is the opening
// diameter; sillIn is the height of the BOTTOM of the opening (the sill
// a worker steps over) above the vessel BASE.
//
// Grade datum (PR668-003): the access rule measures the sill ABOVE
// GRADE, not above the vessel base:
//
//   sillAboveGrade = baseElevation + manwayLocalSill - gradeElevation
//
// A vessel base sits at grade unless the instance raises it
// (`inst.baseElevationIn`); the plot grade is `design.gradeElevationIn`
// (0 when unset). The deck rides at the sill's world elevation
// (base + sill); the ladder climbs from grade.
//
// Access rule (D5): a manway whose sill is MORE than 24 in above grade
// gains a steel catwalk — a grating deck at sill level beside the
// manway — with an access ladder from grade to the deck. At or under
// 24 in there is no package. The package is derived from the manway,
// never stored, so moving/resizing a vessel across the 2 ft line adds
// or removes it automatically. An instance may override the catalog
// spec via `inst.manway` (partial), DELETE it via `inst.manway = null`
// or `{ deleted: true }` (D668-007 tombstone — null no longer silently
// restores the catalog default), and may suppress the package with
// `inst.noAccess` — validation then flags an unsuppressed sill over
// 24 in with no catwalk.
//
// Deck geometry contract (D668-001): every access-package deck —
// vessel manway or downcomer platform — carries world-plan `corners`
// computed by the shared deckCorners() below, so 3D/plan/print all
// consume the same shape.
//
// Pure and framework-free.

import { findSymbol } from "./symbolRegistry";
import { catalogAnchorsWorld } from "./pipeAttachments";
import { physicalRouteIn } from "./pipeCrossings";

/** Sill height (in above grade) that triggers the access package. */
export const MANWAY_ACCESS_TRIGGER_IN = 24;
/** Catwalk deck size: width along the vessel (tangential), depth outward. */
export const CATWALK_WIDTH_IN = 48;
export const CATWALK_DEPTH_IN = 36;
/** Access ladder width (in). */
export const LADDER_WIDTH_IN = 18;
/** Working clearance around a deck for obstruction checks (in). */
export const ACCESS_WORKING_CLEARANCE_IN = 12;
/** Bounded placement search: compass orientations tried around the manway. */
export const ACCESS_SEARCH_ORIENTATIONS = 8;

/**
 * The shared deck-corner contract (D668-001): world-plan corners of a
 * rectangular deck part { cx, cy, angleDeg, widthIn, depthIn }.
 * Vessel decks AND downcomer platform decks both carry these, so the
 * 3D builder never iterates a cornerless deck.
 */
export function deckCorners(part) {
  const rad = ((part.angleDeg || 0) * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const vx = -Math.sin(rad);
  const vy = Math.cos(rad);
  const hw = (part.widthIn || 0) / 2;
  const hd = (part.depthIn || 0) / 2;
  return [
    { x: part.cx - ux * hd - vx * hw, y: part.cy - uy * hd - vy * hw },
    { x: part.cx + ux * hd - vx * hw, y: part.cy + uy * hd - vy * hw },
    { x: part.cx + ux * hd + vx * hw, y: part.cy + uy * hd + vy * hw },
    { x: part.cx - ux * hd + vx * hw, y: part.cy - uy * hd + vy * hw },
  ];
}

/** Plot grade elevation (in); 0 when the design sets none. */
export function gradeElevationIn(design) {
  return Number.isFinite(design?.gradeElevationIn) ? design.gradeElevationIn : 0;
}

/** Vessel base elevation above grade (in); 0 when the instance sets none. */
export function baseElevationIn(inst) {
  return Number.isFinite(inst?.baseElevationIn) ? inst.baseElevationIn : 0;
}

/**
 * Catalog manway spec merged with the instance override, or null.
 * D668-007 tombstone: `inst.manway = null` or `{ deleted: true }`
 * explicitly deletes the catalog manway — it no longer silently falls
 * back to the catalog default.
 */
export function manwaySpec(symbol, inst) {
  if (!symbol?.manway) return null;
  if (inst?.manway === null || inst?.manway?.deleted === true) return null;
  const override = inst?.manway && typeof inst.manway === "object" ? inst.manway : {};
  return { ...symbol.manway, ...override };
}

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * The manway resolved in the instance's LOCAL frame (inches, origin at
 * the footprint center, +x east / +y south before rotation):
 * { lx, ly, dirX, dirY, diameterIn, sillIn } — (dirX, dirY) is the
 * outward unit direction through the manway center; a center manway
 * (0, 0) faces south by convention. sillIn is above the vessel BASE.
 */
export function manwayLocal(symbol, inst) {
  const spec = manwaySpec(symbol, inst);
  if (!spec) return null;
  const effWidth = inst?.widthIn ?? symbol.widthIn;
  const effDepth = inst?.depthIn ?? symbol.depthIn;
  const lx = num(spec.fx, 0) * (effWidth / 2);
  const ly = num(spec.fy, 0) * (effDepth / 2);
  const len = Math.hypot(spec.fx || 0, spec.fy || 0);
  const dirX = len > 0 ? spec.fx / len : 0;
  const dirY = len > 0 ? spec.fy / len : 1;
  return {
    lx,
    ly,
    dirX,
    dirY,
    diameterIn: num(spec.diameterIn, 24),
    sillIn: num(spec.sillIn, 0),
  };
}

/**
 * The manway sill ABOVE GRADE (PR668-003):
 *   baseElevation + manwayLocalSill - gradeElevation
 * Null when the instance has no manway (none in catalog, or deleted
 * via the D668-007 tombstone).
 */
export function sillAboveGradeIn(design, inst) {
  const symbol = findSymbol(inst?.domain, inst?.symbolId);
  const spec = manwaySpec(symbol, inst);
  if (!spec) return null;
  return baseElevationIn(inst) + num(spec.sillIn, 0) - gradeElevationIn(design);
}

/** Rotate a local point into world plan coordinates for an instance. */
export function localToWorld(inst, lx, ly) {
  const rad = ((inst?.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: (inst?.x || 0) + lx * cos - ly * sin, y: (inst?.y || 0) + lx * sin + ly * cos };
}

/** The manway in world plan coordinates, or null. sillIn stays local (above base). */
export function manwayWorld(symbol, inst) {
  const local = manwayLocal(symbol, inst);
  if (!local) return null;
  const p = localToWorld(inst, local.lx, local.ly);
  const rad = ((inst?.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: p.x,
    y: p.y,
    dirX: local.dirX * cos - local.dirY * sin,
    dirY: local.dirX * sin + local.dirY * cos,
    diameterIn: local.diameterIn,
    sillIn: local.sillIn,
  };
}

/**
 * The access package for a manway given in the LOCAL frame:
 * { deck: { cx, cy, angleDeg, widthIn, depthIn, elevationIn },
 *   ladder: { cx, cy, angleDeg, widthIn, fromIn, toIn } }
 *
 * manway.sillIn is the sill ABOVE GRADE — the datum the D5 rule
 * measures. The deck rides at `deckElevationIn` (world elevation;
 * defaults to the sill datum for callers at grade), its inner edge at
 * the manway point, extending outward; the ladder stands at the deck's
 * outer edge and climbs from `fromIn` (grade, or the platform below)
 * to the deck. angleDeg is the outward direction in the local plan
 * frame.
 */
export function accessPackageForManway(manway, { fromIn = 0, deckElevationIn = null } = {}) {
  if (!manway || !(manway.sillIn > MANWAY_ACCESS_TRIGGER_IN)) return null;
  const angleDeg = (Math.atan2(manway.dirY, manway.dirX) * 180) / Math.PI;
  const deck = {
    cx: manway.lx + manway.dirX * (CATWALK_DEPTH_IN / 2),
    cy: manway.ly + manway.dirY * (CATWALK_DEPTH_IN / 2),
    angleDeg,
    widthIn: CATWALK_WIDTH_IN,
    depthIn: CATWALK_DEPTH_IN,
    elevationIn: deckElevationIn ?? manway.sillIn,
  };
  const ladder = {
    cx: manway.lx + manway.dirX * CATWALK_DEPTH_IN,
    cy: manway.ly + manway.dirY * CATWALK_DEPTH_IN,
    angleDeg,
    widthIn: LADDER_WIDTH_IN,
    fromIn,
    toIn: deck.elevationIn,
  };
  return { deck, ladder };
}

/**
 * Access package for an instance's manway, LOCAL frame, or null.
 * Grade-aware (PR668-003): the D5 trigger reads the sill above grade;
 * the deck rides at the sill's world elevation (base + sill).
 */
export function accessPackageLocal(symbol, inst, design) {
  if (inst?.noAccess) return null;
  const local = manwayLocal(symbol, inst);
  if (!local) return null;
  const aboveGrade = sillAboveGradeIn(design, inst);
  if (aboveGrade === null) return null;
  return accessPackageForManway(
    { ...local, sillIn: aboveGrade },
    { fromIn: gradeElevationIn(design), deckElevationIn: baseElevationIn(inst) + local.sillIn },
  );
}

/** Access package with deck/ladder resolved to world plan coordinates. */
export function accessPackageWorld(symbol, inst, design) {
  const pkg = accessPackageLocal(symbol, inst, design);
  if (!pkg) return null;
  const toWorld = (part) => {
    const p = localToWorld(inst, part.cx, part.cy);
    return { ...part, cx: p.x, cy: p.y, angleDeg: part.angleDeg + (inst?.rotationDeg || 0) };
  };
  const deck = toWorld(pkg.deck);
  const ladder = toWorld(pkg.ladder);
  return { deck: { ...deck, corners: deckCorners(deck) }, ladder };
}

// ---- Access envelope validation (PR668-003) ----

const rectCentroid = (corners) => ({
  x: corners.reduce((s, c) => s + c.x, 0) / corners.length,
  y: corners.reduce((s, c) => s + c.y, 0) / corners.length,
});

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distPointToSegmentSquared(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Minimum plan distance from a segment to a rectangle's corners. */
function distSegmentToRect(a, b, corners) {
  // A segment endpoint inside the rect, a rect edge crossing the
  // segment, or the rect's centroid under the segment all read as
  // zero distance.
  if (pointInPolygon(a, corners) || pointInPolygon(b, corners)) return 0;
  for (let i = 0; i < corners.length; i += 1) {
    const c0 = corners[i];
    const c1 = corners[(i + 1) % corners.length];
    if (segmentsCross(a, b, c0, c1)) return 0;
  }
  let best = Infinity;
  for (let i = 0; i < corners.length; i += 1) {
    const c0 = corners[i];
    const c1 = corners[(i + 1) % corners.length];
    best = Math.min(best, distPointToSegmentSquared(a, c0, c1), distPointToSegmentSquared(b, c0, c1));
    for (const p of [a, b]) {
      best = Math.min(best, distPointToSegmentSquared(p, c0, c1));
    }
  }
  const centroid = rectCentroid(corners);
  if (distPointToSegmentSquared(centroid, a, b) < 1e-9) return 0;
  return Math.sqrt(best);
}

/** Strict rectangle overlap (mere edge-touching does not count). */
function rectsOverlap(cornersA, cornersB, eps = 1e-6) {
  const axes = [];
  for (const corners of [cornersA, cornersB]) {
    for (let i = 0; i < corners.length; i += 1) {
      const p = corners[i];
      const q = corners[(i + 1) % corners.length];
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      const len = Math.hypot(nx, ny) || 1;
      axes.push([nx / len, ny / len]);
    }
  }
  for (const [ax, ay] of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const c of cornersA) {
      const d = c.x * ax + c.y * ay;
      if (d < minA) minA = d;
      if (d > maxA) maxA = d;
    }
    for (const c of cornersB) {
      const d = c.x * ax + c.y * ay;
      if (d < minB) minB = d;
      if (d > maxB) maxB = d;
    }
    if (maxA <= minB + eps || maxB <= minA + eps) return false;
  }
  return true;
}

/** World-plan footprint corners of an equipment instance. */
function instanceFootprint(inst, symbol) {
  const widthIn = inst?.widthIn ?? symbol?.widthIn ?? 0;
  const depthIn = inst?.depthIn ?? symbol?.depthIn ?? 0;
  return deckCorners({
    cx: inst?.x || 0,
    cy: inst?.y || 0,
    angleDeg: inst?.rotationDeg || 0,
    widthIn,
    depthIn,
  });
}

/**
 * What obstructs a candidate deck placement, or null when the
 * placement is clear. `deck` is parametric { cx, cy, angleDeg,
 * widthIn, depthIn, elevationIn } (world); `ownerId` is the vessel the
 * deck serves (its own footprint may touch the deck, never overlap
 * it). Checks, in order: the owner's own footprint, pipe runs (plan
 * distance within pipe radius + 6 in AND vertical overlap with the
 * deck slab), nozzle anchors (inside the working envelope near deck
 * elevation), other equipment footprints, and the plot boundary when
 * the design carries one.
 */
function deckObstruction(design, ownerId, deck, { inflated = true } = {}) {
  const by = inflated ? ACCESS_WORKING_CLEARANCE_IN : 0;
  const corners = deckCorners({
    ...deck,
    widthIn: deck.widthIn + by * 2,
    depthIn: deck.depthIn + by * 2,
  });
  const owner = (design?.symbols || []).find((s) => s.id === ownerId);
  const ownerSymbol = owner ? findSymbol(owner.domain, owner.symbolId) : null;
  if (owner && rectsOverlap(corners, instanceFootprint(owner, ownerSymbol))) {
    // The working envelope may touch the owner's shell; the deck
    // itself must not overlap it. Re-check uninflated before calling
    // it an obstruction.
    if (rectsOverlap(deckCorners(deck), instanceFootprint(owner, ownerSymbol))) {
      return `its own vessel ${ownerId}`;
    }
  }
  for (const run of design?.pipes || []) {
    const route = physicalRouteIn(design, run);
    const pipeR = (run.diameterIn ?? 2) / 2;
    for (let i = 0; i + 1 < route.length; i += 1) {
      const a = route[i];
      const b = route[i + 1];
      const planDist = distSegmentToRect(a, b, corners);
      if (planDist >= pipeR + 6) continue;
      const zMin = Math.min(a.zIn, b.zIn);
      const zMax = Math.max(a.zIn, b.zIn);
      if (zMax < deck.elevationIn - (pipeR + 6) || zMin > deck.elevationIn + (pipeR + 6)) continue;
      return `pipe run ${run.id}`;
    }
  }
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    for (const anchor of catalogAnchorsWorld(symbol, inst, design)) {
      if (!pointInPolygon({ x: anchor.x, y: anchor.y }, corners)) continue;
      const elev = Number.isFinite(anchor.elevationIn) ? anchor.elevationIn : deck.elevationIn;
      if (Math.abs(elev - deck.elevationIn) > 24) continue;
      return `nozzle ${anchor.id} on ${inst.id}`;
    }
    if (inst.id === ownerId) continue;
    if (rectsOverlap(corners, instanceFootprint(inst, symbol))) {
      return `equipment ${inst.id}`;
    }
  }
  if (Array.isArray(design?.plotBoundary) && design.plotBoundary.length >= 3) {
    for (const c of corners) {
      if (!pointInPolygon(c, design.plotBoundary)) {
        return "the plot boundary";
      }
    }
  }
  return null;
}

/**
 * validateDesign messages for access-package envelopes (PR668-003).
 * For each vessel manway package the DEFAULT (outward) deck placement
 * is validated against pipes, nozzles, equipment, and the plot
 * boundary. A blocked default with a clear alternative orientation is
 * a named obstruction finding (the designer moves the blocker or
 * re-orients the deck — no auto-routing); when the bounded compass
 * search finds NO clear orientation, it is a named unresolved-access
 * finding. Downcomer platforms are validated as placed (their tower
 * orientation is fixed).
 */
export function accessEnvelopeErrors(design) {
  const errors = [];
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol?.manway) continue;
    if (manwaySpec(symbol, inst) === null) continue; // none, or deleted
    if (inst.noAccess) continue;
    const aboveGrade = sillAboveGradeIn(design, inst);
    if (!(aboveGrade > MANWAY_ACCESS_TRIGGER_IN)) continue;
    const mw = manwayWorld(symbol, inst);
    if (!mw) continue;
    const baseDeck = {
      cx: mw.x + mw.dirX * (CATWALK_DEPTH_IN / 2),
      cy: mw.y + mw.dirY * (CATWALK_DEPTH_IN / 2),
      angleDeg: (Math.atan2(mw.dirY, mw.dirX) * 180) / Math.PI,
      widthIn: CATWALK_WIDTH_IN,
      depthIn: CATWALK_DEPTH_IN,
      elevationIn: baseElevationIn(inst) + mw.sillIn,
    };
    const label = `Symbol ${inst.id} (${symbol.label}) manway access`;
    const blockedBy = deckObstruction(design, inst.id, baseDeck);
    if (!blockedBy) continue;
    // Bounded placement: try the compass around the manway point.
    let alternative = false;
    for (let k = 1; k < ACCESS_SEARCH_ORIENTATIONS; k += 1) {
      const ang = (k * 360) / ACCESS_SEARCH_ORIENTATIONS;
      const rad = (ang * Math.PI) / 180;
      const dirX = Math.cos(rad);
      const dirY = Math.sin(rad);
      const candidate = {
        ...baseDeck,
        cx: mw.x + dirX * (CATWALK_DEPTH_IN / 2),
        cy: mw.y + dirY * (CATWALK_DEPTH_IN / 2),
        angleDeg: ang,
      };
      if (!deckObstruction(design, inst.id, candidate)) {
        alternative = true;
        break;
      }
    }
    if (alternative) {
      errors.push(
        `${label} deck is obstructed by ${blockedBy} — move the obstruction or re-orient the deck.`,
      );
    } else {
      errors.push(
        `${label} has no feasible deck placement: all ${ACCESS_SEARCH_ORIENTATIONS} orientations are obstructed (unresolved access).`,
      );
    }
  }
  return errors;
}

/** validateDesign messages for vessel manways and their access packages. */
export function vesselAccessErrors(design) {
  const errors = [];
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol?.manway) continue;
    if (inst.manway !== undefined && inst.manway !== null) {
      const m = inst.manway;
      const bad =
        typeof m !== "object" ||
        Array.isArray(m) ||
        ["fx", "fy", "diameterIn", "sillIn"].some((k) => m[k] !== undefined && !Number.isFinite(m[k]));
      if (bad) {
        errors.push(`Symbol ${inst.id} has a malformed manway override.`);
        continue;
      }
    }
    // Explicit deletion (D668-007): the catalog manway is gone by the
    // designer's word — recorded as a named finding (not silent), and no
    // package is derived from it.
    if (manwaySpec(symbol, inst) === null) {
      errors.push(
        `Symbol ${inst.id} (${symbol.label}) has its catalog manway deleted by an explicit override — no access package is derived.`,
      );
      continue;
    }
    const aboveGrade = sillAboveGradeIn(design, inst);
    if (!(aboveGrade > MANWAY_ACCESS_TRIGGER_IN)) continue;
    if (!accessPackageLocal(symbol, inst, design)) {
      errors.push(
        `Symbol ${inst.id} (${symbol.label}) has a manway sill ${Math.round(aboveGrade)} in above grade with no catwalk access.`,
      );
    }
  }
  return errors;
}
