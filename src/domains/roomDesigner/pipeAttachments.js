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
import { utilityAnchorsWorld, utilityPortDescriptors, isVesselSymbol } from "./utilityPiping";
import {
  pointSegmentDistance,
  segmentElevationsForDesign,
  vertexElevationsForDesign,
  physicalRouteIn,
  validatedJunctionEdge,
  JUNCTION_TOLERANCE_IN,
  CONNECTION_FACE_TOLERANCE_IN,
} from "./pipeCrossings";
import { flangeNominalSizeIn, pipeOdIn, NOZZLE_NECK_LENGTH_IN } from "./flangeGeometry";
import { reducerConnectionAt } from "./pipeReducerModel";

export { JUNCTION_TOLERANCE_IN, CONNECTION_FACE_TOLERANCE_IN };

const ENDS = ["start", "end"];
const EPS = 1e-6;

/**
 * Shared side-nozzle face elevation rule: a process side nozzle's
 * connection face sits at this fraction of the equipment height above
 * its base. ONE rule feeds snap, reconcile, validation, and rendering —
 * they can never disagree about where a nozzle face is.
 */
export const SIDE_NOZZLE_ELEVATION_FRAC = 0.62;

/**
 * World anchors for catalog `nozzle` specs: local offset
 * (fx * effWidth / 2, fy * effDepth / 2) with effWidth / effDepth the
 * instance's size overrides or the catalog defaults, rotated by the
 * instance rotation — the same projection temaAnchorsWorld uses.
 * Plan frame: +fx = east, +fy = south.
 *
 * Generated-component lifecycle (D668-007): the instance may carry an
 * explicit authored nozzle list (`inst.nozzles`, an array of specs that
 * REPLACES the catalog set — [] deletes every nozzle) and/or stable
 * tombstones (`inst.nozzleTombstones`, an array of catalog nozzle ids
 * the user deleted). Both are plain instance fields, so they persist
 * through save/reload and ride the normal undoable edit path.
 */
