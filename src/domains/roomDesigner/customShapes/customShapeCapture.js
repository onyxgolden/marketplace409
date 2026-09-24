/**
 * Capture: a Designer selection → a reusable, position-independent shape.
 *
 * "Save this as a shape" has to answer a question the selection alone does
 * not: what *belongs* with the thing the user picked? A room is not useful
 * without its walls, and a wall is not useful without the door cut into it.
 * So capture follows the document's own ownership edges:
 *
 *   room      → the room, its four walls, the openings cut into those walls,
 *               and any furniture standing inside its polygon
 *   wall      → the wall and its openings
 *   furniture → the piece (or every multi-selected piece)
 *   symbol    → the symbol
 *   pipe      → the pipe run
 *   opening   → refused: an opening is a hole in a wall, not a thing that can
 *               stand on its own
 *
 * Everything is then normalized so the captured geometry's bounding box sits
 * at the origin. A shape has no position — position is supplied at insert.
 *
 * Pure: nothing here mutates the design, and the result is plain JSON so it
 * can be persisted as-is.
 */

import { pointInPolygon } from "../designerGeometry";
import { CustomShapeError, MAX_SHAPE_ENTITIES } from "./customShapeErrors";

const EMPTY = Object.freeze({
  walls: [], rooms: [], openings: [], furniture: [], pipes: [], symbols: [],
});

function cloneEntities(entities) {
  return JSON.parse(JSON.stringify(entities));
}

/** Every point that defines where the captured geometry sits. */
function geometryPoints(entities) {
  const points = [];
  for (const wall of entities.walls) points.push(wall.a, wall.b);
  for (const room of entities.rooms) points.push(...(room.polygon || []));
  for (const piece of entities.furniture) points.push({ x: piece.x, y: piece.y });
  for (const symbol of entities.symbols) points.push({ x: symbol.x, y: symbol.y });
  for (const run of entities.pipes) points.push(...(run.points || []));
  return points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Bounding box of a captured entity set, or null when there is no geometry. */
export function captureBounds(entities) {
  const points = geometryPoints(entities);
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, widthIn: maxX - minX, heightIn: maxY - minY };
}

/** Shift every coordinate so the set's bounding box starts at (0, 0). Pure. */
export function normalizeToOrigin(entities) {
  const bounds = captureBounds(entities);
  if (!bounds) return { entities: cloneEntities(entities), bounds: null };
  const dx = -bounds.minX;
  const dy = -bounds.minY;
  const move = (p) => ({ x: round6(p.x + dx), y: round6(p.y + dy) });
  const next = cloneEntities(entities);
  next.walls = next.walls.map((w) => ({ ...w, a: move(w.a), b: move(w.b) }));
  next.rooms = next.rooms.map((r) => ({ ...r, polygon: (r.polygon || []).map(move) }));
  next.furniture = next.furniture.map((f) => ({ ...f, ...move({ x: f.x, y: f.y }) }));
  next.symbols = next.symbols.map((s) => ({ ...s, ...move({ x: s.x, y: s.y }) }));
  next.pipes = next.pipes.map((p) => ({ ...p, points: (p.points || []).map(move) }));
  return {
    entities: next,
    bounds: {
      widthIn: round6(bounds.widthIn),
      heightIn: round6(bounds.heightIn),
    },
  };
}

/**
 * Collect the entities a selection owns.
 *
 * `selection` is the reducer's { kind, id } and `multiSelection` its
 * furniture list. Returns a plain entity set; throws CustomShapeError when
 * the selection cannot become a shape.
 */
