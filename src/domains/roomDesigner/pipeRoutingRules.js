// D10-01 — grid/orthogonal routing foundation (Designer D10 PR A).
//
// Implements brief §D10-01 of
// results/chatgpt/designer-d10-routing-supports-access-implementation-brief-2026-10-23.md
// under the binding rules of
// briefs/designer/pipe-design-reference-digest-2026-10-23.md (digest §1
// routing). Pure and framework-free: every function takes data and returns
// data; no function mutates its input run or design.
//
// What this module is:
// - Orthogonality validation: a physical straight leg changes exactly one
//   world X/Y/Z coordinate (brief item 1; digest §1.1–1.2, 1.7). Vertical
//   legs are duplicate plan points with different elevations — the same
//   representation physicalRouteIn already uses for risers. Co-linear
//   forward vertices may simplify; reversals, retracing and degenerate
//   legs are explicit findings.
// - Endpoint ownership: a run end is connected only through a scheduled,
//   owned flange interface (attachments metadata resolving to a real
//   connection face within the 0.5-in face tolerance) or a pipe-to-pipe
//   junction. Any other persisted end stays flagged ROUTE_UNCONNECTED_END;
//   transient unfinished drawing is allowed in the sense that the finding
//   is a flag, not a geometry rewrite — nothing here moves a vertex.
// - Phase-driven header take-offs (brief item 4; digest §1.6): liquid
//   branches leave the bottom of the header, vapor/steam rise off the
//   top. Phase and take-off are scheduled, authored fields; an unknown
//   phase is BRANCH_PHASE_UNVERIFIED and is NEVER inferred from the run's
//   service name or color.
// - Required reference checks (brief item 7; digest §1.9–1.12):
//   flexibility provision, U-loop geometry, valve/control-station
//   arrangement, and meter straight lengths. The digest states no hot-run
//   threshold and no universal meter-diameter multiplier, so this module
//   invents neither: a missing schedule or profile yields a named
//   NOT_VERIFIED state, never an automatic pass, and routeCheckStates
//   never reports an all-clear while a required check lacks inputs.
// - Bounded candidate generation (brief item 6): previewOrthogonalRoute
//   proposes X-first / Y-first orthogonal candidates between two
//   endpoints, preserving endpoint identities, sizes, services, elevations
//   and fitting ownership. It is not global auto-routing: no obstacle,
//   rack or crossing reasoning happens here. Apply is one undoable
//   transaction via the REPLACE_PIPE_ROUTE reducer action (domain:
//   replacePipeRoute), which re-derives attachments, junctions and
//   crossing jogs exactly like MOVE_PIPE_VERTEX.
// - Explicit legacy repair (brief item 3): repairLegacyRoute reroutes a
//   non-compliant run through the preview candidates. The input run is
//   never mutated; an infeasible repair (degenerate route, or an oblique
//   scheduled face needing special fitting make-up) returns
//   ROUTE_UNRESOLVED and the old geometry stands unchanged.
//
// What this module deliberately does NOT do in PR A (see the PR report):
// - It is not wired into validateDesign. The current production sample is
//   diagonal by construction and its acceptance test pins validateDesign
//   clean; wiring these findings in before PR E revises the sample would
//   break that acceptance test. PR E wires pipeRoutingRuleErrors into
//   validateDesign when the sample is revised.
// - It does not change applyCrossingJogs. Crossing-jog orthogonality is
//   covered by validateRouteOrthogonality and outside-envelope clearance
//   by the existing findPipeCrossings resolved flag (requiredSeparationIn);
//   elevation-changing preview/repair results carry a revalidate marker
//   naming the D10-02 support and D10-03 access registries, which do not
//   exist yet. The buried-firewater jog-direction policy (bounded
//   underpass vs default upward jog) needs the burial-envelope data model
//   from D10-02 and is not changed here.
// - Rack/tier ownership and packing (D10-02), access zones/crossovers
//   (D10-03) and vessel end-head placement (D10-04) are out of scope.

import {
  CONNECTION_FACE_TOLERANCE_IN,
  DEFAULT_PIPE_ELEVATION_IN,
  JUNCTION_TOLERANCE_IN,
  physicalRouteIn,
} from "./pipeCrossings";
import { attachmentInterfaceErrors } from "./pipeAttachments";
import { isValidPoint } from "./designerGeometry";

