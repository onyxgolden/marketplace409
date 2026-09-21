/**
 * Conservative semantic classification for VSDX import.
 *
 * Only shapes with STRONG evidence become walls, rooms, openings, pipes,
 * symbols, or furniture. Everything else becomes a generic annotation path
 * or label — never a silently-misrepresented semantic element.
 *
 * Hard rules (never violated):
 * - A 1-D connector alone is NOT a pipe (flowchart/network connectors are
 *   annotations). Only connectors with plumbing/service evidence become pipes.
 * - A rectangle alone is NOT a room. Rooms need architectural room evidence
 *   AND a closed outline.
 * - A long line alone is NOT a wall. Walls need wall evidence AND a
 *   line-like shape.
 * - Unknown geometry is never silently skipped: it becomes an annotation.
 *
 * Input features per shape (built by the orchestrator):
 *   { polylines: [{ points, closed, allLines }], text, isOneD,
 *     hasRasterImage, evidence: { masterNameU, masterName, shapeNameU } }
 * Output: { kind, reason, detail } where kind ∈
 *   wall | room | opening | pipe | symbol | furniture | annotation | label | skipped
 */

const EVIDENCE = (f) =>
  [f.masterNameU, f.masterName, f.shapeNameU, f.text].filter(Boolean).join(" \n ");

const has = (f, re) => re.test(EVIDENCE(f));

const WALL_RE = /wall/i;
const ROOM_RE = /\broom\b|\bspace\b|\barea\b|floor plan/i;
const DOOR_RE = /\bdoor\b/i;
const WINDOW_RE = /\bwindow\b/i;
const PLUMBING_RE = /pipe|plumb|\bwater\b|\bdrain\b|\bvent\b|\bhvac\b|\bgas line\b|\bsewer\b/i;
const TEXT_HEAVY_RE = /\S/;

/** Visio master keyword → furniture catalogId, most-specific first. */
const FURNITURE_KEYWORDS = [
  [/recliner/i, "recliner"],
  [/office chair/i, "office-chair"],
  [/dining chair/i, "dining-chair"],
  [/armchair/i, "armchair"],
  [/loveseat/i, "loveseat"],
  [/sofa|couch/i, "sofa-3seat"],
  [/coffee table/i, "coffee-table"],
  [/side table/i, "side-table"],
  [/dining table/i, "dining-table-rect"],
  [/kitchen island/i, "kitchen-island"],
  [/\bdesk\b/i, "desk"],
  [/king bed|\bking\b/i, "bed-king"],
  [/queen bed/i, "bed-queen"],
  [/twin bed/i, "bed-twin"],
  [/\bbed\b/i, "bed-full"],
  [/nightstand/i, "nightstand"],
  [/dresser/i, "dresser"],
  [/refrigerator|fridge/i, "refrigerator"],
  [/range|\bstove\b/i, "range"],
  [/dishwasher/i, "dishwasher"],
  [/pantry/i, "cabinet-pantry-24"],
  [/sink base/i, "cabinet-sink-36"],
  [/base cabinet/i, "cabinet-base-24"],
  [/wall cabinet/i, "cabinet-wall-24"],
  [/cabinet/i, "cabinet-base-24"],
  [/kitchen sink/i, "sink-kitchen-33"],
  [/toilet/i, "toilet"],
  [/vanity/i, "vanity-single"],
  [/bathtub|\btub\b/i, "bathtub"],
  [/shower/i, "shower"],
  [/pedestal sink/i, "sink-pedestal"],
  [/\bsink\b/i, "sink-bath-round"],
  [/washer/i, "washer"],
  [/dryer/i, "dryer"],
  [/water heater/i, "water-heater"],
  [/utility sink/i, "utility-sink"],
  [/bookshelf|bookcase/i, "bookshelf"],
  [/tv stand/i, "tv-stand"],
  [/wardrobe/i, "wardrobe"],
  [/floor lamp/i, "floor-lamp"],
  [/table lamp/i, "table-lamp"],
];

/** Visio master keyword → [domain, symbolId] for recognized stencils. */
const SYMBOL_KEYWORDS = [
  [/gate valve/i, ["piping", "gate-valve"]],
  [/ball valve/i, ["piping", "ball-valve"]],
  [/check valve/i, ["piping", "check-valve"]],
  [/\bvalve\b/i, ["piping", "gate-valve"]],
  [/\bpump\b/i, ["piping", "pump"]],
  [/\btank\b|\bvessel\b/i, ["piping", "tank"]],
  [/\belbow\b/i, ["piping", "elbow"]],
  [/\btee\b/i, ["piping", "tee"]],
  [/reducer/i, ["piping", "reducer"]],
  [/flow arrow/i, ["piping", "flow-arrow"]],
  [/equipment tag/i, ["piping", "equipment-tag"]],
];

function matchFurniture(f) {
  const text = EVIDENCE(f);
  for (const [re, catalogId] of FURNITURE_KEYWORDS) {
    if (re.test(text)) return catalogId;
  }
  return null;
}

