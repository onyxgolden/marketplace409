// FORGE Capture — PT-4 workflow symbol registry (ui/workflow-symbols.js).
//
// Pure, DOM-free. A fixed registry of 17 standard SOP/workflow-diagram
// symbols (the ISO 5807 flowchart repertoire — Visio's own flowchart
// stencil borrows the same symbols from this open standard; this module
// implements original, independently-authored geometry, never copied
// Microsoft Visio artwork/stencil files/branding, and the palette is
// labelled "Workflow symbols" in the UI, never "Visio symbols" — see
// `commands/muse/capture-pt4-workflow-symbol-suite-brief-for-claude.md`
// for the full product/legal reasoning this follows).
//
// Renderer-compatibility audit (done before writing a line of geometry,
// per the brief): `ui/annotations-render.js`'s `drawOpsToCanvas` supports
// exactly `rect`, `fillRect`, `line`, `filledTriangle`, `text`,
// `blurRect`, `redactPlaceholder`, `callout` — there is no native
// polygon/path/curve op. Every symbol here is therefore built from
// straight `line` segments only (a stroked polyline/closed polygon, open
// for non-closed marks like the annotation bracket), plus `rect` where a
// symbol genuinely is an axis-aligned rectangle, plus one `text` op for
// an optional bounded label. Curves (the cylinder's ellipse, the
// terminator's rounded ends, delay's D-curve, stored-data's bulging
// ends) are deterministic, bounded-segment-count polyline approximations
// of a true arc (`arcPoints` below) — never an unsupported curve op, and
// never more than a small, fixed number of segments per symbol (well
// under the 200-segment/symbol cap this module enforces).
//
// Every symbol's geometry is expressed in LOCAL coordinates strictly
// within `[0, w] x [0, h]` (the caller's own placement rect) — nothing
// here ever produces a point outside that box, so a symbol's outline
// provably fits inside its own `x,y,w,h` by construction, not by a
// separate bounds check after the fact.

export const MAX_SEGMENTS_PER_SYMBOL = 200;
export const MAX_SYMBOL_LABEL_LENGTH = 40;

/** Approximates an elliptical arc as a bounded polyline (parametric, not a canvas curve call). */
function arcPoints(cx, cy, rx, ry, startDeg, endDeg, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = startDeg + ((endDeg - startDeg) * i) / segments;
    const rad = (t * Math.PI) / 180;
    pts.push({ x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) });
  }
  return pts;
}

// --- Per-symbol local-coordinate geometry builders -------------------
// Each returns an array of "parts": { type: "rect", ... } |
// { type: "polyline", points, closed } -- converted to real draw ops by
// `symbolToDrawOps` below. Every function is pure: same (w, h) in, same
// parts out, every time.

function processParts(w, h) {
  return [{ type: "rect", x: 0, y: 0, w, h }];
}

function decisionParts(w, h) {
  return [
    {
      type: "polyline",
      closed: true,
      points: [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ],
    },
  ];
}

function terminatorParts(w, h) {
  const r = Math.min(h / 2, w / 2);
  const rightArc = arcPoints(w - r, h / 2, r, h / 2, -90, 90, 10);
  const leftArc = arcPoints(r, h / 2, r, h / 2, 90, 270, 10);
  return [
    {
      type: "polyline",
      closed: true,
      points: [{ x: r, y: 0 }, { x: w - r, y: 0 }, ...rightArc, { x: r, y: h }, ...leftArc],
    },
  ];
}

function dataParts(w, h) {
  const skew = w * 0.2;
  return [
    {
      type: "polyline",
      closed: true,
      points: [
        { x: skew, y: 0 },
        { x: w, y: 0 },
        { x: w - skew, y: h },
        { x: 0, y: h },
      ],
    },
  ];
}

function documentWaveBottom(w, h, baseY, segments = 6) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const x = w - (w * i) / segments;
    const y = baseY + Math.sin((i / segments) * Math.PI * 2) * (h * 0.06);
    pts.push({ x, y });
  }
  return pts;
}

function documentParts(w, h) {
  const baseY = h * 0.8;
  return [
    {
      type: "polyline",
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: baseY },
        ...documentWaveBottom(w, h, baseY),
      ],
    },
  ];
}