/** Numerical axis epsilon (in): representation policy for grid legs. */
export const ROUTE_AXIS_EPSILON_IN = 1e-6;
/** Flange-face tolerance (in): single source is pipeCrossings. */
export const ROUTE_FACE_TOLERANCE_IN = CONNECTION_FACE_TOLERANCE_IN;

/** Finding codes. Every code is stable text a reviewer can grep for. */
export const ROUTE_CODES = Object.freeze({
  DIAGONAL_LEG: "ROUTE_DIAGONAL_LEG",
  DEGENERATE_LEG: "ROUTE_DEGENERATE_LEG",
  DEGENERATE_ROUTE: "ROUTE_DEGENERATE_ROUTE",
  REVERSAL: "ROUTE_REVERSAL",
  RETRACE: "ROUTE_RETRACE",
  UNCONNECTED_END: "ROUTE_UNCONNECTED_END",
  FACE_UNRESOLVED: "ROUTE_FACE_UNRESOLVED",
  UNRESOLVED: "ROUTE_UNRESOLVED",
  BRANCH_PHASE_UNVERIFIED: "BRANCH_PHASE_UNVERIFIED",
  BRANCH_TAKEOFF_UNVERIFIED: "BRANCH_TAKEOFF_UNVERIFIED",
  BRANCH_TAKEOFF_MISMATCH: "BRANCH_TAKEOFF_MISMATCH",
  FLEXIBILITY_PROVISION_MISSING: "FLEXIBILITY_PROVISION_MISSING",
  FLEXIBILITY_NOT_VERIFIED: "FLEXIBILITY_NOT_VERIFIED",
  FLEXIBILITY_LOOP_NONORTHOGONAL: "FLEXIBILITY_LOOP_NONORTHOGONAL",
  METER_SCHEDULE_NOT_VERIFIED: "METER_SCHEDULE_NOT_VERIFIED",
  METER_STRAIGHT_LENGTH_SHORT: "METER_STRAIGHT_LENGTH_SHORT",
  VALVE_ARRANGEMENT_UNVERIFIED: "VALVE_ARRANGEMENT_UNVERIFIED",
  VALVE_ARRANGEMENT_MISMATCH: "VALVE_ARRANGEMENT_MISMATCH",
});

const EPS = ROUTE_AXIS_EPSILON_IN;
const ENDS = ["start", "end"];

