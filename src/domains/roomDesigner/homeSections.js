// Elevations for FORGE Home Designer (slice 5).
//
// Read-only orthographic elevations derived ONLY from the canonical
// multi-level HomeProject geometry — the same geometry that renders the
// plan and feeds the slice-3 quantities. Geometry -> projection ->
// read-only views; nothing here invents dimensions, edits the design, or
// persists anything.
//
// Hard rules (from the slice-5 architecture review):
// - Never pixels. Never invented dimensions. Every vertical default (wall
//   height, opening heights, window sill height) is documented and surfaced
//   in `assumptions` — the same default discipline as slice 3.
// - True orthographic projection: all walls project onto the view plane;
//   walls angled to the view plane foreshorten. That is the definition of
//   an orthographic elevation, not a bug.
// - Openings are measured ALONG THE WALL: offsetIn is measured from wall
//   endpoint A along the wall's normalized direction vector, and both the
//   opening's start and end are projected onto the view axis. Treating the
//   offset as a global X/Y would be wrong for angled walls.
// - Pipes are NOT drawn: pipe runs store plan points only, with no vertical
//   position — drawing them would invent dimensions. Documented as a
//   limitation, not a silent omission.
// - Views are computed on the fly from the on-screen design; zero
//   persistence, zero DB/API change.
//
// The module never throws at the project boundary: buildElevation and
// buildStackedElevation return { ok: false, error } on corrupt input so the
// screen can surface a status message instead of crashing. Every operation
// is pure.

import { validateHomeProject } from "./homeProject";
import { normalizeUnits, projectWithEditedDesign } from "./homeQuantities";

/** The four cardinal elevation directions. */
export const ELEVATION_DIRECTIONS = Object.freeze(["N", "S", "E", "W"]);

// Construction defaults — geometry stores no verticals, so these are
// documented assumptions (same discipline as slice 3). Every defaulted
// value is reported in the assumptions metadata.
const WALL_HEIGHT_DEFAULT_IN = 108; // 9 ft
const OPENING_HEIGHT_DEFAULT_IN = Object.freeze({ door: 80, window: 48 });
const WINDOW_SILL_DEFAULT_IN = 36; // windows sit 36" above the level base

const MEASUREMENT_VERSION = 1;
const PROVENANCE = "designer_geometry";

// View axes: the viewer stands at the named side and looks at that face.
// The drawing's horizontal axis u runs so that, for N, the +x (eastern)
// end of the building appears on the right; each direction keeps compass
// order consistent, so opposite ends of the same wall appear on opposite
// sides of N and S views — physically honest, fully documented.
const VIEW_AXES = Object.freeze({
  N: { u: { x: 1, y: 0 }, label: "North elevation — seen looking south" },
  S: { u: { x: -1, y: 0 }, label: "South elevation — seen looking north" },
  E: { u: { x: 0, y: 1 }, label: "East elevation — seen looking west" },
  W: { u: { x: 0, y: -1 }, label: "West elevation — seen looking east" },
});

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Normalize the requested direction. Missing defaults to "N"; anything
 * else must be one of the four cardinal directions.
 */
export function normalizeDirection(direction) {
  if (direction === undefined || direction === null) return "N";
  const d = String(direction).trim().toUpperCase();
  return ELEVATION_DIRECTIONS.includes(d) ? d : null;
}

function wallHeightOf(design) {
  const settings = (design && design.settings) || {};
  const value = Number(settings.wallHeightIn);
  if (value > 0) return { heightIn: value, source: "design" };
  return { heightIn: WALL_HEIGHT_DEFAULT_IN, source: "default" };
}

