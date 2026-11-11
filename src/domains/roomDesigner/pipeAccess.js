// pipeAccess.js — D10-03 access as a checked output
// (Designer D10 PR C).
//
// Implements brief §D10-03 of
// results/chatgpt/designer-d10-routing-supports-access-implementation-brief-2026-10-23.md
// under the binding rules of
// briefs/designer/pipe-design-reference-digest-2026-10-23.md (digest §5
// access). Pure and framework-free: every function takes data and
// returns data; no function mutates its input design.
//
// What this module is:
// - Access model (brief item 1): authored entries, required equipment
//   access nodes, walk/drive polylines with swept clearance
//   envelopes, and equipment removal/pull/lift volumes, all under
//   `design.access`. Unknown applicability or a required access point
//   with no authored route is ACCESS_NOT_MODELED, never "clear." No
//   invented doors, no automatic roadway network.
// - Adopted §5.2 profiles (brief item 2): walkway 84-in headroom /
//   30-in horizontal clearance; secondary road 120-in headroom and
//   120-in width; platform width 30–36 in (default 36), roughly
//   36-in handrails, 84-in headroom. A user-authored LARGER
//   vehicle/access envelope is a deliberate project requirement and
//   is never shrunk to these minima; an authored envelope SMALLER
//   than the baseline fails the profile check. Actual pipe/fitting/
//   steel/stair envelopes are checked, never assumed.
// - Manway reference profile (brief item 3; digest §5.3): manway
//   centerline >=180 in above paving -> platform about 30 in below
//   the centerline; ladder runs <=360 in; platform vertical
//   separation >=96 in. This is a DISTINCT applicability profile
//   from the legacy D5 rule (sill >24 in -> catwalk at sill level),
//   and it outranks D5 where both apply: a legacy layout is
//   preserved (never silently relocated), but a disagreement is a
//   named MANWAY_PROFILE_CONFLICT with the reference platform
//   offered as an explicit repair. D5's catwalk width (48 in) is
//   legacy, not a profile violation — wider than the 30–36 in
//   platform range is a larger envelope, not a defect.
// - Operator access and removal paths (brief item 4; digest §4.8/
//   §5.5–5.6): required access for elevated nozzles/valves/
//   instruments is authored and checkable through the walk graph; a
//   removal/pull/lift volume must be clear of pipe runs and other
//   equipment. No thermal/process/maintenance plan is invented from
//   geometry. A valid pipe route can still fail access.
//   Binding is three-dimensional, never plan-only: a node satisfies
//   a subject only when its standing point is AT the subject's
//   actual face/manway/station coordinate in plan AND its standing
//   elevation is AT the face elevation (or the manway's platform
//   elevation) or it declares an explicit ladder/stairs connection
//   from its standing elevation up to that elevation. A node with
//   no elevation stands at grade; a face whose elevation is not
//   modeled (a TEMA anchor) can never be proven reached. No
//   universal reach radius is invented: standing above or below the
//   face without an explicit connection fails closed. And the
//   standing elevation itself must be reachable: grade, or a
//   platform at that elevation reached by a complete chain of
//   allowed vertical runs from grade (standingReachableDetail) —
//   an authored elevation with no platform and no climb is just a
//   number, and a node standing there attaches to no walk path.
//   The 360-in ladder cap applies to every modeled ladder edge in
//   that chain, so an invented intermediate elevation cannot hide
//   the unmodeled climb below it.
// - O6 crossovers (brief item 5; digest §5.4): where a
//   ground/sleeper corridor separates people from required
//   equipment, usable platformed crossings are required on a
//   connected walking path. Inter-crossover maximum 1200 in;
//   software endpoint-tail maximum 600 in; loop spacing cyclic.
//   Short applicable barriers still need a usable crossing. Closer
//   than 50 ft is allowed for access; 50–100 ft is the normal owner
//   range (the interval itself is the owner's call — the module
//   enforces the 1200/600 maxima, never a 50-ft minimum). Adjacent
//   rack IDs do not reset stationing: barriers sharing a groupId
//   form one continuous station line.
// - Crossover construction (brief item 6): a modeled grating deck,
//   stairs/landings, supports and guards, spanning the full
//   obstruction envelope and reaching both sides. Width/headroom
//   follow the adopted profile; clearance above pipes uses an
//   authored envelope/profile value (a reviewer default is not a
//   book dimension). No naked-pipe step-over. Balanced stations
//   N=ceil(L/1200), open positions (i+0.5)*L/N, loop equal spacing;
//   collision failures stay unresolved until edited/applied.
// - Walk graph (brief item 7): the graph must connect entry to each
//   required equipment access node. A bridge not connected on both
//   sides does not count. Low pipelines, stairs/support columns and
//   crossovers can obstruct roads. Pedestrian bridges never clear a
//   vehicle obstruction. No vehicle turning-radius/dynamics or
//   statutory egress claim.
//
// What this module deliberately does NOT do in PR C (see the PR
// report):
// - It is not wired into validateDesign. The current production
//   sample carries no D10-03 access data; wiring these findings in
//   before PR E revises the sample would break that acceptance test.
//   PR E wires pipeAccessRuleErrors into validateDesign when the
//   sample is revised.
// - It does not build D10-04 vessel end-head schedules. Manway
//   access here reads the existing D5 manway data and the §5.3
//   reference profile only.
// - It builds no React UI. The domain functions and reducer cases
//   are the editable workflow; the authoring controls that drive
//   them land with the integrated delivery (PR E).
// - It performs no migration, repair, repacking or new
//   infrastructure. Access data is optional authored metadata on the
//   design; designs without it validate as explicitly unmodeled,
//   never as passing.

import { physicalRouteIn } from "./pipeCrossings";
import {
  LOW_PIPE_ELEVATION_IN,
  SUPPORT_FACE_TOLERANCE_IN,
  pointAtStation,
  rackColumnWorldPositions,
  rackFootprint,
} from "./pipeSupports";
import {
  accessPackageWorld,
  baseElevationIn,
  deckCorners,
  gradeElevationIn,
  manwayLocal,
  manwaySpec,
  manwayWorld,
} from "./vesselAccess";
import { findSymbol } from "./symbolRegistry";
import { rackTopIn } from "./rackGeometry";
import { anchorsOf, connectionFaceForAnchor } from "./pipeAttachments";

/** Face-contact tolerance (in): single source is pipeCrossings via pipeSupports. */
export const ACCESS_FACE_TOLERANCE_IN = SUPPORT_FACE_TOLERANCE_IN;
/** Numerical station epsilon (in): representation policy, from D10-01. */
export const ACCESS_STATION_EPSILON_IN = 1e-6;
/** Low pipe elevation (in): a pipe at or below this is a walking/driving obstruction (D10-02). */
export const ACCESS_LOW_PIPE_ELEVATION_IN = LOW_PIPE_ELEVATION_IN;

/**
 * Adopted §5.2 walkway profile (digest §5.2): 84-in headroom,
 * 30-in horizontal clearance. Exact project thresholds.
 */
export const WALKWAY_PROFILE_IN = Object.freeze({ headroomIn: 84, widthIn: 30 });
/**
 * Adopted §5.2 secondary-road profile (digest §5.2): 120-in
 * headroom and 120-in width. Exact project thresholds.
 */
export const SECONDARY_ROAD_PROFILE_IN = Object.freeze({ headroomIn: 120, widthIn: 120 });
/**
 * Adopted §5.2 platform profile (digest §5.2): width 30–36 in,
 * roughly 36-in handrails, 84-in headroom. Default width 36 in
 * within that range. Width is a MINIMUM check only: a wider
 * platform (including the legacy D5 48-in catwalk) is a larger
 * envelope, never a defect.
 */
export const PLATFORM_PROFILE_IN = Object.freeze({
  widthMinIn: 30,
  widthMaxIn: 36,
  defaultWidthIn: 36,
  handrailIn: 36,
  headroomIn: 84,
});

/**
 * Manway reference profile (brief §D10-03 item 3; digest §5.3):
 * manway centerline >=180 in above paving requires a platform
 * about 30 in below the centerline; ladder runs <=360 in;
 * platform vertical separation >=96 in.
 */
export const MANWAY_PLATFORM_TRIGGER_IN = 180;
export const MANWAY_PLATFORM_DROP_IN = 30;
export const LADDER_RUN_MAX_IN = 360;
export const PLATFORM_SEPARATION_MIN_IN = 96;

/**
 * O6 crossover spacing (brief §D10-03 item 5; O6 adopted):
 * inter-crossover maximum 1200 in; endpoint-tail maximum 600 in.
 * The 50–100 ft owner range is NOT a module threshold — closer
 * than 50 ft is allowed; the module enforces only the maxima.
 */
export const CROSSOVER_GAP_MAX_IN = 1200;
export const CROSSOVER_TAIL_MAX_IN = 600;

export const ACCESS_CODES = Object.freeze({
  ACCESS_NOT_MODELED: "ACCESS_NOT_MODELED",
  CLEARANCE_HEADROOM_INSUFFICIENT: "CLEARANCE_HEADROOM_INSUFFICIENT",
  CLEARANCE_WIDTH_INSUFFICIENT: "CLEARANCE_WIDTH_INSUFFICIENT",
  CLEARANCE_PROFILE_UNVERIFIED: "CLEARANCE_PROFILE_UNVERIFIED",
  MANWAY_PROFILE_CONFLICT: "MANWAY_PROFILE_CONFLICT",
  MANWAY_PLATFORM_MISSING: "MANWAY_PLATFORM_MISSING",
  MANWAY_LADDER_RUN_EXCEEDED: "MANWAY_LADDER_RUN_EXCEEDED",
  MANWAY_PLATFORM_SEPARATION: "MANWAY_PLATFORM_SEPARATION",
  MANWAY_PROFILE_UNVERIFIED: "MANWAY_PROFILE_UNVERIFIED",
  OPERATOR_ACCESS_UNREACHABLE: "OPERATOR_ACCESS_UNREACHABLE",
  REMOVAL_PATH_OBSTRUCTED: "REMOVAL_PATH_OBSTRUCTED",
  REMOVAL_PATH_UNVERIFIED: "REMOVAL_PATH_UNVERIFIED",
  CROSSOVER_GAP_EXCEEDED: "CROSSOVER_GAP_EXCEEDED",
  CROSSOVER_TAIL_EXCEEDED: "CROSSOVER_TAIL_EXCEEDED",
  CROSSOVER_LOOP_GAP_EXCEEDED: "CROSSOVER_LOOP_GAP_EXCEEDED",
  CROSSOVER_MISSING: "CROSSOVER_MISSING",
  CROSSOVER_SPACING_UNVERIFIED: "CROSSOVER_SPACING_UNVERIFIED",
  CROSSOVER_STATION_OUT_OF_RANGE: "CROSSOVER_STATION_OUT_OF_RANGE",
  CROSSOVER_DECK_SHORT: "CROSSOVER_DECK_SHORT",
  CROSSOVER_TOO_NARROW: "CROSSOVER_TOO_NARROW",
  CROSSOVER_STAIRS_MISSING: "CROSSOVER_STAIRS_MISSING",
  CROSSOVER_SUPPORTS_MISSING: "CROSSOVER_SUPPORTS_MISSING",
  CROSSOVER_GUARDS_MISSING: "CROSSOVER_GUARDS_MISSING",
  CROSSOVER_CLEARANCE_LOW: "CROSSOVER_CLEARANCE_LOW",
  CROSSOVER_CLEARANCE_UNVERIFIED: "CROSSOVER_CLEARANCE_UNVERIFIED",
  CROSSOVER_HEADROOM_BLOCKED: "CROSSOVER_HEADROOM_BLOCKED",
  CROSSOVER_NOT_CONNECTED: "CROSSOVER_NOT_CONNECTED",
  WALKWAY_OBSTRUCTED: "WALKWAY_OBSTRUCTED",
  WALKWAY_HEADROOM_BLOCKED: "WALKWAY_HEADROOM_BLOCKED",
  DRIVE_OBSTRUCTED: "DRIVE_OBSTRUCTED",
  ACCESS_NODE_UNREACHABLE: "ACCESS_NODE_UNREACHABLE",
  BARRIER_SOURCE_UNVERIFIED: "BARRIER_SOURCE_UNVERIFIED",
  BARRIER_GROUP_UNVERIFIED: "BARRIER_GROUP_UNVERIFIED",
});

/** Required equipment access node kinds (brief item 1/4). */
export const ACCESS_NODE_KINDS = Object.freeze(
  new Set(["manway", "nozzle", "valve", "instrument", "removal"]),
);
/** Walk/drive path kinds (brief item 1). */
export const ACCESS_PATH_KINDS = Object.freeze(new Set(["walk", "drive"]));
/** Barrier source kinds (brief item 5): sleeper rack or low ground pipe. */
export const BARRIER_KINDS = Object.freeze(new Set(["sleeper-rack", "ground-pipe"]));

const EPS = ACCESS_STATION_EPSILON_IN;
const FACE = ACCESS_FACE_TOLERANCE_IN;

function finding(code, subjectId, message, extra = undefined) {
  const out = { code, subjectId, message };
  if (extra !== undefined) Object.assign(out, extra);
  return out;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function detach(value) {
  if (value === null || typeof value !== "object") return value;
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {
    // Fall through to the JSON copy below.
  }
  return JSON.parse(JSON.stringify(value));
}

let accessSeq = 0;
/** Reset the generated access-id counter (tests only). */
export function resetAccessIds() {
  accessSeq = 0;
}

function nextAccessId(prefix) {
  accessSeq += 1;
  return `${prefix}-${accessSeq}`;
}

function accessData(design) {
  return isPlainObject(design?.access) ? design.access : null;
}

function accessList(design, key) {
  const data = accessData(design);
  return Array.isArray(data?.[key]) ? data[key] : [];
}

// ---- Small geometry helpers (plan, inches) ------------------------------

function distPointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

function distPointToPolyline(p, points) {
  if (!Array.isArray(points) || points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    best = Math.min(best, distPointToSegment(p, points[i], points[i + 1]));
  }
  return best;
}

/** Nearest point on a polyline to p, with the segment index. */
function nearestPointOnPolyline(p, points) {
  let best = { point: null, segment: -1, distance: Infinity };
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(p.x - point.x, p.y - point.y);
    if (distance < best.distance) best = { point, segment: i, distance };
  }
  return best;
}

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

