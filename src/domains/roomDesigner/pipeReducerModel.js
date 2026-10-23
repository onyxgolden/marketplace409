// Reducer / transition fitting model (PR668-001, R1 fix round 2,
// F1 fix round 3).
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
// OWNERSHIP (F1): geometry alone never binds. Each port also persists
// a stable OWNERSHIP reference naming the exact interface it serves
// (inst.portOwners: { inlet, outlet }), one of:
//   { kind: "run-end",     runId, end }            — a pipe run's end;
//   { kind: "run-segment", runId, segmentIndex }   — a host run's
//                                                    tapped segment;
//   { kind: "nozzle",      symbolId, anchorId }    — an equipment
//                                                    nozzle face;
//   { kind: "spray-inlet", symbolId, anchorId }    — a directed-spray
//                                                    assembly's inlet.
// Validators (validatedJunctionEdge, nozzle compatibility, spray
// supply) present the two participating interfaces and a reducer
// binds ONLY when its ports own exactly that pair. One reducer at a
// coincident, same-elevation, same-axis transition therefore cannot
// service a second, unrelated transition that merely shares its
// point. `placeReducer` stamps the ownership pair from the modeled
// connection at its point — and REJECTS the placement as ambiguous
// when more than one distinct connection shares the point, unless
// the caller names the participating run end (`forRun`).
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
  JUNCTION_TOLERANCE_IN,
  effectiveApproachSegment,
  physicalRouteIn,
  pointSegmentDistance,
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
 * The closed kind-specific schemas for ownership references (F1.1).
 * Identifiers are NOT restricted to exclude delimiters — a caller may
 * author symbol/anchor ids containing ':' — so owner identity is
 * never encoded by raw string concatenation (where
 * { nozzle, "v:a", "b" } and { nozzle, "v", "a:b" } collide). A
 * reference validates against exactly one schema — kind plus its
 * named fields, no extras — and its canonical form is the typed
 * tuple, JSON-encoded (JSON array encoding is injective for any
 * identifier content: quoting/escaping is part of the encoding).
 *
 * The table is a Map, not a plain object (F1.2): a bracket lookup on
 * a plain object resolves kinds naming inherited Object.prototype
 * members ("constructor", "__proto__", "toString", ...) to truthy
 * non-schema values, and validation threw instead of refusing the
 * malformed reference. A Map lookup never consults the prototype
 * chain — every unknown kind, string or otherwise, simply misses.
 */
const OWNER_REF_SCHEMAS = new Map([
  ["run-end", ["runId", "end"]],
  ["run-segment", ["runId", "segmentIndex"]],
  ["nozzle", ["symbolId", "anchorId"]],
  ["spray-inlet", ["symbolId", "anchorId"]],
]);

/**
 * Validate an ownership reference against its kind's closed schema
 * and return the canonical tuple [kind, ...fields] — or null when
 * the reference is malformed (unknown kind, missing/extra fields,
 * wrong field types, a run end that is not exactly "start"/"end",
 * or a segment index that is not a non-negative integer: naming a
 * run without naming the interface on it is not an identity).
 * Malformed references never compare equal and never bind — every
 * consumer fails closed on them.
 */
export function normalizeOwnerRef(ref) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
  const fields = OWNER_REF_SCHEMAS.get(ref.kind);
  if (!fields) return null;
  for (const key of Object.keys(ref)) {
    if (key !== "kind" && !fields.includes(key)) return null;
  }
  const tuple = [ref.kind];
  for (const field of fields) {
    const value = ref[field];
    if (field === "end") {
      if (value !== "start" && value !== "end") return null;
    } else if (field === "segmentIndex") {
      if (!Number.isInteger(value) || value < 0) return null;
    } else if (typeof value !== "string") {
      return null;
    }
    tuple.push(value);
  }
  return tuple;
}

/**
 * A stable string key for an ownership reference (F1) — the identity
 * validators compare. Two references own the same interface iff
 * their canonical tuples are equal. Null for a malformed reference.
 */
