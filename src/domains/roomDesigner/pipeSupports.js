// pipeSupports.js — D10-02 size/profile support library and spacing
// (Designer D10 PR B).
//
// Implements brief §D10-02 of
// results/chatgpt/designer-d10-routing-supports-access-implementation-brief-2026-10-23.md
// under the binding rules of
// briefs/designer/pipe-design-reference-digest-2026-10-23.md (digest §2
// pipe racks, §3 supports). Pure and framework-free: every function
// takes data and returns data; no function mutates its input run or
// design.
//
// What this module is:
// - Route-interval classification (brief item 1): persisted roles
//   RACK_TRAVEL / EQUIPMENT_APPROACH / SHORT_INTERCONNECT /
//   BURIED_FIREWATER covering the full developed route. Travel uses
//   actual racks (a rackId that resolves to a real rack instance, a
//   tier inside it, and a stable rack-local offset the route geometry
//   actually sits at); an approach terminates at named equipment and
//   its serving rack exit; a short interconnect binds two attached
//   equipment interfaces on an authored basis. A long cross-plot route
//   cannot evade rack travel by renaming every interval "approach":
//   an approach with no rack exit is unverified. No universal length
//   threshold is claimed from the digest — there is none.
// - Support library (brief item 2): scheduled supports with a type
//   from the closed support set and a carrier that reaches a real
//   foundation/carrier — a rack bent/beam, a sleeper, a foundation at
//   the support's plan point, a named structure/shell/hanger, or a
//   larger line (pick-up) the support point actually lies on. Guides
//   and anchors are restraints, not weight supports: a guide or
//   anchor in the supports list never clears a span. Bare ground is
//   not a support.
// - O1 span verification (brief item 3; digest §3.4): developed
//   physical centerline intervals between weight-carrying contacts
//   against the adopted size/profile table (water-filled
//   standard-weight steel, distributed load). Different sizes get
//   different maxima; reducer stations split profile applicability
//   explicitly. Rack bents may use the digest's approximate 25-ft
//   rhythm as a layout target, but a 2-in line then needs
//   intermediate support <=10 ft. Vapor may use the water-filled
//   profile only as an explicitly selected conservative planning
//   baseline, never as a sourced vapor maximum.
// - O2 transitions/loads (brief item 4; digest §3.8): a support
//   immediately adjacent to every direction/elevation change, bound
//   to the transition by index AND by contact station within the
//   transition-adjacency tolerance (0.5 in, the adopted fitting-face
//   tolerance) — a remote support never counts because it sits inside
//   a span maximum, and an index alone proves nothing. A vertical leg
//   needs both transition elbows supported; an up/down jog has four
//   transition locations. Heavy valves/flanged assemblies need an
//   adjacent scheduled load support; distributed-load spans do not
//   clear concentrated loads. A valve station with no authored route
//   station is explicitly unverified, never cleared by index alone.
// - Nozzle ends and risers (brief item 5; digest §3.7, §3.10): a
//   nozzle never carries pipe weight. The last support before a
//   nozzle comes from the authored support schedule — the named
//   support must be the actual last weight support before that end;
//   an unknown arrangement is NOZZLE_SUPPORT_UNVERIFIED, never a
//   fabricated zero-length tail. Vertical runs need independent
//   riser supports (each bracket rated for an authored maximum
//   length of water-filled pipe) plus guides at the digest §3.10
//   guide profile intervals (a guide profile, never a horizontal
//   weight-support span).
// - O3 pair spacing (brief item 6; digest §2.2–2.3): per-pair
//   centers from validated OD, insulation, flange/fitting envelopes
//   and authored expansion allowance. Ordinary gap 3 in; largest-line
//   profile 4 in. The digest specifies no size cutoff for "largest":
//   the profile assignment is explicit and source-linked, and a
//   missing classification is SPACING_PROFILE_UNVERIFIED — no
//   diameter threshold is invented. At a flange station the
//   governing 1-in flange clearance applies plus the authored
//   expansion allowances of both lines; overlapping flange
//   stations use flange/flange envelopes plus both allowances.
//   Nominal bore is not OD.
// - Rack organization (brief item 7; digest §2.4–2.7): stable
//   rack-local line coordinates, guides/shoes as scheduled, authored
//   reserve (a missing reserve definition is
//   RACK_RESERVE_UNVERIFIED, never an invented percentage) and loop
//   envelopes. Overflow proposes another tier within the existing
//   bounded rack limits (currently five), or explicit resize/add-rack
//   review — never silent spillover or an undeclared sixth tier.
//   Tier separation follows actual pipe/fitting/beam envelopes; the
//   old inference that a horizontal 3-in gap defines tier clearance
//   is deleted.
// - Structure clearance (brief item 8; digest §2.8/§2.10): 2 ft from
//   a flange outside diameter to a wall, column or other structure
//   where applicable, with explicitly modeled envelope checks.
//   Unclear applicability stays named, never silently waived.
// - Ground/buried handling (brief item 9; digest §3.6): low
//   approaches/sleeper corridors are scheduled supported piping; bare
//   ground is not support evidence. No arbitrary 100-ft ground
//   cap survives O4. Existing D9 burial rules remain; soil/bedding
//   strength is NOT_EVALUATED and is never mislabeled
//   steel-supported. Exposed transitions need supports (covered by
//   the O2 transition rule).
// - Editable workflow (brief item 10): add/edit/delete support,
//   reassign carrier/tier, preview packing/field-support proposals.
//   Apply is only by the caller and is one undoable transaction
//   through the reducer cases; move/delete/change-size/phase/
//   insulation edits revalidate the whole affected run through
//   revalidateSupportsAfterEdit. Existing data is never silently
//   repacked, clamped or moved.
//
// What this module deliberately does NOT do in PR B (see the PR
// report):
// - It is not wired into validateDesign. The current production
//   sample is diagonal by construction and carries no D10-02
//   schedule data; wiring these findings in before PR E revises the
//   sample would break that acceptance test. PR E wires
//   pipeSupportRuleErrors into validateDesign when the sample is
//   revised.
// - It does not build D10-03 access zones/crossovers or D10-04
//   vessel end-head schedules. Ground-handling notes the access
//   revalidation those rules need; the D10-03 registry owns it.
// - It builds no React UI. The domain functions and reducer cases
//   are the editable workflow; the authoring controls that drive
//   them land with the integrated delivery (PR E).
// - It performs no migration, repair, repacking or new
//   infrastructure. Support data is optional authored metadata on
//   pipe runs (and an optional reserve on rack instances); designs
//   without it validate as explicitly unverified, never as passing.

import {
  CONNECTION_FACE_TOLERANCE_IN,
  CROSSING_CLEARANCE_IN,
  closestSegSegPoints,
  physicalRouteIn,
  pointSegmentDistance,
  properIntersection,
  runIsBuried,
  validatedContactPoints,
} from "./pipeCrossings";
import { attachmentInterfaceErrors } from "./pipeAttachments";
import { classifyLeg, ROUTE_AXIS_EPSILON_IN } from "./pipeRoutingRules";
import { rackParams, rackPlan, RACK_BEAM_DEPTH_IN, RACK_LIMITS } from "./rackGeometry";
import { findSymbol } from "./symbolRegistry";

/** Face-contact tolerance (in): single source is pipeCrossings. */
export const SUPPORT_FACE_TOLERANCE_IN = CONNECTION_FACE_TOLERANCE_IN;
/**
 * Transition-adjacency tolerance (in): a transition support's
 * contact station must sit within this of the transition station.
 * Reuses the adopted 0.5-in fitting-face tolerance (brief D10-01;
 * the flange loadRef binding uses the same value) — no new number
 * is invented. A trunnion/bracket whose contact point sits farther
 * from the elbow does not clear the transition: its connection to
 * that elbow is not modeled, so the index alone proves nothing.
 */
export const TRANSITION_ADJACENCY_IN = SUPPORT_FACE_TOLERANCE_IN;
/** Numerical axis epsilon (in): representation policy, from D10-01. */
export const SUPPORT_AXIS_EPSILON_IN = ROUTE_AXIS_EPSILON_IN;
/** Station epsilon (in): two stations closer than this are the same station. */
export const SUPPORT_STATION_EPSILON_IN = 1e-6;

/**
 * Adopted size/profile support table (brief §D10-02, digest §3.4):
 * maximum span in inches for water-filled standard-weight steel pipe
 * under distributed load. Entries are the adopted project values,
 * not capacity calculations. Do not interpolate unsupported sizes,
 * assume a different material/schedule/fluid qualifies, or invent
 * "slightly longer" vapor allowances.
 */
export const SUPPORT_SPAN_TABLE_IN = Object.freeze({
  0.5: 84,
  0.75: 84,
  1: 84,
  1.5: 108,
  2: 120,
  2.5: 132,
  3: 144,
  3.5: 156,
  4: 168,
  5: 192,
  6: 204,
  8: 228,
  10: 264,
  12: 276,
  14: 300,
  16: 324,
  18: 336,
  20: 360,
  24: 384,
});

/**
 * Riser guide profile (digest §3.10): maximum guide interval in
 * inches by nominal size. A GUIDE profile, not permission to apply
 * these numbers as horizontal weight-support spans. Sizes above 10
 * in have no adopted guide interval: unknown, never interpolated.
 * "up to 3 in" covers 0.5–3 in.
 */
export const RISER_GUIDE_PROFILE_IN = Object.freeze([
  Object.freeze({ maxSizeIn: 3, maxIntervalIn: 300 }),
  Object.freeze({ maxSizeIn: 4, maxIntervalIn: 360 }),
  Object.freeze({ maxSizeIn: 6, maxIntervalIn: 480 }),
  Object.freeze({ maxSizeIn: 8, maxIntervalIn: 600 }),
  Object.freeze({ maxSizeIn: 10, maxIntervalIn: 660 }),
]);

/**
 * D10-06 Ruling 1: named planning profile for riser guides above
 * 10 in. The 660-in value is the digest's published 10-in maximum,
 * deliberately retained as a conservative frequency cap — it is NOT
 * a sourced 12/16/24-in interval, a calculation, capacity evidence,
 * or engineering certification, and it never applies as a horizontal
 * weight-support span (see maxSpanInFor / SUPPORT_SPAN_TABLE_IN).
 * The cap covers nominal sizes greater than 10 in through the
 * currently supported 24-in size, only when this exact profile is
 * explicitly selected and persisted on the run (run.guideProfile).
 * Anything else — missing selection, a different profile string,
 * size above 24 in, invalid size — stays unverified.
 */
export const RISER_GUIDE_CAP_PROFILE = "conservative-10in-guide-cap-v1";
export const RISER_GUIDE_CAP_MAX_SIZE_IN = 24;
export const RISER_GUIDE_CAP_INTERVAL_IN = 660;

/**
 * Resolve a riser guide interval with its provenance, so findings
 * and UI can distinguish digest-backed entries (<=10 in, source
 * "digest") from the reviewer-adopted interim cap (source
 * "reviewer-adopted-cap"). Returns { ok, intervalIn, source,
 * reason }: ok is false with intervalIn null whenever the size has
 * no adopted interval — missing/invalid size, above 24 in, or above
 * 10 in without the explicitly selected named cap profile.
 */
export function resolveRiserGuideInterval(sizeIn, options = {}) {
  if (!isFiniteNumber(sizeIn) || sizeIn <= 0) {
    return {
      ok: false,
      intervalIn: null,
      source: null,
      reason: `nominal size ${sizeIn} in is not a finite positive size`,
    };
  }
  for (const row of RISER_GUIDE_PROFILE_IN) {
    if (sizeIn <= row.maxSizeIn) {
      return { ok: true, intervalIn: row.maxIntervalIn, source: "digest" };
    }
  }
  if (sizeIn <= RISER_GUIDE_CAP_MAX_SIZE_IN && options.guideProfile === RISER_GUIDE_CAP_PROFILE) {
    return { ok: true, intervalIn: RISER_GUIDE_CAP_INTERVAL_IN, source: "reviewer-adopted-cap" };
  }
  return {
    ok: false,
    intervalIn: null,
    source: null,
    reason:
      sizeIn > RISER_GUIDE_CAP_MAX_SIZE_IN
        ? `nominal size ${sizeIn} in is above the supported 24-in size`
        : `nominal size ${sizeIn} in has no adopted riser guide interval without the explicitly selected "${RISER_GUIDE_CAP_PROFILE}" profile; the digest guide profile ends at 10 in`,
  };
}

/** Ordinary / largest-line surface gaps (in), digest §2.2. */
export const SPACING_GAP_IN = Object.freeze({ ordinary: 3, "largest-line": 4 });
/** Flange governing clear gap (in), digest §2.2. */
export const FLANGE_GAP_IN = 1;
/** Flange-to-structure working space (in), digest §2.8/§2.10. */
export const STRUCTURE_CLEARANCE_IN = 24;
/** "Low" pipe for ground handling (in above grade), digest §3.2. */
export const LOW_PIPE_ELEVATION_IN = 24;
/** Bounded rack tiers (rackGeometry RACK_LIMITS). */
export const MAX_RACK_TIERS = RACK_LIMITS.pipe.tiers[1];

/** Finding codes. Every code is stable text a reviewer can grep for. */
export const SUPPORT_CODES = Object.freeze({
  ROUTE_CLASSIFICATION_UNVERIFIED: "ROUTE_CLASSIFICATION_UNVERIFIED",
  SPAN_PROFILE_UNVERIFIABLE: "SPAN_PROFILE_UNVERIFIABLE",
  SPAN_SIZE_CHANGE_INVALID: "SPAN_SIZE_CHANGE_INVALID",
  SPAN_EXCEEDS_MAX: "SPAN_EXCEEDS_MAX",
  SUPPORT_NONE_SCHEDULED: "SUPPORT_NONE_SCHEDULED",
  SUPPORT_STATION_OUT_OF_RANGE: "SUPPORT_STATION_OUT_OF_RANGE",
  SUPPORT_CARRIER_UNVERIFIED: "SUPPORT_CARRIER_UNVERIFIED",
  SUPPORT_TYPE_UNKNOWN: "SUPPORT_TYPE_UNKNOWN",
  SUPPORT_NOT_WEIGHT_CARRYING: "SUPPORT_NOT_WEIGHT_CARRYING",
  GROUND_NOT_SUPPORT: "GROUND_NOT_SUPPORT",
  TRANSITION_SUPPORT_MISSING: "TRANSITION_SUPPORT_MISSING",
  CONCENTRATED_LOAD_UNSUPPORTED: "CONCENTRATED_LOAD_UNSUPPORTED",
  CONCENTRATED_LOAD_UNVERIFIED: "CONCENTRATED_LOAD_UNVERIFIED",
  NOZZLE_SUPPORT_UNVERIFIED: "NOZZLE_SUPPORT_UNVERIFIED",
  NOZZLE_SUPPORT_UNRESOLVED: "NOZZLE_SUPPORT_UNRESOLVED",
  NOZZLE_SUPPORT_NOT_LAST: "NOZZLE_SUPPORT_NOT_LAST",
  RISER_SUPPORT_UNVERIFIED: "RISER_SUPPORT_UNVERIFIED",
  RISER_SUPPORT_INSUFFICIENT: "RISER_SUPPORT_INSUFFICIENT",
  GUIDE_NOT_SCHEDULED: "GUIDE_NOT_SCHEDULED",
  GUIDE_PROFILE_UNVERIFIED: "GUIDE_PROFILE_UNVERIFIED",
  GUIDE_INTERVAL_EXCEEDED: "GUIDE_INTERVAL_EXCEEDED",
  SPACING_PROFILE_UNVERIFIED: "SPACING_PROFILE_UNVERIFIED",
  SPACING_DATA_INVALID: "SPACING_DATA_INVALID",
  SPACING_TOO_CLOSE: "SPACING_TOO_CLOSE",
  RACK_NOT_FOUND: "RACK_NOT_FOUND",
  RACK_LINE_UNVERIFIED: "RACK_LINE_UNVERIFIED",
  RACK_TIER_OVERFLOW: "RACK_TIER_OVERFLOW",
  RACK_RESERVE_UNVERIFIED: "RACK_RESERVE_UNVERIFIED",
  RACK_RESERVE_EXCEEDED: "RACK_RESERVE_EXCEEDED",
  TIER_SEPARATION_UNVERIFIED: "TIER_SEPARATION_UNVERIFIED",
  TIER_SEPARATION_INSUFFICIENT: "TIER_SEPARATION_INSUFFICIENT",
  SHOE_NOT_SCHEDULED: "SHOE_NOT_SCHEDULED",
  LOOP_ENVELOPE_UNVERIFIED: "LOOP_ENVELOPE_UNVERIFIED",
  STRUCTURE_CLEARANCE_UNVERIFIED: "STRUCTURE_CLEARANCE_UNVERIFIED",
  STRUCTURE_CLEARANCE_VIOLATION: "STRUCTURE_CLEARANCE_VIOLATION",
  BURIED_CLAIM_UNVERIFIED: "BURIED_CLAIM_UNVERIFIED",
});

