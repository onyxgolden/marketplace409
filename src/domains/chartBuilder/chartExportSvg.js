// FORGE Chart Builder — SVG export (slice 4.2).
// Pure domain serializer: ChartDocument -> SVG string. It never touches the
// DOM and never uses React — exportChartSvg builds the markup as a string,
// so large charts export without a render pass.
//
// Layer order: background, edges, nodes, labels. Connector geometry mirrors
// ChartCanvas (elbow connectors, arrow markers on workflows) so the export
// looks like the canvas. The full node style object is honored — accent
// color, card fill/border, text size, bold, alignment — via the same
// resolvers the canvas uses. All text (node labels, subtitles, field values,
// edge labels) is escaped against <script>/HTML injection.

import {
  LAYOUT_NODE_ORG,
  LAYOUT_NODE_WORKFLOW,
  contentBounds,
  layoutChart,
} from "./chartLayout.js";
import { CHART_TYPES } from "./chartDocument.js";
import {
  DEFAULT_CHART_BACKGROUND,
  getChartBackground,
} from "./chartBackground.js";
import {
  resolveCardPaint,
  resolveEdgeWidth,
  resolveNodeStyle,
  styleTextMetrics,
} from "./chartDocument.js";

export class ChartExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChartExportError";
  }
}

const PAD = 56;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;
const EDGE_STROKE = "#6b7280";

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Escape a value for use inside SVG text content or a quoted attribute.
 */
export function escapeSvgText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(text, max = 26) {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function nodeSizeFor(type) {
  return type === "workflow" ? LAYOUT_NODE_WORKFLOW : LAYOUT_NODE_ORG;
}

function assertExportable(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new ChartExportError("A chart document is required to export.");
  }
  if (!CHART_TYPES.includes(doc.type)) {
    throw new ChartExportError(`Cannot export a chart of unknown type "${doc.type}".`);
  }
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) {
    throw new ChartExportError("The chart document has no nodes or edges.");
  }
}

function resolvePositions(doc, { autoLayout = false } = {}) {
  const positions = {};
  for (const node of doc.nodes) {
    const x = node?.position?.x ?? 0;
    const y = node?.position?.y ?? 0;
    positions[node.id] = { x, y };
  }
  // A document's stored positions are authoritative: never substitute a
  // layout implicitly. Callers that need a fallback for documents that were
  // never laid out pass { autoLayout: true } explicitly.
  if (
    autoLayout &&
    doc.nodes.length > 1 &&
    Object.values(positions).every((p) => p.x === 0 && p.y === 0)
  ) {
    return layoutChart(doc);
  }
  return positions;
}

// ---------------------------------------------------------------------------
// connectors (mirrors ChartCanvas geometry)
// ---------------------------------------------------------------------------

function edgePath(from, to, nodeW, nodeH, direction) {
  if (direction === "left-right") {
    const x1 = from.x + nodeW;
    const y1 = from.y + nodeH / 2;
    const x2 = to.x;
    const y2 = to.y + nodeH / 2;
    if (x2 >= x1) {
      const midX = (x1 + x2) / 2;
      return `M ${round1(x1)} ${round1(y1)} H ${round1(midX)} V ${round1(y2)} H ${round1(x2)}`;
    }
    const dipY = Math.max(y1, y2) + 48;
    const midX = (x1 + x2) / 2;
    return (
      `M ${round1(x1)} ${round1(y1)} C ${round1(x1 + 36)} ${round1(y1)}, ` +
      `${round1(midX)} ${round1(dipY)}, ${round1(midX)} ${round1(dipY)} ` +
      `S ${round1(x2 - 36)} ${round1(y2)}, ${round1(x2)} ${round1(y2)}`
    );
  }
  const x1 = from.x + nodeW / 2;
  const y1 = from.y + nodeH;
  const x2 = to.x + nodeW / 2;
  const y2 = to.y;
  const midY = (y1 + y2) / 2;
  return `M ${round1(x1)} ${round1(y1)} V ${round1(midY)} H ${round1(x2)} V ${round1(y2)}`;
}

function edgeMidpoint(from, to, nodeW, nodeH, direction) {
  if (direction === "left-right") {
    return { x: (from.x + nodeW + to.x) / 2, y: from.y + nodeH / 2 - 8 };
  }
  return { x: to.x + nodeW / 2, y: (from.y + nodeH + to.y) / 2 - 4 };
}

// ---------------------------------------------------------------------------
// background
// ---------------------------------------------------------------------------

