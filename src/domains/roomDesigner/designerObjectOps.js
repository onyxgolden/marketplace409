// Whole-selection edits: duplicate and paste, flip, delete, and move for any
// selection the designer can hold — a single object, the furniture
// multi-select, the whole house, or a group left by a paste.
//
// Pure: every function returns a new design document. The reducer wraps each
// one in touch(), so every action is a single undo step.
//
// A "scope" lists element ids per collection:
//   { walls, rooms, furniture, symbols, pipes, orgCharts, decks, annotations }
// Openings are not listed; they follow their walls.

import {
  decksOf,
  deckOverlapsExisting,
  deleteDeck,
  deleteFurniture,
  deleteOrgChart,
  deletePipeRun,
  deleteSymbol,
  deleteWall,
  findRoom,
  findWall,
  newElementId,
} from "./designerDocument";

/** How far a copy or duplicate lands from its source, in inches (about a foot). */
export const DUPLICATE_OFFSET_IN = 12;

export const SCOPE_KEYS = Object.freeze([
  "walls",
  "rooms",
  "furniture",
  "symbols",
  "pipes",
  "orgCharts",
  "decks",
  "annotations",
]);

function emptyScope() {
  return Object.fromEntries(SCOPE_KEYS.map((k) => [k, []]));
}

function scopeSize(scope) {
  return SCOPE_KEYS.reduce((n, k) => n + scope[k].length, 0);
}

/** Keep only ids that still exist in the design. Null when nothing is left. */
function existingScope(design, scope) {
  const live = {
    walls: new Set((design.walls || []).map((w) => w.id)),
    rooms: new Set((design.rooms || []).map((r) => r.id)),
    furniture: new Set((design.furniture || []).map((f) => f.id)),
    symbols: new Set((design.symbols || []).map((s) => s.id)),
    pipes: new Set((design.pipes || []).map((p) => p.id)),
    orgCharts: new Set((design.orgCharts || []).map((c) => c.id)),
    decks: new Set(decksOf(design).map((d) => d.id)),
    annotations: new Set((design.annotations || []).map((a) => a.id)),
  };
  const out = emptyScope();
  for (const k of SCOPE_KEYS) out[k] = (scope[k] || []).filter((id) => live[k].has(id));
  return scopeSize(out) > 0 ? out : null;
}

/**
 * The elements a selection covers, or null when it has no whole-selection
 * edits (openings and sheets have their own actions).
 */
export function scopeOfSelection(design, selection, multiSelection = []) {
  if (multiSelection && multiSelection.length > 0) {
    const scope = emptyScope();
    scope.furniture = multiSelection.filter((m) => m.kind === "furniture").map((m) => m.id);
    return existingScope(design, scope);
  }
  if (!selection) return null;
  if (selection.kind === "house") {
    return existingScope(design, {
      walls: (design.walls || []).map((w) => w.id),
      rooms: (design.rooms || []).map((r) => r.id),
      furniture: (design.furniture || []).map((f) => f.id),
      symbols: (design.symbols || []).map((s) => s.id),
      pipes: (design.pipes || []).map((p) => p.id),
      orgCharts: (design.orgCharts || []).map((c) => c.id),
      decks: decksOf(design).map((d) => d.id),
      annotations: (design.annotations || []).map((a) => a.id),
    });
  }
  if (selection.kind === "group") return existingScope(design, selection.scope || {});
  const scope = emptyScope();
  switch (selection.kind) {
    case "wall":
      scope.walls = [selection.id];
      break;
    case "room": {
      const room = findRoom(design, selection.id);
      if (!room) return null;
      // A room moves, flips, copies, and deletes with its own walls.
      scope.rooms = [room.id];
      scope.walls = (room.wallIds || []).filter((id) => findWall(design, id));
      break;
    }
    case "furniture":
      scope.furniture = [selection.id];
      break;
    case "symbol":
      scope.symbols = [selection.id];
      break;
    case "pipe":
      scope.pipes = [selection.id];
      break;
    case "orgchart":
      scope.orgCharts = [selection.id];
      break;
    case "deck":
      scope.decks = [selection.id];
      break;
    default:
      return null;
  }
  return existingScope(design, scope);
}