/** Types that carry pipe weight (digest §3.2). */
export const WEIGHT_SUPPORT_TYPES = Object.freeze(
  new Set([
    "bent",
    "beam",
    "stanchion",
    "base-support",
    "bracket",
    "hanger",
    "trapeze",
    "roller",
    "shoe",
    "riser-support",
    "dummy-leg",
    "trunnion",
    "pick-up",
    "spring-hanger",
  ]),
);
/** Restraint types (digest §3.3): control movement, do not carry weight. */
export const RESTRAINT_TYPES = Object.freeze(new Set(["guide", "anchor", "directional-anchor"]));
/** Carrier kinds a scheduled support may bind to. */
export const CARRIER_KINDS = Object.freeze(
  new Set([
    "rack-bent",
    "rack-beam",
    "sleeper",
    "foundation",
    "structure",
    "shell-bracket",
    "hanger-rod",
    "larger-line",
  ]),
);
/** Route-interval roles (brief item 1). */
export const INTERVAL_ROLES = Object.freeze(
  new Set(["RACK_TRAVEL", "EQUIPMENT_APPROACH", "SHORT_INTERCONNECT", "BURIED_FIREWATER"]),
);
/** Steel materials the adopted span table is sourced for. */
export const SPAN_STEEL_MATERIALS = Object.freeze(
  new Set(["steel", "steel-standard-weight", "standard-weight-steel", "carbon-steel"]),
);
/** Eligible span-profile bases. */
export const SPAN_PROFILE_BASES = Object.freeze(
  new Set(["water-filled-standard-steel", "vapor-conservative-baseline"]),
);

const EPS = SUPPORT_STATION_EPSILON_IN;
const FACE = SUPPORT_FACE_TOLERANCE_IN;
const ENDS = ["start", "end"];

function finding(code, runId, message, extra = undefined) {
  const out = { code, runId, message };
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

let supportSeq = 0;
/** Reset the generated support-id counter (tests only). */
export function resetSupportIds() {
  supportSeq = 0;
}

function nextSupportId() {
  supportSeq += 1;
  return `support-${supportSeq}`;
}

// ---- Developed-route geometry ------------------------------------------

/**
 * Developed stations along the run's physical route: one entry per
 * vertex with its cumulative 3D centerline distance from the start,
 * plus the total developed length. The same physical route every
 * consumer reads (physicalRouteIn); a bend or riser contributes its
 * full developed length, never its plan projection.
 */
export function routeStations(design, run) {
  const route = physicalRouteIn(design, run);
  const stations = [];
  let total = 0;
  for (let i = 0; i < route.length; i += 1) {
    if (i > 0) {
      total += Math.hypot(
        route[i].x - route[i - 1].x,
        route[i].y - route[i - 1].y,
        route[i].zIn - route[i - 1].zIn,
      );
    }
    stations.push({ vertexIndex: i, stationIn: total, point: route[i] });
  }
  return { stations, totalIn: total, route };
}

/** 3D point on the route at a developed station (linear interpolation). */
export function pointAtStation(route, stationIn) {
  if (!Array.isArray(route) || route.length === 0) return null;
  if (route.length === 1) return { ...route[0] };
  let acc = 0;
  for (let i = 0; i + 1 < route.length; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.zIn - a.zIn);
    if (stationIn <= acc + len + EPS || i === route.length - 2) {
      const t = len > 0 ? Math.max(0, Math.min(1, (stationIn - acc) / len)) : 0;
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), zIn: a.zIn + t * (b.zIn - a.zIn) };
    }
    acc += len;
  }
  return { ...route[route.length - 1] };
}

/**
 * Closest point on a route to a 3D point: { distance, stationIn,
 * point }. The station is the developed distance to the projection.
 */
function closestPointOnRoute(route, point) {
  let best = null;
  let acc = 0;
  for (let i = 0; i + 1 < route.length; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.zIn - a.zIn);
    const t = len > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y) + (point.zIn - a.zIn) * (b.zIn - a.zIn)) / (len * len))) : 0;
    const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), zIn: a.zIn + t * (b.zIn - a.zIn) };
    const d = Math.hypot(point.x - proj.x, point.y - proj.y, point.zIn - proj.zIn);
    if (best === null || d < best.distance) {
      best = { distance: d, stationIn: acc + t * len, point: proj };
    }
    acc += len;
  }
  return best;
}

// ---- Rack geometry in world coordinates ---------------------------------

/** A rack symbol instance by id, with its catalog symbol; null when not a rack. */
export function rackInstanceById(design, rackId) {
  const inst = (design?.symbols || []).find((s) => s.id === rackId);
  if (!inst) return null;
  const symbol = findSymbol(inst.domain, inst.symbolId);
  if (!symbol?.rack) return null;
  return { inst, symbol, params: rackParams(symbol, inst) };
}

/**
 * Rack footprint in plan coordinates: centre, half length/width and
 * rotation. Local frame: x along the rack, z across (rackGeometry);
 * the plan renderer places it with translate + rotate(rotationDeg),
 * so the same transform maps local to world here.
 */
export function rackFootprint(design, rackId) {
  const found = rackInstanceById(design, rackId);
  if (!found) return null;
  const { inst, params } = found;
  return {
    cx: inst.x,
    cy: inst.y,
    halfL: params.lengthIn / 2,
    halfW: params.widthIn / 2,
    rotationDeg: inst.rotationDeg || 0,
    params,
    inst,
  };
}