function segmentsCross(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** First intersection point of segment a–b with a polygon, or null. */
function segmentPolygonIntersection(a, b, corners) {
  if (pointInPolygon(a, corners)) return { x: a.x, y: a.y };
  for (let i = 0; i < corners.length; i += 1) {
    const c0 = corners[i];
    const c1 = corners[(i + 1) % corners.length];
    if (!segmentsCross(a, b, c0, c1)) continue;
    const d = (b.x - a.x) * (c1.y - c0.y) - (b.y - a.y) * (c1.x - c0.x);
    if (Math.abs(d) < 1e-9) continue;
    const t = ((c0.x - a.x) * (c1.y - c0.y) - (c0.y - a.y) * (c1.x - c0.x)) / d;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return null;
}

function segmentIntersectsPolygon(a, b, corners) {
  return segmentPolygonIntersection(a, b, corners) !== null;
}

/**
 * Clip a route segment to a (convex) corners polygon in plan and
 * return the clipped portion (plan + interpolated z), or null when
 * the segment never enters. Elevations interpolate linearly along
 * the segment — the shared physical profile (same construction as
 * the deck-box test in vesselAccess).
 */
function clipSegmentToRect(a, b, corners) {
  let poly = [
    { x: a.x, y: a.y, zIn: a.zIn },
    { x: b.x, y: b.y, zIn: b.zIn },
  ];
  const n = corners.length;
  const cx = corners.reduce((s, c) => s + c.x, 0) / n;
  const cy = corners.reduce((s, c) => s + c.y, 0) / n;
  for (let e = 0; e < n; e += 1) {
    const c0 = corners[e];
    const c1 = corners[(e + 1) % n];
    const edgeCross = (p) => (c1.x - c0.x) * (p.y - c0.y) - (c1.y - c0.y) * (p.x - c0.x);
    const insideSign = Math.sign(edgeCross({ x: cx, y: cy })) || 1;
    const next = [];
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dp = edgeCross(p) * insideSign;
      const dq = edgeCross(q) * insideSign;
      if (dp >= -1e-9) next.push(p);
      if ((dp > 1e-9 && dq < -1e-9) || (dp < -1e-9 && dq > 1e-9)) {
        const t = dp / (dp - dq);
        next.push({
          x: p.x + (q.x - p.x) * t,
          y: p.y + (q.y - p.y) * t,
          zIn: p.zIn + (q.zIn - p.zIn) * t,
        });
      }
    }
    poly = next;
    if (poly.length === 0) return null;
  }
  return poly;
}

/** z-range of a route segment's portion inside a rect, or null. */
function clippedZRange(a, b, corners) {
  const poly = clipSegmentToRect(a, b, corners);
  if (!poly) return null;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of poly) {
    zMin = Math.min(zMin, p.zIn);
    zMax = Math.max(zMax, p.zIn);
  }
  return { zMin, zMax };
}

// ---- §5.2 clearance profiles (brief item 2) ------------------------------

/** Baseline profile for a path kind: walkway for "walk", secondary road for "drive". */
export function baselineProfileFor(kind) {
  if (kind === "drive") return SECONDARY_ROAD_PROFILE_IN;
  return WALKWAY_PROFILE_IN;
}

/**
 * Resolve the effective clearance profile for a path: the adopted
 * baseline for its kind, overridden by an authored profile when
 * given. An authored profile LARGER than the baseline is a
 * deliberate project requirement and stands; an authored profile
 * SMALLER than the baseline is never silently applied — it is
 * flagged by validateClearanceEnvelope and the baseline governs
 * the check.
 */
export function resolvePathProfile(path) {
  const baseline = baselineProfileFor(path?.kind);
  const authored = isPlainObject(path?.profile) ? path.profile : null;
  if (!authored) return { ...baseline, source: "baseline" };
  // Per-dimension: an authored value larger than the baseline
  // stands; a smaller one is never silently applied — the baseline
  // floor governs that dimension (validateClearanceEnvelope flags
  // the authored shortfall separately).
  const headroomIn = isFiniteNumber(authored.headroomIn)
    ? Math.max(authored.headroomIn, baseline.headroomIn)
    : baseline.headroomIn;
  const widthIn = isFiniteNumber(authored.widthIn)
    ? Math.max(authored.widthIn, baseline.widthIn)
    : baseline.widthIn;
  const source =
    headroomIn === baseline.headroomIn && widthIn === baseline.widthIn
      ? "baseline"
      : headroomIn === authored.headroomIn && widthIn === authored.widthIn
        ? "authored"
        : "mixed";
  return { headroomIn, widthIn, source };
}

/**
 * Validate an actual clearance against an adopted profile kind
 * ("walkway" | "secondary-road" | "platform"). Exact thresholds:
 * walkway headroom 84 / width 30; secondary road 120 / 120;
 * platform width minimum 30 (a wider platform is a larger
 * envelope, never a defect) and headroom 84. A missing or
 * non-finite value is explicitly unverified, never assumed.
 */
export function validateClearanceEnvelope(kind, actual) {
  const subject = kind ?? "(unknown)";
  const profile =
    kind === "drive" || kind === "secondary-road"
      ? SECONDARY_ROAD_PROFILE_IN
      : kind === "platform"
        ? PLATFORM_PROFILE_IN
        : WALKWAY_PROFILE_IN;
  const findings = [];
  const headroom = isFiniteNumber(actual?.headroomIn) ? actual.headroomIn : null;
  const width = isFiniteNumber(actual?.widthIn) ? actual.widthIn : null;
  if (headroom === null || width === null) {
    findings.push(
      finding(
        ACCESS_CODES.CLEARANCE_PROFILE_UNVERIFIED,
        subject,
        `${kind} clearance is unverified: headroom and width must both be authored numbers.`,
      ),
    );
    return { state: "CLEARANCE_PROFILE_UNVERIFIED", findings };
  }
  const headroomMin = profile.headroomIn;
  const widthMin = kind === "platform" ? profile.widthMinIn : profile.widthIn;
  if (headroom < headroomMin - 1e-9) {
    findings.push(
      finding(
        ACCESS_CODES.CLEARANCE_HEADROOM_INSUFFICIENT,
        subject,
        `${kind} headroom ${headroom} in is below the adopted ${headroomMin} in.`,
      ),
    );
  }
  if (width < widthMin - 1e-9) {
    findings.push(
      finding(
        ACCESS_CODES.CLEARANCE_WIDTH_INSUFFICIENT,
        subject,
        `${kind} width ${width} in is below the adopted ${widthMin} in.`,
      ),
    );
  }
  if (findings.length > 0) return { state: findings[0].code, findings };
  return { state: "PASS", findings: [] };
}

// ---- §5.3 manway reference profile (brief item 3) ------------------------

/**
 * The manway centerline ABOVE PAVING (in): base elevation + sill
 * (bottom of the opening, above the vessel base) + half the opening
 * diameter, minus the plot grade. Null when the instance has no
 * manway. The centerline — not the sill — is the §5.3 datum; the
 * legacy D5 rule measures the sill instead.
 */
export function manwayCenterlineAbovePavingIn(design, inst) {
  const symbol = findSymbol(inst?.domain, inst?.symbolId);
  const spec = manwaySpec(symbol, inst);
  if (!spec) return null;
  const local = manwayLocal(symbol, inst);
  if (!local) return null;
  return (
    baseElevationIn(inst) + local.sillIn + local.diameterIn / 2 - gradeElevationIn(design)
  );
}

/**
 * The §5.3 reference platform for a manway, or null when the
 * instance has no manway. When the centerline is >=180 in above
 * paving the profile requires a platform about 30 in below the
 * centerline, ladder runs of at most 360 in, and platform vertical
 * separation of at least 96 in. Below the trigger the profile does
 * not apply (required: false) — the legacy D5 catwalk stands as
 * legacy, and no conflict is raised.
 *
 * Frames, kept distinct and converted exactly once: `centerlineIn`
 * / `centerlineAbovePavingIn` is the centerline height ABOVE
 * PAVING; `centerlineElevationIn` is the same centerline in the
 * design's absolute elevation frame (grade + above-paving);
 * `platformAbovePavingIn` is the reference platform height above
 * paving (centerline − 30); `platformElevationIn` is the reference
 * platform in the ABSOLUTE frame (grade + above-paving) — the
 * frame `effectiveManwayPlatform` reports, so the two compare
 * directly. Ladder runs count the climb from paving to the
 * platform, which is the above-paving height — grade is NOT
 * subtracted a second time.
 */
export function manwayReferencePlatform(design, inst) {
  const centerline = manwayCenterlineAbovePavingIn(design, inst);
  if (centerline === null) return null;
  const required = centerline >= MANWAY_PLATFORM_TRIGGER_IN - 1e-9;
  const grade = gradeElevationIn(design);
  const platformAbovePaving = centerline - MANWAY_PLATFORM_DROP_IN;
  return {
    centerlineIn: centerline,
    centerlineAbovePavingIn: centerline,
    centerlineElevationIn: grade + centerline,
    required,
    platformAbovePavingIn: platformAbovePaving,
    platformElevationIn: grade + platformAbovePaving,
    ladderRunMaxIn: LADDER_RUN_MAX_IN,
    platformSeparationMinIn: PLATFORM_SEPARATION_MIN_IN,
    // Ladder runs from the paving to the reference platform, split
    // into runs of at most 360 in: the count the profile implies.
    // The climb IS platformAbovePaving (the height above paving);
    // subtracting grade again would count the paving twice.
    ladderRuns: required
      ? Math.max(1, Math.ceil(platformAbovePaving / LADDER_RUN_MAX_IN - 1e-9))
      : 0,
  };
}

/**
 * The effective platform for a manway: an authored platform in
 * design.access.platforms for the symbol wins (it IS the explicit
 * repair); otherwise the legacy D5-derived deck counts. Returns
 * null when neither exists. The D5 deck elevation is its world
 * elevation (base + sill); an authored platform carries its own
 * elevationIn.
 */
export function effectiveManwayPlatform(design, inst) {
  // noAccess on the instance suppresses the legacy D5 deck for that
  // manway (access comes from elsewhere, or is explicitly declined):
  // the reference profile then finds no platform at all.
  if (inst?.noAccess === true) return null;
  const authored = accessList(design, "platforms").find(
    (p) => p?.symbolId === inst?.id && isFiniteNumber(p?.elevationIn),
  );
  if (authored) {
    return { elevationIn: authored.elevationIn, source: "authored", id: authored.id ?? null };
  }
  const symbol = findSymbol(inst?.domain, inst?.symbolId);
  const pkg = accessPackageWorld(symbol, inst, design);
  if (pkg?.deck && isFiniteNumber(pkg.deck.elevationIn)) {
    return { elevationIn: pkg.deck.elevationIn, source: "legacy-d5", id: null };
  }
  return null;
}

/**
 * §5.3 / D5 compatibility for every manway in the design. Legacy
 * layouts are preserved — this function never moves a deck or a
 * manway; it names the disagreement and the reference platform is
 * the explicit repair (manwayReferencePlatform).
 *
 * - Reference applies (centerline >=180) and no platform exists at
 *   all (suppressed via noAccess, or none derived): MANWAY_PLATFORM_MISSING.
 * - Reference applies and the effective platform elevation differs
 *   from centerline-30: MANWAY_PROFILE_CONFLICT, naming both
 *   elevations and the delta. The D5 deck rides at the sill; the
 *   reference platform rides 30 in below the centerline — for a
 *   24-in opening those differ by 18 in, and the legacy deck is
 *   kept until the designer explicitly applies the repair.
 * - Reference applies and the single ladder climb from paving to
 *   the platform exceeds 360 in: MANWAY_LADDER_RUN_EXCEEDED.
 * - Two authored platforms for the same manway closer than 96 in
 *   apart vertically: MANWAY_PLATFORM_SEPARATION.
 * - Reference does not apply (centerline <180): the D5 catwalk
 *   stands as legacy — no finding.
 * - Manway data missing/incomplete: MANWAY_PROFILE_UNVERIFIED.
 */
export function manwayProfileCompatibility(design) {
  const findings = [];
  let applicable = false;
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst?.domain, inst?.symbolId);
    if (!symbol?.manway) continue;
    if (manwaySpec(symbol, inst) === null) continue; // none, or deleted
    const label = `Symbol ${inst.id} (${symbol.label}) manway`;
    const ref = manwayReferencePlatform(design, inst);
    if (ref === null) {
      findings.push(
        finding(
          ACCESS_CODES.MANWAY_PROFILE_UNVERIFIED,
          inst.id,
          `${label} manway profile is unverified: the manway geometry is incomplete.`,
        ),
      );
      continue;
    }
    if (!ref.required) continue; // §5.3 does not apply; D5 legacy stands.
    applicable = true;
    const platform = effectiveManwayPlatform(design, inst);
    if (!platform) {
      findings.push(
        finding(
          ACCESS_CODES.MANWAY_PLATFORM_MISSING,
          inst.id,
          `${label} centerline is ${Math.round(ref.centerlineIn)} in above paving, so the §5.3 reference profile requires a platform ${MANWAY_PLATFORM_DROP_IN} in below the centerline (elevation ${Math.round(ref.platformElevationIn)} in) and none is present.`,
        ),
      );
      continue;
    }
    if (Math.abs(platform.elevationIn - ref.platformElevationIn) > EPS) {
      findings.push(
        finding(
          ACCESS_CODES.MANWAY_PROFILE_CONFLICT,
          inst.id,
          `${label} platform sits at ${Math.round(platform.elevationIn)} in (${platform.source}), but the §5.3 reference profile puts it ${MANWAY_PLATFORM_DROP_IN} in below the ${Math.round(ref.centerlineIn)}-in centerline, at ${Math.round(ref.platformElevationIn)} in — a ${Math.round(Math.abs(platform.elevationIn - ref.platformElevationIn))}-in difference. Preserve the legacy layout or apply the reference platform explicitly; the D5 sill datum is not the book requirement.`,
          { referenceElevationIn: ref.platformElevationIn, platformElevationIn: platform.elevationIn },
        ),
      );
    }
    const climb = platform.elevationIn - gradeElevationIn(design);
    if (climb > LADDER_RUN_MAX_IN + 1e-9) {
      findings.push(
        finding(
          ACCESS_CODES.MANWAY_LADDER_RUN_EXCEEDED,
          inst.id,
          `${label} ladder climb is ${Math.round(climb)} in from paving to the platform, over the §5.3 maximum ladder run of ${LADDER_RUN_MAX_IN} in — intermediate platforms are required.`,
        ),
      );
    }
    // Authored intermediate platforms for the same manway must be
    // at least 96 in apart vertically.
    const authored = accessList(design, "platforms").filter(
      (p) => p?.symbolId === inst.id && isFiniteNumber(p?.elevationIn),
    );
    const elevations = authored.map((p) => p.elevationIn).sort((a, b) => a - b);
    for (let i = 0; i + 1 < elevations.length; i += 1) {
      if (elevations[i + 1] - elevations[i] < PLATFORM_SEPARATION_MIN_IN - 1e-9) {
        findings.push(
          finding(
            ACCESS_CODES.MANWAY_PLATFORM_SEPARATION,
            inst.id,
            `${label} has authored platforms ${Math.round(elevations[i])} in and ${Math.round(elevations[i + 1])} in apart — less than the §5.3 minimum platform vertical separation of ${PLATFORM_SEPARATION_MIN_IN} in.`,
          ),
        );
        break;
      }
    }
  }
  if (findings.length > 0) return { state: findings[0].code, findings };
  // No manway triggers §5.3: the profile does not apply at all
  // (the D5 legacy stands), which is distinct from passing it.
  return { state: applicable ? "PASS" : "NOT_APPLICABLE", findings: [] };
}

// ---- Barriers: ground/sleeper corridors (brief item 5) --------------------

/**
 * Barrier geometry derived from its source — never a label alone.
 * Sleeper rack: footprint from the rack instance (length/width from
 * rack params, axis = the rack's local x-axis in world plan).
 * Ground pipe: the run's single straight physical leg (axis = first
 * to last point, length = developed length, width = OD + 2x
 * insulation). Returns { geometry, findings }: geometry is null
 * when the source does not resolve, and findings name the failure.
 * topElevationIn is the effective obstruction top: the authored
 * value when given (it must be at least the rack top of steel /
 * the pipe top, else the authored value contradicts the source);
 * for a ground pipe with no authored top it derives from the
 * route; for a rack with no authored top it is the rack top of
 * steel, which the source already fixes.
 */
