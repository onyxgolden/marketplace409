// FORGE Chart Builder — immutable chart document schema (slice 1).
// A ChartDocument is a plain data tree of nodes and edges: no React, no DOM,
// no layout engine. Layout algorithms and rendering arrive in later slices.
//
// Slice 2 adds `background`: a chart background preset id (see
// chartBackground.js) that travels with the document so future exports can
// reproduce it exactly.

import {
  DEFAULT_CHART_BACKGROUND,
  isValidChartBackgroundId,
} from "./chartBackground.js";

export const CHART_SCHEMA_VERSION = 1;

export const CHART_TYPES = Object.freeze(["org", "workflow"]);

export const NODE_SHAPES = Object.freeze([
  "rectangle",
  "rounded",
  "ellipse",
  "diamond",
  "pill",
]);

// Node style model (slice 4 — "color, style, text, options"). Every key is
// optional; missing keys resolve to NODE_STYLE_DEFAULTS. Unknown keys are
// preserved verbatim (same pattern as node `fields`) so custom tooling never
// loses data it wrote.
export const NODE_CARD_STYLES = Object.freeze(["tint", "white", "outline"]);
export const NODE_TEXT_SIZES = Object.freeze(["sm", "md", "lg"]);
export const NODE_TEXT_ALIGNS = Object.freeze(["left", "center"]);

export const NODE_STYLE_DEFAULTS = Object.freeze({
  color: "#1f6feb",
  card: "white",
  textSize: "md",
  bold: false,
  align: "left",
  borderWidth: 1,
});

// Allowed line-thickness values for node borders, edge overrides, and the
// document connector default. Integer steps only.
export const LINE_WIDTHS = Object.freeze([1, 2, 3, 4]);

// What the canvas edge <path> rendered before line thickness was user
// controllable; the document default resolves to this.
export const DEFAULT_CONNECTOR_WIDTH = 2;