export function reducerOwnerKey(ref) {
  const tuple = normalizeOwnerRef(ref);
  return tuple ? JSON.stringify(tuple) : null;
}

/**
 * An unambiguous key for an UNORDERED pair of ownership references
 * (F1.1) — the dedup key for modeled connections: {A, B} and {B, A}
 * key identically, and distinct pairs never collide (each side is
 * canonically encoded first; there is no delimiter join to move the
 * collision to). Null when either side is malformed.
 */
export function ownerPairKey(a, b) {
  const ka = reducerOwnerKey(a);
  const kb = reducerOwnerKey(b);
  if (ka === null || kb === null) return null;
  return JSON.stringify([ka, kb].sort());
}

/** True when two ownership references name the same interface. */
export function reducerOwnersEqual(a, b) {
  const ka = reducerOwnerKey(a);
  return ka !== null && ka === reducerOwnerKey(b);
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
  const owners = inst.portOwners && typeof inst.portOwners === "object" ? inst.portOwners : {};
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
        owner: owners.inlet ?? null,
      },
      {
        port: "outlet",
        id: `${inst.id}::outlet`,
        sizeIn: sizes.outletSizeIn,
        dirDeg: axisDeg,
        x: inst.x,
        y: inst.y,
        elevationIn,
        owner: owners.outlet ?? null,
      },
    ],
  };
}

/**
 * The reducer whose owned interfaces BIND the transition at
 * (x, y, elevationIn) — or null. `sides` names the two sides of the
 * transition: [{ sizeIn, dirDeg, owner? }], dirDeg pointing from the
 * connection point TOWARD that side's pipe, owner the side's stable
 * interface reference (F1). Binding requires ALL of: the reducer at
 * the point (REDUCER_CONNECTION_TOLERANCE_IN); a finite interface
 * elevation matching the connection's face elevation
 * (CONNECTION_FACE_TOLERANCE_IN); and, for each side, a distinct port
 * facing that side (REDUCER_AXIS_TOLERANCE_DEG) with an equal nominal
 * size AND — whenever the side names an owner — a port whose
 * persisted ownership reference IS that interface. A side without an
 * owner asks the geometric question only (authoring-time existence
 * checks); every validator passes owners, so an unowned or
 * foreign-owned reducer authorizes no validated transition.
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
          flangeNominalSizeIn(p.sizeIn) === flangeNominalSizeIn(side.sizeIn) &&
          (!side.owner || reducerOwnersEqual(p.owner, side.owner)),
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
 * The host-side interface reference for a junction tap (F1): the host
 * run's own end when the tap lands on it (a coupled joint — the pair
 * is then two run ends, symmetric from either direction), else the
 * host segment the tap lands on.
 */
export function junctionHostOwner(design, host, point) {
  if (host && Array.isArray(host.points) && host.points.length >= 2) {
    for (const end of ["start", "end"]) {
      const hp = end === "start" ? host.points[0] : host.points[host.points.length - 1];
      if (Math.hypot(hp.x - point.x, hp.y - point.y) <= JUNCTION_TOLERANCE_IN) {
        return { kind: "run-end", runId: host.id, end };
      }
    }
    const route = physicalRouteIn(design, host);
    let best = null;
    for (let i = 0; i + 1 < route.length; i += 1) {
      const hit = pointSegmentDistance(point, route[i], route[i + 1]);
      if (hit.distance <= JUNCTION_TOLERANCE_IN + 1e-9 && (!best || hit.distance < best.distance)) {
        best = { i, distance: hit.distance };
      }
    }
    if (best) return { kind: "run-segment", runId: host.id, segmentIndex: best.i };
  }
  return { kind: "run-segment", runId: host?.id, segmentIndex: null };
}

