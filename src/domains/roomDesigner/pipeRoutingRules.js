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
// - Endpoint ownership: a run end is connected only through the canonical
//   owned-interface/junction predicate — a scheduled, owned flange
//   interface (attachments metadata resolving to a real connection face
//   within the 0.5-in face tolerance, judged by
//   attachmentInterfaceErrors) or a verified pipe junction
//   (validatedJunctionEdge status "ok": a recorded junction whose host
//   route passes through the end, whose face elevations meet, whose
//   approach carries evidence, and whose mixed-size transition is bound
//   by a reducer owning exactly the two participating interfaces).
//   Endpoint proximity alone never connects: a coincident end with no
//   junction record, a junction at a different elevation, or a junction
//   to an incompatible size with no owned reducer all stay flagged
//   ROUTE_UNCONNECTED_END. A transient unfinished drawing is allowed in
//   the sense that the finding is a flag, not a geometry rewrite —
//   nothing here moves a vertex.
// - Phase-driven header take-offs (brief item 4; digest §1.6): liquid
//   branches leave the bottom of the header, vapor/steam rise off the
//   top. Phase and take-off are scheduled, authored fields; an unknown
//   phase is BRANCH_PHASE_UNVERIFIED and is NEVER inferred from the run's
//   service name or color. Authored consistency alone never earns a
//   PASS: the take-off must also be evidenced at a referenced end whose
//   first evidence-bearing approach segment moves in the authored
//   direction; missing physical evidence is UNVERIFIED, a wrong-way
//   verified approach is MISMATCH. No thermal/flow calculation.
// - Required reference checks (brief item 7; digest §1.9–1.12):
//   flexibility provision, U-loop geometry, valve/control-station
//   arrangement, and meter straight lengths. Schedules are closed and
//   typed: an unknown flexibility provision, a loop without finite loop
//   geometry or without a U shape, and a non-boolean operator-side value
//   never qualify. The digest states no hot-run threshold and no
//   universal meter-diameter multiplier, so this module invents neither:
//   a missing schedule or profile yields a named NOT_VERIFIED state,
//   never an automatic pass, and routeCheckStates never reports an
//   all-clear while a required check lacks inputs. Meter authored lengths
//   must also be evidenced by straight intervals in the route itself.
// - Bounded candidate generation (brief item 6): previewOrthogonalRoute
//   proposes X-first / Y-first orthogonal candidates between two
//   endpoints, preserving endpoint identities, sizes, services, elevations
//   and fitting ownership. It is not global auto-routing: no obstacle,
//   rack or crossing reasoning happens here. Apply is one undoable
//   transaction via the REPLACE_PIPE_ROUTE reducer action (domain:
//   replacePipeRoute), which re-derives attachments, junctions and
//   crossing jogs exactly like MOVE_PIPE_VERTEX.
// - Explicit legacy repair (brief item 3): repairLegacyRoute reroutes a
//   non-compliant run through the preview candidates, but ONLY when a
//   candidate meets both owned endpoints (attached ends still satisfy
//   their scheduled faces; junctioned ends still verify). If neither
//   bounded candidate meets them, the repair returns ROUTE_UNRESOLVED
//   and the old geometry stands unchanged. The input run is never
//   mutated, and apply never drops or rebinds a claimed endpoint to hide
//   an invalid proposal. Feasibility is derived from interface facts,
//   never from a caller-supplied oblique-face flag (ignored).
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
  effectiveApproachSegment,
  physicalRouteIn,
  validatedJunctionEdge,
  vertexElevationsForDesign,
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
  FLEXIBILITY_LOOP_SHAPE: "FLEXIBILITY_LOOP_SHAPE",
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

/** The single-axis direction of one leg, or null when the leg is not
 * verified single-axis. A diagonal, degenerate, or malformed leg has no
 * direction to merge on — it is never treated as collinear with anything.
 * (The axis epsilon here is the numerical one, ROUTE_AXIS_EPSILON_IN;
 * it is never the 0.5-in face-contact tolerance.) */