function toRackLocal(footprint, point) {
  const rad = (footprint.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - footprint.cx;
  const dy = point.y - footprint.cy;
  return { along: dx * cos + dy * sin, across: -dx * sin + dy * cos };
}

/** True when a plan point lies inside a rack footprint (face tolerance). */
export function pointInRackFootprint(footprint, point) {
  if (!footprint) return false;
  const local = toRackLocal(footprint, point);
  return (
    Math.abs(local.along) <= footprint.halfL + FACE && Math.abs(local.across) <= footprint.halfW + FACE
  );
}

/** World plan positions of a rack's columns (10-in squares). */
export function rackColumnWorldPositions(design, rackId) {
  const found = rackInstanceById(design, rackId);
  if (!found) return [];
  const { inst, params } = found;
  const plan = rackPlan(params);
  const rad = ((inst.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return plan.columns.map((c) => ({
    x: inst.x + c.x * cos - c.z * sin,
    y: inst.y + c.x * sin + c.z * cos,
    size: c.size,
    topIn: params.elevationIn + (params.tiers - 1) * params.tierSpacingIn,
  }));
}

// ---- Carrier verification ------------------------------------------------

/**
 * Verify one support/restraint carrier against the design. A carrier
 * is real weight-carrying contact only when it resolves: a rack
 * bent/beam/sleeper names a real rack instance (of the matching kind,
 * with a tier inside it, and — for a bent/beam — the support point
 * inside the rack footprint); a pick-up names another run whose route
 * the support point actually lies on; a structure/shell/hanger names
 * its reference; a foundation is the grade location at the support's
 * plan point. Ground/grade is never a carrier: bare ground is not
 * support evidence. Returns { ok, reason }.
 */
export function verifyCarrier(design, carrier, point) {
  if (!isPlainObject(carrier) || typeof carrier.kind !== "string") {
    return { ok: false, reason: "no carrier is scheduled for this support" };
  }
  if (carrier.kind === "ground" || carrier.kind === "grade") {
    return { ok: false, reason: "bare ground is not a support", ground: true };
  }
  if (!CARRIER_KINDS.has(carrier.kind)) {
    return { ok: false, reason: `unknown carrier kind "${carrier.kind}"` };
  }
  if (carrier.kind === "rack-bent" || carrier.kind === "rack-beam" || carrier.kind === "sleeper") {
    const found = rackInstanceById(design, carrier.rackId);
    if (!found) return { ok: false, reason: `carrier names rack "${carrier.rackId}" which is not a rack in the design` };
    const wantKind = carrier.kind === "sleeper" ? "sleeper" : "pipe";
    if (found.params.kind !== wantKind) {
      return { ok: false, reason: `carrier rack "${carrier.rackId}" is a ${found.params.kind} rack, not a ${wantKind} rack` };
    }
    if (carrier.tier !== undefined && carrier.tier !== null) {
      if (!Number.isInteger(carrier.tier) || carrier.tier < 1 || carrier.tier > found.params.tiers) {
        return { ok: false, reason: `carrier tier ${carrier.tier} is outside rack "${carrier.rackId}" (${found.params.tiers} tiers)` };
      }
    }
    if (point && carrier.kind !== "sleeper") {
      const footprint = rackFootprint(design, carrier.rackId);
      if (!pointInRackFootprint(footprint, point)) {
        return { ok: false, reason: "support point is not inside its carrier rack's footprint" };
      }
    }
    return { ok: true };
  }
  if (carrier.kind === "larger-line") {
    const host = (design?.pipes || []).find((r) => r.id === carrier.lineId);
    if (!host) return { ok: false, reason: `pick-up carrier names line "${carrier.lineId}" which does not exist` };
    if (point) {
      const hostRoute = physicalRouteIn(design, host);
      const closest = closestPointOnRoute(hostRoute, point);
      if (!closest || closest.distance > FACE) {
        return { ok: false, reason: "pick-up support point does not lie on its carrier line's route" };
      }
    }
    return { ok: true };
  }
  // foundation: the grade location at the support's plan point is the
  // carrier. structure / shell-bracket / hanger-rod: the model holds
  // no foundation objects, so the schedule names its reference.
  if (carrier.kind === "structure" || carrier.kind === "shell-bracket" || carrier.kind === "hanger-rod") {
    if (typeof carrier.reference !== "string" || carrier.reference.trim() === "") {
      return { ok: false, reason: `a ${carrier.kind} carrier needs a named reference` };
    }
  }
  return { ok: true };
}

/** Weight-carrying supports of a run (restraint types excluded). */
export function weightSupportsOf(run) {
  return (run?.supports || []).filter((s) => s && WEIGHT_SUPPORT_TYPES.has(s.type));
}

function isWeightSupport(s) {
  return !!s && WEIGHT_SUPPORT_TYPES.has(s.type);
}

/**
 * Classify every entry of run.supports: weight supports (usable as
 * span contacts), restraint entries that do not carry weight, unknown
 * types, and carrier problems. Returns { contacts, findings } where
 * contacts are the usable weight supports sorted by station, each
 * with its resolved station and route point.
 */
function classifySupports(design, run, route, totalIn) {
  const findings = [];
  const contacts = [];
  const runId = run?.id ?? "(unknown)";
  for (const s of run?.supports || []) {
    if (!isPlainObject(s)) {
      findings.push(
        finding(SUPPORT_CODES.SUPPORT_TYPE_UNKNOWN, runId, `Pipe run ${runId} has a malformed support entry; it carries no weight.`),
      );
      continue;
    }
    if (RESTRAINT_TYPES.has(s.type)) {
      findings.push(
        finding(
          SUPPORT_CODES.SUPPORT_NOT_WEIGHT_CARRYING,
          runId,
          `Pipe run ${runId} support ${s.id || "(unnamed)"} is a ${s.type}: a restraint controls movement and never carries pipe weight.`,
        ),
      );
      continue;
    }
    if (!WEIGHT_SUPPORT_TYPES.has(s.type)) {
      findings.push(
        finding(
          SUPPORT_CODES.SUPPORT_TYPE_UNKNOWN,
          runId,
          `Pipe run ${runId} support ${s.id || "(unnamed)"} has unknown type "${s.type}"; it carries no weight.`,
        ),
      );
      continue;
    }
    if (!isFiniteNumber(s.stationIn) || s.stationIn < -EPS || s.stationIn > totalIn + EPS) {
      findings.push(
        finding(
          SUPPORT_CODES.SUPPORT_STATION_OUT_OF_RANGE,
          runId,
          `Pipe run ${runId} support ${s.id || "(unnamed)"} station ${s.stationIn} is outside the developed route (0–${totalIn} in).`,
        ),
      );
      continue;
    }
    const point = pointAtStation(route, Math.max(0, Math.min(totalIn, s.stationIn)));
    const carrier = verifyCarrier(design, s.carrier, point);
    if (!carrier.ok) {
      findings.push(
        finding(
          carrier.ground ? SUPPORT_CODES.GROUND_NOT_SUPPORT : SUPPORT_CODES.SUPPORT_CARRIER_UNVERIFIED,
          runId,
          `Pipe run ${runId} support ${s.id || "(unnamed)"} (${s.type} at ${s.stationIn} in) has no verified carrier: ${carrier.reason}.`,
        ),
      );
      continue;
    }
    contacts.push({ ...s, stationIn: Math.max(0, Math.min(totalIn, s.stationIn)), point });
  }
  contacts.sort((a, b) => a.stationIn - b.stationIn);
  return { contacts, findings };
}

// ---- O1: size/profile spans (brief item 3) ------------------------------

/**
 * Resolve the run's eligible span profile. The adopted table covers
 * water-filled standard-weight steel under distributed load only.
 * Eligibility needs: an explicit spanProfile, a nominal size in the
 * table, a steel material when one is authored, and a basis that
 * matches the fluid — water on the water-filled basis, or vapor on
 * the explicitly selected vapor-conservative baseline. Anything
 * else is SPAN_PROFILE_UNVERIFIABLE: unknown stays explicitly
 * unverified, never silently passed or fabricated.
 */
export function resolveSpanProfile(run) {
  const runId = run?.id ?? "(unknown)";
  const profile = run?.spanProfile;
  if (!isPlainObject(profile)) {
    return { ok: false, reason: "no span profile is authored for this run" };
  }
  const sizeIn = profile.nominalSizeIn ?? run?.diameterIn;
  if (!isFiniteNumber(sizeIn) || !(sizeIn in SUPPORT_SPAN_TABLE_IN)) {
    return { ok: false, reason: `nominal size ${sizeIn} in has no adopted span maximum` };
  }
  const material = profile.material ?? run?.material;
  if (material !== undefined && material !== null && !SPAN_STEEL_MATERIALS.has(String(material))) {
    return { ok: false, reason: `material "${material}" is not the standard-weight steel the span table is sourced for` };
  }
  const fluid = profile.fluid ?? "water";
  if (fluid === "water" && profile.basis === "water-filled-standard-steel") {
    return { ok: true, sizeIn, maxIn: SUPPORT_SPAN_TABLE_IN[sizeIn] };
  }
  if (fluid === "vapor" && profile.basis === "vapor-conservative-baseline") {
    return { ok: true, sizeIn, maxIn: SUPPORT_SPAN_TABLE_IN[sizeIn] };
  }
  return {
    ok: false,
    reason:
      `span basis "${profile.basis}" does not match fluid "${fluid}": water needs ` +
      `the water-filled-standard-steel basis, vapor needs the explicitly selected vapor-conservative baseline`,
  };
}

/** Maximum span (in) for a nominal size, or null when the size has no adopted maximum. */
export function maxSpanInFor(sizeIn) {
  if (!isFiniteNumber(sizeIn)) return null;
  return sizeIn in SUPPORT_SPAN_TABLE_IN ? SUPPORT_SPAN_TABLE_IN[sizeIn] : null;
}

/**
 * Validate the run's size changes (reducer stations). Each entry
 * needs a finite station inside the developed route and a size in
 * the adopted table; a bad entry is SPAN_SIZE_CHANGE_INVALID, and
 * the split it claims is not applied.
 */
function validateSizeChanges(run, totalIn) {
  const findings = [];
  const runId = run?.id ?? "(unknown)";
  const changes = [];
  for (const c of run?.sizeChanges || []) {
    if (!isPlainObject(c) || !isFiniteNumber(c.stationIn) || c.stationIn < -EPS || c.stationIn > totalIn + EPS) {
      findings.push(
        finding(
          SUPPORT_CODES.SPAN_SIZE_CHANGE_INVALID,
          runId,
          `Pipe run ${runId} has a size change at station ${c?.stationIn} outside the developed route (0–${totalIn} in); the profile split is not applied.`,
        ),
      );
      continue;
    }
    if (!isFiniteNumber(c.nominalSizeIn) || !(c.nominalSizeIn in SUPPORT_SPAN_TABLE_IN)) {
      findings.push(
        finding(
          SUPPORT_CODES.SPAN_SIZE_CHANGE_INVALID,
          runId,
          `Pipe run ${runId} size change at ${c.stationIn} in names size ${c.nominalSizeIn} in, which has no adopted span maximum.`,
        ),
      );
      continue;
    }
    changes.push({ stationIn: Math.max(0, Math.min(totalIn, c.stationIn)), nominalSizeIn: c.nominalSizeIn });
  }
  changes.sort((a, b) => a.stationIn - b.stationIn);
  return { changes, findings };
}

/** Nominal size in effect at a developed station (reducer splits applied). */
function sizeAtStation(baseSizeIn, changes, stationIn) {
  let size = baseSizeIn;
  for (const c of changes) {
    if (stationIn >= c.stationIn - EPS) size = c.nominalSizeIn;
  }
  return size;
}

/**
 * O1 span verification (brief item 3; digest §3.4). Developed
 * physical centerline intervals between weight-carrying contacts —
 * including the end tails (run end to first/last contact) — against
 * the eligible size/profile table, with reducer stations splitting
 * profile applicability. A 2-in line spanning 20 ft flags; a
 * qualifying 24-in distributed-load line at 32 ft does not fail
 * merely for exceeding 20 ft. Rack bent rhythm is a layout target,
 * never span authority: a small line on 25-ft bents needs the
 * intermediate support the table requires.
 */
export function validateSupportSpans(design, run) {
  const runId = run?.id ?? "(unknown)";
  if (!Array.isArray(run?.points) || run.points.length < 2) {
    return {
      state: "SPAN_PROFILE_UNVERIFIABLE",
      findings: [
        finding(
          SUPPORT_CODES.SPAN_PROFILE_UNVERIFIABLE,
          runId,
          `Pipe run ${runId} has no route to measure spans on.`,
        ),
      ],
    };
  }
  const { totalIn, route } = routeStations(design, run);
  const profile = resolveSpanProfile(run);
  if (!profile.ok) {
    return {
      state: "SPAN_PROFILE_UNVERIFIABLE",
      findings: [
        finding(
          SUPPORT_CODES.SPAN_PROFILE_UNVERIFIABLE,
          runId,
          `Pipe run ${runId} span profile is unverifiable: ${profile.reason}.`,
        ),
      ],
    };
  }
  const { changes, findings: changeFindings } = validateSizeChanges(run, totalIn);
  const { contacts, findings: supportFindings } = classifySupports(design, run, route, totalIn);
  const findings = [...changeFindings, ...supportFindings];
  // Digest §3.1: no run is self-supporting. A run with no scheduled
  // weight-carrying support is unsupported over its whole developed
  // length, however short that length is.
  if (contacts.length === 0) {
    findings.push(
      finding(
        SUPPORT_CODES.SUPPORT_NONE_SCHEDULED,
        runId,
        `Pipe run ${runId} has no scheduled weight-carrying support; no run is self-supporting — every run is carried for its whole length.`,
      ),
    );
  }
  // Breakpoints: route ends, weight contacts, reducer stations.
  const points = [0, totalIn];
  for (const c of contacts) points.push(c.stationIn);
  for (const c of changes) points.push(c.stationIn);
  points.sort((a, b) => a - b);
  const breaks = [];
  for (const p of points) {
    if (breaks.length === 0 || p - breaks[breaks.length - 1] > EPS) breaks.push(p);
  }
  for (let i = 0; i + 1 < breaks.length; i += 1) {
    const from = breaks[i];
    const to = breaks[i + 1];
    const len = to - from;
    if (len <= EPS) continue;
    const size = sizeAtStation(profile.sizeIn, changes, (from + to) / 2);
    const max = SUPPORT_SPAN_TABLE_IN[size];
    if (len > max + 1e-9) {
      findings.push(
        finding(
          SUPPORT_CODES.SPAN_EXCEEDS_MAX,
          runId,
          `Pipe run ${runId} spans ${len.toFixed(3)} in between developed stations ${from.toFixed(3)} and ${to.toFixed(3)} in ` +
            `with no weight-carrying support; the ${size}-in maximum is ${max} in.`,
          { fromStationIn: from, toStationIn: to, sizeIn: size, maxIn: max, actualIn: len },
        ),
      );
    }
  }
  return { state: findings.length === 0 ? "PASS" : findings[0].code, findings };
}

// ---- Route-interval classification (brief item 1) -----------------------

/**
 * Validate one run's route-interval classification. Intervals must
 * cover the full developed route contiguously; travel uses a real
 * rack (resolvable rackId, tier inside it, and a rack-local offset
 * the route geometry actually sits at); an approach terminates at
 * its named equipment and its serving rack exit; a short
 * interconnect binds two attached equipment interfaces on an
 * authored basis; a buried-firewater interval must be actually
 * buried. A route of approaches with no rack travel is renamed
 * travel, not an approach.
 */
export function validateRouteClassification(design, run) {
  const runId = run?.id ?? "(unknown)";
  const unverified = (message) => ({
    state: "ROUTE_CLASSIFICATION_UNVERIFIED",
    findings: [finding(SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED, runId, message)],
  });
  if (!Array.isArray(run?.points) || run.points.length < 2) {
    return unverified(`Pipe run ${runId} has no route to classify.`);
  }
  const { stations, totalIn, route } = routeStations(design, run);
  const intervals = run.routeIntervals;
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return unverified(
      `Pipe run ${runId} carries no route-interval classification; travel, approach and interconnect roles are unauthored.`,
    );
  }
  const findings = [];
  const sorted = [...intervals]
    .map((iv, index) => ({ ...iv, index }))
    .sort((a, b) => (a.fromStationIn ?? 0) - (b.fromStationIn ?? 0));
  // Shape + coverage.
  let coveredTo = 0;
  let shapeOk = true;
  for (const iv of sorted) {
    if (
      !isPlainObject(iv) ||
      !INTERVAL_ROLES.has(iv.role) ||
      !isFiniteNumber(iv.fromStationIn) ||
      !isFiniteNumber(iv.toStationIn) ||
      iv.fromStationIn < -EPS ||
      iv.toStationIn > totalIn + EPS ||
      iv.toStationIn - iv.fromStationIn <= EPS
    ) {
      findings.push(
        finding(
          SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
          runId,
          `Pipe run ${runId} interval ${iv.index} is malformed (role "${iv?.role}", stations ${iv?.fromStationIn}–${iv?.toStationIn}); roles are RACK_TRAVEL, EQUIPMENT_APPROACH, SHORT_INTERCONNECT or BURIED_FIREWATER.`,
        ),
      );
      shapeOk = false;
      continue;
    }
    if (Math.abs(iv.fromStationIn - coveredTo) > EPS) {
      findings.push(
        finding(
          SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
          runId,
          `Pipe run ${runId} intervals do not cover the developed route: station ${coveredTo.toFixed(3)} in to ${iv.fromStationIn.toFixed(3)} in has no role.`,
        ),
      );
      shapeOk = false;
    }
    coveredTo = Math.max(coveredTo, iv.toStationIn);
  }
  if (shapeOk && Math.abs(coveredTo - totalIn) > EPS) {
    findings.push(
      finding(
        SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
        runId,
        `Pipe run ${runId} intervals end at ${coveredTo.toFixed(3)} in but the developed route is ${totalIn.toFixed(3)} in; the tail has no role.`,
      ),
    );
  }
  // Per-interval role requirements.
  for (const iv of sorted) {
    if (!INTERVAL_ROLES.has(iv.role)) continue;
    if (iv.role === "RACK_TRAVEL") {
      const found = rackInstanceById(design, iv.rackId);
      if (!found) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} rack-travel interval ${iv.fromStationIn}–${iv.toStationIn} in names rack "${iv.rackId}" which is not a rack in the design.`,
          ),
        );
        continue;
      }
      if (!Number.isInteger(iv.tier) || iv.tier < 1 || iv.tier > found.params.tiers) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} rack-travel interval on rack "${iv.rackId}" names tier ${iv.tier}; the rack has ${found.params.tiers} tiers.`,
          ),
        );
      }
      if (!isFiniteNumber(iv.rackOffsetIn)) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} rack-travel interval on rack "${iv.rackId}" has no authored rack-local offset; line coordinates are stable authored data, never inferred.`,
          ),
        );
        continue;
      }
      // The route geometry must actually sit at its authored
      // rack-local coordinate: sample the interval's endpoints and
      // every vertex inside it, and check the across-rack coordinate
      // against rackOffsetIn and the footprint. Full intervals, not
      // midpoint containment.
      const footprint = rackFootprint(design, iv.rackId);
      const sampled = [pointAtStation(route, iv.fromStationIn), pointAtStation(route, iv.toStationIn)];
      for (let i = 0; i < stations.length; i += 1) {
        if (stations[i].stationIn > iv.fromStationIn + EPS && stations[i].stationIn < iv.toStationIn - EPS) {
          sampled.push(stations[i].point);
        }
      }
      for (const pt of sampled) {
        if (!pt) continue;
        const local = toRackLocal(footprint, pt);
        if (Math.abs(local.across - iv.rackOffsetIn) > FACE) {
          findings.push(
            finding(
              SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
              runId,
              `Pipe run ${runId} rack-travel interval claims rack-local offset ${iv.rackOffsetIn} in on rack "${iv.rackId}" but the route sits at ${local.across.toFixed(3)} in across the rack.`,
            ),
          );
          break;
        }
        if (!pointInRackFootprint(footprint, pt)) {
          findings.push(
            finding(
              SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
              runId,
              `Pipe run ${runId} rack-travel interval leaves the footprint of rack "${iv.rackId}"; travel uses actual racks.`,
            ),
          );
          break;
        }
      }
    }
    if (iv.role === "EQUIPMENT_APPROACH") {
      const rackFound = rackInstanceById(design, iv.rackId);
      if (!rackFound) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} approach interval ${iv.fromStationIn}–${iv.toStationIn} in names serving rack "${iv.rackId}" which is not a rack in the design.`,
          ),
        );
        continue;
      }
      const equip = (design?.symbols || []).find((s) => s.id === iv.equipmentId);
      if (!equip) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} approach interval names equipment "${iv.equipmentId}" which is not in the design.`,
          ),
        );
        continue;
      }
      // The approach terminates at the named equipment: one interval
      // end is a run end attached to that equipment.
      const atStart = Math.abs(iv.fromStationIn) <= EPS;
      const atEnd = Math.abs(iv.toStationIn - totalIn) <= EPS;
      let equipmentEnd = null;
      if (atStart && run.attachments?.start?.symbolId === iv.equipmentId) equipmentEnd = "start";
      else if (atEnd && run.attachments?.end?.symbolId === iv.equipmentId) equipmentEnd = "end";
      if (!equipmentEnd) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} approach interval ${iv.fromStationIn}–${iv.toStationIn} in does not terminate at an end attached to equipment "${iv.equipmentId}"; an approach terminates at its named equipment.`,
          ),
        );
        continue;
      }
      if (attachmentInterfaceErrors(design, run, equipmentEnd).length > 0) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} approach interval's ${equipmentEnd} attachment to equipment "${iv.equipmentId}" does not resolve to a real connection face.`,
          ),
        );
        continue;
      }
      // ...and at its serving rack exit: the other interval end is
      // at the rack (inside its footprint) or on rack travel.
      const otherStation = equipmentEnd === "start" ? iv.toStationIn : iv.fromStationIn;
      const otherPt = pointAtStation(route, otherStation);
      const footprint = rackFootprint(design, iv.rackId);
      const atRackExit = otherPt && pointInRackFootprint(footprint, otherPt);
      const adjacentTravel = sorted.some(
        (other) =>
          other !== iv &&
          other.role === "RACK_TRAVEL" &&
          other.rackId === iv.rackId &&
          (Math.abs(other.fromStationIn - otherStation) <= EPS || Math.abs(other.toStationIn - otherStation) <= EPS),
      );
      if (!atRackExit && !adjacentTravel) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} approach interval ${iv.fromStationIn}–${iv.toStationIn} in does not reach its serving rack "${iv.rackId}" exit; an approach runs equipment to rack exit.`,
          ),
        );
      }
    }
    if (iv.role === "SHORT_INTERCONNECT") {
      if (typeof iv.basis !== "string" || iv.basis.trim() === "") {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} short-interconnect interval ${iv.fromStationIn}–${iv.toStationIn} in has no authored applicability basis.`,
          ),
        );
      }
      const startOk = run.attachments?.start && attachmentInterfaceErrors(design, run, "start").length === 0;
      const endOk = run.attachments?.end && attachmentInterfaceErrors(design, run, "end").length === 0;
      if (!startOk || !endOk) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} short-interconnect interval does not bind two attached equipment interfaces; both ends must be on owned flange faces.`,
          ),
        );
      } else if (run.attachments.start.symbolId === run.attachments.end.symbolId) {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} short-interconnect interval binds two ends on the same equipment "${run.attachments.start.symbolId}"; an interconnect binds two equipment interfaces.`,
          ),
        );
      }
    }
    if (iv.role === "BURIED_FIREWATER") {
      if (run.utility !== undefined && run.utility !== null && run.utility !== "firewater") {
        findings.push(
          finding(
            SUPPORT_CODES.ROUTE_CLASSIFICATION_UNVERIFIED,
            runId,
            `Pipe run ${runId} buried-firewater interval is on a ${run.utility} run, not a firewater run.`,
          ),
        );
        continue;
      }
      // The interval portion must be actually buried: sample its
      // endpoints and vertices; every elevation below grade.
      const fromPt = pointAtStation(route, iv.fromStationIn);
      const toPt = pointAtStation(route, iv.toStationIn);
      const buried =
        (fromPt?.zIn ?? 0) < 0 &&
        (toPt?.zIn ?? 0) < 0 &&
        route
          .filter((_, i) => {
            const s = stations[i]?.stationIn ?? 0;
            return s >= iv.fromStationIn - EPS && s <= iv.toStationIn + EPS;
          })
          .every((p) => p.zIn < 0);
      if (!buried) {
        findings.push(
          finding(
            SUPPORT_CODES.BURIED_CLAIM_UNVERIFIED,
            runId,
            `Pipe run ${runId} buried-firewater interval ${iv.fromStationIn}–${iv.toStationIn} in is not below grade along its length; a buried claim needs buried geometry.`,
          ),
        );
      }
    }
  }
  // Renamed travel is caught by the per-interval rack-exit check
  // above, not by a blanket rule: a route of approaches is legitimate
  // when every approach terminates at its named equipment and its
  // serving rack exit (equipment → rack exit → equipment legs). There
  // is no universal length threshold to distinguish "long travel"
  // from "long approach", and the digest claims none — so no
  // all-approach heuristic is applied here.
  return { state: findings.length === 0 ? "PASS" : findings[0].code, findings };
}

