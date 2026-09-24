/**
 * Local persistence for the custom-shape library.
 *
 * Follows the Designer's established local-persistence pattern (see
 * ToolPalette's collapsed-category and favorite-tool keys): a versioned
 * localStorage key, a lazy defensive read where ANY corrupt or unexpected
 * value degrades to a sane empty default rather than throwing, and a write
 * that swallows quota/private-mode failures so the feature keeps working
 * in-memory.
 *
 * The key is versioned (`.v1`). A future schema change bumps the version
 * rather than migrating in place, so an old library can never be
 * half-interpreted by new code.
 */

import { createEmptyLibrary, LIBRARY_VERSION } from "./customShapeLibrary";

export const SHAPE_LIBRARY_STORAGE_KEY = "forge-designer.custom-shapes.v1";

const ENTITY_KEYS = ["walls", "rooms", "openings", "furniture", "pipes", "symbols"];

/** Is this a shape record we are willing to load? */
function isUsableShape(shape) {
  if (!shape || typeof shape !== "object") return false;
  if (typeof shape.id !== "string" || !shape.id) return false;
  if (typeof shape.name !== "string" || !shape.name.trim()) return false;
  if (!shape.entities || typeof shape.entities !== "object") return false;
  // Every entity bucket must be an array (missing ones are filled in below).
  return ENTITY_KEYS.every((key) => shape.entities[key] === undefined || Array.isArray(shape.entities[key]));
}

/** Fill in anything an older or hand-edited record left out. */
function normalizeShape(shape) {
  const entities = {};
  for (const key of ENTITY_KEYS) {
    entities[key] = Array.isArray(shape.entities[key]) ? shape.entities[key] : [];
  }
  const total = ENTITY_KEYS.reduce((n, key) => n + entities[key].length, 0);
  return {
    id: shape.id,
    name: shape.name.trim(),
    createdAt: Number.isFinite(shape.createdAt) ? shape.createdAt : 0,
    updatedAt: Number.isFinite(shape.updatedAt) ? shape.updatedAt : 0,
    favorite: shape.favorite === true,
    bounds: {
      widthIn: Number.isFinite(shape.bounds?.widthIn) ? shape.bounds.widthIn : 0,
      heightIn: Number.isFinite(shape.bounds?.heightIn) ? shape.bounds.heightIn : 0,
    },
    counts: { ...(shape.counts || {}), total },
    entities,
  };
}

/**
 * Parse a stored payload into a library. Never throws: anything unusable
 * yields an empty library, and individual bad shapes are dropped rather than
 * poisoning the whole list.
 */
export function parseLibrary(raw) {
  if (typeof raw !== "string" || raw === "") return createEmptyLibrary();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyLibrary();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createEmptyLibrary();
  if (parsed.version !== LIBRARY_VERSION || !Array.isArray(parsed.shapes)) return createEmptyLibrary();

  const seen = new Set();
  const shapes = [];
  for (const shape of parsed.shapes) {
    if (!isUsableShape(shape)) continue;
    if (seen.has(shape.id)) continue;
    seen.add(shape.id);
    shapes.push(normalizeShape(shape));
  }
  return { version: LIBRARY_VERSION, shapes };
}

/** Read the library from localStorage; any failure yields an empty library. */
export function loadLibrary(storage = defaultStorage()) {
  if (!storage) return createEmptyLibrary();
  try {
    return parseLibrary(storage.getItem(SHAPE_LIBRARY_STORAGE_KEY));
  } catch {
    return createEmptyLibrary();
  }
}

/**
 * Write the library to localStorage.
 * Returns true on success, false when storage refused (private mode, quota) —
 * the caller keeps working in memory either way, but can say so.
 */
export function saveLibrary(library, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(SHAPE_LIBRARY_STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

function defaultStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Accessing localStorage itself can throw when site data is blocked.
    return null;
  }
}
