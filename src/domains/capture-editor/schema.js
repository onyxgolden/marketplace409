// FORGE Capture editor — versioned project envelope.
// Provisional through Rung 1 (see RUNG1_IMPLEMENTATION_MAP.md): implemented
// sufficiently to exercise the editor and the serialization invariants, not a
// frozen public compatibility contract.

import { ANNOTATION_TYPES, AnnotationError } from "./annotations.js";
import { DOCUMENT_LIMITS, DocumentError, hydrateDocument } from "./document.js";
import {
  CAPTURE_SCHEMA_VERSION,
  SUPPORTED_SOURCE_MIME_TYPES,
  SourceRejectedError,
  assertDecodedSize,
  assertSourceDimensions,
} from "./limits.js";

export const CURRENT_SCHEMA_VERSION = CAPTURE_SCHEMA_VERSION;
export const PROJECT_KIND = "forge-capture-project";

export class ProjectError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectError";
  }
}

export class UnsupportedVersionError extends ProjectError {
  constructor(version) {
    super(`Unsupported capture project version: ${version} (this editor reads up to ${CURRENT_SCHEMA_VERSION})`);
    this.name = "UnsupportedVersionError";
    this.version = version;
  }
}

export class CorruptProjectError extends ProjectError {
  constructor(reason) {
    super(`Corrupt capture project: ${reason}`);
    this.name = "CorruptProjectError";
    this.reason = reason;
  }
}

// Deterministic serialization: recursive key sort, so the same document always
// produces the same bytes. Arrays keep their order (z-order is significant).
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = canonicalize(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

function annotationToJSON(a) {
  const out = {
    id: a.id,
    type: a.type,
    z: a.z,
    geometry: a.geometry,
    style: a.style,
    locked: a.locked,
  };
  if (a.text !== undefined) out.text = a.text;
  if (a.anchor !== undefined) out.anchor = a.anchor;
  if (a.stepNumber !== undefined) out.stepNumber = a.stepNumber;
  if (a.redaction !== undefined) out.redaction = a.redaction;
  return out;
}

export function serializeProject(doc) {
  if (!doc || typeof doc !== "object" || !doc.id) throw new ProjectError("serializeProject requires a document");
  const envelope = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: PROJECT_KIND,
    id: doc.id,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    canvas: { width: doc.canvas.width, height: doc.canvas.height },
    source: doc.source,
    annotations: [...doc.annotations]
      .sort((a, b) => a.z - b.z)
      .map(annotationToJSON),
    limits: { maxDimension: DOCUMENT_LIMITS.maxDimension, maxBytes: DOCUMENT_LIMITS.maxBytes },
  };
  return JSON.stringify(canonicalize(envelope));
}

function fail(reason) {
  throw new CorruptProjectError(reason);
}

function check(cond, reason) {
  if (!cond) fail(reason);
}

// Validates the ENTIRE envelope before hydrating anything: a malformed project
// is never partially applied.
// Unknown annotation types inside the current schema version are corrupt
// input, not skippable content: a project that hydrates without them is a
// different project, which violates the no-partial-hydration rule.
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function assertBase64(bytes) {
  check(typeof bytes === "string" && bytes.length > 0, "embedded source.bytes must be non-empty base64");
  check(bytes.length % 4 === 0 && BASE64_PATTERN.test(bytes), "embedded source.bytes is not valid base64");
}

export function deserializeProject(input) {
  let raw;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      fail("not valid JSON");
    }
  } else {
    raw = input;
  }
  check(raw && typeof raw === "object" && !Array.isArray(raw), "envelope must be an object");
  check(raw.kind === PROJECT_KIND, `unknown project kind: ${raw.kind}`);
  check(Number.isInteger(raw.schemaVersion), "schemaVersion must be an integer");
  if (raw.schemaVersion > CURRENT_SCHEMA_VERSION) throw new UnsupportedVersionError(raw.schemaVersion);
  if (raw.schemaVersion < 1) fail(`schemaVersion out of range: ${raw.schemaVersion}`);
  check(typeof raw.id === "string" && raw.id.length > 0, "id must be a non-empty string");
  check(typeof raw.createdAt === "string" && typeof raw.updatedAt === "string", "createdAt/updatedAt must be strings");

  check(raw.canvas && typeof raw.canvas === "object", "canvas must be an object");
  try {
    assertSourceDimensions(raw.canvas.width, raw.canvas.height);
    assertDecodedSize(raw.canvas.width, raw.canvas.height);
  } catch (e) {
    if (e instanceof SourceRejectedError) fail(`canvas violates limits: ${e.reason}`);
    throw e;
  }

  const source = raw.source;
  check(source && typeof source === "object", "source must be an object");
  if (source.kind === "embedded") {
    check(SUPPORTED_SOURCE_MIME_TYPES.includes(source.mime), `unsupported embedded mime: ${source.mime}`);
    assertBase64(source.bytes);
  } else if (source.kind === "local-ref") {
    check(typeof source.sha256 === "string" && /^[0-9a-f]{64}$/i.test(source.sha256), "local-ref source.sha256 must be a hex digest");
    check(SUPPORTED_SOURCE_MIME_TYPES.includes(source.mime), `unsupported local-ref mime: ${source.mime}`);
  } else {
    fail(`unknown source.kind: ${source.kind}`);
  }

  check(Array.isArray(raw.annotations), "annotations must be an array");
  const seenZ = new Set();
  raw.annotations.forEach((entry, index) => {
    check(entry && typeof entry === "object" && !Array.isArray(entry), `annotations[${index}] must be an object`);
    check(ANNOTATION_TYPES.includes(entry.type), `unknown annotation type: ${entry.type}`);
    check(Number.isInteger(entry.z) && entry.z >= 0, `annotations[${index}].z must be a non-negative integer`);
    check(!seenZ.has(entry.z), `duplicate annotation z: ${entry.z}`);
    seenZ.add(entry.z);
  });
  // One deterministic representation: imported z values must already form the
  // canonical 0..n-1 sequence that reorderZ() establishes, so a
  // deserialize -> edit -> serialize cycle never rewrites ordering metadata
  // unrelated to the edit.
  const orderedZ = [...seenZ].sort((a, b) => a - b);
  check(
    orderedZ.length === raw.annotations.length && orderedZ.every((z, i) => z === i),
    "annotation z values must form the canonical sequence 0..n-1",
  );
  const annotations = raw.annotations;
  // Shape validation happens inside hydrateDocument; wrap its errors.
  try {
    return hydrateDocument({
      id: raw.id,
      width: raw.canvas.width,
      height: raw.canvas.height,
      source,
      annotations,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  } catch (e) {
    if (e instanceof AnnotationError || e instanceof DocumentError) {
      fail(`invalid project body: ${e.message}`);
    }
    throw e;
  }
}
