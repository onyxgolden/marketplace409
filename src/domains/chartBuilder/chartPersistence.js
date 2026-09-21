// FORGE Chart Builder — chart persistence (slice 4.1).
// Pure domain module: serialize / validate / migrate / deserialize the
// persisted chart document envelope. The envelope is the project-document
// shape: { id, documentType: "chart", version, title, content, metadata }.
//
// What travels to storage: the canonical chart document only — chart type,
// nodes (ids, labels, subtitles, fields, manual positions, styles), edges,
// background selection, and migration metadata. The canvas ChartDocument
// never carries undo history, UI selection, open panels, viewport zoom, or
// drag state, so none of that can leak into storage. Unknown fields are
// preserved verbatim at every level — serialization copies the full
// node/edge and canonicalizes only the known fields. The one exception is
// transient UI/editor state keys (selection, drag state, hover): those are
// stripped before copying so they can never leak into storage, even if a
// node object arrives carrying them.
//
// Invalid stored documents can never enter canvas state: deserialize runs
// migrate → validate → construct, and any failure throws
// ChartPersistenceError with a human-readable message. Nothing is silently
// repaired.

import {
  CHART_SCHEMA_VERSION,
  CHART_TYPES,
  ChartError,
  createChartDocument,
} from "./chartDocument.js";
import { DEFAULT_CHART_BACKGROUND, isValidChartBackgroundId } from "./chartBackground.js";

export const CHART_DOCUMENT_TYPE = "chart";
export const PERSISTED_CHART_VERSION = 1;

export class ChartPersistenceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ChartPersistenceError";
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChartPersistenceError(`${name} must be an object.`);
  }
}

function toJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new ChartPersistenceError(
      "The chart contains values that cannot be saved.",
      { cause: error }
    );
  }
}

// Keys that describe live editor/UI state rather than document data. They
// are stripped from nodes/edges before serialization so they can never
// leak into storage — even if a node object arrives carrying them (e.g.
// `{ ...node, selected: true }` built by UI code). Unknown non-transient
// keys (e.g. customMetadata) are still preserved verbatim for forward
// compatibility.
const NODE_TRANSIENT_KEYS = new Set([
  "selected",
  "dragState",
  "isDragging",
  "hover",
]);
// Edges carry no UI state in the current canvas; the filter exists so the
// invariant holds if edge selection/hover state is ever attached.
const EDGE_TRANSIENT_KEYS = new Set([
  "selected",
  "dragState",
  "isDragging",
  "hover",
]);

function stripTransientKeys(source, transientKeys) {
  const out = {};
  for (const key of Object.keys(source)) {
    if (!transientKeys.has(key)) out[key] = source[key];
  }
  return out;
}

function pickNodeFields(node) {
  // Canonical copy: strip transient UI/editor keys first, then spread the
  // full node so unknown extension keys (e.g. customMetadata) survive the
  // round trip, then validate/override the known fields with their
  // canonical defaults.
  const source = stripTransientKeys(node ?? {}, NODE_TRANSIENT_KEYS);
  return {
    ...source,
    id: source.id,
    label: source.label,
    subtitle: source.subtitle ?? "",
    fields: source.fields ?? {},
    position: source.position ?? { x: 0, y: 0 },
    style: source.style ?? {},
  };
}

function pickEdgeFields(edge) {
  // Canonical copy: strip transient UI/editor keys first, then spread the
  // full edge so unknown extension keys survive the round trip, then
  // validate/override the known fields.
  const source = stripTransientKeys(edge ?? {}, EDGE_TRANSIENT_KEYS);
  return {
    ...source,
    id: source.id,
    from: source.from,
    to: source.to,
    label: source.label ?? "",
    type: source.type ?? "",
    style: source.style ?? {},
  };
}

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

/**
 * Serialize a canvas ChartDocument into the persisted envelope.
 * Transient UI/editor keys (selection, drag state, hover) are stripped
 * from nodes/edges; unknown extension keys (e.g. customMetadata) are
 * preserved verbatim.
 * @param {object} chartDocument canvas chart document
 * @param {{ title?: string, templateId?: string|null }} options
 * @returns {object} JSON-safe persisted envelope
 */
