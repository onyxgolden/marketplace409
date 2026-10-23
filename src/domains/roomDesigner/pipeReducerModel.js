// Reducer / transition fitting model (PR668-001).
//
// A reducer is a CONNECTED component with stable inlet/outlet ports and
// declared sizes — not a proximity waiver. A pipe-to-pipe junction (or an
// equipment attachment) whose two sides differ in nominal size validates
// ONLY when a reducer instance sits AT the connection point (within
// REDUCER_CONNECTION_TOLERANCE_IN of it) with declared inlet/outlet sizes
// that nominal-match the two sides, in either orientation. A reducer
// floating nearby but unconnected authorizes nothing.
//
// Reducers are ordinary piping-domain symbol instances (catalog id
// "reducer"), so placement, move, resize, delete, copy/paste, undo/redo,
// and save/reload all ride the existing symbol machinery. The declared
// sizes live on the instance as `inletSizeIn` / `outletSizeIn`
// (nominal inches); the ports below derive from them with stable ids.
//
// Pure and framework-free.

import { placeSymbol } from "./designerDocument";
import { flangeNominalSizeIn } from "./flangeGeometry";

/** A reducer must sit this close (plan in) to the connection point to count. */
export const REDUCER_CONNECTION_TOLERANCE_IN = 1;

/** True for a piping-domain reducer instance. */
export function isReducerInstance(inst) {
  return inst?.domain === "piping" && inst?.symbolId === "reducer";
}

/**
 * A reducer's declared transition sizes, nominalized:
 * { inletSizeIn, outletSizeIn } or null when the instance declares none.
 */
export function reducerSizes(inst) {
  if (!isReducerInstance(inst)) return null;
  const inlet = Number(inst?.inletSizeIn);
  const outlet = Number(inst?.outletSizeIn);
  if (!(inlet > 0) || !(outlet > 0)) return null;
  return {
    inletSizeIn: flangeNominalSizeIn(inlet),
    outletSizeIn: flangeNominalSizeIn(outlet),
  };
}

/**
 * A reducer's stable ports: the inlet (toward the larger side) and the
 * outlet (toward the smaller side), with the instance's declared sizes.
 * [{ port: "inlet"|"outlet", id, sizeIn }] — ids are stable per instance.
 */
export function reducerPorts(inst) {
  const sizes = reducerSizes(inst);
  if (!sizes) return [];
  return [
    { port: "inlet", id: `${inst.id}::inlet`, sizeIn: sizes.inletSizeIn },
    { port: "outlet", id: `${inst.id}::outlet`, sizeIn: sizes.outletSizeIn },
  ];
}

/**
 * The reducer instance CONNECTED at `point` whose declared sizes
 * nominal-match `sizeA`/`sizeB` (either orientation) — or null. Being
 * within tolerance of the connection point is what makes it connected;
 * proximity beyond the tolerance never waives a mismatch.
 */
export function reducerConnectionAt(design, point, sizeA, sizeB) {
  const a = flangeNominalSizeIn(sizeA);
  const b = flangeNominalSizeIn(sizeB);
  for (const inst of design?.symbols || []) {
    if (!isReducerInstance(inst)) continue;
    if (Math.hypot(inst.x - point.x, inst.y - point.y) > REDUCER_CONNECTION_TOLERANCE_IN) continue;
    const sizes = reducerSizes(inst);
    if (!sizes) continue;
    const pair = [sizes.inletSizeIn, sizes.outletSizeIn].sort((x, y) => x - y);
    const want = [a, b].sort((x, y) => x - y);
    if (pair[0] === want[0] && pair[1] === want[1]) return inst;
  }
  return null;
}

/**
 * Place a reducer fitting at a connection point, declaring the
 * transition it models. rotationDeg orients the reducer's axis along
 * the smaller (branch) side. Throws on non-positive or undeclared
 * sizes — a reducer with no declared sizes authorizes nothing.
 */
export function placeReducer(design, x, y, { id, inletSizeIn, outletSizeIn, rotationDeg = 0 } = {}) {
  if (!(inletSizeIn > 0) || !(outletSizeIn > 0)) {
    throw new Error("A reducer must declare positive inlet and outlet sizes.");
  }
  let next = placeSymbol(design, "piping", "reducer", x, y, { id, rotationDeg });
  const placed = next.symbols[next.symbols.length - 1];
  next = {
    ...next,
    symbols: next.symbols.map((s) =>
      s.id === placed.id ? { ...s, inletSizeIn, outletSizeIn } : s,
    ),
  };
  return next;
}

/** Edit a placed reducer's declared transition sizes (undoable, like any edit). */
export function setReducerSizes(design, reducerId, { inletSizeIn, outletSizeIn }) {
  const inst = (design?.symbols || []).find((s) => s.id === reducerId);
  if (!inst) throw new Error(`Unknown symbol instance: ${reducerId}`);
  if (!isReducerInstance(inst)) throw new Error(`Symbol ${reducerId} is not a reducer.`);
  if (!(inletSizeIn > 0) || !(outletSizeIn > 0)) {
    throw new Error("A reducer must declare positive inlet and outlet sizes.");
  }
  return {
    ...design,
    symbols: design.symbols.map((s) =>
      s.id === reducerId ? { ...s, inletSizeIn, outletSizeIn } : s,
    ),
  };
}

/** validateDesign messages for reducer instances. */
export function reducerErrors(design) {
  const errors = [];
  for (const inst of design?.symbols || []) {
    if (!isReducerInstance(inst)) continue;
    if (!reducerSizes(inst)) {
      errors.push(
        `Reducer ${inst.id} declares no usable inlet/outlet sizes — a reducer without declared sizes authorizes no size transition.`,
      );
    }
  }
  return errors;
}