function finding(code, runId, message, legIndex = undefined) {
  const out = { code, runId, message };
  if (legIndex !== undefined) out.legIndex = legIndex;
  return out;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function axisChanged(delta) {
  return Math.abs(delta) > EPS;
}

/**
 * Classify one 3D leg (a -> b): "axis" (exactly one coordinate changes),
 * "vertical" (plan fixed, elevation changes — a riser), "degenerate"
 * (nothing changes) or "diagonal" (two or three coordinates change).
 * Returns { kind, changed: ["x"|"y"|"z"] }.
 */
export function classifyLeg(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.zIn - a.zIn;
  const changed = [];
  if (axisChanged(dx)) changed.push("x");
  if (axisChanged(dy)) changed.push("y");
  if (axisChanged(dz)) changed.push("z");
  if (changed.length === 0) return { kind: "degenerate", changed };
  if (changed.length > 1) return { kind: "diagonal", changed };
  if (changed[0] === "z") return { kind: "vertical", changed };
  return { kind: "axis", changed };
}

/**
 * Validate one run's grid orthogonality (brief item 1). Uses the run's
 * physical route (stored elevations, else the derived profile — the same
 * read the 3D model uses), so a stored sloped leg and a derived one are
 * judged identically. Returns findings; [] means grid-compliant.
 */
export function validateRouteOrthogonality(design, run) {
  const findings = [];
  const runId = run?.id ?? "(unknown)";
  const route = physicalRouteIn(design, run);
  if (!Array.isArray(run?.points) || route.length < 2) {
    findings.push(
      finding(
        ROUTE_CODES.DEGENERATE_ROUTE,
        runId,
        `Pipe run ${runId} has fewer than two vertices and is not a route.`,
      ),
    );
    return findings;
  }
  const legs = [];
  for (let i = 0; i < route.length - 1; i += 1) {
    const leg = classifyLeg(route[i], route[i + 1]);
    legs.push(leg);
    if (leg.kind === "degenerate") {
      findings.push(
        finding(
          ROUTE_CODES.DEGENERATE_LEG,
          runId,
          `Pipe run ${runId} leg ${i} has zero length (duplicate vertex).`,
          i,
        ),
      );
    } else if (leg.kind === "diagonal") {
      findings.push(
        finding(
          ROUTE_CODES.DIAGONAL_LEG,
          runId,
          `Pipe run ${runId} leg ${i} changes ${leg.changed.join(" and ")} ` +
            `at once; a grid leg changes exactly one world coordinate.`,
          i,
        ),
      );
    }
  }
  // Reversal: a leg that runs exactly back along the previous leg's axis.
  // Retrace: a leg overlapping any earlier non-adjacent leg's 3D segment.
  // Both are findings, never silently simplified away.
  const directionOf = (i) => {
    const a = route[i];
    const b = route[i + 1];
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.zIn - a.zIn };
    if (axisChanged(d.x)) return { axis: "x", sign: Math.sign(d.x) };
    if (axisChanged(d.y)) return { axis: "y", sign: Math.sign(d.y) };
    if (axisChanged(d.z)) return { axis: "z", sign: Math.sign(d.z) };
    return null;
  };
  for (let i = 1; i < legs.length; i += 1) {
    const prev = directionOf(i - 1);
    const cur = directionOf(i);
    if (prev && cur && prev.axis === cur.axis && prev.sign === -cur.sign) {
      findings.push(
        finding(
          ROUTE_CODES.REVERSAL,
          runId,
          `Pipe run ${runId} leg ${i} reverses leg ${i - 1}; retracing is not a route.`,
          i,
        ),
      );
    }
  }
  const overlaps = (a1, a2, b1, b2) => {
    // Axis legs only: collinear iff both move on the same single axis
    // with equal fixed coordinates on the other two axes, and their
    // intervals on the moving axis overlap by more than epsilon.
    const movingAxis = (p, q) => {
      if (axisChanged(q.x - p.x)) return "x";
      if (axisChanged(q.y - p.y)) return "y";
      if (axisChanged(q.zIn - p.zIn)) return "zIn";
      return null;
    };
    const mA = movingAxis(a1, a2);
    const mB = movingAxis(b1, b2);
    if (!mA || mA !== mB) return false;
    for (const axis of ["x", "y", "zIn"]) {
      if (axis === mA) continue;
      if (Math.abs(a1[axis] - b1[axis]) > EPS) return false;
    }
    const lo = Math.max(Math.min(a1[mA], a2[mA]), Math.min(b1[mA], b2[mA]));
    const hi = Math.min(Math.max(a1[mA], a2[mA]), Math.max(b1[mA], b2[mA]));
    return hi - lo > EPS;
  };
  for (let i = 0; i < route.length - 1; i += 1) {
    if (legs[i].kind !== "axis" && legs[i].kind !== "vertical") continue;
    for (let j = 0; j < i - 1; j += 1) {
      if (legs[j].kind !== "axis" && legs[j].kind !== "vertical") continue;
      if (overlaps(route[j], route[j + 1], route[i], route[i + 1])) {
        findings.push(
          finding(
            ROUTE_CODES.RETRACE,
            runId,
            `Pipe run ${runId} leg ${i} retraces leg ${j}.`,
            i,
          ),
        );
        break;
      }
    }
  }
  return findings;
}

/**
 * Drop intermediate vertices where the route continues straight forward
 * (co-linear, same direction). Pure: returns a new array. Reversals and
 * direction changes are never simplified away.
 */
export function simplifyRouteLegs(route) {
  const pts = (route || []).filter(
    (p) => p && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.zIn),
  );
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out = [{ ...pts[0] }];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const dirOf = (a, b) => {
      const d = { x: b.x - a.x, y: b.y - a.y, z: b.zIn - a.zIn };
      if (axisChanged(d.x)) return { axis: "x", sign: Math.sign(d.x) };
      if (axisChanged(d.y)) return { axis: "y", sign: Math.sign(d.y) };
      if (axisChanged(d.z)) return { axis: "z", sign: Math.sign(d.z) };
      return null;
    };
    const v1 = dirOf(prev, cur);
    const v2 = dirOf(cur, next);
    // Straight forward continuation: drop the middle vertex. Any turn,
    // reversal or degenerate step keeps it.
    if (v1 && v2 && v1.axis === v2.axis && v1.sign === v2.sign) continue;
    out.push({ ...cur });
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

