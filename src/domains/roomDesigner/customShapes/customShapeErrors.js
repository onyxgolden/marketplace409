/**
 * Error type for the custom-shape library.
 *
 * Mirrors the VSDX importer's error contract (vsdxErrors.js): failures carry
 * a stable machine-readable `code` for tests and UI branching, plus a
 * human-readable message that names what could not be done.
 */
export class CustomShapeError extends Error {
  constructor(message, { code = "custom-shape-error" } = {}) {
    super(message);
    this.name = "CustomShapeError";
    this.code = code;
  }
}

/** Longest accepted shape name. */
export const MAX_SHAPE_NAME_LENGTH = 60;

/** Most shapes one library holds before refusing more. */
export const MAX_LIBRARY_SIZE = 200;

/** Most entities one saved shape may contain. */
export const MAX_SHAPE_ENTITIES = 2000;

/**
 * Clean a user-supplied shape name. Returns "" for anything unusable, which
 * callers treat as "no name given" — naming is required, so this never
 * invents a name.
 */
export function cleanShapeName(name) {
  if (typeof name !== "string") return "";
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_SHAPE_NAME_LENGTH);
}