/** The live entities a scope names, as plain objects. */
function entitiesOf(design, scope) {
  const pick = (list, ids) => {
    const set = new Set(ids);
    return (list || []).filter((x) => set.has(x.id));
  };
  const walls = new Set(scope.walls);
  return {
    walls: pick(design.walls, scope.walls),
    rooms: pick(design.rooms, scope.rooms),
    openings: (design.openings || []).filter((o) => walls.has(o.wallId)),
    furniture: pick(design.furniture, scope.furniture),
    symbols: pick(design.symbols, scope.symbols),
    pipes: pick(design.pipes, scope.pipes),
    orgCharts: pick(design.orgCharts, scope.orgCharts),
    decks: pick(decksOf(design), scope.decks),
    annotations: pick(design.annotations, scope.annotations),
  };
}

/** Every plan point the scope occupies, used for the flip axis. */
function geometryPoints(e) {
  return [
    ...e.walls.flatMap((w) => [w.a, w.b]),
    ...e.rooms.flatMap((r) => r.polygon || []),
    ...e.furniture.map((f) => ({ x: f.x, y: f.y })),
    ...e.symbols.map((s) => ({ x: s.x, y: s.y })),
    ...e.pipes.flatMap((p) => p.points || []),
    ...e.orgCharts.map((c) => ({ x: c.x, y: c.y })),
    ...e.decks.flatMap((d) => [d.a, d.b]),
    ...e.annotations.flatMap((a) => a.points || []),
  ];
}

/**
 * Apply a point map to every scoped element. `angleFn` maps a rotation in
 * degrees (furniture and symbols); openings need no change because they are
 * stored as offsets along their walls.
 */
function mapScope(design, scope, pointFn, angleFn = (deg) => deg) {
  const ids = (k) => new Set(scope[k]);
  const walls = ids("walls");
  const rooms = ids("rooms");
  const furniture = ids("furniture");
  const symbols = ids("symbols");
  const pipes = ids("pipes");
  const orgCharts = ids("orgCharts");
  const decks = ids("decks");
  const annotations = ids("annotations");
  const turn = (item) => ({ ...item, ...pointFn({ x: item.x, y: item.y }), rotationDeg: angleFn(item.rotationDeg || 0) });
  return {
    ...design,
    walls: (design.walls || []).map((w) =>
      walls.has(w.id) ? { ...w, a: pointFn(w.a), b: pointFn(w.b) } : w),
    rooms: (design.rooms || []).map((r) =>
      rooms.has(r.id) ? { ...r, polygon: (r.polygon || []).map(pointFn) } : r),
    furniture: (design.furniture || []).map((f) => (furniture.has(f.id) ? turn(f) : f)),
    symbols: (design.symbols || []).map((s) => (symbols.has(s.id) ? turn(s) : s)),
    pipes: (design.pipes || []).map((p) =>
      pipes.has(p.id) ? { ...p, points: (p.points || []).map(pointFn) } : p),
    orgCharts: (design.orgCharts || []).map((c) =>
      orgCharts.has(c.id) ? { ...c, ...pointFn({ x: c.x, y: c.y }) } : c),
    decks: (design.decks || []).map((d) =>
      decks.has(d.id) ? { ...d, a: pointFn(d.a), b: pointFn(d.b) } : d),
    annotations: (design.annotations || []).map((a) =>
      annotations.has(a.id) ? { ...a, points: (a.points || []).map(pointFn) } : a),
  };
}

