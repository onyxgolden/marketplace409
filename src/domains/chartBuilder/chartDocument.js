// FORGE Chart Builder — immutable chart document schema (slice 1).
// A ChartDocument is a plain data tree of nodes and edges: no React, no DOM,
// no layout engine. Layout algorithms and rendering arrive in later slices.

export const CHART_SCHEMA_VERSION = 1;

export const CHART_TYPES = Object.freeze(["org", "workflow"]);

export const NODE_SHAPES = Object.freeze([
  "rectangle",
  "rounded",
  "ellipse",
  "diamond",
  "pill",
]);

export const ORG_EDGE_TYPES = Object.freeze(["supervisor"]);
export const WORKFLOW_EDGE_TYPES = Object.freeze([
  "sequence",
  "decision-yes",
  "decision-no",
]);

export class ChartError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChartError";
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ChartError(`${name} must be a non-empty string`);
  }
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChartError(`${name} must be an object`);
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export const NODE_FIELD_KEYS = Object.freeze(["title", "department", "location"]);

function normalizeFields(fields) {
  if (fields === undefined || fields === null) return Object.freeze({});
  assertPlainObject(fields, "node fields");
  const out = {};
  // Known keys are strictly typed; unknown keys are preserved verbatim so
  // custom importer fields are never silently dropped.
  for (const key of Object.keys(fields)) {
    if (fields[key] !== undefined) {
      if (typeof fields[key] !== "string") {
        throw new ChartError(`node fields.${key} must be a string`);
      }
      out[key] = fields[key];
    }
  }
  return Object.freeze(out);
}

function normalizePosition(position) {
  if (position === undefined || position === null) {
    return Object.freeze({ x: 0, y: 0 });
  }
  assertPlainObject(position, "node position");
  if (
    typeof position.x !== "number" ||
    typeof position.y !== "number" ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    throw new ChartError("node position.x and position.y must be finite numbers");
  }
  return Object.freeze({ x: position.x, y: position.y });
}

function normalizeStyle(style) {
  if (style === undefined || style === null) return Object.freeze({});
  assertPlainObject(style, "node style");
  if (style.shape !== undefined && !NODE_SHAPES.includes(style.shape)) {
    throw new ChartError(`node style.shape must be one of ${NODE_SHAPES.join(", ")}`);
  }
  if (style.template !== undefined) assertNonEmptyString(style.template, "node style.template");
  if (style.color !== undefined && typeof style.color !== "string") {
    throw new ChartError("node style.color must be a string");
  }
  return Object.freeze({ ...style });
}

export function createNode({
  id,
  label,
  subtitle = "",
  fields,
  position,
  style,
} = {}) {
  assertNonEmptyString(id, "node id");
  assertNonEmptyString(label, "node label");
  if (typeof subtitle !== "string") {
    throw new ChartError("node subtitle must be a string");
  }
  return Object.freeze({
    id,
    label,
    subtitle,
    fields: normalizeFields(fields),
    position: normalizePosition(position),
    style: normalizeStyle(style),
  });
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export const EDGE_TYPE_GUIDE = Object.freeze({
  org: ORG_EDGE_TYPES,
  workflow: WORKFLOW_EDGE_TYPES,
});

export function createEdge({ id, from, to, label = "", type } = {}) {
  assertNonEmptyString(id, "edge id");
  assertNonEmptyString(from, "edge from");
  assertNonEmptyString(to, "edge to");
  if (from === to) {
    throw new ChartError("edge from and to must be different nodes");
  }
  if (typeof label !== "string") {
    throw new ChartError("edge label must be a string");
  }
  if (type !== undefined && typeof type !== "string") {
    throw new ChartError("edge type must be a string");
  }
  return Object.freeze({ id, from, to, label, type: type ?? "" });
}

// ---------------------------------------------------------------------------
// ChartDocument
// ---------------------------------------------------------------------------

function normalizeMetadata(metadata) {
  if (metadata === undefined || metadata === null) {
    return Object.freeze({ templateId: null });
  }
  assertPlainObject(metadata, "document metadata");
  if (metadata.templateId !== undefined && metadata.templateId !== null) {
    assertNonEmptyString(metadata.templateId, "metadata.templateId");
  }
  return Object.freeze({ templateId: metadata.templateId ?? null });
}

function normalizeNodes(nodes, type) {
  if (!Array.isArray(nodes)) {
    throw new ChartError("document nodes must be an array");
  }
  const ids = new Set();
  const out = nodes.map((raw) => {
    // Always normalize through the constructor — a partially trusted object
    // with id/label but invalid position, fields, or style must not slip
    // through unvalidated.
    const node = createNode(raw ?? {});
    if (ids.has(node.id)) {
      throw new ChartError(`duplicate node id "${node.id}" in document`);
    }
    ids.add(node.id);
    return node;
  });
  return Object.freeze(out);
}

function normalizeEdges(edges) {
  if (!Array.isArray(edges)) {
    throw new ChartError("document edges must be an array");
  }
  const ids = new Set();
  const out = edges.map((raw) => {
    const edge = createEdge(raw ?? {});
    if (ids.has(edge.id)) {
      throw new ChartError(`duplicate edge id "${edge.id}" in document`);
    }
    ids.add(edge.id);
    return edge;
  });
  return Object.freeze(out);
}

export function createChartDocument({
  id,
  type,
  nodes = [],
  edges = [],
  metadata,
  createdAt,
} = {}) {
  assertNonEmptyString(id, "document id");
  if (!CHART_TYPES.includes(type)) {
    throw new ChartError(`document type must be one of ${CHART_TYPES.join(", ")}`);
  }
  const now = createdAt ?? new Date().toISOString();
  return Object.freeze({
    schemaVersion: CHART_SCHEMA_VERSION,
    id,
    type,
    nodes: normalizeNodes(nodes, type),
    edges: normalizeEdges(edges),
    metadata: normalizeMetadata(metadata),
    createdAt: now,
    updatedAt: now,
  });
}

export function getNode(doc, id) {
  return doc.nodes.find((n) => n.id === id) ?? null;
}

export function getEdge(doc, id) {
  return doc.edges.find((e) => e.id === id) ?? null;
}

// Returns a new document with bumped updatedAt; structural helpers live in
// chartReducer.js, but shared "replace parts" logic is kept here so both can
// use it.
export function withParts(doc, { nodes, edges, metadata } = {}) {
  return Object.freeze({
    ...doc,
    nodes: nodes !== undefined ? Object.freeze([...nodes]) : doc.nodes,
    edges: edges !== undefined ? Object.freeze([...edges]) : doc.edges,
    metadata: metadata !== undefined ? normalizeMetadata(metadata) : doc.metadata,
    updatedAt: new Date().toISOString(),
  });
}
