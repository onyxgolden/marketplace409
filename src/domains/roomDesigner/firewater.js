// Firewater: the underground main, hydrants, and fixed
// directed-spray/monitor assemblies assigned to highly flammable
// vessels. (The assembly is a remotely directed spray/monitor — NOT
// a vessel-mounted deluge system; the word "deluge" is not used for
// it anywhere in the model or UI.)
//
// BASIS: the spacing and standoff values below are JASON'S STATED
// PLANNING RULES for this designer — approximately (not asserted
// identical to, and not attributed to any specific code as governing)
// the high-hazard petroleum-industry figures of about 30 m
// (≈98.43 ft) hydrant/monitor spacing and about 15 m (≈49.2 ft)
// standoff from the hazard protected. The fixture validates layout
// against Jason's stated values only — nothing here claims identity
// with a specific standard. They are LAYOUT rules only:
// this module validates geometry and assignment — spacing, standoff,
// aim, connectivity. It never computes density, flow, pressure,
// discharge patterns, or exposure, and a passing layout is never
// reported as effective fire protection: every assignment carries the
// explicit state "effectiveness NOT EVALUATED".
//
// Modeled on the same machinery as everything else:
//   - the firewater network is pipe runs with the closed identity
//     `utility: "firewater"`, separate from every D8 utility and
//     process network (cross-service tees are findings). The main is
//     typically `underground` with an AUTHORED buried centerline
//     elevation (below grade, measured to the pipe's outside top);
//     rack support never raises a buried main. It RENDERS RED — red
//     is reserved to firewater at the final resolved-color boundary
//     in every view (see FIREWATER_COLOR and the palette audit test);
//   - the network has an explicit source / boundary inlet run
//     (`run.sourceOf === "firewater"`); mains must reach it through
//     modeled junctions — proximity is not a supply connection;
//   - hydrants are piping-domain instances associated with a main
//     station (authored `inst.stationRunId`; proximity is only the
//     legacy fallback). Spacing is measured as developed centerline
//     STATIONING in inches along the main, limit 1200 in, loop
//     wraparound included, open-main endpoint tails included;
//   - a vessel carries an editable flammability designation
//     (`inst.flammable`: true = highly flammable, "unknown", or
//     false; unknown is NOT low risk and requires assignment too).
//     Each designated vessel needs an explicit assigned assembly
//     (`inst.protects` on the assembly) that is connected to the
//     firewater network, OUTSIDE the unit boundary polygon (on the
//     edge does not qualify), at least 600 in from the vessel's
//     outside footprint (shortest plan distance from the discharge
//     origin), and AIMED at the vessel (`inst.aimAt`, a target point
//     on the vessel's footprint).
//
// Pure and framework-free.

import { findSymbol } from "./symbolRegistry";
import {
  pointSegmentDistance,
  runReachesSource,
  segmentElevationsForDesign,
  physicalRouteIn,
  properIntersection,
  CONNECTION_FACE_TOLERANCE_IN,
} from "./pipeCrossings";
import { flangeNominalSizeIn, pipeOdIn } from "./flangeGeometry";
import { boundReducerAt } from "./pipeReducerModel";

/** The one red in the designer: reserved to firewater piping. */
export const FIREWATER_COLOR = "#dc2626";
/** Maximum spacing between hydrants along the main (in) — 100 ft. */
export const HYDRANT_MAX_SPACING_IN = 1200;
/** Minimum standoff from a protected vessel to its spray nozzle (in) — 50 ft. */
export const SPRAY_MIN_STANDOFF_IN = 600;
/** A hydrant counts as "along the main" within this plan distance (in). */
export const HYDRANT_ON_MAIN_TOLERANCE_IN = 36;
/**
 * Firewater sizing (Jason's pin, 2026-10-22): mains (headers) are
 * 12-inch or 10-inch pipe — the sample loop is 12-inch; take-offs off
 * the main feeding the directed-spray assemblies step down to 6-inch
 * or 4-inch. Sizes stay editable per run like any other piping.
 */