/**
 * Validate one run's ends (brief item 2). An end is connected only via a
 * scheduled owned flange interface (attachments metadata resolving to a
 * real connection face within the face tolerance) or a pipe-to-pipe
 * junction (another run's endpoint within the junction tolerance). Any
 * other end is flagged ROUTE_UNCONNECTED_END: the flag is the whole
 * behavior — nothing here moves geometry, and a transient unfinished
 * drawing simply carries the flag until its ends connect.
 */
export function validateRouteEndpoints(design, run) {
  const findings = [];
  const runId = run?.id ?? "(unknown)";
  if (!Array.isArray(run?.points) || run.points.length < 2) return findings;
  const others = (design?.pipes || []).filter((p) => p.id !== run.id);
  for (const end of ENDS) {
    const idx = end === "start" ? 0 : run.points.length - 1;
    const point = run.points[idx];
    if (run.attachments?.[end]) {
      for (const message of attachmentInterfaceErrors(design, run, end)) {
        findings.push(finding(ROUTE_CODES.FACE_UNRESOLVED, runId, message));
      }
      continue;
    }
    const junctioned = others.some((other) =>
      (other.points || []).some(
        (p, k) =>
          (k === 0 || k === other.points.length - 1) &&
          Math.hypot(p.x - point.x, p.y - point.y) <= JUNCTION_TOLERANCE_IN,
      ),
    );
    if (!junctioned) {
      findings.push(
        finding(
          ROUTE_CODES.UNCONNECTED_END,
          runId,
          `Pipe run ${runId} ${end} end is not on an owned flange face or a ` +
            `pipe junction; a persisted unconnected end stays flagged.`,
        ),
      );
    }
  }
  return findings;
}

const PHASES = new Set(["liquid", "vapor", "steam"]);
const TAKEOFFS = new Set(["bottom", "top"]);

/**
 * Phase-driven header take-off (brief item 4; digest §1.6). The run's
 * branchRole/phase/takeoff are scheduled, authored fields on the run
 * (set at creation via addPipeRun options). Phase is NEVER inferred from
 * run.service, run.material, color or any other proxy: a run whose
 * service reads "steam" but carries no scheduled phase is still
 * BRANCH_PHASE_UNVERIFIED.
 */
export function validateBranchTakeoff(run) {
  const runId = run?.id ?? "(unknown)";
  if (run?.branchRole !== "header-takeoff") {
    return { state: "NOT_APPLICABLE", findings: [] };
  }
  if (!PHASES.has(run.phase)) {
    return {
      state: "BRANCH_PHASE_UNVERIFIED",
      findings: [
        finding(
          ROUTE_CODES.BRANCH_PHASE_UNVERIFIED,
          runId,
          `Pipe run ${runId} is a header take-off with no scheduled phase; ` +
            `phase is never inferred from service name or color.`,
        ),
      ],
    };
  }
  if (!TAKEOFFS.has(run.takeoff)) {
    return {
      state: "BRANCH_TAKEOFF_UNVERIFIED",
      findings: [
        finding(
          ROUTE_CODES.BRANCH_TAKEOFF_UNVERIFIED,
          runId,
          `Pipe run ${runId} is a ${run.phase} header take-off with no ` +
            `scheduled take-off direction.`,
        ),
      ],
    };
  }
  const expected = run.phase === "liquid" ? "bottom" : "top";
  if (run.takeoff !== expected) {
    return {
      state: "BRANCH_TAKEOFF_MISMATCH",
      findings: [
        finding(
          ROUTE_CODES.BRANCH_TAKEOFF_MISMATCH,
          runId,
          `Pipe run ${runId} is a ${run.phase} header take-off leaving the ` +
            `${run.takeoff} of the header; ${run.phase} leaves the ${expected}.`,
        ),
      ],
    };
  }
  return { state: "PASS", findings: [] };
}

/**
 * Required reference checks (brief item 7; digest §1.9–1.12). All inputs
 * are authored fields on the run; nothing here invents a hot-run
 * threshold, a meter-diameter multiplier, or a default schedule:
 * - flexibility: run.flexibility { required?: boolean,
 *   provision?: "loop"|"expansion-joint"|"offset", loopPoints? }.
 *   A loop provision's geometry must itself be orthogonal.
 * - meter: run.isMeterRun with run.meterSchedule { upstreamDiameters,
 *   downstreamDiameters } and authored straight fitting-free lengths
 *   run.meterStraightUpstreamIn / run.meterStraightDownstreamIn.
 *   Diameters come only from the explicit schedule.
 * - valves: run.valveStations [{ parallelTo: "rack"|"vessel-centerline",
 *   operatorSide: boolean }].
 */
