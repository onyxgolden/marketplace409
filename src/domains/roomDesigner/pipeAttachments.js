// Pipe ends attached to equipment nozzles (connection anchors).
//
// Anchors come from two sources:
//   - TEMA symbols (catalog entries carrying `tema`): temaAnchorsWorld
//     projects the exchanger's parametric anchors — { id, x, y }.
//   - Generic catalog nozzles (entries carrying `nozzles` in
//     processEquipmentCatalog.js): each spec { id, fx, fy, sizeIn } is a
//     fraction of the instance's half-width / half-depth, projected with
//     the same rotation formula — { id, x, y, sizeIn }.
//
// A pipe run may carry OPTIONAL attachment metadata for its two ends:
//   attachments: { start?: { symbolId, anchorId }, end?: { symbolId, anchorId } }
// symbolId is the placed symbol INSTANCE id; anchorId a nozzle id such as
// "tube-in". Runs without the field (every legacy drawing) are untouched,
// so the design version does not change.
//
// An end attaches when it sits exactly on a nozzle — which is what the pipe
// tool's nozzle snap produces. reconcilePipeAttachments then keeps attached
// ends on their nozzles after the equipment moves, rotates, resizes or is
// reconfigured. If the equipment is deleted or the nozzle no longer exists,
// the end stays at its last position and the link is dropped.
//
// Pure and framework-free.

import { findSymbol } from "./symbolRegistry";
import { temaAnchorsWorld } from "./temaGeometry";
import { downcomerAnchorsWorld } from "./downcomers";
import { utilityAnchorsWorld, isVesselSymbol } from "./utilityPiping";
import { pointSegmentDistance, segmentElevationsForDesign } from "./pipeCrossings";
import { flangeNominalSizeIn, pipeOdIn } from "./flangeGeometry";

const ENDS = ["start", "end"];
const EPS = 1e-6;

/**
 * World anchors for catalog `nozzles` specs: local offset
 * (fx * effWidth / 2, fy * effDepth / 2) with effWidth / effDepth the
 * instance's size overrides or the catalog defaults, rotated by the
 * instance rotation — the same projection temaAnchorsWorld uses.
 * Plan frame: +fx = east, +fy = south.
 */