// ---- O2: transitions and concentrated loads (brief item 4) --------------

/** Single-axis direction of one leg, or null for diagonal/degenerate legs. */
function legDirection(a, b) {
  const leg = classifyLeg(a, b);
  if (leg.kind !== "axis" && leg.kind !== "vertical") return null;
  const axis = leg.changed[0];
  const delta = axis === "x" ? b.x - a.x : axis === "y" ? b.y - a.y : b.zIn - a.zIn;
  return { axis, sign: Math.sign(delta) };
}

/** Interior vertices where the route changes direction or elevation. */
export function transitionVertices(design, run) {
  const route = physicalRouteIn(design, run);
  const out = [];
  for (let i = 1; i + 1 < route.length; i += 1) {
    const d0 = legDirection(route[i - 1], route[i]);
    const d1 = legDirection(route[i], route[i + 1]);
    if (!d0 || !d1) continue;
    if (d0.axis !== d1.axis || d0.sign !== d1.sign) {
      out.push({
        vertexIndex: i,
        kind: d0.axis === "z" || d1.axis === "z" ? "elevation" : "direction",
        point: route[i],
      });
    }
  }
  return out;
}

/** Vertical legs (risers): consecutive vertices, same plan, different elevation. */
export function verticalLegs(design, run) {
  const { stations, route } = routeStations(design, run);
  const out = [];
  for (let i = 0; i + 1 < route.length; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    if (
      Math.abs(b.x - a.x) <= ROUTE_AXIS_EPSILON_IN &&
      Math.abs(b.y - a.y) <= ROUTE_AXIS_EPSILON_IN &&
      Math.abs(b.zIn - a.zIn) > ROUTE_AXIS_EPSILON_IN
    ) {
      out.push({
        legIndex: i,
        fromVertex: i,
        toVertex: i + 1,
        fromStationIn: stations[i].stationIn,
        toStationIn: stations[i + 1].stationIn,
        lengthIn: Math.abs(b.zIn - a.zIn),
      });
    }
  }
  return out;
}

/**
 * O2 transition/load verification (brief item 4; digest §3.8). Every
 * direction/elevation change needs a support immediately adjacent in
 * the modeled fitting assembly: a weight-carrying support bound to
 * the transition vertex by index, whose contact station sits within
 * the transition-adjacency tolerance of the transition station, with
 * a verified carrier. A remote support never counts because it sits
 * inside a span maximum, and a trunnion/bracket that transfers
 * weight through real geometry counts only when its contact point is
 * at the elbow (the binding) — the index alone proves nothing.
 * Heavy valves and flanged assemblies need an adjacent scheduled
 * load support bound by valve index AND station, or flange station;
 * distributed-load spans do not clear concentrated loads. A valve
 * station with no authored route station is explicitly unverified.
 */
export function validateTransitionSupports(design, run) {
  const runId = run?.id ?? "(unknown)";
  if (!Array.isArray(run?.points) || run.points.length < 2) {
    return { state: "NOT_APPLICABLE", findings: [] };
  }
  const { stations, totalIn, route } = routeStations(design, run);
  const { contacts, findings } = classifySupports(design, run, route, totalIn);
  const transitions = transitionVertices(design, run);
  for (const t of transitions) {
    const station = stations[t.vertexIndex]?.stationIn;
    // Adjacency is geometry, not a label: the bound support's
    // contact station must sit within the transition-adjacency
    // tolerance of the transition station. An index match at a
    // remote station is a remote support and does not count.
    const bound =
      isFiniteNumber(station) &&
      contacts.find(
        (c) => c.transitionIndex === t.vertexIndex && Math.abs(c.stationIn - station) <= TRANSITION_ADJACENCY_IN,
      );
    if (!bound) {
      const remote = contacts.find((c) => c.transitionIndex === t.vertexIndex);
      findings.push(
        finding(
          SUPPORT_CODES.TRANSITION_SUPPORT_MISSING,
          runId,
          remote
            ? `Pipe run ${runId} ${t.kind} change at vertex ${t.vertexIndex} (station ${station} in) has a support bound by index at station ${remote.stationIn} in, ${Math.abs(remote.stationIn - station).toFixed(3)} in away — outside the ${TRANSITION_ADJACENCY_IN}-in transition-adjacency tolerance; the index alone does not prove adjacency.`
            : `Pipe run ${runId} ${t.kind} change at vertex ${t.vertexIndex} has no adjacent support bound to the transition; ` +
                `a remote support inside a span maximum does not count.`,
          { vertexIndex: t.vertexIndex, kind: t.kind, stationIn: station },
        ),
      );
    }
  }
  // Concentrated loads: valve stations (by index) and mid-route
  // flange stations (by station; end flanges are the nozzle rule's).
  const valves = Array.isArray(run.valveStations) ? run.valveStations : [];
  valves.forEach((valve, index) => {
    // Valve stations carry no route station in the current schema
    // (pipeRoutingRules: { parallelTo, operatorSide } only), so an
    // index-only binding cannot prove adjacency: the result is
    // explicitly unverified, never a pass on the label alone. When a
    // station IS authored, the load support must match it by index
    // AND by its actual contact station — the geometry, not the
    // loadRef label. loadRef.stationIn is descriptive only: a
    // bracket physically at station 150 that claims station 100
    // does not clear a valve at 100, and a bracket at 100 clears
    // it even when its label claims another station.
    const station = isPlainObject(valve) ? valve.stationIn : undefined;
    if (!isFiniteNumber(station)) {
      findings.push(
        finding(
          SUPPORT_CODES.CONCENTRATED_LOAD_UNVERIFIED,
          runId,
          `Pipe run ${runId} valve station ${index} is a concentrated load with no authored route station; adjacency of any load support cannot verify — the valve index alone proves nothing.`,
          { loadKind: "valve", index },
        ),
      );
      return;
    }
    const bound = contacts.find(
      (c) =>
        isPlainObject(c.loadRef) &&
        c.loadRef.kind === "valve" &&
        c.loadRef.index === index &&
        Math.abs(c.stationIn - station) <= TRANSITION_ADJACENCY_IN,
    );
    if (!bound) {
      findings.push(
        finding(
          SUPPORT_CODES.CONCENTRATED_LOAD_UNSUPPORTED,
          runId,
          `Pipe run ${runId} valve station ${index} at ${station} in is a concentrated load with no adjacent scheduled load support; distributed-load spans do not clear it.`,
          { loadKind: "valve", index, stationIn: station },
        ),
      );
    }
  });
  const flanges = Array.isArray(run.flangeStations) ? run.flangeStations : [];
  flanges.forEach((flange, index) => {
    if (!isPlainObject(flange) || !isFiniteNumber(flange.stationIn)) return;
    if (flange.stationIn <= FACE || flange.stationIn >= totalIn - FACE) return;
    // Same rule as the valve binding above: the load support clears
    // a flange only when its actual contact station sits within the
    // adopted tolerance of the flange station. loadRef.stationIn is
    // descriptive only — a remote bracket that claims the flange
    // station does not clear it.
    const bound = contacts.find(
      (c) =>
        isPlainObject(c.loadRef) &&
        c.loadRef.kind === "flange" &&
        Math.abs(c.stationIn - flange.stationIn) <= FACE,
    );
    if (!bound) {
      findings.push(
        finding(
          SUPPORT_CODES.CONCENTRATED_LOAD_UNSUPPORTED,
          runId,
          `Pipe run ${runId} flanged assembly at ${flange.stationIn} in (station ${index}) is a concentrated load with no adjacent scheduled load support.`,
          { loadKind: "flange", stationIn: flange.stationIn },
        ),
      );
    }
  });
  if (findings.length > 0) return { state: findings[0].code, findings };
  if (transitions.length === 0 && valves.length === 0 && flanges.filter((f) => isPlainObject(f) && isFiniteNumber(f.stationIn) && f.stationIn > FACE && f.stationIn < totalIn - FACE).length === 0) {
    return { state: "NOT_APPLICABLE", findings };
  }
  return { state: "PASS", findings };
}

// ---- Nozzle ends and risers (brief item 5) ------------------------------

/** Maximum riser guide interval (in) for a nominal size, or null when unadopted. */
export function riserGuideIntervalInFor(sizeIn, options = {}) {
  const resolved = resolveRiserGuideInterval(sizeIn, options);
  return resolved.ok ? resolved.intervalIn : null;
}

/**
 * Nozzle/riser verification (brief item 5; digest §3.7, §3.10). A
 * nozzle never carries pipe weight: the last support before an
 * attached nozzle comes from the authored schedule, and the named
 * support must be the actual last weight support before that end.
 * Vertical runs need independent riser supports — each bracket rated
 * for an authored maximum length of water-filled pipe, collectively
 * carrying the leg — plus guides at the digest §3.10 intervals.
 */
export function validateNozzleSupports(design, run) {
  const runId = run?.id ?? "(unknown)";
  if (!Array.isArray(run?.points) || run.points.length < 2) {
    return { state: "NOT_APPLICABLE", findings: [] };
  }
  const { totalIn, route } = routeStations(design, run);
  const { contacts, findings } = classifySupports(design, run, route, totalIn);
  let applicable = false;
  // Nozzle ends: the authored last support before each attached end.
  for (const end of ENDS) {
    if (!run.attachments?.[end]) continue;
    applicable = true;
    const named = run.nozzleSupports?.[end]?.supportId;
    if (typeof named !== "string" || named === "") {
      findings.push(
        finding(
          SUPPORT_CODES.NOZZLE_SUPPORT_UNVERIFIED,
          runId,
          `Pipe run ${runId} ${end} end is attached to a nozzle with no authored last support; the last-support arrangement comes from the support schedule, not a fabricated tail.`,
          { end },
        ),
      );
      continue;
    }
    const support = contacts.find((c) => c.id === named);
    if (!support) {
      const exists = (run.supports || []).some((s) => s?.id === named);
      findings.push(
        finding(
          SUPPORT_CODES.NOZZLE_SUPPORT_UNRESOLVED,
          runId,
          exists
            ? `Pipe run ${runId} ${end} nozzle schedule names support "${named}" which is not a verified weight-carrying support.`
            : `Pipe run ${runId} ${end} nozzle schedule names support "${named}" which does not exist on this run.`,
          { end, supportId: named },
        ),
      );
      continue;
    }
    const closer = contacts.find((c) =>
      end === "start"
        ? c.stationIn < support.stationIn - EPS
        : c.stationIn > support.stationIn + EPS,
    );
    if (closer) {
      findings.push(
        finding(
          SUPPORT_CODES.NOZZLE_SUPPORT_NOT_LAST,
          runId,
          `Pipe run ${runId} ${end} nozzle schedule names support "${named}" at ${support.stationIn} in, but weight support "${closer.id}" at ${closer.stationIn} in is closer to the nozzle; the schedule must name the actual last support.`,
          { end, supportId: named },
        ),
      );
    }
  }
  // Risers: independent weight supports plus guides.
  const legs = verticalLegs(design, run);
  const sizeIn = run.spanProfile?.nominalSizeIn ?? run.diameterIn;
  for (const leg of legs) {
    applicable = true;
    const bound = contacts.filter(
      (c) => c.type === "riser-support" && c.verticalLegIndex === leg.legIndex,
    );
    if (bound.length === 0) {
      findings.push(
        finding(
          SUPPORT_CODES.RISER_SUPPORT_UNVERIFIED,
          runId,
          `Pipe run ${runId} vertical leg ${leg.legIndex} (${leg.lengthIn} in) has no scheduled riser support; a vertical run is supported independently, never hung off the horizontal pipe it connects to.`,
          { legIndex: leg.legIndex },
        ),
      );
    } else {
      const unrated = bound.filter((c) => !isFiniteNumber(c.maxSupportedLengthIn));
      if (unrated.length > 0) {
        findings.push(
          finding(
            SUPPORT_CODES.RISER_SUPPORT_UNVERIFIED,
            runId,
            `Pipe run ${runId} riser support "${unrated[0].id}" on vertical leg ${leg.legIndex} has no authored maximum supported length; unknown bracket capacity remains unverified.`,
            { legIndex: leg.legIndex },
          ),
        );
      } else {
        const capacity = bound.reduce((sum, c) => sum + c.maxSupportedLengthIn, 0);
        if (leg.lengthIn > capacity + 1e-9) {
          findings.push(
            finding(
              SUPPORT_CODES.RISER_SUPPORT_INSUFFICIENT,
              runId,
              `Pipe run ${runId} vertical leg ${leg.legIndex} is ${leg.lengthIn} in of water-filled pipe but its riser brackets are rated for ${capacity} in in total.`,
              { legIndex: leg.legIndex, lengthIn: leg.lengthIn, capacityIn: capacity },
            ),
          );
        }
      }
    }
    // Guides on the leg, at the digest §3.10 profile intervals.
    const guides = [];
    for (const r of run?.restraints || []) {
      if (!isPlainObject(r) || r.type !== "guide" || !isFiniteNumber(r.stationIn)) continue;
      if (r.stationIn < leg.fromStationIn - EPS || r.stationIn > leg.toStationIn + EPS) continue;
      const point = pointAtStation(route, r.stationIn);
      const carrier = verifyCarrier(design, r.carrier, point);
      if (!carrier.ok) {
        findings.push(
          finding(
            SUPPORT_CODES.SUPPORT_CARRIER_UNVERIFIED,
            runId,
            `Pipe run ${runId} riser guide at ${r.stationIn} in has no verified carrier: ${carrier.reason}.`,
          ),
        );
        continue;
      }
      guides.push(r.stationIn);
    }
    guides.sort((a, b) => a - b);
    if (guides.length === 0) {
      findings.push(
        finding(
          SUPPORT_CODES.GUIDE_NOT_SCHEDULED,
          runId,
          `Pipe run ${runId} vertical leg ${leg.legIndex} has no scheduled guide; vertical runs are guided, not just weight-supported.`,
          { legIndex: leg.legIndex },
        ),
      );
    } else {
      // D10-06 Ruling 1: the named cap profile is read off the run
      // (run.guideProfile) — the resolver's provenance labels the
      // finding so a cap-resolved interval is never presented as a
      // digest-sourced interval.
      const resolved = resolveRiserGuideInterval(sizeIn, { guideProfile: run.guideProfile });
      if (!resolved.ok) {
        findings.push(
          finding(
            SUPPORT_CODES.GUIDE_PROFILE_UNVERIFIED,
            runId,
            `Pipe run ${runId} size ${sizeIn} in has no adopted riser guide interval: ${resolved.reason}.`,
            { legIndex: leg.legIndex },
          ),
        );
      } else {
        const interval = resolved.intervalIn;
        const provenance =
          resolved.source === "reviewer-adopted-cap"
            ? "reviewer-adopted interim cap (the digest's published 10-in maximum retained as a conservative cap, not a sourced interval for this size)"
            : "digest §3.10";
        const stops = [leg.fromStationIn, ...guides, leg.toStationIn];
        for (let i = 0; i + 1 < stops.length; i += 1) {
          const gap = stops[i + 1] - stops[i];
          if (gap > interval + 1e-9) {
            findings.push(
              finding(
                SUPPORT_CODES.GUIDE_INTERVAL_EXCEEDED,
                runId,
                `Pipe run ${runId} vertical leg ${leg.legIndex} has a ${gap.toFixed(3)}-in guide gap; the ${sizeIn}-in maximum guide interval is ${interval} in (${provenance}).`,
                { legIndex: leg.legIndex, gapIn: gap, maxIn: interval },
              ),
            );
            break;
          }
        }
      }
    }
  }
  if (findings.length > 0) return { state: findings[0].code, findings };
  if (!applicable) return { state: "NOT_APPLICABLE", findings };
  return { state: "PASS", findings };
}