export function routeReferenceChecks(run) {
  const runId = run?.id ?? "(unknown)";
  const out = {};

  const flex = run?.flexibility;
  if (flex?.provision === "loop" && Array.isArray(flex.loopPoints)) {
    const legs = [];
    for (let i = 0; i < flex.loopPoints.length - 1; i += 1) {
      legs.push(classifyLeg(flex.loopPoints[i], flex.loopPoints[i + 1]));
    }
    const bad = legs.find((l) => l.kind === "diagonal" || l.kind === "degenerate");
    out.flexibility = bad
      ? {
          state: "FLEXIBILITY_LOOP_NONORTHOGONAL",
          findings: [
            finding(
              ROUTE_CODES.FLEXIBILITY_LOOP_NONORTHOGONAL,
              runId,
              `Pipe run ${runId} flexibility loop has a non-orthogonal leg; ` +
                `a U-loop is orthogonal offsets.`,
            ),
          ],
        }
      : { state: "PASS", findings: [] };
  } else if (flex?.provision) {
    out.flexibility = { state: "PASS", findings: [] };
  } else if (flex?.required === true) {
    out.flexibility = {
      state: "FLEXIBILITY_PROVISION_MISSING",
      findings: [
        finding(
          ROUTE_CODES.FLEXIBILITY_PROVISION_MISSING,
          runId,
          `Pipe run ${runId} is flagged flexibility-required with no ` +
            `authored provision (loop, joint or offset).`,
        ),
      ],
    };
  } else if (flex?.required === false) {
    out.flexibility = { state: "PASS", findings: [] };
  } else {
    out.flexibility = {
      state: "FLEXIBILITY_NOT_VERIFIED",
      findings: [
        finding(
          ROUTE_CODES.FLEXIBILITY_NOT_VERIFIED,
          runId,
          `Pipe run ${runId} carries no authored flexibility flag or ` +
            `provision, so flexibility cannot be verified.`,
        ),
      ],
    };
  }

  if (!run?.isMeterRun && !run?.meterSchedule) {
    out.meter = { state: "NOT_APPLICABLE", findings: [] };
  } else {
    const sched = run.meterSchedule || {};
    const upD = sched.upstreamDiameters;
    const downD = sched.downstreamDiameters;
    const dia = run.diameterIn;
    if (!isFiniteNumber(upD) || !isFiniteNumber(downD) || !(upD > 0) || !(downD > 0) || !(dia > 0)) {
      out.meter = {
        state: "METER_SCHEDULE_NOT_VERIFIED",
        findings: [
          finding(
            ROUTE_CODES.METER_SCHEDULE_NOT_VERIFIED,
            runId,
            `Pipe run ${runId} is a meter run with no explicit approved ` +
              `straight-length schedule; no diameter multiplier is assumed.`,
          ),
        ],
      };
    } else {
      const short = [];
      if (isFiniteNumber(run.meterStraightUpstreamIn) && run.meterStraightUpstreamIn < upD * dia) {
        short.push("upstream");
      }
      if (isFiniteNumber(run.meterStraightDownstreamIn) && run.meterStraightDownstreamIn < downD * dia) {
        short.push("downstream");
      }
      const missing =
        !isFiniteNumber(run.meterStraightUpstreamIn) || !isFiniteNumber(run.meterStraightDownstreamIn);
      if (missing) {
        out.meter = {
          state: "METER_SCHEDULE_NOT_VERIFIED",
          findings: [
            finding(
              ROUTE_CODES.METER_SCHEDULE_NOT_VERIFIED,
              runId,
              `Pipe run ${runId} meter schedule is present but its authored ` +
                `straight fitting-free lengths are missing.`,
            ),
          ],
        };
      } else if (short.length > 0) {
        out.meter = {
          state: "METER_STRAIGHT_LENGTH_SHORT",
          findings: [
            finding(
              ROUTE_CODES.METER_STRAIGHT_LENGTH_SHORT,
              runId,
              `Pipe run ${runId} meter straight length is short on the ${short.join(" and ")} side(s) of the orifice flanges.`,
            ),
          ],
        };
      } else {
        out.meter = { state: "PASS", findings: [] };
      }
    }
  }

  const stations = run?.valveStations;
  if (!Array.isArray(stations) || stations.length === 0) {
    out.valves = { state: "NOT_APPLICABLE", findings: [] };
  } else {
    const unverified = stations.some(
      (s) => !s || (s.parallelTo !== "rack" && s.parallelTo !== "vessel-centerline") || s.operatorSide === undefined,
    );
    const mismatch = stations.some(
      (s) => s && (s.parallelTo === "other" || s.operatorSide === false),
    );
    if (mismatch) {
      out.valves = {
        state: "VALVE_ARRANGEMENT_MISMATCH",
        findings: [
          finding(
            ROUTE_CODES.VALVE_ARRANGEMENT_MISMATCH,
            runId,
            `Pipe run ${runId} has a valve/control station not parallel to ` +
              `the rack or vessel centerline, or not facing the operator side.`,
          ),
        ],
      };
    } else if (unverified) {
      out.valves = {
        state: "VALVE_ARRANGEMENT_UNVERIFIED",
        findings: [
          finding(
            ROUTE_CODES.VALVE_ARRANGEMENT_UNVERIFIED,
            runId,
            `Pipe run ${runId} valve/control stations lack authored ` +
              `parallel arrangement or operator-side data.`,
          ),
        ],
      };
    } else {
      out.valves = { state: "PASS", findings: [] };
    }
  }
  return out;
}