export function barrierGeometry(design, barrier) {
  const barrierId = barrier?.id ?? "(unknown)";
  if (!isPlainObject(barrier) || !BARRIER_KINDS.has(barrier.kind)) {
    return {
      geometry: null,
      findings: [
        finding(
          ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED,
          barrierId,
          `Barrier ${barrierId} has no usable kind (sleeper-rack or ground-pipe).`,
        ),
      ],
    };
  }
  if (barrier.kind === "sleeper-rack") {
    const footprint = rackFootprint(design, barrier.rackId);
    if (!footprint) {
      return {
        geometry: null,
        findings: [
          finding(
            ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED,
            barrierId,
            `Barrier ${barrierId} references rack ${barrier.rackId ?? "(none)"}, which does not resolve to a rack instance.`,
          ),
        ],
      };
    }
    const rad = ((footprint.rotationDeg || 0) * Math.PI) / 180;
    const axis = { x: Math.cos(rad), y: Math.sin(rad) };
    const lengthIn = footprint.halfL * 2;
    const widthIn = footprint.halfW * 2;
    const origin = {
      x: footprint.cx - axis.x * (lengthIn / 2),
      y: footprint.cy - axis.y * (lengthIn / 2),
    };
    const rackTop = rackTopIn(footprint.params);
    const authoredTop = isFiniteNumber(barrier.topElevationIn) ? barrier.topElevationIn : null;
    const findings = [];
    if (authoredTop !== null && authoredTop < rackTop - 1e-9) {
      findings.push(
        finding(
          ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED,
          barrierId,
          `Barrier ${barrierId} top elevation ${authoredTop} in is below the rack top of steel ${rackTop} in.`,
        ),
      );
    }
    const corners = deckCorners({
      cx: footprint.cx,
      cy: footprint.cy,
      angleDeg: footprint.rotationDeg || 0,
      widthIn,
      depthIn: lengthIn,
    });
    return {
      geometry: {
        id: barrierId,
        kind: "sleeper-rack",
        sourceId: barrier.rackId,
        groupId: barrier.groupId ?? null,
        axis,
        origin,
        lengthIn,
        widthIn,
        topElevationIn: authoredTop ?? rackTop,
        rackTopIn: rackTop,
        corners,
      },
      findings,
    };
  }
  // ground-pipe
  const run = (design?.pipes || []).find((r) => r.id === barrier.runId);
  if (!run || !Array.isArray(run.points) || run.points.length < 2) {
    return {
      geometry: null,
      findings: [
        finding(
          ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED,
          barrierId,
          `Barrier ${barrierId} references pipe run ${barrier.runId ?? "(none)"}, which does not resolve to a run.`,
        ),
      ],
    };
  }
  const route = physicalRouteIn(design, run);
  if (route.length !== 2) {
    return {
      geometry: null,
      findings: [
        finding(
          ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED,
          barrierId,
          `Barrier ${barrierId} pipe run ${run.id} is not a single straight leg, so it has no single barrier axis.`,
        ),
      ],
    };
  }
  const [a, b] = route;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthIn = Math.hypot(dx, dy);
  if (!(lengthIn > EPS)) {
    return {
      geometry: null,
      findings: [
        finding(
          ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED,
          barrierId,
          `Barrier ${barrierId} pipe run ${run.id} has zero length.`,
        ),
      ],
    };
  }
  const axis = { x: dx / lengthIn, y: dy / lengthIn };
  const radius = (isFiniteNumber(run.outsideDiameterIn) ? run.outsideDiameterIn : run.diameterIn ?? 0) / 2;
  const insulation = isFiniteNumber(run.insulationIn) ? run.insulationIn : 0;
  const widthIn = radius * 2 + insulation * 2;
  const pipeTop = Math.max(a.zIn, b.zIn) + radius;
  const authoredTop = isFiniteNumber(barrier.topElevationIn) ? barrier.topElevationIn : null;
  const findings = [];
  if (authoredTop !== null && authoredTop < pipeTop - 1e-9) {
    findings.push(
      finding(
        ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED,
        barrierId,
        `Barrier ${barrierId} top elevation ${authoredTop} in is below the pipe top ${pipeTop} in.`,
      ),
    );
  }
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const angleDeg = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
  const corners = deckCorners({ cx, cy, angleDeg, widthIn, depthIn: lengthIn });
  return {
    geometry: {
      id: barrierId,
      kind: "ground-pipe",
      sourceId: barrier.runId,
      groupId: barrier.groupId ?? null,
      axis,
      origin: { x: a.x, y: a.y },
      lengthIn,
      widthIn,
      topElevationIn: authoredTop ?? pipeTop,
      rackTopIn: null,
      corners,
    },
    findings,
  };
}

/** Station of a plan point along a barrier's axis (origin = station 0). */
export function barrierStation(geometry, point) {
  if (!geometry || !point) return null;
  return (point.x - geometry.origin.x) * geometry.axis.x + (point.y - geometry.origin.y) * geometry.axis.y;
}

/** Plan point on a barrier's centerline at a station. */
export function barrierPointAtStation(geometry, stationIn) {
  return {
    x: geometry.origin.x + geometry.axis.x * stationIn,
    y: geometry.origin.y + geometry.axis.y * stationIn,
  };
}

/**
 * The continuous station line for a corridor: either one barrier
 * (barrierId) or a group of barriers sharing a groupId. Barriers
 * in a group form ONE corridor whose stationing does not reset at
 * a rack ID: they must share one axis direction, lie on one line,
 * and join contiguously (gaps over the 0.5-in face tolerance
 * break the group). A lone barrier is its own line. Returns
 * { lengthIn, segments, findings } where segments are
 * [{ barrierId, offsetIn, lengthIn }] in station order.
 */
export function corridorStationLine(design, { groupId = null, barrierId = null } = {}) {
  const barriers = accessList(design, "barriers").filter((b) => {
    if (barrierId != null) return b?.id === barrierId;
    if (groupId != null) return b?.groupId === groupId;
    return false;
  });
  if (barriers.length === 0) {
    return {
      lengthIn: 0,
      segments: [],
      findings: [
        finding(
          ACCESS_CODES.BARRIER_GROUP_UNVERIFIED,
          barrierId ?? groupId ?? "(unknown)",
          `No barriers form corridor ${groupId ?? barrierId ?? "(unknown)"}.`,
        ),
      ],
    };
  }
  const geometries = [];
  const findings = [];
  for (const barrier of barriers) {
    const { geometry, findings: gFindings } = barrierGeometry(design, barrier);
    findings.push(...gFindings);
    if (!geometry) continue;
    geometries.push(geometry);
  }
  if (geometries.length === 0) {
    return { lengthIn: 0, segments: [], findings };
  }
  if (barrierId != null || geometries.length === 1) {
    const g = geometries[0];
    return { lengthIn: g.lengthIn, segments: [{ barrierId: g.id, offsetIn: 0, lengthIn: g.lengthIn }], findings };
  }
  // Grouped: one common axis. Project every origin onto the first
  // barrier's axis; all must share the direction and line.
  const base = geometries[0];
  const ordered = geometries
    .map((g) => {
      const dot = g.axis.x * base.axis.x + g.axis.y * base.axis.y;
      const across = Math.abs(
        (g.origin.x - base.origin.x) * -base.axis.y + (g.origin.y - base.origin.y) * base.axis.x,
      );
      const along = (g.origin.x - base.origin.x) * base.axis.x + (g.origin.y - base.origin.y) * base.axis.y;
      return { g, dot, across, along };
    })
    .sort((a, b) => a.along - b.along);
  for (const { g, dot, across } of ordered) {
    if (Math.abs(dot - 1) > 1e-9 || across > FACE) {
      findings.push(
        finding(
          ACCESS_CODES.BARRIER_GROUP_UNVERIFIED,
          groupId,
          `Barrier ${g.id} does not share corridor ${groupId}'s axis and line, so the corridor stationing is unverified.`,
        ),
      );
    }
  }
  if (findings.some((f) => f.code === ACCESS_CODES.BARRIER_GROUP_UNVERIFIED)) {
    return { lengthIn: 0, segments: [], findings };
  }
  // Contiguity: each next segment must start where the previous
  // ends, within the face tolerance.
  const segments = [];
  let cursor = ordered[0].along;
  let lengthIn = 0;
  for (const { g, along } of ordered) {
    if (Math.abs(along - cursor) > FACE) {
      findings.push(
        finding(
          ACCESS_CODES.BARRIER_GROUP_UNVERIFIED,
          groupId,
          `Barrier ${g.id} leaves a ${Math.round(Math.abs(along - cursor))}-in gap in corridor ${groupId}, so the corridor stationing is unverified.`,
        ),
      );
      return { lengthIn: 0, segments: [], findings };
    }
    segments.push({ barrierId: g.id, offsetIn: along - ordered[0].along, lengthIn: g.lengthIn });
    cursor = along + g.lengthIn;
    lengthIn = cursor - ordered[0].along;
  }
  return { lengthIn, segments, findings };
}

// ---- O6 crossover spacing (brief item 5) ---------------------------------

/**
 * Balanced crossover stations for a barrier of length L (in):
 * N = ceil(L / 1200); open positions (i + 0.5) * L / N; loop
 * positions i * L / N (equal cyclic spacing). N >= 1 always — a
 * short applicable barrier still needs a usable crossing, at its
 * middle. Non-finite or non-positive length returns [].
 */
export function suggestCrossoverStations(lengthIn, { loop = false } = {}) {
  if (!isFiniteNumber(lengthIn) || lengthIn <= 0) return [];
  const n = Math.max(1, Math.ceil(lengthIn / CROSSOVER_GAP_MAX_IN - 1e-9));
  const stations = [];
  for (let i = 0; i < n; i += 1) {
    stations.push(loop ? (i * lengthIn) / n : ((i + 0.5) * lengthIn) / n);
  }
  return stations;
}

/**
 * Pure station math for crossover spacing on one station line of
 * length L: inter-crossover gaps <=1200 in, endpoint tails <=600
 * in (open lines), and for loops the cyclic wrap gap <=1200 in
 * with no tails. Exact thresholds: 1200 and 600 pass, 1200.001
 * and 600.001 fail.
 */
export function validateCrossoverSpacing(lengthIn, stations, { loop = false, subjectId = "(barrier)" } = {}) {
  const findings = [];
  if (!isFiniteNumber(lengthIn) || lengthIn <= 0) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_SPACING_UNVERIFIED,
        subjectId,
        `Crossover spacing for ${subjectId} is unverified: the barrier length is not a finite positive number.`,
      ),
    );
    return { state: "CROSSOVER_SPACING_UNVERIFIED", findings };
  }
  const sorted = [...(stations || [])].filter(isFiniteNumber).sort((a, b) => a - b);
  if (sorted.length === 0) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_MISSING,
        subjectId,
        `Barrier ${subjectId} (${Math.round(lengthIn)} in) has no crossover, but a usable crossing is required where it separates people from required equipment.`,
      ),
    );
    return { state: "CROSSOVER_MISSING", findings };
  }
  if (!loop) {
    if (sorted[0] - 0 > CROSSOVER_TAIL_MAX_IN + 1e-9) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_TAIL_EXCEEDED,
          subjectId,
          `First crossover on ${subjectId} is ${Math.round(sorted[0])} in from the barrier start — over the ${CROSSOVER_TAIL_MAX_IN}-in endpoint-tail maximum.`,
        ),
      );
    }
    if (lengthIn - sorted[sorted.length - 1] > CROSSOVER_TAIL_MAX_IN + 1e-9) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_TAIL_EXCEEDED,
          subjectId,
          `Last crossover on ${subjectId} is ${Math.round(lengthIn - sorted[sorted.length - 1])} in from the barrier end — over the ${CROSSOVER_TAIL_MAX_IN}-in endpoint-tail maximum.`,
        ),
      );
    }
  }
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    if (sorted[i + 1] - sorted[i] > CROSSOVER_GAP_MAX_IN + 1e-9) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_GAP_EXCEEDED,
          subjectId,
          `Crossovers on ${subjectId} are ${Math.round(sorted[i + 1] - sorted[i])} in apart — over the ${CROSSOVER_GAP_MAX_IN}-in inter-crossover maximum.`,
        ),
      );
    }
  }
  if (loop && sorted.length > 0) {
    const wrap = sorted[0] + lengthIn - sorted[sorted.length - 1];
    if (wrap > CROSSOVER_GAP_MAX_IN + 1e-9) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_LOOP_GAP_EXCEEDED,
          subjectId,
          `Cyclic crossover gap on loop ${subjectId} is ${Math.round(wrap)} in — over the ${CROSSOVER_GAP_MAX_IN}-in inter-crossover maximum.`,
        ),
      );
    }
  }
  if (findings.length > 0) return { state: findings[0].code, findings };
  return { state: "PASS", findings: [] };
}

/**
 * Spacing validation for one barrier (ungrouped) or one corridor
 * group (grouped): resolves the station line, gathers the
 * crossovers on every barrier in it at their joined stations, and
 * applies the gap/tail/loop rules across rack-ID splits.
 */
export function validateCorridorSpacing(design, barrierIdOrGroup, { loop = false } = {}) {
  const barriers = accessList(design, "barriers");
  const crossovers = accessList(design, "crossovers");
  const target = barriers.find((b) => b?.id === barrierIdOrGroup);
  const scope =
    target && target.groupId != null
      ? { groupId: target.groupId }
      : { barrierId: barrierIdOrGroup };
  const { lengthIn, segments, findings: lineFindings } = corridorStationLine(design, scope);
  if (lineFindings.length > 0) {
    return { state: lineFindings[0].code, findings: lineFindings };
  }
  const stations = [];
  for (const seg of segments) {
    for (const c of crossovers) {
      if (c?.barrierId === seg.barrierId && isFiniteNumber(c?.stationIn)) {
        stations.push(seg.offsetIn + c.stationIn);
      }
    }
  }
  return validateCrossoverSpacing(lengthIn, stations, {
    loop,
    subjectId: scope.groupId != null ? `corridor ${scope.groupId}` : barrierIdOrGroup,
  });
}

// ---- Crossover construction (brief item 6) --------------------------------

/** Deck plan corners for a crossover: centered at its station, spanning across the barrier. */
export function crossoverDeckCorners(geometry, crossover) {
  const center = barrierPointAtStation(geometry, crossover.stationIn);
  const axisAngle = (Math.atan2(geometry.axis.y, geometry.axis.x) * 180) / Math.PI;
  return deckCorners({
    cx: center.x,
    cy: center.y,
    angleDeg: axisAngle + 90,
    widthIn: crossover.deck.widthIn,
    depthIn: crossover.deck.lengthIn,
  });
}

/**
 * Usability of one crossover: a modeled grating deck, stairs on
 * both sides, supports and guards, spanning the full obstruction
 * envelope and reaching both sides, with the adopted walkway
 * width/headroom and an authored clearance above the pipes.
 * Returns { state, findings }. A crossover that fails any part is
 * unusable — it does not count as a crossing.
 */
