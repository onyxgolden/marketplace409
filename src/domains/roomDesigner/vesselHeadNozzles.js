// Scheduled horizontal-vessel end-head nozzles (D10-04, R4/O5).
//
// A horizontal vessel's end-head nozzles live on the vessel's vertical
// center plane — top or bottom of the head, never the sides (digest
// §4.3, brief O5). Their faces come from an authored nozzle SCHEDULE,
// never from an invented default: the prior model resolved every end
// nozzle through the generic side rule (62% of height, axial normal),
// which put end nozzles at the 3/9-o'clock side of the head — the
// defect this slice removes. The reviewer's arbitrary zc±0.75R default
// is not implemented anywhere; the schedule replaces it.
//
// One pure geometry/policy source feeds authoring, validation, picking
// and every view: the scheduled face computed here is the face
// connectionFaceForAnchor returns, the anchor catalogAnchorsWorld
// reports (so snap, reconcile and picking land on the same point),
// and the flange disc nozzleFlangeDescriptors draws.
//
// Schedule model (instance field `headNozzleSchedule`, an array of
// entries; each entry schedules ONE catalog nozzle by its stable id):
//   { id, sizeIn, rating, surface, position, orientationDeg,
//     elevationIn, projectionIn }
//   - id: the catalog nozzle id (e.g. "liquid-out").
//   - sizeIn: nominal size; must match the catalog nozzle.
//   - rating: { status: "unknown" } (no value — UNKNOWN is preserved,
//     never invented) or { status: "rated", value } (non-empty rating
//     class, e.g. "150").
//   - surface: "head-west" | "head-east" — which end head. Shell
//     nozzles are separately typed and stay catalog-resolved; they do
//     not belong in the head schedule.
//   - position: "top" | "bottom" on the vertical center plane.
//   - orientationDeg: face-normal direction in the vessel's local plan
//     frame (0 = +x/east, 90 = +y/south). Must be the axial outward
//     direction of the named head (0 for east, 180 for west).
//   - elevationIn: absolute elevation of the flange face (design
//     elevation frame; base datum is the instance base elevation).
//     Must sit above the centerline for "top", below it for "bottom",
//     with the flange fitting on the head face.
//   - projectionIn: tangent-line-to-flange projection (in) — the
//     distance from the head/shell tangent line to the flange face
//     along the vessel axis. Must be positive.
//   - unit / datum / projectionDatum are optional explicitness; when
//     present they must read "in" / "absolute" / "tangent-line" —
//     anything else is refused, never silently reinterpreted.
//
// Resolution — the version rides on the INSTANCE
// (`inst.headNozzleScheduleVersion`, copied from the design envelope
// by placeSymbol when the design carries the current marker, stamped
// by setHeadNozzleSchedule / upgradeHeadNozzleSchedules; see
// designerDocument.js). No load-time stamping: parseDesign never
// mutates a document, so old designs round-trip byte-identically.
//   - Unversioned instances resolve their PRIOR side-rule faces and
//     validate clean — old designs keep their shape ("unchanged
//     legacy until explicit upgrade"); the legacy state is shown in
//     the inspector (notice + upgrade preview), not as a validation
//     error, which would make old designs unsavable and the sample
//     unbuildable.
//   - Versioned instances with no/invalid schedule for an end nozzle
//     resolve NO face for it (null) and report
//     NOZZLE_SCHEDULE_UNRESOLVED — an incomplete schedule fails
//     closed; the prior default never silently defines a face.
//   - A valid authored schedule is authoritative on either version:
//     it resolves scheduled faces even on an unversioned instance
//     (authoring a schedule IS the upgrade).
//   - TEMA exchangers are excluded from the applicability table and
//     untouched; their definitions/anchors remain byte-identical.
//
// Geometry is the MODELED geometry the 3D view draws for a horizontal
// cylinder (DesignerViewport3D hcyl branch): radius r = depth/2,
// saddle height = max(0, height - depth), centerline elevation =
// base + saddle + r, shell length = max(1, width - r), tangent line
// at ±shellLength/2. No invented dimensions.
//
// Pure and framework-free. baseElevationIn is read locally
// (inst.baseElevationIn ?? 0) with the same default as vesselAccess's
// baseElevationIn — importing vesselAccess here would cycle
// (vesselAccess imports catalogAnchorsWorld from pipeAttachments,
// which imports this module).