export function serializeChartDocument(chartDocument, options = {}) {
  assertPlainObject(chartDocument, "chartDocument");
  if (typeof chartDocument.id !== "string" || chartDocument.id.length === 0) {
    throw new ChartPersistenceError("Cannot save a chart without an id.");
  }
  if (!CHART_TYPES.includes(chartDocument.type)) {
    throw new ChartPersistenceError(
      `Cannot save a chart of unknown type "${chartDocument.type}".`
    );
  }
  const title =
    typeof options.title === "string" && options.title.trim().length > 0
      ? options.title.trim().slice(0, 120)
      : "Untitled chart";
  const templateId =
    options.templateId ?? chartDocument.metadata?.templateId ?? null;
  return {
    id: chartDocument.id,
    documentType: CHART_DOCUMENT_TYPE,
    version: PERSISTED_CHART_VERSION,
    title,
    content: toJsonSafe({
      type: chartDocument.type,
      nodes: (chartDocument.nodes ?? []).map(pickNodeFields),
      edges: (chartDocument.edges ?? []).map(pickEdgeFields),
      background: chartDocument.background ?? DEFAULT_CHART_BACKGROUND,
      settings: chartDocument.settings ?? {},
    }),
    metadata: {
      templateId,
      createdAt: chartDocument.createdAt ?? null,
      updatedAt: chartDocument.updatedAt ?? null,
      chartSchemaVersion: CHART_SCHEMA_VERSION,
      migratedFrom: null,
    },
  };
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

function problemsForEnvelopeShape(envelope) {
  const problems = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return ["The saved data is not a chart document."];
  }
  if (envelope.documentType !== CHART_DOCUMENT_TYPE) {
    problems.push(
      `This saved document is a "${envelope.documentType ?? "unknown"}" document, not a chart — it was not opened.`
    );
  }
  if (typeof envelope.version !== "number" || !Number.isInteger(envelope.version)) {
    problems.push("The saved chart has no recognizable version.");
  } else if (envelope.version > PERSISTED_CHART_VERSION) {
    problems.push(
      `This chart was saved by a newer version (v${envelope.version}) and cannot be opened here.`
    );
  }
  if (typeof envelope.title !== "string" || envelope.title.length === 0) {
    problems.push("The saved chart has no title.");
  }
  const content = envelope.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    problems.push("The saved chart has no content.");
    return problems;
  }
  if (!CHART_TYPES.includes(content.type)) {
    problems.push(`The saved chart has an unknown chart type "${content.type ?? "none"}".`);
  }
  if (!Array.isArray(content.nodes)) problems.push("The saved chart's nodes are missing.");
  if (!Array.isArray(content.edges)) problems.push("The saved chart's edges are missing.");
  if (
    content.background !== undefined &&
    content.background !== null &&
    !isValidChartBackgroundId(content.background)
  ) {
    problems.push(`The saved chart uses an unknown background "${content.background}".`);
  }
  return problems;
}

/**
 * Validate a (migrated) persisted envelope. Returns an array of
 * human-readable problems; empty means the envelope is loadable. Structural
 * checks run through the chart constructors, so duplicate ids, bad
 * positions, and bad fields are caught here — plus edge-endpoint checks the
 * constructors do not perform.
 */
