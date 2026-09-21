// FORGE Capture editor — annotation objects (immutable, framework-neutral).
// Geometry is always in source-image pixel space.

import { normalizeRect } from "./geometry.js";

export const ANNOTATION_TYPES = Object.freeze([
  "arrow",
  "line",
  "rectangle",
  "ellipse",
  "freehand",
  "highlight",
  "text",
  "callout",
  "step-marker",
  "blur",
  "blackout",
]);

export const DEFAULT_STYLE = Object.freeze({
  stroke: "#2563eb",
  strokeWidth: 3,
  fill: "transparent",
  opacity: 1,
  fontSize: 18,
  fontFamily: "system-ui",
  blurRadius: 12,
});

export class AnnotationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnnotationError";
  }
}

const RECT_TYPES = new Set(["rectangle", "ellipse", "text", "callout", "step-marker", "blur", "blackout"]);
const POLYLINE_TYPES = new Set(["freehand", "highlight"]);
const SEGMENT_TYPES = new Set(["line", "arrow"]);

let fallbackIdCounter = 0;
function defaultIdGenerator() {
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  if (g.crypto && typeof g.crypto.randomUUID === "function") return g.crypto.randomUUID();
  fallbackIdCounter += 1;
  return `annotation-${Date.now()}-${fallbackIdCounter}`;
}

function assertNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AnnotationError(`${name} must be a finite number`);
  }
}

// The engine's defined style contract: only the fields the renderer consumes.
// Validates types and renderer-safe ranges; unknown keys are ignored (not
// copied) so forward-compatible input cannot smuggle renderer state.
const STYLE_STRING_KEYS = ["stroke", "fill", "fontFamily"];
const STYLE_POSITIVE_KEYS = ["strokeWidth", "fontSize", "blurRadius"];

export function normalizeStyle(style) {
  if (!style || typeof style !== "object" || Array.isArray(style)) {
    throw new AnnotationError("style must be an object");
  }
  const out = {};
  for (const key of STYLE_STRING_KEYS) {
    if (style[key] === undefined) continue;
    if (typeof style[key] !== "string" || style[key].length === 0) {
      throw new AnnotationError(`style.${key} must be a non-empty string`);
    }
    out[key] = style[key];
  }
  for (const key of STYLE_POSITIVE_KEYS) {
    if (style[key] === undefined) continue;
    if (typeof style[key] !== "number" || !Number.isFinite(style[key]) || style[key] <= 0) {
      throw new AnnotationError(`style.${key} must be a positive finite number`);
    }
    out[key] = style[key];
  }
  if (style.opacity !== undefined) {
    if (typeof style.opacity !== "number" || !Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1) {
      throw new AnnotationError("style.opacity must be a finite number in [0, 1]");
    }
    out.opacity = style.opacity;
  }
  return out;
}

function validateRectGeometry(geometry, type) {
  if (!geometry || typeof geometry !== "object") throw new AnnotationError(`${type}: geometry must be an object`);
  for (const key of ["x", "y", "w", "h"]) assertNumber(geometry[key], `${type}.geometry.${key}`);
  const r = normalizeRect(geometry);
  if (r.w < 1 || r.h < 1) throw new AnnotationError(`${type}: geometry must have positive width and height`);
  return r;
}

function validatePointsGeometry(geometry, type, minPoints, exactPoints = 0) {
  if (!geometry || !Array.isArray(geometry.points)) {
    throw new AnnotationError(`${type}: geometry.points must be an array`);
  }
  if (exactPoints > 0) {
    // Segments are exactly two endpoints: the renderer and hit-testing both
    // operate on points[0] -> points[1], so extra points would create visible
    // geometry that can never be selected.
    if (geometry.points.length !== exactPoints) {
      throw new AnnotationError(`${type}: geometry.points must contain exactly ${exactPoints} points`);
    }
  } else if (geometry.points.length < minPoints) {
    throw new AnnotationError(`${type}: geometry.points needs at least ${minPoints} points`);
  }
  for (const entry of geometry.points) {
    // Validate the tuple shape before destructuring: malformed project data
    // must surface as AnnotationError, never a raw TypeError.
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new AnnotationError(`${type}: geometry.points entries must be [x, y] pairs`);
    }
    assertNumber(entry[0], `${type}.geometry.points.x`);
    assertNumber(entry[1], `${type}.geometry.points.y`);
  }
  return { points: geometry.points.map(([x, y]) => [x, y]) };
}

export function validateGeometry(type, geometry) {
  if (!ANNOTATION_TYPES.includes(type)) throw new AnnotationError(`unknown annotation type: ${type}`);
  if (RECT_TYPES.has(type)) return validateRectGeometry(geometry, type);
  if (SEGMENT_TYPES.has(type)) return validatePointsGeometry(geometry, type, 2, 2);
  if (POLYLINE_TYPES.has(type)) return validatePointsGeometry(geometry, type, 2);
  throw new AnnotationError(`unknown annotation type: ${type}`);
}