export function catalogAnchorsWorld(symbol, inst) {
  let specs = symbol?.nozzles;
  if (Array.isArray(inst?.nozzles)) specs = inst.nozzles;
  if (!specs) return [];
  const tombstoned = new Set(
    Array.isArray(inst?.nozzleTombstones) ? inst.nozzleTombstones : [],
  );
  const effWidth = inst.widthIn ?? symbol.widthIn;
  const effDepth = inst.depthIn ?? symbol.depthIn;
  const rad = ((inst.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out = [];
  for (const n of specs) {
    if (!n || typeof n.id !== "string" || tombstoned.has(n.id)) continue;
    const lx = n.fx * (effWidth / 2);
    const ly = n.fy * (effDepth / 2);
    out.push({
      id: n.id,
      x: inst.x + lx * cos - ly * sin,
      y: inst.y + lx * sin + ly * cos,
      sizeIn: n.sizeIn,
    });
  }
  return out;
}

/** World anchors for any placed symbol instance (TEMA or catalog nozzles). */
export function anchorsOf(inst) {
  const symbol = findSymbol(inst.domain, inst.symbolId);
  if (symbol?.tema) return temaAnchorsWorld(symbol, inst);
  // A full instance nozzle-list override replaces the whole anchor
  // set (D668-007): [] deletes every anchor — process, downcomer, and
  // utility alike — and a custom list replaces the catalog set.
  if (Array.isArray(inst?.nozzles)) return catalogAnchorsWorld(symbol, inst);
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
 * The ONE shared 3D connection-face model (D668-005): where a nozzle's
 * flange face actually sits, for snap, reconcile, validation, and
 * rendering. Every consumer reads the face from here, so validation
 * and the 3D view can never disagree.
 *
 * Returns { anchorId, x, y, elevationIn, normal: {x, y} | null,
 *   vertical: bool, sizeIn, kind } or null for an unknown anchor.
 * - kind "top": the face is the flange at the neck top —
 *   base + height + neck length, normal straight up;
 * - kind "side": base + height * SIDE_NOZZLE_ELEVATION_FRAC, normal is
 *   the outward plan direction through the nozzle;
 * - kind "utility": the vessel's base utility port (explicit elevation
 *   and outward normal from utilityPiping);
 * - kind "downcomer": the level elevation, outward from the column;
 * - kind "tema": TEMA anchors carry no modeled elevation/normal — the
 *   legacy behavior (compatibility skips elevation) is preserved
 *   byte-identical, so elevationIn/normal are null.
 */
export function connectionFaceForAnchor(symbol, inst, anchorId) {
  if (!symbol || !inst || typeof anchorId !== "string") return null;
  const baseElevIn = inst.baseElevationIn ?? 0;
  const heightIn = inst.heightIn ?? symbol.heightIn ?? 0;
  const rad = ((inst.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate = (x, y) => ({ x: x * cos - y * sin, y: x * sin + y * cos });

  if (symbol.tema) {
    const anchor = temaAnchorsWorld(symbol, inst).find((a) => a.id === anchorId);
    if (!anchor) return null;
    return {
      anchorId,
      x: anchor.x,
      y: anchor.y,
      elevationIn: null,
      normal: null,
      vertical: false,
      sizeIn: null,
      kind: "tema",
    };
  }
  // Utility ports: explicit elevation + outward normal. A full
  // instance nozzle-list override (D668-007) replaces the whole anchor
  // set, so overridden-away ports resolve no face.
  if (isVesselSymbol(symbol) && !Array.isArray(inst?.nozzles)) {
    const port = utilityPortDescriptors(symbol, inst).find((p) => p.id === anchorId);
    if (port) {
      return {
        anchorId,
        x: port.x,
        y: port.y,
        elevationIn: port.elevationIn,
        normal: { x: port.dirX, y: port.dirY },
        vertical: false,
        sizeIn: port.sizeIn,
        kind: "utility",
      };
    }
  }
  // Downcomer level nozzles: the level elevation, outward from the
  // column. Same override rule as utility ports above.
  if (symbol.downcomers && !Array.isArray(inst?.nozzles)) {
    const level = downcomerAnchorsWorld(symbol, inst).find((a) => a.id === anchorId);
    if (level) {
      const spec = { x: level.x - inst.x, y: level.y - inst.y };
      const len = Math.hypot(spec.x, spec.y);
      const normal = len > 1e-9 ? { x: spec.x / len, y: spec.y / len } : { x: 0, y: 1 };
      return {
        anchorId,
        x: level.x,
        y: level.y,
        elevationIn: level.elevationIn,
        normal,
        vertical: false,
        sizeIn: level.sizeIn,
        kind: "downcomer",
      };
    }
  }
  // Generic catalog nozzles (honoring the instance lifecycle overrides).
  const anchor = catalogAnchorsWorld(symbol, inst).find((a) => a.id === anchorId);
  if (!anchor) return null;
  const spec = (Array.isArray(inst.nozzles) ? inst.nozzles : symbol.nozzles || []).find(
    (n) => n?.id === anchorId,
  );
  const fx = spec?.fx ?? 0;
  const fy = spec?.fy ?? 0;
  const radial = Math.hypot(fx, fy);
  if (radial < 0.01) {
    // Top nozzle: the flange face at the neck top.
    return {
      anchorId,
      x: anchor.x,
      y: anchor.y,
      elevationIn: baseElevIn + heightIn + NOZZLE_NECK_LENGTH_IN,
      normal: null,
      vertical: true,
      sizeIn: anchor.sizeIn,
      kind: "top",
    };
  }
  const n = rotate(fx / radial, fy / radial);
  return {
    anchorId,
    x: anchor.x,
    y: anchor.y,
    elevationIn: baseElevIn + heightIn * SIDE_NOZZLE_ELEVATION_FRAC,
    normal: n,
    vertical: false,
    sizeIn: anchor.sizeIn,
    kind: "side",
  };
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
  const faceCache = new Map();
  const faceFor = (ref) => {
    const inst = byId.get(ref.symbolId);
    if (!inst) return null;
    const key = `${inst.id}::${ref.anchorId}`;
    if (!faceCache.has(key)) {
      faceCache.set(key, connectionFaceForAnchor(findSymbol(inst.domain, inst.symbolId), inst, ref.anchorId));
    }
    return faceCache.get(key);
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
      // An attached end connects AT the nozzle's flange face: the shared
      // face model (snap, validation, rendering) sets the end's
      // elevation. A face without a modeled elevation (TEMA) leaves the
      // run's own elevation alone — legacy behavior preserved.
      const face = faceFor(ref);
      const faceElevIn = face && Number.isFinite(face.elevationIn) ? face.elevationIn : null;
      if (faceElevIn !== null) {
        if (!elevIn || elevIn.length !== points.length) {
          elevIn = points.map((_, k) => (Array.isArray(run.elevIn) ? run.elevIn[k] ?? null : null));
        }
        if (elevIn[i] !== faceElevIn) {
          elevIn[i] = faceElevIn;
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
// (JUNCTION_TOLERANCE_IN is defined in pipeCrossings.js and re-exported
// at the top of this module.)

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
 * A connection is only sound when the faces can actually meet:
 * - the run's nominal size must match the nozzle's (or a CONNECTED
 *   reducer fitting with matching declared sizes must sit at the
 *   connection point — proximity never waives a mismatch, PR668-001);
 * - the run must arrive at the flange face's elevation (the shared
 *   face model — D668-005);
 * - a pipe-to-pipe junction must join equal nominal sizes (or a
 *   connected reducer) AND meet at a shared face within
 *   CONNECTION_FACE_TOLERANCE_IN — barrel-overlap reach is not a
 *   connection, and a stale/off-route junction reference is refused,
 *   never approximated (D668-004).
 * Anything else is flagged here rather than silently drawn as connected.
 */
export function connectionCompatibilityErrors(design) {
  const errors = [];
  const byId = new Map((design?.symbols || []).map((s) => [s.id, s]));
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    const vertexElevs = vertexElevationsForDesign(design, run);
    const runSizeNom = flangeNominalSizeIn(run.diameterIn ?? 2);
    for (const end of ENDS) {
      const idx = end === "start" ? 0 : run.points.length - 1;
      const point = run.points[idx];
      const ref = run.attachments?.[end];
      if (ref) {
        const inst = byId.get(ref.symbolId);
        const symbol = inst ? findSymbol(inst.domain, inst.symbolId) : null;
        const face = symbol ? connectionFaceForAnchor(symbol, inst, ref.anchorId) : null;
        if (face) {
          if (
            face.sizeIn != null &&
            runSizeNom !== flangeNominalSizeIn(face.sizeIn) &&
            !reducerConnectionAt(design, point, run.diameterIn ?? 2, face.sizeIn)
          ) {
            errors.push(
              `Pipe run ${run.id} (${run.diameterIn ?? 2} in) connects to nozzle ${ref.anchorId} (${face.sizeIn} in) without a connected reducer/transition at the connection point.`,
            );
          }
          if (Number.isFinite(face.elevationIn)) {
            const endElev = vertexElevs[idx];
            if (Math.abs(endElev - face.elevationIn) > CONNECTION_FACE_TOLERANCE_IN) {
              errors.push(
                `Pipe run ${run.id} reaches nozzle ${ref.anchorId} at elevation ${Math.round(endElev)} in, but the flange face is at ${face.elevationIn} in.`,
              );
            }
          }
        }
        continue;
      }
      const junction = run.junctions?.[end];
      if (junction) {
        const edge = validatedJunctionEdge(design, run, end);
        if (edge.status === "no-host") {
          errors.push(
            `Pipe run ${run.id} claims a junction to unknown pipe run ${junction.runId} — stale reference.`,
          );
        } else if (edge.status === "off-route") {
          errors.push(
            `Pipe run ${run.id} claims a junction to pipe run ${junction.runId}, but its end does not touch that run — stale or off-route reference proves no connection.`,
          );
        } else if (edge.status === "elevation") {
          errors.push(
            `Pipe run ${run.id} joins pipe run ${edge.host.id} in plan, but the face elevations do not meet (${Math.round(edge.myElevIn)} in vs ${Math.round(edge.hostElevIn)} in) — not a flanged connection.`,
          );
        } else if (edge.status === "ok") {
          const hostSizeNom = flangeNominalSizeIn(edge.host.diameterIn ?? 2);
          if (
            runSizeNom !== hostSizeNom &&
            !reducerConnectionAt(design, point, run.diameterIn ?? 2, edge.host.diameterIn ?? 2)
          ) {
            errors.push(
              `Pipe run ${run.id} (${run.diameterIn ?? 2} in) junctions onto pipe run ${edge.host.id} (${edge.host.diameterIn ?? 2} in) without a connected reducer/transition at the tap.`,
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

// ---- Tee fittings (PR668-005) ----
//
// A modeled pipe-to-pipe junction is a real branch FITTING, not just a
// logical connection plus a flange pair: the fitting has a body and
// stable ports — the branch port plus the two host-side ports (one host
// port for an end-to-end coupled joint). Fittings derive from validated
// junction edges, so a stale/off-route junction record yields no
// fitting. Port ids are stable per junction (`tee-<runId>-<end>::<port>`)
// and survive attach/detach/resize/copy/round-trips because the junction
// record they derive from does.

/**
 * Every validated pipe-to-pipe junction as a tee fitting:
 * [{ id, branchRunId, hostRunId, end, x, y, elevationIn,
 *    branchSizeIn, hostSizeIn, branchAxisDeg, hostAxisDeg,
 *    body: { x, y, elevationIn, branchSizeIn, hostSizeIn },
 *    ports: [{ port: "branch"|"host-a"|"host-b", id, x, y,
 *              elevationIn, sizeIn, axisDeg }] }]
 * The body sits at the tap point at the joint elevation; the branch
 * port faces along the branch axis, the host ports along the host axis
 * in both directions (one direction for a coupled end-to-end joint).
 */
export function teeFittings(design) {
  const out = [];
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    for (const end of ENDS) {
      const edge = validatedJunctionEdge(design, run, end);
      if (edge.status !== "ok") continue;
      const idx = end === "start" ? 0 : run.points.length - 1;
      const branchPoint = run.points[idx];
      const neighbor = run.points[end === "start" ? 1 : run.points.length - 2];
      const branchAxisDeg =
        (Math.atan2(neighbor.y - branchPoint.y, neighbor.x - branchPoint.x) * 180) / Math.PI;
      const route = physicalRouteIn(design, edge.host);
      const hA = route[edge.hostSegIndex];
      const hB = route[edge.hostSegIndex + 1];
      const hostAxisDeg = (Math.atan2(hB.y - hA.y, hB.x - hA.x) * 180) / Math.PI;
      const branchSizeIn = flangeNominalSizeIn(run.diameterIn ?? 2);
      const hostSizeIn = flangeNominalSizeIn(edge.host.diameterIn ?? 2);
      const id = `tee-${run.id}-${end}`;
      const elev = edge.myElevIn;
      // End-to-end coupled joint: the tap sits on the host's endpoint,
      // so the host continues in one direction only.
      const hostFirst = route[0];
      const hostLast = route[route.length - 1];
      const atHostEnd =
        Math.hypot(edge.point.x - hostFirst.x, edge.point.y - hostFirst.y) <= EPS ||
        Math.hypot(edge.point.x - hostLast.x, edge.point.y - hostLast.y) <= EPS;
      const ports = [
        {
          port: "branch",
          id: `${id}::branch`,
          x: branchPoint.x,
          y: branchPoint.y,
          elevationIn: elev,
          sizeIn: branchSizeIn,
          axisDeg: branchAxisDeg,
        },
        {
          port: "host-a",
          id: `${id}::host-a`,
          x: edge.point.x,
          y: edge.point.y,
          elevationIn: edge.hostElevIn,
          sizeIn: hostSizeIn,
          axisDeg: hostAxisDeg,
        },
      ];
      if (!atHostEnd) {
        ports.push({
          port: "host-b",
          id: `${id}::host-b`,
          x: edge.point.x,
          y: edge.point.y,
          elevationIn: edge.hostElevIn,
          sizeIn: hostSizeIn,
          axisDeg: hostAxisDeg + 180,
        });
      }
      out.push({
        id,
        branchRunId: run.id,
        hostRunId: edge.host.id,
        end,
        x: edge.point.x,
        y: edge.point.y,
        elevationIn: elev,
        branchSizeIn,
        hostSizeIn,
        branchAxisDeg,
        hostAxisDeg,
        body: {
          x: edge.point.x,
          y: edge.point.y,
          elevationIn: elev,
          branchSizeIn,
          hostSizeIn,
        },
        ports,
      });
    }
  }
  return out;
}