/**
 * Aggregate route states for one run. allClear is true only when every
 * applicable check passes: any NOT_VERIFIED, missing provision, mismatch
 * or finding defeats it. There is no global all-clear while a required
 * check lacks inputs.
 */
export function routeCheckStates(design, run) {
  const orthogonal = validateRouteOrthogonality(design, run);
  const endpoints = validateRouteEndpoints(design, run);
  const takeoff = validateBranchTakeoff(run);
  const reference = routeReferenceChecks(run);
  const checks = {
    orthogonal: orthogonal.length === 0 ? "PASS" : "FAIL",
    endpoints: endpoints.length === 0 ? "PASS" : "FAIL",
    branchTakeoff: takeoff.state,
    flexibility: reference.flexibility.state,
    meter: reference.meter.state,
    valves: reference.valves.state,
  };
  const findings = [...orthogonal, ...endpoints, ...takeoff.findings];
  for (const key of ["flexibility", "meter", "valves"]) {
    findings.push(...reference[key].findings);
  }
  const allClear = Object.values(checks).every((s) => s === "PASS" || s === "NOT_APPLICABLE");
  return { checks, findings, allClear };
}

/**
 * All D10-01 findings for a design as strings, in the same shape as the
 * sibling *Errors aggregators. PR A does not wire this into
 * validateDesign (see the header note); PR E wires it when the sample is
 * revised.
 */
export function pipeRoutingRuleErrors(design) {
  const errors = [];
  for (const run of design?.pipes || []) {
    const { findings } = routeCheckStates(design, run);
    for (const f of findings) errors.push(`${f.code}: ${f.message}`);
  }
  return errors;
}

function dedupeRoute(points, elevIn) {
  const outP = [];
  const outE = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const last = outP[outP.length - 1];
    if (last && last.x === p.x && last.y === p.y && outE[outE.length - 1] === elevIn[i]) {
      continue;
    }
    outP.push({ x: p.x, y: p.y });
    outE.push(elevIn[i]);
  }
  return { points: outP, elevIn: outE };
}

/**
 * Bounded orthogonal candidates between two endpoints (brief item 6).
 * from/to are { x, y, zIn? }; zIn defaults to elevationIn, then the
 * standard grade elevation. Candidates are X-first and Y-first (deduped
 * when the endpoints are already aligned); a vertical riser carries an
 * elevation change only as duplicate plan points, never as a slope.
 * Endpoint identities, sizes, services, elevations and fitting ownership
 * ride on each candidate's `preserved` block; elevation-changing
 * candidates carry a revalidate marker for the D10-02 support and
 * D10-03 access registries. Infeasible input yields no candidates and a
 * ROUTE_UNRESOLVED finding — never a diagonal fallback.
 */
