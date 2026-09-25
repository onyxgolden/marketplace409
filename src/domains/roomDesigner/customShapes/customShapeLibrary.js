/**
 * The personal custom-shape library: a plain, JSON-serializable document.
 *
 *   {
 *     version: 1,
 *     favoriteOrder: [shapeId, ...],   // the user's order for starred shapes
 *     starterSeeded: true | undefined, // starter favorites offered once
 *     shapes: [{
 *       id, name, createdAt, updatedAt, favorite,
 *       bounds: { widthIn, heightIn },
 *       counts: { walls, rooms, ... , total },
 *       entities: { walls, rooms, openings, furniture, pipes, symbols },
 *     }],
 *   }
 *
 * Every operation is pure: it takes a library and returns a new one, exactly
 * like the room-designer document model it sits beside. Persistence is
 * somebody else's job (customShapeStorage), and so is rendering.
 *
 * Favorites live on the shape record rather than in a separate list. The tool
 * palette already keeps favorite TOOL ids in its own localStorage key, but a
 * shape's starred state has to survive being re-read from the library on
 * another page load and has to travel with the shape if the library is ever
 * exported — so it belongs to the shape, and the palette's star is wired to
 * it rather than duplicating it.
 *
 * `favorite` says WHETHER a shape is starred; `favoriteOrder` says WHERE it
 * sits in the Favorites section. The order is always reconciled against the
 * flags (orderedFavoriteIds), so a hand-edited or older library with no
 * order — or an order naming deleted shapes — still displays sensibly.
 */

import { CustomShapeError, MAX_LIBRARY_SIZE, cleanShapeName } from "./customShapeErrors";

export const LIBRARY_VERSION = 1;

export function createEmptyLibrary() {
  return { version: LIBRARY_VERSION, shapes: [], favoriteOrder: [] };
}

/**
 * Starred shape ids in display order: the stored order first (skipping ids
 * that are gone or no longer starred), then any starred shape the order
 * doesn't mention yet, in library order.
 */
export function orderedFavoriteIds(library) {
  const starred = (library?.shapes || []).filter((s) => s.favorite).map((s) => s.id);
  const starredSet = new Set(starred);
  const seen = new Set();
  const ordered = [];
  for (const id of library?.favoriteOrder || []) {
    if (starredSet.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  for (const id of starred) if (!seen.has(id)) ordered.push(id);
  return ordered;
}

/** Deterministic-ish id; the timestamp keeps ordering readable in storage. */
function nextShapeId(existingIds) {
  const base = `shape-${Date.now().toString(36)}`;
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function assertLibrary(library) {
  if (!library || library.version !== LIBRARY_VERSION || !Array.isArray(library.shapes)) {
    throw new CustomShapeError("Not a custom-shape library (bad version or shape).", {
      code: "bad-library",
    });
  }
}

export function findShape(library, shapeId) {
  return (library?.shapes || []).find((s) => s.id === shapeId) || null;
}

/**
 * Add a captured selection to the library under `name`.
 * `capture` is captureSelection()'s result.
 */
export function addShape(library, capture, name, { now = Date.now() } = {}) {
  assertLibrary(library);
  const clean = cleanShapeName(name);
  if (!clean) {
    throw new CustomShapeError("Give the shape a name before saving it.", { code: "name-required" });
  }
  if (!capture || !capture.entities) {
    throw new CustomShapeError("There is nothing captured to save.", { code: "empty-selection" });
  }
  if (library.shapes.length >= MAX_LIBRARY_SIZE) {
    throw new CustomShapeError(
      `Your shape library is full (${MAX_LIBRARY_SIZE} shapes). Delete one before saving another.`,
      { code: "library-full" },
    );
  }
  if (library.shapes.some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
    throw new CustomShapeError(`You already have a shape called "${clean}".`, {
      code: "duplicate-name",
    });
  }
  const shape = {
    id: nextShapeId(new Set(library.shapes.map((s) => s.id))),
    name: clean,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    bounds: { ...capture.bounds },
    counts: { ...capture.counts },
    entities: JSON.parse(JSON.stringify(capture.entities)),
  };
  return { ...library, shapes: [...library.shapes, shape] };
}

/** Rename a shape. Unknown id returns the library unchanged. */
export function renameShape(library, shapeId, name, { now = Date.now() } = {}) {
  assertLibrary(library);
  if (!findShape(library, shapeId)) return library;
  const clean = cleanShapeName(name);
  if (!clean) {
    throw new CustomShapeError("A shape needs a name.", { code: "name-required" });
  }
  if (library.shapes.some((s) => s.id !== shapeId && s.name.toLowerCase() === clean.toLowerCase())) {
    throw new CustomShapeError(`You already have a shape called "${clean}".`, {
      code: "duplicate-name",
    });
  }
  return {
    ...library,
    shapes: library.shapes.map((s) => (s.id === shapeId ? { ...s, name: clean, updatedAt: now } : s)),
  };
}

/** Remove a shape. Unknown id returns the library unchanged. */
export function removeShape(library, shapeId) {
  assertLibrary(library);
  if (!findShape(library, shapeId)) return library;
  return {
    ...library,
    shapes: library.shapes.filter((s) => s.id !== shapeId),
    favoriteOrder: orderedFavoriteIds(library).filter((id) => id !== shapeId),
  };
}

/** Star / unstar a shape. Unknown id returns the library unchanged. */
export function setShapeFavorite(library, shapeId, favorite, { now = Date.now() } = {}) {
  assertLibrary(library);
  const shape = findShape(library, shapeId);
  if (!shape) return library;
  const next = Boolean(favorite);
  if (shape.favorite === next) return library;
  // A newly starred shape joins the END of the Favorites section; an
  // unstarred one leaves it. Everyone else keeps their place.
  const order = orderedFavoriteIds(library).filter((id) => id !== shapeId);
  return {
    ...library,
    shapes: library.shapes.map((s) =>
      s.id === shapeId ? { ...s, favorite: next, updatedAt: now } : s,
    ),
    favoriteOrder: next ? [...order, shapeId] : order,
  };
}

/** Flip a shape's starred state. */
export function toggleShapeFavorite(library, shapeId, options = {}) {
  const shape = findShape(library, shapeId);
  if (!shape) return library;
  return setShapeFavorite(library, shapeId, !shape.favorite, options);
}

/** Every favorited shape, in the user's Favorites order. */
export function favoriteShapes(library) {
  const byId = new Map((library?.shapes || []).map((s) => [s.id, s]));
  return orderedFavoriteIds(library).map((id) => byId.get(id));
}

/**
 * Move a starred shape `delta` places within Favorites (-1 = up, +1 = down),
 * clamped at either end. Unknown or unstarred ids return the library unchanged.
 */
export function moveFavorite(library, shapeId, delta) {
  assertLibrary(library);
  const order = orderedFavoriteIds(library);
  const from = order.indexOf(shapeId);
  if (from === -1 || !Number.isInteger(delta) || delta === 0) return library;
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  if (to === from) return library;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, shapeId);
  return { ...library, favoriteOrder: next };
}

/**
 * Shapes for display: favorites first in the user's Favorites order, then
 * the rest sorted by name (case-insensitive) so the palette does not
 * reshuffle as shapes are edited.
 */
export function listShapesForDisplay(library) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const shapes = [...(library?.shapes || [])];
  return [...favoriteShapes(library), ...shapes.filter((s) => !s.favorite).sort(byName)];
}