function legDirection(a, b) {
  const leg = classifyLeg(a, b);
  if (leg.kind !== "axis" && leg.kind !== "vertical") return null;
  const axis = leg.changed[0];
  const delta = axis === "x" ? b.x - a.x : axis === "y" ? b.y - a.y : b.zIn - a.zIn;
  return { axis, sign: Math.sign(delta) };
}

/**
 * Drop intermediate vertices where the route continues straight forward
 * (verified collinear, same single axis, same direction). Pure: returns
 * a new array. Every other vertex is preserved exactly: a turn, a
 * reversal, a diagonal leg, a vertical leg partner, and any malformed
 * (non-finite) point all survive. In particular a bend that is diagonal
 * on both sides is never collapsed to its endpoints — collapsing it
 * would delete a meaningful bend and hide both diagonal legs. Malformed
 * input is preserved as given, never silently dropped: a point that
 * cannot be classified cannot be judged collinear, so the route stands
 * (callers that need strictness validate separately).
 */
export function simplifyRouteLegs(route) {
  const pts = Array.isArray(route) ? route : [];
  if (pts.some((p) => !p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.zIn))) {
    return pts.map((p) => (p ? { ...p } : p));
  }
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out = [{ ...pts[0] }];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const v1 = legDirection(prev, cur);
    const v2 = legDirection(cur, next);
    // Straight forward continuation: drop the middle vertex. Any turn,
    // reversal, diagonal, or degenerate step keeps it.
    if (v1 && v2 && v1.axis === v2.axis && v1.sign === v2.sign) continue;
    out.push({ ...cur });
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

/**
 * Validate one run's ends (brief item 2). An end is connected only via
 * the canonical owned-interface/junction predicate, never by endpoint
 * proximity alone: a scheduled owned flange interface (attachments
 * metadata resolving to a real connection face within the face
 * tolerance, judged by attachmentInterfaceErrors) or a verified pipe
 * junction (validatedJunctionEdge status "ok" — a recorded junction
 * whose host route actually passes through the end, whose face
 * elevations meet within the face tolerance, whose approach carries
 * evidence, and whose mixed-size transition, when any, is bound by a
 * reducer owning exactly the two participating interfaces). Any other
 * end is flagged ROUTE_UNCONNECTED_END: the flag is the whole behavior
 * — nothing here moves geometry, and a transient unfinished drawing
 * simply carries the flag until its ends connect. In particular a
 * coincident end with no junction record, a junction to a run at a
 * different elevation, and a junction to an incompatible size with no
 * owned reducer are all unresolved, even when the plan points coincide.
 * (The 1e-6-in numerical axis epsilon and the 0.5-in physical
 * face-contact tolerance are separate constants and are never merged.)
 */