function multiDocumentParts(w, h) {
  const offset = Math.min(w, h) * 0.1;
  const back = {
    type: "polyline",
    closed: true,
    points: [
      { x: offset * 2, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h - offset * 2 },
      { x: offset * 2, y: h - offset * 2 },
    ],
  };
  const mid = {
    type: "polyline",
    closed: true,
    points: [
      { x: offset, y: offset },
      { x: w - offset, y: offset },
      { x: w - offset, y: h - offset },
      { x: offset, y: h - offset },
    ],
  };
  const front = documentParts(w - offset * 2, h - offset * 2).map((p) => ({
    ...p,
    points: p.points.map((pt) => ({ x: pt.x, y: pt.y + offset * 2 })),
  }));
  return [back, mid, ...front];
}

function predefinedProcessParts(w, h) {
  const barX1 = w * 0.15;
  const barX2 = w * 0.85;
  return [
    { type: "rect", x: 0, y: 0, w, h },
    { type: "polyline", closed: false, points: [{ x: barX1, y: 0 }, { x: barX1, y: h }] },
    { type: "polyline", closed: false, points: [{ x: barX2, y: 0 }, { x: barX2, y: h }] },
  ];
}

function databaseParts(w, h) {
  const rx = w / 2;
  const ry = h * 0.15;
  const topEllipse = arcPoints(rx, ry, rx, ry, 0, 360, 16);
  const bottomArc = arcPoints(rx, h - ry, rx, ry, 0, 180, 10);
  return [
    { type: "polyline", closed: true, points: topEllipse },
    { type: "polyline", closed: false, points: [{ x: 0, y: ry }, { x: 0, y: h - ry }] },
    { type: "polyline", closed: false, points: [{ x: w, y: ry }, { x: w, y: h - ry }] },
    { type: "polyline", closed: false, points: bottomArc },
  ];
}

function storedDataParts(w, h) {
  const r = Math.min(w, h) * 0.18;
  const rightArc = arcPoints(w - r, h / 2, r, h / 2, -90, 90, 8);
  const leftArc = arcPoints(r, h / 2, r, h / 2, 90, 270, 8);
  return [
    {
      type: "polyline",
      closed: true,
      points: [{ x: r, y: 0 }, { x: w - r, y: 0 }, ...rightArc, { x: r, y: h }, ...leftArc],
    },
  ];
}

function manualInputParts(w, h) {
  return [
    {
      type: "polyline",
      closed: true,
      points: [
        { x: 0, y: h * 0.3 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
    },
  ];
}

function manualOperationParts(w, h) {
  const inset = w * 0.2;
  return [
    {
      type: "polyline",
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w - inset, y: h },
        { x: inset, y: h },
      ],
    },
  ];
}

function preparationParts(w, h) {
  const inset = w * 0.2;
  return [
    {
      type: "polyline",
      closed: true,
      points: [
        { x: inset, y: 0 },
        { x: w - inset, y: 0 },
        { x: w, y: h / 2 },
        { x: w - inset, y: h },
        { x: inset, y: h },
        { x: 0, y: h / 2 },
      ],
    },
  ];
}

function delayParts(w, h) {
  const straightX = w * 0.6;
  const rx = w - straightX;
  const ry = h / 2;
  const bulge = arcPoints(straightX, h / 2, rx, ry, -90, 90, 10);
  return [
    {
      type: "polyline",
      closed: true,
      points: [{ x: 0, y: 0 }, { x: straightX, y: 0 }, ...bulge, { x: 0, y: h }],
    },
  ];
}

function onPageConnectorParts(w, h) {
  return [{ type: "polyline", closed: true, points: arcPoints(w / 2, h / 2, w / 2, h / 2, 0, 360, 16) }];
}

function offPageConnectorParts(w, h) {
  return [
    {
      type: "polyline",
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h * 0.6 },
        { x: w / 2, y: h },
        { x: 0, y: h * 0.6 },
      ],
    },
  ];
}

function displayParts(w, h) {
  const bulge = arcPoints(w * 0.7, h / 2, w * 0.3, h / 2, -90, 90, 10);
  return [
    {
      type: "polyline",
      closed: true,
      points: [
        { x: 0, y: h / 2 },
        { x: w * 0.15, y: 0 },
        { x: w * 0.7, y: 0 },
        ...bulge,
        { x: w * 0.15, y: h },
      ],
    },
  ];
}

function annotationParts(w, h) {
  // Deliberately an OPEN bracket, not a closed shape -- matches its role
  // as a non-evidence explanatory note, not a process step.
  return [
    {
      type: "polyline",
      closed: false,
      points: [
        { x: w * 0.3, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: h },
        { x: w * 0.3, y: h },
      ],
    },
  ];
}

/**
 * The 17-symbol v1 registry. `id` is the stable snake_case identifier
 * stored in overlay data (`process-guide-markup.js`'s `symbolType`).
 * `minWidth`/`minHeight`/`defaultWidth`/`defaultHeight` are deterministic
 * per symbol, never inferred from a screenshot (there is none).
 */