import { findSymbol } from "./symbolRegistry";
import { flangeDims } from "./flangeGeometry";

/** Current head-nozzle-schedule model version (D10-04). */
export const HEAD_NOZZLE_SCHEDULE_VERSION = 1;

/**
 * Whether a vessel instance carries the current head-nozzle-schedule
 * layout version — i.e. it was placed into a schedule-aware design
 * or upgraded since. Unversioned instances are pre-schedule content:
 * their end nozzles resolve their prior side-rule faces until the
 * explicit upgrade.
 */
export function isCurrentHeadNozzleInstance(inst) {
  return inst?.headNozzleScheduleVersion === HEAD_NOZZLE_SCHEDULE_VERSION;
}

const EPS = 1e-6;

/**
 * The reviewed applicability table: the horizontal-vessel catalog
 * entries whose end-head nozzles are scheduled. Further real
 * horizontal-vessel entries are added here by review — never by a
 * shape heuristic (do NOT select every hcyl primitive: pumps,
 * drivers, exchangers and TEMA are excluded).
 */
export const HEAD_NOZZLE_VESSEL_TABLE = Object.freeze([
  Object.freeze({ symbolId: "horizontal-drum", label: "Horizontal drum", notes: "General horizontal drum." }),
  Object.freeze({ symbolId: "three-phase-separator", label: "Three-phase separator", notes: "Gas/oil/water separation." }),
  Object.freeze({ symbolId: "reflux-accumulator", label: "Reflux accumulator", notes: "Overhead reflux drum." }),
  Object.freeze({ symbolId: "lpg-bullet", label: "Pressurized bullet (LPG)", notes: "Horizontal pressure storage." }),
]);

/** Catalog ids whose end-head nozzles are scheduled. */
export const HEAD_NOZZLE_VESSEL_SYMBOL_IDS = Object.freeze(
  new Set(HEAD_NOZZLE_VESSEL_TABLE.map((row) => row.symbolId)),
);

/** True when the symbol is an applicable scheduled-head vessel. */
export function isScheduledHeadVessel(symbol) {
  return Boolean(symbol?.id) && HEAD_NOZZLE_VESSEL_SYMBOL_IDS.has(symbol.id);
}

/** The head surfaces a schedule entry may name. */
export const HEAD_SURFACES = Object.freeze(["head-west", "head-east"]);

/** The positions a head nozzle may take on the vertical center plane. */
export const HEAD_POSITIONS = Object.freeze(["top", "bottom"]);

/** Axial outward direction (local plan degrees) for a head surface. */
export function headSurfaceOrientationDeg(surface) {
  if (surface === "head-east") return 0;
  if (surface === "head-west") return 180;
  return null;
}

/** Vessel base elevation (in); 0 when the instance sets none. */
function baseElevationIn(inst) {
  return Number.isFinite(inst?.baseElevationIn) ? inst.baseElevationIn : 0;
}

/**
 * The modeled head geometry for a horizontal-vessel instance:
 * { radiusIn, saddleIn, centerlineIn, shellLengthIn, baseElevIn,
 *   effWidth, effDepth, effHeight }.
 * centerlineIn is the vessel axis elevation in the absolute design
 * frame (base + saddle + radius) — the same derivation the 3D view
 * draws for hcyl, so the face model and the depiction can never
 * disagree about where the axis is.
 */
export function headGeometry(symbol, inst) {
  const effWidth = inst?.widthIn ?? symbol?.widthIn ?? 0;
  const effDepth = inst?.depthIn ?? symbol?.depthIn ?? 0;
  const effHeight = inst?.heightIn ?? symbol?.heightIn ?? 0;
  const radiusIn = effDepth / 2;
  const saddleIn = Math.max(0, effHeight - effDepth);
  const baseElevIn = baseElevationIn(inst);
  return {
    radiusIn,
    saddleIn,
    centerlineIn: baseElevIn + saddleIn + radiusIn,
    shellLengthIn: Math.max(1, effWidth - radiusIn),
    baseElevIn,
    effWidth,
    effDepth,
    effHeight,
  };
}

/**
 * Effective nozzle specs for an instance: an authored instance list
 * (`inst.nozzles`) replaces the catalog set; otherwise the catalog
 * set. Same rule catalogAnchorsWorld uses.
 */
