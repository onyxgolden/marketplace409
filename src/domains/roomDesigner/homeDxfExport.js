// Fully client-side DXF export for FORGE Home Designer (slice 6).
//
// Pure ASCII DXF generation from canonical HomeProject geometry — the same
// geometry that renders the plan and feeds slices 3–5. Geometry -> DXF
// text; nothing here touches the network, the DOM, persistence, or any
// third-party library. Binary DWG is out of scope by design: DXF is the
// documented CAD interchange path.
//
// Coordinate contract (locked by the slice-6 architecture review):
//   X = east / right, Y = north / up, Z = elevation (unused — 2D export).
// The browser canvas is Y-down; planToDxf flips plan Y to CAD Y-up exactly
// once, inside dxfPt. No other transform touches Y.
//
// Format contract (locked by the review):
// - Header $ACADVER = AC1014 (R14) with $INSUNITS = 1 (inches, the
//   designer's canonical unit) and $MEASUREMENT = 0 (imperial).
// - Entity vocabulary is the conservative R14 subset: LWPOLYLINE, LINE,
//   ARC, TEXT only. No R14-only behavior, no DIMENSION entities in v1.
// - Sections: HEADER, TABLES, BLOCKS, ENTITIES, EOF. BLOCKS is empty in
//   slice 6 — it exists now so doors/windows can become BLOCK/INSERT
//   symbols later without a format break.
// - Layers follow AIA discipline-first naming with a zero-padded level
//   tag: A-L01-WALL, A-L01-DOOR, A-L01-WIND, A-L01-ROOM, A-L01-DIMS.
// - V1 dimensions are REFERENCE geometry only: witness lines + dimension
//   line + arrow ticks + TEXT value. They are not associative DIMENSION
//   entities and are never presented as such.
//
// Hard rules (same discipline as slices 3–5):
// - Never pixels. Never invented dimensions. The wall-thickness default is
//   documented and surfaced in `assumptions`; the door-swing default
//   (hinge at the opening's start edge, leaf on the +normal face, 90-degree
//   swing) is documented because hinge side is not stored in geometry.
// - Elevations are NOT exported in slice 6: plan export is the acceptance
//   bar. Passing includeElevations: true fails closed with a clear error.
// - Export never mutates the project: every operation is pure.
// - The boundary never throws: planToDxf returns { ok: false, error } on
//   corrupt input so the screen can surface a status message.
//
// DXF_CONFIG pins the one review-adjustable surface (format version,
// units, text sizes, dimension offsets) in a single spot so a later review
// pass can change it without touching entity code.

import { validateHomeProject } from "./homeProject";
import { clampOpening } from "./designerGeometry";

/**
 * Review-adjustable export configuration. DXF version and unit choices live
 * here so a later review pass can change them in one place.
 */
export const DXF_CONFIG = Object.freeze({
  acadVersion: "AC1014", // R14 header; entity vocabulary stays conservative
  versionLabel: "R14",
  insUnits: 1, // inches — the designer's canonical geometry unit
  measurement: 0, // 0 = imperial
  coordinatePrecision: 4,
  defaultWallThicknessIn: 4.5,
  roomLabelHeightIn: 12,
  dimTextHeightIn: 10,
  dimOffsetIn: 24,
  dimTickIn: 6,
});

/** Tokens that must never appear in serialized DXF output. */
export const BAD_DXF_TOKEN_RE = /\b(NaN|-?Infinity|undefined)\b/;

/** Parser guard: returns every forbidden token found in a DXF string. */
export function findBadDxfTokens(dxf) {
  const text = String(dxf ?? "");
  const found = [];
  let m;
  const re = new RegExp(BAD_DXF_TOKEN_RE.source, "g");
  while ((m = re.exec(text)) !== null) found.push(m[0]);
  return found;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Round to the configured precision; non-finite input becomes 0. */
function roundCoord(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** DXF_CONFIG.coordinatePrecision;
  return Math.round(v * factor) / factor;
}

/** Minimal DXF number text: rounded, no trailing zeros, never "-0". */
function num(value) {
  const r = roundCoord(value);
  return Object.is(r, -0) ? "0" : String(r);
}

/**
 * TEXT safety: DXF group-1 strings must not contain control characters
 * (a raw newline would split the code/value pairing and corrupt the file).
 */
export function sanitizeDxfText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, 200);
}