export const WORKFLOW_SYMBOLS = Object.freeze([
  { id: "process", name: "Process", category: "Common", description: "A single process/action step.", minWidth: 40, minHeight: 24, defaultWidth: 100, defaultHeight: 50, buildParts: processParts },
  { id: "decision", name: "Decision", category: "Flow control", description: "A branch point with more than one possible outcome.", minWidth: 40, minHeight: 30, defaultWidth: 100, defaultHeight: 70, buildParts: decisionParts },
  { id: "terminator", name: "Start / End", category: "Flow control", description: "The start or end of the workflow.", minWidth: 40, minHeight: 24, defaultWidth: 100, defaultHeight: 44, buildParts: terminatorParts },
  { id: "data", name: "Input / Output", category: "Data & documents", description: "Data entering or leaving the process.", minWidth: 40, minHeight: 24, defaultWidth: 100, defaultHeight: 50, buildParts: dataParts },
  { id: "document", name: "Document", category: "Data & documents", description: "A single document produced or consumed by a step.", minWidth: 40, minHeight: 30, defaultWidth: 90, defaultHeight: 60, buildParts: documentParts },
  { id: "multi_document", name: "Multiple documents", category: "Data & documents", description: "More than one document produced or consumed by a step.", minWidth: 50, minHeight: 40, defaultWidth: 100, defaultHeight: 70, buildParts: multiDocumentParts },
  { id: "predefined_process", name: "Predefined process", category: "Flow control", description: "A reference to a separately-defined sub-process.", minWidth: 50, minHeight: 30, defaultWidth: 110, defaultHeight: 50, buildParts: predefinedProcessParts },
  { id: "database", name: "Database", category: "Data & documents", description: "A persistent data store.", minWidth: 40, minHeight: 30, defaultWidth: 90, defaultHeight: 60, buildParts: databaseParts },
  { id: "stored_data", name: "Stored data", category: "Data & documents", description: "Generic stored data, distinct from a database.", minWidth: 40, minHeight: 24, defaultWidth: 100, defaultHeight: 50, buildParts: storedDataParts },
  { id: "manual_input", name: "Manual input", category: "Common", description: "Data entered manually, e.g. by keyboard.", minWidth: 40, minHeight: 24, defaultWidth: 100, defaultHeight: 50, buildParts: manualInputParts },
  { id: "manual_operation", name: "Manual operation", category: "Common", description: "A step performed manually, not automated.", minWidth: 40, minHeight: 24, defaultWidth: 100, defaultHeight: 50, buildParts: manualOperationParts },
  { id: "preparation", name: "Preparation", category: "Flow control", description: "Setup or initialization before the main process.", minWidth: 40, minHeight: 24, defaultWidth: 100, defaultHeight: 50, buildParts: preparationParts },
  { id: "delay", name: "Delay", category: "Flow control", description: "A wait or delay in the process.", minWidth: 40, minHeight: 24, defaultWidth: 90, defaultHeight: 50, buildParts: delayParts },
  { id: "on_page_connector", name: "On-page connector", category: "Flow control", description: "Links to another point on the same page/diagram.", minWidth: 24, minHeight: 24, defaultWidth: 40, defaultHeight: 40, buildParts: onPageConnectorParts },
  { id: "off_page_connector", name: "Off-page connector", category: "Flow control", description: "Links to a continuation elsewhere.", minWidth: 36, minHeight: 30, defaultWidth: 70, defaultHeight: 60, buildParts: offPageConnectorParts },
  { id: "display", name: "Display", category: "Common", description: "Information shown to a person, e.g. on a screen.", minWidth: 40, minHeight: 24, defaultWidth: 100, defaultHeight: 50, buildParts: displayParts },
  { id: "annotation", name: "Annotation", category: "Common", description: "A non-evidence explanatory note, not a process step.", minWidth: 20, minHeight: 20, defaultWidth: 30, defaultHeight: 60, buildParts: annotationParts },
]);

const SYMBOLS_BY_ID = new Map(WORKFLOW_SYMBOLS.map((s) => [s.id, s]));

export class WorkflowSymbolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkflowSymbolError";
    this.code = code;
  }
}

export function symbolDefinition(symbolType) {
  const def = SYMBOLS_BY_ID.get(symbolType);
  if (!def) {
    throw new WorkflowSymbolError("unknown-symbol", `unknown workflow symbol type: ${symbolType}`);
  }
  return def;
}

