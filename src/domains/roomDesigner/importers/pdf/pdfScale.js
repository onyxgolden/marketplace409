/**
 * Scale calibration for PDF import.
 *
 * A PDF carries its true PAPER size (points, 1/72 inch) but says nothing
 * about the PLOT SCALE the drawing was printed at. Converted geometry is
 * therefore "paper-true" — one paper inch is one plan inch — and is
 * meaningless as building dimensions until the plot scale is supplied. This
 * module is the only place that turns paper inches into real-world inches.
 *
 * Two ways to supply it, mirroring the Designer's established underlay
 * calibration (designerGeometry.calibrateUnderlayScale): a named plot scale,
 * or a measured distance the user knows the real length of. Both reduce to a
 * single dimensionless `factor` = real inches per paper inch.
 *
 * Scaling is anchored: `applyScaleToPolylines` scales about an anchor point
 * so the drawing grows from a chosen corner instead of sliding away from the
 * origin — the same registration discipline as calibrateUnderlay, which
 * keeps the first clicked point fixed.
 *
 * Every function is pure and throws human-readable Errors on bad input, in
 * the same voice as designerGeometry.
 */

/** Paper inches per foot at 1:1 — used to express architectural scales. */
const INCHES_PER_FOOT = 12;

/**
 * Named plot scales, most common first. `factor` is real inches per paper
 * inch: at 1/4" = 1'-0", a quarter inch of paper is twelve real inches, so
 * one paper inch is 48 real inches.
 */
export const PLOT_SCALE_PRESETS = Object.freeze([
  Object.freeze({ id: "arch-1-4", label: '1/4" = 1\'-0"', factor: INCHES_PER_FOOT / 0.25, system: "imperial" }),
  Object.freeze({ id: "arch-1-8", label: '1/8" = 1\'-0"', factor: INCHES_PER_FOOT / 0.125, system: "imperial" }),
  Object.freeze({ id: "arch-3-16", label: '3/16" = 1\'-0"', factor: INCHES_PER_FOOT / 0.1875, system: "imperial" }),
  Object.freeze({ id: "arch-1-2", label: '1/2" = 1\'-0"', factor: INCHES_PER_FOOT / 0.5, system: "imperial" }),
  Object.freeze({ id: "arch-3-4", label: '3/4" = 1\'-0"', factor: INCHES_PER_FOOT / 0.75, system: "imperial" }),
  Object.freeze({ id: "arch-1-16", label: '1/16" = 1\'-0"', factor: INCHES_PER_FOOT / 0.0625, system: "imperial" }),
  Object.freeze({ id: "arch-1-in", label: '1" = 1\'-0"', factor: INCHES_PER_FOOT / 1, system: "imperial" }),
  Object.freeze({ id: "eng-1-20", label: '1" = 20\'', factor: 20 * INCHES_PER_FOOT, system: "imperial" }),
  Object.freeze({ id: "eng-1-30", label: '1" = 30\'', factor: 30 * INCHES_PER_FOOT, system: "imperial" }),
  Object.freeze({ id: "full", label: "Full size (1:1)", factor: 1, system: "either" }),
  Object.freeze({ id: "metric-1-50", label: "1:50", factor: 50, system: "metric" }),
  Object.freeze({ id: "metric-1-100", label: "1:100", factor: 100, system: "metric" }),
  Object.freeze({ id: "metric-1-200", label: "1:200", factor: 200, system: "metric" }),
]);

/** Default when the user has not chosen: paper-true, i.e. not yet scaled. */
export const UNCALIBRATED_FACTOR = 1;

export function findPlotScalePreset(id) {
  return PLOT_SCALE_PRESETS.find((p) => p.id === id) || null;
}

/**
 * Real inches per paper inch from a measured paper distance and the real
 * distance it represents.
 *
 * `measuredIn` is the distance between two points in the CONVERTED,
 * paper-true drawing (Designer inches before scaling). `realDistanceIn` is
 * what that distance is in the real world.
 */
