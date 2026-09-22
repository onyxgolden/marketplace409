// Construction intelligence for FORGE Home Designer (slice 3).
//
// Pure quantities derived ONLY from Room Designer geometry — the same
// geometry that renders the plan. Geometry -> quantities; estimating and
// pricing build on this later (slice 4). Nothing here invents prices,
// unit costs, or compliance determinations.
//
// The module never throws at the project boundary: measureHomeProject
// returns { ok: false, error } on corrupt input so the screen can surface
// a status message instead of crashing. Every operation is pure.
//
// Definitions (kept deliberately conservative):
// - grossRoomAreaSqFt: sum of labeled room polygon areas.
// - netRoomAreaSqFt: gross minus the wall footprint (wall length x
//   thickness). An approximation: shared walls are counted once per wall,
//   so treat it as a planning number, not a surveyed area.
// - wallSurfaceAreaSqFt: total wall length x wall height, ONE face.
//   Double it for both faces.
// - netWallLengthIn: gross wall length minus opening widths (openings are
//   cut out of walls; they can never add length).

import { feetInchesLabel } from "./designerGeometry";
import { summarizeDesignForEstimating } from "./designerExports";
import { validateHomeProject } from "./homeProject";

const IN_PER_FT = 12;
const M_PER_IN = 0.0254;
const SQM_PER_SQFT = 0.09290304;

const KNOWN_UNITS = Object.freeze(["in", "ft", "m"]);

/** Normalize a project units value to one of "in" | "ft" | "m". */
export function normalizeUnits(units) {
  if (typeof units === "string" && KNOWN_UNITS.includes(units.trim())) {
    return units.trim();
  }
  return "in";
}

/** Length in the project's display units. Geometry stays in inches. */
export function convertLength(inches, units) {
  const value = Number(inches);
  if (!Number.isFinite(value)) return 0;
  switch (normalizeUnits(units)) {
    case "ft":
      return value / IN_PER_FT;
    case "m":
      return value * M_PER_IN;
    default:
      return value;
  }
}