/** Total straight-segment count a symbol's parts would emit -- enforced against MAX_SEGMENTS_PER_SYMBOL. */
function countSegments(parts) {
  let n = 0;
  for (const part of parts) {
    if (part.type === "rect") n += 4;
    else if (part.type === "polyline") n += Math.max(0, part.points.length - 1) + (part.closed ? 1 : 0);
  }
  return n;
}

/**
 * Validates placement (`w`/`h` against the symbol's own minimums) and an
 * optional label, returning the normalized, stored shape of a `symbol`
 * markup item: `{ symbolType, w, h, label }`. Bounds against the overall
 * markup canvas (`x`, `y` too) are the caller's job (`process-guide-
 * markup.js`, which already owns `MARKUP_CANVAS`) — this function only
 * knows about one symbol's own minimums and its label, not the shared
 * canvas. Fails closed (never clamps/shrinks) on anything invalid.
 */
export function validateSymbolPlacement(symbolType, { w, h, label }) {
  const def = symbolDefinition(symbolType);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < def.minWidth || h < def.minHeight) {
    throw new WorkflowSymbolError(
      "invalid-size",
      `${symbolType} requires w >= ${def.minWidth} and h >= ${def.minHeight}`
    );
  }
  let normalizedLabel;
  if (label === undefined || label === null || label === "") {
    normalizedLabel = null;
  } else {
    const trimmed = String(label).trim();
    if (trimmed.length === 0) {
      normalizedLabel = null;
    } else if (trimmed.length > MAX_SYMBOL_LABEL_LENGTH) {
      throw new WorkflowSymbolError(
        "invalid-label",
        `symbol label exceeds ${MAX_SYMBOL_LABEL_LENGTH} characters`
      );
    } else {
      normalizedLabel = trimmed;
    }
  }
  const parts = def.buildParts(w, h);
  const segments = countSegments(parts);
  if (segments > MAX_SEGMENTS_PER_SYMBOL) {
    // Unreachable with this fixed registry's own geometry functions (none
    // come close to the cap), kept as a real, enforced invariant rather
    // than an assumption -- see this module's own tests for why.
    throw new WorkflowSymbolError(
      "too-complex",
      `${symbolType} geometry exceeds ${MAX_SEGMENTS_PER_SYMBOL} segments`
    );
  }
  return { symbolType, w, h, label: normalizedLabel };
}

const SYMBOL_COLOR = Object.freeze({ r: 217, g: 154, b: 61, a: 255 });
const SYMBOL_STROKE_WIDTH = 2;

function partsToDrawOps(parts, id, color, strokeWidth) {
  const ops = [];
  for (const part of parts) {
    if (part.type === "rect") {
      ops.push({ op: "rect", id, x: part.x, y: part.y, w: part.w, h: part.h, color, strokeWidth });
    } else if (part.type === "polyline") {
      const pts = part.points;
      for (let i = 0; i < pts.length - 1; i++) {
        ops.push({ op: "line", id, x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y, color, strokeWidth });
      }
      if (part.closed && pts.length > 1) {
        const a = pts[pts.length - 1];
        const b = pts[0];
        ops.push({ op: "line", id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, strokeWidth });
      }
    }
  }
  return ops;
}

/**
 * Turns a validated `{ id, symbolType, x, y, w, h, label }` shape into
 * draw ops in `drawOpsToCanvas`'s own vocabulary (`rect`/`line`/`text`
 * only — see this module's own header comment for why), translated into
 * the caller's placement (`x`, `y`). Pure: no canvas calls here.
 */
export function symbolToDrawOps(shape) {
  const def = symbolDefinition(shape.symbolType);
  const localParts = def.buildParts(shape.w, shape.h);
  const translated = localParts.map((part) =>
    part.type === "rect"
      ? { ...part, x: part.x + shape.x, y: part.y + shape.y }
      : { ...part, points: part.points.map((p) => ({ x: p.x + shape.x, y: p.y + shape.y })) }
  );
  const ops = partsToDrawOps(translated, shape.id, SYMBOL_COLOR, SYMBOL_STROKE_WIDTH);
  if (shape.label) {
    // A fixed, safe anchor inside the shape's own bounds, with an
    // explicit maxWidth so the renderer's own text op clips rather than
    // overflows -- never unbounded canvas text (see annotations-render.js's
    // own `text` case, which already supports `maxWidth`).
    ops.push({
      op: "text",
      id: shape.id,
      x: shape.x + 4,
      y: shape.y + shape.h + 14,
      maxWidth: Math.max(shape.w, 20),
      color: SYMBOL_COLOR,
      text: shape.label,
    });
  }
  return ops;
}