export function effectiveNozzleSpecs(symbol, inst) {
  if (Array.isArray(inst?.nozzles)) return inst.nozzles;
  return symbol?.nozzles || [];
}

/**
 * Which end head a catalog nozzle spec sits on ("west" | "east"), or
 * null when it is not an end-head nozzle. An end-head nozzle sits
 * exactly on the vessel's vertical center plane at an end: |fx| = 1
 * and fy = 0 in the nozzle fractional frame. A spec at the end plane
 * but offset from the center plane (fy != 0) is NOT an end-head
 * nozzle — it stays catalog-resolved as a side nozzle.
 */
export function endNozzleSide(spec) {
  if (!spec || typeof spec.fx !== "number" || typeof spec.fy !== "number") return null;
  if (Math.abs(Math.abs(spec.fx) - 1) > EPS || Math.abs(spec.fy) > EPS) return null;
  return spec.fx < 0 ? "west" : "east";
}

/** Effective end-head nozzle specs, excluding tombstoned ids. */
export function endNozzleSpecs(symbol, inst) {
  const tombstoned = new Set(
    Array.isArray(inst?.nozzleTombstones) ? inst.nozzleTombstones : [],
  );
  return effectiveNozzleSpecs(symbol, inst).filter(
    (spec) => spec && typeof spec.id === "string" && !tombstoned.has(spec.id) && endNozzleSide(spec) !== null,
  );
}

/** The effective end-head spec for an anchor id, or null. */
export function endNozzleSpecForAnchor(symbol, inst, anchorId) {
  if (typeof anchorId !== "string") return null;
  return endNozzleSpecs(symbol, inst).find((spec) => spec.id === anchorId) || null;
}

/** The instance's authored head-nozzle schedule (array) or null. */
export function headNozzleSchedule(inst) {
  return Array.isArray(inst?.headNozzleSchedule) ? inst.headNozzleSchedule : null;
}

/** The schedule entry for a nozzle id, or null. */
export function headNozzleScheduleEntry(inst, anchorId) {
  const schedule = headNozzleSchedule(inst);
  if (!schedule || typeof anchorId !== "string") return null;
  return schedule.find((entry) => entry?.id === anchorId) || null;
}

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Problems with ONE schedule entry (empty = valid). ctx carries the
 * vessel geometry and the end specs by id:
 * { centerlineIn, radiusIn, endSpecById }.
 * Every field is checked; nothing is defaulted or invented — a missing
 * or inconsistent field is a problem, never a silent assumption.
 */