function wallPoints(wall) {
  if (!wall || !wall.a || !wall.b) return null;
  const ax = Number(wall.a.x);
  const ay = Number(wall.a.y);
  const bx = Number(wall.b.x);
  const by = Number(wall.b.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  return { ax, ay, bx, by, dx: dx / length, dy: dy / length, length };
}

/**
 * Opening cut-out on a projected wall. The opening is placed ALONG the
 * wall: start = a + direction * offset, end = a + direction * (offset +
 * width), then BOTH endpoints project onto the view axis. offset/width are
 * clamped to the wall's span; an opening with no span is skipped.
 */
function projectOpening(opening, points, u, levelBaseIn, assumptions) {
  const offset = Math.max(0, Math.min(Number(opening.offsetIn) || 0, points.length));
  const rawWidth = Number(opening.widthIn);
  const width = rawWidth > 0 ? Math.min(rawWidth, points.length - offset) : 0;
  if (!(width > 0)) return null;

  const p0x = points.ax + points.dx * offset;
  const p0y = points.ay + points.dy * offset;
  const p1x = points.ax + points.dx * (offset + width);
  const p1y = points.ay + points.dy * (offset + width);
  const u0 = p0x * u.x + p0y * u.y;
  const u1 = p1x * u.x + p1y * u.y;

  const type = opening.type === "door" ? "door" : "window";
  const heightIn =
    isFiniteNumber(opening.heightIn) && opening.heightIn > 0
      ? opening.heightIn
      : OPENING_HEIGHT_DEFAULT_IN[type];
  const heightDefaulted = !(isFiniteNumber(opening.heightIn) && opening.heightIn > 0);
  if (heightDefaulted && !assumptions.has("openingHeights")) {
    assumptions.add("openingHeights");
  }

  let sillIn;
  let sillHeightIn;
  let sillHeightSource;
  if (type === "door") {
    sillIn = levelBaseIn;
    sillHeightIn = 0;
    sillHeightSource = "design"; // doors sit on the level base by definition
  } else {
    const stored = Number(opening.sillHeightIn);
    if (Number.isFinite(stored) && stored >= 0) {
      sillIn = levelBaseIn + stored;
      sillHeightIn = stored;
      sillHeightSource = "design";
    } else {
      sillIn = levelBaseIn + WINDOW_SILL_DEFAULT_IN;
      sillHeightIn = WINDOW_SILL_DEFAULT_IN;
      sillHeightSource = "default";
      if (!assumptions.has("windowSill")) assumptions.add("windowSill");
    }
  }

  return {
    id: opening.id,
    type,
    startIn: round2(Math.min(u0, u1)),
    endIn: round2(Math.max(u0, u1)),
    widthIn: round2(Math.abs(u1 - u0)),
    sillIn: round2(sillIn),
    headerIn: round2(sillIn + heightIn),
    heightIn: round2(heightIn),
    heightSource: heightDefaulted ? "default" : "design",
    sillHeightIn: round2(sillHeightIn),
    sillHeightSource,
  };
}

function projectWall(wall, u, levelBaseIn, wallHeightIn, openings, assumptions) {
  const points = wallPoints(wall);
  if (!points) return null;
  const uA = points.ax * u.x + points.ay * u.y;
  const uB = points.bx * u.x + points.by * u.y;
  const openingViews = [];
  for (const opening of openings) {
    if (opening.wallId !== wall.id) continue;
    const view = projectOpening(opening, points, u, levelBaseIn, assumptions);
    if (view) openingViews.push(view);
  }
  return {
    wallId: wall.id,
    projectedStartIn: round2(Math.min(uA, uB)),
    projectedEndIn: round2(Math.max(uA, uB)),
    lengthIn: round2(Math.abs(uB - uA)),
    baseIn: round2(levelBaseIn),
    topIn: round2(levelBaseIn + wallHeightIn),
    openingViews,
  };
}

/**
 * Build one level's elevation slice. baseIn is that level's base elevation
 * above grade (0 for a single-level view; cumulative for stacked views).
 */
function buildLevelElevation(level, u, levelBaseIn, assumptions) {
  const design = level.design || {};
  const { heightIn: wallHeightIn, source: wallHeightSource } = wallHeightOf(design);
  if (wallHeightSource === "default" && !assumptions.has("wallHeight")) {
    assumptions.add("wallHeight");
  }
  const openings = Array.isArray(design.openings) ? design.openings : [];
  const wallViews = [];
  for (const wall of Array.isArray(design.walls) ? design.walls : []) {
    const view = projectWall(wall, u, levelBaseIn, wallHeightIn, openings, assumptions);
    if (view) wallViews.push(view);
  }
  const span = wallViews.reduce(
    (acc, w) => ({
      min: Math.min(acc.min, w.projectedStartIn),
      max: Math.max(acc.max, w.projectedEndIn),
    }),
    { min: 0, max: 0 },
  );
  return {
    id: level.id,
    name: level.name,
    baseIn: round2(levelBaseIn),
    gradeLine: levelBaseIn === 0,
    wallHeightIn,
    wallHeightSource,
    wallCount: wallViews.length,
    openingCount: wallViews.reduce((n, w) => n + w.openingViews.length, 0),
    minIn: round2(span.min),
    maxIn: round2(span.max),
    wallViews,
  };
}

const ASSUMPTION_TEXT = Object.freeze({
  wallHeight: "Default wall height 9 ft (not set in design)",
  openingHeights: 'Opening heights defaulted (doors 80", windows 48")',
  windowSill: 'Default window sill height 36" (not set in design)',
});

function finalize(result, assumptionFlags) {
  return {
    ...result,
    quantitySource: PROVENANCE,
    measurementVersion: MEASUREMENT_VERSION,
    generatedAt: nowIso(),
    assumptions: [...assumptionFlags].map((key) => ASSUMPTION_TEXT[key]),
    limitations: [
      "Pipes are not drawn in elevation views — pipe runs store plan points only, with no vertical position.",
    ],
  };
}

/**
 * Orthographic elevation of the project's CURRENT level in the requested
 * cardinal direction. baseIn is 0 (relative to the level's base); the view
 * reflects the on-screen edited design when one is passed.
 */
export function buildElevation(project, options = {}) {
  try {
    const direction = normalizeDirection(options.direction);
    if (!direction) {
      return {
        ok: false,
        error: `Elevation direction must be one of ${ELEVATION_DIRECTIONS.join(", ")}.`,
      };
    }
    const withDesign = options.editedDesign
      ? projectWithEditedDesign(project, options.editedDesign)
      : project;
    const problems = validateHomeProject(withDesign);
    if (problems.length > 0) return { ok: false, error: problems[0] };

    const current =
      withDesign.levels.find((l) => l.id === withDesign.currentLevelId) ||
      withDesign.levels[0];
    const assumptionFlags = new Set();
    const levelView = buildLevelElevation(current, VIEW_AXES[direction].u, 0, assumptionFlags);

    return {
      ok: true,
      direction,
      directionLabel: VIEW_AXES[direction].label,
      scope: "level",
      projectName: withDesign.name,
      units: normalizeUnits(withDesign.units),
      levels: [levelView],
      levelCount: 1,
      ...finalize({}, assumptionFlags),
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "Could not build the elevation.",
    };
  }
}

/**
 * Orthographic elevation across ALL levels in the requested cardinal
 * direction. Level bases stack cumulatively: base of level N+1 = top of
 * level N — derived, never invented; no slab thickness is assumed. The
 * grade line sits at the bottom of the first level.
 */
export function buildStackedElevation(project, options = {}) {
  try {
    const direction = normalizeDirection(options.direction);
    if (!direction) {
      return {
        ok: false,
        error: `Elevation direction must be one of ${ELEVATION_DIRECTIONS.join(", ")}.`,
      };
    }
    const withDesign = options.editedDesign
      ? projectWithEditedDesign(project, options.editedDesign)
      : project;
    const problems = validateHomeProject(withDesign);
    if (problems.length > 0) return { ok: false, error: problems[0] };

    const assumptionFlags = new Set();
    const levels = [];
    let baseIn = 0;
    for (const level of withDesign.levels) {
      const view = buildLevelElevation(level, VIEW_AXES[direction].u, baseIn, assumptionFlags);
      levels.push(view);
      baseIn += view.wallHeightIn;
    }

    return {
      ok: true,
      direction,
      directionLabel: VIEW_AXES[direction].label,
      scope: "stacked",
      projectName: withDesign.name,
      units: normalizeUnits(withDesign.units),
      levels,
      levelCount: levels.length,
      totalHeightIn: round2(baseIn),
      ...finalize({}, assumptionFlags),
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "Could not build the stacked elevation.",
    };
  }
}