/**
 * EVERY modeled connection (junction tap, attached equipment end, or
 * authored spray-inlet end) whose run end sits at a plan point (F1):
 * [{ elevationIn, axisDeg, runId, end, runSizeIn, otherSizeIn,
 *    mineOwner, otherOwner }]. The axis points from the connection
 * point into the run whose end sits there; otherSizeIn is the far
 * side's size (host run for a junction; the inlet's authored size for
 * a spray inlet; unknown for an equipment attachment, null). Distinct
 * connections are deduplicated by their ownership pair — the two
 * junction records of one coupled joint describe ONE connection.
 * Returning all of them (never silently the first) is what lets
 * placeReducer reject an ambiguous point instead of binding whichever
 * connection happened to be enumerated first.
 */
export function modeledConnectionsAtPoint(design, x, y) {
  const out = [];
  const seen = new Set();
  const spraysByInletRun = new Map();
  for (const s of design?.symbols || []) {
    if (s?.domain === "piping" && s?.symbolId === "spray-nozzle" && s.inletRunId) {
      // Canonical tuple key (F1.1): the raw persisted inletEnd is not
      // delimiter-free, so a ':' join could cross-match another run.
      spraysByInletRun.set(JSON.stringify([s.inletRunId, s.inletEnd]), s);
    }
  }
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    for (const end of ["start", "end"]) {
      const idx = end === "start" ? 0 : run.points.length - 1;
      const point = run.points[idx];
      if (Math.hypot(point.x - x, point.y - y) > REDUCER_CONNECTION_TOLERANCE_IN) continue;
      const junction = run.junctions?.[end];
      const attachment = run.attachments?.[end];
      const spray = spraysByInletRun.get(JSON.stringify([run.id, end]));
      if (!junction && !attachment && !spray) continue;
      // F4.4: report the EFFECTIVE approach axis — the direction of
      // the first evidence-bearing segment (see
      // effectiveApproachSegment in pipeCrossings). The literal
      // terminal segment fabricated the axis (atan2(0,0) = 0 for a
      // duplicate terminal vertex), and placeReducer persists this
      // value into rotationDeg, so a fabricated read here became a
      // fabricated record the gates then agreed with.
      const axisDeg = effectiveApproachSegment(design, run, end).axisDeg;
      const elevationIn = vertexElevationsForDesign(design, run)[idx];
      const mineOwner = { kind: "run-end", runId: run.id, end };
      const candidates = [];
      if (junction) {
        const host = (design?.pipes || []).find((r) => r.id === junction.runId);
        candidates.push({
          otherOwner: host
            ? junctionHostOwner(design, host, point)
            : { kind: "run-segment", runId: junction.runId, segmentIndex: null },
          otherSizeIn: host ? (host.diameterIn ?? 2) : null,
        });
      }
      if (attachment) {
        candidates.push({
          otherOwner: {
            kind: "nozzle",
            symbolId: attachment.symbolId,
            anchorId: attachment.anchorId,
          },
          otherSizeIn: null,
        });
      }
      if (spray) {
        candidates.push({
          otherOwner: { kind: "spray-inlet", symbolId: spray.id, anchorId: "inlet" },
          otherSizeIn: Number.isFinite(spray.inletSizeIn) ? spray.inletSizeIn : null,
        });
      }
      for (const c of candidates) {
        const key = ownerPairKey(mineOwner, c.otherOwner);
        if (key !== null) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        out.push({
          elevationIn,
          axisDeg,
          runId: run.id,
          end,
          runSizeIn: run.diameterIn ?? 2,
          otherSizeIn: c.otherSizeIn,
          mineOwner,
          otherOwner: c.otherOwner,
        });
      }
    }
  }
  return out;
}

/**
 * Place a reducer fitting AT a connection point, declaring the
 * transition it models. When the point carries a modeled connection,
 * the reducer BINDS to it: the interface elevation is stamped from
 * the connection, the axis is oriented (unless rotationDeg is given)
 * so the outlet (smaller side) faces the smaller side of the
 * transition, and BOTH ports' ownership references are persisted
 * from the connection's participating interfaces (F1) — the outlet
 * owns the smaller side's interface, the inlet the larger side's.
 * When MORE THAN ONE distinct connection shares the point, the
 * placement is ambiguous and is REJECTED (throws) unless the caller
 * names the participating run end via `forRun: { runId, end }`.
 * Throws on non-positive or undeclared sizes — a reducer with no
 * declared sizes authorizes nothing.
 */