/** Area in the project's display units. Geometry-derived areas stay in sq ft. */
export function convertArea(sqFt, units) {
  const value = Number(sqFt);
  if (!Number.isFinite(value)) return 0;
  return normalizeUnits(units) === "m" ? value * SQM_PER_SQFT : value;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Human label for a length given in inches, in the project's units. */
export function formatLength(inches, units) {
  const u = normalizeUnits(units);
  if (u === "ft") return feetInchesLabel(inches);
  if (u === "m") return `${round2(convertLength(inches, "m"))} m`;
  return `${round2(Number(inches) || 0)}\u2033`;
}

/** Human label for an area given in square feet, in the project's units. */
export function formatArea(sqFt, units) {
  const u = normalizeUnits(units);
  if (u === "m") return `${round2(convertArea(sqFt, "m"))} m\u00B2`;
  return `${round2(Number(sqFt) || 0)} sq ft`;
}

function sumLevelSummaries(summaries) {
  const totals = {
    roomCount: 0,
    grossRoomAreaSqFt: 0,
    netRoomAreaSqFt: 0,
    wallCount: 0,
    totalWallLengthIn: 0,
    netWallLengthIn: 0,
    wallSurfaceAreaSqFt: 0,
    openingCount: 0,
    doorCount: 0,
    windowCount: 0,
    totalOpeningWidthIn: 0,
    pipeRunCount: 0,
    totalPipeLengthIn: 0,
  };
  for (const s of summaries) {
    totals.roomCount += s.roomCount;
    totals.grossRoomAreaSqFt += s.grossRoomAreaSqFt;
    totals.netRoomAreaSqFt += s.netRoomAreaSqFt;
    totals.wallCount += s.wallCount;
    totals.totalWallLengthIn += s.totalWallLengthIn;
    totals.netWallLengthIn += s.netWallLengthIn;
    totals.wallSurfaceAreaSqFt += s.wallSurfaceAreaSqFt;
    totals.openingCount += s.openingCount;
    totals.doorCount += s.doorCount;
    totals.windowCount += s.windowCount;
    totals.totalOpeningWidthIn += s.totalOpeningWidthIn;
    totals.pipeRunCount += s.pipeRunCount;
    totals.totalPipeLengthIn += s.totalPipeLengthIn;
  }
  return {
    roomCount: totals.roomCount,
    grossRoomAreaSqFt: round2(totals.grossRoomAreaSqFt),
    netRoomAreaSqFt: round2(Math.max(0, totals.netRoomAreaSqFt)),
    wallCount: totals.wallCount,
    totalWallLengthIn: round2(totals.totalWallLengthIn),
    netWallLengthIn: round2(Math.max(0, totals.netWallLengthIn)),
    wallSurfaceAreaSqFt: round2(totals.wallSurfaceAreaSqFt),
    openingCount: totals.openingCount,
    doorCount: totals.doorCount,
    windowCount: totals.windowCount,
    totalOpeningWidthIn: round2(totals.totalOpeningWidthIn),
    pipeRunCount: totals.pipeRunCount,
    totalPipeLengthIn: round2(totals.totalPipeLengthIn),
  };
}

/**
 * Quantities for one level's design. Returns null when the design's
 * geometry cannot be measured — the project boundary converts that to
 * { ok: false } instead of throwing.
 */
export function measureLevelDesign(design) {
  let summary;
  try {
    summary = summarizeDesignForEstimating(design);
  } catch {
    return null;
  }
  const wallHeightIn = summary.wallHeightIn > 0 ? summary.wallHeightIn : 108;
  const wallThicknessIn = summary.wallThicknessIn > 0 ? summary.wallThicknessIn : 4.5;
  const totalOpeningWidthIn = (summary.openings || []).reduce(
    (acc, o) => acc + (Number(o.widthIn) > 0 ? Number(o.widthIn) : 0),
    0,
  );
  const grossRoomAreaSqFt = summary.totalRoomAreaSqFt;
  const wallFootprintSqFt = (summary.totalWallLengthIn * wallThicknessIn) / 144;
  const netWallLengthIn = summary.totalWallLengthIn - totalOpeningWidthIn;
  const totalPipeLengthIn = (summary.pipeRuns || []).reduce(
    (acc, run) => acc + (Number(run.lengthIn) > 0 ? Number(run.lengthIn) : 0),
    0,
  );
  return {
    roomCount: summary.roomCount,
    rooms: summary.rooms,
    grossRoomAreaSqFt: round2(grossRoomAreaSqFt),
    // Planning approximation — see the module note on netRoomAreaSqFt.
    netRoomAreaSqFt: round2(Math.max(0, grossRoomAreaSqFt - wallFootprintSqFt)),
    wallCount: summary.wallCount,
    totalWallLengthIn: round2(summary.totalWallLengthIn),
    netWallLengthIn: round2(Math.max(0, netWallLengthIn)),
    wallSurfaceAreaSqFt: round2((summary.totalWallLengthIn * wallHeightIn) / 144),
    wallHeightIn,
    wallThicknessIn,
    openingCount: summary.openingCount,
    doorCount: summary.doorCount,
    windowCount: summary.windowCount,
    totalOpeningWidthIn: round2(totalOpeningWidthIn),
    pipeRunCount: summary.pipeRunCount,
    totalPipeLengthIn: round2(totalPipeLengthIn),
  };
}

/**
 * Quantities for a whole HomeProject: per-level measurements plus project
 * totals. Never throws — corrupt input returns { ok: false, error }.
 */
export function measureHomeProject(project) {
  try {
    const problems = validateHomeProject(project);
    if (problems.length > 0) {
      return { ok: false, error: problems[0] };
    }
    const levels = [];
    for (const level of project.levels) {
      const measured = measureLevelDesign(level.design);
      if (measured === null) {
        return {
          ok: false,
          error: `Level "${level.name}" has damaged geometry and could not be measured.`,
        };
      }
      levels.push({ id: level.id, name: level.name, ...measured });
    }
    return {
      ok: true,
      projectName: project.name,
      units: normalizeUnits(project.units),
      levelCount: levels.length,
      levels,
      totals: sumLevelSummaries(levels),
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "Could not measure the project.",
    };
  }
}
