// Vessel manways and their access package (catwalk + ladder).
//
// Every vessel catalog entry carries a manway spec:
//   manway: { fx, fy, diameterIn, sillIn }
// (fx, fy) is the manway center on the footprint in the same fractional
// frame as nozzle specs (pipeAttachments.js); diameterIn is the opening
// diameter; sillIn is the height of the BOTTOM of the opening (the sill
// a worker steps over) above the vessel base, which sits at grade.
//
// Access rule (D5): a manway whose sill is MORE than 24 in above grade
// gains a steel catwalk — a grating deck at sill level beside the
// manway — with an access ladder from grade to the deck. At or under
// 24 in there is no package. The package is derived from the manway,
// never stored, so moving/resizing a vessel across the 2 ft line adds
// or removes it automatically. An instance may override the catalog
// spec via `inst.manway` (partial) and may suppress the package with
// `inst.noAccess` — validation then flags an unsuppressed sill over
// 24 in with no catwalk.
//
// Pure and framework-free.

import { findSymbol } from "./symbolRegistry";

/** Sill height (in above grade) that triggers the access package. */
export const MANWAY_ACCESS_TRIGGER_IN = 24;
/** Catwalk deck size: width along the vessel (tangential), depth outward. */
export const CATWALK_WIDTH_IN = 48;
export const CATWALK_DEPTH_IN = 36;
/** Access ladder width (in). */
export const LADDER_WIDTH_IN = 18;

/** Catalog manway spec merged with the instance override, or null. */
export function manwaySpec(symbol, inst) {
  if (!symbol?.manway) return null;
  const override = inst?.manway && typeof inst.manway === "object" ? inst.manway : {};
  return { ...symbol.manway, ...override };
}

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * The manway resolved in the instance's LOCAL frame (inches, origin at
 * the footprint center, +x east / +y south before rotation):
 * { lx, ly, dirX, dirY, diameterIn, sillIn } — (dirX, dirY) is the
 * outward unit direction through the manway center; a center manway
 * (0, 0) faces south by convention.
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

/** Rotate a local point into world plan coordinates for an instance. */
export function localToWorld(inst, lx, ly) {
  const rad = ((inst?.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: (inst?.x || 0) + lx * cos - ly * sin, y: (inst?.y || 0) + lx * sin + ly * cos };
}

/** The manway in world plan coordinates, or null. */
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
 * The deck sits at sill level, its inner edge at the manway point,
 * extending outward; the ladder stands at the deck's outer edge and
 * climbs from `fromIn` (grade 0, or the platform below) to the deck.
 * angleDeg is the outward direction in the local plan frame.
 */
export function accessPackageForManway(manway, { fromIn = 0 } = {}) {
  if (!manway || !(manway.sillIn > MANWAY_ACCESS_TRIGGER_IN)) return null;
  const angleDeg = (Math.atan2(manway.dirY, manway.dirX) * 180) / Math.PI;
  const deck = {
    cx: manway.lx + manway.dirX * (CATWALK_DEPTH_IN / 2),
    cy: manway.ly + manway.dirY * (CATWALK_DEPTH_IN / 2),
    angleDeg,
    widthIn: CATWALK_WIDTH_IN,
    depthIn: CATWALK_DEPTH_IN,
    elevationIn: manway.sillIn,
  };
  const ladder = {
    cx: manway.lx + manway.dirX * CATWALK_DEPTH_IN,
    cy: manway.ly + manway.dirY * CATWALK_DEPTH_IN,
    angleDeg,
    widthIn: LADDER_WIDTH_IN,
    fromIn,
    toIn: manway.sillIn,
  };
  return { deck, ladder };
}

/** Access package for an instance's manway, LOCAL frame, or null. */
export function accessPackageLocal(symbol, inst) {
  if (inst?.noAccess) return null;
  return accessPackageForManway(manwayLocal(symbol, inst));
}

/** Access package with deck/ladder resolved to world plan coordinates. */
export function accessPackageWorld(symbol, inst) {
  const pkg = accessPackageLocal(symbol, inst);
  if (!pkg) return null;
  const toWorld = (part) => {
    const p = localToWorld(inst, part.cx, part.cy);
    const rad = ((inst?.rotationDeg || 0) * Math.PI) / 180;
    return { ...part, cx: p.x, cy: p.y, angleDeg: part.angleDeg + (inst?.rotationDeg || 0), rad };
  };
  const deck = toWorld(pkg.deck);
  const ladder = toWorld(pkg.ladder);
  const cornersOf = (part) => {
    // World frame: outward (depth) axis u, tangential (width) axis v.
    const rad = (part.angleDeg * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const vx = -Math.sin(rad);
    const vy = Math.cos(rad);
    const hw = part.widthIn / 2;
    const hd = part.depthIn / 2;
    return [
      { x: part.cx - ux * hd - vx * hw, y: part.cy - uy * hd - vy * hw },
      { x: part.cx + ux * hd - vx * hw, y: part.cy + uy * hd - vy * hw },
      { x: part.cx + ux * hd + vx * hw, y: part.cy + uy * hd + vy * hw },
      { x: part.cx - ux * hd + vx * hw, y: part.cy - uy * hd + vy * hw },
    ];
  };
  return { deck: { ...deck, corners: cornersOf(deck) }, ladder };
}

/** validateDesign messages for vessel manways and their access packages. */
export function vesselAccessErrors(design) {
  const errors = [];
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol?.manway) continue;
    if (inst.manway !== undefined) {
      const m = inst.manway;
      const bad =
        !m || typeof m !== "object" || Array.isArray(m) ||
        ["fx", "fy", "diameterIn", "sillIn"].some((k) => m[k] !== undefined && !Number.isFinite(m[k]));
      if (bad) {
        errors.push(`Symbol ${inst.id} has a malformed manway override.`);
        continue;
      }
    }
    const spec = manwaySpec(symbol, inst);
    if (!(spec.sillIn > MANWAY_ACCESS_TRIGGER_IN)) continue;
    if (!accessPackageLocal(symbol, inst)) {
      errors.push(
        `Symbol ${inst.id} (${symbol.label}) has a manway sill ${spec.sillIn} in above grade with no catwalk access.`,
      );
    }
  }
  return errors;
}