// ---- O3: pair spacing (brief item 6) ------------------------------------

/**
 * Required center-to-center distance (in) between two runs, from
 * validated OD, insulation, the selected gap profile and authored
 * expansion allowances. The expansion allowance of each line adds
 * to the required envelope (each line may move toward the other).
 * Returns { ok, requiredIn, gapIn } or { ok: false, reason }.
 */
export function requiredPairCenters(runA, runB, options = {}) {
  const missing = [];
  const odA = runA?.outsideDiameterIn;
  const odB = runB?.outsideDiameterIn;
  if (!isFiniteNumber(odA)) missing.push(`run ${runA?.id ?? "(unknown)"} outside diameter`);
  if (!isFiniteNumber(odB)) missing.push(`run ${runB?.id ?? "(unknown)"} outside diameter`);
  const insA = runA?.insulationIn;
  const insB = runB?.insulationIn;
  if (!isFiniteNumber(insA)) missing.push(`run ${runA?.id ?? "(unknown)"} insulation`);
  if (!isFiniteNumber(insB)) missing.push(`run ${runB?.id ?? "(unknown)"} insulation`);
  const expA = runA?.expansionAllowanceIn;
  const expB = runB?.expansionAllowanceIn;
  if (!isFiniteNumber(expA)) missing.push(`run ${runA?.id ?? "(unknown)"} expansion allowance`);
  if (!isFiniteNumber(expB)) missing.push(`run ${runB?.id ?? "(unknown)"} expansion allowance`);
  if (missing.length > 0) {
    return { ok: false, reason: `unknown ${missing.join("; ")}` };
  }
  const sizeA = runA?.spanProfile?.nominalSizeIn ?? runA?.diameterIn;
  const sizeB = runB?.spanProfile?.nominalSizeIn ?? runB?.diameterIn;
  if (odA < sizeA - EPS || odB < sizeB - EPS) {
    return {
      ok: false,
      reason: `outside diameter ${odA} in / ${odB} in is below nominal bore ${sizeA} in / ${sizeB} in; nominal bore is not OD`,
      invalid: true,
    };
  }
  const profile = options.spacingProfile ?? null;
  let gapIn;
  if (profile !== null) {
    if (!(profile in SPACING_GAP_IN)) return { ok: false, reason: `unknown spacing profile "${profile}"` };
    gapIn = SPACING_GAP_IN[profile];
  } else if (runA?.spacingProfile === "largest-line" || runB?.spacingProfile === "largest-line") {
    gapIn = SPACING_GAP_IN["largest-line"];
  } else if (runA?.spacingProfile === "ordinary" && runB?.spacingProfile === "ordinary") {
    gapIn = SPACING_GAP_IN.ordinary;
  } else {
    return {
      ok: false,
      reason: "no spacing-profile assignment: the largest-line classification is explicit and source-linked, never an invented diameter cutoff",
    };
  }
  const requiredIn = odA / 2 + insA + (odB / 2 + insB) + gapIn + expA + expB;
  return { ok: true, requiredIn, gapIn, effectiveRadiusAIn: odA / 2 + insA, effectiveRadiusBIn: odB / 2 + insB };
}

/**
 * Whether one segment pair meets at a verified junction contact —
 * the contact point lies on both segments (within the face
 * tolerance) and the pair is a takeoff, not a duplicate route. A
 * collinear overlap beyond the face is not a junction: two runs
 * sharing more than a face of route still fail pair spacing, as do
 * two branches claiming one physical face with no direct junction
 * between them. A zero-plan leg (a riser leaving the host upward)
 * leaves no plan overlap, so it is a takeoff.
 *
 * This answers only "the pair meets at the junction". It grants no
 * exemption by itself: the caller limits the exemption to the
 * contact neighborhood (fix round 1, P1 — Ruling 2 item 4) by
 * clipping both segments to the ball of radius = required centers
 * around the verified contact and evaluating the remainders. A
 * non-parallel pair is a junction at the contact, never proof the
 * rest of the pair is clear.
 */
function segmentPairIsJunctionContact(a1, a2, b1, b2, contact) {
  if (pointSegmentDistance(contact, a1, a2).distance > FACE) return false;
  if (pointSegmentDistance(contact, b1, b2).distance > FACE) return false;
  const dAx = a2.x - a1.x;
  const dAy = a2.y - a1.y;
  const dBx = b2.x - b1.x;
  const dBy = b2.y - b1.y;
  const lenA = Math.hypot(dAx, dAy);
  const lenB = Math.hypot(dBx, dBy);
  if (lenA <= EPS || lenB <= EPS) return true;
  const cross = Math.abs(dAx * dBy - dAy * dBx) / (lenA * lenB);
  if (cross > 1e-9) return true;
  // Parallel: project both onto A's direction and measure the
  // shared length — beyond one face of overlap it is a duplicate
  // route, not a junction.
  const ux = dAx / lenA;
  const uy = dAy / lenA;
  const proj = (p) => (p.x - a1.x) * ux + (p.y - a1.y) * uy;
  const bLo = Math.min(proj(b1), proj(b2));
  const bHi = Math.max(proj(b1), proj(b2));
  const overlap = Math.min(lenA, bHi) - Math.max(0, bLo);
  return overlap <= FACE + 1e-9;
}

/**
 * The portions of one 3D segment outside a plan ball around a
 * contact point, as { a, b } sub-segments with zIn interpolated
 * linearly along the segment. The ball is plan-only (x, y): a
 * vertical riser has no plan extent, so it is inside the ball iff
 * its plan point is. Returns [] when the whole segment lies inside
 * the ball. A tangent touch does not split the segment.
 */
function clipSegmentOutsideBall(p1, p2, center, radiusIn) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.zIn - p1.zIn;
  const wx = p1.x - center.x;
  const wy = p1.y - center.y;
  const a = dx * dx + dy * dy;
  const radius2 = radiusIn * radiusIn;
  if (a <= 1e-12) {
    return wx * wx + wy * wy < radius2 ? [] : [{ a: p1, b: p2 }];
  }
  const b = 2 * (dx * wx + dy * wy);
  const c = wx * wx + wy * wy - radius2;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) {
    // No crossing (or a tangent): entirely inside when c < 0.
    return c < 0 ? [] : [{ a: p1, b: p2 }];
  }
  const sq = Math.sqrt(disc);
  const tLo = Math.max(0, (-b - sq) / (2 * a));
  const tHi = Math.min(1, (-b + sq) / (2 * a));
  if (tHi <= 0 || tLo >= 1 || tHi <= tLo) {
    // The ball misses the segment: the whole segment is outside.
    return [{ a: p1, b: p2 }];
  }
  const at = (t) => ({ x: p1.x + t * dx, y: p1.y + t * dy, zIn: p1.zIn + t * dz });
  const out = [];
  if (tLo > 1e-12) out.push({ a: p1, b: at(tLo) });
  if (tHi < 1 - 1e-12) out.push({ a: at(tHi), b: p2 });
  return out;
}

/** A segment with every contact ball removed, in order. */
function clipSegmentOutsideBalls(p1, p2, centers, radiusIn) {
  let parts = [{ a: p1, b: p2 }];
  for (const center of centers) {
    parts = parts.flatMap((part) => clipSegmentOutsideBall(part.a, part.b, center, radiusIn));
  }
  return parts;
}

/**
 * The ordinary relation classifier for one segment pair: a true plan
 * crossing resolved by elevation uses the crossing rule (actual
 * envelopes + 1 in); every other pair is side-by-side and keeps O3
 * (3D closest approach against required centers). Returns
 * { findings, minCenter }.
 */
function evaluateSegmentPairSpacing(a1, a2, b1, b2, req, runA, runB, runId) {
  const findings = [];
  let minCenter = Infinity;
  const hit = properIntersection(a1, a2, b1, b2);
  if (hit) {
    const elevA = a1.zIn + hit.t * (a2.zIn - a1.zIn);
    const elevB = b1.zIn + hit.u * (b2.zIn - b1.zIn);
    const sep = Math.abs(elevA - elevB);
    const required = req.effectiveRadiusAIn + req.effectiveRadiusBIn + CROSSING_CLEARANCE_IN;
    minCenter = Math.min(minCenter, sep);
    if (sep < required - 1e-9) {
      findings.push(
        finding(
          SUPPORT_CODES.SPACING_TOO_CLOSE,
          runId,
          `Pipe runs ${runA.id} / ${runB.id} cross at (${Math.round(hit.x)}, ${Math.round(hit.y)}) with ${sep.toFixed(3)} in of vertical separation; ` +
            `the crossing needs ${required.toFixed(3)} in (effective radii ${req.effectiveRadiusAIn.toFixed(3)}/${req.effectiveRadiusBIn.toFixed(3)} in + ${CROSSING_CLEARANCE_IN} in clear).`,
          { requiredIn: required, actualIn: sep },
        ),
      );
    }
    return { findings, minCenter };
  }
  // Side-by-side: the 3D closest approach against O3 centers.
  const closest = closestSegSegPoints(a1, a2, b1, b2);
  minCenter = Math.min(minCenter, closest.distance);
  if (closest.distance < req.requiredIn - 1e-9) {
    findings.push(
      finding(
        SUPPORT_CODES.SPACING_TOO_CLOSE,
        runId,
        `Pipe runs ${runA.id} / ${runB.id} are ${closest.distance.toFixed(3)} in apart center-to-center; ` +
          `the required centers are ${req.requiredIn.toFixed(3)} in (OD ${runA.outsideDiameterIn}/${runB.outsideDiameterIn} in, ` +
          `insulation ${runA.insulationIn}/${runB.insulationIn} in, gap ${req.gapIn} in, expansion ${runA.expansionAllowanceIn}/${runB.expansionAllowanceIn} in).`,
        { requiredIn: req.requiredIn, actualIn: closest.distance },
      ),
    );
  }
  return { findings, minCenter };
}

/**
 * O3 pair spacing (brief item 6; digest §2.2–2.3). D10-06 Ruling 2:
 * segment pairs are classified before any clearance is applied.
 * A pair meeting at a verified junction contact is a junction —
 * only the contact neighborhood is omitted, and only for the
 * segment pairs that actually meet there. A true perpendicular /
 * oblique plan crossing resolved by elevation uses the crossing
 * rule (actual envelopes + 1 in, owned by pipeCrossings.js) with
 * no added 3/4-in rack gap. Every other pair is side-by-side and
 * keeps O3 (centers >= effective radii + selected gap + authored
 * expansion). A pair with one valid crossing is not exempt
 * everywhere: its other segment pairs still satisfy their own
 * relation's rule. Missing relation/topology/envelope evidence
 * fails closed upstream (requiredPairCenters) — it never silently
 * becomes a crossing or junction exemption. At a flange station
 * the governing check is flange radius + adjacent effective pipe
 * radius + 1 in, or flange/flange + 1 in where the stations
 * overlap; the governing maximum of pipe and fitting checks rules.
 * Runs joined by a verified junction whose whole interaction is
 * the junction are not a spacing pair.
 */
export function validatePairSpacing(design, runA, runB, options = {}) {
  const runId = `${runA?.id ?? "(unknown)"}/${runB?.id ?? "(unknown)"}`;
  if (!runA || !runB || runA.id === runB.id) return { state: "NOT_APPLICABLE", findings: [] };
  if (!Array.isArray(runA.points) || runA.points.length < 2 || !Array.isArray(runB.points) || runB.points.length < 2) {
    return { state: "NOT_APPLICABLE", findings: [] };
  }
  const req = requiredPairCenters(runA, runB, options);
  if (!req.ok) {
    const code = req.invalid ? SUPPORT_CODES.SPACING_DATA_INVALID : SUPPORT_CODES.SPACING_PROFILE_UNVERIFIED;
    return {
      state: code,
      findings: [
        finding(
          code,
          runId,
          `Pipe runs ${runA.id} / ${runB.id} spacing is unverified: ${req.reason}.`,
        ),
      ],
    };
  }
  const routeA = physicalRouteIn(design, runA);
  const routeB = physicalRouteIn(design, runB);
  const findings = [];
  let governingIn = req.requiredIn;
  // Verified junction contacts between exactly these two runs.
  // Same-host labels with no validated common geometry yield no
  // contacts here, so they exempt nothing.
  const contacts = validatedContactPoints(design, runA, runB);
  let evaluatedPairs = 0;
  let minCenter = Infinity;
  for (let i = 0; i + 1 < routeA.length; i += 1) {
    for (let j = 0; j + 1 < routeB.length; j += 1) {
      const a1 = routeA[i];
      const a2 = routeA[i + 1];
      const b1 = routeB[j];
      const b2 = routeB[j + 1];
      // Junction: this segment pair meets at a verified contact. The
      // exemption covers only the contact neighborhood (fix round 1,
      // P1 — Ruling 2 item 4): both segments are clipped to the ball
      // of radius = required centers around each verified contact,
      // and the remaining portions are evaluated under the ordinary
      // classifier. Inside that ball the branch cannot have diverged
      // beyond the required envelope — any point within the required
      // centers of the contact is within the required centers of the
      // host — so no measurement there is meaningful; a shallow-angle
      // branch that stays inside O3 beyond the ball is measured and
      // fails. When every remainder passes, the pair's whole
      // interaction is the junction and it is skipped exactly as
      // before.
      const meeting = contacts.filter((c) => segmentPairIsJunctionContact(a1, a2, b1, b2, c));
      if (meeting.length > 0) {
        const subA = clipSegmentOutsideBalls(a1, a2, meeting, req.requiredIn);
        const subB = clipSegmentOutsideBalls(b1, b2, meeting, req.requiredIn);
        const remainder = [];
        let remainderMin = Infinity;
        for (const sa of subA) {
          for (const sb of subB) {
            const out = evaluateSegmentPairSpacing(sa.a, sa.b, sb.a, sb.b, req, runA, runB, runId);
            remainder.push(...out.findings);
            remainderMin = Math.min(remainderMin, out.minCenter);
          }
        }
        if (remainder.length === 0) continue;
        findings.push(...remainder);
        minCenter = Math.min(minCenter, remainderMin);
        evaluatedPairs += 1;
        continue;
      }
      evaluatedPairs += 1;
      const out = evaluateSegmentPairSpacing(a1, a2, b1, b2, req, runA, runB, runId);
      findings.push(...out.findings);
      minCenter = Math.min(minCenter, out.minCenter);
    }
  }
  if (evaluatedPairs === 0) {
    // Every segment pair meets at a verified junction contact: the
    // pair's whole interaction is the junction.
    return { state: "NOT_APPLICABLE", findings: [] };
  }
  // Flange stations: flange radius + adjacent effective radius + 1 in,
  // or flange/flange + 1 in where the stations overlap.
  const checkFlanges = (runX, routeX, runY, routeY) => {
    const flangesX = Array.isArray(runX.flangeStations) ? runX.flangeStations : [];
    const flangesY = Array.isArray(runY.flangeStations) ? runY.flangeStations : [];
    for (const flange of flangesX) {
      if (!isPlainObject(flange) || !isFiniteNumber(flange.stationIn) || !isFiniteNumber(flange.flangeRadiusIn)) {
        findings.push(
          finding(
            SUPPORT_CODES.SPACING_PROFILE_UNVERIFIED,
            runId,
            `Pipe run ${runX.id} has a flange station without a validated flange radius; unknown flange size is unverified.`,
          ),
        );
        continue;
      }
      const point = pointAtStation(routeX, flange.stationIn);
      const closest = closestPointOnRoute(routeY, point);
      if (!closest) continue;
      const overlapping = flangesY.find(
        (other) => isPlainObject(other) && isFiniteNumber(other.stationIn) && Math.abs(other.stationIn - closest.stationIn) <= FACE && isFiniteNumber(other.flangeRadiusIn),
      );
      // Both lines' authored expansion allowances add to the fitting
      // envelope, exactly as they add to the ordinary pipe envelope
      // above: each line may move toward the other. (Expansion values
      // are finite here — requiredPairCenters already refused the
      // pair when either is unknown.)
      const required = overlapping
        ? flange.flangeRadiusIn + overlapping.flangeRadiusIn + FLANGE_GAP_IN + runX.expansionAllowanceIn + runY.expansionAllowanceIn
        : flange.flangeRadiusIn + (runY.outsideDiameterIn / 2 + runY.insulationIn) + FLANGE_GAP_IN + runX.expansionAllowanceIn + runY.expansionAllowanceIn;
      if (required > governingIn) {
        governingIn = required;
      }
      if (closest.distance < required - 1e-9) {
        findings.push(
          finding(
            SUPPORT_CODES.SPACING_TOO_CLOSE,
            runId,
            overlapping
              ? `Pipe runs ${runX.id} / ${runY.id} flange stations overlap at ${closest.distance.toFixed(3)} in apart; overlapping flange envelopes need ${required.toFixed(3)} in (flange radii ${flange.flangeRadiusIn}/${overlapping.flangeRadiusIn} in + ${FLANGE_GAP_IN} in clear + expansion ${runX.expansionAllowanceIn}/${runY.expansionAllowanceIn} in).`
              : `Pipe run ${runX.id} flange at ${flange.stationIn} in is ${closest.distance.toFixed(3)} in from run ${runY.id}; the flange envelope needs ${required.toFixed(3)} in (flange radius ${flange.flangeRadiusIn} in + adjacent effective radius ${(runY.outsideDiameterIn / 2 + runY.insulationIn).toFixed(3)} in + ${FLANGE_GAP_IN} in clear + expansion ${runX.expansionAllowanceIn}/${runY.expansionAllowanceIn} in).`,
            { requiredIn: required, actualIn: closest.distance },
          ),
        );
      }
    }
  };
  checkFlanges(runA, routeA, runB, routeB);
  checkFlanges(runB, routeB, runA, routeA);
  return {
    state: findings.length === 0 ? "PASS" : findings[0].code,
    findings,
    requiredIn: governingIn,
    actualMinIn: minCenter,
  };
}