export function catalogAnchorsWorld(symbol, inst) {
  if (!symbol?.nozzles) return [];
  const effWidth = inst.widthIn ?? symbol.widthIn;
  const effDepth = inst.depthIn ?? symbol.depthIn;
  const rad = ((inst.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return symbol.nozzles.map((n) => {
    const lx = n.fx * (effWidth / 2);
    const ly = n.fy * (effDepth / 2);
    return {
      id: n.id,
      x: inst.x + lx * cos - ly * sin,
      y: inst.y + lx * sin + ly * cos,
      sizeIn: n.sizeIn,
    };
  });
}

/** World anchors for any placed symbol instance (TEMA or catalog nozzles). */
export function anchorsOf(inst) {
  const symbol = findSymbol(inst.domain, inst.symbolId);
  if (symbol?.tema) return temaAnchorsWorld(symbol, inst);
  let out = symbol?.nozzles ? catalogAnchorsWorld(symbol, inst) : [];
  // Columns also expose their downcomer-level nozzles (each carries the
  // level's elevation, so a run connecting there runs at that elevation).
  if (symbol?.downcomers) out = [...out, ...downcomerAnchorsWorld(symbol, inst)];
  // In-scope vessels also expose their base utility ports (plant
  // water, plant air, nitrogen) AFTER the process nozzles, so a
  // process nozzle sharing the spot keeps attachment priority.
  if (isVesselSymbol(symbol)) out = [...out, ...utilityAnchorsWorld(symbol, inst)];
  return out;
}

/**
 * The nozzle exactly at `point` (within 1e-6 in): { symbolId, anchorId }
 * or null. Several anchors can share one plan point (a column's
 * downcomer draw outlets stack at 10 ft intervals on the same side):
 * the choice is then made by ELEVATION, never silently by order alone —
 * an anchor whose level elevation matches `elevationHintIn` (the run
 * end's own elevation) wins; then a plain grade-level nozzle; then the
 * lowest level outlet.
 */
export function anchorAtPoint(design, point, elevationHintIn = null) {
  const candidates = [];
  for (const inst of design?.symbols || []) {
    for (const a of anchorsOf(inst)) {
      if (Math.abs(a.x - point.x) <= EPS && Math.abs(a.y - point.y) <= EPS) {
        candidates.push({ symbolId: inst.id, anchorId: a.id, elevationIn: a.elevationIn ?? null });
      }
    }
  }
  if (candidates.length === 0) return null;
  const pick = (list) => ({ symbolId: list[0].symbolId, anchorId: list[0].anchorId });
  if (elevationHintIn !== null && elevationHintIn !== undefined) {
    const exact = candidates.filter((c) => c.elevationIn === elevationHintIn);
    if (exact.length > 0) return pick(exact);
  }
  const grade = candidates.filter((c) => c.elevationIn === null);
  if (grade.length > 0) return pick(grade);
  return pick([...candidates].sort((a, b) => a.elevationIn - b.elevationIn));
}

const sameRef = (a, b) => (!a && !b) || (a && b && a.symbolId === b.symbolId && a.anchorId === b.anchorId);

function withAttachments(run, attachments) {
  const next = { ...run };
  if (attachments.start || attachments.end) {
    next.attachments = {};
    if (attachments.start) next.attachments.start = attachments.start;
    if (attachments.end) next.attachments.end = attachments.end;
  } else {
    delete next.attachments;
  }
  return next;
}

/**
 * Re-derive a run's attachments from where its ends sit now: an end exactly
 * on a nozzle attaches, any other end detaches. Returns the same design when
 * nothing changes.
 */
export function detectRunAttachments(design, runId) {
  let changed = false;
  const pipes = (design.pipes || []).map((run) => {
    if (run.id !== runId || !Array.isArray(run.points) || run.points.length < 2) return run;
    const hint = (i) =>
      (Array.isArray(run.elevIn) ? run.elevIn[i] : undefined) ?? run.elevationIn ?? null;
    const found = {
      start: anchorAtPoint(design, run.points[0], hint(0)),
      end: anchorAtPoint(design, run.points[run.points.length - 1], hint(run.points.length - 1)),
    };
    if (ENDS.every((e) => sameRef(found[e], run.attachments?.[e]))) return run;
    changed = true;
    return withAttachments(run, found);
  });
  return changed ? { ...design, pipes } : design;
}

/**
 * Move every attached pipe end onto its nozzle's current position; drop links
 * whose equipment or nozzle is gone (the end stays put). Returns the same
 * design object when nothing changes.
 */
export function reconcilePipeAttachments(design) {
  if (!(design?.pipes || []).some((run) => run.attachments)) return design;
  const byId = new Map((design.symbols || []).map((s) => [s.id, s]));
  const anchorCache = new Map();
  const anchorFor = (ref) => {
    const inst = byId.get(ref.symbolId);
    if (!inst) return null;
    if (!anchorCache.has(inst.id)) anchorCache.set(inst.id, anchorsOf(inst));
    return anchorCache.get(inst.id).find((a) => a.id === ref.anchorId) || null;
  };
  let changed = false;
  const pipes = design.pipes.map((run) => {
    if (!run.attachments || !Array.isArray(run.points) || run.points.length < 2) return run;
    const points = [...run.points];
    let elevIn = Array.isArray(run.elevIn) ? [...run.elevIn] : null;
    const kept = {};
    let runChanged = false;
    for (const end of ENDS) {
      const ref = run.attachments[end];
      if (!ref) continue;
      const a = anchorFor(ref);
      if (!a) {
        runChanged = true; // equipment or nozzle gone: keep the point, drop the link
        continue;
      }
      kept[end] = ref;
      const i = end === "start" ? 0 : points.length - 1;
      if (points[i].x !== a.x || points[i].y !== a.y) {
        points[i] = { x: a.x, y: a.y };
        runChanged = true;
      }
      // An anchor at a level elevation (a column downcomer nozzle) pulls
      // the attached end to that elevation: the run connects AT the level.
      if (typeof a.elevationIn === "number") {
        if (!elevIn || elevIn.length !== points.length) {
          elevIn = points.map((_, k) => (Array.isArray(run.elevIn) ? run.elevIn[k] ?? null : null));
        }
        if (elevIn[i] !== a.elevationIn) {
          elevIn[i] = a.elevationIn;
          runChanged = true;
        }
      }
    }
    if (!runChanged) return run;
    changed = true;
    const next = { ...run, points };
    if (elevIn) {
      if (elevIn.some((v) => v != null)) next.elevIn = elevIn;
      else delete next.elevIn;
    }
    return withAttachments(next, kept);
  });
  return changed ? { ...design, pipes } : design;
}

/** validateDesign messages for a run's optional attachment metadata. */
export function pipeAttachmentErrors(run) {
  if (run.attachments === undefined) return [];
  const bad = [`Pipe run ${run.id} has malformed attachments.`];
  const att = run.attachments;
  if (!att || typeof att !== "object" || Array.isArray(att)) return bad;
  for (const [key, ref] of Object.entries(att)) {
    if (!ENDS.includes(key)) return bad;
    if (!ref || typeof ref.symbolId !== "string" || typeof ref.anchorId !== "string") return bad;
  }
  return [];
}

// ---- Pipe-to-pipe junctions (D3: every connection is flanged) ----
//
// A run end that lands on another run — mid-segment (a tee) or exactly
// on its end (a coupled joint) — is a pipe-to-pipe connection, modeled
// as run.junctions: { start?: { runId }, end?: { runId } } and drawn as
// a flanged joint. An end attached to an equipment nozzle is never a
// junction (the nozzle attachment wins). Free ends stay plain: the
// flange exists exactly where a connection exists.

/** How close (plan in) a run end must land to another run to connect. */
export const JUNCTION_TOLERANCE_IN = 0.5;

function withJunctions(run, junctions) {
  const next = { ...run };
  const kept = {};
  if (junctions.start) kept.start = junctions.start;
  if (junctions.end) kept.end = junctions.end;
  if (kept.start || kept.end) next.junctions = kept;
  else delete next.junctions;
  return next;
}

/** Where an end point touches another run: the host point to snap to, or null. */
function junctionSnapPoint(design, run, end) {
  const point = end === "start" ? run.points[0] : run.points[run.points.length - 1];
  for (const other of design?.pipes || []) {
    if (other.id === run.id || !Array.isArray(other.points) || other.points.length < 2) continue;
    for (const op of [other.points[0], other.points[other.points.length - 1]]) {
      if (Math.hypot(op.x - point.x, op.y - point.y) <= JUNCTION_TOLERANCE_IN) {
        return { runId: other.id, point: { x: op.x, y: op.y } };
      }
    }
    for (let i = 0; i + 1 < other.points.length; i += 1) {
      const hit = pointSegmentDistance(point, other.points[i], other.points[i + 1]);
      if (hit.distance <= JUNCTION_TOLERANCE_IN && hit.t > EPS && hit.t < 1 - EPS) {
        return { runId: other.id, point: hit.proj };
      }
    }
  }
  return null;
}

/**
 * Re-derive a run's junctions from where its ends sit now: an end on
 * another run connects (flanged), any other end disconnects. Returns
 * the same design when nothing changes.
 */
export function detectRunJunctions(design, runId) {
  let changed = false;
  const pipes = (design.pipes || []).map((run) => {
    if (run.id !== runId || !Array.isArray(run.points) || run.points.length < 2) return run;
    const found = {
      start: run.attachments?.start ? null : junctionSnapPoint(design, run, "start"),
      end: run.attachments?.end ? null : junctionSnapPoint(design, run, "end"),
    };
    const next = {
      start: found.start ? { runId: found.start.runId } : null,
      end: found.end ? { runId: found.end.runId } : null,
    };
    const same = ENDS.every((e) => (next[e]?.runId ?? null) === (run.junctions?.[e]?.runId ?? null));
    if (same) return run;
    changed = true;
    return withJunctions(run, next);
  });
  return changed ? { ...design, pipes } : design;
}

/**
 * Keep junction ends on their host runs after any edit: an end still
 * touching its host (within tolerance) snaps onto it; an end whose host
 * moved away or was deleted disconnects and stays where it is. Returns
 * the same design object when nothing changes.
 */
export function reconcileRunJunctions(design) {
  if (!(design?.pipes || []).some((run) => run.junctions)) return design;
  const byId = new Map((design.pipes || []).map((r) => [r.id, r]));
  let changed = false;
  const pipes = design.pipes.map((run) => {
    if (!run.junctions || !Array.isArray(run.points) || run.points.length < 2) return run;
    const points = [...run.points];
    const kept = {};
    let runChanged = false;
    for (const end of ENDS) {
      const ref = run.junctions[end];
      if (!ref) continue;
      if (run.attachments?.[end]) {
        runChanged = true; // a nozzle attachment supersedes the junction
        continue;
      }
      const host = byId.get(ref.runId);
      if (!host || host.id === run.id) {
        runChanged = true; // host gone: end stays put, connection dropped
        continue;
      }
      const idx = end === "start" ? 0 : points.length - 1;
      const snap = junctionSnapPoint({ pipes: [host] }, { ...run, points }, end);
      if (!snap) {
        runChanged = true; // detached
        continue;
      }
      kept[end] = ref;
      if (Math.hypot(snap.point.x - points[idx].x, snap.point.y - points[idx].y) > EPS) {
        points[idx] = { x: snap.point.x, y: snap.point.y };
        runChanged = true;
      }
    }
    if (!runChanged) return run;
    changed = true;
    return withJunctions({ ...run, points }, kept);
  });
  return changed ? { ...design, pipes } : design;
}

/** validateDesign messages for a run's optional junction metadata. */
export function pipeJunctionErrors(run) {
  if (run.junctions === undefined) return [];
  const bad = [`Pipe run ${run.id} has malformed junctions.`];
  const j = run.junctions;
  if (!j || typeof j !== "object" || Array.isArray(j)) return bad;
  for (const [key, ref] of Object.entries(j)) {
    if (!ENDS.includes(key)) return bad;
    if (!ref || typeof ref.runId !== "string") return bad;
  }
  return [];
}

// ---- Connection compatibility + legacy upgrade ----

/**
 * A connection is only sound when the faces can actually meet: the
 * run's nominal size must match the nozzle's (or a reducer fitting must
 * be placed at the connection point), and — for a nozzle at a level
 * elevation — the run must arrive at that elevation. Junctions must
 * meet their host run at a compatible elevation. Anything else is
 * flagged here rather than silently drawn as connected.
 */
export function connectionCompatibilityErrors(design) {
  const errors = [];
  const byId = new Map((design?.symbols || []).map((s) => [s.id, s]));
  const reducerAt = (point) =>
    (design?.symbols || []).some(
      (s) =>
        s.domain === "piping" &&
        s.symbolId === "reducer" &&
        Math.hypot(s.x - point.x, s.y - point.y) <= 6,
    );
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    const segElevs = segmentElevationsForDesign(design, run);
    for (const end of ENDS) {
      const idx = end === "start" ? 0 : run.points.length - 1;
      const point = run.points[idx];
      const ref = run.attachments?.[end];
      if (ref) {
        const inst = byId.get(ref.symbolId);
        const anchor = inst ? anchorsOf(inst).find((a) => a.id === ref.anchorId) : null;
        if (anchor) {
          if (
            anchor.sizeIn != null &&
            flangeNominalSizeIn(run.diameterIn ?? 2) !== flangeNominalSizeIn(anchor.sizeIn) &&
            !reducerAt(point)
          ) {
            errors.push(
              `Pipe run ${run.id} (${run.diameterIn ?? 2} in) connects to nozzle ${ref.anchorId} (${anchor.sizeIn} in) without a reducer/transition.`,
            );
          }
          if (anchor.elevationIn != null) {
            const segElev = segElevs[end === "start" ? 0 : segElevs.length - 1];
            if (Math.abs(segElev - anchor.elevationIn) > 0.5) {
              errors.push(
                `Pipe run ${run.id} reaches nozzle ${ref.anchorId} at elevation ${Math.round(segElev)} in, but the nozzle is at ${anchor.elevationIn} in.`,
              );
            }
          }
        }
        continue;
      }
      const junction = run.junctions?.[end];
      if (junction) {
        const host = (design.pipes || []).find((r) => r.id === junction.runId);
        if (host && Array.isArray(host.points) && host.points.length >= 2) {
          // The host segment the end lands on (the one it touches).
          let hostElev = null;
          for (let i = 0; i + 1 < host.points.length; i += 1) {
            const hit = pointSegmentDistance(point, host.points[i], host.points[i + 1]);
            if (hit.distance <= JUNCTION_TOLERANCE_IN + EPS) {
              hostElev = segmentElevationsForDesign(design, host)[i];
              break;
            }
          }
          if (hostElev === null) {
            // End-to-end joint: the host's end segment elevation.
            const hostSegs = segmentElevationsForDesign(design, host);
            hostElev = hostSegs[0];
          }
          const myElev = segElevs[end === "start" ? 0 : segElevs.length - 1];
          // Two pipes meet at a joint when their centerlines are close
          // enough for the barrels to touch: |dz| <= rA + rB. Beyond
          // that they pass at different heights and the plan touch is
          // not a connection.
          const reach =
            pipeOdIn(run.diameterIn ?? 2) / 2 + pipeOdIn(host.diameterIn ?? 2) / 2;
          if (Math.abs(myElev - hostElev) > reach + 0.5) {
            errors.push(
              `Pipe run ${run.id} joins pipe run ${host.id} in plan, but their elevations do not meet (${Math.round(myElev)} in vs ${Math.round(hostElev)} in).`,
            );
          }
        }
      }
    }
  }
  return errors;
}

/**
 * The deterministic, undoable upgrade for designs saved before the full
 * nozzle catalog existed: re-derive every run's nozzle attachments and
 * pipe-to-pipe junctions from where its ends sit now. Geometry is never
 * moved — ends already on a nozzle/junction gain their connection
 * records; everything else is left exactly as saved. Run it through the
 * normal edit path so the upgrade is one undoable transaction.
 */
export function upgradeDesignConnections(design) {
  let next = design;
  for (const run of design?.pipes || []) {
    next = detectRunAttachments(next, run.id);
  }
  for (const run of next?.pipes || []) {
    next = detectRunJunctions(next, run.id);
  }
  return next;
}