export function previewOrthogonalRoute({
  from,
  to,
  diameterIn,
  service,
  elevationIn,
  startAttachment,
  endAttachment,
  runId = "(preview)",
} = {}) {
  const ok = (p) =>
    p && isFiniteNumber(p.x) && isFiniteNumber(p.y) && (p.zIn === undefined || isFiniteNumber(p.zIn));
  if (!ok(from) || !ok(to)) {
    return {
      candidates: [],
      findings: [
        finding(
          ROUTE_CODES.UNRESOLVED,
          runId,
          `Orthogonal preview needs finite endpoints; got an invalid endpoint.`,
        ),
      ],
    };
  }
  const z1 = from.zIn ?? elevationIn ?? DEFAULT_PIPE_ELEVATION_IN;
  const z2 = to.zIn ?? elevationIn ?? DEFAULT_PIPE_ELEVATION_IN;
  const planSame = Math.abs(from.x - to.x) <= EPS && Math.abs(from.y - to.y) <= EPS;
  const elevSame = Math.abs(z1 - z2) <= EPS;
  if (planSame && elevSame) {
    return {
      candidates: [],
      findings: [
        finding(
          ROUTE_CODES.UNRESOLVED,
          runId,
          `Orthogonal preview endpoints coincide; there is no route to propose.`,
        ),
      ],
    };
  }
  const preserved = { diameterIn, service, elevationIn, startAttachment, endAttachment };
  const build = (id, points, elevs) => {
    const deduped = dedupeRoute(points, elevs);
    const changesElev = deduped.elevIn.some((z) => Math.abs(z - deduped.elevIn[0]) > EPS);
    return {
      id,
      points: deduped.points,
      elevIn: deduped.elevIn,
      preserved,
      revalidate: changesElev ? ["D10-02-supports", "D10-03-access"] : [],
    };
  };
  const raw = [
    build(
      "x-first",
      [
        { x: from.x, y: from.y },
        { x: to.x, y: from.y },
        { x: to.x, y: to.y },
        { x: to.x, y: to.y },
      ],
      [z1, z1, z1, z2],
    ),
    build(
      "y-first",
      [
        { x: from.x, y: from.y },
        { x: from.x, y: to.y },
        { x: to.x, y: to.y },
        { x: to.x, y: to.y },
      ],
      [z1, z1, z1, z2],
    ),
  ];
  const seen = new Set();
  const candidates = raw.filter((c) => {
    const key = JSON.stringify([c.points, c.elevIn]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { candidates, findings: [] };
}

/**
 * Explicit legacy repair (brief item 3). A grid-compliant run needs no
 * repair. A non-compliant run is rerouted through the preview candidates
 * between its own first and last vertices, preserving its diameter,
 * service, elevations and fitting ownership; the input run is never
 * mutated. An oblique scheduled face (options.obliqueFace) or a
 * degenerate route yields ROUTE_UNRESOLVED with route null — the old
 * geometry stands unchanged.
 */
export function repairLegacyRoute(design, run, options = {}) {
  const runId = run?.id ?? "(unknown)";
  if (options.obliqueFace) {
    return {
      route: null,
      repaired: false,
      findings: [
        finding(
          ROUTE_CODES.UNRESOLVED,
          runId,
          `Pipe run ${runId} meets an oblique scheduled face needing special ` +
            `fitting make-up; it stays ROUTE_UNRESOLVED until that ` +
            `arrangement is modeled, with no silent relocation.`,
        ),
      ],
    };
  }
  const problems = validateRouteOrthogonality(design, run);
  if (problems.length === 0) {
    return { route: null, repaired: false, findings: [] };
  }
  const route = physicalRouteIn(design, run);
  if (route.length < 2) {
    return {
      route: null,
      repaired: false,
      findings: [
        finding(
          ROUTE_CODES.UNRESOLVED,
          runId,
          `Pipe run ${runId} cannot be repaired: it has no usable endpoints.`,
        ),
      ],
    };
  }
  const first = route[0];
  const last = route[route.length - 1];
  const { candidates, findings } = previewOrthogonalRoute({
    from: first,
    to: last,
    diameterIn: run.diameterIn,
    service: run.service,
    elevationIn: run.elevationIn,
    startAttachment: run.attachments?.start,
    endAttachment: run.attachments?.end,
    runId,
  });
  if (candidates.length === 0) {
    return { route: null, repaired: false, findings };
  }
  const chosen = candidates[0];
  return {
    route: { ...run, points: chosen.points, elevIn: chosen.elevIn },
    repaired: true,
    candidateId: chosen.id,
    revalidate: chosen.revalidate,
    findings: [],
  };
}
