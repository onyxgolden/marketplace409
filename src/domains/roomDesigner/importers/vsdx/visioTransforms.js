/**
 * Affine transform engine for VSDX import.
 *
 * All ShapeSheet placement math (PinX/PinY/LocPinX/LocPinY/Angle/FlipX/FlipY)
 * is expressed as 3×3 affine matrices [a c e / b d f / 0 0 1], stored flat as
 * [a, b, c, d, e, f] with x' = a·x + c·y + e, y' = b·x + d·y + f.
 *
 * A shape's local-to-parent transform is EXACTLY:
 *     T(PinX, PinY) · R(Angle) · Flip(FlipX, FlipY) · T(−LocPinX, −LocPinY)
 * and group hierarchies compose as:
 *     page · parentGroup · … · child · localGeometryPoint
 * All composition happens in Visio space (inches, Y-up); the single Y-flip
 * into Designer space happens later at the coordinate boundary.
 *
 * Angle convention: Visio stores angles in RADIANS, positive
 * counter-clockwise in Y-up page space (the ShapeSheet UI displays degrees).
 */

import { constantOf, resolveCell } from "./visioResolver";

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/** Matrix multiplication: apply n first, then m (m · n). */
export function multiply(m, n) {
  const [a1, b1, c1, d1, e1, f1] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyToPoint(m, p) {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

export function translation(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

/** Counter-clockwise rotation by radians, in Y-up space. */
export function rotation(radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

export function flip(flipX, flipY) {
  return [flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, 0, 0];
}

function readNumber(cells, name) {
  const resolved = resolveCell(cells.get(name), cells);
  if (resolved.state === "constant") return { value: resolved.value, approximated: false };
  return { value: 0, approximated: resolved.state !== "missing" ? `unsupported ${resolved.state}` : "missing" };
}

/**
 * Read a boolean flag cell (FlipX/FlipY). Absence is Visio's documented
 * default (no flip) — not an approximation, so it is never reported.
 */
function readFlag(cells, name) {
  const resolved = resolveCell(cells.get(name), cells);
  return resolved.state === "constant" && resolved.value !== 0;
}

/**
 * Build a shape's local-to-parent transform from its resolved cells.
 * Returns { matrix, approximated: [cellNames] } — approximated lists cells
 * that were missing or formula-driven (defaulted to the Visio zero default),
 * so the caller can warn instead of silently misplacing geometry.
 */
export function localTransform(cells) {
  const approximated = [];
  const pick = (name) => {
    const { value, approximated: why } = readNumber(cells, name);
    if (why) approximated.push(`${name} (${why})`);
    return value;
  };
  const pinX = pick("PinX");
  const pinY = pick("PinY");
  const locPinX = pick("LocPinX");
  const locPinY = pick("LocPinY");
  const angle = pick("Angle");
  const flipX = readFlag(cells, "FlipX");
  const flipY = readFlag(cells, "FlipY");

  const matrix = multiply(
    translation(pinX, pinY),
    multiply(rotation(angle), multiply(flip(flipX, flipY), translation(-locPinX, -locPinY))),
  );
  return { matrix, approximated };
}

/**
 * Compose the full page-space transform for a shape: every ancestor group's
 * local transform, outermost first, then the shape's own.
 * ancestorMatrices: array of local-transform matrices from the outermost
 * group down to the direct parent.
 */
export function pageTransform(ancestorMatrices, ownMatrix) {
  let m = ownMatrix;
  for (let i = ancestorMatrices.length - 1; i >= 0; i -= 1) {
    m = multiply(ancestorMatrices[i], m);
  }
  return m;
}
