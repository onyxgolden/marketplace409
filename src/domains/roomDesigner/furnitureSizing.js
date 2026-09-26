// Standard and custom sizes for placed furniture and cabinets.
//
// Every piece can take any custom width, depth and height (half-inch
// resolution, 1"–480"; see resizeFurniture). Cabinets additionally offer the
// industry-standard sizes of their family as quick picks, and wall-mounted
// cabinets have a mounting height (the cabinet BOTTOM above the floor).
//
// The standard lists below are the common US nominal increments used when
// laying out cabinetry (e.g. base/wall widths 9"–48" in 3" steps). They are
// planning values, not a particular manufacturer's line — real product
// availability varies.
//
// Pure and framework-free.

import { getCatalogEntry } from "./furnitureCatalog";

/** 9, 12, 15, ... up to and including `to`. */
function steps(from, to, step) {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(v);
  return out;
}

const BASE_HEIGHTS = [30, 34, 34.5, 35, 36];

export const SIZE_FAMILIES = Object.freeze({
  base: { label: "Base cabinet", widths: steps(9, 48, 3), depths: [12, 15, 18, 21, 24], heights: BASE_HEIGHTS },
  "sink-base": { label: "Sink base", widths: [...steps(24, 48, 3), 60], depths: [21, 24], heights: BASE_HEIGHTS },
  "corner-base": { label: "Corner base", widths: [33, 36, 39, 42], depths: [24, 33, 36], heights: BASE_HEIGHTS },
  "blind-base": { label: "Blind corner base", widths: [36, 39, 42, 45, 48], depths: [24], heights: BASE_HEIGHTS },
  wall: {
    label: "Wall cabinet",
    widths: steps(9, 48, 3),
    depths: [12, 15, 18, 24],
    heights: [12, 15, 18, 24, 30, 36, 42],
    mounts: [48, 54, 60, 66, 72],
  },
  "wall-corner": { label: "Wall corner", widths: [24, 27], depths: [24, 27], heights: [30, 36, 42], mounts: [54, 60] },
  bridge: { label: "Bridge cabinet", widths: [30, 33, 36, 39, 42], depths: [12, 15, 24], heights: [12, 15, 18, 24], mounts: [66, 72, 78] },
  tall: { label: "Tall cabinet", widths: [12, 15, 18, 24, 30, 33, 36], depths: [12, 24], heights: [84, 90, 96] },
  vanity: { label: "Vanity", widths: [12, 15, 18, 21, 24, 30, 36, 42, 48, 60, 72], depths: [18, 21], heights: [30, 32.5, 34, 34.5] },
  linen: { label: "Linen tower", widths: [12, 15, 18, 24], depths: [12, 21], heights: [72, 84, 90] },
  "bath-wall": { label: "Bath wall cabinet", widths: [12, 15, 18, 24, 30, 36], depths: [4, 6, 8, 12], heights: [24, 30, 36], mounts: [44, 48, 54] },
});

/** Highest mounting height accepted (a cabinet bottom 20' up is plenty). */
export const MAX_MOUNT_IN = 240;

/**
 * Standard sizes for a catalog piece:
 *   { family, label, widths, depths, heights, mounts? }
 * or null when the piece has no standard family (it still takes any
 * custom size).
 */
export function standardSizesFor(catalogId) {
  const entry = getCatalogEntry(catalogId);
  const family = entry?.sizeFamily && SIZE_FAMILIES[entry.sizeFamily];
  return family ? { family: entry.sizeFamily, ...family } : null;
}

/** Is this piece mounted above the floor (wall cabinets, shelves)? */
export function isMountedPiece(catalogId) {
  return getCatalogEntry(catalogId)?.mountIn !== undefined;
}

/**
 * Validate a mounting height (inches). Returns the value rounded to a
 * half inch, or throws with a user-facing message.
 */
export function cleanMountIn(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MOUNT_IN) {
    throw new Error(`Mounting height must be between 0 and ${MAX_MOUNT_IN} inches.`);
  }
  return Math.round(n * 2) / 2;
}