export function headNozzleScheduleEntryProblems(entry, ctx) {
  const problems = [];
  const { centerlineIn, radiusIn, endSpecById } = ctx || {};
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return ["a schedule entry is malformed (not an object)."];
  }
  const id = entry.id;
  if (typeof id !== "string" || id.trim() === "") {
    problems.push("a schedule entry has no nozzle id.");
    return problems;
  }
  const spec = endSpecById?.get(id);
  if (!spec) {
    // Distinguish "names a real nozzle that is not an end nozzle"
    // from "names nothing at all": shell nozzles are separately
    // typed and do not belong in the head schedule.
    const allSpecs = ctx?.allSpecById;
    if (allSpecs?.has(id)) {
      problems.push(
        `nozzle "${id}" is not an end-head nozzle on this vessel — shell nozzles are separately typed and stay catalog-resolved.`,
      );
    } else {
      problems.push(`nozzle "${id}" is not a nozzle on this vessel.`);
    }
    return problems;
  }
  // Size: must match the catalog nozzle it schedules.
  if (!isFiniteNumber(entry.sizeIn) || !(entry.sizeIn > 0)) {
    problems.push(`nozzle "${id}": size is missing or not a positive number.`);
  } else if (entry.sizeIn !== spec.sizeIn) {
    problems.push(
      `nozzle "${id}": size ${entry.sizeIn} in does not match the catalog nozzle (${spec.sizeIn} in).`,
    );
  }
  // Rating: UNKNOWN is a valid preserved state; "rated" needs a value.
  const rating = entry.rating;
  if (!rating || typeof rating !== "object" || Array.isArray(rating)) {
    problems.push(
      `nozzle "${id}": rating is missing — use status "unknown" when the rating is not known; UNKNOWN is preserved, never invented.`,
    );
  } else if (rating.status === "unknown") {
    if (rating.value !== undefined && rating.value !== null) {
      problems.push(`nozzle "${id}": rating status "unknown" must not carry a value.`);
    }
  } else if (rating.status === "rated") {
    const v = rating.value;
    const ok = (typeof v === "string" && v.trim() !== "") || (typeof v === "number" && Number.isFinite(v));
    if (!ok) problems.push(`nozzle "${id}": rating status "rated" needs a rating value.`);
  } else {
    problems.push(`nozzle "${id}": rating status "${rating.status}" is unknown — use "unknown" or "rated".`);
  }
  // Surface: must name a head, and the head the nozzle actually sits on.
  const side = endNozzleSide(spec);
  const surface = entry.surface;
  if (surface !== "head-west" && surface !== "head-east") {
    problems.push(
      `nozzle "${id}": surface "${surface}" is not a head surface — use "head-west" or "head-east".`,
    );
  } else if ((side === "west" && surface !== "head-west") || (side === "east" && surface !== "head-east")) {
    problems.push(
      `nozzle "${id}" sits on the ${side} head but the schedule names ${surface} — the surface must match the nozzle's end.`,
    );
  }
  // Position: top or bottom on the vertical center plane. No lateral
  // ("side") placement exists for end-head nozzles. An unset position
  // is a missing authored fact, reported as missing — never defaulted.
  const position = entry.position;
  if (position === undefined || position === null || position === "") {
    problems.push(
      `nozzle "${id}": position is missing — select top or bottom on the vertical center plane.`,
    );
  } else if (position !== "top" && position !== "bottom") {
    problems.push(
      `nozzle "${id}": position "${position}" is not a head position — end-head nozzles sit top or bottom on the vertical center plane, never the sides.`,
    );
  }
  // Orientation: the face normal must be the axial outward direction
  // of the named head — authored, then verified, never assumed.
  const expectedDeg = surface === "head-west" || surface === "head-east" ? headSurfaceOrientationDeg(surface) : null;
  if (!isFiniteNumber(entry.orientationDeg)) {
    problems.push(`nozzle "${id}": orientation is missing (face-normal direction in degrees).`);
  } else if (expectedDeg !== null) {
    const diff = Math.abs(normalizeDeg(entry.orientationDeg) - normalizeDeg(expectedDeg));
    const circ = Math.min(diff, 360 - diff);
    if (circ > EPS) {
      problems.push(
        `nozzle "${id}": orientation ${entry.orientationDeg}° does not match the ${surface} head — the face normal is axial outward (${expectedDeg}°).`,
      );
    }
  }
  // Elevation: above the centerline for top, below it for bottom,
  // with the flange fitting on the head face (radial offset + flange
  // radius within the head radius).
  if (!isFiniteNumber(entry.elevationIn)) {
    problems.push(`nozzle "${id}": elevation is missing (absolute elevation in inches).`);
  } else if (position === "top" || position === "bottom") {
    if (position === "top" && !(entry.elevationIn > centerlineIn)) {
      problems.push(
        `nozzle "${id}": elevation ${entry.elevationIn} in is not above the vessel centerline ${centerlineIn} in for a top head nozzle.`,
      );
    } else if (position === "bottom" && !(entry.elevationIn < centerlineIn)) {
      problems.push(
        `nozzle "${id}": elevation ${entry.elevationIn} in is not below the vessel centerline ${centerlineIn} in for a bottom head nozzle.`,
      );
    }
    if (isFiniteNumber(entry.sizeIn) && entry.sizeIn > 0 && isFiniteNumber(radiusIn)) {
      const flangeRadiusIn = flangeDims(entry.sizeIn).odIn / 2;
      const radialIn = Math.abs(entry.elevationIn - centerlineIn);
      if (radialIn + flangeRadiusIn > radiusIn + 1e-9) {
        problems.push(
          `nozzle "${id}": the flange does not fit on the head face — radial offset ${radialIn} in + flange radius ${flangeRadiusIn} in exceeds the head radius ${radiusIn} in.`,
        );
      }
    }
  }
  // Projection: tangent-line-to-flange, positive — the flange face
  // sits outside the head.
  if (!isFiniteNumber(entry.projectionIn)) {
    problems.push(`nozzle "${id}": projection is missing (tangent-line-to-flange distance in inches).`);
  } else if (!(entry.projectionIn > 0)) {
    problems.push(
      `nozzle "${id}": projection ${entry.projectionIn} in must be positive — the flange face sits outside the tangent line.`,
    );
  }
  // Optional explicitness, refused when it contradicts the model.
  if (entry.unit !== undefined && entry.unit !== "in") {
    problems.push(`nozzle "${id}": unit "${entry.unit}" is not supported — schedule lengths are inches.`);
  }
  if (entry.datum !== undefined && entry.datum !== "absolute") {
    problems.push(`nozzle "${id}": datum "${entry.datum}" is not supported — elevations are absolute design elevations.`);
  }
  if (entry.projectionDatum !== undefined && entry.projectionDatum !== "tangent-line") {
    problems.push(`nozzle "${id}": projection datum "${entry.projectionDatum}" is not supported — projections are measured from the tangent line.`);
  }
  return problems;
}