export function validateCrossover(design, barrier, crossover) {
  const crossoverId = crossover?.id ?? "(unknown)";
  const barrierId = barrier?.id ?? "(unknown)";
  const findings = [];
  if (!isPlainObject(crossover) || !isPlainObject(crossover.deck)) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_SPACING_UNVERIFIED,
        crossoverId,
        `Crossover ${crossoverId} on barrier ${barrierId} has no modeled deck.`,
      ),
    );
    return { state: "CROSSOVER_SPACING_UNVERIFIED", findings };
  }
  const { geometry, findings: gFindings } = barrierGeometry(design, barrier);
  findings.push(...gFindings);
  if (!geometry) return { state: findings[0].code, findings };
  const deck = crossover.deck;
  const station = crossover.stationIn;
  if (!isFiniteNumber(station) || station < -EPS || station > geometry.lengthIn + EPS) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_STATION_OUT_OF_RANGE,
        crossoverId,
        `Crossover ${crossoverId} station ${station} in is outside barrier ${barrierId} (0–${Math.round(geometry.lengthIn)} in).`,
      ),
    );
  }
  if (!isFiniteNumber(deck.lengthIn) || deck.lengthIn < geometry.widthIn - 1e-9) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_DECK_SHORT,
        crossoverId,
        `Crossover ${crossoverId} deck is ${deck.lengthIn} in long but the ${barrierId} obstruction envelope is ${geometry.widthIn} in wide — the deck does not span it.`,
      ),
    );
  }
  if (!isFiniteNumber(deck.widthIn) || deck.widthIn < WALKWAY_PROFILE_IN.widthIn - 1e-9) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_TOO_NARROW,
        crossoverId,
        `Crossover ${crossoverId} deck is ${deck.widthIn} in wide — below the adopted walkway width of ${WALKWAY_PROFILE_IN.widthIn} in.`,
      ),
    );
  }
  // Stairs on both sides, each climbing from a lower surface to the deck.
  const stairs = Array.isArray(crossover.stairs) ? crossover.stairs : [];
  for (const side of ["a", "b"]) {
    const stair = stairs.find((s) => s?.side === side);
    if (
      !stair ||
      !isFiniteNumber(stair.fromIn) ||
      !isFiniteNumber(stair.toIn) ||
      !(stair.fromIn < stair.toIn) ||
      Math.abs(stair.toIn - deck.elevationIn) > FACE
    ) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_STAIRS_MISSING,
          crossoverId,
          `Crossover ${crossoverId} has no stair on side ${side} climbing to the deck elevation ${deck.elevationIn} in.`,
        ),
      );
    }
  }
  const supports = Array.isArray(crossover.supports) ? crossover.supports : [];
  if (
    supports.length === 0 ||
    !supports.some((s) => isFiniteNumber(s?.x) && isFiniteNumber(s?.y))
  ) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_SUPPORTS_MISSING,
        crossoverId,
        `Crossover ${crossoverId} has no modeled support carrying the deck.`,
      ),
    );
  }
  if (crossover.guards !== true) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_GUARDS_MISSING,
        crossoverId,
        `Crossover ${crossoverId} has no modeled guards.`,
      ),
    );
  }
  // Clearance above the pipes: an authored value, never a reviewer
  // default. The deck walking surface must clear the obstruction
  // top by at least that much.
  if (!isFiniteNumber(crossover.clearanceAbovePipeIn)) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_CLEARANCE_UNVERIFIED,
        crossoverId,
        `Crossover ${crossoverId} clearance above the pipes is unverified: clearanceAbovePipeIn must be authored (no reviewer default is a book dimension).`,
      ),
    );
  } else if (geometry.topElevationIn === null) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_CLEARANCE_UNVERIFIED,
        crossoverId,
        `Crossover ${crossoverId} clearance above the pipes is unverified: barrier ${barrierId} has no obstruction-top elevation.`,
      ),
    );
  } else if (deck.elevationIn - geometry.topElevationIn < crossover.clearanceAbovePipeIn - 1e-9) {
    findings.push(
      finding(
        ACCESS_CODES.CROSSOVER_CLEARANCE_LOW,
        crossoverId,
        `Crossover ${crossoverId} deck at ${deck.elevationIn} in clears the ${barrierId} obstruction top (${geometry.topElevationIn} in) by ${Math.round(deck.elevationIn - geometry.topElevationIn)} in — below the authored ${crossover.clearanceAbovePipeIn} in.`,
      ),
    );
  }
  // Headroom above the deck: no pipe may pass through the deck
  // footprint below deck + 84 in.
  if (isFiniteNumber(deck.elevationIn)) {
    const corners = crossoverDeckCorners(geometry, crossover);
    const top = deck.elevationIn + WALKWAY_PROFILE_IN.headroomIn;
    for (const run of design?.pipes || []) {
      const route = physicalRouteIn(design, run);
      for (let i = 0; i + 1 < route.length; i += 1) {
        const inside = clippedZRange(route[i], route[i + 1], corners);
        if (!inside) continue;
        if (inside.zMax >= deck.elevationIn - 1e-9 && inside.zMin <= top + 1e-9) {
          findings.push(
            finding(
              ACCESS_CODES.CROSSOVER_HEADROOM_BLOCKED,
              crossoverId,
              `Crossover ${crossoverId} headroom is blocked by pipe run ${run.id} inside the deck footprint below ${top} in.`,
            ),
          );
          break;
        }
      }
      if (findings.some((f) => f.code === ACCESS_CODES.CROSSOVER_HEADROOM_BLOCKED)) break;
    }
  }
  // Landings: one on each side, outside the barrier footprint, on
  // the correct side, naming a real path. A bridge not connected
  // on both sides does not count.
  const landings = Array.isArray(crossover.landings) ? crossover.landings : [];
  const axisAngle = Math.atan2(geometry.axis.y, geometry.axis.x);
  const crossDir = { x: -Math.sin(axisAngle), y: Math.cos(axisAngle) };
  const center = barrierPointAtStation(geometry, station);
  for (const side of ["a", "b"]) {
    const landing = landings.find((l) => l?.side === side);
    const sign = side === "a" ? -1 : 1;
    if (!landing || !isFiniteNumber(landing.x) || !isFiniteNumber(landing.y)) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_NOT_CONNECTED,
          crossoverId,
          `Crossover ${crossoverId} has no landing on side ${side} — the bridge does not reach both sides.`,
        ),
      );
      continue;
    }
    const rel = { x: landing.x - center.x, y: landing.y - center.y };
    const across = rel.x * crossDir.x + rel.y * crossDir.y;
    if (across * sign < -FACE) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_NOT_CONNECTED,
          crossoverId,
          `Crossover ${crossoverId} landing on side ${side} is not on that side of barrier ${barrierId}.`,
        ),
      );
      continue;
    }
    if (pointInPolygon({ x: landing.x, y: landing.y }, geometry.corners)) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_NOT_CONNECTED,
          crossoverId,
          `Crossover ${crossoverId} landing on side ${side} sits inside the ${barrierId} obstruction envelope instead of beyond it.`,
        ),
      );
      continue;
    }
    const path = accessList(design, "paths").find((p) => p?.id === landing.pathId);
    if (!path || !Array.isArray(path.points) || path.points.length < 2) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_NOT_CONNECTED,
          crossoverId,
          `Crossover ${crossoverId} landing on side ${side} names path ${landing.pathId ?? "(none)"}, which is not an authored walk/drive path.`,
        ),
      );
      continue;
    }
    const profile = resolvePathProfile(path);
    if (distPointToPolyline({ x: landing.x, y: landing.y }, path.points) > profile.widthIn / 2 + FACE) {
      findings.push(
        finding(
          ACCESS_CODES.CROSSOVER_NOT_CONNECTED,
          crossoverId,
          `Crossover ${crossoverId} landing on side ${side} is not on walk path ${path.id} — the bridge does not connect there.`,
        ),
      );
    }
  }
  if (findings.length > 0) return { state: findings[0].code, findings };
  return { state: "PASS", findings: [] };
}

/**
 * Preview crossover proposals for a barrier: balanced stations
 * (N=ceil(L/1200), open (i+0.5)*L/N, loop i*L/N) with a fully
 * modeled crossover at each — grating deck spanning the barrier,
 * stairs both sides from grade to the deck, a support, guards, and
 * the authored clearanceAbovePipeIn. Landings carry plan points at
 * the deck ends with pathId null: the designer authors the path
 * link explicitly (a preview never invents a connection). Returns
 * { proposal, findings, unresolved }.
 */
export function previewCrossoverProposal(design, barrierId, { clearanceAbovePipeIn = null, loop = false } = {}) {
  const barrier = accessList(design, "barriers").find((b) => b?.id === barrierId);
  if (!barrier) {
    return {
      proposal: null,
      findings: [
        finding(
          ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED,
          barrierId,
          `No barrier ${barrierId} to propose crossovers for.`,
        ),
      ],
      unresolved: [],
    };
  }
  const { geometry, findings: gFindings } = barrierGeometry(design, barrier);
  if (!geometry) return { proposal: null, findings: gFindings, unresolved: [] };
  const existing = accessList(design, "crossovers").filter((c) => c?.barrierId === barrierId);
  const existingStations = existing.filter((c) => isFiniteNumber(c?.stationIn)).map((c) => c.stationIn);
  const stations = suggestCrossoverStations(geometry.lengthIn, { loop });
  const grade = gradeElevationIn(design);
  const top = geometry.topElevationIn;
  const clearance = isFiniteNumber(clearanceAbovePipeIn) ? clearanceAbovePipeIn : null;
  const deckElevation = top !== null && clearance !== null ? top + clearance : null;
  const crossovers = [];
  const unresolved = [];
  if (clearance === null) {
    unresolved.push("clearanceAbovePipeIn must be authored before a crossover deck elevation can be proposed");
  }
  if (top === null) {
    unresolved.push(`barrier ${barrierId} has no obstruction-top elevation, so no deck elevation can be proposed`);
  }
  stations.forEach((station, i) => {
    if (existingStations.some((s) => Math.abs(s - station) <= FACE)) return; // already crossed here
    const center = barrierPointAtStation(geometry, station);
    const axisAngle = Math.atan2(geometry.axis.y, geometry.axis.x);
    const crossDir = { x: -Math.sin(axisAngle), y: Math.cos(axisAngle) };
    const landings = ["a", "b"].map((side, k) => {
      const sign = side === "a" ? -1 : 1;
      return {
        side,
        pathId: null,
        x: center.x + crossDir.x * sign * (geometry.widthIn / 2),
        y: center.y + crossDir.y * sign * (geometry.widthIn / 2),
      };
    });
    crossovers.push({
      id: `preview-${i + 1}`,
      barrierId,
      stationIn: station,
      deck: {
        lengthIn: geometry.widthIn,
        widthIn: PLATFORM_PROFILE_IN.defaultWidthIn,
        elevationIn: deckElevation,
      },
      stairs: ["a", "b"].map((side) => ({ side, fromIn: grade, toIn: deckElevation, widthIn: PLATFORM_PROFILE_IN.defaultWidthIn })),
      supports: [{ id: `preview-${i + 1}-support`, x: center.x, y: center.y }],
      guards: true,
      clearanceAbovePipeIn: clearance,
      landings,
    });
  });
  return {
    proposal: { barrierId, crossovers },
    findings: gFindings,
    unresolved,
  };
}

// ---- Editable workflow -----------------------------------------------------

const ACCESS_DATA_FIELDS = Object.freeze([
  "entries",
  "nodes",
  "paths",
  "barriers",
  "crossovers",
  "removalVolumes",
  "platforms",
]);

function validateAccessRecord(kind, value) {
  const fail = (why) => {
    throw new Error(`Invalid ${kind}: ${why}`);
  };
  if (!isPlainObject(value)) fail("must be an object");
  const finite = (v, name) => {
    if (!isFiniteNumber(v)) fail(`${name} must be a finite number`);
  };
  switch (kind) {
    case "entries":
      finite(value.x, "x");
      finite(value.y, "y");
      break;
    case "nodes":
      if (!ACCESS_NODE_KINDS.has(value.kind)) fail(`unknown node kind ${value.kind}`);
      finite(value.x, "x");
      finite(value.y, "y");
      if (value.elevationIn !== undefined) finite(value.elevationIn, "elevationIn");
      // A nozzle node binds to one nozzle anchor by anchorId (fix
      // round 2): the id is the stable anchor identity from
      // anchorsOf, not a free-form label.
      if (value.anchorId !== undefined && typeof value.anchorId !== "string") {
        fail("anchorId must be a string");
      }
      // An explicit vertical connection (fix round 3): a ladder or
      // stairs run from the node's standing elevation up to
      // topElevationIn. The kind and the top elevation are shape;
      // whether the run actually reaches a face is binding, not
      // record validity — a connection that goes nowhere fails
      // closed there, never at authoring time.
      if (value.verticalAccess !== undefined) {
        if (!isPlainObject(value.verticalAccess)) fail("verticalAccess must be an object");
        if (
          value.verticalAccess.kind !== "ladder" &&
          value.verticalAccess.kind !== "stairs"
        ) {
          fail("verticalAccess.kind must be 'ladder' or 'stairs'");
        }
        finite(value.verticalAccess.topElevationIn, "verticalAccess.topElevationIn");
      }
      break;
    case "paths":
      if (!ACCESS_PATH_KINDS.has(value.kind)) fail(`unknown path kind ${value.kind}`);
      if (!Array.isArray(value.points) || value.points.length < 2) fail("points needs at least two points");
      for (const p of value.points) {
        finite(p?.x, "point x");
        finite(p?.y, "point y");
      }
      if (value.profile !== undefined) {
        if (!isPlainObject(value.profile)) fail("profile must be an object");
        if (value.profile.headroomIn !== undefined) finite(value.profile.headroomIn, "profile.headroomIn");
        if (value.profile.widthIn !== undefined) finite(value.profile.widthIn, "profile.widthIn");
      }
      break;
    case "barriers":
      if (!BARRIER_KINDS.has(value.kind)) fail(`unknown barrier kind ${value.kind}`);
      if (value.topElevationIn !== undefined) finite(value.topElevationIn, "topElevationIn");
      break;
    case "crossovers":
      finite(value.stationIn, "stationIn");
      if (!isPlainObject(value.deck)) fail("deck must be an object");
      finite(value.deck.lengthIn, "deck.lengthIn");
      finite(value.deck.widthIn, "deck.widthIn");
      if (value.deck.elevationIn !== null && value.deck.elevationIn !== undefined) {
        finite(value.deck.elevationIn, "deck.elevationIn");
      }
      if (value.clearanceAbovePipeIn !== null && value.clearanceAbovePipeIn !== undefined) {
        finite(value.clearanceAbovePipeIn, "clearanceAbovePipeIn");
      }
      break;
    case "removalVolumes":
      finite(value.cx, "cx");
      finite(value.cy, "cy");
      finite(value.zMinIn, "zMinIn");
      finite(value.zMaxIn, "zMaxIn");
      finite(value.halfLIn, "halfLIn");
      finite(value.halfWIn, "halfWIn");
      // A removal volume is a usable pull/lift envelope, not a named
      // box: zero or negative half-extents are a degenerate (or
      // inverted) volume and can never "satisfy" a required removal
      // node — obstruction checking on its corners would be meaningless.
      if (!(value.halfLIn > 0)) fail("halfLIn must be positive");
      if (!(value.halfWIn > 0)) fail("halfWIn must be positive");
      if (value.rotationDeg !== undefined) finite(value.rotationDeg, "rotationDeg");
      if (!(value.zMinIn < value.zMaxIn)) fail("zMinIn must be below zMaxIn");
      break;
    case "platforms":
      finite(value.elevationIn, "elevationIn");
      break;
    default:
      fail(`unknown access field ${kind}`);
  }
}

function ensureAccess(design) {
  const next = { ...design };
  if (!isPlainObject(next.access)) {
    next.access = {
      entries: [],
      nodes: [],
      paths: [],
      barriers: [],
      crossovers: [],
      removalVolumes: [],
      platforms: [],
    };
  }
  return next;
}

/**
 * Patch the design's D10-03 authored access data. Object/array
 * values are deep-detached (the stored design never aliases a
 * caller object); numeric fields must be finite when given; kinds
 * must be known. A null value clears the field. The validators
 * classify the patched data — this setter invents no rule, and it
 * never repacks, clamps or moves existing data.
 */