function lastHex(css) {
  const matches = String(css).match(/#[0-9a-f]{3,6}\b/gi);
  return matches ? matches[matches.length - 1] : "#ffffff";
}

function parseGradientStops(css) {
  const inner = String(css).match(/^linear-gradient\((.*)\)$/i)?.[1];
  if (!inner) return null;
  const parts = inner.split(",").map((p) => p.trim());
  const anglePart = parts.shift();
  const angle = parseFloat(anglePart) || 180;
  const stops = [];
  for (const part of parts) {
    const m = part.match(/^(#[0-9a-f]{3,6}|rgba?\([^)]*\))\s*([0-9.]+%?)?$/i);
    if (!m) return null;
    stops.push({ color: m[1], offset: m[2] ?? null });
  }
  if (stops.length === 0) return null;
  const filled = stops.map((s, i) => ({
    color: s.color,
    offset: s.offset ?? `${Math.round((i / (stops.length - 1)) * 100)}%`,
  }));
  // CSS angles run clockwise from "up"; SVG vectors run from (x1,y1) to (x2,y2).
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  return {
    x1: round1(0.5 - dx / 2),
    y1: round1(0.5 - dy / 2),
    x2: round1(0.5 + dx / 2),
    y2: round1(0.5 + dy / 2),
    stops: filled,
  };
}

function renderBackgroundSvg(backgroundId, width, height, uid) {
  // Image backgrounds bypass the preset catalog entirely: a data URL embeds
  // safely; anything else must never be fetched — render a placeholder with
  // a warning instead.
  if (typeof backgroundId === "string" && !getChartBackground(backgroundId)) {
    if (backgroundId.startsWith("data:")) {
      return (
        `<image href="${escapeSvgText(backgroundId)}" x="0" y="0" width="${width}" ` +
        `height="${height}" preserveAspectRatio="xMidYMid slice"/>`
      );
    }
    return (
      `<rect width="${width}" height="${height}" fill="#f1f5f9"/>` +
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="14" fill="#64748b">` +
      `External image background was not embedded in this export</text>`
    );
  }
  const preset = getChartBackground(backgroundId) ?? getChartBackground(DEFAULT_CHART_BACKGROUND);
  const css = preset.css;
  const base = lastHex(css);

  if (preset.category === "solid") {
    return `<rect width="${width}" height="${height}" fill="${escapeSvgText(css)}"/>`;
  }

  if (preset.category === "gradient") {
    const g = parseGradientStops(css);
    if (!g) {
      return `<rect width="${width}" height="${height}" fill="${escapeSvgText(base)}"/>`;
    }
    const stops = g.stops
      .map(
        (s) =>
          `<stop offset="${escapeSvgText(s.offset)}" stop-color="${escapeSvgText(s.color)}"/>`
      )
      .join("");
    return (
      `<defs><linearGradient id="${uid}-bg" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">` +
      `${stops}</linearGradient></defs>` +
      `<rect width="${width}" height="${height}" fill="url(#${uid}-bg)"/>`
    );
  }

  if (preset.category === "pattern") {
    // Grid-style backgrounds: base color plus a <pattern> tile.
    if (preset.id === "dot-grid") {
      const dot = css.match(/rgba?\([^)]*\)/i)?.[0] ?? "rgba(15,23,42,0.16)";
      return (
        `<rect width="${width}" height="${height}" fill="${escapeSvgText(base)}"/>` +
        `<defs><pattern id="${uid}-dots" width="24" height="24" patternUnits="userSpaceOnUse">` +
        `<circle cx="2" cy="2" r="1.2" fill="${escapeSvgText(dot)}"/></pattern></defs>` +
        `<rect width="${width}" height="${height}" fill="url(#${uid}-dots)"/>`
      );
    }
    const line = css.match(/rgba?\([^)]*\)/i)?.[0] ?? "rgba(255,255,255,0.09)";
    return (
      `<rect width="${width}" height="${height}" fill="${escapeSvgText(base)}"/>` +
      `<defs><pattern id="${uid}-grid" width="26" height="26" patternUnits="userSpaceOnUse">` +
      `<path d="M 26 0 L 0 0 0 26" fill="none" stroke="${escapeSvgText(line)}" stroke-width="1"/>` +
      `</pattern></defs>` +
      `<rect width="${width}" height="${height}" fill="url(#${uid}-grid)"/>`
    );
  }

  // All catalog categories are handled above; fall back to a plain base color.
  return `<rect width="${width}" height="${height}" fill="${escapeSvgText(base)}"/>`;
}

// ---------------------------------------------------------------------------
// document assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the final SVG document from its parts.
 */
export function buildSvgDocument({ width, height, title, defsSvg, backgroundSvg, edgeSvg, nodeSvg, labelSvg }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img">` +
    (title ? `<title>${escapeSvgText(title)}</title>` : "") +
    (defsSvg ?? "") +
    `<g id="background">${backgroundSvg ?? ""}</g>` +
    `<g id="edges" fill="none" stroke="${EDGE_STROKE}" stroke-width="2">${edgeSvg ?? ""}</g>` +
    `<g id="nodes">${nodeSvg ?? ""}</g>` +
    `<g id="labels" font-family="system-ui, -apple-system, sans-serif">${labelSvg ?? ""}</g>` +
    `</svg>`
  );
}

function renderNodeCard(node, x, y, size) {
  const style = resolveNodeStyle(node?.style);
  const paint = resolveCardPaint(node?.style);
  return (
    `<g transform="translate(${round1(x)},${round1(y)})">` +
    `<rect width="${size.w}" height="${size.h}" rx="10" fill="${paint.fill}" ` +
    `stroke="${escapeSvgText(paint.stroke)}" stroke-width="${style.borderWidth}"/>` +
    `<rect width="6" height="${size.h}" rx="3" fill="${escapeSvgText(style.color)}"/>` +
    `</g>`
  );
}

