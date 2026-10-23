// Reducer / transition fitting model (PR668-001, R1 fix round 2).
//
// A reducer is a CONNECTED component with OWNED inlet/outlet
// interfaces — not a proximity waiver. Each interface carries the
// connection point, the interface elevation, the port's direction
// along the reducer's axis, and its declared size. A size transition
// (pipe-to-pipe junction or equipment attachment) validates ONLY when
// a reducer's interfaces BIND it: the reducer sits at the connection
// point, its interface elevation matches the connection's face
// elevation, its axis aligns with the transition axis, and the port
// facing each side carries that side's nominal size. A reducer
// floating nearby, sitting at the wrong elevation, rotated across the
// transition, or declaring the right sizes on the wrong ports
// authorizes nothing — and the connection graph builds no supply edge
// through an unbound transition.
//
// Reducers are ordinary piping-domain symbol instances (catalog id
// "reducer"), so move, resize, delete, copy/paste, undo/redo, and
// save/reload ride the existing symbol machinery. The declared sizes
// live on the instance as `inletSizeIn` / `outletSizeIn` (nominal
// inches); the interface elevation lives on the instance as
// `elevationIn`. `placeReducer` is the authoring command: placing a
// reducer AT a modeled connection binds it to that connection (the
// interface elevation — and, unless the caller specifies a rotation,
// the axis orientation — are stamped from the connection itself). A
// reducer placed any other way carries no interface elevation and
// binds nothing until it is modeled at a connection.
//
// Pure and framework-free.

import { placeSymbol } from "./designerDocument";
import { flangeNominalSizeIn } from "./flangeGeometry";
import {
  CONNECTION_FACE_TOLERANCE_IN,
  vertexElevationsForDesign,
} from "./pipeCrossings";

/** A reducer must sit this close (plan in) to the connection point to count. */
export const REDUCER_CONNECTION_TOLERANCE_IN = 1;

/** A reducer's axis must align with the transition axis within this (deg). */
export const REDUCER_AXIS_TOLERANCE_DEG = 20;

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

const normDeg = (deg) => ((deg % 360) + 360) % 360;