export const FIREWATER_MAIN_DIAMETER_IN = 12;
export const FIREWATER_TAKEOFF_DIAMETER_IN = Object.freeze([6, 4]);
/**
 * Hydrant connections (the riser/branch off the main) are 6-inch —
 * Jason's stated planning default for the hydrant connecting pipe
 * (fixture requirement). This is a planning default, not a code
 * citation: nothing here claims any standard sets this minimum.
 * 8-inch shows up on mains, not on the hydrant connection.
 */
export const HYDRANT_BRANCH_DIAMETER_IN = 6;
/** A branch run's end must land within this distance (in) of the hydrant it serves. */
export const HYDRANT_BRANCH_TAP_TOLERANCE_IN = 12;
/** The stable anchor id of a directed-spray assembly's inlet interface (F3). */
export const SPRAY_INLET_ANCHOR_ID = "inlet";
/**
 * Default nominal inlet size (in) of a directed-spray assembly whose
 * instance carries no authored `inletSizeIn`. The sample's monitor
 * take-offs are 6 in to the default assemblies; an assembly fed by a
 * 4-in take-off authors `inletSizeIn: 4` (an editable property like
 * any other size in the designer).
 */
export const SPRAY_INLET_DEFAULT_DIAMETER_IN = 6;

const EPS = 1e-6;

/** Pipe runs that are firewater mains. */
export function firewaterRuns(design) {
  return (design?.pipes || []).filter((r) => r.utility === "firewater");
}

/** Placed fire hydrant instances. */
export function hydrantInstances(design) {
  return (design?.symbols || []).filter(
    (s) => s.domain === "piping" && s.symbolId === "fire-hydrant",
  );
}

/** Placed fixed directed-spray/monitor assembly instances. */
export function sprayInstances(design) {
  return (design?.symbols || []).filter(
    (s) => s.domain === "piping" && s.symbolId === "spray-nozzle",
  );
}

/**
 * An instance's editable flammability designation:
 * "highly-flammable" | "unknown" | "not-flammable" | "undesignated".
 * "unknown" is a real state, not a default — it is NOT treated as low
 * risk and requires assignment too. "undesignated" is the quiet
 * legacy state: no designation was ever entered (fixture/legacy
 * designs predate the field) — it carries no requirement and no
 * finding. A MALFORMED value (anything but true / "unknown" /
 * false / missing) reads as "unknown" — never silently
 * not-flammable — and is named by validation.
 */
export function flammabilityOf(inst) {
  if (inst?.flammable === true) return "highly-flammable";
  if (inst?.flammable === "unknown") return "unknown";
  if (inst?.flammable === false) return "not-flammable";
  if (inst?.flammable === undefined || inst?.flammable === null) return "undesignated";
  return "unknown"; // malformed: unknown risk, never silent low risk
}

/** True when the flammability field holds a malformed value. */
export function flammabilityMalformed(inst) {
  const v = inst?.flammable;
  return v !== undefined && v !== null && v !== true && v !== false && v !== "unknown";
}

/** True only for an explicit highly-flammable designation. */
export function isFlammableInstance(inst) {
  return flammabilityOf(inst) === "highly-flammable";
}

/** True when the designation requires a directed-spray assignment. */
export function requiresSprayAssignment(inst) {
  const f = flammabilityOf(inst);
  return f === "highly-flammable" || f === "unknown";
}

/**
 * Each hydrant's placement on the firewater network: its associated
 * main, its along-main station s (in, developed centerline
 * stationing), its plan distance off the main, and whether a modeled
 * branch run connects it to that main (`servedByBranch` — the normal
 * construction: a 6-in branch/riser off the main, the hydrant body
 * offset from the main itself). [{ hydrantId, runId, sIn, offIn,
 * servedByBranch }]
 * The association is the hydrant's authored `stationRunId` when
 * present (moving/resegmenting the main then explicitly invalidates
 * it via the off-main check); proximity to the nearest main is only
 * the fallback for legacy placements that never recorded one. A
 * branch-served hydrant's station is its projection onto the main —
 * the branch tap point for a perpendicular branch.
 */