// Validates a deserialized annotation shape (used by the schema reader).
// Returns a clean shape with normalized style; malformed values are rejected,
// never silently repaired.
export function validateAnnotationShape(raw) {
  if (!raw || typeof raw !== "object") throw new AnnotationError("annotation must be an object");
  if (!ANNOTATION_TYPES.includes(raw.type)) throw new AnnotationError(`unknown annotation type: ${raw.type}`);
  const geometry = validateGeometry(raw.type, raw.geometry);
  if (typeof raw.id !== "string" || raw.id.length === 0) throw new AnnotationError("annotation id must be a non-empty string");
  if (!Number.isInteger(raw.z) || raw.z < 0) throw new AnnotationError("annotation z must be a non-negative integer");
  const shape = {
    type: raw.type,
    id: raw.id,
    z: raw.z,
    geometry,
    style: normalizeStyle(raw.style ?? {}),
    locked: Boolean(raw.locked),
  };
  if (raw.type === "text" || raw.type === "callout" || raw.type === "step-marker") {
    if (raw.text !== undefined && typeof raw.text !== "string") {
      throw new AnnotationError("annotation text must be a string");
    }
    shape.text = typeof raw.text === "string" ? raw.text : "";
  }
  if (raw.type === "callout") {
    if (raw.anchor !== undefined && raw.anchor !== null) {
      if (!raw.anchor || typeof raw.anchor !== "object") throw new AnnotationError("callout anchor must be an object");
      assertNumber(raw.anchor.x, "callout.anchor.x");
      assertNumber(raw.anchor.y, "callout.anchor.y");
      shape.anchor = { x: raw.anchor.x, y: raw.anchor.y };
    } else {
      shape.anchor = null;
    }
  }
  if (raw.type === "step-marker") {
    shape.stepNumber = Number.isInteger(raw.stepNumber) && raw.stepNumber > 0 ? raw.stepNumber : null;
  }
  return shape;
}

function freezeGeometry(geometry) {
  if (geometry.points) {
    return Object.freeze({
      ...geometry,
      points: Object.freeze(geometry.points.map((p) => Object.freeze([p[0], p[1]]))),
    });
  }
  return Object.freeze({ ...geometry });
}

export function createAnnotation(type, geometry, options = {}) {
  const validGeometry = validateGeometry(type, geometry);
  const id = options.id ?? (options.idGenerator ?? defaultIdGenerator)();
  if (typeof id !== "string" || id.length === 0) throw new AnnotationError("annotation id must be a non-empty string");
  // z is a non-negative integer everywhere: maxZ/sorting/reorder/step
  // numbering and deterministic serialization all assume a total ordering.
  const z = options.z ?? 0;
  if (!Number.isInteger(z) || z < 0) {
    throw new AnnotationError("annotation z must be a non-negative integer");
  }

  const annotation = {
    id,
    type,
    z,
    geometry: validGeometry,
    style: { ...DEFAULT_STYLE, ...normalizeStyle(options.style ?? {}) },
    locked: Boolean(options.locked),
  };
  if (type === "text" || type === "callout" || type === "step-marker") {
    annotation.text = typeof options.text === "string" ? options.text : "";
  }
  if (type === "callout") {
    const anchor = options.anchor ?? null;
    if (anchor !== null) {
      assertNumber(anchor.x, "callout.anchor.x");
      assertNumber(anchor.y, "callout.anchor.y");
      annotation.anchor = Object.freeze({ x: anchor.x, y: anchor.y });
    } else {
      annotation.anchor = null;
    }
  }
  if (type === "step-marker") {
    annotation.stepNumber = Number.isInteger(options.stepNumber) && options.stepNumber > 0 ? options.stepNumber : null;
  }
  // Redaction intent is a permanent property of blur/blackout annotations.
  if (type === "blur" || type === "blackout") annotation.redaction = true;

  annotation.geometry = freezeGeometry(annotation.geometry);
  annotation.style = Object.freeze(annotation.style);
  return Object.freeze(annotation);
}

// --- immutable updaters ---

export function withGeometry(annotation, geometry) {
  const valid = validateGeometry(annotation.type, geometry);
  return Object.freeze({ ...annotation, geometry: freezeGeometry(valid) });
}

export function withStyle(annotation, stylePatch) {
  if (!stylePatch || typeof stylePatch !== "object" || Array.isArray(stylePatch)) {
    throw new AnnotationError("style patch must be an object");
  }
  return Object.freeze({ ...annotation, style: Object.freeze({ ...annotation.style, ...normalizeStyle(stylePatch) }) });
}

export function withText(annotation, text) {
  if (annotation.type !== "text" && annotation.type !== "callout" && annotation.type !== "step-marker") {
    throw new AnnotationError(`${annotation.type} does not carry text`);
  }
  return Object.freeze({ ...annotation, text: String(text) });
}

export function withLock(annotation, locked) {
  return Object.freeze({ ...annotation, locked: Boolean(locked) });
}

export function withAnchor(annotation, anchor) {
  if (annotation.type !== "callout") throw new AnnotationError("only callout carries an anchor");
  assertNumber(anchor.x, "callout.anchor.x");
  assertNumber(anchor.y, "callout.anchor.y");
  return Object.freeze({ ...annotation, anchor: Object.freeze({ x: anchor.x, y: anchor.y }) });
}

// Renumbers step markers 1..n in z-order. Returns a new annotation array.
export function renumberSteps(annotations) {
  const ordered = [...annotations].sort((a, b) => a.z - b.z);
  let n = 0;
  const numbers = new Map();
  for (const a of ordered) {
    if (a.type === "step-marker") {
      n += 1;
      numbers.set(a.id, n);
    }
  }
  return annotations.map((a) =>
    a.type === "step-marker" ? Object.freeze({ ...a, stepNumber: numbers.get(a.id) }) : a,
  );
}

export function isRedaction(annotation) {
  return (annotation.type === "blur" || annotation.type === "blackout") && annotation.redaction === true;
}
