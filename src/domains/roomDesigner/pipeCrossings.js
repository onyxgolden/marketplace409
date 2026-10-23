// Pipe crossings: a pipe must change elevation to cross another pipe.
//
// Pipe runs are plan polylines. A run may carry OPTIONAL elevation data:
//   elevationIn: base centerline elevation (in) for the whole run
//   elevIn:      per-vertex centerline elevations, parallel to points
//                (null entries fall back to elevationIn, then to the
//                standard derived elevation)
// Absent both, a run's elevation is DERIVED exactly as the 3D model has
// always derived it (rack support at the segment midpoint, else the
// grade centerline) — every legacy drawing behaves byte-identically.
//
// Where two runs cross in plan (a proper segment intersection that is
// not a shared endpoint, junction, tee, or attached equipment end), the
// centerlines must be separated by at least the two pipe radii plus
// clearance, or the pipes would pass through each other. The edited run
// resolves a crossing with a vertical JOG: it steps up over the other
// run at the crossing (two risers and a short elevated span, all in the
// run's vertex/elevation data). Validation flags any crossing left
// unresolved, and any run passing through an equipment footprint it is
// not connected to.
//
// Pure and framework-free.

import { flangeNominalSizeIn, pipeOdIn } from "./flangeGeometry";
import { findSymbol } from "./symbolRegistry";
import { rackParams } from "./rackGeometry";
import { boundReducerAt, junctionHostOwner } from "./pipeReducerModel";
import { attachmentInterfaceErrors } from "./pipeAttachments";

const EPS = 1e-9;

/** Grade centerline (in) for pipe with no stored/support elevation. */
export const DEFAULT_PIPE_ELEVATION_IN = 30;
/** Extra vertical clearance (in) between crossing pipes, beyond touching. */
export const CROSSING_CLEARANCE_IN = 1;
/**
 * How close (plan in) a run end must land to another run to connect.
 * (Moved here from pipeAttachments.js: the junction tolerance is a
 * geometric constant of the pipe-crossing model; pipeAttachments
 * re-exports it.)
 */
export const JUNCTION_TOLERANCE_IN = 0.5;
/**
 * Plan/elevation tolerance (in) for two pipe centerlines to count as
 * meeting at a shared flanged face. Faces meet; barrel-overlap reach
 * is NOT a connection (D668-004).
 */
export const CONNECTION_FACE_TOLERANCE_IN = 0.5;

/** True when a run carries any stored elevation (base or per-vertex). */
export function runHasStoredElevation(run) {
  return (
    run?.elevationIn != null ||
    (Array.isArray(run?.elevIn) && run.elevIn.some((v) => v != null))
  );
}

/** Resolved centerline elevation of vertex i, or null when fully derived. */
export function vertexElevationIn(run, i) {
  const v = Array.isArray(run?.elevIn) ? run.elevIn[i] : undefined;
  if (v != null) return v;
  return run?.elevationIn ?? null;
}

function resolvedVertex(run, i) {
  return vertexElevationIn(run, i) ?? DEFAULT_PIPE_ELEVATION_IN;
}

/** Per-segment elevations from the stored profile (max of endpoints). */
export function storedSegmentElevations(run) {
  const pts = run?.points || [];
  const out = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    out.push(Math.max(resolvedVertex(run, i), resolvedVertex(run, i + 1)));
  }
  return out;
}

/**
 * Per-segment elevations DERIVED from supports, replicating the 3D
 * model's long-standing rule: a segment whose plan midpoint falls
 * inside a rack footprint rides at that rack's first-tier top of steel
 * plus the pipe radius (highest containing support wins); otherwise
 * the grade centerline applies.
 */
export function derivedSegmentElevations(design, run) {
  const racks = [];
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol?.rack) continue;
    const widthIn = inst.widthIn ?? symbol.widthIn;
    const depthIn = inst.depthIn ?? symbol.depthIn;
    if (!widthIn || !depthIn) continue;
    racks.push({ inst, widthIn, depthIn, elevationIn: rackParams(symbol, inst).elevationIn });
  }
  const diameterIn = run?.diameterIn ?? 2;
  const radiusIn = diameterIn / 2;
  const pts = run?.points || [];
  const out = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    let supportIn = null;
    for (const rack of racks) {
      const dx = midX - rack.inst.x;
      const dy = midY - rack.inst.y;
      const angle = (-(rack.inst.rotationDeg || 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= rack.widthIn / 2 && Math.abs(ly) <= rack.depthIn / 2) {
        const candidateIn = rack.elevationIn + radiusIn;
        supportIn = supportIn === null ? candidateIn : Math.max(supportIn, candidateIn);
      }
    }
    out.push(supportIn ?? DEFAULT_PIPE_ELEVATION_IN);
  }
  return out;
}

/** Per-segment centerline elevations for a run in a design. */
export function segmentElevationsForDesign(design, run) {
  return runHasStoredElevation(run)
    ? storedSegmentElevations(run)
    : derivedSegmentElevations(design, run);
}

/**
 * Per-VERTEX true centerline elevations for a run in a design — the
 * shared physical profile consumed by validation, rendering, and
 * connection checks alike (D668-002). Stored per-vertex elevations win;
 * gaps fall back to the run's base elevation, then to the standard
 * derived rule (endpoints take their segment's elevation, interior
 * vertices the higher adjacent one — the same rule the 3D joints use).
 */