export function validatePersistedChartDocument(envelope) {
  const problems = problemsForEnvelopeShape(envelope);
  if (problems.length > 0) return problems;
  const { content } = envelope;
  let doc;
  try {
    doc = createChartDocument({
      id: envelope.id,
      type: content.type,
      nodes: content.nodes,
      edges: content.edges,
      background: content.background ?? DEFAULT_CHART_BACKGROUND,
      settings: content.settings,
      metadata: { templateId: envelope.metadata?.templateId ?? null },
      createdAt: envelope.metadata?.createdAt ?? undefined,
    });
  } catch (error) {
    if (error instanceof ChartError) {
      return [`The saved chart is invalid: ${error.message}`];
    }
    throw error;
  }
  // createChartDocument does not check that edges point at real nodes.
  const nodeIds = new Set(doc.nodes.map((n) => n.id));
  for (const edge of doc.edges) {
    if (!nodeIds.has(edge.from)) {
      problems.push(
        `The saved chart has an edge "${edge.id}" starting from missing node "${edge.from}".`
      );
    }
    if (!nodeIds.has(edge.to)) {
      problems.push(
        `The saved chart has an edge "${edge.id}" pointing to missing node "${edge.to}".`
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// migrate
// ---------------------------------------------------------------------------

/**
 * Migrate a persisted envelope to the current version. Unknown fields are
 * preserved verbatim at every level. Throws ChartPersistenceError for
 * envelopes that cannot be migrated (wrong document type, unknown version,
 * newer version).
 */
export function migrateChartDocument(envelope) {
  assertPlainObject(envelope, "saved chart");
  if (envelope.documentType !== CHART_DOCUMENT_TYPE) {
    throw new ChartPersistenceError(
      `Cannot migrate: this is a "${envelope.documentType ?? "unknown"}" document, not a chart.`
    );
  }
  const version = envelope.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new ChartPersistenceError("Cannot migrate: the saved chart has no version.");
  }
  if (version > PERSISTED_CHART_VERSION) {
    throw new ChartPersistenceError(
      `Cannot migrate: chart version ${version} is newer than this app understands.`
    );
  }
  // Preserve unknown top-level fields verbatim.
  const out = { ...toJsonSafe(envelope), version: PERSISTED_CHART_VERSION };
  const content = { ...(out.content ?? {}) };
  if (!Array.isArray(content.nodes)) content.nodes = [];
  if (!Array.isArray(content.edges)) content.edges = [];
  if (!isValidChartBackgroundId(content.background)) {
    content.background = DEFAULT_CHART_BACKGROUND;
  }
  out.content = content;
  const metadata = { ...(out.metadata ?? {}) };
  if (metadata.templateId === undefined) metadata.templateId = null;
  if (metadata.createdAt === undefined) metadata.createdAt = null;
  if (metadata.updatedAt === undefined) metadata.updatedAt = null;
  metadata.chartSchemaVersion = CHART_SCHEMA_VERSION;
  // version 0 predates the envelope (legacy shape); anything older than the
  // current version records where it came from.
  metadata.migratedFrom = version < PERSISTED_CHART_VERSION ? version : null;
  out.metadata = metadata;
  return out;
}

// ---------------------------------------------------------------------------
// deserialize
// ---------------------------------------------------------------------------

/**
 * Load a persisted envelope back into a canvas ChartDocument:
 * migrate → validate → construct. Any failure throws ChartPersistenceError
 * with a visible message; the invalid document never reaches canvas state.
 * Timestamps recorded at save time are restored so a save → reload round
 * trip returns an identical document. Loading always starts fresh — no
 * history or UI state is restored (there is none to restore).
 */
export function deserializeChartDocument(envelope) {
  const migrated = migrateChartDocument(envelope);
  const problems = validatePersistedChartDocument(migrated);
  if (problems.length > 0) {
    throw new ChartPersistenceError(
      `This saved chart cannot be opened: ${problems.join(" ")}`
    );
  }
  const { content, metadata } = migrated;
  const doc = createChartDocument({
    id: migrated.id,
    type: content.type,
    nodes: content.nodes,
    edges: content.edges,
    background: content.background,
    settings: content.settings,
    metadata: { templateId: metadata.templateId ?? null },
    createdAt: metadata.createdAt ?? undefined,
  });
  // createChartDocument stamps updatedAt = createdAt; restore the saved
  // updatedAt so save → reload is identical.
  if (typeof metadata.updatedAt === "string" && metadata.updatedAt.length > 0) {
    return Object.freeze({ ...doc, updatedAt: metadata.updatedAt });
  }
  return doc;
}