// ---- Rack organization (brief item 7) -----------------------------------

/** Rack-travel lines on one rack: { run, interval } pairs. */
export function rackTravelLines(design, rackId) {
  const out = [];
  for (const run of design?.pipes || []) {
    for (const iv of run?.routeIntervals || []) {
      if (iv?.role === "RACK_TRAVEL" && iv?.rackId === rackId) out.push({ run, interval: iv });
    }
  }
  return out;
}

/**
 * Propose a tier for an overflowing line: the lowest-numbered tier
 * (other than the line's current tier) where the line fits at its
 * required pair spacing inside the rack width, or explicit
 * resize/add-rack review when no tier has room. Never silent
 * spillover, never an undeclared sixth tier.
 */
export function proposeTierOverflow(design, rackInstanceId, runId) {
  const found = rackInstanceById(design, rackInstanceId);
  if (!found) return { review: "rack-not-found" };
  const { params } = found;
  const line = rackTravelLines(design, rackInstanceId).find((l) => l.run.id === runId);
  if (!line) return { review: "line-not-on-rack" };
  const halfEnv = (line.run.outsideDiameterIn ?? 0) / 2 + (line.run.insulationIn ?? 0);
  if (!isFiniteNumber(line.run.outsideDiameterIn) || !isFiniteNumber(line.run.insulationIn)) {
    return { review: "spacing-unverified" };
  }
  const halfW = params.widthIn / 2;
  if (halfEnv > halfW) return { review: "resize-or-add-rack" };
  const lo = -halfW + halfEnv;
  const hi = halfW - halfEnv;
  for (let tier = 1; tier <= params.tiers; tier += 1) {
    if (tier === line.interval.tier) continue;
    const others = rackTravelLines(design, rackInstanceId).filter(
      (l) => l.interval.tier === tier && l.run.id !== runId,
    );
    const forbidden = [];
    let blocked = false;
    for (const other of others) {
      const req = requiredPairCenters(line.run, other.run);
      if (!req.ok) {
        blocked = true;
        break;
      }
      if (!isFiniteNumber(other.interval.rackOffsetIn)) {
        blocked = true;
        break;
      }
      forbidden.push([other.interval.rackOffsetIn - req.requiredIn, other.interval.rackOffsetIn + req.requiredIn]);
    }
    if (blocked) continue;
    forbidden.sort((a, b) => a[0] - b[0]);
    let cursor = lo;
    let fits = false;
    for (const [fLo, fHi] of forbidden) {
      if (fLo > cursor + EPS) {
        fits = true;
        break;
      }
      cursor = Math.max(cursor, fHi);
    }
    if (!fits && cursor <= hi + EPS) fits = true;
    if (fits) return { tier };
  }
  return { review: "resize-or-add-rack" };
}

/**
 * Stable rack-local longitudinal envelope for one rack-travel
 * interval (D10-06 Ruling 2, rack defect): the route portion
 * between the interval's stations projected onto the rack axis,
 * extended by the run's authored expansion allowance and by the
 * largest flange radius among flange stations inside the interval.
 * The extension is a conservative planning allowance — a fitting
 * or axial movement at the interval ends reaches that far along
 * the rack — never a claimed physical dimension. Returns
 * { ok, coreMinIn, coreMaxIn, alongMinIn, alongMaxIn } or
 * { ok: false, reason }: unknown interval geometry (missing
 * stations, stations outside the developed route, unknown
 * expansion, malformed flange data, unresolvable rack) fails
 * closed — the pair is never silently treated as non-overlapping.
 */
export function rackLongitudinalEnvelope(design, rackId, run, interval) {
  const footprint = rackFootprint(design, rackId);
  if (!footprint) return { ok: false, reason: `rack "${rackId}" does not resolve` };
  const from = interval?.fromStationIn;
  const to = interval?.toStationIn;
  if (!isFiniteNumber(from) || !isFiniteNumber(to) || from > to + 1e-9) {
    return {
      ok: false,
      reason: `pipe run ${run?.id ?? "(unknown)"} rack-travel interval has no usable station range`,
    };
  }
  const { stations, totalIn, route } = routeStations(design, run);
  if (!Array.isArray(route) || route.length < 2 || from < -1e-9 || to > totalIn + 1e-9) {
    return {
      ok: false,
      reason: `pipe run ${run?.id ?? "(unknown)"} rack-travel interval stations ${from}–${to} in lie outside the developed route (0–${totalIn} in)`,
    };
  }
  const points = [pointAtStation(route, from), pointAtStation(route, to)];
  for (const s of stations) {
    if (s.stationIn >= from - 1e-9 && s.stationIn <= to + 1e-9) points.push(s.point);
  }
  let coreMinIn = Infinity;
  let coreMaxIn = -Infinity;
  for (const point of points) {
    if (!point) continue;
    const along = toRackLocal(footprint, point).along;
    coreMinIn = Math.min(coreMinIn, along);
    coreMaxIn = Math.max(coreMaxIn, along);
  }
  if (!Number.isFinite(coreMinIn) || !Number.isFinite(coreMaxIn)) {
    return {
      ok: false,
      reason: `pipe run ${run?.id ?? "(unknown)"} rack-travel interval has no resolvable route portion`,
    };
  }
  if (!isFiniteNumber(run?.expansionAllowanceIn)) {
    return {
      ok: false,
      reason: `pipe run ${run?.id ?? "(unknown)"} has no authored expansion allowance for its rack envelope`,
    };
  }
  let fittingIn = 0;
  for (const flange of Array.isArray(run?.flangeStations) ? run.flangeStations : []) {
    if (!isPlainObject(flange)) {
      return {
        ok: false,
        reason: `pipe run ${run?.id ?? "(unknown)"} has a malformed flange station in its rack envelope`,
      };
    }
    if (!isFiniteNumber(flange.stationIn) || !isFiniteNumber(flange.flangeRadiusIn)) {
      return {
        ok: false,
        reason: `pipe run ${run?.id ?? "(unknown)"} has a flange station without a validated flange radius`,
      };
    }
    if (flange.stationIn >= from - 1e-9 && flange.stationIn <= to + 1e-9) {
      fittingIn = Math.max(fittingIn, flange.flangeRadiusIn);
    }
  }
  const ext = run.expansionAllowanceIn + fittingIn;
  return {
    ok: true,
    coreMinIn,
    coreMaxIn,
    alongMinIn: coreMinIn - ext,
    alongMaxIn: coreMaxIn + ext,
  };
}

/**
 * Rack organization (brief item 7; digest §2.4–2.7). Stable
 * rack-local coordinates (same-tier pairs at their required O3
 * centers), authored reserve and loop envelopes, guides/shoes as
 * scheduled, and tier separation from actual pipe/fitting/beam
 * envelopes. Overflow proposes another tier or explicit review.
 */
export function validateRackOrganization(design, rackInstanceId) {
  const runId = `rack:${rackInstanceId}`;
  const found = rackInstanceById(design, rackInstanceId);
  if (!found) {
    return {
      state: "RACK_NOT_FOUND",
      findings: [
        finding(SUPPORT_CODES.RACK_NOT_FOUND, runId, `Rack "${rackInstanceId}" is not a rack in the design.`),
      ],
    };
  }
  const { params } = found;
  const lines = rackTravelLines(design, rackInstanceId);
  if (lines.length === 0) return { state: "NOT_APPLICABLE", findings: [] };
  const findings = [];
  // Line data: tier and offset authored.
  for (const { run, interval } of lines) {
    if (!Number.isInteger(interval.tier) || interval.tier < 1 || interval.tier > params.tiers) {
      findings.push(
        finding(
          SUPPORT_CODES.RACK_LINE_UNVERIFIED,
          runId,
          `Pipe run ${run.id} on rack "${rackInstanceId}" names tier ${interval.tier}; the rack has ${params.tiers} tiers.`,
        ),
      );
    }
    if (!isFiniteNumber(interval.rackOffsetIn)) {
      findings.push(
        finding(
          SUPPORT_CODES.RACK_LINE_UNVERIFIED,
          runId,
          `Pipe run ${run.id} on rack "${rackInstanceId}" has no authored rack-local offset.`,
        ),
      );
    }
  }
  // Same-tier pairs at their required O3 centers — but only where
  // the pair actually travels concurrently: D10-06 gates the lateral
  // check on longitudinal envelope overlap, so end-to-end runs
  // sharing a lane are not overflow. Overlap confined to the
  // fitting/expansion margins at a verified connection face is a
  // touching face, not concurrency.
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i];
      const b = lines[j];
      if (a.interval.tier !== b.interval.tier) continue;
      if (!isFiniteNumber(a.interval.rackOffsetIn) || !isFiniteNumber(b.interval.rackOffsetIn)) continue;
      const req = requiredPairCenters(a.run, b.run);
      if (!req.ok) {
        findings.push(
          finding(
            SUPPORT_CODES.RACK_LINE_UNVERIFIED,
            runId,
            `Pipe runs ${a.run.id} / ${b.run.id} share tier ${a.interval.tier} of rack "${rackInstanceId}" but their pair spacing is unverified: ${req.reason}.`,
          ),
        );
        continue;
      }
      const envA = rackLongitudinalEnvelope(design, rackInstanceId, a.run, a.interval);
      const envB = rackLongitudinalEnvelope(design, rackInstanceId, b.run, b.interval);
      if (!envA.ok || !envB.ok) {
        findings.push(
          finding(
            SUPPORT_CODES.RACK_LINE_UNVERIFIED,
            runId,
            `Pipe runs ${a.run.id} / ${b.run.id} share tier ${a.interval.tier} of rack "${rackInstanceId}" but their longitudinal overlap is unverified: ${!envA.ok ? envA.reason : envB.reason}.`,
          ),
        );
        continue;
      }
      const overlapLo = Math.max(envA.alongMinIn, envB.alongMinIn);
      const overlapHi = Math.min(envA.alongMaxIn, envB.alongMaxIn);
      if (overlapLo >= overlapHi - 1e-9) continue;
      const coreOverlap =
        Math.max(envA.coreMinIn, envB.coreMinIn) < Math.min(envA.coreMaxIn, envB.coreMaxIn) - 1e-9;
      if (!coreOverlap) {
        const contacts = validatedContactPoints(design, a.run, b.run);
        const footprint = rackFootprint(design, rackInstanceId);
        const touching =
          footprint !== null &&
          contacts.some((c) => {
            const along = toRackLocal(footprint, c).along;
            return along >= overlapLo - FACE && along <= overlapHi + FACE;
          });
        if (touching) continue;
      }
      const actual = Math.abs(a.interval.rackOffsetIn - b.interval.rackOffsetIn);
      if (actual < req.requiredIn - 1e-9) {
        const proposal = proposeTierOverflow(design, rackInstanceId, b.run.id);
        findings.push(
          finding(
            SUPPORT_CODES.RACK_TIER_OVERFLOW,
            runId,
            `Pipe runs ${a.run.id} / ${b.run.id} sit ${actual.toFixed(3)} in apart on tier ${a.interval.tier} of rack "${rackInstanceId}"; ` +
              `their required centers are ${req.requiredIn.toFixed(3)} in. ` +
              (proposal.tier
                ? `Tier ${proposal.tier} has room — reassign, never silently spill over.`
                : `No tier has room: explicit resize or add-rack review is required.`),
            { tier: a.interval.tier, proposal },
          ),
        );
      }
    }
  }
  // Reserve: authored spare width, and the rack must actually hold it.
  const reserve = found.inst.rack?.reserve;
  const envelopes = lines.map(({ run }) => {
    if (!isFiniteNumber(run.outsideDiameterIn) || !isFiniteNumber(run.insulationIn)) return null;
    return { run, half: run.outsideDiameterIn / 2 + run.insulationIn };
  });
  if (!isPlainObject(reserve) || !isFiniteNumber(reserve.spareWidthIn)) {
    findings.push(
      finding(
        SUPPORT_CODES.RACK_RESERVE_UNVERIFIED,
        runId,
        `Rack "${rackInstanceId}" has no authored reserve width; a rack filled edge-to-edge with no spare width is a layout defect, and the reserve is authored, never an invented percentage.`,
      ),
    );
  } else if (reserve.spareWidthIn <= 0) {
    findings.push(
      finding(
        SUPPORT_CODES.RACK_RESERVE_EXCEEDED,
        runId,
        `Rack "${rackInstanceId}" reserve is ${reserve.spareWidthIn} in: no spare width is reserved for future lines.`,
      ),
    );
  } else if (envelopes.some((e) => e === null)) {
    findings.push(
      finding(
        SUPPORT_CODES.RACK_RESERVE_UNVERIFIED,
        runId,
        `Rack "${rackInstanceId}" reserve cannot be measured: a line on the rack has no validated OD/insulation envelope.`,
      ),
    );
  } else {
    let minEdge = Infinity;
    let maxEdge = -Infinity;
    for (let i = 0; i < lines.length; i += 1) {
      const off = lines[i].interval.rackOffsetIn;
      if (!isFiniteNumber(off)) continue;
      minEdge = Math.min(minEdge, off - envelopes[i].half);
      maxEdge = Math.max(maxEdge, off + envelopes[i].half);
    }
    const used = maxEdge - minEdge;
    if (used + reserve.spareWidthIn > params.widthIn + 1e-9) {
      findings.push(
        finding(
          SUPPORT_CODES.RACK_RESERVE_EXCEEDED,
          runId,
          `Rack "${rackInstanceId}" holds ${used.toFixed(3)} in of lines plus ${reserve.spareWidthIn} in of reserve in a ${params.widthIn}-in rack; the reserve does not fit.`,
        ),
      );
    }
  }
  // Tier separation: pipe/fitting/beam envelopes, not a 3-in shortcut.
  for (let tier = 1; tier < params.tiers; tier += 1) {
    const onTier = lines.filter((l) => l.interval.tier === tier);
    if (onTier.length === 0) continue;
    let maxEnv = null;
    let unknown = false;
    for (const { run } of onTier) {
      if (!isFiniteNumber(run.outsideDiameterIn) || !isFiniteNumber(run.insulationIn)) {
        unknown = true;
        break;
      }
      let env = run.outsideDiameterIn + 2 * run.insulationIn;
      const shoe = (run.supports || []).find(
        (s) => s?.type === "shoe" && s?.carrier?.rackId === rackInstanceId && isFiniteNumber(s.heightIn),
      );
      if (shoe) env += shoe.heightIn;
      maxEnv = maxEnv === null ? env : Math.max(maxEnv, env);
    }
    if (unknown) {
      findings.push(
        finding(
          SUPPORT_CODES.TIER_SEPARATION_UNVERIFIED,
          runId,
          `Rack "${rackInstanceId}" tier ${tier} separation cannot be checked: a line has no validated OD/insulation envelope.`,
        ),
      );
    } else if (params.tierSpacingIn < maxEnv + RACK_BEAM_DEPTH_IN - 1e-9) {
      findings.push(
        finding(
          SUPPORT_CODES.TIER_SEPARATION_INSUFFICIENT,
          runId,
          `Rack "${rackInstanceId}" tier spacing is ${params.tierSpacingIn} in but tier ${tier} lines need ${maxEnv.toFixed(3)} in of pipe envelope plus ${RACK_BEAM_DEPTH_IN} in of beam below the next tier.`,
          { tier, tierSpacingIn: params.tierSpacingIn, requiredIn: maxEnv + RACK_BEAM_DEPTH_IN },
        ),
      );
    }
  }
  // Guides and shoes as scheduled; loop envelopes authored.
  for (const { run, interval } of lines) {
    const hasGuide = (run.restraints || []).some(
      (r) => r?.type === "guide" && isPlainObject(r.carrier) && r.carrier.rackId === rackInstanceId,
    );
    if (!hasGuide) {
      findings.push(
        finding(
          SUPPORT_CODES.GUIDE_NOT_SCHEDULED,
          runId,
          `Pipe run ${run.id} travels on rack "${rackInstanceId}" with no scheduled guide; pipes resting in the rack are guided.`,
        ),
      );
    }
    const sizeIn = run.spanProfile?.nominalSizeIn ?? run.diameterIn;
    if (isFiniteNumber(run.insulationIn) && run.insulationIn > 0 && isFiniteNumber(sizeIn) && sizeIn >= 3) {
      const hasShoe = (run.supports || []).some(
        (s) => s?.type === "shoe" && isPlainObject(s.carrier) && s.carrier.rackId === rackInstanceId,
      );
      if (!hasShoe) {
        findings.push(
          finding(
            SUPPORT_CODES.SHOE_NOT_SCHEDULED,
            runId,
            `Pipe run ${run.id} is an insulated ${sizeIn}-in line on rack "${rackInstanceId}" with no scheduled shoe; insulated pipe 3 in and larger rests on shoes, not on bare insulation.`,
          ),
        );
      }
    }
    if (run.flexibility?.provision === "loop") {
      const loops = Array.isArray(reserve?.loopEnvelopes) ? reserve.loopEnvelopes : [];
      const hasLoop = loops.some(
        (l) => isPlainObject(l) && l.tier === interval.tier && isFiniteNumber(l.widthIn) && l.widthIn > 0,
      );
      if (!hasLoop) {
        findings.push(
          finding(
            SUPPORT_CODES.LOOP_ENVELOPE_UNVERIFIED,
            runId,
            `Pipe run ${run.id} carries a flexibility loop on tier ${interval.tier} of rack "${rackInstanceId}" with no authored loop envelope in the rack reserve.`,
          ),
        );
      }
    }
  }
  return { state: findings.length === 0 ? "PASS" : findings[0].code, findings };
}