/** Move a scope rigidly by (dx, dy). Walls keep their length; openings ride along. */
export function translateScope(design, scope, dx, dy) {
  return mapScope(design, scope, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Mirror a scope across its own center. "horizontal" swaps left and right;
 * "vertical" swaps top and bottom. A mirror reverses rotation, so furniture
 * and symbol angles are negated. The center is the middle of the scope's
 * bounding box, so a single piece flips in place.
 */
export function flipScope(design, scope, axis) {
  if (axis !== "horizontal" && axis !== "vertical") {
    throw new Error(`Flip axis must be "horizontal" or "vertical", got ${axis}`);
  }
  const points = geometryPoints(entitiesOf(design, scope));
  if (points.length === 0) return design;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const mirror = axis === "horizontal"
    ? (p) => ({ x: 2 * cx - p.x, y: p.y })
    : (p) => ({ x: p.x, y: 2 * cy - p.y });
  const negate = (deg) => (360 - (((deg % 360) + 360) % 360)) % 360;
  return mapScope(design, scope, mirror, negate);
}

/** A deep copy of the scoped elements, to paste later. Plain data, no ids reused. */
export function copyScope(design, scope) {
  return JSON.parse(JSON.stringify(entitiesOf(design, scope)));
}

/**
 * Paste a copied bundle shifted by (dx, dy). Every element gets a fresh id;
 * copied rooms and openings point at the copied walls. A copied deck that
 * would overlap a deck already in the plan is moved sideways past it, since
 * decks may not overlap. Returns the new design and the new ids.
 */
export function pasteBundle(design, bundle, { dx, dy }) {
  const move = (p) => ({ x: p.x + dx, y: p.y + dy });
  const wallIds = new Map();
  const walls = bundle.walls.map((w) => {
    const id = newElementId("wall");
    wallIds.set(w.id, id);
    return { ...w, id, a: move(w.a), b: move(w.b) };
  });
  const rooms = bundle.rooms.map((r) => ({
    ...r,
    id: newElementId("room"),
    polygon: (r.polygon || []).map(move),
    wallIds: (r.wallIds || []).map((id) => wallIds.get(id)).filter(Boolean),
  }));
  const openings = bundle.openings
    .filter((o) => wallIds.has(o.wallId))
    .map((o) => ({ ...o, id: newElementId("opening"), wallId: wallIds.get(o.wallId) }));
  const furniture = bundle.furniture.map((f) => ({ ...f, id: newElementId("furniture"), ...move(f) }));
  const symbols = bundle.symbols.map((s) => ({ ...s, id: newElementId("symbol"), ...move(s) }));
  const pipes = bundle.pipes.map((p) => ({ ...p, id: newElementId("pipe"), points: (p.points || []).map(move) }));
  const orgCharts = bundle.orgCharts.map((c) => ({ ...c, id: newElementId("orgchart"), ...move(c) }));
  const annotations = bundle.annotations.map((a) => ({
    ...a,
    id: newElementId("annotation"),
    points: (a.points || []).map(move),
  }));

  let working = {
    ...design,
    walls: [...design.walls, ...walls],
    rooms: [...(design.rooms || []), ...rooms],
    openings: [...design.openings, ...openings],
    furniture: [...design.furniture, ...furniture],
    symbols: [...(design.symbols || []), ...symbols],
    pipes: [...(design.pipes || []), ...pipes],
    orgCharts: [...(design.orgCharts || []), ...orgCharts],
    annotations: [...(design.annotations || []), ...annotations],
  };
  const newDeckIds = [];
  for (const d of bundle.decks) {
    const width = Math.abs(d.b.x - d.a.x);
    let a = move(d.a);
    let b = move(d.b);
    // Step sideways past any overlapping deck. The loop is bounded so a
    // pathological plan cannot hang the reducer.
    for (let step = 0; step < 50 && deckOverlapsExisting(working, a, b); step += 1) {
      const shift = width + DUPLICATE_OFFSET_IN;
      a = { x: a.x + shift, y: a.y };
      b = { x: b.x + shift, y: b.y };
    }
    const id = newElementId("deck");
    newDeckIds.push(id);
    working = { ...working, decks: [...decksOf(working), { ...d, id, a, b }] };
  }

  const scope = emptyScope();
  scope.walls = walls.map((w) => w.id);
  scope.rooms = rooms.map((r) => r.id);
  scope.furniture = furniture.map((f) => f.id);
  scope.symbols = symbols.map((s) => s.id);
  scope.pipes = pipes.map((p) => p.id);
  scope.orgCharts = orgCharts.map((c) => c.id);
  scope.decks = newDeckIds;
  scope.annotations = annotations.map((a) => a.id);
  return { design: working, scope };
}

/** Remove every scoped element. Walls take their openings with them. */
export function deleteScope(design, scope) {
  let next = design;
  for (const id of scope.walls) next = deleteWall(next, id);
  if (scope.rooms.length > 0) {
    const rooms = new Set(scope.rooms);
    next = { ...next, rooms: (next.rooms || []).filter((r) => !rooms.has(r.id)) };
  }
  for (const id of scope.furniture) next = deleteFurniture(next, id);
  for (const id of scope.symbols) next = deleteSymbol(next, id);
  for (const id of scope.pipes) next = deletePipeRun(next, id);
  for (const id of scope.orgCharts) next = deleteOrgChart(next, id);
  for (const id of scope.decks) next = deleteDeck(next, id);
  if (scope.annotations.length > 0) {
    const annotations = new Set(scope.annotations);
    next = { ...next, annotations: (next.annotations || []).filter((a) => !annotations.has(a.id)) };
  }
  return next;
}