export function setAccessData(design, fields = {}) {
  if (!isPlainObject(fields)) throw new Error("Access data must be an object.");
  const next = ensureAccess(design);
  const access = { ...next.access };
  for (const key of ACCESS_DATA_FIELDS) {
    if (!(key in fields)) continue;
    const value = fields[key];
    if (value === null || value === undefined) {
      access[key] = [];
      continue;
    }
    if (!Array.isArray(value)) throw new Error(`Access ${key} must be an array.`);
    for (const record of value) validateAccessRecord(key, record);
    access[key] = detach(value);
  }
  return { ...next, access };
}

function findCrossover(design, crossoverId) {
  const crossover = accessList(design, "crossovers").find((c) => c?.id === crossoverId);
  if (!crossover) throw new Error(`Unknown crossover: ${crossoverId}`);
  return crossover;
}

/** Add a crossover to a barrier (id generated when absent). A generated
 * id loops until it is absent from the existing crossovers — after a
 * counter reset the first generated id can collide with one already
 * present, and a duplicate id must never be appended. A caller-supplied
 * id is kept as authored (the caller owns it). */
export function addCrossover(design, barrierId, crossover = {}) {
  const barrier = accessList(design, "barriers").find((b) => b?.id === barrierId);
  if (!barrier) throw new Error(`Unknown barrier: ${barrierId}`);
  const existingIds = new Set(accessList(design, "crossovers").map((c) => c?.id));
  let id = crossover?.id;
  if (!id) {
    do {
      id = nextAccessId("crossover");
    } while (existingIds.has(id));
  }
  const record = { ...detach(crossover), id, barrierId };
  validateAccessRecord("crossovers", record);
  const next = ensureAccess(design);
  const access = { ...next.access, crossovers: [...accessList(design, "crossovers"), record] };
  return { ...next, access };
}

/** Patch a crossover's fields (null clears a field). */
export function updateCrossover(design, crossoverId, patch = {}) {
  if (!isPlainObject(patch)) throw new Error("Crossover patch must be an object.");
  findCrossover(design, crossoverId);
  const next = ensureAccess(design);
  const crossovers = accessList(design, "crossovers").map((c) => {
    if (c.id !== crossoverId) return c;
    const updated = { ...c };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) delete updated[key];
      else updated[key] = detach(value);
    }
    validateAccessRecord("crossovers", updated);
    return updated;
  });
  return { ...next, access: { ...next.access, crossovers } };
}

/** Delete a crossover by id. */
export function deleteCrossover(design, crossoverId) {
  findCrossover(design, crossoverId);
  const next = ensureAccess(design);
  const crossovers = accessList(design, "crossovers").filter((c) => c.id !== crossoverId);
  return { ...next, access: { ...next.access, crossovers } };
}

/**
 * Apply a previewed (or hand-authored) crossover proposal in one
 * transaction: every proposed crossover is validated first — finite
 * station inside the barrier, a deck spanning the envelope, stairs
 * on both sides, a support, guards — and a single invalid entry
 * refuses the whole apply; nothing is half-applied. Proposed ids
 * are kept unless they collide with an existing crossover id, in
 * which case a fresh id is assigned.
 */
export function applyCrossoverProposal(design, barrierId, proposal) {
  if (!isPlainObject(proposal) || !Array.isArray(proposal.crossovers)) {
    throw new Error("A crossover proposal needs a crossovers array.");
  }
  const barrier = accessList(design, "barriers").find((b) => b?.id === barrierId);
  if (!barrier) throw new Error(`Unknown barrier: ${barrierId}`);
  const { geometry } = barrierGeometry(design, barrier);
  if (!geometry) throw new Error(`Barrier ${barrierId} does not resolve.`);
  const existing = accessList(design, "crossovers");
  const usedIds = new Set(existing.map((c) => c?.id));
  const validated = proposal.crossovers.map((crossover) => {
    const record = { ...detach(crossover), barrierId };
    // Loop until the id is absent from BOTH the existing crossovers
    // AND the ids already prepared in this apply: a single
    // regeneration can land on an id that is already taken (after a
    // counter reset the first candidate is `crossover-1` again), and
    // two colliding records in one proposal must not share a fresh id.
    while (!record.id || usedIds.has(record.id)) record.id = nextAccessId("crossover");
    validateAccessRecord("crossovers", record);
    if (!(record.stationIn >= 0 && record.stationIn <= geometry.lengthIn)) {
      throw new Error(`Crossover station ${record.stationIn} is outside barrier ${barrierId}.`);
    }
    if (!(record.deck.lengthIn >= geometry.widthIn)) {
      throw new Error(`Crossover deck does not span barrier ${barrierId}.`);
    }
    const stairs = Array.isArray(record.stairs) ? record.stairs : [];
    if (!stairs.some((s) => s?.side === "a") || !stairs.some((s) => s?.side === "b")) {
      throw new Error("A crossover needs stairs on both sides.");
    }
    if (!Array.isArray(record.supports) || record.supports.length === 0) {
      throw new Error("A crossover needs at least one support.");
    }
    if (record.guards !== true) throw new Error("A crossover needs guards.");
    usedIds.add(record.id);
    return record;
  });
  const next = ensureAccess(design);
  return {
    ...next,
    access: { ...next.access, crossovers: [...existing, ...validated] },
  };
}

// ---- Applicability / completeness (brief items 1 and 4) ---------------------
//
// The access checks must never report an all-clear for a design whose
// required access points were never modeled. The authored
// `design.access.nodes` list is NOT a complete universe: the expected
// subjects are derived from the design itself, and every derived
// subject needs a modeled access node. Unknown applicability is
// ACCESS_NOT_MODELED, never "clear."
//
// Derived subjects (one per source; the node models the operator
// standing point for that source):
// - Manway: every symbol instance whose manway spec resolves
//   (manwaySpec — the same condition manwayProfileCompatibility
//   uses, so the legacy gate and tombstones agree). The manway
//   subject is satisfied by a node of kind "manway" with the same
//   symbolId.
// - Valve / instrument: every placed symbol whose catalog category
//   is "Valves & instruments" (processEquipmentCatalog). The kind
//   follows the catalog glyph — instrument-family glyphs
//   ("instrument", "instrument-temperature", "instrument-level",
//   "analyzer", "flow-meter") are instruments, the valve glyphs are
//   valves. Satisfied by a node of the same kind with the same
//   symbolId. Digest §5.5: valves and instruments must be reachable
//   and readable — from grade or a platform — so every placed one is
//   a subject; there is no adopted elevation threshold to split
//   "elevated" from grade-level, and none is invented here.
// - Valve station: every entry of every pipe run's valveStations
//   (the D10-02 concentrated-load source). Satisfied by a node of
//   kind "valve" with the same runId and valveIndex. A station-less
//   valve station is still a subject — its position is unknown, so
//   its access cannot be modeled at all.
// - Nozzle: one subject PER ANCHOR from anchorsOf (catalog nozzles,
//   TEMA anchors, downcomer and utility anchors, honoring the
//   legacy gate) — not one per nozzle-bearing instance. Digest §4.8:
//   a nozzle nobody can reach is a layout defect even if the piping
//   to it is correct, and that rule is per nozzle: one reachable
//   node linked only to the equipment ID cannot clear every nozzle
//   on all sides of the equipment. Satisfied only by a node of kind
//   "nozzle" with the same symbolId AND the same anchorId, whose
//   standing point is geometrically bound to that anchor (at the
//   equipment, on the anchor's side — see subjectBinding).
// - Removal: no derivable source exists in the model (nothing marks
//   equipment as needing a removal path), so removal subjects are
//   author-declared by the removal node itself — and a removal node
//   with no volume already fails closed (REMOVAL_PATH_UNVERIFIED).
//
// A design with no derived subjects at all has nothing to check:
// operator access and the walk graph can pass on their own terms
// (the explicit no-applicable-subjects control). A node whose kind
// or link fields do not match any subject is still checked for
// reachability on its own — the subject contract adds findings, it
// never removes the existing node checks.

/** Instrument-family catalog glyphs (processEquipmentCatalog). */
const INSTRUMENT_GLYPHS = new Set([
  "instrument",
  "instrument-temperature",
  "instrument-level",
  "analyzer",
  "flow-meter",
]);

/**
 * The expected access subjects derived from the design: every
 * manway, valve, instrument, valve station and nozzle anchor the
 * operator must be able to reach. Each subject is
 * { kind, symbolId?, anchorId?, runId?, valveIndex?, stationIn?,
 * label, subjectId } — subjectId is stable for finding dedupe.
 */
export function expectedAccessSubjects(design) {
  const subjects = [];
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst?.domain, inst?.symbolId);
    if (!symbol) continue;
    const label = `${symbol.label} (${inst.id})`;
    if (manwaySpec(symbol, inst) !== null) {
      subjects.push({
        kind: "manway",
        symbolId: inst.id,
        label,
        subjectId: inst.id,
      });
    }
    if (symbol.category === "Valves & instruments") {
      const kind = INSTRUMENT_GLYPHS.has(symbol.glyph) ? "instrument" : "valve";
      subjects.push({ kind, symbolId: inst.id, label, subjectId: inst.id });
    }
    for (const anchor of anchorsOf(inst)) {
      subjects.push({
        kind: "nozzle",
        symbolId: inst.id,
        anchorId: anchor.id,
        label,
        subjectId: `${inst.id}/nozzle-${anchor.id}`,
      });
    }
  }
  for (const run of design?.pipes || []) {
    const stations = Array.isArray(run?.valveStations) ? run.valveStations : [];
    stations.forEach((valve, index) => {
      const station = isPlainObject(valve) ? valve.stationIn : undefined;
      subjects.push({
        kind: "valve",
        runId: run.id,
        valveIndex: index,
        stationIn: isFiniteNumber(station) ? station : undefined,
        label: `valve station ${index} on pipe run ${run.id}`,
        subjectId: `${run.id}/valve-${index}`,
      });
    });
  }
  return subjects;
}

/**
 * Whether an authored access node models the given subject — and,
 * when it does not, the most informative reason why. A declared ID
 * alone is never proof (brief common contract: ownership, actual
 * coordinates and applicability are validated). A derived required
 * subject is satisfied only by a node that is ALL of:
 * - ID-bound: same kind and symbolId (and, for a nozzle subject,
 *   the same anchorId — the stable anchor identity from anchorsOf;
 *   for a valve-station subject, the same runId and valveIndex);
 * - required: `required !== false`. An optional node is skipped by
 *   both validateOperatorAccess and validateWalkGraph, so it can
 *   never satisfy a required subject — otherwise the aggregate
 *   could report PASS on a node that is never attached or reached;
 * - geometrically bound: the node's authored standing point
 *   (x, y) is at the subject's actual access geometry, not merely
 *   copied onto a clear path somewhere else on the plot, AND its
 *   standing elevation reaches the subject's access elevation (see
 *   nodeBindingDetail) — plan coincidence alone never clears an
 *   elevated face.
 *
 * Returns { satisfied: true, node } or
 * { satisfied: false, reason, node, detail } with reason one of:
 * - "none": no node names this subject at all;
 * - "unlinked": a node names the equipment but not this anchor
 *   (nozzle subjects only — it names no anchorId, or another
 *   anchor's);
 * - "optional-only": every node naming this subject is optional
 *   (required === false);
 * - "unbound": a required node names this subject but is not
 *   bound to it; `detail` names why (nodeBindingDetail):
 *   "plan" (standing point not at the access geometry),
 *   "vertical" (standing elevation does not reach the face, the
 *   standing elevation itself is not reachable from grade, or a
 *   declared ladder run exceeds the adopted 360-in maximum),
 *   "vertical-unknown" (the face elevation is not modeled).
 * The first node found in each failing class is kept so the finding
 * can name it.
 */
function subjectBinding(design, subject) {
  let optional = null;
  let unbound = null;
  let unlinked = null;
  for (const node of accessList(design, "nodes")) {
    if (!isPlainObject(node)) continue;
    if (!nodeNamesSubjectLoosely(node, subject)) continue;
    if (!nodeNamesSubject(node, subject)) {
      if (!unlinked) unlinked = node;
      continue;
    }
    if (node.required === false) {
      if (!optional) optional = node;
      continue;
    }
    const detail = nodeBindingDetail(design, node, subject);
    if (detail.bound) {
      return { satisfied: true, node };
    }
    if (!unbound) unbound = { node, detail };
  }
  if (unbound) {
    return { satisfied: false, reason: "unbound", node: unbound.node, detail: unbound.detail };
  }
  if (optional) return { satisfied: false, reason: "optional-only", node: optional };
  if (unlinked) return { satisfied: false, reason: "unlinked", node: unlinked };
  return { satisfied: false, reason: "none", node: null };
}

/** Kind + equipment link, ignoring anchorId and required. */
function nodeNamesSubjectLoosely(node, subject) {
  if (subject.kind === "valve" && subject.runId !== undefined) {
    return node.kind === "valve" && node.runId === subject.runId && node.valveIndex === subject.valveIndex;
  }
  return node.kind === subject.kind && node.symbolId === subject.symbolId;
}

/** Full ID binding: the loose link plus the anchor identity for nozzle subjects. */
function nodeNamesSubject(node, subject) {
  if (!nodeNamesSubjectLoosely(node, subject)) return false;
  if (subject.kind === "nozzle") return node.anchorId === subject.anchorId;
  return true;
}

/**
 * The walk-graph attachment tolerance (in): half the width of the
 * walk/drive path the node stands on, plus the face tolerance.
 * This is the module's single adopted notion of a point being "at"
 * a modeled feature — the same tolerance buildWalkGraph uses to
 * attach a point to a path — and the valve-station binding reuses
 * it rather than inventing a reach radius (the brief adopts no
 * approach/travel threshold). A node with no authored path uses the
 * walkway baseline.
 */
function nodeBindingTolerance(design, node) {
  const path = node?.pathId
    ? accessList(design, "paths").find((p) => p?.id === node.pathId)
    : null;
  const widthIn = path ? resolvePathProfile(path).widthIn : WALKWAY_PROFILE_IN.widthIn;
  return widthIn / 2 + FACE;
}

/**
 * The elevation an operator stands at at an access node: the
 * node's authored elevationIn, or the design's grade elevation
 * when none is authored. Walk paths are grade-level polylines, so
 * a node with no authored elevation stands at grade — that is the
 * design's own datum, not an invented reach. A node that stands
 * on a platform authors that platform's deck elevation here.
 */
export function nodeStandingElevationIn(design, node) {
  return isFiniteNumber(node?.elevationIn) ? node.elevationIn : gradeElevationIn(design);
}

/**
 * Every elevation a modeled vertical run can reach from grade:
 * the fixpoint over all access nodes' declared ladder/stairs
 * runs, starting at the design's grade elevation. A run counts
 * only from a bottom that is itself reachable, and a ladder run
 * counts only within the adopted 360-in §5.3 maximum (stairs
 * carry no adopted cap); a run that ends at or below its bottom,
 * or a ladder over the cap, contributes nothing. A modeled run is
 * design evidence whichever node declares it — the climb exists
 * in the design whether the node at its top is the one that
 * declares it or another node stands on the platform it reaches.
 * An authored elevation with no run reaching it is never in the
 * set: reachability is proven by the chain, not by the number.
 */
