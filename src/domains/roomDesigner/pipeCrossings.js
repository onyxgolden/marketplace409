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

import { pipeOdIn } from "./flangeGeometry";
import { findSymbol } from "./symbolRegistry";
import { rackParams } from "./rackGeometry";

const EPS = 1e-9;

/** Grade centerline (in) for pipe with no stored/support elevation. */
export const DEFAULT_PIPE_ELEVATION_IN = 30;
/** Extra vertical clearance (in) between crossing pipes, beyond touching. */
export const CROSSING_CLEARANCE_IN = 1;

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
  const elevations = new Map(runs.map((r) => [r.id, segmentElevationsForDesign(design, r)]));
  const out = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const a = runs[i];
      const b = runs[j];
      const elevA = elevations.get(a.id);
      const elevB = elevations.get(b.id);
      for (let sa = 0; sa + 1 < a.points.length; sa += 1) {
        for (let sb = 0; sb + 1 < b.points.length; sb += 1) {
          const hit = properIntersection(a.points[sa], a.points[sa + 1], b.points[sb], b.points[sb + 1]);
          if (!hit) continue;
          const sep = Math.abs(elevA[sa] - elevB[sb]);
          out.push({
            aRunId: a.id,
            bRunId: b.id,
            x: hit.x,
            y: hit.y,
            segA: sa,
            segB: sb,
            tA: hit.t,
            tB: hit.u,
            elevAIn: elevA[sa],
            elevBIn: elevB[sb],
            resolved: sep >= requiredSeparationIn(a.diameterIn ?? 2, b.diameterIn ?? 2) - EPS,
          });
        }
      }
    }
  }
  return out;
}

/** Insert a vertical jog into `run` at a crossing on segment segIndex. */
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
  const inserts = []; // { point, elevIn } in along-segment order
  if (distX < 1) {
    elevIn[segIndex] = targetElevIn; // crossing at the vertex: step the vertex
  } else if (segLen - distX < 1) {
    elevIn[segIndex + 1] = targetElevIn;
  } else {
    if (distX - half >= 1) {
      inserts.push({ point: { x: X.x - ux * half, y: X.y - uy * half }, elevIn: baseElevIn });
    }
    inserts.push({ point: { x: X.x, y: X.y }, elevIn: targetElevIn });
    if (segLen - distX - half >= 1) {
      inserts.push({ point: { x: X.x + ux * half, y: X.y + uy * half }, elevIn: baseElevIn });
    }
  }
  if (inserts.length === 0) return { ...run, elevIn };
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
    const separation = requiredSeparationIn(work.diameterIn ?? 2, other?.diameterIn ?? 2);
    // A buried run jogs DOWN (authored underpass inside its burial
    // envelope); an above-grade run jogs up over the other.
    const target = runIsBuried(current, work)
      ? mine.otherElev - separation
      : mine.otherElev + separation;
    const jogged = insertJog(work, mine.seg, { x: c.x, y: c.y }, target, mine.myElev, other?.diameterIn ?? 2);
    current = {
      ...current,
      pipes: current.pipes.map((r) => (r.id === runId ? jogged : r)),
    };
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
 * The modeled pipe-connection graph: edges exist ONLY where a run's
 * end is explicitly junctioned onto another run (its `junctions`
 * record). Plan proximity and x/y intersections never create edges —
 * connectivity is modeled, not inferred.
 * Returns Map<runId, Set<runId>> (undirected).
 */
export function pipeConnectionGraph(design) {
  const graph = new Map();
  const link = (a, b) => {
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a).add(b);
  };
  for (const run of design?.pipes || []) {
    for (const end of ["start", "end"]) {
      const host = run.junctions?.[end]?.runId;
      if (host && host !== run.id) {
        link(run.id, host);
        link(host, run.id);
      }
    }
  }
  return graph;
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
    const segElevs = segmentElevationsForDesign(design, run);
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
        elevationIn: segElevs[end === "start" ? 0 : segElevs.length - 1],
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
  const elevs = segmentElevationsForDesign(design, run);
  let total = 0;
  for (let i = 0; i + 1 < run.points.length; i += 1) {
    total += Math.hypot(run.points[i + 1].x - run.points[i].x, run.points[i + 1].y - run.points[i].y);
    if (i > 0) total += Math.abs(elevs[i] - elevs[i - 1]);
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
    const elevs = segmentElevationsForDesign(design, run);
    let flagged = false;
    for (let i = 0; i + 1 < run.points.length && !flagged; i += 1) {
      for (let j = i + 2; j + 1 < run.points.length; j += 1) {
        // A closed loop's first/last segments meet at the closing
        // vertex — an endpoint touch, which properIntersection already
        // excludes; no special case needed here.
        const hit = properIntersection(run.points[i], run.points[i + 1], run.points[j], run.points[j + 1]);
        if (!hit) continue;
        const sep = Math.abs(elevs[i] - elevs[j]);
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
  // is a joint, not an overlap).
  const runList = (design?.pipes || []).filter((r) => Array.isArray(r.points) && r.points.length >= 2);
  const seenOverlap = new Set();
  for (let a = 0; a < runList.length; a += 1) {
    for (let b = a + 1; b < runList.length; b += 1) {
      const ra = runList[a];
      const rb = runList[b];
      const ea = segmentElevationsForDesign(design, ra);
      const eb = segmentElevationsForDesign(design, rb);
      for (let i = 0; i + 1 < ra.points.length; i += 1) {
        for (let j = 0; j + 1 < rb.points.length; j += 1) {
          const overlap = collinearOverlapIn(ra.points[i], ra.points[i + 1], rb.points[j], rb.points[j + 1]);
          if (overlap <= 1) continue;
          if (Math.abs(ea[i] - eb[j]) >= requiredSeparationIn(ra.diameterIn ?? 2, rb.diameterIn ?? 2) - EPS) continue;
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
  const attachedTo = (run) =>
    new Set(Object.values(run.attachments || {}).map((ref) => ref?.symbolId).filter(Boolean));
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    // Buried runs pass underneath plan symbols legitimately: the
    // footprint rule governs above-grade equipment, not underground
    // obstruction volumes (modeled separately where they exist).
    if (runIsBuried(design, run)) continue;
    const exempt = attachedTo(run);
    for (const inst of design?.symbols || []) {
      if (inst.domain !== "processEquipment" || exempt.has(inst.id)) continue;
      const symbol = findSymbol(inst.domain, inst.symbolId);
      if (!symbol || symbol.rack) continue; // pipes ride racks by design
      for (let i = 0; i + 1 < run.points.length; i += 1) {
        if (segmentPassesThroughFootprint(run.points[i], run.points[i + 1], inst, symbol)) {
          errors.push(
            `Pipe run ${run.id} passes through ${symbol.label} (${inst.tag || inst.id}) without connecting to it.`,
          );
          break;
        }
      }
    }
  }
  return errors;
}