// ---- Structure clearance (brief item 8) ---------------------------------

function distanceToSquarePlan(point, center, halfSize) {
  const dx = Math.max(0, Math.abs(point.x - center.x) - halfSize);
  const dy = Math.max(0, Math.abs(point.y - center.y) - halfSize);
  return Math.hypot(dx, dy);
}

/**
 * Structure clearance (brief item 8; digest §2.8/§2.10): 2 ft from a
 * flange outside diameter to a wall, column or other structure where
 * applicable. Walls are full-height plan segments; rack columns are
 * 10-in squares rising to the rack top. Unclear applicability stays
 * named, never silently waived.
 */
export function validateStructureClearance(design, run) {
  const runId = run?.id ?? "(unknown)";
  if (!Array.isArray(run?.points) || run.points.length < 2) {
    return { state: "NOT_APPLICABLE", findings: [] };
  }
  if (run.structureClearance === undefined || run.structureClearance === null) {
    return {
      state: "STRUCTURE_CLEARANCE_UNVERIFIED",
      findings: [
        finding(
          SUPPORT_CODES.STRUCTURE_CLEARANCE_UNVERIFIED,
          runId,
          `Pipe run ${runId} does not say whether flange-to-structure clearance applies; unclear applicability remains named, not silently waived.`,
        ),
      ],
    };
  }
  if (run.structureClearance.applies === false) return { state: "NOT_APPLICABLE", findings: [] };
  if (run.structureClearance.applies !== true) {
    return {
      state: "STRUCTURE_CLEARANCE_UNVERIFIED",
      findings: [
        finding(
          SUPPORT_CODES.STRUCTURE_CLEARANCE_UNVERIFIED,
          runId,
          `Pipe run ${runId} structure-clearance applicability is not a boolean; unclear applicability remains named.`,
        ),
      ],
    };
  }
  if (run.flangeStations === undefined || run.flangeStations === null) {
    return {
      state: "STRUCTURE_CLEARANCE_UNVERIFIED",
      findings: [
        finding(
          SUPPORT_CODES.STRUCTURE_CLEARANCE_UNVERIFIED,
          runId,
          `Pipe run ${runId} structure clearance applies but no flange stations are authored; unknown flange size is unverified.`,
        ),
      ],
    };
  }
  if (!Array.isArray(run.flangeStations) || run.flangeStations.length === 0) {
    return { state: "NOT_APPLICABLE", findings: [] };
  }
  const route = physicalRouteIn(design, run);
  const findings = [];
  // Structures: walls (plan segments) and every rack's columns.
  const walls = design?.walls || [];
  const racks = (design?.symbols || [])
    .map((s) => rackInstanceById(design, s.id))
    .filter(Boolean);
  for (const flange of run.flangeStations) {
    if (!isPlainObject(flange) || !isFiniteNumber(flange.stationIn) || !isFiniteNumber(flange.flangeRadiusIn)) {
      findings.push(
        finding(
          SUPPORT_CODES.STRUCTURE_CLEARANCE_UNVERIFIED,
          runId,
          `Pipe run ${runId} has a flange station without a validated flange radius; unknown flange size is unverified.`,
        ),
      );
      continue;
    }
    const point = pointAtStation(route, flange.stationIn);
    if (!point) continue;
    const required = STRUCTURE_CLEARANCE_IN + flange.flangeRadiusIn;
    let nearest = Infinity;
    let nearestWhat = "";
    for (const wall of walls) {
      if (!wall?.a || !wall?.b) continue;
      const d = pointSegmentDistance(point, wall.a, wall.b).distance;
      if (d < nearest) {
        nearest = d;
        nearestWhat = `wall ${wall.id}`;
      }
    }
    for (const rack of racks) {
      const footprint = rackFootprint(design, rack.inst.id);
      const local = toRackLocal(footprint, point);
      const plan = rackPlan(rack.params);
      const topIn = rack.params.elevationIn + (rack.params.tiers - 1) * rack.params.tierSpacingIn;
      if (point.zIn > topIn + FACE) continue;
      for (const col of plan.columns) {
        const d = distanceToSquarePlan({ x: local.along, y: local.across }, { x: col.x, y: col.z }, col.size / 2);
        if (d < nearest) {
          nearest = d;
          nearestWhat = `column of rack ${rack.inst.id}`;
        }
      }
    }
    if (nearest < required - 1e-9) {
      findings.push(
        finding(
          SUPPORT_CODES.STRUCTURE_CLEARANCE_VIOLATION,
          runId,
          `Pipe run ${runId} flange at ${flange.stationIn} in is ${nearest.toFixed(3)} in from the nearest structure (${nearestWhat}); ` +
            `flanges need ${STRUCTURE_CLEARANCE_IN} in clear of the flange outside diameter (${required.toFixed(3)} in from centerline).`,
          { stationIn: flange.stationIn, requiredIn: required, actualIn: nearest },
        ),
      );
    }
  }
  return { state: findings.length === 0 ? "PASS" : findings[0].code, findings };
}

// ---- Ground / buried handling (brief item 9) ------------------------------

/**
 * Ground/buried handling (brief item 9; digest §3.6). Low
 * approaches/sleeper corridors are scheduled supported piping; bare
 * ground is not support evidence. No arbitrary 100-ft ground cap
 * survives O4. Buried firewater is governed by the existing D9
 * burial rules, not by this check; soil/bedding strength is
 * NOT_EVALUATED and is never mislabeled steel-supported. Exposed
 * transitions need supports — that is the O2 transition rule, not
 * duplicated here.
 */
export function validateGroundHandling(design, run) {
  const runId = run?.id ?? "(unknown)";
  if (!Array.isArray(run?.points) || run.points.length < 2) {
    return { state: "NOT_APPLICABLE", findings: [] };
  }
  if (runIsBuried(design, run)) return { state: "NOT_APPLICABLE", findings: [] };
  const route = physicalRouteIn(design, run);
  const low = route.some((p) => p.zIn <= LOW_PIPE_ELEVATION_IN);
  if (!low) return { state: "NOT_APPLICABLE", findings: [] };
  const { totalIn } = routeStations(design, run);
  const { findings } = classifySupports(design, run, route, totalIn);
  const ground = findings.filter(
    (f) => f.code === SUPPORT_CODES.GROUND_NOT_SUPPORT || f.code === SUPPORT_CODES.SUPPORT_CARRIER_UNVERIFIED,
  );
  return { state: ground.length === 0 ? "PASS" : ground[0].code, findings: ground };
}

// ---- Aggregate ------------------------------------------------------------

function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const key = JSON.stringify([f.code, f.message]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Aggregate support states for one run. allClear is true only when
 * every applicable check passes: any NOT_VERIFIED, missing provision,
 * mismatch or finding defeats it. There is no global all-clear while
 * a required check lacks inputs. Pair spacing and rack organization
 * are design-level (pipeSupportRuleErrors), not per-run.
 */
export function supportCheckStates(design, run) {
  const classification = validateRouteClassification(design, run);
  const spans = validateSupportSpans(design, run);
  const transitions = validateTransitionSupports(design, run);
  const nozzle = validateNozzleSupports(design, run);
  const ground = validateGroundHandling(design, run);
  const structure = validateStructureClearance(design, run);
  const checks = {
    classification: classification.state,
    spans: spans.state,
    transitions: transitions.state,
    nozzle: nozzle.state,
    ground: ground.state,
    structure: structure.state,
  };
  const findings = dedupeFindings([
    ...classification.findings,
    ...spans.findings,
    ...transitions.findings,
    ...nozzle.findings,
    ...ground.findings,
    ...structure.findings,
  ]);
  const allClear = Object.values(checks).every((s) => s === "PASS" || s === "NOT_APPLICABLE");
  return { checks, findings, allClear };
}

/**
 * All D10-02 findings for a design as strings, in the same shape as
 * the sibling *Errors aggregators. PR B does not wire this into
 * validateDesign (see the header note); PR E wires it when the
 * sample is revised. Pair spacing runs only over pairs where both
 * runs carry complete spacing data — a pair with no spacing model
 * is not spacing-modeled, and the design-level roll-up does not spam
 * it as unverified (call validatePairSpacing directly for the
 * per-pair verdict).
 */
export function pipeSupportRuleErrors(design) {
  const errors = [];
  const push = (findings) => {
    for (const f of findings) errors.push(`${f.code}: ${f.message}`);
  };
  for (const run of design?.pipes || []) {
    const { findings } = supportCheckStates(design, run);
    push(findings);
  }
  const runs = design?.pipes || [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const a = runs[i];
      const b = runs[j];
      const modeled =
        isFiniteNumber(a.outsideDiameterIn) &&
        isFiniteNumber(b.outsideDiameterIn) &&
        isFiniteNumber(a.insulationIn) &&
        isFiniteNumber(b.insulationIn) &&
        isFiniteNumber(a.expansionAllowanceIn) &&
        isFiniteNumber(b.expansionAllowanceIn) &&
        (a.spacingProfile === "ordinary" || a.spacingProfile === "largest-line") &&
        (b.spacingProfile === "ordinary" || b.spacingProfile === "largest-line");
      if (!modeled) continue;
      push(validatePairSpacing(design, a, b).findings);
    }
  }
  const rackIds = new Set();
  for (const run of runs) {
    for (const iv of run?.routeIntervals || []) {
      if (iv?.role === "RACK_TRAVEL" && typeof iv.rackId === "string") rackIds.add(iv.rackId);
    }
  }
  for (const rackId of rackIds) {
    push(validateRackOrganization(design, rackId).findings);
  }
  return [...new Set(errors)];
}

// ---- Editable workflow (brief item 10) ----------------------------------

function findPipeRun(design, pipeId) {
  const run = (design?.pipes || []).find((r) => r.id === pipeId);
  if (!run) throw new Error(`Unknown pipe run: ${pipeId}`);
  return run;
}

function withRun(design, pipeId, nextRun) {
  return { ...design, pipes: (design.pipes || []).map((r) => (r.id === pipeId ? nextRun : r)) };
}

/** D10-02 authored fields that setPipeSupportData may patch (null clears). */
const SUPPORT_DATA_FIELDS = Object.freeze([
  "spanProfile",
  "sizeChanges",
  "routeIntervals",
  "supports",
  "restraints",
  "nozzleSupports",
  "spacingProfile",
  "guideProfile",
  "outsideDiameterIn",
  "insulationIn",
  "expansionAllowanceIn",
  "flangeStations",
  "structureClearance",
]);

/**
 * Patch a run's D10-02 authored data. Object/array values are
 * deep-detached (the stored run never aliases a caller object);
 * numeric fields must be finite when given; spacingProfile must be
 * "ordinary" or "largest-line". A null value clears the field. The
 * validators classify the patched data — this setter invents no
 * rule, and it never repacks, clamps or moves existing data.
 */