export function reachableElevationsIn(design) {
  const grade = gradeElevationIn(design);
  const reached = [grade];
  const has = (elevation) => reached.some((r) => Math.abs(r - elevation) <= EPS);
  // Runs are re-read every pass: a run whose bottom becomes
  // reachable only in a later pass still fires.
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of accessList(design, "nodes")) {
      const va = node?.verticalAccess;
      if (!isPlainObject(va) || (va.kind !== "ladder" && va.kind !== "stairs")) continue;
      if (!isFiniteNumber(va.topElevationIn)) continue;
      const bottom = nodeStandingElevationIn(design, node);
      if (!(va.topElevationIn > bottom + EPS)) continue;
      if (va.kind === "ladder" && va.topElevationIn - bottom > LADDER_RUN_MAX_IN + EPS) {
        continue;
      }
      if (!has(bottom) || has(va.topElevationIn)) continue;
      reached.push(va.topElevationIn);
      changed = true;
    }
  }
  return reached;
}

/**
 * Whether a platform is modeled at an elevation for a node: an
 * authored platform record in access.platforms at that elevation
 * — platform records carry no plan coordinates, so the match is
 * by elevation only, scoped to the node's symbol when the record
 * names one — or, for a symbol-bound node, the symbol instance's
 * effective manway platform (authored, else the legacy D5 deck)
 * at that elevation. A platform is a place to stand; whether the
 * climb to it is modeled is the chain's job, not the platform's.
 */
function platformAtElevationIn(design, node, elevation) {
  if (
    accessList(design, "platforms").some(
      (p) =>
        isFiniteNumber(p?.elevationIn) &&
        Math.abs(p.elevationIn - elevation) <= EPS &&
        (p.symbolId === undefined || p.symbolId === node?.symbolId),
    )
  ) {
    return true;
  }
  if (node?.symbolId === undefined) return false;
  const inst = (design?.symbols || []).find((s) => s?.id === node.symbolId);
  if (!inst) return false;
  const effective = effectiveManwayPlatform(design, inst);
  return Boolean(effective && Math.abs(effective.elevationIn - elevation) <= EPS);
}

/**
 * Whether an operator can actually stand at a node's standing
 * elevation (fix round 4: the walk graph was plan-only, so an
 * authored elevation was treated as reachable from a grade path
 * with no vertical evidence). Grade is reachable by definition:
 * paths are grade-level polylines. An elevated standing elevation
 * is reachable only when a platform is modeled at it AND a
 * complete chain of allowed vertical runs reaches it from grade
 * (reachableElevationsIn): a platform alone proves a place to
 * stand, not the climb to it, and an authored elevation with
 * neither is just a number. Returns { reachable, standing,
 * platformAtStanding, chainReachesStanding }.
 */
export function standingReachableDetail(design, node) {
  const standing = nodeStandingElevationIn(design, node);
  const grade = gradeElevationIn(design);
  if (Math.abs(standing - grade) <= EPS) {
    return { reachable: true, standing, platformAtStanding: false, chainReachesStanding: true };
  }
  const platformAtStanding = platformAtElevationIn(design, node, standing);
  const chainReachesStanding = reachableElevationsIn(design).some(
    (e) => Math.abs(e - standing) <= EPS,
  );
  return {
    reachable: platformAtStanding && chainReachesStanding,
    standing,
    platformAtStanding,
    chainReachesStanding,
  };
}

/**
 * The elevation an operator must stand at to reach a derived
 * subject, in the design's absolute elevation frame — or null when
 * the subject's access elevation is not modeled at all. The
 * required standing elevation is the access point's own elevation:
 * - nozzle: the connection face's elevationIn (connectionFaceForAnchor);
 *   null for a TEMA anchor, which carries no modeled elevation;
 * - manway: the platform that serves it — the effective platform
 *   (authored, else the legacy D5 deck) when one exists, else the
 *   §5.3 reference platform (centerline − 30), floored at paving:
 *   a platform cannot ride below grade, so a low manway is
 *   operated from grade;
 * - valve station: the 3D route point at its stationIn
 *   (physicalRouteIn + pointAtStation);
 * - valve / instrument symbol: the instance's base elevation — the
 *   symbol sits at its base, and no handwheel height above the
 *   base is modeled (the brief invents none).
 */
export function subjectStandingElevationIn(design, subject) {
  if (subject.runId !== undefined) {
    if (subject.stationIn === undefined) return null;
    const run = (design?.pipes || []).find((r) => r?.id === subject.runId);
    if (!run) return null;
    const route = physicalRouteIn(design, run);
    if (!Array.isArray(route) || route.length === 0) return null;
    const point = pointAtStation(route, subject.stationIn);
    return point ? point.zIn : null;
  }
  const inst = (design?.symbols || []).find((s) => s?.id === subject.symbolId);
  if (!inst) return null;
  if (subject.kind === "manway") return manwayStandingElevationIn(design, inst);
  if (subject.kind === "nozzle") {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol) return null;
    const face = connectionFaceForAnchor(symbol, inst, subject.anchorId);
    if (!face) return null;
    return face.elevationIn;
  }
  return baseElevationIn(inst);
}

/** The elevation an operator must stand at to reach a manway: the
 * platform that serves it — the effective platform (authored, else
 * the legacy D5 deck) when one exists, else the §5.3 reference
 * platform (centerline − 30), floored at paving. Null when the
 * manway geometry is incomplete. */
function manwayStandingElevationIn(design, inst) {
  const effective = effectiveManwayPlatform(design, inst);
  if (effective) return effective.elevationIn;
  const ref = manwayReferencePlatform(design, inst);
  if (!ref) return null;
  return Math.max(gradeElevationIn(design), ref.platformElevationIn);
}

/**
 * Whether a node's standing elevation reaches a required standing
 * elevation: the operator stands AT the required elevation
 * (representation epsilon — no invented reach radius), or the node
 * declares an explicit ladder/stairs connection from its standing
 * elevation up to exactly that elevation. A ladder run over the
 * adopted 360-in §5.3 maximum needs an intermediate platform and
 * does not reach; stairs carry no adopted cap. Standing above the
 * required elevation without a connection fails closed — there is
 * no reach-down rule in the book.
 *
 * Standing reachability is checked FIRST (fix round 4): a node
 * that stands at an elevation no modeled climb reaches cannot
 * bind, however exactly its standing elevation matches the
 * required one — an authored number is not a platform, and the
 * climb below an invented intermediate elevation is not modeled
 * by the final leg alone. A standing elevation that cannot be
 * stood on is the more fundamental failure, so it dominates the
 * ladder-cap failure.
 */
function verticalDetail(design, node, required) {
  const standing = nodeStandingElevationIn(design, node);
  if (!standingReachableDetail(design, node).reachable) {
    return {
      bound: false,
      reason: "vertical",
      standing,
      required,
      standingUnreachable: true,
    };
  }
  if (Math.abs(standing - required) <= EPS) return { bound: true };
  const va = node?.verticalAccess;
  if (
    isPlainObject(va) &&
    (va.kind === "ladder" || va.kind === "stairs") &&
    isFiniteNumber(va.topElevationIn) &&
    Math.abs(va.topElevationIn - required) <= EPS &&
    va.topElevationIn > standing + EPS
  ) {
    if (va.kind === "ladder" && va.topElevationIn - standing > LADDER_RUN_MAX_IN + EPS) {
      return {
        bound: false,
        reason: "vertical",
        standing,
        required,
        ladderRunExceeded: true,
      };
    }
    return { bound: true };
  }
  return { bound: false, reason: "vertical", standing, required };
}

/**
 * Whether a required node's standing point is bound to its
 * subject's actual access geometry — in plan AND in elevation.
 * Plan is checked first, so a remote node fails as "plan" however
 * its elevation reads:
 * - valve station: within the binding tolerance of the 3D route
 *   point at the subject's stationIn, and standing at that
 *   point's elevation. A station-less subject has no position to
 *   bind to and can never be satisfied;
 * - manway: within the binding tolerance of the manway's actual
 *   plan coordinate (manwayWorld — the opening's center on the
 *   shell), and standing at the manway's platform elevation;
 * - nozzle anchor: within the binding tolerance of the anchor's
 *   actual connection-face coordinate (connectionFaceForAnchor),
 *   and standing at the face elevation. The face coordinate is
 *   compared, never the equipment interior: a point at the
 *   equipment center is at the face only for a top nozzle, whose
 *   face IS the center in plan. A face with no modeled elevation
 *   (TEMA) can never be proven reached;
 * - valve / instrument: inside the symbol instance's plan
 *   footprint — the symbol IS the valve/instrument, so its own
 *   footprint is the access zone — and standing at the instance's
 *   base elevation.
 * A point outside the tolerance is remote from the equipment,
 * however clearly its walk path runs. Returns { bound: true } or
 * { bound: false, reason, ... } with reason "plan",
 * "vertical", or "vertical-unknown".
 */
function nodeBindingDetail(design, node, subject) {
  if (!isFiniteNumber(node?.x) || !isFiniteNumber(node?.y)) {
    return { bound: false, reason: "plan" };
  }
  if (subject.runId !== undefined) {
    if (subject.stationIn === undefined) return { bound: false, reason: "plan" };
    const run = (design?.pipes || []).find((r) => r?.id === subject.runId);
    if (!run) return { bound: false, reason: "plan" };
    const route = physicalRouteIn(design, run);
    if (!Array.isArray(route) || route.length === 0) return { bound: false, reason: "plan" };
    const stationPoint = pointAtStation(route, subject.stationIn);
    if (!stationPoint) return { bound: false, reason: "plan" };
    if (
      Math.hypot(node.x - stationPoint.x, node.y - stationPoint.y) >
      nodeBindingTolerance(design, node) + EPS
    ) {
      return { bound: false, reason: "plan" };
    }
    return verticalDetail(design, node, stationPoint.zIn);
  }
  const inst = (design?.symbols || []).find((s) => s?.id === subject.symbolId);
  if (!inst) return { bound: false, reason: "plan" };
  const symbol = findSymbol(inst.domain, inst.symbolId);
  if (!symbol) return { bound: false, reason: "plan" };
  const point = { x: node.x, y: node.y };
  if (subject.kind === "manway") {
    const world = manwayWorld(symbol, inst);
    if (!world) return { bound: false, reason: "plan" };
    if (
      Math.hypot(point.x - world.x, point.y - world.y) >
      nodeBindingTolerance(design, node) + EPS
    ) {
      return { bound: false, reason: "plan" };
    }
    const required = manwayStandingElevationIn(design, inst);
    if (required === null) return { bound: false, reason: "vertical-unknown" };
    return verticalDetail(design, node, required);
  }
  if (subject.kind === "nozzle") {
    const face = connectionFaceForAnchor(symbol, inst, subject.anchorId);
    if (!face) return { bound: false, reason: "plan" };
    if (
      Math.hypot(point.x - face.x, point.y - face.y) >
      nodeBindingTolerance(design, node) + EPS
    ) {
      return { bound: false, reason: "plan" };
    }
    if (face.elevationIn === null || face.elevationIn === undefined) {
      return { bound: false, reason: "vertical-unknown" };
    }
    return verticalDetail(design, node, face.elevationIn);
  }
  if (!pointInPolygon(point, instanceFootprint(inst, symbol))) {
    return { bound: false, reason: "plan" };
  }
  return verticalDetail(design, node, baseElevationIn(inst));
}

/** Plain-words name of a subject for findings. */
function subjectName(subject) {
  if (subject.kind === "manway") return `Manway on ${subject.label}`;
  if (subject.kind === "nozzle") return `Nozzle ${subject.anchorId} on ${subject.label}`;
  if (subject.runId !== undefined) {
    return subject.stationIn !== undefined
      ? `Valve station ${subject.valveIndex} on pipe run ${subject.runId} at ${subject.stationIn} in`
      : `Valve station ${subject.valveIndex} on pipe run ${subject.runId}`;
  }
  return `${subject.kind === "instrument" ? "Instrument" : "Valve"} ${subject.label}`;
}

/** How to author a node that models this subject: at the actual
 * face/manway/station coordinate, standing at the face elevation
 * on a modeled platform at that elevation reached by a ladder or
 * stairs chain from grade (or with a ladder/stairs connection up
 * to it from grade). An authored elevation alone is not evidence:
 * the climb to it must be modeled. */
function subjectAuthorInstruction(subject) {
  if (subject.kind === "manway") {
    return `author an access node of kind "manway" for ${subject.symbolId} at the manway, standing at the manway's platform elevation on a modeled platform at that elevation reached by a ladder or stairs chain from grade (or with a ladder or stairs connection up to it)`;
  }
  if (subject.kind === "nozzle") {
    return `author an access node of kind "nozzle" for ${subject.symbolId} with anchorId "${subject.anchorId}" at that nozzle's face, standing at the face elevation on a modeled platform at that elevation reached by a ladder or stairs chain from grade (or with a ladder or stairs connection up to it)`;
  }
  if (subject.runId !== undefined) {
    return subject.stationIn !== undefined
      ? `author an access node of kind "valve" with runId ${subject.runId} and valveIndex ${subject.valveIndex} at that station, standing at the station elevation on a modeled platform at that elevation reached by a ladder or stairs chain from grade (or with a ladder or stairs connection up to it)`
      : `author the station, then an access node of kind "valve" with runId ${subject.runId} and valveIndex ${subject.valveIndex}`;
  }
  return `author an access node of kind "${subject.kind}" for ${subject.symbolId} standing at the instance's base elevation on a modeled platform at that elevation reached by a ladder or stairs chain from grade (or with a ladder or stairs connection up to it)`;
}

/**
 * ACCESS_NOT_MODELED findings for every derived subject with no
 * modeled access node. Shared by validateOperatorAccess and
 * validateWalkGraph so the two agree — and accessCheckStates
 * dedupes the identical findings into one. The message names WHY
 * the subject is unmodeled (no node / wrong anchor / optional-only
 * / standing point not at the access geometry / standing elevation
 * not reaching the face / face elevation not modeled) so the
 * repair is explicit.
 */
function missingAccessSubjectFindings(design) {
  const findings = [];
  for (const subject of expectedAccessSubjects(design)) {
    const binding = subjectBinding(design, subject);
    if (binding.satisfied) continue;
    const name = subjectName(subject);
    const instruction = subjectAuthorInstruction(subject);
    if (binding.reason === "none") {
      findings.push(
        finding(
          ACCESS_CODES.ACCESS_NOT_MODELED,
          subject.subjectId,
          subject.runId !== undefined && subject.stationIn === undefined
            ? `${name} has no authored route station, so its operator access cannot be modeled: ${instruction}.`
            : `${name} has no modeled operator access node: ${instruction}.`,
        ),
      );
    } else if (binding.reason === "unlinked") {
      const node = binding.node;
      findings.push(
        finding(
          ACCESS_CODES.ACCESS_NOT_MODELED,
          subject.subjectId,
          `${name} has no modeled operator access node: access node ${node.id} is authored for ${subject.label} but names ${
            node.anchorId === undefined ? "no anchor" : `anchor "${node.anchorId}", not "${subject.anchorId}"`
          } — ${instruction}.`,
        ),
      );
    } else if (binding.reason === "optional-only") {
      findings.push(
        finding(
          ACCESS_CODES.ACCESS_NOT_MODELED,
          subject.subjectId,
          `${name} is modeled only by optional access node ${binding.node.id}, which is never attached or reached: ${instruction} as a required node.`,
        ),
      );
    } else {
      // "unbound": a required node names the subject but is not
      // bound to it — plan, vertical, or vertical-unknown.
      const node = binding.node;
      const detail = binding.detail || { reason: "plan" };
      if (detail.reason === "vertical-unknown") {
        findings.push(
          finding(
            ACCESS_CODES.ACCESS_NOT_MODELED,
            subject.subjectId,
            `${name} has no modeled operator access node: its face elevation is not modeled, so no access node can prove it is reached — model the face elevation first.`,
          ),
        );
      } else if (detail.reason === "vertical" && detail.standingUnreachable) {
        findings.push(
          finding(
            ACCESS_CODES.ACCESS_NOT_MODELED,
            subject.subjectId,
            `${name} has no modeled operator access node: access node ${node.id} stands at ${detail.standing} in, but that elevation is not reachable from grade — no modeled ladder, stairs, or platform chain reaches it. Stand the node at grade and declare a ladder or stairs connection up to ${detail.required} in, or model a platform at ${detail.standing} in reached by a complete ladder or stairs chain from grade.`,
          ),
        );
      } else if (detail.reason === "vertical" && detail.ladderRunExceeded) {
        findings.push(
          finding(
            ACCESS_CODES.ACCESS_NOT_MODELED,
            subject.subjectId,
            `${name} has no modeled operator access node: access node ${node.id} stands at ${detail.standing} in and declares a ladder up to ${detail.required} in, but that ${detail.required - detail.standing}-in run exceeds the adopted 360-in ladder-run maximum — add an intermediate platform and split the climb.`,
          ),
        );
      } else if (detail.reason === "vertical") {
        findings.push(
          finding(
            ACCESS_CODES.ACCESS_NOT_MODELED,
            subject.subjectId,
            `${name} has no modeled operator access node: access node ${node.id} stands at ${detail.standing} in but the access point is at ${detail.required} in — stand the node at grade and declare a ladder or stairs connection from grade up to ${detail.required} in, or stand it on a modeled platform at ${detail.required} in reached by a complete ladder or stairs chain from grade.`,
          ),
        );
      } else {
        findings.push(
          finding(
            ACCESS_CODES.ACCESS_NOT_MODELED,
            subject.subjectId,
            `${name} has no modeled operator access node: access node ${node.id} is authored for it but its standing point (${node.x}, ${node.y}) is not at the access point — move the node to the access point or ${instruction} as a required node.`,
          ),
        );
      }
    }
  }
  return findings;
}

