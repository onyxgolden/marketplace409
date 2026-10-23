// Shared semantic final-color policy for pipes (D668-009).
//
// Red is reserved to firewater at the FINAL RESOLVED-COLOR boundary,
// in every view — plan, print, 3D, legends:
//   - a firewater run resolves to FIREWATER_RESERVED_RED, always;
//   - any OTHER red resolving on a non-firewater run (a custom color
//     override, a system color, an imported color) is remapped off the
//     red band to a fixed, documented substitute — the override is
//     preserved on the run, but it never renders as firewater red;
//   - non-red colors pass through untouched.
//
// Selection / error / hover highlighting NEVER paints a
// non-firewater pipe red: highlighting is a separate treatment
// (outline/glow in a non-reserved hue), applied AFTER finalPipeColor,
// never by recoloring the pipe itself.
//
// Pure and framework-free.

import { effectiveColor } from "./designSystems";

/** The one red in the designer: reserved to firewater piping. */
export const FIREWATER_RESERVED_RED = "#dc2626";
/**
 * Where a non-firewater red resolves: a dark amber, visibly "was red"
 * but outside the reserved red band (and outside isReservedRed).
 */
export const NON_FIREWATER_RED_REMAP = "#92400e";
/** Default pipe color when a run carries no own/system color. */
export const DEFAULT_PIPE_COLOR = "#7dd3fc";

function parseHex(color) {
  if (typeof color !== "string") return null;
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

/**
 * True when a color sits in the reserved red band: a strong red —
 * high red channel, both other channels well below it. Catches the
 * exact firewater red and near-red custom/imported/system colors, so
 * recoloring one relief valve (or one constant) can never free a red
 * for ordinary piping.
 */
export function isReservedRed(color) {
  const rgb = parseHex(color);
  if (!rgb) return false;
  return rgb.r >= 160 && rgb.r - rgb.g >= 80 && rgb.r - rgb.b >= 80;
}

/**
 * The final resolved draw color for a pipe run: firewater → the
 * reserved red; any other red on a non-firewater run → the remap;
 * everything else → the run's own/system/fallback color untouched.
 */
export function finalPipeColor(design, run, fallback = DEFAULT_PIPE_COLOR) {
  if (!run) return fallback;
  if (run.utility === "firewater") return FIREWATER_RESERVED_RED;
  const requested = effectiveColor(design, run, fallback);
  return isReservedRed(requested) ? NON_FIREWATER_RED_REMAP : requested;
}

/**
 * The before/after color-resolution map (evidence): one row per pipe
 * run — { runId, utility, requested, resolved, remapped }. `requested`
 * is the run's own/system/default color before the reservation rule;
 * `resolved` is what renders.
 */
export function pipeColorResolutionMap(design) {
  return (design?.pipes || []).map((run) => {
    const requested = effectiveColor(design, run, DEFAULT_PIPE_COLOR);
    const resolved = finalPipeColor(design, run);
    return {
      runId: run.id,
      utility: run.utility || null,
      requested,
      resolved,
      remapped: requested !== resolved,
    };
  });
}