export function hydrantPlacements(design) {
  const mains = firewaterRuns(design).filter(
    (r) => Array.isArray(r.points) && r.points.length >= 2,
  );
  // Undirected junction adjacency over the firewater runs, for the
  // branch-connectivity check.
  const adjacency = new Map();
  const link = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  };
  for (const run of mains) {
    for (const end of ["start", "end"]) {
      const other = run.junctions?.[end]?.runId;
      if (other) {
        link(run.id, other);
        link(other, run.id);
      }
    }
  }
  const reaches = (fromId, toId) => {
    if (fromId === toId) return true;
    const seen = new Set([fromId]);
    const queue = [fromId];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const nxt of adjacency.get(cur) || []) {
        if (nxt === toId) return true;
        if (!seen.has(nxt)) {
          seen.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return false;
  };
  const branchServes = (hydrant, mainId) =>
    mains.some((run) => {
      if (run.id === mainId) return false;
      // The branch must land on the hydrant's PHYSICAL INLET (R6):
      // plan proximity plus the landing end's route elevation at the
      // hydrant inlet elevation — a buried branch passing under the
      // hydrant at main depth does not serve it; the modeled riser
      // in the branch's profile is the connection.
      const inletZ = Number.isFinite(hydrant.elevationIn) ? hydrant.elevationIn : 0;
      const route = physicalRouteIn(design, run);
      const lands = [0, run.points.length - 1].some((ei) => {
        const p = run.points[ei];
        if (Math.hypot(p.x - hydrant.x, p.y - hydrant.y) > HYDRANT_BRANCH_TAP_TOLERANCE_IN) {
          return false;
        }
        const node = ei === 0 ? route[0] : route[route.length - 1];
        return node && Math.abs(node.zIn - inletZ) <= CONNECTION_FACE_TOLERANCE_IN;
      });
      return lands && reaches(run.id, mainId);
    });
  const stationOn = (hydrant, run) => {
    let acc = 0;
    let best = null;
    for (let i = 0; i + 1 < run.points.length; i += 1) {
      const a = run.points[i];
      const b = run.points[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const hit = pointSegmentDistance({ x: hydrant.x, y: hydrant.y }, a, b);
      if (!best || hit.distance < best.offIn) {
        best = { hydrantId: hydrant.id, runId: run.id, sIn: acc + hit.t * segLen, offIn: hit.distance };
      }
      acc += segLen;
    }
    return best;
  };
  return hydrantInstances(design).map((hydrant) => {
    let base;
    if (hydrant.stationRunId) {
      const run = mains.find((r) => r.id === hydrant.stationRunId);
      base = run
        ? stationOn(hydrant, run)
        : { hydrantId: hydrant.id, runId: null, sIn: 0, offIn: Infinity };
    } else {
      let best = null;
      for (const run of mains) {
        const placement = stationOn(hydrant, run);
        if (placement && (!best || placement.offIn < best.offIn)) best = placement;
      }
      base = best || { hydrantId: hydrant.id, runId: null, sIn: 0, offIn: Infinity };
    }
    return {
      ...base,
      servedByBranch: base.runId !== null && branchServes(hydrant, base.runId),
    };
  });
}

/**
 * Hydrant gaps (in) along each firewater main: distances between
 * consecutive hydrants measured as developed centerline stationing,
 * including the end gaps (for a closed loop main the two end gaps
 * wrap into one). Each gap names its interval: { runId, gapIn,
 * fromIn, toIn } (stations in inches; a loop's wrap gap ends past
 * the main's length, at first-station + length). An unconnected
 * hydrant (off its main) never reduces a gap.
 */
export function hydrantGapsIn(design) {
  const placements = hydrantPlacements(design);
  const gaps = [];
  for (const run of firewaterRuns(design)) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    let length = 0;
    for (let i = 0; i + 1 < run.points.length; i += 1) {
      length += Math.hypot(run.points[i + 1].x - run.points[i].x, run.points[i + 1].y - run.points[i].y);
    }
    const ss = placements
      .filter((p) => p.runId === run.id && (p.offIn <= HYDRANT_ON_MAIN_TOLERANCE_IN || p.servedByBranch))
      .map((p) => p.sIn)
      .sort((a, b) => a - b);
    if (ss.length === 0) {
      gaps.push({ runId: run.id, gapIn: length, fromIn: 0, toIn: length });
      continue;
    }
    const first = run.points[0];
    const last = run.points[run.points.length - 1];
    const closed = Math.hypot(last.x - first.x, last.y - first.y) <= EPS;
    if (closed) {
      for (let i = 0; i + 1 < ss.length; i += 1) {
        gaps.push({ runId: run.id, gapIn: ss[i + 1] - ss[i], fromIn: ss[i], toIn: ss[i + 1] });
      }
      gaps.push({
        runId: run.id,
        gapIn: length - ss[ss.length - 1] + ss[0],
        fromIn: ss[ss.length - 1],
        toIn: ss[0] + length,
      });
    } else {
      gaps.push({ runId: run.id, gapIn: ss[0], fromIn: 0, toIn: ss[0] });
      for (let i = 0; i + 1 < ss.length; i += 1) {
        gaps.push({ runId: run.id, gapIn: ss[i + 1] - ss[i], fromIn: ss[i], toIn: ss[i + 1] });
      }
      gaps.push({
        runId: run.id,
        gapIn: length - ss[ss.length - 1],
        fromIn: ss[ss.length - 1],
        toIn: length,
      });
    }
  }
  return gaps;
}