export function placeReducer(
  design,
  x,
  y,
  { id, inletSizeIn, outletSizeIn, rotationDeg, forRun } = {},
) {
  if (!(inletSizeIn > 0) || !(outletSizeIn > 0)) {
    throw new Error("A reducer must declare positive inlet and outlet sizes.");
  }
  const conns = modeledConnectionsAtPoint(design, x, y);
  let conn = null;
  if (conns.length > 1) {
    const selected = forRun
      ? conns.filter((c) => c.runId === forRun.runId && c.end === forRun.end)
      : [];
    if (selected.length !== 1) {
      throw new Error(
        `Reducer placement at (${x}, ${y}) is ambiguous: ${conns.length} modeled connections share this point — name the participating run end with forRun { runId, end } instead of binding the first connection found.`,
      );
    }
    conn = selected[0];
  } else if (conns.length === 1) {
    if (forRun && (conns[0].runId !== forRun.runId || conns[0].end !== forRun.end)) {
      throw new Error(
        `Reducer placement at (${x}, ${y}): no modeled connection for run ${forRun.runId} (${forRun.end}) at this point.`,
      );
    }
    conn = conns[0];
  }
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
  let portOwners = null;
  if (conn) {
    // The outlet (smaller side) owns the smaller side's interface;
    // the inlet owns the larger side's. Equal/unknown far sizes keep
    // the run side on the outlet, matching the rotation rule above.
    const runSize = flangeNominalSizeIn(conn.runSizeIn);
    const otherSize =
      conn.otherSizeIn === null || conn.otherSizeIn === undefined
        ? null
        : flangeNominalSizeIn(conn.otherSizeIn);
    portOwners =
      otherSize === null || runSize <= otherSize
        ? { outlet: conn.mineOwner, inlet: conn.otherOwner }
        : { outlet: conn.otherOwner, inlet: conn.mineOwner };
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
            ...(portOwners ? { portOwners } : {}),
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
  const runIds = new Set((design?.pipes || []).map((r) => r.id));
  const symbolIds = new Set((design?.symbols || []).map((s) => s.id));
  for (const inst of design?.symbols || []) {
    if (!isReducerInstance(inst)) continue;
    if (!reducerSizes(inst)) {
      errors.push(
        `Reducer ${inst.id} declares no usable inlet/outlet sizes — a reducer without declared sizes authorizes no size transition.`,
      );
    }
    // F1: a persisted ownership reference must still resolve — a
    // reducer owning a deleted run end or nozzle face is stale, and
    // its (non-)binding is reported rather than silently lapsing.
    const owners = inst.portOwners;
    if (owners && typeof owners === "object") {
      for (const port of ["inlet", "outlet"]) {
        const ref = owners[port];
        if (!ref) continue;
        // F1.1/fail-closed: a persisted reference that does not
        // validate against its kind's closed schema is malformed —
        // reported as such (it can never bind), not silently carried
        // and not misreported as merely stale.
        if (!normalizeOwnerRef(ref)) {
          errors.push(
            `Reducer ${inst.id} ${port} port carries a malformed ownership reference — it names no valid interface and binds nothing.`,
          );
          continue;
        }
        const stale =
          ((ref.kind === "run-end" || ref.kind === "run-segment") && !runIds.has(ref.runId)) ||
          ((ref.kind === "nozzle" || ref.kind === "spray-inlet") && !symbolIds.has(ref.symbolId));
        if (stale) {
          errors.push(
            `Reducer ${inst.id} ${port} port owns ${reducerOwnerKey(ref)}, which no longer exists — stale ownership reference.`,
          );
        }
      }
    }
  }
  return errors;
}