function renderNodeTexts(node, x, y, size) {
  const style = resolveNodeStyle(node?.style);
  const metrics = styleTextMetrics(style.textSize);
  const centered = style.align === "center";
  const tx = round1(x + (centered ? size.w / 2 : 16));
  const anchor = centered ? "middle" : "start";
  const weight = style.bold ? 700 : 400;
  const title = node?.fields?.title ?? "";
  const dept = node?.fields?.department ?? "";
  const meta = [title, dept].filter(Boolean).join(" · ");
  let out =
    `<text x="${tx}" y="${round1(y + 26)}" font-size="${metrics.name}" ` +
    `font-weight="${weight}" text-anchor="${anchor}" fill="#111827">` +
    `${escapeSvgText(truncate(node.label, metrics.nameLimit))}</text>`;
  if (node.subtitle) {
    out +=
      `<text x="${tx}" y="${round1(y + 44)}" font-size="${metrics.subtitle}" ` +
      `text-anchor="${anchor}" fill="#4b5563">` +
      `${escapeSvgText(truncate(node.subtitle, metrics.subtitleLimit))}</text>`;
  }
  if (meta) {
    out +=
      `<text x="${tx}" y="${round1(y + size.h - 12)}" font-size="${metrics.meta}" ` +
      `text-anchor="${anchor}" fill="#6b7280">` +
      `${escapeSvgText(truncate(meta, metrics.metaLimit))}</text>`;
  }
  return out;
}

/**
 * Export a ChartDocument to a standalone SVG string.
 * @param {object} chartDocument canvas chart document
 * @param {{ direction?: "top-down"|"left-right", title?: string, autoLayout?: boolean }} options
 *   autoLayout (default false): when true, an all-(0,0) multi-node document
 *   is exported with the deterministic layout instead of its stored
 *   positions. The default preserves stored positions exactly.
 * @returns {{ svg: string, width: number, height: number }}
 */
export function exportChartSvg(chartDocument, options = {}) {
  assertExportable(chartDocument);
  const size = nodeSizeFor(chartDocument.type);
  const direction =
    options.direction ??
    (chartDocument.type === "org" ? "top-down" : "left-right");
  const positions = resolvePositions(chartDocument, {
    autoLayout: options.autoLayout === true,
  });
  const bounds = contentBounds(positions, size);
  const width = Math.max(Math.ceil(bounds.w + PAD * 2), MIN_WIDTH);
  const height = Math.max(Math.ceil(bounds.h + PAD * 2), MIN_HEIGHT);
  const offsetX = PAD - Math.min(0, bounds.x);
  const offsetY = PAD - Math.min(0, bounds.y);
  const uid = `chart${Math.abs(
    [...chartDocument.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)
  ).toString(36)}`;

  const byId = new Map(chartDocument.nodes.map((n) => [n.id, n]));
  const placed = new Map(
    [...byId.entries()].map(([id, node]) => [
      id,
      { node, x: positions[id].x + offsetX, y: positions[id].y + offsetY },
    ])
  );

  let edgeSvg = "";
  let edgeLabelSvg = "";
  for (const edge of chartDocument.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue; // dangling edges are skipped, never fatal
    const d = edgePath(from, to, size.w, size.h, direction);
    const marker =
      chartDocument.type === "workflow" ? ` marker-end="url(#${uid}-arrow)"` : "";
    const width = resolveEdgeWidth(edge, chartDocument.settings);
    edgeSvg += `<path d="${d}"${marker} stroke-width="${width}"/>`;
    if (edge.label) {
      const mid = edgeMidpoint(from, to, size.w, size.h, direction);
      edgeLabelSvg +=
        `<text x="${round1(mid.x + offsetX)}" y="${round1(mid.y + offsetY)}" text-anchor="middle" ` +
        `font-size="11" fill="#374151" stroke="#ffffff" stroke-width="3" paint-order="stroke">` +
        `${escapeSvgText(edge.label)}</text>`;
    }
  }

  let nodeSvg = "";
  let nodeLabelSvg = "";
  for (const { node, x, y } of placed.values()) {
    nodeSvg += renderNodeCard(node, x, y, size);
    nodeLabelSvg += renderNodeTexts(node, x, y, size);
  }

  const defsSvg =
    chartDocument.type === "workflow"
      ? `<defs><marker id="${uid}-arrow" viewBox="0 0 10 10" refX="8" refY="5" ` +
        `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
        `<path d="M 0 1 L 9 5 L 0 9 z" fill="${EDGE_STROKE}"/></marker></defs>`
      : "";

  const backgroundSvg = renderBackgroundSvg(
    chartDocument.background,
    width,
    height,
    uid
  );

  const svg = buildSvgDocument({
    width,
    height,
    title: options.title ?? `${chartDocument.type === "org" ? "Org chart" : "Workflow chart"}`,
    defsSvg,
    backgroundSvg,
    edgeSvg,
    nodeSvg,
    labelSvg: edgeLabelSvg + nodeLabelSvg,
  });
  return { svg, width, height };
}