export function vertexElevationsForDesign(design, run) {
  const pts = run?.points || [];
  if (pts.length === 0) return [];
  const derived = derivedSegmentElevations(design, run);
  const at = (i) => {
    if (i === 0) return derived[0];
    if (i === pts.length - 1) return derived[derived.length - 1];
    return Math.max(derived[i - 1], derived[i]);
  };
  if (!runHasStoredElevation(run)) return pts.map((_, i) => at(i));
  return pts.map((_, i) => {
    const v = vertexElevationIn(run, i);
    return v != null ? v : at(i);
  });
}

/**
 * The run's physical route: [{ x, y, zIn }] — plan position plus the
 * true centerline elevation at every vertex. Consecutive vertices with
 * the same plan position and different elevations are a vertical riser;
 * a vertex pair with different elevations is a sloped segment. This is
 * the single profile both validation and rendering read (D668-002):
 * a downward jog dips below its base elevation in the route, and every
 * consumer sees the same dip.
 */
export function physicalRouteIn(design, run) {
  const pts = run?.points || [];
  const elevs = vertexElevationsForDesign(design, run);
  return pts.map((p, i) => ({ x: p.x, y: p.y, zIn: elevs[i] ?? DEFAULT_PIPE_ELEVATION_IN }));
}

/** Minimum distance between two 3D segments (p1-q1, p2-q2). */
export function segSegDistance3D(p1, q1, p2, q2) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.zIn - p1.zIn };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.zIn - p2.zIn };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.zIn - p2.zIn };
  const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z;
  const e = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z;
  const f = d2.x * r.x + d2.y * r.y + d2.z * r.z;
  let s;
  let t;
  if (a <= EPS && e <= EPS) {
    return Math.hypot(r.x, r.y, r.z);
  }
  if (a <= EPS) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1.x * r.x + d1.y * r.y + d1.z * r.z;
    if (e <= EPS) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z;
      const denom = a * e - b * b;
      s = denom > EPS ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.zIn + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.zIn + d2.z * t };
  return Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z);
}

/** Vertical separation (in) two crossing centerlines need to not touch. */
export function requiredSeparationIn(diameterAIn, diameterBIn) {
  return pipeOdIn(diameterAIn) / 2 + pipeOdIn(diameterBIn) / 2 + CROSSING_CLEARANCE_IN;
}

/** Proper segment intersection (strictly interior to both), or null. */
export function properIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null; // parallel / collinear
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
}

/** Any segment intersection (endpoints included), or null. */
export function segmentIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
}

/**
 * Every crossing between two runs in the design:
 * [{ aRunId, bRunId, x, y, segA, segB, elevAIn, elevBIn, resolved }]
 * A crossing is a proper intersection of one segment from each run —
 * shared endpoints, junctions/tees (a run end on another run), and
 * attached equipment ends are connection points, never crossings.
 * `resolved` is true when the centerline separation at the crossing
 * already clears both pipe radii plus clearance.
 */