export function validateRouteEndpoints(design, run) {
  const findings = [];
  const runId = run?.id ?? "(unknown)";
  if (!Array.isArray(run?.points) || run.points.length < 2) return findings;
  for (const end of ENDS) {
    if (run.attachments?.[end]) {
      for (const message of attachmentInterfaceErrors(design, run, end)) {
        findings.push(finding(ROUTE_CODES.FACE_UNRESOLVED, runId, message));
      }
      continue;
    }
    const edge = validatedJunctionEdge(design, run, end);
    if (edge.status !== "ok") {
      const why =
        edge.status === "no-edge"
          ? "no junction record names a host for this end"
          : edge.status === "no-host"
            ? "its junction record names a host run that does not exist"
            : edge.status === "off-route"
              ? "its junction host's route does not pass through this end"
              : edge.status === "elevation"
                ? `its junction faces do not meet (mine ${edge.myElevIn} in, host ${edge.hostElevIn} in)`
                : edge.status === "reducer"
                  ? "its mixed-size junction has no reducer binding this exact pair of interfaces"
                  : "its junction carries no approach evidence";
      findings.push(
        finding(
          ROUTE_CODES.UNCONNECTED_END,
          runId,
          `Pipe run ${runId} ${end} end is not on an owned flange face or a ` +
            `verified pipe junction (${why}); a persisted unconnected end ` +
            `stays flagged.`,
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
 *
 * Authored consistency is only the first layer. A take-off PASS also
 * needs physical evidence in the design: at least one referenced end
 * (an owned attachment face or a verified junction host) whose first
 * evidence-bearing approach segment moves in the authored direction —
 * bottom take-offs descend away from the header, top take-offs ascend.
 * A level approach, a failed host check, or no referenced end at all is
 * BRANCH_TAKEOFF_UNVERIFIED, never PASS; a verified host whose approach
 * moves the wrong way is BRANCH_TAKEOFF_MISMATCH. No thermal or flow
 * calculation is involved, and no host-type flag is required (no header
 * flag exists on pipe runs). A lone run argument is normalized to
 * (null design, run): authored labels still classify, but no physical
 * PASS is possible without a design.
 */
export function validateBranchTakeoff(designOrRun, maybeRun) {
  const run = maybeRun === undefined ? designOrRun : maybeRun;
  const design = maybeRun === undefined ? null : designOrRun;
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
  // Physical layer: the take-off must be evidenced at a referenced end.
  // Without a design or a route there is no evidence to judge, so the
  // authored labels alone never earn a PASS.
  if (!design || !Array.isArray(run?.points) || run.points.length < 2) {
    return {
      state: "BRANCH_TAKEOFF_UNVERIFIED",
      findings: [
        finding(
          ROUTE_CODES.BRANCH_TAKEOFF_UNVERIFIED,
          runId,
          `Pipe run ${runId} is a ${run.phase} header take-off with consistent ` +
            `authored labels but no design or route evidence for the take-off itself.`,
        ),
      ],
    };
  }
  const elevs = vertexElevationsForDesign(design, run);
  let verified = false;
  let contradicted = false;
  const notes = [];
  for (const end of ENDS) {
    if (!run.attachments?.[end] && !run.junctions?.[end]) continue;
    let hostOk = true;
    if (run.attachments?.[end]) {
      const errs = attachmentInterfaceErrors(design, run, end);
      if (errs.length > 0) {
        hostOk = false;
        notes.push(`${end} attachment: ${errs.join("; ")}`);
      }
    }
    if (hostOk && run.junctions?.[end]) {
      const edge = validatedJunctionEdge(design, run, end);
      if (edge.status !== "ok") {
        hostOk = false;
        notes.push(`${end} junction: ${edge.status}`);
      }
    }
    if (!hostOk) continue;
    const approach = effectiveApproachSegment(design, run, end);
    if (!approach || !approach.foundEvidence) continue;
    // Signed approach: the effective segment's elevation change walking
    // inward from the take-off end. Level (within the numerical epsilon)
    // is no signed evidence at all.
    const dz = elevs[approach.farIdx] - elevs[approach.innerIdx];
    if (Math.abs(dz) <= ROUTE_AXIS_EPSILON_IN) continue;
    if ((dz > 0) === (run.takeoff === "top")) {
      verified = true;
    } else {
      contradicted = true;
    }
  }
  if (verified) {
    return { state: "PASS", findings: [] };
  }
  if (contradicted) {
    return {
      state: "BRANCH_TAKEOFF_MISMATCH",
      findings: [
        finding(
          ROUTE_CODES.BRANCH_TAKEOFF_MISMATCH,
          runId,
          `Pipe run ${runId} is a ${run.phase} header take-off whose verified ` +
            `approach moves ${run.takeoff === "top" ? "downward" : "upward"}; ` +
            `${run.phase} leaves the ${expected} of the header.`,
        ),
      ],
    };
  }
  return {
    state: "BRANCH_TAKEOFF_UNVERIFIED",
    findings: [
      finding(
        ROUTE_CODES.BRANCH_TAKEOFF_UNVERIFIED,
        runId,
        `Pipe run ${runId} is a ${run.phase} header take-off with consistent ` +
          `authored labels but no referenced end verifies the take-off` +
          (notes.length > 0 ? ` (${notes.join("; ")})` : "") +
          `.`,
      ),
    ],
  };
}

/**
 * Required reference checks (brief item 7; digest §1.9–1.12). All inputs
 * are authored fields on the run; nothing here invents a hot-run
 * threshold, a meter-diameter multiplier, or a default schedule:
 * - flexibility: run.flexibility { required?: boolean,
 *   provision?: "loop"|"expansion-joint"|"offset", loopPoints? }.
 *   A loop provision's geometry must itself be orthogonal AND form a
 *   U (offset and return); an unknown provision name, missing loop
 *   points, or non-finite loop points never qualify.
 * - meter: run.isMeterRun with run.meterSchedule { upstreamDiameters,
 *   downstreamDiameters } and authored straight fitting-free lengths
 *   run.meterStraightUpstreamIn / run.meterStraightDownstreamIn.
 *   Diameters come only from the explicit schedule, and the authored
 *   lengths must also be evidenced by straight single-axis intervals
 *   in the route itself (two distinct intervals meeting the two
 *   requirements, or one interval meeting their sum).
 * - valves: run.valveStations [{ parallelTo: "rack"|"vessel-centerline",
 *   operatorSide: boolean }]. parallelTo "other" is a mismatch;
 *   operatorSide must be a real boolean — the string "false" is
 *   unverified, never a PASS. Valve arrangement identity binding to a
 *   real rack/centerline object is deferred to the D10-02 rack
 *   registry (no racks exist in PR A); this check judges only the
 *   authored arrangement fields.
 *
 * Call shape is (design, run); a lone run argument is normalized to
 * (null design, run). Flexibility and valve checks need no design, but
 * the meter interval check without a design has no route evidence and
 * is NOT_VERIFIED.
 */
export function routeReferenceChecks(designOrRun, maybeRun) {
  const run = maybeRun === undefined ? designOrRun : maybeRun;
  const design = maybeRun === undefined ? null : designOrRun;
  const runId = run?.id ?? "(unknown)";
  const out = {};

  const FLEX_PROVISIONS = new Set(["loop", "expansion-joint", "offset"]);
  const flex = run?.flexibility;
  if (flex?.provision === "loop") {
    const pts = flex.loopPoints;
    if (!Array.isArray(pts) || pts.length === 0) {
      out.flexibility = {
        state: "FLEXIBILITY_NOT_VERIFIED",
        findings: [
          finding(
            ROUTE_CODES.FLEXIBILITY_NOT_VERIFIED,
            runId,
            `Pipe run ${runId} flexibility loop carries no loop geometry; ` +
              `a loop provision without loop points cannot be verified.`,
          ),
        ],
      };
    } else if (pts.some((p) => !p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.zIn))) {
      out.flexibility = {
        state: "FLEXIBILITY_NOT_VERIFIED",
        findings: [
          finding(
            ROUTE_CODES.FLEXIBILITY_NOT_VERIFIED,
            runId,
            `Pipe run ${runId} flexibility loop points are not finite 3D ` +
              `points; a loop provision with unusable geometry cannot be verified.`,
          ),
        ],
      };
    } else {
      const bad = [];
      for (let i = 0; i + 1 < pts.length; i += 1) {
        if (classifyLeg(pts[i], pts[i + 1]).kind === "diagonal" || classifyLeg(pts[i], pts[i + 1]).kind === "degenerate") {
          bad.push(i);
        }
      }
      // A U is legs i, i+1, i+2 where i and i+2 run the same single
      // axis in opposite directions and i+1 runs a perpendicular axis.
      // An L-path (two legs) or a straight run is not a U.
      let hasU = false;
      for (let i = 0; i + 3 < pts.length && !hasU; i += 1) {
        const d0 = legDirection(pts[i], pts[i + 1]);
        const d1 = legDirection(pts[i + 1], pts[i + 2]);
        const d2 = legDirection(pts[i + 2], pts[i + 3]);
        if (d0 && d1 && d2 && d0.axis === d2.axis && d0.sign === -d2.sign && d1.axis !== d0.axis) {
          hasU = true;
        }
      }
      if (bad.length > 0) {
        out.flexibility = {
          state: "FLEXIBILITY_LOOP_NONORTHOGONAL",
          findings: [
            finding(
              ROUTE_CODES.FLEXIBILITY_LOOP_NONORTHOGONAL,
              runId,
              `Pipe run ${runId} flexibility loop has a non-orthogonal leg; ` +
                `a U-loop is orthogonal offsets.`,
            ),
          ],
        };
      } else if (!hasU) {
        out.flexibility = {
          state: "FLEXIBILITY_LOOP_SHAPE",
          findings: [
            finding(
              ROUTE_CODES.FLEXIBILITY_LOOP_SHAPE,
              runId,
              `Pipe run ${runId} flexibility loop path does not form a U ` +
                `(offset and return); an L-path or straight run is not a loop.`,
            ),
          ],
        };
      } else {
        out.flexibility = { state: "PASS", findings: [] };
      }
    }
  } else if (flex?.provision !== undefined && flex?.provision !== null) {
    if (FLEX_PROVISIONS.has(flex.provision)) {
      out.flexibility = { state: "PASS", findings: [] };
    } else {
      out.flexibility = {
        state: "FLEXIBILITY_NOT_VERIFIED",
        findings: [
          finding(
            ROUTE_CODES.FLEXIBILITY_NOT_VERIFIED,
            runId,
            `Pipe run ${runId} flexibility provision "${flex.provision}" is ` +
              `not a known provision (loop, expansion-joint, offset); an ` +
              `unknown provision name cannot be verified.`,
          ),
        ],
      };
    }
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
        // Geometric interval evidence: the authored lengths must also be
        // present as straight single-axis intervals in the route itself.
        // Maximal straight runs (consecutive collinear forward legs
        // merged) qualify when two distinct intervals meet the upstream
        // and downstream requirements, or one interval meets their sum
        // (the existential placement: the meter sits somewhere on a
        // straight run long enough for both sides). Without a design or
        // a route there is no interval evidence, so the check is
        // NOT_VERIFIED rather than PASS.
        const upReq = upD * dia;
        const downReq = downD * dia;
        let intervals = null;
        if (design && Array.isArray(run?.points) && run.points.length >= 2) {
          const route = physicalRouteIn(design, run);
          intervals = [];
          let cur = null;
          for (let i = 0; i + 1 < route.length; i += 1) {
            const dir = legDirection(route[i], route[i + 1]);
            if (!dir) {
              cur = null;
              continue;
            }
            const a = route[i];
            const b = route[i + 1];
            const len = dir.axis === "x" ? Math.abs(b.x - a.x) : dir.axis === "y" ? Math.abs(b.y - a.y) : Math.abs(b.zIn - a.zIn);
            if (cur && cur.axis === dir.axis && cur.sign === dir.sign) {
              cur.length += len;
            } else {
              cur = { axis: dir.axis, sign: dir.sign, length: len };
              intervals.push(cur);
            }
          }
        }
        const distinct =
          intervals !== null &&
          intervals.some(
            (r1, i) => r1.length >= upReq && intervals.some((r2, j) => j !== i && r2.length >= downReq),
          );
        if (intervals !== null && (intervals.some((r) => r.length >= upReq + downReq) || distinct)) {
          out.meter = { state: "PASS", findings: [] };
        } else {
          out.meter = {
            state: "METER_SCHEDULE_NOT_VERIFIED",
            findings: [
              finding(
                ROUTE_CODES.METER_SCHEDULE_NOT_VERIFIED,
                runId,
                intervals === null
                  ? `Pipe run ${runId} meter schedule is present with adequate ` +
                      `authored lengths, but no route geometry evidences the ` +
                      `straight intervals (no design or route to judge).`
                  : `Pipe run ${runId} meter route lacks straight fitting-free ` +
                      `intervals of ${upReq} in upstream and ${downReq} in downstream ` +
                      `(two distinct intervals, or one of ${upReq + downReq} in).`,
              ),
            ],
          };
        }
      }
    }
  }

  const stations = run?.valveStations;
  if (!Array.isArray(stations) || stations.length === 0) {
    out.valves = { state: "NOT_APPLICABLE", findings: [] };
  } else {
    // Strict typing with mismatch precedence: an explicitly wrong
    // arrangement (parallelTo "other", operatorSide false) is a
    // MISMATCH; a malformed or missing value (parallelTo outside the
    // closed set, operatorSide not a real boolean — the string "false"
    // included) is UNVERIFIED, never a PASS.
    const unverified = stations.some(
      (s) =>
        !s ||
        typeof s !== "object" ||
        (s.parallelTo !== "rack" && s.parallelTo !== "vessel-centerline") ||
        typeof s.operatorSide !== "boolean",
    );
    const mismatch = stations.some(
      (s) => s && typeof s === "object" && (s.parallelTo === "other" || s.operatorSide === false),
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
  const takeoff = validateBranchTakeoff(design, run);
  const reference = routeReferenceChecks(design, run);
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
 * Explicit legacy repair (brief item 3). A repair reroutes a diagonal
 * legacy route to orthogonal geometry between its existing endpoints,
 * bounded to the X-first and Y-first candidates of
 * previewOrthogonalRoute — and ONLY when a candidate meets both owned
 * endpoints: an attached end must still satisfy its scheduled face
 * (attachmentInterfaceErrors empty on the candidate) and a junctioned
 * end must still verify (validatedJunctionEdge ok on the candidate).
 * Free ends need no check. If neither bounded candidate meets them, the
 * repair returns ROUTE_UNRESOLVED with route null — the old geometry
 * stands unchanged, never a candidate that breaks a connection. The
 * returned route carries the run's attachments and junctions intact:
 * apply never silently drops or rebinds a claimed endpoint to hide an
 * invalid proposal. options.obliqueFace is deliberately IGNORED:
 * feasibility is derived from interface facts, never from a
 * caller-supplied flag — a genuinely oblique face fails the attachment
 * check on both candidates anyway, since no orthogonal approach can
 * meet a diagonal normal within the face alignment rule. A run with no
 * orthogonality problems, or a degenerate route, yields no repair and a
 * ROUTE_UNRESOLVED finding respectively, as before.
 */
export function repairLegacyRoute(design, run, options = {}) {
  const runId = run?.id ?? "(unknown)";
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
  for (const chosen of candidates) {
    const candRun = { ...run, points: chosen.points, elevIn: chosen.elevIn };
    let meetsEndpoints = true;
    for (const end of ENDS) {
      if (run.attachments?.[end] && attachmentInterfaceErrors(design, candRun, end).length > 0) {
        meetsEndpoints = false;
        break;
      }
      if (meetsEndpoints && run.junctions?.[end] && validatedJunctionEdge(design, candRun, end).status !== "ok") {
        meetsEndpoints = false;
        break;
      }
    }
    if (meetsEndpoints) {
      return {
        route: candRun,
        repaired: true,
        candidateId: chosen.id,
        revalidate: chosen.revalidate,
        findings: [],
      };
    }
  }
  return {
    route: null,
    repaired: false,
    findings: [
      finding(
        ROUTE_CODES.UNRESOLVED,
        runId,
        `Pipe run ${runId} cannot be repaired: neither bounded orthogonal ` +
          `candidate meets its owned endpoints, so the original geometry stands unchanged.`,
      ),
    ],
  };
}
