// Pipe ends attached to equipment nozzles (connection anchors).
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

const ENDS = ["start", "end"];
const EPS = 1e-6;

function anchorsOf(inst) {
  const symbol = findSymbol(inst.domain, inst.symbolId);
  return symbol?.tema ? temaAnchorsWorld(symbol, inst) : [];
}

/** The nozzle exactly at `point` (within 1e-6 in): { symbolId, anchorId } or null. */
export function anchorAtPoint(design, point) {
  for (const inst of design?.symbols || []) {
    for (const a of anchorsOf(inst)) {
      if (Math.abs(a.x - point.x) <= EPS && Math.abs(a.y - point.y) <= EPS) {
        return { symbolId: inst.id, anchorId: a.id };
      }
    }
  }
  return null;
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
    const found = {
      start: anchorAtPoint(design, run.points[0]),
      end: anchorAtPoint(design, run.points[run.points.length - 1]),
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
    }
    if (!runChanged) return run;
    changed = true;
    return withAttachments({ ...run, points }, kept);
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