function assertLineWidth(value, what) {
  if (!Number.isInteger(value) || !LINE_WIDTHS.includes(value)) {
    throw new ChartError(`${what} must be one of ${LINE_WIDTHS.join(", ")}`);
  }
}

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
  if (style.card !== undefined && !NODE_CARD_STYLES.includes(style.card)) {
    throw new ChartError(`node style.card must be one of ${NODE_CARD_STYLES.join(", ")}`);
  }
  if (style.textSize !== undefined && !NODE_TEXT_SIZES.includes(style.textSize)) {
    throw new ChartError(`node style.textSize must be one of ${NODE_TEXT_SIZES.join(", ")}`);
  }
  if (style.bold !== undefined && typeof style.bold !== "boolean") {
    throw new ChartError("node style.bold must be a boolean");
  }
  if (style.align !== undefined && !NODE_TEXT_ALIGNS.includes(style.align)) {
    throw new ChartError(`node style.align must be one of ${NODE_TEXT_ALIGNS.join(", ")}`);
  }
  if (style.borderWidth !== undefined) {
    assertLineWidth(style.borderWidth, "node style.borderWidth");
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
// Style resolution (pure view-model helpers; shared by canvas and exporters)
// ---------------------------------------------------------------------------

/**
 * Resolve a node's style object to concrete values, applying
 * NODE_STYLE_DEFAULTS for every missing key. Lenient by design: rendering
 * never throws on a style the validator would have rejected at write time.
 */
export function resolveNodeStyle(style) {
  const s = style ?? {};
  return {
    color:
      typeof s.color === "string" && s.color.length > 0
        ? s.color
        : NODE_STYLE_DEFAULTS.color,
    card: NODE_CARD_STYLES.includes(s.card) ? s.card : NODE_STYLE_DEFAULTS.card,
    textSize: NODE_TEXT_SIZES.includes(s.textSize)
      ? s.textSize
      : NODE_STYLE_DEFAULTS.textSize,
    bold: s.bold === true,
    align: NODE_TEXT_ALIGNS.includes(s.align) ? s.align : NODE_STYLE_DEFAULTS.align,
    borderWidth: LINE_WIDTHS.includes(s.borderWidth)
      ? s.borderWidth
      : NODE_STYLE_DEFAULTS.borderWidth,
  };
}

const TEXT_METRICS = {
  sm: { name: 11, subtitle: 10, meta: 9, nameLimit: 30, subtitleLimit: 34, metaLimit: 38 },
  md: { name: 13, subtitle: 11, meta: 10, nameLimit: 26, subtitleLimit: 30, metaLimit: 34 },
  lg: { name: 16, subtitle: 12, meta: 11, nameLimit: 20, subtitleLimit: 24, metaLimit: 28 },
};

/**
 * Font sizes and truncation limits for a text size. Larger text truncates
 * shorter so it stays inside the fixed-size card (node box size never
 * changes with text size).
 */
export function styleTextMetrics(textSize) {
  return TEXT_METRICS[NODE_TEXT_SIZES.includes(textSize) ? textSize : "md"];
}

/**
 * Card fill/border paint for a style. `tint` fills the card with the accent
 * at ~10% alpha; `outline` keeps the white fill with an accent border;
 * `white` is the classic card. Border thickness is owned by
 * style.borderWidth (resolved separately) — never by the card treatment.
 * Selection styling stays in the UI.
 */
export function resolveCardPaint(style) {
  const s = resolveNodeStyle(style);
  const accent = s.color;
  if (s.card === "tint") {
    const fill = /^#[0-9a-f]{6}$/i.test(accent) ? `${accent}1a` : "#ffffff";
    return { fill, stroke: accent };
  }
  return { fill: "#ffffff", stroke: accent };
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export const EDGE_TYPE_GUIDE = Object.freeze({
  org: ORG_EDGE_TYPES,
  workflow: WORKFLOW_EDGE_TYPES,
});

function normalizeEdgeStyle(style) {
  if (style === undefined || style === null) return Object.freeze({});
  assertPlainObject(style, "edge style");
  if (style.width !== undefined) {
    assertLineWidth(style.width, "edge style.width");
  }
  return Object.freeze({ ...style });
}

export function createEdge({ id, from, to, label = "", type, style } = {}) {
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
  return Object.freeze({ id, from, to, label, type: type ?? "", style: normalizeEdgeStyle(style) });
}

// ---------------------------------------------------------------------------
// Document settings (canvas-level defaults, e.g. connector line thickness)
// ---------------------------------------------------------------------------

/**
 * Normalize document settings. Unknown keys are preserved verbatim (same
 * pattern as node style) so future settings never break old documents.
 */
function normalizeSettings(settings) {
  if (settings === undefined || settings === null) return Object.freeze({});
  assertPlainObject(settings, "document settings");
  if (settings.connectorWidth !== undefined) {
    assertLineWidth(settings.connectorWidth, "settings.connectorWidth");
  }
  return Object.freeze({ ...settings });
}

/**
 * Resolve document settings to concrete values, applying defaults for
 * missing keys. Lenient: never throws on values the validator rejected at
 * write time.
 */
export function resolveDocSettings(settings) {
  const s = settings ?? {};
  return {
    ...s,
    connectorWidth: LINE_WIDTHS.includes(s.connectorWidth)
      ? s.connectorWidth
      : DEFAULT_CONNECTOR_WIDTH,
  };
}

/**
 * Resolve the rendered width of a connector: per-edge override wins, then
 * the document default, then today's canvas width.
 */
export function resolveEdgeWidth(edge, settings) {
  const override = edge?.style?.width;
  if (LINE_WIDTHS.includes(override)) return override;
  return resolveDocSettings(settings).connectorWidth;
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

function normalizeBackground(background) {
  // Unknown preset ids are rejected — never invent a background.
  if (background === undefined || background === null) {
    return DEFAULT_CHART_BACKGROUND;
  }
  if (!isValidChartBackgroundId(background)) {
    throw new ChartError(`unknown chart background "${background}"`);
  }
  return background;
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
  background,
  settings,
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
    background: normalizeBackground(background),
    settings: normalizeSettings(settings),
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
export function withParts(doc, { nodes, edges, metadata, background, settings } = {}) {
  return Object.freeze({
    ...doc,
    nodes: nodes !== undefined ? Object.freeze([...nodes]) : doc.nodes,
    edges: edges !== undefined ? Object.freeze([...edges]) : doc.edges,
    metadata: metadata !== undefined ? normalizeMetadata(metadata) : doc.metadata,
    background:
      background !== undefined ? normalizeBackground(background) : doc.background,
    settings: settings !== undefined ? normalizeSettings(settings) : doc.settings,
    updatedAt: new Date().toISOString(),
  });
}