/** Plan distance (in) from a point to an instance's footprint (0 inside). */
export function distanceToFootprintIn(point, inst, symbol) {
  const w = inst.widthIn ?? symbol.widthIn;
  const d = inst.depthIn ?? symbol.depthIn;
  const rad = ((inst.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - inst.x;
  const dy = point.y - inst.y;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  if (symbol.shape3d === "vcyl" || symbol.shape3d === "sphere") {
    return Math.max(0, Math.hypot(lx, ly) - Math.min(w, d) / 2);
  }
  const cx = Math.max(-w / 2, Math.min(w / 2, lx));
  const cy = Math.max(-d / 2, Math.min(d / 2, ly));
  return Math.hypot(lx - cx, ly - cy);
}

/** Point-in-polygon (ray casting) for the authored unit boundary. */
export function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when the point lies ON a polygon edge (within a hair). */
export function pointOnPolygonEdge(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    if (pointSegmentDistance(point, polygon[j], polygon[i]).distance <= 0.01) return true;
  }
  return false;
}

/**
 * A usable unit boundary: an explicit persisted polygon of >= 3
 * finite points with NONZERO area. A degenerate polygon (repeated
 * identical points, zero area) is not a boundary — placement
 * "outside" it cannot be verified.
 */
export function unitBoundaryValid(design) {
  const b = design?.unitBoundary;
  if (!Array.isArray(b) || b.length < 3) return false;
  if (!b.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) return false;
  let area2 = 0;
  for (let i = 0; i < b.length; i += 1) {
    const p = b[i];
    const q = b[(i + 1) % b.length];
    area2 += p.x * q.y - q.x * p.y;
  }
  if (!(Math.abs(area2) > 1e-6)) return false;
  // A REAL simple polygon (R6): no repeated vertices, and no pair of
  // non-adjacent edges may cross or touch. A self-crossing outline
  // (a bowtie) has nonzero signed area yet no well-defined inside —
  // "outside the boundary" is unverifiable for it.
  for (let i = 0; i < b.length; i += 1) {
    for (let j = i + 1; j < b.length; j += 1) {
      if (Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y) <= 1e-9) return false;
    }
  }
  const n = b.length;
  for (let i = 0; i < n; i += 1) {
    const a = b[i];
    const c = b[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      if (j === i) continue;
      if ((j + 1) % n === i || (i + 1) % n === j) continue; // adjacent edges share a vertex
      const d = b[j];
      const e = b[(j + 1) % n];
      if (properIntersection(a, c, d, e)) return false;
      // Touching at a shared point (a vertex lying on another edge)
      // is also self-intersection for a simple polygon.
      if (
        pointSegmentDistance(a, d, e).distance <= 1e-9 ||
        pointSegmentDistance(c, d, e).distance <= 1e-9 ||
        pointSegmentDistance(d, a, c).distance <= 1e-9 ||
        pointSegmentDistance(e, a, c).distance <= 1e-9
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * A directed-spray assembly's stable INLET interface (F3): the one
 * port a supply branch may attach to. { id: "<sprayId>::inlet",
 * anchorId: "inlet", x, y, elevationIn, sizeIn, vertical: true,
 * runId, end } — position is the assembly's plan point, elevation the
 * assembly's inlet elevation (its authored elevationIn, else grade),
 * size the authored inletSizeIn (else the 6-in default). The inlet is
 * fed FROM BELOW: a verified branch approaches it through a riser
 * (its final segment rises to the inlet elevation). The authored
 * attachment lives on the instance as inletRunId / inletEnd — the
 * connectSprayInlet authoring command stamps them; nothing about
 * proximity creates them.
 */
export function sprayInletInterface(spray) {
  if (!spray) return null;
  return {
    id: `${spray.id}::${SPRAY_INLET_ANCHOR_ID}`,
    anchorId: SPRAY_INLET_ANCHOR_ID,
    x: spray.x,
    y: spray.y,
    elevationIn: Number.isFinite(spray.elevationIn) ? spray.elevationIn : 0,
    sizeIn: Number.isFinite(spray.inletSizeIn)
      ? spray.inletSizeIn
      : SPRAY_INLET_DEFAULT_DIAMETER_IN,
    vertical: true,
    runId: spray.inletRunId ?? null,
    end: spray.inletEnd ?? null,
  };
}

/**
 * Verify a spray assembly's authored inlet connection (F3) — the
 * full interface predicate, mirroring the equipment-nozzle checks:
 * the authored branch end must exist and be a firewater run; its end
 * must sit ON the inlet face (plan + elevation within face
 * tolerance); its approach must be a riser — vertical in plan
 * within face tolerance (F4.1) — rising into the inlet from below
 * (the inlet is fed from below: a flat horizontal run at the inlet
 * elevation, a descent from above, or a sloped terminal segment is
 * not an inlet connection); the branch's nominal size must match the
 * inlet's, or a reducer OWNED by this exact pair (branch end +
 * assembly inlet) must bind at the inlet point; and the branch must
 * reach the firewater source through modeled junctions — traversal
 * depends on this verified edge, never on an unreferenced endpoint
 * that merely lands nearby. Returns { ok, problems, run }.
 */
export function verifiedSpraySupply(design, spray) {
  const problems = [];
  const inlet = sprayInletInterface(spray);
  if (!inlet.runId || !inlet.end) {
    problems.push(
      "no authored inlet connection: no firewater branch end is authored as attached to the assembly inlet — an unreferenced endpoint at the inlet proves no supply",
    );
    return { ok: false, problems, run: null };
  }
  const run = (design?.pipes || []).find((r) => r.id === inlet.runId) || null;
  if (!run || !Array.isArray(run.points) || run.points.length < 2) {
    problems.push(
      `authored inlet connection names unknown pipe run ${inlet.runId} — stale inlet reference`,
    );
    return { ok: false, problems, run: null };
  }
  if (run.utility !== "firewater") {
    problems.push(
      `authored inlet branch ${run.id} is not a firewater run — the assembly inlet accepts only a firewater supply branch`,
    );
    return { ok: false, problems, run };
  }
  // Fail closed on the reference itself (F3.1): the persisted
  // inletEnd is validated at this runtime/rehydration boundary —
  // only the exact authored values are admitted. The document may
  // not have come through the authoring command (hand edits, older
  // writers), and the previous truthiness-plus-ternary read silently
  // interpreted any malformed value (e.g. "typo") as "end".
  if (inlet.end !== "start" && inlet.end !== "end") {
    problems.push(
      `authored inlet connection names an invalid branch end ${JSON.stringify(inlet.end)} — the inlet reference must name exactly "start" or "end"; a malformed inlet reference proves no supply`,
    );
    return { ok: false, problems, run };
  }
  const end = inlet.end;
  const idx = end === "start" ? 0 : run.points.length - 1;
  const point = run.points[idx];
  const route = physicalRouteIn(design, run);
  const node = end === "start" ? route[0] : route[route.length - 1];
  const neighborIdx = end === "start" ? 1 : run.points.length - 2;
  const neighborNode = route[neighborIdx];
  const distIn = Math.hypot(point.x - inlet.x, point.y - inlet.y);
  if (distIn > CONNECTION_FACE_TOLERANCE_IN) {
    problems.push(
      `authored inlet branch ${run.id} ends ${Math.round(distIn)} in from the assembly inlet face — the branch end is not on the inlet it names`,
    );
  }
  if (!node || Math.abs(node.zIn - inlet.elevationIn) > CONNECTION_FACE_TOLERANCE_IN) {
    problems.push(
      "supply branch reaches the assembly in plan but not at its inlet elevation — a modeled riser to the assembly inlet is required",
    );
  } else if (
    !neighborNode ||
    neighborNode.zIn > node.zIn - CONNECTION_FACE_TOLERANCE_IN
  ) {
    // Orientation (F3) + direction (F3.1): the inlet face is vertical
    // and fed FROM BELOW, so the branch's final segment must RISE
    // into the inlet — the preceding vertex sits strictly below the
    // inlet elevation. The previous absolute-difference test rejected
    // only a FLAT approach; a branch descending into the inlet from
    // above passed identically, though the opposite-side approach
    // cannot prove the modeled below-fed connection.
    problems.push(
      "supply branch does not rise into the assembly inlet through a riser from below — a flat horizontal approach, or a descent from above, is not a verified inlet connection",
    );
  } else if (
    Math.hypot(neighborNode.x - node.x, neighborNode.y - node.y) >
    CONNECTION_FACE_TOLERANCE_IN
  ) {
    // Verticality (F4.1): RISING is not enough — the terminal
    // segment must be a riser, vertical in plan within the face
    // tolerance. The direction check above proves only the side
    // the approach comes from; alone it admitted an arbitrarily
    // sloped terminal run (ChatGPT's executed counterexample: a
    // 500-in plan run gaining 36 in) as a below-fed inlet.
    problems.push(
      `supply branch reaches the assembly inlet through a sloped segment (plan projection ${Math.round(
        Math.hypot(neighborNode.x - node.x, neighborNode.y - node.y),
      )} in), not a vertical riser — a below-fed inlet is proven only by a terminal segment vertical within ${CONNECTION_FACE_TOLERANCE_IN} in in plan`,
    );
  }
  if (
    flangeNominalSizeIn(run.diameterIn ?? 2) !== flangeNominalSizeIn(inlet.sizeIn)
  ) {
    const neighbor = run.points[neighborIdx];
    const axisDeg = (Math.atan2(neighbor.y - point.y, neighbor.x - point.x) * 180) / Math.PI;
    const bound = boundReducerAt(design, {
      x: inlet.x,
      y: inlet.y,
      elevationIn: inlet.elevationIn,
      sides: [
        {
          sizeIn: run.diameterIn ?? 2,
          dirDeg: axisDeg,
          owner: { kind: "run-end", runId: run.id, end },
        },
        {
          sizeIn: inlet.sizeIn,
          dirDeg: axisDeg + 180,
          owner: { kind: "spray-inlet", symbolId: spray.id, anchorId: SPRAY_INLET_ANCHOR_ID },
        },
      ],
    });
    if (!bound) {
      problems.push(
        `supply branch ${run.id} (${run.diameterIn ?? 2} in) meets the assembly inlet (${inlet.sizeIn} in) without a reducer owned by the branch end and the assembly inlet`,
      );
    }
  }
  if (problems.length === 0 && !runReachesSource(design, run.id, "firewater")) {
    problems.push(
      "no verified supply path: the inlet branch does not reach the firewater source through modeled junctions",
    );
  }
  return { ok: problems.length === 0, problems, run };
}

/**
 * The geometric assignment status of one directed-spray assembly
 * against its assigned vessel — geometry, aim, and SUPPLY.
 * A valid assignment needs a VERIFIED supply path (D668-006/F3): the
 * branch end AUTHORED as attached to the assembly's inlet interface
 * must pass the full face/elevation/riser/size-or-owned-reducer
 * checks and reach the firewater source through modeled junctions
 * (proximity alone is not supply; an unreferenced endpoint is not
 * supply; an unconnected branch is not supply). Effectiveness is
 * NEVER evaluated in this slice.
 * { sprayId, vesselId, ok, problems: [string], effectiveness: "NOT_EVALUATED" }
 */
export function sprayAssignmentStatus(design, sprayArg) {
  const byId = new Map((design?.symbols || []).map((s) => [s.id, s]));
  // The design's own instance is authoritative where one exists (a
  // caller may pass a partial spray literal for a placed assembly).
  const spray = (sprayArg && byId.get(sprayArg.id)) || sprayArg;
  const problems = [];
  const target = spray?.protects ? byId.get(spray.protects) : null;
  if (!spray?.protects) problems.push("no assigned vessel");
  else if (!target) problems.push("assigned vessel no longer exists");
  if (target) {
    const symbol = findSymbol(target.domain, target.symbolId);
    if (symbol) {
      const standoff = distanceToFootprintIn(spray, target, symbol);
      if (standoff < SPRAY_MIN_STANDOFF_IN - EPS) {
        problems.push(`standoff ${Math.round(standoff)} in is under the 600 in minimum`);
      }
    }
    if (!unitBoundaryValid(design)) {
      problems.push("unit boundary missing or ambiguous — outside placement cannot be verified");
    } else if (pointOnPolygonEdge(spray, design.unitBoundary)) {
      problems.push("assembly sits on the unit boundary — on the edge does not qualify as outside");
    } else if (pointInPolygon(spray, design.unitBoundary)) {
      problems.push("assembly sits inside the unit boundary");
    }
    if (!spray.aimAt || !Number.isFinite(spray.aimAt.x) || !Number.isFinite(spray.aimAt.y)) {
      problems.push("no aimed target point recorded");
    } else if (symbol && distanceToFootprintIn(spray.aimAt, target, symbol) > EPS) {
      problems.push("aim point does not land on the assigned vessel");
    }
    // Verified supply path (F3): the assembly's authored inlet
    // connection, checked by the full interface predicate — face,
    // inlet elevation/riser (R6), orientation, inlet size or an
    // owned reducer — plus source reachability through the modeled
    // junction graph. No authored reference, no supply.
    const supply = verifiedSpraySupply(design, spray);
    problems.push(...supply.problems);
  }
  return {
    sprayId: spray?.id,
    vesselId: spray?.protects || null,
    ok: problems.length === 0,
    problems,
    effectiveness: "NOT_EVALUATED",
  };
}

/**
 * Per-vessel assignment states (evidence for views/reports):
 * [{ vesselId, vesselTag, flammability, state, effectiveness, assemblies }]
 * state is "assigned" when every geometric check on at least one
 * assigned assembly passes, else "missing-or-invalid". Effectiveness
 * is always "NOT_EVALUATED" — a valid layout is not proof of fire
 * protection.
 */
export function vesselSprayStates(design) {
  const sprays = sprayInstances(design);
  const out = [];
  for (const inst of design?.symbols || []) {
    if (!requiresSprayAssignment(inst)) continue;
    const assemblies = sprays
      .filter((s) => s.protects === inst.id)
      .map((s) => sprayAssignmentStatus(design, s));
    out.push({
      vesselId: inst.id,
      vesselTag: inst.tag || inst.id,
      flammability: flammabilityOf(inst),
      state: assemblies.some((a) => a.ok) ? "assigned" : "missing-or-invalid",
      effectiveness: "NOT_EVALUATED",
      assemblies,
    });
  }
  return out;
}

const ft = (inches) => Math.round((inches / 12) * 10) / 10;

/** validateDesign messages for firewater mains, hydrants, and spray assignment. */
export function firewaterErrors(design) {
  const errors = [];
  const byTagOrId = (inst) => inst.tag || inst.id;

  // Burial: an underground firewater run needs an authored below-grade
  // profile — outside TOP of pipe under grade — and no unmodeled
  // above-grade vertices. Rack support never raises a buried main:
  // a run without a stored profile would derive the +30 in grade
  // fallback, which is exactly the failure this check names.
  for (const run of firewaterRuns(design)) {
    if (run.underground !== true) continue;
    if (!Number.isFinite(run.elevationIn) && !Array.isArray(run.elevIn)) {
      errors.push(
        `Underground firewater run ${run.id} has no authored burial elevation — a buried main must carry its below-grade profile.`,
      );
      continue;
    }
    const elevs = segmentElevationsForDesign(design, run);
    const topIn = Math.max(...elevs) + pipeOdIn(run.diameterIn ?? 8) / 2;
    if (topIn >= 0) {
      errors.push(
        `Underground firewater run ${run.id} breaks the surface: its outside top reaches ${Math.round(topIn)} in relative to grade.`,
      );
    }
    if (Array.isArray(run.elevIn)) {
      const allowed = new Set(run.aboveGradeTransitions || []);
      run.elevIn.forEach((v, i) => {
        if (v !== null && v !== undefined && v >= 0 && !allowed.has(i)) {
          errors.push(
            `Underground firewater run ${run.id} rises above grade at vertex ${i} without a modeled riser/transition.`,
          );
        }
      });
    }
  }

  // Supply: every firewater main must reach the network's designated
  // D668-006: a firewater network without a designated source is flagged,
  // and mains must connect to it through modeled junctions.
  const fwRuns = firewaterRuns(design);
  if (fwRuns.length > 0) {
    const hasSource = fwRuns.some((r) => r.sourceOf === "firewater");
    if (!hasSource) {
      errors.push("The firewater network has no designated source / boundary inlet.");
    } else {
      for (const run of fwRuns) {
        if (run.sourceOf === "firewater") continue;
        if (!runReachesSource(design, run.id, "firewater")) {
          errors.push(
            `Firewater run ${run.id} has no connected path to the firewater source / boundary inlet.`,
          );
        }
      }
    }
  }

  for (const p of hydrantPlacements(design)) {
    if (p.runId === null || (p.offIn > HYDRANT_ON_MAIN_TOLERANCE_IN && !p.servedByBranch)) {
      errors.push(`Fire hydrant ${p.hydrantId} is not on a firewater main.`);
    }
  }
  for (const gap of hydrantGapsIn(design)) {
    if (gap.gapIn > HYDRANT_MAX_SPACING_IN + EPS) {
      errors.push(
        `Firewater main ${gap.runId} has a hydrant gap of ${ft(gap.gapIn)} ft between stations ${Math.round(gap.fromIn)} in and ${Math.round(gap.toIn)} in — hydrants must be no more than 100 ft apart along the main.`,
      );
    }
  }

  // The unit boundary must exist and be valid before any spray
  // placement can be verified — missing/ambiguous is an unresolved
  // finding, never an assumed "outside".
  const sprays = sprayInstances(design);
  const needsBoundary =
    sprays.length > 0 || (design?.symbols || []).some((s) => requiresSprayAssignment(s));
  if (needsBoundary && !unitBoundaryValid(design)) {
    errors.push(
      "The unit boundary is missing or ambiguous — directed-spray placement cannot be verified as outside the unit.",
    );
  }

  const byId = new Map((design?.symbols || []).map((s) => [s.id, s]));
  for (const inst of design?.symbols || []) {
    // Malformed risk metadata (D668-006): named, and treated as
    // unknown risk — never silently not-flammable.
    if (flammabilityMalformed(inst)) {
      errors.push(
        `Equipment ${byTagOrId(inst)} has a malformed flammability designation — treated as UNKNOWN flammability, not low risk.`,
      );
    }
    if (!requiresSprayAssignment(inst)) continue;
    const covering = sprays.filter((s) => s.protects === inst.id);
    if (covering.length === 0) {
      errors.push(
        flammabilityOf(inst) === "unknown"
          ? `Vessel ${byTagOrId(inst)} has UNKNOWN flammability and no assigned fixed directed-spray assembly — unknown is not low risk.`
          : `Highly flammable vessel ${byTagOrId(inst)} has no assigned fixed directed-spray assembly.`,
      );
    }
  }
  for (const spray of sprays) {
    const status = sprayAssignmentStatus(design, spray);
    if (!spray.protects) {
      errors.push(`Directed-spray assembly ${byTagOrId(spray)} has no assigned vessel.`);
      continue;
    }
    const target = byId.get(spray.protects);
    if (!target) {
      errors.push(
        `Directed-spray assembly ${byTagOrId(spray)} is assigned to unknown equipment ${spray.protects}.`,
      );
      continue;
    }
    for (const problem of status.problems) {
      errors.push(`Directed-spray assembly ${byTagOrId(spray)}: ${problem}.`);
    }
  }
  return errors;
}