/**
 * Problems with an instance's whole head-nozzle schedule (empty =
 * valid). A missing schedule is NOT a problem here — the missing
 * state is reported per nozzle by vesselHeadNozzleErrors.
 */
export function headNozzleScheduleProblems(symbol, inst) {
  if (inst?.headNozzleSchedule === undefined) return [];
  if (!Array.isArray(inst.headNozzleSchedule)) {
    return ["the head-nozzle schedule is not an array of entries."];
  }
  const problems = [];
  const geo = headGeometry(symbol, inst);
  const ends = endNozzleSpecs(symbol, inst);
  const endSpecById = new Map(ends.map((spec) => [spec.id, spec]));
  const allSpecById = new Map(
    effectiveNozzleSpecs(symbol, inst)
      .filter((spec) => spec && typeof spec.id === "string")
      .map((spec) => [spec.id, spec]),
  );
  const ctx = { centerlineIn: geo.centerlineIn, radiusIn: geo.radiusIn, endSpecById, allSpecById };
  const seen = new Set();
  for (const entry of inst.headNozzleSchedule) {
    if (entry && typeof entry.id === "string") {
      if (seen.has(entry.id)) problems.push(`nozzle "${entry.id}" is scheduled twice.`);
      seen.add(entry.id);
    }
    problems.push(...headNozzleScheduleEntryProblems(entry, ctx));
  }
  return problems;
}

/**
 * The scheduled face for one end-head anchor, or null when no valid
 * scheduled face exists (no schedule, invalid entry, non-applicable
 * symbol, non-end anchor). An unversioned vessel WITH a valid
 * schedule resolves its scheduled face here — authoring a schedule
 * is the upgrade; an unversioned vessel without one resolves its prior
 * side face through connectionFaceForAnchor, never here.
 *
 * Returns { anchorId, x, y, elevationIn, normal: {x, y}, vertical:
 * false, sizeIn, kind: "head", neckBase: { x, y, elevationIn } }.
 * - (x, y): the flange face in plan — tangent line + projection
 *   along the vessel axis, on the vertical center plane (no lateral
 *   offset), rotated by the instance rotation.
 * - elevationIn: the scheduled elevation.
 * - normal: the scheduled orientation (axial outward), rotated.
 * - neckBase: the tangent-line point at the face elevation — the
 *   modeled base of the nozzle neck stub.
 */