function matchSymbol(f) {
  const text = EVIDENCE(f);
  for (const [re, target] of SYMBOL_KEYWORDS) {
    if (re.test(text)) return { domain: target[0], symbolId: target[1] };
  }
  return null;
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** The longest straight run: for walls, the representative wall segment. */
function longestEdge(points, closed) {
  const n = closed ? points.length : points.length - 1;
  let best = null;
  let bestLen = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) {
      bestLen = len;
      best = { a: { ...a }, b: { ...b }, length: len };
    }
  }
  return best;
}

/**
 * Classify one resolved shape. Features carry precomputed geometry in
 * Designer inches.
 */
export function classifyShape(shape, features) {
  const f = features;
  const base = { evidence: EVIDENCE(f) };

  if (f.hasRasterImage) {
    return { kind: "skipped", reason: "Raster image — not imported in V1.", ...base };
  }
  if (f.polylines.length === 0) {
    if (TEXT_HEAVY_RE.test(f.text || "")) {
      return { kind: "label", reason: "Text-only shape.", ...base };
    }
    return { kind: "skipped", reason: "Shape has no importable geometry.", ...base };
  }

  // Representative polyline: the one with the most points.
  const main = [...f.polylines].sort((a, b) => b.points.length - a.points.length)[0];
  const pts = main.points;
  const closed = main.closed;
  const bounds = boundsOf(pts);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  // 1-D connectors: only plumbing evidence earns a pipe.
  if (f.isOneD) {
    if (has(f, PLUMBING_RE) && !closed) {
      return {
        kind: "pipe",
        reason: "1-D connector with plumbing/service evidence.",
        detail: { service: "plumbing" },
        ...base,
      };
    }
    return {
      kind: "annotation",
      reason: "1-D connector without plumbing evidence — kept as an annotation, not a pipe.",
      ...base,
    };
  }

  // Walls: wall evidence AND a line-like shape.
  if (has(f, WALL_RE)) {
    if (!closed && pts.length === 2) {
      return {
        kind: "wall",
        reason: "Wall master with a straight segment.",
        detail: { a: { ...pts[0] }, b: { ...pts[1] } },
        ...base,
      };
    }
    if (closed && main.allLines && pts.length <= 6) {
      const longSide = Math.max(width, height);
      const shortSide = Math.min(width, height);
      if (shortSide > 0 && longSide / shortSide >= 6) {
        const edge = longestEdge(pts, true);
        return {
          kind: "wall",
          reason: "Wall master drawn as a long thin rectangle — mapped to its centerline segment.",
          detail: { a: edge.a, b: edge.b, approximated: "thin-rectangle-centerline" },
          ...base,
        };
      }
    }
  }

  // Doors/windows: opening when safely resolvable (width from bounds).
  if (has(f, DOOR_RE) || has(f, WINDOW_RE)) {
    const openingType = has(f, DOOR_RE) ? "door" : "window";
    const span = Math.max(width, height);
    if (span >= 6) {
      return {
        kind: "opening",
        reason: `${openingType} master — placed on the nearest wall when one resolves.`,
        detail: {
          openingType,
          widthIn: Math.min(span, 96),
          center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
        },
        ...base,
      };
    }
    return { kind: "annotation", reason: `${openingType} master too small to resolve — kept as annotation.`, ...base };
  }

  // Rooms: architectural room evidence AND a closed outline AND real area.
  if (has(f, ROOM_RE) && closed && pts.length >= 3) {
    const area = polygonArea(pts);
    if (area >= 1) {
      return {
        kind: "room",
        reason: "Closed architectural room shape.",
        detail: { polygon: pts.map((p) => ({ ...p })), label: (f.text || f.shapeNameU || "Room").slice(0, 80) },
        ...base,
      };
    }
  }

  // Plumbing runs drawn as 2-D shapes with an open centerline.
  if (has(f, PLUMBING_RE) && !closed && pts.length >= 2) {
    return {
      kind: "pipe",
      reason: "Plumbing/service evidence with an open run.",
      detail: { service: "plumbing" },
      ...base,
    };
  }

  // Recognized stencils → symbols.
  const symbol = matchSymbol(f);
  if (symbol) {
    return {
      kind: "symbol",
      reason: `Recognized stencil → ${symbol.domain}/${symbol.symbolId}.`,
      detail: { ...symbol, x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
      ...base,
    };
  }

  // Known furniture masters → furniture.
  const catalogId = matchFurniture(f);
  if (catalogId) {
    return {
      kind: "furniture",
      reason: `Furniture master → catalog '${catalogId}'.`,
      detail: {
        catalogId,
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      },
      ...base,
    };
  }

  // Everything else is an annotation path (or label when text-only handled above).
  if (f.text && TEXT_HEAVY_RE.test(f.text)) {
    return {
      kind: "annotation",
      reason: "Unrecognized shape with text — kept as an annotation path with its label.",
      ...base,
    };
  }
  return { kind: "annotation", reason: "Unrecognized geometry — kept as an annotation path.", ...base };
}
