// FORGE Capture editor — immutable capture document.
// A document is: source image descriptor + z-ordered annotations.
// The document never holds a bitmap; the host keeps the decoded bitmap for
// rendering and export, and the serialized project holds the re-encoded bytes.

import {
  createAnnotation,
  renumberSteps,
  validateAnnotationShape,
  withGeometry,
  withLock,
} from "./annotations.js";
import { moveGeometry } from "./geometry.js";
import {
  MAX_SOURCE_DIMENSION,
  MAX_DECODED_BYTES,
  assertDecodedSize,
  assertSourceDimensions,
  assertSourceMime,
} from "./limits.js";

export class DocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "DocumentError";
  }
}

function freezeDocument(doc) {
  return Object.freeze({
    ...doc,
    canvas: Object.freeze({ ...doc.canvas }),
    source: Object.freeze({ ...doc.source }),
    annotations: Object.freeze([...doc.annotations]),
  });
}

// The engine never trusts the host to have validated the source: document
// construction enforces the same dimension/memory/MIME invariants as import,
// plus the required fields for the selected source kind.
function validateSourceDescriptor(source) {
  if (!source || typeof source !== "object") throw new DocumentError("document source must be an object");
  if (source.kind === "embedded") {
    assertSourceMime(source.mime);
    if (typeof source.bytes !== "string" || source.bytes.length === 0) {
      throw new DocumentError("embedded source.bytes must be a non-empty string");
    }
  } else if (source.kind === "local-ref") {
    assertSourceMime(source.mime);
    if (typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(source.sha256)) {
      throw new DocumentError("local-ref source.sha256 must be a 64-char hex digest");
    }
  } else {
    throw new DocumentError('document source.kind must be "embedded" or "local-ref"');
  }
}

export function createDocument({ id, width, height, source, createdAt } = {}) {
  if (typeof id !== "string" || id.length === 0) throw new DocumentError("document id must be a non-empty string");
  assertSourceDimensions(width, height);
  assertDecodedSize(width, height);
  validateSourceDescriptor(source);
  const now = createdAt ?? new Date().toISOString();
  return freezeDocument({
    id,
    canvas: { width, height },
    source,
    annotations: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function getAnnotation(doc, id) {
  return doc.annotations.find((a) => a.id === id) ?? null;
}

function maxZ(doc) {
  let z = -1;
  for (const a of doc.annotations) if (a.z > z) z = a.z;
  return z;
}

function touch(doc, annotations) {
  return freezeDocument({ ...doc, annotations, updatedAt: new Date().toISOString() });
}

export function addAnnotation(doc, annotation) {
  if (!annotation || typeof annotation.id !== "string") throw new DocumentError("addAnnotation requires an annotation");
  if (getAnnotation(doc, annotation.id)) throw new DocumentError(`annotation id already exists: ${annotation.id}`);
  // Re-stamp z so the new annotation lands on top; honor a caller-provided z only
  // when it is a valid non-negative integer that does not collide.
  const zValid = Number.isInteger(annotation.z) && annotation.z >= 0;
  const stamped =
    zValid && annotation.z > maxZ(doc)
      ? annotation
      : createAnnotation(annotation.type, annotation.geometry, {
          id: annotation.id,
          z: maxZ(doc) + 1,
          style: annotation.style,
          text: annotation.text,
          anchor: annotation.anchor,
          locked: annotation.locked,
        });
  return touch(doc, renumberSteps([...doc.annotations, stamped]));
}

// updater: (annotation) => annotation. Locked targets are refused by returning
// the identical document reference — callers can prove refusal with `toBe`.
export function updateAnnotation(doc, id, updater) {
  const target = getAnnotation(doc, id);
  if (!target) throw new DocumentError(`annotation not found: ${id}`);
  if (target.locked) return doc;
  const next = updater(target);
  if (!next || next.id !== id) throw new DocumentError("updater must return the same annotation id");
  return touch(
    doc,
    renumberSteps(doc.annotations.map((a) => (a.id === id ? next : a))),
  );
}

export function removeAnnotation(doc, id) {
  const target = getAnnotation(doc, id);
  if (!target) throw new DocumentError(`annotation not found: ${id}`);
  if (target.locked) return doc;
  return touch(
    doc,
    renumberSteps(doc.annotations.filter((a) => a.id !== id)),
  );
}

// Locking is the one mutation allowed on a locked annotation.
export function setAnnotationLock(doc, id, locked) {
  const target = getAnnotation(doc, id);
  if (!target) throw new DocumentError(`annotation not found: ${id}`);
  if (target.locked === Boolean(locked)) return doc;
  return touch(
    doc,
    doc.annotations.map((a) => (a.id === id ? withLock(a, locked) : a)),
  );
}

export function moveAnnotation(doc, id, dx, dy) {
  return updateAnnotation(doc, id, (a) => withGeometry(a, moveGeometry(a.geometry, dx, dy)));
}

// direction: "front" | "back" | "forward" | "backward"
export function reorderZ(doc, id, direction) {
  const target = getAnnotation(doc, id);
  if (!target) throw new DocumentError(`annotation not found: ${id}`);
  if (target.locked) return doc;
  const ordered = [...doc.annotations].sort((a, b) => a.z - b.z);
  const idx = ordered.findIndex((a) => a.id === id);
  const move = (arr, from, to) => {
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  let next;
  switch (direction) {
    case "front":
      next = move(ordered, idx, ordered.length - 1);
      break;
    case "back":
      next = move(ordered, idx, 0);
      break;
    case "forward":
      next = move(ordered, idx, Math.min(ordered.length - 1, idx + 1));
      break;
    case "backward":
      next = move(ordered, idx, Math.max(0, idx - 1));
      break;
    default:
      throw new DocumentError(`unknown z direction: ${direction}`);
  }
  const reZ = next.map((a, i) => (a.z === i ? a : Object.freeze({ ...a, z: i })));
  return touch(doc, renumberSteps(reZ));
}

export function annotationCount(doc) {
  return doc.annotations.length;
}

// Rebuilds a document from fully validated parts (used by the schema reader).
// Every annotation is re-validated; the caller must have validated the envelope.
export function hydrateDocument({ id, width, height, source, annotations, createdAt, updatedAt }) {
  const validated = (annotations ?? []).map((raw) => {
    const shape = validateAnnotationShape(raw);
    return createAnnotation(shape.type, shape.geometry, {
      id: shape.id,
      z: shape.z,
      style: shape.style,
      text: shape.text,
      anchor: shape.anchor,
      stepNumber: shape.stepNumber,
      locked: shape.locked,
    });
  });
  const doc = createDocument({ id, width, height, source, createdAt });
  return freezeDocument({ ...doc, annotations: Object.freeze(renumberSteps(validated)), updatedAt: updatedAt ?? doc.updatedAt });
}

export const DOCUMENT_LIMITS = Object.freeze({
  maxDimension: MAX_SOURCE_DIMENSION,
  maxBytes: MAX_DECODED_BYTES,
});