export function scaleFromKnownDistance(measuredIn, realDistanceIn) {
  if (!Number.isFinite(measuredIn) || !(measuredIn > 0)) {
    throw new Error("Measured distance must be positive — pick two distinct points.");
  }
  if (!Number.isFinite(realDistanceIn) || !(realDistanceIn > 0)) {
    throw new Error("Real-world distance must be positive.");
  }
  return realDistanceIn / measuredIn;
}

/**
 * Real inches per paper inch from two points in the paper-true drawing plus
 * the real distance between them. Mirrors calibrateUnderlayScale's signature
 * and error voice so the two calibration paths feel identical.
 */
export function scaleFromTwoPoints(pointA, pointB, realDistanceIn) {
  if (!isPoint(pointA) || !isPoint(pointB)) throw new Error("Calibration points must be valid.");
  const measured = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  if (!(measured > 0)) throw new Error("Calibration points must be distinct.");
  return scaleFromKnownDistance(measured, realDistanceIn);
}

/** Reject absurd factors before they produce a mile-wide or atom-sized plan. */
export const MIN_SCALE_FACTOR = 1 / 1000;
export const MAX_SCALE_FACTOR = 5000;

export function assertUsableFactor(factor) {
  if (!Number.isFinite(factor) || !(factor > 0)) {
    throw new Error("Scale factor must be a positive number.");
  }
  if (factor < MIN_SCALE_FACTOR || factor > MAX_SCALE_FACTOR) {
    throw new Error(
      `Scale factor ${factor} is outside the supported range (${MIN_SCALE_FACTOR}–${MAX_SCALE_FACTOR}× ).`,
    );
  }
  return factor;
}

/**
 * Scale polylines about `anchor`. Pure: returns new arrays and never mutates
 * the input. A factor of exactly 1 still returns copies, so callers cannot
 * accidentally alias the unscaled geometry.
 */
export function applyScaleToPolylines(polylines, factor, anchor = { x: 0, y: 0 }) {
  assertUsableFactor(factor);
  if (!isPoint(anchor)) throw new Error("Scale anchor must be a valid point.");
  return (polylines || []).map((line) => {
    const points = (Array.isArray(line) ? line : line.points) || [];
    const scaled = points.map((p) => ({
      x: round6(anchor.x + (p.x - anchor.x) * factor),
      y: round6(anchor.y + (p.y - anchor.y) * factor),
    }));
    return Array.isArray(line) ? scaled : { ...line, points: scaled };
  });
}

/**
 * Human-readable description of a factor: matches a known preset when one
 * fits, otherwise expresses it as a ratio. Used in the import report so the
 * applied scale is always stated, never implied.
 */
export function describeScale(factor) {
  if (!Number.isFinite(factor) || !(factor > 0)) return "unknown scale";
  const preset = PLOT_SCALE_PRESETS.find((p) => Math.abs(p.factor - factor) < 1e-9);
  if (preset) return preset.label;
  if (Math.abs(factor - 1) < 1e-9) return "paper size (1:1, not scaled)";
  return `1:${round6(factor)}`;
}

/**
 * The paper-true drawing's longest straight run, which the UI offers as the
 * thing to measure ("this line is N feet"). Returns { lengthIn, a, b } or
 * null. Only straight segments count: a flattened curve's chord is not a
 * dimension anyone knows the length of.
 */
export function longestStraightRun(polylines) {
  let best = null;
  for (const entry of polylines || []) {
    const points = (Array.isArray(entry) ? entry : entry && entry.points) || [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (!isPoint(a) || !isPoint(b)) continue;
      const lengthIn = Math.hypot(b.x - a.x, b.y - a.y);
      if (!best || lengthIn > best.lengthIn) best = { lengthIn: round6(lengthIn), a: { ...a }, b: { ...b } };
    }
  }
  return best;
}

function isPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