// ---- Walk graph (brief item 7) ---------------------------------------------

/** Intersection point of two plan segments, or null. */
function segmentSegmentIntersection(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
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

/** Swept-envelope rect for one path segment: buffered by halfWidth on all sides. */
function segmentEnvelopeRect(a, b, halfWidth) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const angleDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return deckCorners({
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    angleDeg,
    widthIn: halfWidth * 2,
    depthIn: len + halfWidth * 2,
  });
}

/** World-plan footprint corners of an equipment instance. */
function instanceFootprint(inst, symbol) {
  const widthIn = inst?.widthIn ?? symbol?.widthIn ?? 0;
  const depthIn = inst?.depthIn ?? symbol?.depthIn ?? 0;
  return deckCorners({
    cx: inst?.x || 0,
    cy: inst?.y || 0,
    angleDeg: inst?.rotationDeg || 0,
    widthIn: depthIn,
    depthIn: widthIn,
  });
}

/**
 * Whether a usable crossover on the barrier covers a plan point:
 * the point's station along the barrier falls inside the deck's
 * width along the barrier, and the crossover validates clean.
 * A crossover that fails usability never covers a crossing.
 */
function crossoverCoversPoint(design, barrier, point) {
  const { geometry } = barrierGeometry(design, barrier);
  if (!geometry) return false;
  const station = barrierStation(geometry, point);
  if (station === null) return false;
  for (const crossover of accessList(design, "crossovers")) {
    if (crossover?.barrierId !== barrier.id) continue;
    if (!isFiniteNumber(crossover?.stationIn)) continue;
    if (!isFiniteNumber(crossover?.deck?.widthIn)) continue;
    if (Math.abs(station - crossover.stationIn) > crossover.deck.widthIn / 2 + FACE) continue;
    const { state } = validateCrossover(design, barrier, crossover);
    if (state === "PASS") return true;
  }
  return false;
}

/**
 * The walk graph: vertices are path points plus attachment points
 * (entries, access nodes, crossover landings) projected onto their
 * paths; edges are consecutive path vertices plus usable,
 * both-sides-connected crossover decks. Returns { vertices, edges,
 * attached, reachable, findings } where attached maps entry/node/
 * landing ids to vertex ids (and nodeStandingElevationIn maps each
 * attached node's id to its standing elevation as provenance) and
 * reachable is the set of vertex ids reached from any entry. A
 * bridge not connected on both sides contributes no edge.
 */
export function buildWalkGraph(design) {
  const findings = [];
  const vertices = new Map();
  const edges = [];
  // attached.nodeStandingElevationIn records the vertical datum of
  // every attached node (its authored elevationIn, else the
  // design's grade elevation) as provenance on the attachment.
  // Attachment itself is gated on standing reachability (fix
  // round 4): a node attaches only when an operator can actually
  // stand at its standing elevation — grade, or an elevated datum
  // proven by a platform and a complete vertical chain from grade
  // (standingReachableDetail). An unreachable node gets no vertex,
  // no attached entry and no provenance: the graph is plan
  // connectivity FROM a reachable datum, and a grade path never
  // connects directly to an elevated stand with no climb. The
  // vertical binding is validated by missingAccessSubjectFindings,
  // which both validators consult. Entries and crossover landings
  // are grade-level by construction and are not gated.
  const attached = { entries: {}, nodes: {}, landings: {}, nodeStandingElevationIn: {} };
  const paths = accessList(design, "paths").filter(
    (p) => Array.isArray(p?.points) && p.points.length >= 2,
  );
  if (paths.length === 0) {
    return {
      vertices,
      edges,
      segments: [],
      attached,
      reachable: new Set(),
      findings: [
        finding(
          ACCESS_CODES.ACCESS_NOT_MODELED,
          "(design)",
          "Access is not modeled: no walk/drive paths are authored.",
        ),
      ],
    };
  }
  const profiles = new Map(paths.map((p) => [p.id, resolvePathProfile(p)]));
  // Ordered vertices per path: original points plus attachments.
  const pathVertices = new Map();
  for (const path of paths) {
    const ordered = [];
    let along = 0;
    for (let i = 0; i < path.points.length; i += 1) {
      if (i > 0) {
        along += Math.hypot(
          path.points[i].x - path.points[i - 1].x,
          path.points[i].y - path.points[i - 1].y,
        );
      }
      const id = `path:${path.id}:${i}`;
      ordered.push({ id, x: path.points[i].x, y: path.points[i].y, along, pathId: path.id });
      vertices.set(id, { id, x: path.points[i].x, y: path.points[i].y, kind: "path-point", pathId: path.id });
    }
    pathVertices.set(path.id, ordered);
  }
  const attachPoint = (refKind, refId, point, allowedPathId = null) => {
    let best = null;
    for (const path of paths) {
      if (allowedPathId !== null && path.id !== allowedPathId) continue;
      const profile = profiles.get(path.id);
      const nearest = nearestPointOnPolyline(point, path.points);
      if (nearest.distance > profile.widthIn / 2 + FACE) continue;
      if (!best || nearest.distance < best.distance) {
        best = { path, nearest, profile };
      }
    }
    if (!best) return null;
    const { path, nearest } = best;
    // Along-path distance of the projection.
    let along = 0;
    for (let i = 0; i < nearest.segment; i += 1) {
      along += Math.hypot(
        path.points[i + 1].x - path.points[i].x,
        path.points[i + 1].y - path.points[i].y,
      );
    }
    const segLen = Math.hypot(
      path.points[nearest.segment + 1].x - path.points[nearest.segment].x,
      path.points[nearest.segment + 1].y - path.points[nearest.segment].y,
    );
    const t =
      segLen > 0
        ? Math.hypot(nearest.point.x - path.points[nearest.segment].x, nearest.point.y - path.points[nearest.segment].y) / segLen
        : 0;
    along += t * segLen;
    const ordered = pathVertices.get(path.id);
    const existing = ordered.find((v) => Math.abs(v.along - along) <= EPS);
    if (existing) return existing.id;
    const id = `attach:${refKind}:${refId}`;
    ordered.push({ id, x: nearest.point.x, y: nearest.point.y, along, pathId: path.id });
    ordered.sort((a, b) => a.along - b.along);
    vertices.set(id, { id, x: nearest.point.x, y: nearest.point.y, kind: "attachment", pathId: path.id });
    return id;
  };
  for (const entry of accessList(design, "entries")) {
    if (!isFiniteNumber(entry?.x) || !isFiniteNumber(entry?.y)) continue;
    const vertexId = attachPoint("entry", entry.id, { x: entry.x, y: entry.y });
    if (vertexId) attached.entries[entry.id] = vertexId;
  }
  for (const node of accessList(design, "nodes")) {
    if (!isFiniteNumber(node?.x) || !isFiniteNumber(node?.y)) continue;
    // Fix round 4: a node standing at an elevation no modeled
    // climb reaches does not attach — its plan position is on a
    // grade path it cannot stand on.
    if (!standingReachableDetail(design, node).reachable) continue;
    const vertexId = attachPoint("node", node.id, { x: node.x, y: node.y }, node.pathId ?? null);
    if (vertexId) {
      attached.nodes[node.id] = vertexId;
      attached.nodeStandingElevationIn[node.id] = nodeStandingElevationIn(design, node);
    }
  }
  // Crossover deck edges: both landings attached, crossover usable.
  for (const crossover of accessList(design, "crossovers")) {
    const barrier = accessList(design, "barriers").find((b) => b?.id === crossover?.barrierId);
    if (!barrier) continue;
    const { state } = validateCrossover(design, barrier, crossover);
    if (state !== "PASS") continue;
    const landings = Array.isArray(crossover.landings) ? crossover.landings : [];
    const landingVertices = {};
    let ok = true;
    for (const landing of landings) {
      if (!isFiniteNumber(landing?.x) || !isFiniteNumber(landing?.y)) {
        ok = false;
        break;
      }
      const vertexId = attachPoint(
        `landing:${crossover.id}`,
        landing.side,
        { x: landing.x, y: landing.y },
        landing.pathId ?? null,
      );
      if (!vertexId) {
        ok = false;
        break;
      }
      landingVertices[landing.side] = vertexId;
      attached.landings[`${crossover.id}:${landing.side}`] = vertexId;
    }
    if (ok && landingVertices.a && landingVertices.b) {
      edges.push([landingVertices.a, landingVertices.b]);
    }
  }
  // Walk segments split at every attachment: the obstruction
  // checks run on these, so a node's final approach is a segment
  // of its own and can be exempted at its endpoint.
  const segments = [];
  for (const [pathId, ordered] of pathVertices) {
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      segments.push({
        pathId,
        a: { x: ordered[i].x, y: ordered[i].y },
        b: { x: ordered[i + 1].x, y: ordered[i + 1].y },
        endVertexIds: [ordered[i].id, ordered[i + 1].id],
      });
    }
  }
  for (const ordered of pathVertices.values()) {
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      edges.push([ordered[i].id, ordered[i + 1].id]);
    }
  }
  // BFS from every attached entry.
  const adjacency = new Map();
  for (const [a, b] of edges) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  const reachable = new Set();
  const queue = Object.values(attached.entries);
  for (const start of queue) reachable.add(start);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  return { vertices, edges, segments, attached, reachable, findings };
}

/**
 * Walk-graph validation (brief item 7): entry connects to every
 * required equipment access node; barriers, low/overhead pipes,
 * equipment footprints, rack columns and manway decks obstructing a
 * path are findings; a pedestrian bridge never clears a vehicle
 * obstruction. Returns { state, findings }.
 */