export function setPipeSupportData(design, pipeId, fields = {}) {
  if (!isPlainObject(fields)) throw new Error("Support data must be an object.");
  const run = findPipeRun(design, pipeId);
  const next = { ...run };
  for (const key of SUPPORT_DATA_FIELDS) {
    if (!(key in fields)) continue;
    const value = fields[key];
    if (value === null || value === undefined) {
      delete next[key];
      continue;
    }
    if (key === "outsideDiameterIn" || key === "insulationIn" || key === "expansionAllowanceIn") {
      if (!isFiniteNumber(value)) throw new Error(`${key} must be a finite number.`);
      next[key] = value;
      continue;
    }
    if (key === "spacingProfile") {
      if (value !== "ordinary" && value !== "largest-line") {
        throw new Error(`Unknown spacing profile: ${value}.`);
      }
      next[key] = value;
      continue;
    }
    if (key === "guideProfile") {
      // D10-06 Ruling 1: only the named cap profile is admitted;
      // any other string is refused, never stored as a near-miss
      // that a validator might read as a selection.
      if (value !== RISER_GUIDE_CAP_PROFILE) {
        throw new Error(`Unknown guide profile: ${value}.`);
      }
      next[key] = value;
      continue;
    }
    next[key] = detach(value);
  }
  return withRun(design, pipeId, next);
}

/** Replace a run's route-interval classification (deep-detached). */
export function setRouteIntervals(design, pipeId, intervals) {
  if (!Array.isArray(intervals)) throw new Error("Route intervals must be an array.");
  const run = findPipeRun(design, pipeId);
  return withRun(design, pipeId, { ...run, routeIntervals: detach(intervals) });
}

/**
 * Add one scheduled support to a run. The support needs a finite
 * station and a type string; its id is generated when absent. The
 * stored support is deep-detached. Carrier verification is the
 * validators' job — admission stores the authored schedule as-is.
 */
export function addPipeSupport(design, pipeId, support) {
  if (!isPlainObject(support)) throw new Error("A support must be an object.");
  if (!isFiniteNumber(support.stationIn)) throw new Error("A support needs a finite station.");
  if (typeof support.type !== "string" || support.type === "") {
    throw new Error("A support needs a type.");
  }
  const run = findPipeRun(design, pipeId);
  const next = detach(support);
  if (typeof next.id !== "string" || next.id === "") next.id = nextSupportId();
  if ((run.supports || []).some((s) => s?.id === next.id)) {
    throw new Error(`Support id "${next.id}" already exists on pipe run ${pipeId}.`);
  }
  return withRun(design, pipeId, { ...run, supports: [...(run.supports || []), next] });
}

/** Patch one scheduled support (carrier/tier reassignment included). */
export function updatePipeSupport(design, pipeId, supportId, patch = {}) {
  if (!isPlainObject(patch)) throw new Error("A support patch must be an object.");
  const run = findPipeRun(design, pipeId);
  let changed = false;
  const supports = (run.supports || []).map((s) => {
    if (s?.id !== supportId) return s;
    changed = true;
    const next = { ...s, ...detach(patch), id: supportId };
    if (next.stationIn !== undefined && !isFiniteNumber(next.stationIn)) {
      throw new Error("A support needs a finite station.");
    }
    return next;
  });
  if (!changed) throw new Error(`Unknown support "${supportId}" on pipe run ${pipeId}.`);
  return withRun(design, pipeId, { ...run, supports });
}

/** Delete one scheduled support. */
export function deletePipeSupport(design, pipeId, supportId) {
  const run = findPipeRun(design, pipeId);
  if (!(run.supports || []).some((s) => s?.id === supportId)) {
    throw new Error(`Unknown support "${supportId}" on pipe run ${pipeId}.`);
  }
  return withRun(design, pipeId, {
    ...run,
    supports: (run.supports || []).filter((s) => s?.id !== supportId),
  });
}

/** Reassign a support's carrier (and tier, via carrier.tier). */
export function setSupportCarrier(design, pipeId, supportId, carrier) {
  if (!isPlainObject(carrier)) throw new Error("A carrier must be an object.");
  return updatePipeSupport(design, pipeId, supportId, { carrier: detach(carrier) });
}

/**
 * Author a rack's reserve (spare width for future lines) and loop
 * envelopes. Stored on the rack instance's rack object, beside the
 * parameters setRackParams owns. A missing reserve is unverified,
 * never defaulted.
 */
export function setRackReserve(design, rackInstanceId, reserve) {
  if (!isPlainObject(reserve)) throw new Error("A rack reserve must be an object.");
  if (reserve.spareWidthIn !== undefined && !isFiniteNumber(reserve.spareWidthIn)) {
    throw new Error("Rack reserve spare width must be a finite number.");
  }
  if (reserve.loopEnvelopes !== undefined && !Array.isArray(reserve.loopEnvelopes)) {
    throw new Error("Rack loop envelopes must be an array.");
  }
  const found = rackInstanceById(design, rackInstanceId);
  if (!found) throw new Error(`Unknown rack instance: ${rackInstanceId}`);
  const { inst } = found;
  const next = { ...(inst.rack || {}), reserve: detach(reserve) };
  return {
    ...design,
    symbols: (design.symbols || []).map((s) => (s.id === rackInstanceId ? { ...s, rack: next } : s)),
  };
}

/**
 * Preview support/field-support proposals for a run WITHOUT applying
 * them: a dummy-leg at every transition vertex that lacks a bound
 * support, stanchions subdividing every overlong developed interval
 * to its size maximum, and brackets at unbound mid-route flange
 * stations. Proposed carriers are field foundations (kind
 * "foundation") for the author to confirm or reassign; the proposal
 * never moves existing data. Nozzle last-supports name the last
 * contact (existing or proposed) per attached end. Returns
 * { proposal, findings, unresolved }: proposal is null when the
 * span profile is unverifiable, and unresolved lists concentrated
 * loads the proposal cannot place (valve stations carry no station).
 */
export function previewSupportProposal(design, run) {
  const runId = run?.id ?? "(unknown)";
  if (!Array.isArray(run?.points) || run.points.length < 2) {
    return {
      proposal: null,
      findings: [
        finding(
          SUPPORT_CODES.SPAN_PROFILE_UNVERIFIABLE,
          runId,
          `Pipe run ${runId} has no route to propose supports for.`,
        ),
      ],
      unresolved: [],
    };
  }
  const profile = resolveSpanProfile(run);
  if (!profile.ok) {
    return {
      proposal: null,
      findings: [
        finding(
          SUPPORT_CODES.SPAN_PROFILE_UNVERIFIABLE,
          runId,
          `Pipe run ${runId} span profile is unverifiable: ${profile.reason}.`,
        ),
      ],
      unresolved: [],
    };
  }
  const { stations, totalIn, route } = routeStations(design, run);
  const { changes } = validateSizeChanges(run, totalIn);
  const { contacts } = classifySupports(design, run, route, totalIn);
  const proposed = [];
  let seq = 0;
  const propose = (support) => {
    seq += 1;
    proposed.push({ id: `preview-${seq}`, ...support });
    return proposed[proposed.length - 1];
  };
  // Transition dummy-legs first: they are weight contacts too, so
  // the span subdivision below counts them.
  const contactStations = contacts.map((c) => c.stationIn);
  for (const t of transitionVertices(design, run)) {
    const station = stations[t.vertexIndex].stationIn;
    // A transition is bound only when a support's actual contact
    // station sits within the adopted tolerance of the transition
    // station; a remote support that merely carries the transition
    // index does not count (same label-vs-geometry rule as the
    // validation binding above).
    const bound = contacts.some(
      (c) =>
        c.transitionIndex === t.vertexIndex &&
        Math.abs(c.stationIn - station) <= TRANSITION_ADJACENCY_IN,
    );
    if (bound) continue;
    propose({
      type: "dummy-leg",
      stationIn: station,
      transitionIndex: t.vertexIndex,
      carrier: { kind: "foundation" },
    });
    contactStations.push(station);
  }
  // Flange-station brackets (concentrated loads with a station).
  const unresolved = [];
  const flanges = Array.isArray(run.flangeStations) ? run.flangeStations : [];
  flanges.forEach((flange) => {
    if (!isPlainObject(flange) || !isFiniteNumber(flange.stationIn)) return;
    if (flange.stationIn <= FACE || flange.stationIn >= totalIn - FACE) return;
    // A flange is already bound only when a load support's actual
    // contact station sits at the flange station; a remote bracket
    // whose loadRef merely claims the flange station must not
    // suppress the proposal (same label-vs-geometry rule as the
    // validation binding above).
    const bound = contacts.some(
      (c) =>
        isPlainObject(c.loadRef) &&
        c.loadRef.kind === "flange" &&
        Math.abs(c.stationIn - flange.stationIn) <= FACE,
    );
    if (bound) return;
    propose({
      type: "bracket",
      stationIn: flange.stationIn,
      loadRef: { kind: "flange", stationIn: flange.stationIn },
      carrier: { kind: "foundation" },
    });
    contactStations.push(flange.stationIn);
  });
  const valves = Array.isArray(run.valveStations) ? run.valveStations : [];
  valves.forEach((valve, index) => {
    const station = isPlainObject(valve) ? valve.stationIn : undefined;
    if (!isFiniteNumber(station)) {
      // No authored route station: no load support can be placed
      // or verified by geometry — the valve stays explicitly
      // unresolved regardless of any index-matched label (same rule
      // as the validation binding, which emits
      // CONCENTRATED_LOAD_UNVERIFIED for the same geometry).
      unresolved.push(`valve station ${index} has no station to place a load support at`);
      return;
    }
    // An authored valve station is bound only when a load support's
    // actual contact station sits within the adopted tolerance of
    // the valve station; a remote bracket whose loadRef merely
    // claims the valve index must not suppress the proposal (same
    // label-vs-geometry rule as the validation binding above).
    const bound = contacts.some(
      (c) =>
        isPlainObject(c.loadRef) &&
        c.loadRef.kind === "valve" &&
        c.loadRef.index === index &&
        Math.abs(c.stationIn - station) <= TRANSITION_ADJACENCY_IN,
    );
    if (bound) return;
    propose({
      type: "bracket",
      stationIn: station,
      loadRef: { kind: "valve", index, stationIn: station },
      carrier: { kind: "foundation" },
    });
    contactStations.push(station);
  });
  // Span subdivision over the remaining overlong intervals.
  const breaks = [0, totalIn, ...contactStations, ...changes.map((c) => c.stationIn)];
  breaks.sort((a, b) => a - b);
  const deduped = [];
  for (const p of breaks) {
    if (deduped.length === 0 || p - deduped[deduped.length - 1] > EPS) deduped.push(p);
  }
  for (let i = 0; i + 1 < deduped.length; i += 1) {
    const from = deduped[i];
    const to = deduped[i + 1];
    const len = to - from;
    if (len <= EPS) continue;
    const size = sizeAtStation(profile.sizeIn, changes, (from + to) / 2);
    const max = SUPPORT_SPAN_TABLE_IN[size];
    if (len <= max + 1e-9) continue;
    const parts = Math.ceil(len / max - 1e-9);
    for (let k = 1; k < parts; k += 1) {
      propose({ type: "stanchion", stationIn: from + (k * len) / parts, carrier: { kind: "foundation" } });
    }
  }
  // Nozzle last-supports: the last contact per attached end,
  // counting proposed supports.
  const allContacts = [
    ...contacts.map((c) => ({ id: c.id, stationIn: c.stationIn })),
    ...proposed.map((p) => ({ id: p.id, stationIn: p.stationIn })),
  ].sort((a, b) => a.stationIn - b.stationIn);
  const nozzleSupports = {};
  for (const end of ENDS) {
    if (!run.attachments?.[end]) continue;
    const last = end === "start" ? allContacts[0] : allContacts[allContacts.length - 1];
    if (last) nozzleSupports[end] = { supportId: last.id };
  }
  return {
    proposal: { supports: proposed, nozzleSupports },
    findings: [],
    unresolved,
  };
}

/**
 * Apply a previewed (or hand-authored) support proposal in one
 * transaction: every proposed support is validated first — finite
 * station inside the route, a weight-carrying type, a carrier that
 * verifies — and a single invalid entry refuses the whole apply;
 * nothing is half-applied. Proposed ids are kept unless they collide
 * with an existing support id, in which case a fresh id is assigned
 * and the nozzle schedule is remapped to it.
 */
export function applySupportProposal(design, pipeId, proposal) {
  if (!isPlainObject(proposal) || !Array.isArray(proposal.supports)) {
    throw new Error("A support proposal needs a supports array.");
  }
  const run = findPipeRun(design, pipeId);
  const { totalIn, route } = routeStations(design, run);
  const existingIds = new Set((run.supports || []).map((s) => s?.id));
  const remap = new Map();
  const nextSupports = [];
  for (const raw of proposal.supports) {
    if (!isPlainObject(raw) || !isFiniteNumber(raw.stationIn) || raw.stationIn < -EPS || raw.stationIn > totalIn + EPS) {
      throw new Error("A proposed support needs a finite station inside the route.");
    }
    if (!WEIGHT_SUPPORT_TYPES.has(raw.type)) {
      throw new Error(`Proposed support type "${raw.type}" does not carry weight.`);
    }
    const point = pointAtStation(route, Math.max(0, Math.min(totalIn, raw.stationIn)));
    const carrier = verifyCarrier(design, raw.carrier, point);
    if (!carrier.ok) {
      throw new Error(`Proposed support at ${raw.stationIn} in has no verified carrier: ${carrier.reason}.`);
    }
    const next = detach(raw);
    if (typeof next.id !== "string" || next.id === "" || existingIds.has(next.id)) {
      // Loop until the candidate is absent from both the existing
      // ids and the ids already prepared in this proposal: a single
      // generation can itself collide (e.g. after resetSupportIds a
      // run that already holds support-1 makes nextSupportId return
      // support-1 again). The nozzle-reference remap follows the
      // final fresh id.
      let fresh = nextSupportId();
      while (existingIds.has(fresh)) fresh = nextSupportId();
      if (typeof next.id === "string" && next.id !== "") remap.set(next.id, fresh);
      next.id = fresh;
    }
    existingIds.add(next.id);
    nextSupports.push(next);
  }
  let next = { ...run, supports: [...(run.supports || []), ...nextSupports] };
  if (isPlainObject(proposal.nozzleSupports)) {
    const remapped = {};
    for (const [end, ref] of Object.entries(proposal.nozzleSupports)) {
      if (!isPlainObject(ref) || typeof ref.supportId !== "string") continue;
      remapped[end] = { supportId: remap.get(ref.supportId) ?? ref.supportId };
    }
    next = { ...next, nozzleSupports: { ...(run.nozzleSupports || {}), ...remapped } };
  }
  return withRun(design, pipeId, next);
}

/**
 * Whole-affected revalidation after a move/delete/change-size/phase/
 * insulation edit: the run's own support checks, pair spacing
 * against every other run, and rack organization for every rack the
 * run references. Callers run this after the edit and surface its
 * findings; the edit itself never silently repacks, clamps or moves
 * existing data.
 */
export function revalidateSupportsAfterEdit(design, pipeId) {
  const run = findPipeRun(design, pipeId);
  const runState = supportCheckStates(design, run);
  const pairFindings = [];
  for (const other of design?.pipes || []) {
    if (other.id === pipeId) continue;
    pairFindings.push(...validatePairSpacing(design, run, other).findings);
  }
  const rackFindings = [];
  const rackIds = new Set();
  for (const iv of run?.routeIntervals || []) {
    if (iv?.role === "RACK_TRAVEL" && typeof iv.rackId === "string") rackIds.add(iv.rackId);
  }
  for (const rackId of rackIds) {
    rackFindings.push(...validateRackOrganization(design, rackId).findings);
  }
  return {
    run: runState,
    pairFindings: dedupeFindings(pairFindings),
    rackFindings: dedupeFindings(rackFindings),
  };
}