/** Smallest absolute angle (deg) between two directions. */
export function angularDistanceDeg(a, b) {
  const d = Math.abs(normDeg(a) - normDeg(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * A reducer's OWNED interfaces (R1): the two ports resolved to the
 * connection frame — plan position, interface elevation (null when
 * the instance carries none, in which case the reducer binds
 * nothing), and the direction each port faces along the reducer's
 * axis. rotationDeg points the OUTLET (smaller side) along the axis;
 * the inlet faces the opposite direction.
 * { id, x, y, elevationIn, axisDeg, ports: [{ port, id, sizeIn,
 *   dirDeg, x, y, elevationIn }] } — or null when the instance
 * declares no usable sizes.
 */
export function reducerInterfaces(inst) {
  const sizes = reducerSizes(inst);
  if (!sizes) return null;
  const axisDeg = normDeg(inst.rotationDeg || 0);
  const elevationIn = Number.isFinite(inst.elevationIn) ? inst.elevationIn : null;
  return {
    id: inst.id,
    x: inst.x,
    y: inst.y,
    elevationIn,
    axisDeg,
    ports: [
      {
        port: "inlet",
        id: `${inst.id}::inlet`,
        sizeIn: sizes.inletSizeIn,
        dirDeg: normDeg(axisDeg + 180),
        x: inst.x,
        y: inst.y,
        elevationIn,
      },
      {
        port: "outlet",
        id: `${inst.id}::outlet`,
        sizeIn: sizes.outletSizeIn,
        dirDeg: axisDeg,
        x: inst.x,
        y: inst.y,
        elevationIn,
      },
    ],
  };
}

/**
 * The reducer whose owned interfaces BIND the transition at
 * (x, y, elevationIn) — or null. `sides` names the two sides of the
 * transition: [{ sizeIn, dirDeg }], dirDeg pointing from the
 * connection point TOWARD that side's pipe. Binding requires ALL of:
 * the reducer at the point (REDUCER_CONNECTION_TOLERANCE_IN); a
 * finite interface elevation matching the connection's face
 * elevation (CONNECTION_FACE_TOLERANCE_IN); and, for each side, a
 * distinct port facing that side (REDUCER_AXIS_TOLERANCE_DEG) with an
 * equal nominal size.
 */
export function boundReducerAt(design, { x, y, elevationIn, sides } = {}) {
  if (!Number.isFinite(elevationIn) || !Array.isArray(sides) || sides.length === 0) {
    return null;
  }
  for (const inst of design?.symbols || []) {
    if (!isReducerInstance(inst)) continue;
    if (Math.hypot(inst.x - x, inst.y - y) > REDUCER_CONNECTION_TOLERANCE_IN) continue;
    const ifaces = reducerInterfaces(inst);
    if (!ifaces || !Number.isFinite(ifaces.elevationIn)) continue;
    if (Math.abs(ifaces.elevationIn - elevationIn) > CONNECTION_FACE_TOLERANCE_IN) continue;
    const used = new Set();
    let binds = true;
    for (const side of sides) {
      const port = ifaces.ports.find(
        (p) =>
          !used.has(p.port) &&
          angularDistanceDeg(p.dirDeg, side.dirDeg) <= REDUCER_AXIS_TOLERANCE_DEG &&
          flangeNominalSizeIn(p.sizeIn) === flangeNominalSizeIn(side.sizeIn),
      );
      if (!port) {
        binds = false;
        break;
      }
      used.add(port.port);
    }
    if (binds) return inst;
  }
  return null;
}

/**
 * The modeled connection (junction tap or attached equipment end) at
 * a plan point, if one exists: { elevationIn, axisDeg, runSizeIn,
 * otherSizeIn }. The axis points from the connection point into the
 * run whose end sits there; otherSizeIn is the far side's size (host
 * run for a junction; unknown for an attachment, null).
 */
function connectionAtPoint(design, x, y) {
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    for (const end of ["start", "end"]) {
      const idx = end === "start" ? 0 : run.points.length - 1;
      const point = run.points[idx];
      if (Math.hypot(point.x - x, point.y - y) > REDUCER_CONNECTION_TOLERANCE_IN) continue;
      const junction = run.junctions?.[end];
      const attachment = run.attachments?.[end];
      if (!junction && !attachment) continue;
      const neighbor = run.points[end === "start" ? 1 : run.points.length - 2];
      const axisDeg = (Math.atan2(neighbor.y - point.y, neighbor.x - point.x) * 180) / Math.PI;
      const elevationIn = vertexElevationsForDesign(design, run)[idx];
      let otherSizeIn = null;
      if (junction) {
        const host = (design?.pipes || []).find((r) => r.id === junction.runId);
        if (host) otherSizeIn = host.diameterIn ?? 2;
      }
      return { elevationIn, axisDeg, runSizeIn: run.diameterIn ?? 2, otherSizeIn };
    }
  }
  return null;
}

/**
 * Place a reducer fitting AT a connection point, declaring the
 * transition it models. When the point carries a modeled connection,
 * the reducer BINDS to it: the interface elevation is stamped from
 * the connection, and — unless rotationDeg is given — the axis is
 * oriented so the outlet (smaller side) faces the smaller side of the
 * transition. Throws on non-positive or undeclared sizes — a reducer
 * with no declared sizes authorizes nothing.
 */
export function placeReducer(design, x, y, { id, inletSizeIn, outletSizeIn, rotationDeg } = {}) {
  if (!(inletSizeIn > 0) || !(outletSizeIn > 0)) {
    throw new Error("A reducer must declare positive inlet and outlet sizes.");
  }
  const conn = connectionAtPoint(design, x, y);
  let rot = rotationDeg;
  if (rot === undefined) {
    rot = 0;
    if (conn) {
      // The outlet faces the smaller side: the branch/run side when
      // the outlet matches its size, otherwise the far side.
      const outletIsRunSide =
        flangeNominalSizeIn(outletSizeIn) === flangeNominalSizeIn(conn.runSizeIn) &&
        (conn.otherSizeIn === null ||
          flangeNominalSizeIn(inletSizeIn) === flangeNominalSizeIn(conn.otherSizeIn));
      rot = outletIsRunSide ? conn.axisDeg : conn.axisDeg + 180;
    }
  }
  let next = placeSymbol(design, "piping", "reducer", x, y, { id, rotationDeg: rot });
  const placed = next.symbols[next.symbols.length - 1];
  next = {
    ...next,
    symbols: next.symbols.map((s) =>
      s.id === placed.id
        ? {
            ...s,
            inletSizeIn,
            outletSizeIn,
            ...(conn && Number.isFinite(conn.elevationIn) ? { elevationIn: conn.elevationIn } : {}),
          }
        : s,
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