export function validateWalkGraph(design) {
  const findings = [];
  const data = accessData(design);
  if (!data) {
    findings.push(
      finding(
        ACCESS_CODES.ACCESS_NOT_MODELED,
        "(design)",
        "Access is not modeled: the design carries no access data (entries, nodes, paths, barriers, crossovers).",
      ),
    );
    return { state: "ACCESS_NOT_MODELED", findings };
  }
  if (accessList(design, "entries").length === 0) {
    findings.push(
      finding(
        ACCESS_CODES.ACCESS_NOT_MODELED,
        "(design)",
        "Access is not modeled: no entry is authored.",
      ),
    );
  }
  const paths = accessList(design, "paths").filter(
    (p) => Array.isArray(p?.points) && p.points.length >= 2,
  );
  if (paths.length === 0) {
    findings.push(
      finding(
        ACCESS_CODES.ACCESS_NOT_MODELED,
        "(design)",
        "Access is not modeled: no walk/drive paths are authored.",
      ),
    );
  }
  // Applicability gate first: a design whose required access points
  // were never modeled cannot pass on its walk graph alone, however
  // clear the authored paths are.
  findings.push(...missingAccessSubjectFindings(design));
  const graph = buildWalkGraph(design);
  findings.push(...graph.findings);
  // Required nodes: attached but unreachable, or never attached.
  for (const node of accessList(design, "nodes")) {
    if (node?.required === false) continue;
    if (!isFiniteNumber(node?.x) || !isFiniteNumber(node?.y)) {
      findings.push(
        finding(
          ACCESS_CODES.ACCESS_NOT_MODELED,
          node?.id ?? "(unknown)",
          `Access node ${node?.id ?? "(unknown)"} has no plan point, so its access is not modeled.`,
        ),
      );
      continue;
    }
    const vertexId = graph.attached.nodes[node.id];
    if (!vertexId) {
      if (node.pathId) {
        findings.push(
          finding(
            ACCESS_CODES.ACCESS_NODE_UNREACHABLE,
            node.id,
            `Access node ${node.id} (${node.kind}) is not on its authored path ${node.pathId} — no walk route reaches it.`,
          ),
        );
      } else {
        findings.push(
          finding(
            ACCESS_CODES.ACCESS_NOT_MODELED,
            node.id,
            `Access node ${node.id} (${node.kind}) has no authored walk route reaching it.`,
          ),
        );
      }
      continue;
    }
    if (!graph.reachable.has(vertexId)) {
      findings.push(
        finding(
          ACCESS_CODES.ACCESS_NODE_UNREACHABLE,
          node.id,
          `Access node ${node.id} (${node.kind}) is not reachable from any entry — the walk graph does not connect to it.`,
        ),
      );
    }
  }
  // Per-path obstructions.
  const grade = gradeElevationIn(design);
  const barriers = accessList(design, "barriers");
  const barrierGeoms = new Map();
  for (const barrier of barriers) {
    const { geometry } = barrierGeometry(design, barrier);
    if (geometry) barrierGeoms.set(barrier.id, geometry);
  }
  const barrierSourceRuns = new Set();
  for (const barrier of barriers) {
    if (barrier?.kind === "ground-pipe" && barrier.runId) barrierSourceRuns.add(barrier.runId);
  }
  for (const path of paths) {
    const profile = resolvePathProfile(path);
    const halfWidth = profile.widthIn / 2;
    const headroomTop = grade + profile.headroomIn;
    const isDrive = path.kind === "drive";
    const obstructCode = isDrive ? ACCESS_CODES.DRIVE_OBSTRUCTED : ACCESS_CODES.WALKWAY_OBSTRUCTED;
    const label = `Path ${path.id} (${path.kind})`;
    // Obstructions run on the graph's split segments (split at every
    // attachment), so a node's final approach is its own segment.
    for (const seg of graph.segments.filter((s) => s.pathId === path.id)) {
      const a = seg.a;
      const b = seg.b;
      const envelope = segmentEnvelopeRect(a, b, halfWidth);
      // Nodes attached at this segment's endpoints exempt their own
      // equipment footprint (the final approach to the equipment).
      const exemptSymbolIds = new Set();
      for (const [nodeId, vertexId] of Object.entries(graph.attached.nodes)) {
        if (!seg.endVertexIds.includes(vertexId)) continue;
        const node = accessList(design, "nodes").find((n) => n?.id === nodeId);
        if (node?.symbolId) exemptSymbolIds.add(node.symbolId);
      }
      // Barrier crossings: the swept envelope, not just the centerline —
      // a walkway whose edge clips the barrier still obstructs. The
      // covering check uses the centerline crossing when there is one,
      // else the envelope point nearest the barrier center.
      for (const [barrierId, geometry] of barrierGeoms) {
        if (!rectsOverlap(envelope, geometry.corners)) continue;
        const center = {
          x: geometry.corners.reduce((s, c) => s + c.x, 0) / geometry.corners.length,
          y: geometry.corners.reduce((s, c) => s + c.y, 0) / geometry.corners.length,
        };
        const crossing =
          segmentPolygonIntersection(a, b, geometry.corners) ??
          nearestPointOnPolyline(center, [a, b]).point;
        const barrier = barriers.find((x) => x.id === barrierId);
        const centerlineCrosses = segmentPolygonIntersection(a, b, geometry.corners) !== null;
        const covered = !isDrive && crossoverCoversPoint(design, barrier, crossing);
        if (!covered) {
          findings.push(
            finding(
              obstructCode,
              path.id,
              `${label} ${centerlineCrosses ? "crosses" : "clips the edge of"} the ${barrierId} ${barrier?.kind ?? "barrier"} at (${Math.round(crossing.x)}, ${Math.round(crossing.y)})${isDrive ? " — a pedestrian crossover never clears a vehicle obstruction" : " with no usable crossover covering the crossing"}.`,
            ),
          );
        }
      }
      // Pipes inside the swept envelope below the headroom band.
      for (const run of design?.pipes || []) {
        if (barrierSourceRuns.has(run.id)) continue; // barrier check owns it
        const route = physicalRouteIn(design, run);
        for (let i = 0; i + 1 < route.length; i += 1) {
          const clipped = clipSegmentToRect(route[i], route[i + 1], envelope);
          if (!clipped) continue;
          let zMin = Infinity;
          let zMax = -Infinity;
          for (const p of clipped) {
            zMin = Math.min(zMin, p.zIn);
            zMax = Math.max(zMax, p.zIn);
          }
          if (zMax < grade - 1e-9 || zMin > headroomTop + 1e-9) continue;
          const mid = clipped[Math.floor(clipped.length / 2)];
          const barrier = barriers.find((x) => x?.kind === "ground-pipe" && x?.runId === run.id);
          const covered = !isDrive && barrier && crossoverCoversPoint(design, barrier, mid);
          if (covered) continue;
          const low = zMax <= ACCESS_LOW_PIPE_ELEVATION_IN + 1e-9;
          findings.push(
            finding(
              low ? obstructCode : ACCESS_CODES.WALKWAY_HEADROOM_BLOCKED,
              path.id,
              `${label} is ${low ? "crossed by low pipe" : "headroom-blocked by pipe"} run ${run.id} at ${Math.round(zMin)}–${Math.round(zMax)} in${isDrive ? " — a pedestrian crossover never clears a vehicle obstruction" : " with no usable crossover covering the crossing"}.`,
            ),
          );
          break;
        }
      }
      // Equipment footprints in the envelope. A rack that carries a
      // barrier is owned by the barrier check above; a rack with no
      // barrier record is just equipment and still obstructs.
      for (const inst of design?.symbols || []) {
        if (exemptSymbolIds.has(inst.id)) continue;
        const symbol = findSymbol(inst.domain, inst.symbolId);
        if (!symbol) continue;
        if (symbol.rack && barriers.some((x) => x?.rackId === inst.id)) continue;
        if (rectsOverlap(envelope, instanceFootprint(inst, symbol))) {
          findings.push(
            finding(
              obstructCode,
              path.id,
              `${label} runs through equipment ${inst.id} (${symbol.label}).`,
            ),
          );
        }
      }
      // Manway access decks overhead (plan overlap below headroom).
      for (const inst of design?.symbols || []) {
        if (exemptSymbolIds.has(inst.id)) continue;
        if (inst.noAccess === true) continue; // no D5 deck for this manway
        const symbol = findSymbol(inst.domain, inst.symbolId);
        if (!symbol?.manway) continue;
        const pkg = accessPackageWorld(symbol, inst, design);
        if (!pkg?.deck) continue;
        const deckCornersList = pkg.deck.corners;
        if (!deckCornersList) continue;
        if (pkg.deck.elevationIn >= headroomTop - 1e-9) continue;
        if (rectsOverlap(envelope, deckCornersList)) {
          findings.push(
            finding(
              isDrive ? ACCESS_CODES.DRIVE_OBSTRUCTED : ACCESS_CODES.WALKWAY_HEADROOM_BLOCKED,
              path.id,
              `${label} passes under the ${inst.id} manway access deck at ${Math.round(pkg.deck.elevationIn)} in — below the ${profile.headroomIn}-in headroom.`,
            ),
          );
        }
      }
    }
  }
  // Rack columns: checked once per path (positions are plan points,
  // not per-segment geometry) — a column inside any segment's
  // envelope obstructs the path.
  for (const path of paths) {
    const profile = resolvePathProfile(path);
    const halfWidth = profile.widthIn / 2;
    const isDrive = path.kind === "drive";
    const obstructCode = isDrive ? ACCESS_CODES.DRIVE_OBSTRUCTED : ACCESS_CODES.WALKWAY_OBSTRUCTED;
    for (const inst of design?.symbols || []) {
      const symbol = findSymbol(inst.domain, inst.symbolId);
      if (!symbol?.rack || symbol.rack.kind !== "pipe") continue;
      const columns = rackColumnWorldPositions(design, inst.id);
      for (const col of columns) {
        if (distPointToPolyline(col, path.points) < halfWidth + col.size / 2 + 1e-9) {
          findings.push(
            finding(
              obstructCode,
              path.id,
              `Path ${path.id} (${path.kind}) runs through a ${inst.id} rack column at (${Math.round(col.x)}, ${Math.round(col.y)}).`,
            ),
          );
          break;
        }
      }
    }
  }
  if (findings.length > 0) return { state: findings[0].code, findings };
  return { state: "PASS", findings: [] };
}

// ---- Operator access + removal paths (brief item 4) ------------------------

/**
 * Required operator access for elevated nozzles/valves/instruments
 * and removal nodes: each must be attached to the walk graph and
 * reachable from an entry. A valid pipe route can still fail
 * access — this check is independent of the pipe-support checks.
 */
export function validateOperatorAccess(design) {
  const findings = [];
  const data = accessData(design);
  if (!data) {
    findings.push(
      finding(
        ACCESS_CODES.ACCESS_NOT_MODELED,
        "(design)",
        "Operator access is not modeled: the design carries no access data.",
      ),
    );
    return { state: "ACCESS_NOT_MODELED", findings };
  }
  // Applicability gate first: a design whose required access points
  // were never modeled cannot report operator PASS, however clear
  // the authored paths are.
  findings.push(...missingAccessSubjectFindings(design));
  const graph = buildWalkGraph(design);
  findings.push(...graph.findings);
  for (const node of accessList(design, "nodes")) {
    if (node?.required === false) continue;
    if (!isFiniteNumber(node?.x) || !isFiniteNumber(node?.y)) {
      findings.push(
        finding(
          ACCESS_CODES.ACCESS_NOT_MODELED,
          node?.id ?? "(unknown)",
          `Access node ${node?.id ?? "(unknown)"} has no plan point, so its operator access is not modeled.`,
        ),
      );
      continue;
    }
    const vertexId = graph.attached.nodes[node.id];
    if (!vertexId) {
      findings.push(
        finding(
          ACCESS_CODES.ACCESS_NOT_MODELED,
          node.id,
          `Operator access for node ${node.id} (${node.kind}) is not modeled: no walk route reaches it.`,
        ),
      );
      continue;
    }
    if (!graph.reachable.has(vertexId)) {
      findings.push(
        finding(
          ACCESS_CODES.OPERATOR_ACCESS_UNREACHABLE,
          node.id,
          `Operator access for node ${node.id} (${node.kind}) is unreachable from any entry.`,
        ),
      );
    }
  }
  if (findings.length > 0) return { state: findings[0].code, findings };
  return { state: "PASS", findings: [] };
}

/**
 * Equipment removal/pull/lift volumes must be clear of pipe runs
 * and other equipment. A node with kind "removal" and no volume
 * for its equipment is explicitly unverified.
 */
export function validateRemovalVolumes(design) {
  const findings = [];
  const volumes = accessList(design, "removalVolumes");
  for (const node of accessList(design, "nodes")) {
    if (node?.kind !== "removal" || node?.required === false) continue;
    if (!node?.symbolId) continue;
    if (!volumes.some((v) => v?.symbolId === node.symbolId)) {
      findings.push(
        finding(
          ACCESS_CODES.REMOVAL_PATH_UNVERIFIED,
          node.id,
          `Removal node ${node.id} for ${node.symbolId} has no removal volume authored, so its pull/lift path is unverified.`,
        ),
      );
    }
  }
  for (const volume of volumes) {
    const label = `Removal volume ${volume?.id ?? "(unknown)"} for ${volume?.symbolId ?? "(unknown)"}`;
    if (
      !isFiniteNumber(volume?.cx) ||
      !isFiniteNumber(volume?.cy) ||
      !isFiniteNumber(volume?.zMinIn) ||
      !isFiniteNumber(volume?.zMaxIn) ||
      !isFiniteNumber(volume?.halfLIn) ||
      !isFiniteNumber(volume?.halfWIn) ||
      !(volume.halfLIn > 0) ||
      !(volume.halfWIn > 0) ||
      (volume?.rotationDeg !== undefined && !isFiniteNumber(volume.rotationDeg))
    ) {
      findings.push(
        finding(
          ACCESS_CODES.REMOVAL_PATH_UNVERIFIED,
          volume?.id ?? "(unknown)",
          `${label} is unverified: its box dimensions must all be finite numbers, its half-extents strictly positive, and any authored rotation finite.`,
        ),
      );
      continue;
    }
    const corners = deckCorners({
      cx: volume.cx,
      cy: volume.cy,
      angleDeg: volume.rotationDeg || 0,
      widthIn: volume.halfWIn * 2,
      depthIn: volume.halfLIn * 2,
    });
    for (const run of design?.pipes || []) {
      const route = physicalRouteIn(design, run);
      let blocked = false;
      for (let i = 0; i + 1 < route.length; i += 1) {
        const inside = clippedZRange(route[i], route[i + 1], corners);
        if (!inside) continue;
        if (inside.zMax >= volume.zMinIn - 1e-9 && inside.zMin <= volume.zMaxIn + 1e-9) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        findings.push(
          finding(
            ACCESS_CODES.REMOVAL_PATH_OBSTRUCTED,
            volume.id,
            `${label} is obstructed by pipe run ${run.id}.`,
          ),
        );
      }
    }
    for (const inst of design?.symbols || []) {
      if (inst.id === volume.symbolId) continue;
      const symbol = findSymbol(inst.domain, inst.symbolId);
      if (!symbol) continue;
      if (rectsOverlap(corners, instanceFootprint(inst, symbol))) {
        findings.push(
          finding(
            ACCESS_CODES.REMOVAL_PATH_OBSTRUCTED,
            volume.id,
            `${label} is obstructed by equipment ${inst.id} (${symbol.label}).`,
          ),
        );
      }
    }
  }
  if (findings.length > 0) return { state: findings[0].code, findings };
  return { state: "PASS", findings: [] };
}

// ---- Aggregate --------------------------------------------------------------

function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const key = JSON.stringify([f.code, f.subjectId, f.message]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Validate every authored path's profile against its baseline: an
 * authored envelope smaller than the baseline fails (the baseline
 * governs); an authored LARGER envelope is a deliberate project
 * requirement and passes.
 */
export function validatePathProfiles(design) {
  const findings = [];
  for (const path of accessList(design, "paths")) {
    if (!isPlainObject(path?.profile)) continue;
    const baseline = baselineProfileFor(path.kind);
    const label = `Path ${path.id} (${path.kind})`;
    if (
      isFiniteNumber(path.profile.headroomIn) &&
      path.profile.headroomIn < baseline.headroomIn - 1e-9
    ) {
      findings.push(
        finding(
          ACCESS_CODES.CLEARANCE_HEADROOM_INSUFFICIENT,
          path.id,
          `${label} authored headroom ${path.profile.headroomIn} in is below the adopted ${baseline.headroomIn} in — the baseline governs and the smaller envelope is not applied.`,
        ),
      );
    }
    if (isFiniteNumber(path.profile.widthIn) && path.profile.widthIn < baseline.widthIn - 1e-9) {
      findings.push(
        finding(
          ACCESS_CODES.CLEARANCE_WIDTH_INSUFFICIENT,
          path.id,
          `${label} authored width ${path.profile.widthIn} in is below the adopted ${baseline.widthIn} in — the baseline governs and the smaller envelope is not applied.`,
        ),
      );
    }
  }
  if (findings.length > 0) return { state: findings[0].code, findings };
  return { state: "PASS", findings: [] };
}

/**
 * Aggregate access states for a design. allClear is true only when
 * every applicable check passes: any NOT_MODELED, missing
 * provision, mismatch or finding defeats it. There is no global
 * all-clear while a required check lacks inputs.
 */
export function accessCheckStates(design) {
  const profiles = validatePathProfiles(design);
  const manway = manwayProfileCompatibility(design);
  const operator = validateOperatorAccess(design);
  const removal = validateRemovalVolumes(design);
  const walkGraph = validateWalkGraph(design);
  const spacingFindings = [];
  const usabilityFindings = [];
  const seenGroups = new Set();
  for (const barrier of accessList(design, "barriers")) {
    const groupKey = barrier?.groupId ?? `barrier:${barrier?.id}`;
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    spacingFindings.push(
      ...validateCorridorSpacing(design, barrier.id, { loop: barrier.loop === true }).findings,
    );
  }
  for (const crossover of accessList(design, "crossovers")) {
    const barrier = accessList(design, "barriers").find((b) => b?.id === crossover?.barrierId);
    if (!barrier) {
      usabilityFindings.push(
        finding(
          ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED,
          crossover?.id ?? "(unknown)",
          `Crossover ${crossover?.id ?? "(unknown)"} references barrier ${crossover?.barrierId ?? "(none)"}, which does not exist.`,
        ),
      );
      continue;
    }
    usabilityFindings.push(...validateCrossover(design, barrier, crossover).findings);
  }
  const checks = {
    profiles: profiles.state,
    manway: manway.state,
    operator: operator.state,
    removal: removal.state,
    crossoverSpacing: spacingFindings.length === 0 ? "PASS" : spacingFindings[0].code,
    crossoverUsability: usabilityFindings.length === 0 ? "PASS" : usabilityFindings[0].code,
    walkGraph: walkGraph.state,
  };
  const findings = dedupeFindings([
    ...profiles.findings,
    ...manway.findings,
    ...operator.findings,
    ...removal.findings,
    ...spacingFindings,
    ...usabilityFindings,
    ...walkGraph.findings,
  ]);
  const allClear = Object.values(checks).every((s) => s === "PASS" || s === "NOT_APPLICABLE");
  return { checks, findings, allClear };
}

/**
 * All D10-03 findings for a design as strings, in the same shape
 * as the sibling *Errors aggregators. PR C does not wire this into
 * validateDesign (see the header note); PR E wires it when the
 * sample is revised.
 */
export function pipeAccessRuleErrors(design) {
  const { findings } = accessCheckStates(design);
  return [...new Set(findings.map((f) => `${f.code}: ${f.message}`))];
}