export function collectSelectedEntities(design, selection, multiSelection = []) {
  if (!design) throw new CustomShapeError("There is no design to capture from.", { code: "no-design" });

  const multi = (multiSelection || []).filter((m) => m && m.kind === "furniture");
  if (multi.length > 0) {
    const ids = new Set(multi.map((m) => m.id));
    const furniture = (design.furniture || []).filter((f) => ids.has(f.id));
    if (furniture.length === 0) {
      throw new CustomShapeError("The selected pieces are no longer in the design.", { code: "empty-selection" });
    }
    return { ...EMPTY, furniture };
  }

  if (!selection || !selection.kind) {
    throw new CustomShapeError("Select something on the plan first.", { code: "no-selection" });
  }

  if (selection.kind === "opening") {
    throw new CustomShapeError(
      "A door or window is a hole in a wall, not a shape on its own — select the wall instead.",
      { code: "opening-not-saveable" },
    );
  }

  if (selection.kind === "room") {
    const room = (design.rooms || []).find((r) => r.id === selection.id);
    if (!room) throw new CustomShapeError("That room is no longer in the design.", { code: "missing-entity" });
    const wallIds = new Set(room.wallIds || []);
    const walls = (design.walls || []).filter((w) => wallIds.has(w.id));
    const openings = (design.openings || []).filter((o) => wallIds.has(o.wallId));
    // Furniture standing inside the room travels with it — saving a laid-out
    // bedroom and getting back an empty rectangle would be a surprise.
    const furniture = (design.furniture || []).filter((f) =>
      pointInPolygon({ x: f.x, y: f.y }, room.polygon || []),
    );
    return { ...EMPTY, rooms: [room], walls, openings, furniture };
  }

  if (selection.kind === "wall") {
    const wall = (design.walls || []).find((w) => w.id === selection.id);
    if (!wall) throw new CustomShapeError("That wall is no longer in the design.", { code: "missing-entity" });
    const openings = (design.openings || []).filter((o) => o.wallId === wall.id);
    return { ...EMPTY, walls: [wall], openings };
  }

  if (selection.kind === "furniture") {
    const piece = (design.furniture || []).find((f) => f.id === selection.id);
    if (!piece) throw new CustomShapeError("That piece is no longer in the design.", { code: "missing-entity" });
    return { ...EMPTY, furniture: [piece] };
  }

  if (selection.kind === "symbol") {
    const symbol = (design.symbols || []).find((s) => s.id === selection.id);
    if (!symbol) throw new CustomShapeError("That symbol is no longer in the design.", { code: "missing-entity" });
    return { ...EMPTY, symbols: [symbol] };
  }

  if (selection.kind === "pipe") {
    const run = (design.pipes || []).find((p) => p.id === selection.id);
    if (!run) throw new CustomShapeError("That pipe run is no longer in the design.", { code: "missing-entity" });
    return { ...EMPTY, pipes: [run] };
  }

  throw new CustomShapeError(`A ${selection.kind} cannot be saved as a shape.`, {
    code: "kind-not-saveable",
  });
}

/** Total entities in a captured set. */
export function countEntities(entities) {
  return ["walls", "rooms", "openings", "furniture", "pipes", "symbols"]
    .reduce((n, key) => n + (entities[key] || []).length, 0);
}

/**
 * Capture a selection as a position-independent entity set.
 * Returns { entities, bounds, counts }.
 */
export function captureSelection(design, selection, multiSelection = []) {
  const collected = collectSelectedEntities(design, selection, multiSelection);
  const total = countEntities(collected);
  if (total === 0) {
    throw new CustomShapeError("There is nothing in that selection to save.", { code: "empty-selection" });
  }
  if (total > MAX_SHAPE_ENTITIES) {
    throw new CustomShapeError(
      `That selection has ${total} pieces — more than the ${MAX_SHAPE_ENTITIES} a single shape can hold.`,
      { code: "too-large" },
    );
  }
  const { entities, bounds } = normalizeToOrigin(collected);
  return {
    entities,
    bounds: bounds || { widthIn: 0, heightIn: 0 },
    counts: {
      walls: entities.walls.length,
      rooms: entities.rooms.length,
      openings: entities.openings.length,
      furniture: entities.furniture.length,
      pipes: entities.pipes.length,
      symbols: entities.symbols.length,
      total,
    },
  };
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