export function headNozzleFace(symbol, inst, anchorId) {
  if (!isScheduledHeadVessel(symbol)) return null;
  const spec = endNozzleSpecForAnchor(symbol, inst, anchorId);
  if (!spec) return null;
  const entry = headNozzleScheduleEntry(inst, anchorId);
  if (!entry) return null;
  const geo = headGeometry(symbol, inst);
  const ctx = {
    centerlineIn: geo.centerlineIn,
    radiusIn: geo.radiusIn,
    endSpecById: new Map([[spec.id, spec]]),
    allSpecById: new Map(
      effectiveNozzleSpecs(symbol, inst)
        .filter((s) => s && typeof s.id === "string")
        .map((s) => [s.id, s]),
    ),
  };
  if (headNozzleScheduleEntryProblems(entry, ctx).length > 0) return null;
  const side = endNozzleSide(spec);
  const sideSign = side === "west" ? -1 : 1;
  const rad = ((inst?.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate = (x, y) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const faceLocalX = sideSign * (geo.shellLengthIn / 2 + entry.projectionIn);
  const face = rotate(faceLocalX, 0);
  // The validator pins orientationDeg to the axial outward direction,
  // so the normal is the side sign rotated by the instance rotation
  // (exact for the unrotated case — no sin(180°) epsilon).
  const normal = rotate(sideSign, 0);
  const neckLocalX = sideSign * (geo.shellLengthIn / 2);
  const neck = rotate(neckLocalX, 0);
  return {
    anchorId,
    x: inst.x + face.x,
    y: inst.y + face.y,
    elevationIn: entry.elevationIn,
    normal,
    vertical: false,
    sizeIn: entry.sizeIn,
    kind: "head",
    neckBase: { x: inst.x + neck.x, y: inst.y + neck.y, elevationIn: entry.elevationIn },
  };
}

/**
 * The scheduled anchor for one end-head spec (plan position +
 * elevation), or null when no valid scheduled face exists. The
 * anchor carries the scheduled elevation so picking can tell
 * coincident upper/lower ports apart by elevation (anchorAtPoint),
 * and the head position/surface so the UI can label them.
 */
export function headNozzleAnchor(symbol, inst, spec) {
  const face = headNozzleFace(symbol, inst, spec?.id);
  if (!face) return null;
  const entry = headNozzleScheduleEntry(inst, spec.id);
  return {
    id: spec.id,
    x: face.x,
    y: face.y,
    sizeIn: face.sizeIn,
    elevationIn: face.elevationIn,
    headPosition: entry.position,
    surface: entry.surface,
    kind: "head",
  };
}

/**
 * True when an anchor is an end-head nozzle on an applicable vessel
 * in a current (non-legacy) design with no valid scheduled face —
 * the case where a claimed connection cannot resolve to a face
 * because the schedule is missing or invalid, not because the
 * reference is stale.
 */
export function isUnscheduledHeadNozzle(symbol, inst, anchorId) {
  if (!isScheduledHeadVessel(symbol)) return false;
  if (!isCurrentHeadNozzleInstance(inst)) return false;
  if (!endNozzleSpecForAnchor(symbol, inst, anchorId)) return false;
  return headNozzleFace(symbol, inst, anchorId) === null;
}

/**
 * validateDesign messages for the head-nozzle schedules. Per
 * applicable vessel instance:
 * - unversioned (legacy), no schedule: NO finding — it resolves its
 *   prior side faces and validates clean ("unchanged legacy until
 *   explicit upgrade"). The legacy state is shown in the inspector
 *   (notice + upgrade preview), not as a validation error: an error
 *   here would make every old design unsavable and the sample
 *   unbuildable (updateLevelDesign rejects any validation problem).
 * - versioned (current), no schedule: each end nozzle reports it has
 *   no scheduled head position (NOZZLE_SCHEDULE_UNRESOLVED);
 * - schedule present (either version): entry problems, plus a missing
 *   finding for each end nozzle the schedule does not cover.
 * Instances under the R8 legacy-components gate report nothing here
 * — their generated components stay off until the retrofit, and the
 * head findings appear with them.
 */
export function vesselHeadNozzleErrors(design) {
  const errors = [];
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst?.domain, inst?.symbolId);
    if (!isScheduledHeadVessel(symbol)) continue;
    if (inst?.legacyComponents === true) continue;
    const tag = inst.tag || inst.id;
    const label = symbol.label;
    const ends = endNozzleSpecs(symbol, inst);
    const schedule = headNozzleSchedule(inst);
    if (inst?.headNozzleSchedule === undefined) {
      if (!isCurrentHeadNozzleInstance(inst)) continue;
      for (const spec of ends) {
        errors.push(
          `Vessel ${tag} (${label}) nozzle ${spec.id} has no scheduled head position (NOZZLE_SCHEDULE_UNRESOLVED) — author the head-nozzle schedule for this vessel.`,
        );
      }
      continue;
    }
    for (const problem of headNozzleScheduleProblems(symbol, inst)) {
      errors.push(`Vessel ${tag} (${label}) head-nozzle schedule: ${problem}`);
    }
    if (schedule) {
      const covered = new Set(schedule.filter((e) => e && typeof e.id === "string").map((e) => e.id));
      for (const spec of ends) {
        if (!covered.has(spec.id)) {
          errors.push(
            `Vessel ${tag} (${label}) nozzle ${spec.id} has no scheduled head position (NOZZLE_SCHEDULE_UNRESOLVED) — the schedule does not cover it.`,
          );
        }
      }
    }
  }
  return errors;
}