export function findPipeCrossings(design) {
  const runs = (design?.pipes || []).filter(
    (r) => Array.isArray(r.points) && r.points.length >= 2,
  );
  // ONE physical profile (R3): crossings interpolate the shared route
  // at the intersection point — a sloped segment is judged where it
  // actually passes, never by a flat per-segment elevation.
  const routes = new Map(runs.map((r) => [r.id, physicalRouteIn(design, r)]));
  const out = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const a = runs[i];
      const b = runs[j];
      const routeA = routes.get(a.id);
      const routeB = routes.get(b.id);
      for (let sa = 0; sa + 1 < routeA.length; sa += 1) {
        for (let sb = 0; sb + 1 < routeB.length; sb += 1) {
          const hit = properIntersection(routeA[sa], routeA[sa + 1], routeB[sb], routeB[sb + 1]);
          if (!hit) continue;
          const elevA = routeA[sa].zIn + hit.t * (routeA[sa + 1].zIn - routeA[sa].zIn);
          const elevB = routeB[sb].zIn + hit.u * (routeB[sb + 1].zIn - routeB[sb].zIn);
          const sep = Math.abs(elevA - elevB);
          out.push({
            aRunId: a.id,
            bRunId: b.id,
            x: hit.x,
            y: hit.y,
            segA: sa,
            segB: sb,
            tA: hit.t,
            tB: hit.u,
            elevAIn: elevA,
            elevBIn: elevB,
            resolved: sep >= requiredSeparationIn(a.diameterIn ?? 2, b.diameterIn ?? 2) - EPS,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Insert a vertical jog into `run` at a crossing on segment segIndex:
 * two vertical risers and a short level span straddling the crossing —
 * pre(base), up(target) at pre's plan position, span(target),
 * down(base) at span's plan position. The zero-plan-length pre->up and
 * span->down pairs ARE the risers (the shared physical route reads them
 * as vertical); the span clears the crossing by the required separation,
 * upward for an above-grade run and downward (an authored underpass
 * inside the burial envelope) for a buried one. One form serves both
 * directions, so validation and rendering always agree about the jog's
 * shape (D668-002): a V would flatten back under the max-of-endpoints
 * segment rule and the crossing would vanish from validation at its own
 * vertex.
 */
function insertJog(run, segIndex, X, targetElevIn, baseElevIn, otherDiameterIn) {
  const pts = run.points;
  const A = pts[segIndex];
  const B = pts[segIndex + 1];
  const segLen = Math.hypot(B.x - A.x, B.y - A.y);
  const elevIn = pts.map((_, i) => (Array.isArray(run.elevIn) ? run.elevIn[i] ?? null : null));
  if (!(segLen > 0)) return run;
  const ux = (B.x - A.x) / segLen;
  const uy = (B.y - A.y) / segLen;
  const distX = Math.hypot(X.x - A.x, X.y - A.y);
  const half = Math.min(Math.max(9, pipeOdIn(otherDiameterIn) + 6), segLen / 2);
  const at = (dist) => ({ x: A.x + ux * dist, y: A.y + uy * dist });
  // Clamp the riser plan positions inside the segment so a crossing
  // near a vertex still gets a real jog.
  const preDist = Math.min(Math.max(distX - half, 1), segLen - 1);
  const spanDist = Math.min(Math.max(distX + half, 1), segLen - 1);
  const prePlan = at(preDist);
  const spanPlan = at(spanDist);
  const inserts = [
    { point: prePlan, elevIn: baseElevIn },
    { point: { ...prePlan }, elevIn: targetElevIn },
    { point: spanPlan, elevIn: targetElevIn },
    { point: { ...spanPlan }, elevIn: baseElevIn },
  ];
  return {
    ...run,
    points: [
      ...pts.slice(0, segIndex + 1),
      ...inserts.map((ins) => ins.point),
      ...pts.slice(segIndex + 1),
    ],
    elevIn: [
      ...elevIn.slice(0, segIndex + 1),
      ...inserts.map((ins) => ins.elevIn),
      ...elevIn.slice(segIndex + 1),
    ],
  };
}

/**
 * Resolve every unresolved crossing involving `runId` by jogging THAT
 * run up over the other (the run being drawn/edited steps). Returns the
 * same design when the run has no unresolved crossings.
 *
 * A run with no stored elevation first has its derived profile baked
 * into per-vertex elevations (endpoints take their segment's elevation,
 * interior vertices the higher adjacent one — the same rule the 3D
 * joints use), so a rack-riding run keeps riding the rack after the
 * jog instead of dropping to the grade fallback.
 *
 * A jog that cannot actually clear — the inserted geometry still
 * conflicts with the other run or with the run itself (e.g. 12-in
 * pipes on a 10-in segment) — is REFUSED: the run is left unchanged
 * and the crossing stays honestly unresolved instead of rendering a
 * jog validation cannot defend (D668-002).
 */
export function applyCrossingJogs(design, runId) {
  let current = design;
  for (let iter = 0; iter < 24; iter += 1) {
    const run = (current.pipes || []).find((r) => r.id === runId);
    if (!run) return current;
    const open = findPipeCrossings(current)
      .filter((c) => !c.resolved && (c.aRunId === runId || c.bRunId === runId))
      .sort((c1, c2) => {
        const s1 = c1.aRunId === runId ? c1.segA : c1.segB;
        const s2 = c2.aRunId === runId ? c2.segA : c2.segB;
        return s1 - s2;
      });
    if (open.length === 0) return current;
    let work = run;
    if (!runHasStoredElevation(work)) {
      const derived = derivedSegmentElevations(current, work);
      const elevIn = work.points.map((_, i) =>
        i === 0
          ? derived[0]
          : i === work.points.length - 1
            ? derived[derived.length - 1]
            : Math.max(derived[i - 1], derived[i]),
      );
      work = { ...work, elevIn };
      current = {
        ...current,
        pipes: current.pipes.map((r) => (r.id === runId ? work : r)),
      };
      continue; // re-detect crossings against the baked profile first
    }
    const c = open[0];
    const mine = c.aRunId === runId
      ? { seg: c.segA, myElev: c.elevAIn, otherElev: c.elevBIn, otherId: c.bRunId }
      : { seg: c.segB, myElev: c.elevBIn, otherElev: c.elevAIn, otherId: c.aRunId };
    const other = (current.pipes || []).find((r) => r.id === mine.otherId);
    const myDiam = work.diameterIn ?? 2;
    const otherDiam = other?.diameterIn ?? 2;
    // The jog must clear the other pipe AND the run's own body at the
    // elbow: a large pipe stepping over a small one needs the span far
    // enough from its un-jogged route that its own OD clears, not just
    // the small pipe's separation (D668-002/D668-003).
    const otherSep = requiredSeparationIn(myDiam, otherDiam);
    const selfSep = requiredSeparationIn(myDiam, myDiam);
    // A buried run prefers DOWN (authored underpass inside its burial
    // envelope); an above-grade run prefers up over the other. If the
    // preferred direction introduces new envelope conflicts (congested
    // plan), the alternative direction is tried before refusing.
    const buried = runIsBuried(current, work);
    const targets = buried
      ? [
          Math.min(mine.otherElev - otherSep, mine.myElev - selfSep),
          Math.max(mine.otherElev + otherSep, mine.myElev + selfSep),
        ]
      : [
          Math.max(mine.otherElev + otherSep, mine.myElev + selfSep),
          Math.min(mine.otherElev - otherSep, mine.myElev - selfSep),
        ];
    const beforeEnv = new Set(
      envelopeConflictErrors(current).filter((e) => e.includes(runId)),
    );
    let accepted = null;
    for (const target of targets) {
      const jogged = insertJog(work, mine.seg, { x: c.x, y: c.y }, target, mine.myElev, otherDiam);
      const candidate = {
        ...current,
        pipes: current.pipes.map((r) => (r.id === runId ? jogged : r)),
      };
      // The target crossing must be resolved, and the jog must not
      // introduce NEW envelope errors for this run. Other pre-existing
      // crossings are handled by subsequent loop iterations (D668-002).
      const targetResolved = !findPipeCrossings(candidate).some(
        (k) =>
          !k.resolved &&
          ((k.aRunId === c.aRunId && k.bRunId === c.bRunId) ||
            (k.aRunId === c.bRunId && k.bRunId === c.aRunId)) &&
          Math.hypot(k.x - c.x, k.y - c.y) < 12,
      );
      const newEnv = envelopeConflictErrors(candidate)
        .filter((e) => e.includes(runId))
        .some((e) => !beforeEnv.has(e));
      if (targetResolved && !newEnv) {
        accepted = candidate;
        break;
      }
    }
    // A refused jog stops the loop — retrying the same crossing cannot help.
    if (!accepted) return current;
    current = accepted;
  }
  return current;
}

/**
 * True when a run is buried: flagged underground, or its stored
 * profile sits entirely below grade. Buried runs jog UNDER other
 * pipes (an authored underpass inside the burial envelope) — never an
 * automatic overpass that breaks the surface.
 */
export function runIsBuried(design, run) {
  if (run?.underground === true) return true;
  if (!runHasStoredElevation(run)) return false;
  return segmentElevationsForDesign(design, run).every((e) => e < 0);
}

/**
 * The modeled pipe-connection graph: edges exist ONLY where a run's end
 * is explicitly junctioned onto another run (its `junctions` record)
 * AND the physical interface validates (D668-004): the host run exists,
 * the end actually lands on a host segment (no fallback to the first
 * segment — a stale/off-route reference is refused, not approximated),
 * and the two centerlines meet at a shared face within
 * CONNECTION_FACE_TOLERANCE_IN. Plan proximity and bare junction ids
 * never create edges — connectivity is modeled AND verified.
 * Returns Map<runId, Set<runId>> (undirected).
 */
export function pipeConnectionGraph(design) {
  const graph = new Map();
  const link = (a, b) => {
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a).add(b);
  };
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    for (const end of ["start", "end"]) {
      const edge = validatedJunctionEdge(design, run, end);
      if (edge.status === "ok") {
        link(run.id, edge.host.id);
        link(edge.host.id, run.id);
      }
    }
  }
  return graph;
}

/**
 * Validate one claimed pipe-to-pipe junction against the physical
 * interface (D668-004). Returns one of:
 *   { status: "no-edge" }   — no junction record on this end;
 *   { status: "no-host" }   — the named host run does not exist;
 *   { status: "off-route" } — the end touches no host segment
 *                              (stale/off-route reference: refused);
 *   { status: "elevation" } — the end is on the host's route but the
 *                              faces do not meet (host, hostElevIn,
 *                              myElevIn included for the message);
 *   { status: "reducer" }  — the faces meet but the two sides differ
 *                              in nominal size and no reducer's owned
 *                              interfaces bind the transition (R1);
 *   { status: "ok", host, point, hostElevIn, myElevIn, hostSegIndex }.
 * Faces meet within CONNECTION_FACE_TOLERANCE_IN — barrel-overlap
 * reach is not a connection.
 */
export function validatedJunctionEdge(design, run, end) {
  const hostId = run.junctions?.[end]?.runId;
  if (!hostId || hostId === run.id) return { status: "no-edge" };
  const host = (design?.pipes || []).find((r) => r.id === hostId);
  if (!host || !Array.isArray(host.points) || host.points.length < 2) {
    return { status: "no-host" };
  }
  const idx = end === "start" ? 0 : run.points.length - 1;
  const point = run.points[idx];
  const route = physicalRouteIn(design, host);
  let best = null;
  for (let i = 0; i + 1 < route.length; i += 1) {
    const hit = pointSegmentDistance(point, route[i], route[i + 1]);
    if (hit.distance <= JUNCTION_TOLERANCE_IN + 1e-9 && (!best || hit.distance < best.distance)) {
      best = { i, t: hit.t, distance: hit.distance };
    }
  }
  if (!best) return { status: "off-route", host, point };
  const hostElevIn = route[best.i].zIn + best.t * (route[best.i + 1].zIn - route[best.i].zIn);
  const myElevIn = vertexElevationsForDesign(design, run)[idx];
  if (Math.abs(myElevIn - hostElevIn) > CONNECTION_FACE_TOLERANCE_IN) {
    return { status: "elevation", host, point, hostElevIn, myElevIn };
  }
  // R1/F1: a mixed-size transition is an edge ONLY when a reducer's
  // owned interfaces bind it — and the reducer must own THIS exact
  // pair of participating interfaces: this run's end and the host
  // interface it taps (the host's own end for a coupled joint, else
  // the tapped host segment). A reducer owned by a different,
  // coincident transition authorizes nothing here. A size warning
  // elsewhere never substitutes for the edge.
  let reducerId = null;
  if (flangeNominalSizeIn(run.diameterIn ?? 2) !== flangeNominalSizeIn(host.diameterIn ?? 2)) {
    const neighbor = run.points[end === "start" ? 1 : run.points.length - 2];
    const branchAxisDeg =
      (Math.atan2(neighbor.y - point.y, neighbor.x - point.x) * 180) / Math.PI;
    const bound = boundReducerAt(design, {
      x: point.x,
      y: point.y,
      elevationIn: myElevIn,
      sides: [
        {
          sizeIn: run.diameterIn ?? 2,
          dirDeg: branchAxisDeg,
          owner: { kind: "run-end", runId: run.id, end },
        },
        {
          sizeIn: host.diameterIn ?? 2,
          dirDeg: branchAxisDeg + 180,
          owner: junctionHostOwner(design, host, point),
        },
      ],
    });
    if (!bound) {
      return { status: "reducer", host, point, hostElevIn, myElevIn, hostSegIndex: best.i };
    }
    reducerId = bound.id;
  }
  return { status: "ok", host, point, hostElevIn, myElevIn, hostSegIndex: best.i, reducerId };
}

/**
 * Validated contact points between two runs: the plan points where a
 * verified junction edge joins them. Used to exempt modeled connections
 * (and only modeled connections) from the envelope-conflict checks.
 */
export function validatedContactPoints(design, runA, runB) {
  const pts = [];
  for (const end of ["start", "end"]) {
    const edge = validatedJunctionEdge(design, runA, end);
    if (edge.status === "ok" && edge.host.id === runB.id) pts.push(edge.point);
  }
  for (const end of ["start", "end"]) {
    const edge = validatedJunctionEdge(design, runB, end);
    if (edge.status === "ok" && edge.host.id === runA.id) pts.push(edge.point);
  }
  return pts;
}

/** The run designated as a service's source / battery-limit inlet. */
export function serviceSourceRun(design, serviceId) {
  return (design?.pipes || []).find((r) => r.sourceOf === serviceId) || null;
}

/**
 * True when `runId` reaches its service's designated source through
 * modeled junctions, traversing ONLY runs carrying the same closed
 * service identity. A run with a different (or no) service identity
 * blocks the path — labels, colors, and proximity prove nothing.
 */
export function runReachesSource(design, runId, serviceId) {
  const source = serviceSourceRun(design, serviceId);
  if (!source) return false;
  const byId = new Map((design?.pipes || []).map((r) => [r.id, r]));
  if (byId.get(runId)?.utility !== serviceId) return false;
  const graph = pipeConnectionGraph(design);
  const seen = new Set([runId]);
  const queue = [runId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === source.id) return true;
    for (const next of graph.get(current) || []) {
      if (seen.has(next)) continue;
      if (byId.get(next)?.utility !== serviceId) continue; // wrong/no identity blocks
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * The same-service junction path from `runId` to its service's
 * designated source, as a list of run ids starting at `runId` and
 * ending at the source — or null when no such path exists. Used by
 * the utility connection table evidence.
 */
export function runPathToSource(design, runId, serviceId) {
  const source = serviceSourceRun(design, serviceId);
  if (!source) return null;
  const byId = new Map((design?.pipes || []).map((r) => [r.id, r]));
  if (byId.get(runId)?.utility !== serviceId) return null;
  const graph = pipeConnectionGraph(design);
  const prev = new Map([[runId, null]]);
  const queue = [runId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === source.id) {
      const path = [];
      let node = current;
      while (node !== null) {
        path.unshift(node);
        node = prev.get(node);
      }
      return path;
    }
    for (const next of graph.get(current) || []) {
      if (prev.has(next)) continue;
      if (byId.get(next)?.utility !== serviceId) continue;
      prev.set(next, current);
      queue.push(next);
    }
  }
  return null;
}

/**
 * Cross-service tee findings: a modeled junction joining runs of
 * different closed service identities (utility ↔ process, nitrogen ↔
 * water, firewater ↔ anything) is a misconnection, never a supply.
 * Process-to-process junctions (both identities empty) are normal.
 */
export function crossServiceErrors(design) {
  const errors = [];
  const byId = new Map((design?.pipes || []).map((r) => [r.id, r]));
  const identity = (run) => (typeof run?.utility === "string" ? run.utility : null);
  const seen = new Set();
  for (const run of design?.pipes || []) {
    for (const end of ["start", "end"]) {
      const hostId = run.junctions?.[end]?.runId;
      if (!hostId || hostId === run.id) continue;
      const host = byId.get(hostId);
      if (!host) continue;
      const a = identity(run);
      const b = identity(host);
      if (a === b) continue;
      if (a === null && b === null) continue;
      const key = [run.id, hostId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(
        `Pipe run ${run.id} (${a || "process"}) is junctioned to pipe run ${host.id} (${b || "process"}) — different services must not be teed into each other.`,
      );
    }
  }
  return errors;
}

/**
 * The flanged connections of the design (D3): every pipe end attached
 * to an equipment nozzle (kind "nozzle") or landed on another run
 * (kind "junction") is a flanged joint.
 * [{ runId, end, kind, x, y, axisDeg, sizeIn, elevationIn }]
 * axisDeg is the pipe's plan direction at the connection; elevationIn
 * is the run's centerline elevation at that end's segment.
 */
export function connectionFlanges(design) {
  const out = [];
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    const vertexElevs = vertexElevationsForDesign(design, run);
    for (const end of ["start", "end"]) {
      const kind = run.attachments?.[end]
        ? "nozzle"
        : run.junctions?.[end]
          ? "junction"
          : null;
      if (!kind) continue;
      const idx = end === "start" ? 0 : run.points.length - 1;
      const neighbor = run.points[end === "start" ? 1 : run.points.length - 2];
      const point = run.points[idx];
      const axisDeg = (Math.atan2(neighbor.y - point.y, neighbor.x - point.x) * 180) / Math.PI;
      out.push({
        runId: run.id,
        end,
        kind,
        x: point.x,
        y: point.y,
        axisDeg,
        sizeIn: run.diameterIn ?? 2,
        elevationIn: vertexElevs[idx],
      });
    }
  }
  return out;
}

/** Distance from a point to a segment (and the closest point on it). */
export function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { distance: Math.hypot(p.x - proj.x, p.y - proj.y), proj, t };
}

/** Length (in) by which two segments overlap on the same line, or 0. */
export function collinearOverlapIn(p1, p2, p3, p4) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return 0;
  const ux = dx / len;
  const uy = dy / len;
  // Both other endpoints must sit on this segment's line.
  const off = (p) => Math.abs((p.x - p1.x) * uy - (p.y - p1.y) * ux);
  if (off(p3) > 1e-6 || off(p4) > 1e-6) return 0;
  const s3 = (p3.x - p1.x) * ux + (p3.y - p1.y) * uy;
  const s4 = (p4.x - p1.x) * ux + (p4.y - p1.y) * uy;
  const lo = Math.max(0, Math.min(s3, s4));
  const hi = Math.min(len, Math.max(s3, s4));
  return Math.max(0, hi - lo);
}

/**
 * Developed (3D) route length of a run in a design: the plan length of
 * its segments plus the vertical risers where its effective elevation
 * changes. The plan length (pipingGeometry) stays the 2D measure; this
 * is the length of pipe the route actually takes.
 */
export function developedRunLengthIn(design, run) {
  if (!Array.isArray(run?.points) || run.points.length < 2) return 0;
  // The true 3D length of the shared physical route (R3): each
  // segment contributes its full spatial length — plan, riser, or
  // slope alike — from the same profile every consumer reads.
  const route = physicalRouteIn(design, run);
  let total = 0;
  for (let i = 0; i + 1 < route.length; i += 1) {
    total += Math.hypot(
      route[i + 1].x - route[i].x,
      route[i + 1].y - route[i].y,
      route[i + 1].zIn - route[i].zIn,
    );
  }
  return total;
}

function segmentPassesThroughFootprint(p, q, inst, symbol) {
  const w = inst.widthIn ?? symbol.widthIn;
  const d = inst.depthIn ?? symbol.depthIn;
  if (!(w > 0) || !(d > 0)) return false;
  const rad = ((inst.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const toLocal = (pt) => {
    const dx = pt.x - inst.x;
    const dy = pt.y - inst.y;
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  };
  const a = toLocal(p);
  const b = toLocal(q);
  if (symbol.shape3d === "vcyl" || symbol.shape3d === "sphere") {
    const r = Math.min(w, d) / 2;
    return pointSegmentDistance({ x: 0, y: 0 }, a, b).distance < r - EPS;
  }
  const hw = w / 2;
  const hh = d / 2;
  const inside = (pt) => Math.abs(pt.x) < hw - EPS && Math.abs(pt.y) < hh - EPS;
  if (inside(a) || inside(b)) return true;
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  for (let i = 0; i < 4; i += 1) {
    if (segmentIntersection(a, b, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

/** validateDesign messages for run elevation data, crossings, and pass-throughs. */
export function pipeCrossingErrors(design) {
  const errors = [];
  for (const run of design?.pipes || []) {
    if (run.elevationIn !== undefined && !Number.isFinite(run.elevationIn)) {
      errors.push(`Pipe run ${run.id} has a bad elevation.`);
    }
    if (run.elevIn !== undefined) {
      const bad =
        !Array.isArray(run.elevIn) ||
        run.elevIn.length !== (run.points || []).length ||
        run.elevIn.some((v) => v !== null && !Number.isFinite(v));
      if (bad) errors.push(`Pipe run ${run.id} has malformed vertex elevations.`);
    }
  }
  const seenCross = new Set();
  for (const c of findPipeCrossings(design)) {
    if (c.resolved) continue;
    const key = `${c.aRunId}|${c.bRunId}|${Math.round(c.x)}|${Math.round(c.y)}`;
    if (seenCross.has(key)) continue;
    seenCross.add(key);
    errors.push(
      `Pipe run ${c.aRunId} crosses pipe run ${c.bRunId} at the same elevation — a pipe must change elevation to cross another pipe.`,
    );
  }
  // A run crossing ITSELF at an unresolved elevation is the same defect.
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 4) continue;
    const route = physicalRouteIn(design, run);
    let flagged = false;
    for (let i = 0; i + 1 < route.length && !flagged; i += 1) {
      for (let j = i + 2; j + 1 < route.length; j += 1) {
        // A closed loop's first/last segments meet at the closing
        // vertex — an endpoint touch, which properIntersection already
        // excludes; no special case needed here.
        const hit = properIntersection(route[i], route[i + 1], route[j], route[j + 1]);
        if (!hit) continue;
        const elevI = route[i].zIn + hit.t * (route[i + 1].zIn - route[i].zIn);
        const elevJ = route[j].zIn + hit.u * (route[j + 1].zIn - route[j].zIn);
        const sep = Math.abs(elevI - elevJ);
        if (sep < requiredSeparationIn(run.diameterIn ?? 2, run.diameterIn ?? 2) - EPS) {
          errors.push(`Pipe run ${run.id} crosses itself at the same elevation.`);
          flagged = true;
          break;
        }
      }
    }
  }
  // Collinear overlaps: two runs sharing the same line at the same
  // elevation occupy the same space (a shared plan point at an endpoint
  // is a joint, not an overlap). Elevations are the physical route's
  // per-segment RANGES (R3) — two sloped segments conflict when their
  // ranges come within the required separation anywhere on the overlap.
  const runList = (design?.pipes || []).filter((r) => Array.isArray(r.points) && r.points.length >= 2);
  const seenOverlap = new Set();
  for (let a = 0; a < runList.length; a += 1) {
    for (let b = a + 1; b < runList.length; b += 1) {
      const ra = runList[a];
      const rb = runList[b];
      const routeA = physicalRouteIn(design, ra);
      const routeB = physicalRouteIn(design, rb);
      for (let i = 0; i + 1 < ra.points.length; i += 1) {
        for (let j = 0; j + 1 < rb.points.length; j += 1) {
          const overlap = collinearOverlapIn(ra.points[i], ra.points[i + 1], rb.points[j], rb.points[j + 1]);
          if (overlap <= 1) continue;
          const loA = Math.min(routeA[i].zIn, routeA[i + 1].zIn);
          const hiA = Math.max(routeA[i].zIn, routeA[i + 1].zIn);
          const loB = Math.min(routeB[j].zIn, routeB[j + 1].zIn);
          const hiB = Math.max(routeB[j].zIn, routeB[j + 1].zIn);
          const rangeGap = Math.max(0, Math.max(loA, loB) - Math.min(hiA, hiB));
          if (rangeGap >= requiredSeparationIn(ra.diameterIn ?? 2, rb.diameterIn ?? 2) - EPS) continue;
          const key = `${ra.id}|${rb.id}`;
          if (seenOverlap.has(key)) continue;
          seenOverlap.add(key);
          errors.push(
            `Pipe runs ${ra.id} and ${rb.id} overlap along the same route at the same elevation.`,
          );
        }
      }
    }
  }
  // Envelope conflicts beyond plan crossings (D668-003): unmodeled
  // end-to-interior contacts, parallel runs inside each other's
  // outside-radius envelopes, and horizontal runs crossing vertical
  // risers. All are measured on the shared physical route in 3D; only
  // VALIDATED modeled connections exempt a contact (never a bare
  // attachment id, never proximity).
  errors.push(...envelopeConflictErrors(design));
  // A run passing through an equipment footprint it does not connect
  // to. The exemption is OWNED and segment-exact (F2): only the one
  // segment adjacent to a VERIFIED attached end of THIS run at THIS
  // vessel is exempt — never another run sharing the nozzle point,
  // never the owner's other segments, never the whole run because an
  // attachment names the vessel (D668-003).
  const verified = verifiedAttachments(design);
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    // Buried runs pass underneath plan symbols legitimately: the
    // footprint rule governs above-grade equipment, not underground
    // obstruction volumes (modeled separately where they exist).
    if (runIsBuried(design, run)) continue;
    for (const inst of design?.symbols || []) {
      if (inst.domain !== "processEquipment") continue;
      const symbol = findSymbol(inst.domain, inst.symbolId);
      if (!symbol || symbol.rack) continue; // pipes ride racks by design
      let flagged = false;
      for (let i = 0; i + 1 < run.points.length && !flagged; i += 1) {
        const a = run.points[i];
        const b = run.points[i + 1];
        const exempt = verified.some(
          (t) => t.runId === run.id && t.symbolId === inst.id && t.segmentIndex === i,
        );
        if (exempt) continue;
        if (segmentPassesThroughFootprint(a, b, inst, symbol)) {
          errors.push(
            `Pipe run ${run.id} passes through ${symbol.label} (${inst.tag || inst.id}) without connecting to it.`,
          );
          flagged = true;
        }
      }
    }
  }
  return errors;
}

/**
 * VERIFIED attachment tuples (F2): one record per run end whose
 * claimed nozzle attachment passes the ONE shared full-interface
 * predicate (attachmentInterfaceErrors in pipeAttachments.js — the
 * same check connectionCompatibilityErrors reports): the named face
 * resolves, the end sits on it in plan and elevation, the approach
 * follows the face normal (or a riser for a vertical face), and the
 * nominal size matches or an owned reducer binds the pair.
 * [{ runId, end, segmentIndex, symbolId, anchorId, x, y }] —
 * segmentIndex is the ONE segment adjacent to the verified end, the
 * only segment any exemption may cover. A stale reference, an
 * off-face end, a wrong approach, or an unreduced size mismatch
 * verifies nothing and exempts nothing.
 */
export function verifiedAttachments(design) {
  const out = [];
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    for (const end of ["start", "end"]) {
      const ref = run.attachments?.[end];
      if (!ref) continue;
      if (attachmentInterfaceErrors(design, run, end).length > 0) continue;
      const idx = end === "start" ? 0 : run.points.length - 1;
      const point = run.points[idx];
      out.push({
        runId: run.id,
        end,
        segmentIndex: end === "start" ? 0 : run.points.length - 2,
        symbolId: ref.symbolId,
        anchorId: ref.anchorId,
        x: point.x,
        y: point.y,
      });
    }
  }
  return out;
}

/**
 * Verified attachment tuples grouped by vessel instance id (F2) —
 * the tuples themselves, never bare plan points: ownership (run,
 * end, segment, anchor) is the information the penetration exemption
 * is decided on.
 */
export function verifiedAttachmentPoints(design) {
  const out = new Map();
  for (const t of verifiedAttachments(design)) {
    if (!out.has(t.symbolId)) out.set(t.symbolId, []);
    out.get(t.symbolId).push(t);
  }
  return out;
}

/**
 * 3D envelope conflicts between run pairs (D668-003): unmodeled
 * end-to-interior contacts, parallel runs inside the outside-radius
 * clearance envelopes, and horizontal runs crossing vertical risers.
 * Plan crossings already reported by findPipeCrossings are skipped
 * (that function owns strictly-interior intersections); modeled
 * connections and end-to-end touches are never conflicts.
 */
export function envelopeConflictErrors(design) {
  const errors = [];
  const runs = (design?.pipes || []).filter(
    (r) => Array.isArray(r.points) && r.points.length >= 2,
  );
  const routes = new Map(runs.map((r) => [r.id, physicalRouteIn(design, r)]));
  const seen = new Set();
  const flag = (key, message) => {
    if (seen.has(key)) return;
    seen.add(key);
    errors.push(message);
  };
  for (let a = 0; a < runs.length; a += 1) {
    for (let b = a; b < runs.length; b += 1) {
      const ra = runs[a];
      const rb = runs[b];
      const sameRun = ra.id === rb.id;
      const routeA = routes.get(ra.id);
      const routeB = routes.get(rb.id);
      const sep = requiredSeparationIn(ra.diameterIn ?? 2, rb.diameterIn ?? 2);
      const contacts = sameRun ? [] : validatedContactPoints(design, ra, rb);
      const nearContact = (p) =>
        contacts.some((c) => Math.hypot(c.x - p.x, c.y - p.y) <= JUNCTION_TOLERANCE_IN + 1);
      for (let i = 0; i + 1 < routeA.length; i += 1) {
        for (let j = 0; j + 1 < routeB.length; j += 1) {
          // A jog's elbows (|i-j|==2 across a riser) are the pipe's own
          // designed bends, not a self-contact — only a run doubling back
          // on itself at route distance belongs here (D668-002).
          if (sameRun && Math.abs(i - j) <= 2) continue;
          const A1 = routeA[i];
          const A2 = routeA[i + 1];
          const B1 = routeB[j];
          const B2 = routeB[j + 1];
          const d3 = segSegDistance3D(A1, A2, B1, B2);
          if (d3 >= sep - EPS) continue;
          // Strictly-interior plan intersections belong to
          // findPipeCrossings — skip them here to avoid double-reporting.
          if (properIntersection(A1, A2, B1, B2)) continue;
          const planHit = segmentIntersection(A1, A2, B1, B2);
          if (planHit && (nearContact(planHit) || nearContact(A1) || nearContact(B1))) continue;
          if (!planHit && (nearContact(A1) || nearContact(A2) || nearContact(B1) || nearContact(B2))) {
            continue;
          }
          const endOnSeg = (p, q1, q2) => {
            const hit = pointSegmentDistance(p, q1, q2);
            return { dist: hit.distance, t: hit.t };
          };
          const a1 = endOnSeg(A1, B1, B2);
          const a2 = endOnSeg(A2, B1, B2);
          const b1 = endOnSeg(B1, A1, A2);
          const b2 = endOnSeg(B2, A1, A2);
          const interior = (e) => e.dist <= JUNCTION_TOLERANCE_IN && e.t > EPS && e.t < 1 - EPS;
          const atEndpoint = (e) => e.dist <= JUNCTION_TOLERANCE_IN && (e.t <= EPS || e.t >= 1 - EPS);
          const aEndInteriorB = interior(a1) || interior(a2);
          const bEndInteriorA = interior(b1) || interior(b2);
          const aEndAtBEnd = atEndpoint(a1) || atEndpoint(a2);
          const bEndAtAEnd = atEndpoint(b1) || atEndpoint(b2);
          if (sameRun) {
            // A closed loop's start/end meeting at the closure point is
            // intentional, not a self-contact. Adjacent segments (|i-j|<=2)
            // are the pipe's own elbows (D668-002).
            const nSeg = routeA.length - 1;
            const first = routeA[0];
            const last = routeA[routeA.length - 1];
            const isClosedLoop =
              Math.hypot(first.x - last.x, first.y - last.y) <= JUNCTION_TOLERANCE_IN &&
              Math.abs(first.zIn - last.zIn) <= JUNCTION_TOLERANCE_IN;
            const isClosure =
              isClosedLoop && ((i === 0 && j === nSeg - 1) || (j === 0 && i === nSeg - 1));
            if (isClosure) continue;
            // A run touching itself away from adjacent segments.
            flag(`${ra.id}|self|${i}|${j}`, `Pipe run ${ra.id} contacts itself inside the clearance envelope.`);
            continue;
          }
          // End-to-end touch (both ends within tolerance of the other's
          // endpoint): a route corner, never a conflict.
          if ((aEndAtBEnd || bEndAtAEnd) && !(aEndInteriorB || bEndInteriorA)) continue;
          const riserA = Math.hypot(A2.x - A1.x, A2.y - A1.y) < 1e-9;
          const riserB = Math.hypot(B2.x - B1.x, B2.y - B1.y) < 1e-9;
          if (riserA || riserB) {
            // A vertical riser meeting another run's envelope: a
            // penetration, not a model-the-junction contact.
            const riserId = riserA ? ra.id : rb.id;
            const otherId = riserA ? rb.id : ra.id;
            flag(
              `${riserId}|${otherId}|riser`,
              `Pipe run ${otherId} crosses the riser of pipe run ${riserId} inside the clearance envelope.`,
            );
            continue;
          }
          if (aEndInteriorB || bEndInteriorA) {
            // An end landing on the other's route with no validated
            // junction: an unmodeled contact, never a supply, never
            // silent (D668-003).
            const endId = aEndInteriorB ? ra.id : rb.id;
            const hostId = aEndInteriorB ? rb.id : ra.id;
            flag(
              `${endId}|${hostId}|contact`,
              `Pipe run ${endId} has an unmodeled contact with pipe run ${hostId} — model the junction or move the run.`,
            );
            continue;
          }
          flag(
            `${ra.id}|${rb.id}|${i}|${j}`,
            `Pipe runs ${ra.id} and ${rb.id} run inside each other's clearance envelope.`,
          );
        }
      }
    }
  }
  return errors;
}