/** Download filename: "<project>-YYYYMMDD.dxf", filesystem-safe. */
export function dxfFileName(projectName, when) {
  const safe =
    String(projectName || "design")
      .replace(/[\\/:*?"<>|]/g, "-")
      .trim()
      .slice(0, 80) || "design";
  const d = when instanceof Date ? when : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${safe}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.dxf`;
}

/** Reference-dimension label, e.g. 120" -> 10'-0". */
export function dimLabel(inches) {
  const v = Number(inches);
  if (!Number.isFinite(v)) return "0'-0\"";
  const rounded = Math.round(Math.abs(v));
  const sign = v < 0 ? "-" : "";
  return `${sign}${Math.floor(rounded / 12)}'-${rounded % 12}"`;
}

// ---------------------------------------------------------------------------
// Entity emitters — each returns an array of [groupCode, value] pairs.
// Conservative vocabulary only: LWPOLYLINE, LINE, ARC, TEXT.
// ---------------------------------------------------------------------------

function emitLine(layer, x1, y1, x2, y2) {
  return [
    ["0", "LINE"],
    ["8", layer],
    ["10", num(x1)],
    ["20", num(y1)],
    ["11", num(x2)],
    ["21", num(y2)],
  ];
}

function emitLwpolyline(layer, points, closed = false) {
  const pairs = [
    ["0", "LWPOLYLINE"],
    ["8", layer],
    ["90", String(points.length)],
    ["70", closed ? "1" : "0"],
  ];
  for (const [x, y] of points) {
    pairs.push(["10", num(x)], ["20", num(y)]);
  }
  return pairs;
}

function emitArc(layer, cx, cy, radius, startDeg, endDeg) {
  return [
    ["0", "ARC"],
    ["8", layer],
    ["10", num(cx)],
    ["20", num(cy)],
    ["40", num(radius)],
    ["50", num(startDeg)],
    ["51", num(endDeg)],
  ];
}

function emitText(layer, x, y, height, value, rotationDeg = 0, centered = false) {
  const pairs = [
    ["0", "TEXT"],
    ["8", layer],
    ["10", num(x)],
    ["20", num(y)],
    ["40", num(height)],
    ["1", sanitizeDxfText(value)],
  ];
  if (rotationDeg !== 0) pairs.push(["50", num(rotationDeg)]);
  if (centered) {
    // Middle-center alignment: 72/73 + alignment point (11/21).
    pairs.push(["72", "1"], ["73", "2"], ["11", num(x)], ["21", num(y)]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Plan geometry helpers (plan space: inches, y-down; flipped to y-up at emit).
// ---------------------------------------------------------------------------

function wallSpan(wall) {
  if (!wall || !wall.a || !wall.b) return null;
  const ax = Number(wall.a.x);
  const ay = Number(wall.a.y);
  const bx = Number(wall.b.x);
  const by = Number(wall.b.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  return { ax, ay, bx, by, dir: { x: dx / length, y: dy / length }, length };
}

function wallThicknessOf(design, assumptions) {
  const settings = (design && design.settings) || {};
  const t = Number(settings.wallThicknessIn);
  if (t > 0) return t;
  assumptions.add(
    `Default wall thickness ${DXF_CONFIG.defaultWallThicknessIn} in (not set in design)`,
  );
  return DXF_CONFIG.defaultWallThicknessIn;
}

/** Shoelace centroid; falls back to the point average for degenerate rings. */
function polygonCentroid(polygon) {
  const pts = (polygon || []).filter(
    (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)),
  );
  if (pts.length === 0) return null;
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    twiceArea += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (twiceArea !== 0) {
    return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
  }
  const n = pts.length;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** AIA discipline-first layers; the tag is the 1-based project level order. */
function levelLayerNames(levelNumber) {
  const tag = `L${String(levelNumber).padStart(2, "0")}`;
  return Object.freeze({
    wall: `A-${tag}-WALL`,
    door: `A-${tag}-DOOR`,
    window: `A-${tag}-WIND`,
    room: `A-${tag}-ROOM`,
    dims: `A-${tag}-DIMS`,
  });
}

function at(span, along, across) {
  // Point at `along` inches from wall.a along the wall, `across` inches
  // along the left-hand normal. Plan space (y-down).
  const nx = span.dir.y;
  const ny = -span.dir.x;
  return {
    x: span.ax + span.dir.x * along + nx * across,
    y: span.ay + span.dir.y * along + ny * across,
  };
}

/**
 * Plan point -> DXF point. The single Y-flip in the exporter: canvas
 * Y-down becomes CAD Y-up (X = east/right unchanged).
 */
function dxfPt(p) {
  return [p.x, -p.y];
}

/**
 * Door swing symbol in DXF coordinates (y-up).
 *
 * hinge: "start" = the opening's offset edge (geometry default),
 *        "end"   = the opening's far edge.
 * face:  "positive" = leaf on the +normal face (geometry default),
 *        "negative" = leaf on the -normal face.
 *
 * Hinge side is not stored in designer geometry; planToDxf always uses the
 * documented defaults (start/positive). The arc angles are normalized to the
 * counter-clockwise convention: endDeg - startDeg is always exactly 90.
 */
export function doorSwingDxf({
  hingeX,
  hingeY,
  leafAngleDxfDeg,
  widthIn,
  hinge = "start",
  face = "positive",
} = {}) {
  if (
    ![hingeX, hingeY, leafAngleDxfDeg, widthIn].every(isFiniteNumber) ||
    !(widthIn > 0)
  ) {
    throw new Error("doorSwingDxf needs finite hinge, angle, and a positive width.");
  }
  if (hinge !== "start" && hinge !== "end") {
    throw new Error('hinge must be "start" or "end".');
  }
  if (face !== "positive" && face !== "negative") {
    throw new Error('face must be "positive" or "negative".');
  }
  // The leaf direction already encodes hinge choice: callers pass the leaf
  // angle pointing away from the hinge (start hinge -> +wall direction,
  // end hinge -> -wall direction), so the leaf always covers the opening
  // when closed.
  const rad = (leafAngleDxfDeg * Math.PI) / 180;
  const leafEnd = [hingeX + Math.cos(rad) * widthIn, hingeY + Math.sin(rad) * widthIn];
  const [startDeg, endDeg] =
    face === "negative"
      ? [leafAngleDxfDeg - 90, leafAngleDxfDeg]
      : [leafAngleDxfDeg, leafAngleDxfDeg + 90];
  return {
    leaf: [
      [hingeX, hingeY],
      leafEnd,
    ],
    arc: { cx: hingeX, cy: hingeY, radius: widthIn, startDeg, endDeg },
  };
}

// ---------------------------------------------------------------------------
// DXF section writers.
// ---------------------------------------------------------------------------

function headerSection() {
  const pairs = [["0", "SECTION"], ["2", "HEADER"]];
  const vars = [
    ["$ACADVER", "1", DXF_CONFIG.acadVersion],
    ["$INSUNITS", "70", String(DXF_CONFIG.insUnits)],
    ["$MEASUREMENT", "70", String(DXF_CONFIG.measurement)],
  ];
  for (const [name, code, value] of vars) {
    pairs.push(["9", name], [code, value]);
  }
  pairs.push(["0", "ENDSEC"]);
  return pairs;
}

function tablesSection(layerNames) {
  const pairs = [
    ["0", "SECTION"],
    ["2", "TABLES"],
    ["0", "TABLE"],
    ["2", "LAYER"],
    ["70", String(layerNames.length)],
  ];
  for (const name of layerNames) {
    pairs.push(
      ["0", "LAYER"],
      ["2", name],
      ["70", "0"],
      ["62", "7"],
      ["6", "Continuous"],
    );
  }
  pairs.push(["0", "ENDTAB"], ["0", "ENDSEC"]);
  return pairs;
}

/**
 * Minimal BLOCKS section. Empty in slice 6 — it exists so a future slice
 * can promote doors/windows to BLOCK/INSERT symbols without a format break.
 */
function blocksSection() {
  return [
    ["0", "SECTION"],
    ["2", "BLOCKS"],
    ["0", "ENDSEC"],
  ];
}

// ---------------------------------------------------------------------------
// Plan entities for one level.
// ---------------------------------------------------------------------------

function exportLevelPlan(design, layers, ctx) {
  const { assumptions } = ctx;
  const thickness = wallThicknessOf(design, assumptions);
  const half = thickness / 2;
  const walls = Array.isArray(design.walls) ? design.walls : [];
  const openings = Array.isArray(design.openings) ? design.openings : [];
  const rooms = Array.isArray(design.rooms) ? design.rooms : [];

  const wallById = new Map();
  for (const wall of walls) {
    const span = wallSpan(wall);
    if (span) wallById.set(wall.id, span);
  }

  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const track = (p) => {
    bbox.minX = Math.min(bbox.minX, p.x);
    bbox.minY = Math.min(bbox.minY, p.y);
    bbox.maxX = Math.max(bbox.maxX, p.x);
    bbox.maxY = Math.max(bbox.maxY, p.y);
  };

  for (const wall of walls) {
    const span = wallById.get(wall.id);
    if (!span) continue;
    track({ x: span.ax, y: span.ay });
    track({ x: span.bx, y: span.by });

    const wallOpenings = openings
      .filter((o) => o.wallId === wall.id)
      .map((o) => {
        try {
          // Same clamp the editor applies, so the DXF gap matches the canvas.
          const clamped = clampOpening(
            wall,
            o.type === "door" ? "door" : "window",
            Number(o.offsetIn) || 0,
            Number(o.widthIn) || 0,
          );
          return {
            type: o.type === "door" ? "door" : "window",
            offsetIn: clamped.offsetIn,
            widthIn: clamped.widthIn,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.offsetIn - b.offsetIn);

    // Openings are SUBTRACTED from the wall: faces emit as segments around
    // the gaps. A wall is never drawn whole underneath opening linework —
    // no overlapping geometry.
    const gaps = wallOpenings.map((o) => [o.offsetIn, o.offsetIn + o.widthIn]);
    let cursor = 0;
    const segments = [];
    for (const [g0, g1] of gaps) {
      if (g0 > cursor) segments.push([cursor, g0]);
      cursor = Math.max(cursor, g1);
    }
    if (cursor < span.length) segments.push([cursor, span.length]);

    for (const face of [half, -half]) {
      ctx.use(layers.wall);
      for (const [s0, s1] of segments) {
        const [p0x, p0y] = dxfPt(at(span, s0, face));
        const [p1x, p1y] = dxfPt(at(span, s1, face));
        ctx.pairs.push(...emitLwpolyline(layers.wall, [[p0x, p0y], [p1x, p1y]]));
        ctx.entities += 1;
      }
    }

    // Opening geometry: cap lines across the cut ends, then the type symbol.
    for (const opening of wallOpenings) {
      const off = opening.offsetIn;
      const w = opening.widthIn;
      const layer = opening.type === "door" ? layers.door : layers.window;
      ctx.use(layer);
      for (const edge of [off, off + w]) {
        const [c1x, c1y] = dxfPt(at(span, edge, half));
        const [c2x, c2y] = dxfPt(at(span, edge, -half));
        ctx.pairs.push(...emitLine(layer, c1x, c1y, c2x, c2y));
        ctx.entities += 1;
      }
      if (opening.type === "door") {
        // Documented default: hinge at the opening's start edge, leaf on
        // the +normal face, drawn in the closed position with a 90-degree
        // swing arc. Hinge side is not stored in geometry.
        const planAngleDeg = (Math.atan2(span.dir.y, span.dir.x) * 180) / Math.PI;
        const hinge = at(span, off, half);
        const [hx, hy] = dxfPt(hinge);
        const swing = doorSwingDxf({
          hingeX: hx,
          hingeY: hy,
          leafAngleDxfDeg: -planAngleDeg,
          widthIn: w,
          hinge: "start",
          face: "positive",
        });
        const [[lx1, ly1], [lx2, ly2]] = swing.leaf;
        ctx.pairs.push(...emitLine(layer, lx1, ly1, lx2, ly2));
        ctx.entities += 1;
        ctx.pairs.push(
          ...emitArc(layer, swing.arc.cx, swing.arc.cy, swing.arc.radius, swing.arc.startDeg, swing.arc.endDeg),
        );
        ctx.entities += 1;
      } else {
        // Window glass: two parallel lines across the opening, inside the
        // wall sandwich.
        for (const g of [thickness / 6, -thickness / 6]) {
          const [g1x, g1y] = dxfPt(at(span, off, g));
          const [g2x, g2y] = dxfPt(at(span, off + w, g));
          ctx.pairs.push(...emitLine(layer, g1x, g1y, g2x, g2y));
          ctx.entities += 1;
        }
      }
    }
  }

  // Room labels at polygon centroids.
  for (const room of rooms) {
    const c = polygonCentroid(room.polygon);
    if (!c) continue;
    const [cx, cy] = dxfPt(c);
    ctx.use(layers.room);
    ctx.pairs.push(
      ...emitText(layers.room, cx, cy, DXF_CONFIG.roomLabelHeightIn, room.label || "Room", 0, true),
    );
    ctx.entities += 1;
  }

  // Overall dimensions: REFERENCE geometry only — witness lines, a
  // dimension line with arrow ticks, and a TEXT value. No DIMENSION
  // entities exist in slice 6.
  if (bbox.minX !== Infinity) {
    const { dimOffsetIn, dimTickIn, dimTextHeightIn } = DXF_CONFIG;
    ctx.use(layers.dims);
    const width = bbox.maxX - bbox.minX;
    const depth = bbox.maxY - bbox.minY;
    const dimY = bbox.minY - dimOffsetIn; // plan space: above the drawing
    const dimX = bbox.minX - dimOffsetIn; // plan space: left of the drawing

    const arrowTick = (ex, ey, dirX, dirY) => {
      // Arrowhead tick at (ex, ey) pointing along (dirX, dirY): two barbs.
      const a = dimTickIn;
      const b = dimTickIn * 0.5;
      const px = -dirY;
      const py = dirX;
      return [
        ...emitLine(layers.dims, ex, ey, ex + dirX * a + px * b, ey + dirY * a + py * b),
        ...emitLine(layers.dims, ex, ey, ex + dirX * a - px * b, ey + dirY * a - py * b),
      ];
    };

    // Horizontal overall dimension: |<--- 10'-0" --->|
    {
      const [x1, y1] = dxfPt({ x: bbox.minX, y: dimY });
      const [x2, y2] = dxfPt({ x: bbox.maxX, y: dimY });
      ctx.pairs.push(...emitLine(layers.dims, x1, y1, x2, y2));
      ctx.entities += 1;
      for (const ex of [bbox.minX, bbox.maxX]) {
        const [e1x, e1y] = dxfPt({ x: ex, y: bbox.minY });
        const [e2x, e2y] = dxfPt({ x: ex, y: dimY - dimTickIn });
        ctx.pairs.push(...emitLine(layers.dims, e1x, e1y, e2x, e2y));
        ctx.entities += 1;
      }
      const [tx1, ty1] = dxfPt({ x: bbox.minX, y: dimY });
      const [tx2, ty2] = dxfPt({ x: bbox.maxX, y: dimY });
      // Both ends point outward along the dimension line.
      ctx.pairs.push(...arrowTick(tx1, ty1, -1, 0), ...arrowTick(tx2, ty2, 1, 0));
      ctx.entities += 4;
      const [mx, my] = dxfPt({ x: (bbox.minX + bbox.maxX) / 2, y: dimY - dimTextHeightIn - 2 });
      ctx.pairs.push(...emitText(layers.dims, mx, my, dimTextHeightIn, dimLabel(width), 0, true));
      ctx.entities += 1;
    }

    // Vertical overall dimension.
    {
      const [x1, y1] = dxfPt({ x: dimX, y: bbox.minY });
      const [x2, y2] = dxfPt({ x: dimX, y: bbox.maxY });
      ctx.pairs.push(...emitLine(layers.dims, x1, y1, x2, y2));
      ctx.entities += 1;
      for (const ey of [bbox.minY, bbox.maxY]) {
        const [e1x, e1y] = dxfPt({ x: bbox.minX, y: ey });
        const [e2x, e2y] = dxfPt({ x: dimX - dimTickIn, y: ey });
        ctx.pairs.push(...emitLine(layers.dims, e1x, e1y, e2x, e2y));
        ctx.entities += 1;
      }
      const [tx1, ty1] = dxfPt({ x: dimX, y: bbox.minY }); // top end in CAD (y-up)
      const [tx2, ty2] = dxfPt({ x: dimX, y: bbox.maxY }); // bottom end in CAD
      ctx.pairs.push(...arrowTick(tx1, ty1, 0, 1), ...arrowTick(tx2, ty2, 0, -1));
      ctx.entities += 4;
      const [mx, my] = dxfPt({ x: dimX - dimTextHeightIn - 2, y: (bbox.minY + bbox.maxY) / 2 });
      ctx.pairs.push(...emitText(layers.dims, mx, my, dimTextHeightIn, dimLabel(depth), 90, true));
      ctx.entities += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Export a HomeProject to ASCII DXF text. Pure: the project is never
 * mutated. Returns { ok: true, dxf, stats } or { ok: false, error }.
 *
 * options:
 *   levelIds: array of level ids to export (default: all levels)
 *   includeElevations: NOT supported in slice 6 — passing true fails
 *     closed; plan export is the slice-6 acceptance bar.
 */
export function planToDxf(project, options = {}) {
  try {
    const problems = validateHomeProject(project);
    if (problems.length > 0) {
      return { ok: false, error: problems[0] };
    }
    const opts = options && typeof options === "object" ? options : {};
    if (opts.includeElevations === true) {
      return { ok: false, error: "Elevation export is not supported in slice 6 (plan export only)." };
    }

    let levels = project.levels;
    if (opts.levelIds !== undefined) {
      if (!Array.isArray(opts.levelIds)) {
        return { ok: false, error: "levelIds must be an array of level ids." };
      }
      const wanted = new Set(opts.levelIds);
      const unknown = [...wanted].filter((id) => !project.levels.some((l) => l.id === id));
      if (unknown.length > 0) {
        return { ok: false, error: `Unknown level id: ${unknown[0]}.` };
      }
      levels = project.levels.filter((l) => wanted.has(l.id));
    }
    if (levels.length === 0) {
      return { ok: false, error: "No levels selected for export." };
    }

    const layerOrder = [];
    const layerSet = new Set();
    const assumptions = new Set();
    const ctx = {
      pairs: [],
      entities: 0,
      assumptions,
      use(name) {
        if (!layerSet.has(name)) {
          layerSet.add(name);
          layerOrder.push(name);
        }
      },
    };

    for (const level of levels) {
      // Layer numbers follow the project's level order so a subset export
      // keeps stable layer names.
      const levelNumber = project.levels.indexOf(level) + 1;
      exportLevelPlan(level.design, levelLayerNames(levelNumber), ctx);
    }

    const sections = [
      ...headerSection(),
      ...tablesSection(layerOrder),
      ...blocksSection(),
      ["0", "SECTION"],
      ["2", "ENTITIES"],
      ...ctx.pairs,
      ["0", "ENDSEC"],
      ["0", "EOF"],
    ];
    const dxf = sections.map(([code, value]) => `${code}\n${value}`).join("\n") + "\n";

    return {
      ok: true,
      dxf,
      stats: Object.freeze({
        format: `DXF ${DXF_CONFIG.versionLabel}`,
        entityCount: ctx.entities,
        layerCount: layerOrder.length,
        levelCount: levels.length,
        levelIds: Object.freeze(levels.map((l) => l.id)),
        assumptions: Object.freeze([...assumptions]),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "Could not export DXF.",
    };
  }
}
