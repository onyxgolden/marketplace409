// Pure document model for the FORGE room/layout designer.
//
// A design is a plain JSON-serializable object:
//
//   {
//     version: 1,
//     name: "Kitchen remodel",
//     settings: { wallHeightIn, wallThicknessIn, gridIn },
//     walls:    [{ id, a: {x,y}, b: {x,y} }],
//     rooms:    [{ id, label, polygon: [{x,y}, ...] }],   // labeled areas
//     openings: [{ id, wallId, type: "door"|"window", offsetIn, widthIn }],
//     furniture:[{ id, catalogId, x, y, rotationDeg }],
//     sheets:   [{ id, sizeId, orientation, x, y,   // printable paper frames
//                   planWidthIn, planHeightIn, fitScale,
//                   header: { title, subtitle, logo },  // PNG data URL or null
//                   footer: { left, center, right } }],
//     annotations: [{ id, kind: "path"|"label", points: [{x,y},...],  // VSDX import (read-only)
//                     closed?, text?, strokeWidthIn?, source? }],
//   }
//
// Sheet (x, y) is the TOP-LEFT anchor of the frame in plan inches. The plan
// bounds (planWidthIn/planHeightIn) and fitScale are fixed when the sheet is
// placed or its format changes and never recomputed from later content, so
// adding content later cannot silently alter what a sheet prints.
//
// Every operation is pure: it takes a design and returns a new design.
// Coordinates are inches; opening offsets are inches from wall.a.

import { getCatalogEntry, ROOM_TEMPLATES, STRUCTURE_TEMPLATES } from "./furnitureCatalog";
import { findSymbol } from "./symbolRegistry";
// Side-effect import: registers the "piping" symbol set so placeSymbol
// and validateDesign resolve it in every context that loads the document
// model (app, API routes, tests).
import "./pipingCatalog";
import { layoutOrgChart, ORG_CHART_METRICS, wouldCreateCycle } from "./orgChartLayout";
import { PRINT_MARGIN_IN, sheetDimensions } from "./sheetCatalog";
import {
  calibrateUnderlayScale,
  clampOpening,
  clampWallEndpoint,
  DEFAULT_GRID_IN,
  DEFAULT_UNDERLAY_OPACITY,
  DEFAULT_UNDERLAY_WIDTH_IN,
  isFiniteNumber,
  isValidPoint,
  polygonArea,
  snapScalar,
  wallLength,
} from "./designerGeometry";
import {
  dedupeConsecutivePoints,
  PIPE_LAYERS,
} from "./pipingGeometry";

// Re-exported for the catalog UI; the canonical definition lives in
// furnitureCatalog.js, where the "rooms" symbol set is registered.
export { ROOM_TEMPLATES, STRUCTURE_TEMPLATES };

export const DESIGN_VERSION = 1;

export const OPENING_DEFAULTS = Object.freeze({
  door: Object.freeze({ widthIn: 36 }),
  window: Object.freeze({ widthIn: 48 }),
});

let idSequence = 0;
function nextId(prefix) {
  idSequence += 1;
  return `${prefix}_${idSequence}`;
}
/** Test hook: restart id generation so snapshots stay stable. */
export function resetDesignerIds() {
  idSequence = 0;
}

function clonePoint(p) {
  return { x: p.x, y: p.y };
}

export function createEmptyDesign(name = "Untitled design") {
  return {
    version: DESIGN_VERSION,
    name: String(name || "Untitled design"),
    settings: { wallHeightIn: 108, wallThicknessIn: 4.5, gridIn: 6, snapEnabled: true },
    walls: [],
    rooms: [],
    openings: [],
    furniture: [],
    pipes: [], // Phase 2: pipe runs { id, points, diameterIn, material?, service?, layer }
    symbols: [], // Phase 2: placed symbols { id, domain, symbolId, x, y, rotationDeg, layer, tag? }
    orgCharts: [], // Phase 3: people org charts { id, name, x, y, nodes }
    underlay: null, // background trace-over image; see setUnderlay
    sheets: [], // printable paper frames; see addSheet
    annotations: [], // VSDX import: read-only generic paths/labels { id, kind: "path"|"label", points, closed?, text?, strokeWidthIn?, source? }
  };
}

function assertDesign(design) {
  if (!design || design.version !== DESIGN_VERSION || !Array.isArray(design.walls)) {
    throw new Error("Not a room-designer document (bad version or shape).");
  }
}

export function renameDesign(design, name) {
  assertDesign(design);
  return { ...design, name: String(name || design.name) };
}

export function updateDesignSettings(design, settings) {
  assertDesign(design);
  // snapEnabled defaults on for documents saved before the Visio-style
  // grid toggle existed.
  const merged = { snapEnabled: true, ...design.settings, ...settings };
  if (!(merged.wallHeightIn > 0)) throw new Error("wallHeightIn must be positive.");
  if (!(merged.wallThicknessIn > 0)) throw new Error("wallThicknessIn must be positive.");
  if (!(merged.gridIn > 0)) throw new Error("gridIn must be positive.");
  if (typeof merged.snapEnabled !== "boolean") throw new Error("snapEnabled must be boolean.");
  return { ...design, settings: merged };
}

export function findWall(design, wallId) {
  return (design.walls || []).find((w) => w.id === wallId);
}

export function findRoom(design, roomId) {
  return (design.rooms || []).find((r) => r.id === roomId);
}

/** Add a wall; walls shorter than 1 inch are rejected. */
export function addWall(design, a, b, { id, material } = {}) {
  assertDesign(design);
  if (!isValidPoint(a) || !isValidPoint(b)) {
    throw new Error("Wall endpoints must be valid points.");
  }
  const wall = { id: id || nextId("wall"), a: clonePoint(a), b: clonePoint(b) };
  const cleanMaterial = cleanText(material);
  if (cleanMaterial) wall.material = cleanMaterial;
  if (wallLength(wall) < 1) throw new Error("Wall is too short (under 1 inch).");
  return { ...design, walls: [...design.walls, wall] };
}

/**
 * The four closed-rectangle segments for corners a and b (any drag direction).
 * Pure geometry: segment 4 ends where segment 1 begins, with no zero-length
 * segments, so the outline is exact regardless of drag direction.
 */
export function wallRectSegments(a, b) {
  if (!isValidPoint(a) || !isValidPoint(b)) {
    throw new Error("Rectangle corners must be valid points.");
  }
  const c1 = { x: a.x, y: a.y };
  const c2 = { x: b.x, y: b.y };
  const c3 = { x: b.x, y: a.y };
  const c4 = { x: a.x, y: b.y };
  return [
    { a: c1, b: c3 },
    { a: c3, b: c2 },
    { a: c2, b: c4 },
    { a: c4, b: c1 },
  ];
}

/**
 * Add a rectangular wall outline in one atomic operation: validate first,
 * then build all four walls and return the new design once (all-four-or-none).
 * Rectangles under 1 inch on either side are rejected.
 */
export function addWallRect(design, a, b, { material } = {}) {
  assertDesign(design);
  const segments = wallRectSegments(a, b);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  if (width < 1 || height < 1) {
    throw new Error("Rectangle is too small (each side must be at least 1 inch).");
  }
  const cleanMaterial = cleanText(material);
  const walls = segments.map((seg) => {
    const wall = { id: nextId("wall"), a: clonePoint(seg.a), b: clonePoint(seg.b) };
    if (cleanMaterial) wall.material = cleanMaterial;
    return wall;
  });
  return { ...design, walls: [...design.walls, ...walls] };
}

/** Drag a wall endpoint to a new point (resize).
 *
 * Collapse attempts clamp to the 1" structural minimum instead of throwing:
 * the dragged end is pinned WALL_MIN_LENGTH_IN from the fixed end along the
 * wall's original direction, the fixed end never moves, and the direction
 * vector never reverses. This matches the clamp-not-throw convention used
 * by moveOpeningStart / resizeOpening / moveOpening, and it keeps the
 * reducer total -- a handle drag can never throw inside a dispatch and
 * unmount the designer.
 */
export function moveWallEndpoint(design, wallId, end, point) {
  assertDesign(design);
  let changed = false;
  const walls = design.walls.map((w) => {
    if (w.id !== wallId) return w;
    // clampWallEndpoint validates end + point (throws on invalid input) and
    // clamps collapse attempts; a valid drag target passes through untouched.
    const target = clampWallEndpoint(w, end, point);
    changed = true;
    return { ...w, [end]: target };
  });
  if (!changed) throw new Error(`Unknown wall: ${wallId}`);
  return { ...design, walls };
}

/** Delete a wall and any openings cut into it. */
export function deleteWall(design, wallId) {
  assertDesign(design);
  return {
    ...design,
    walls: design.walls.filter((w) => w.id !== wallId),
    openings: design.openings.filter((o) => o.wallId !== wallId),
  };
}

export function getRoomTemplate(templateId) {
  return (
    ROOM_TEMPLATES.find((t) => t.id === templateId) ||
    STRUCTURE_TEMPLATES.find((t) => t.id === templateId)
  );
}

/**
 * Drop a pre-shaped rectangular room: creates four walls plus a labeled
 * room polygon. `at` is the top-left corner in inches.
 */
export function addRoomFromTemplate(design, templateId, at) {
  assertDesign(design);
  const template = getRoomTemplate(templateId);
  if (!template) throw new Error(`Unknown room template: ${templateId}`);
  if (!isValidPoint(at)) throw new Error("Room origin must be a valid point.");
  const { widthIn, depthIn } = template;
  const tl = clonePoint(at);
  const tr = { x: at.x + widthIn, y: at.y };
  const br = { x: at.x + widthIn, y: at.y + depthIn };
  const bl = { x: at.x, y: at.y + depthIn };
  let next = design;
  const wallIds = [];
  for (const [a, b] of [[tl, tr], [tr, br], [br, bl], [bl, tl]]) {
    const id = nextId("wall");
    next = addWall(next, a, b, { id });
    wallIds.push(id);
  }
  const room = {
    id: nextId("room"),
    label: template.label,
    templateId: template.id,
    wallIds,
    polygon: [clonePoint(tl), clonePoint(tr), clonePoint(br), clonePoint(bl)],
  };
  return { ...next, rooms: [...next.rooms, room] };
}

export function deleteRoom(design, roomId) {
  assertDesign(design);
  const room = (design.rooms || []).find((r) => r.id === roomId);
  if (!room) throw new Error(`Unknown room: ${roomId}`);
  // Removing a template room removes its four walls (and their openings);
  // hand-drawn walls shared with other rooms are kept.
  let next = design;
  for (const wallId of room.wallIds || []) {
    if (findWall(next, wallId)) next = deleteWall(next, wallId);
  }
  return { ...next, rooms: next.rooms.filter((r) => r.id !== roomId) };
}

/**
 * Translate a template room and its walls by (dx, dy). The polygon and all
 * four wall endpoints move together so the room stays consistent; openings
 * ride along untouched because they are stored as offsets along their walls.
 */
export function moveRoom(design, roomId, dx, dy) {
  assertDesign(design);
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) {
    throw new Error("Room move delta must be finite numbers.");
  }
  const room = findRoom(design, roomId);
  if (!room) throw new Error(`Unknown room: ${roomId}`);
  const moved = (p) => ({ x: p.x + dx, y: p.y + dy });
  const wallIds = new Set(room.wallIds || []);
  const walls = design.walls.map((w) =>
    wallIds.has(w.id) ? { ...w, a: moved(w.a), b: moved(w.b) } : w,
  );
  const rooms = design.rooms.map((r) =>
    r.id === roomId ? { ...r, polygon: (r.polygon || []).map(moved) } : r,
  );
  return { ...design, walls, rooms };
}

/** Cut a door/window opening into a wall at an offset from wall.a. */
export function addOpening(design, wallId, { type, offsetIn = 0, widthIn } = {}) {
  assertDesign(design);
  if (type !== "door" && type !== "window") {
    throw new Error("Opening type must be \"door\" or \"window\".");
  }
  const wall = findWall(design, wallId);
  if (!wall) throw new Error(`Unknown wall: ${wallId}`);
  const width = widthIn ?? OPENING_DEFAULTS[type].widthIn;
  const clamped = clampOpening(wall, type, offsetIn, width);
  const opening = { id: nextId("opening"), wallId, ...clamped };
  return { ...design, openings: [...design.openings, opening] };
}

export function moveOpening(design, openingId, offsetIn) {
  assertDesign(design);
  let changed = false;
  const openings = design.openings.map((o) => {
    if (o.id !== openingId) return o;
    const wall = findWall(design, o.wallId);
    if (!wall) throw new Error(`Opening references missing wall: ${o.wallId}`);
    changed = true;
    return { ...o, ...clampOpening(wall, o.type, offsetIn, o.widthIn) };
  });
  if (!changed) throw new Error(`Unknown opening: ${openingId}`);
  return { ...design, openings };
}

/**
 * Move an opening's START edge to newOffsetIn along its wall, keeping the
 * far (end) edge fixed: the width shrinks/grows to compensate. Backs the
 * canvas start-edge resize handle. Clamping follows clampOpening, so the
 * opening can never invert or leave the wall.
 */
export function moveOpeningStart(design, openingId, newOffsetIn) {
  assertDesign(design);
  let changed = false;
  const openings = design.openings.map((o) => {
    if (o.id !== openingId) return o;
    const wall = findWall(design, o.wallId);
    if (!wall) throw new Error(`Opening references missing wall: ${o.wallId}`);
    changed = true;
    // Clamp the start edge BEFORE deriving the width, so we never hand
    // clampOpening an already-invalid (negative) width: the opening can
    // never invert, and the width never drops below the 6" domain minimum.
    const end = o.offsetIn + o.widthIn;
    const nextStart = Math.min(Math.max(newOffsetIn, 1), end - 6);
    return { ...o, ...clampOpening(wall, o.type, nextStart, end - nextStart) };
  });
  if (!changed) throw new Error(`Unknown opening: ${openingId}`);
  return { ...design, openings };
}

export function resizeOpening(design, openingId, widthIn) {
  assertDesign(design);
  let changed = false;
  const openings = design.openings.map((o) => {
    if (o.id !== openingId) return o;
    const wall = findWall(design, o.wallId);
    if (!wall) throw new Error(`Opening references missing wall: ${o.wallId}`);
    changed = true;
    return { ...o, ...clampOpening(wall, o.type, o.offsetIn, widthIn) };
  });
  if (!changed) throw new Error(`Unknown opening: ${openingId}`);
  return { ...design, openings };
}

export function deleteOpening(design, openingId) {
  assertDesign(design);
  return { ...design, openings: design.openings.filter((o) => o.id !== openingId) };
}

/** Place a catalog piece at a point, rotation in degrees clockwise. */
export function placeFurniture(design, catalogId, x, y, rotationDeg = 0) {
  assertDesign(design);
  if (!getCatalogEntry(catalogId)) throw new Error(`Unknown catalog piece: ${catalogId}`);
  if (!isValidPoint({ x, y })) throw new Error("Furniture position must be valid.");
  const piece = {
    id: nextId("furniture"),
    catalogId,
    x,
    y,
    rotationDeg: ((rotationDeg % 360) + 360) % 360,
  };
  return { ...design, furniture: [...design.furniture, piece] };
}

export function moveFurniture(design, furnitureId, x, y) {
  assertDesign(design);
  if (!isValidPoint({ x, y })) throw new Error("Furniture position must be valid.");
  let changed = false;
  const furniture = design.furniture.map((f) => {
    if (f.id !== furnitureId) return f;
    changed = true;
    return { ...f, x, y };
  });
  if (!changed) throw new Error(`Unknown furniture: ${furnitureId}`);
  return { ...design, furniture };
}

export function rotateFurniture(design, furnitureId, rotationDeg) {
  assertDesign(design);
  let changed = false;
  const furniture = design.furniture.map((f) => {
    if (f.id !== furnitureId) return f;
    changed = true;
    return { ...f, rotationDeg: ((rotationDeg % 360) + 360) % 360 };
  });
  if (!changed) throw new Error(`Unknown furniture: ${furnitureId}`);
  return { ...design, furniture };
}

/** Furniture footprint bounds in inches: 1" min (still selectable), 40 ft max. */
export const FURNITURE_MIN_SIZE_IN = 1;
export const FURNITURE_MAX_SIZE_IN = 480;

/**
 * Effective footprint of a placed piece: per-piece size overrides (set by
 * RESIZE_FURNITURE) or the catalog nominal size when none are stored.
 * Old documents without overrides resolve straight to catalog. Pure.
 */
export function pieceSize(piece) {
  const entry = piece ? getCatalogEntry(piece.catalogId) : null;
  return {
    widthIn: piece?.widthIn ?? entry?.widthIn ?? 0,
    depthIn: piece?.depthIn ?? entry?.depthIn ?? 0,
  };
}

function cleanSizeIn(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  if (n < FURNITURE_MIN_SIZE_IN || n > FURNITURE_MAX_SIZE_IN) {
    throw new Error(
      `${label} must be between ${FURNITURE_MIN_SIZE_IN} and ${FURNITURE_MAX_SIZE_IN} inches.`,
    );
  }
  return Math.round(n * 2) / 2; // half-inch resolution keeps plans clean
}

/** Resize a placed furniture piece; stores width/depth overrides in inches.
 * Round catalog pieces stay round: both axes follow the larger dimension. */
export function resizeFurniture(design, furnitureId, widthIn, depthIn) {
  assertDesign(design);
  const piece = design.furniture.find((f) => f.id === furnitureId);
  if (!piece) throw new Error(`Unknown furniture: ${furnitureId}`);
  let w = cleanSizeIn(widthIn, "Width");
  let d = cleanSizeIn(depthIn, "Depth");
  if (getCatalogEntry(piece.catalogId)?.symbol === "circle") {
    const s = Math.max(w, d);
    w = s;
    d = s;
  }
  const furniture = design.furniture.map((f) =>
    f.id === furnitureId ? { ...f, widthIn: w, depthIn: d } : f,
  );
  return { ...design, furniture };
}

/** Drop a piece's size overrides, restoring the catalog nominal size. */
export function resetFurnitureSize(design, furnitureId) {
  assertDesign(design);
  let changed = false;
  const furniture = design.furniture.map((f) => {
    if (f.id !== furnitureId) return f;
    changed = true;
    const { widthIn: _w, depthIn: _d, ...rest } = f;
    return rest;
  });
  if (!changed) throw new Error(`Unknown furniture: ${furnitureId}`);
  return { ...design, furniture };
}

export function deleteFurniture(design, furnitureId) {
  assertDesign(design);
  return { ...design, furniture: design.furniture.filter((f) => f.id !== furnitureId) };
}

/** Move several furniture pieces at once (align/distribute); positions is [{id, x, y}]. */
export function moveFurnitureMany(design, positions) {
  assertDesign(design);
  const byId = new Map((positions || []).map((p) => [p.id, p]));
  let changed = false;
  const furniture = design.furniture.map((f) => {
    const p = byId.get(f.id);
    if (!p) return f;
    if (!isValidPoint(p)) throw new Error("Furniture position must be valid.");
    changed = true;
    return { ...f, x: p.x, y: p.y };
  });
  if (!changed) throw new Error("No matching furniture pieces.");
  return { ...design, furniture };
}

// ---- Pipe runs (Phase 2: piping mode) ----
// A pipe run is a polyline of plan-inch points carrying nominal diameter,
// material, service, and a discipline layer. Lengths derive from the
// geometry (see pipingGeometry.pipeRunLengthIn) — never stored.

function cleanDiameter(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 48) {
    throw new Error("Pipe diameter must be a positive number up to 48 inches.");
  }
  return Math.round(n * 100) / 100;
}

/** Discipline layer for a pipe run; unknown values fall back to "piping". */
function cleanPipeLayer(value) {
  return PIPE_LAYERS.includes(value) ? value : "piping";
}

export function findPipeRun(design, pipeId) {
  return (design.pipes || []).find((p) => p.id === pipeId);
}

/**
 * Add a pipe run. Consecutive near-duplicate points are collapsed (so the
 * doubled final click of a double-click-to-finish never creates a
 * zero-length segment); fewer than two distinct points throws.
 */
export function addPipeRun(design, points, { id, diameterIn = 2, material, service, layer } = {}) {
  assertDesign(design);
  const clean = dedupeConsecutivePoints(points);
  if (clean.length < 2) throw new Error("Pipe run needs at least two distinct points.");
  const run = {
    id: id || nextId("pipe"),
    points: clean,
    diameterIn: cleanDiameter(diameterIn),
    layer: cleanPipeLayer(layer),
  };
  const cleanMaterial = cleanText(material);
  if (cleanMaterial) run.material = cleanMaterial;
  const cleanService = cleanText(service);
  if (cleanService) run.service = cleanService;
  return { ...design, pipes: [...(design.pipes || []), run] };
}

export function deletePipeRun(design, pipeId) {
  assertDesign(design);
  return { ...design, pipes: (design.pipes || []).filter((p) => p.id !== pipeId) };
}

/** Patch a run's diameter/material/service/layer. Blank material/service clears the field. */
export function setPipeFields(design, pipeId, fields = {}) {
  assertDesign(design);
  let changed = false;
  const pipes = (design.pipes || []).map((run) => {
    if (run.id !== pipeId) return run;
    changed = true;
    const next = { ...run };
    if (fields.diameterIn !== undefined) next.diameterIn = cleanDiameter(fields.diameterIn);
    if (fields.material !== undefined) {
      const m = cleanText(fields.material);
      if (m) next.material = m;
      else delete next.material;
    }
    if (fields.service !== undefined) {
      const s = cleanText(fields.service);
      if (s) next.service = s;
      else delete next.service;
    }
    if (fields.layer !== undefined) next.layer = cleanPipeLayer(fields.layer);
    return next;
  });
  if (!changed) throw new Error(`Unknown pipe run: ${pipeId}`);
  return { ...design, pipes };
}

/** Drag one vertex of a pipe run to a new point. */
export function movePipeVertex(design, pipeId, index, point) {
  assertDesign(design);
  if (!isValidPoint(point)) throw new Error("Vertex must be a valid point.");
  let changed = false;
  const pipes = (design.pipes || []).map((run) => {
    if (run.id !== pipeId) return run;
    if (!Number.isInteger(index) || index < 0 || index >= run.points.length) {
      throw new Error("Vertex index out of range.");
    }
    changed = true;
    return {
      ...run,
      points: run.points.map((p, i) => (i === index ? { x: point.x, y: point.y } : p)),
    };
  });
  if (!changed) throw new Error(`Unknown pipe run: ${pipeId}`);
  return { ...design, pipes };
}

// ---- Generic symbol instances (Phase 2: piping mode) ----
// Placements of any registered symbol domain ("piping" today, more later).
// Instances reference the catalog by domain + symbolId; the registry owns
// the symbol definitions.

export function findSymbolInstance(design, instanceId) {
  return (design.symbols || []).find((s) => s.id === instanceId);
}

/**
 * Place a registered symbol. Layer falls back to the symbol's default
 * layer ("auto"/unknown values included); tag is optional equipment
 * tagging (e.g. "P-101").
 */
export function placeSymbol(design, domain, symbolId, x, y, { id, rotationDeg = 0, layer, tag } = {}) {
  assertDesign(design);
  const symbol = findSymbol(domain, symbolId);
  if (!symbol) throw new Error(`Unknown symbol: ${domain}/${symbolId}`);
  if (!isValidPoint({ x, y })) throw new Error("Symbol position must be valid.");
  const instance = {
    id: id || nextId("symbol"),
    domain,
    symbolId,
    x,
    y,
    rotationDeg: ((rotationDeg % 360) + 360) % 360,
    layer: PIPE_LAYERS.includes(layer) ? layer : symbol.defaultLayer || "piping",
  };
  const cleanTag = cleanText(tag, 40);
  if (cleanTag) instance.tag = cleanTag;
  return { ...design, symbols: [...(design.symbols || []), instance] };
}

export function moveSymbol(design, instanceId, x, y) {
  assertDesign(design);
  if (!isValidPoint({ x, y })) throw new Error("Symbol position must be valid.");
  let changed = false;
  const symbols = (design.symbols || []).map((s) => {
    if (s.id !== instanceId) return s;
    changed = true;
    return { ...s, x, y };
  });
  if (!changed) throw new Error(`Unknown symbol instance: ${instanceId}`);
  return { ...design, symbols };
}

export function rotateSymbol(design, instanceId, rotationDeg) {
  assertDesign(design);
  let changed = false;
  const symbols = (design.symbols || []).map((s) => {
    if (s.id !== instanceId) return s;
    changed = true;
    return { ...s, rotationDeg: ((rotationDeg % 360) + 360) % 360 };
  });
  if (!changed) throw new Error(`Unknown symbol instance: ${instanceId}`);
  return { ...design, symbols };
}

export function deleteSymbol(design, instanceId) {
  assertDesign(design);
  return { ...design, symbols: (design.symbols || []).filter((s) => s.id !== instanceId) };
}

/** Set (or clear, with a blank) an equipment tag such as "P-101". */
export function setSymbolTag(design, instanceId, tag) {
  return setShapeField(design, "symbols", instanceId, "tag", cleanText(tag, 40), "symbol");
}

/** Move a symbol instance to another discipline layer. */
export function setSymbolLayer(design, instanceId, layer) {
  assertDesign(design);
  if (!PIPE_LAYERS.includes(layer)) throw new Error(`Unknown layer: ${layer}`);
  return setShapeField(design, "symbols", instanceId, "layer", layer, "symbol");
}

// ---- Org charts (Phase 3: people org charts) ----
// A chart is a placeable diagram: { id, name, x, y, nodes } where nodes are
// people { id, name, title, department, managerId }. The (x, y) anchor is
// the top-center of the laid-out tree; the tree layout itself is derived
// at render time (see orgChartLayout.js) and never stored.

export function findOrgChart(design, chartId) {
  return (design.orgCharts || []).find((c) => c.id === chartId);
}

export function findPerson(chart, personId) {
  return (chart?.nodes || []).find((p) => p.id === personId);
}

function updateOrgChart(design, chartId, fn) {
  assertDesign(design);
  let changed = false;
  const orgCharts = (design.orgCharts || []).map((c) => {
    if (c.id !== chartId) return c;
    changed = true;
    return fn(c);
  });
  if (!changed) throw new Error(`Unknown org chart: ${chartId}`);
  return { ...design, orgCharts };
}

/** Validate a manager assignment for a chart's nodes; returns the clean id (or null). */
function cleanManagerId(chart, personId, managerId) {
  if (managerId === null || managerId === undefined || managerId === "") return null;
  if (!findPerson(chart, managerId)) throw new Error(`Unknown manager: ${managerId}`);
  if (managerId === personId) throw new Error("A person cannot be their own manager.");
  if (wouldCreateCycle(chart.nodes, personId, managerId)) {
    throw new Error("That manager would create a reporting cycle.");
  }
  return managerId;
}

/**
 * Place a new org chart. It starts with one placeholder person so the
 * diagram is visible and editable immediately.
 */
export function addOrgChart(design, name, x, y, { id } = {}) {
  assertDesign(design);
  if (!isValidPoint({ x, y })) throw new Error("Org chart position must be valid.");
  const chart = {
    id: id || nextId("orgchart"),
    name: cleanText(name) || "Org chart",
    x,
    y,
    nodes: [
      { id: nextId("person"), name: "New person", title: "", department: "", managerId: null },
    ],
  };
  return { ...design, orgCharts: [...(design.orgCharts || []), chart] };
}

export function deleteOrgChart(design, chartId) {
  assertDesign(design);
  return { ...design, orgCharts: (design.orgCharts || []).filter((c) => c.id !== chartId) };
}

export function moveOrgChart(design, chartId, x, y) {
  assertDesign(design);
  if (!isValidPoint({ x, y })) throw new Error("Org chart position must be valid.");
  return updateOrgChart(design, chartId, (chart) => ({ ...chart, x, y }));
}

export function renameOrgChart(design, chartId, name) {
  return setShapeField(design, "orgCharts", chartId, "name", cleanText(name) || "Org chart", "org chart");
}

/** Add a person to a chart; managerId null/blank makes them a top-level root. */
export function addPerson(design, chartId, { id, name, title, department, managerId } = {}) {
  assertDesign(design);
  return updateOrgChart(design, chartId, (chart) => {
    const cleanName = cleanText(name, 80);
    if (!cleanName) throw new Error("Person name is required.");
    const person = {
      id: id || nextId("person"),
      name: cleanName,
      title: cleanText(title, 80) || "",
      department: cleanText(department, 60) || "",
      managerId: null,
    };
    person.managerId = cleanManagerId(chart, person.id, managerId);
    return { ...chart, nodes: [...chart.nodes, person] };
  });
}

/** Patch a person's name/title/department (manager changes go through setPersonManager). */
export function updatePerson(design, chartId, personId, fields = {}) {
  assertDesign(design);
  return updateOrgChart(design, chartId, (chart) => {
    let changed = false;
    const nodes = chart.nodes.map((p) => {
      if (p.id !== personId) return p;
      changed = true;
      const next = { ...p };
      if (fields.name !== undefined) {
        // Empty is allowed as a transient editing state: clearing the name
        // field must not reject the keystroke (the reducer would swallow the
        // error and the input would snap back, making the last character
        // uneditable). addPerson still requires a non-empty name.
        next.name = cleanText(fields.name, 80) || "";
      }
      if (fields.title !== undefined) next.title = cleanText(fields.title, 80) || "";
      if (fields.department !== undefined) next.department = cleanText(fields.department, 60) || "";
      return next;
    });
    if (!changed) throw new Error(`Unknown person: ${personId}`);
    return { ...chart, nodes };
  });
}

/** Reassign a person's manager (null/blank for top level); cycles are rejected. */
export function setPersonManager(design, chartId, personId, managerId) {
  assertDesign(design);
  return updateOrgChart(design, chartId, (chart) => {
    if (!findPerson(chart, personId)) throw new Error(`Unknown person: ${personId}`);
    const clean = cleanManagerId(chart, personId, managerId);
    return {
      ...chart,
      nodes: chart.nodes.map((p) => (p.id === personId ? { ...p, managerId: clean } : p)),
    };
  });
}

/**
 * Remove a person. Their direct reports keep their place in the tree under
 * the removed person's manager (or become roots) — the chart stays
 * connected instead of orphaning a subtree.
 */
export function removePerson(design, chartId, personId) {
  assertDesign(design);
  return updateOrgChart(design, chartId, (chart) => {
    const person = findPerson(chart, personId);
    if (!person) throw new Error(`Unknown person: ${personId}`);
    return {
      ...chart,
      nodes: chart.nodes
        .filter((p) => p.id !== personId)
        .map((p) => (p.managerId === personId ? { ...p, managerId: person.managerId } : p)),
    };
  });
}

// ---- Shape data hooks (Visio-style shape data) ----
// Optional cost/material fields stored on the document. These are the seam
// the FORGE cost tools will consume later: plain data in, no pricing logic.

/** Trimmed text or undefined when blank; throws past 120 chars. */
function cleanText(value, max = 120) {
  const s = String(value ?? "").trim();
  if (s.length > max) throw new Error(`Value exceeds ${max} characters.`);
  return s === "" ? undefined : s;
}

/** Non-negative dollar amount rounded to cents, or undefined to clear. */
function cleanUnitCost(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("Unit cost must be a non-negative number.");
  return Math.round(n * 100) / 100;
}

function setShapeField(design, list, id, field, value, label) {
  assertDesign(design);
  let changed = false;
  const next = (design[list] || []).map((item) => {
    if (item.id !== id) return item;
    changed = true;
    const copy = { ...item };
    if (value === undefined) delete copy[field];
    else copy[field] = value;
    return copy;
  });
  if (!changed) throw new Error(`Unknown ${label}: ${id}`);
  return { ...design, [list]: next };
}

/** Set (or clear, with a blank) a wall's construction material, e.g. "2x4 stud". */
export function setWallMaterial(design, wallId, material) {
  return setShapeField(design, "walls", wallId, "material", cleanText(material), "wall");
}

/** Set (or clear, with a blank) a room's finish, e.g. "hardwood". */
export function setRoomFinish(design, roomId, finish) {
  return setShapeField(design, "rooms", roomId, "finish", cleanText(finish), "room");
}

/** Set (or clear, with blank) a furniture piece's estimated unit cost in dollars. */
export function setFurnitureUnitCost(design, furnitureId, costPerUnit) {
  return setShapeField(design, "furniture", furnitureId, "costPerUnit", cleanUnitCost(costPerUnit), "furniture");
}

/** Structural sanity check; returns a list of human-readable problems. */
export function validateDesign(design) {
  const errors = [];
  try {
    assertDesign(design);
  } catch (error) {
    return [error.message];
  }
  const wallIds = new Set(design.walls.map((w) => w.id));
  for (const wall of design.walls) {
    if (wallLength(wall) < 1) errors.push(`Wall ${wall.id} is degenerate.`);
  }
  for (const opening of design.openings) {
    if (!wallIds.has(opening.wallId)) {
      errors.push(`Opening ${opening.id} references missing wall ${opening.wallId}.`);
      continue;
    }
    const wall = findWall(design, opening.wallId);
    const length = wallLength(wall);
    if (opening.offsetIn < 0 || opening.offsetIn + opening.widthIn > length + 1e-6) {
      errors.push(`Opening ${opening.id} overhangs its wall.`);
    }
  }
  for (const piece of design.furniture) {
    if (!getCatalogEntry(piece.catalogId)) {
      errors.push(`Furniture ${piece.id} references unknown catalog piece ${piece.catalogId}.`);
    }
  }
  for (const room of design.rooms || []) {
    if (polygonArea(room.polygon) <= 0) errors.push(`Room ${room.id} has no area.`);
  }
  for (const run of design.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) {
      errors.push(`Pipe run ${run.id} has fewer than two points.`);
    } else if (!(run.diameterIn > 0)) {
      errors.push(`Pipe run ${run.id} has a bad diameter.`);
    }
  }
  for (const instance of design.symbols || []) {
    if (!findSymbol(instance.domain, instance.symbolId)) {
      errors.push(`Symbol ${instance.id} references unknown ${instance.domain}/${instance.symbolId}.`);
    }
  }
  for (const annotation of design.annotations || []) {
    const aid = annotation && annotation.id ? annotation.id : "(unknown)";
    if (!annotation || (annotation.kind !== "path" && annotation.kind !== "label")) {
      errors.push(`Annotation ${aid} has an unknown kind.`);
    } else if (
      !Array.isArray(annotation.points) ||
      annotation.points.length === 0 ||
      !annotation.points.every(isValidPoint)
    ) {
      errors.push(`Annotation ${aid} has no valid points.`);
    } else if (annotation.kind === "label" && typeof annotation.text !== "string") {
      errors.push(`Annotation ${aid} is a label without text.`);
    }
  }
  for (const chart of design.orgCharts || []) {
    const personIds = new Set((chart.nodes || []).map((p) => p.id));
    for (const person of chart.nodes || []) {
      if (person.managerId != null && !personIds.has(person.managerId)) {
        errors.push(
          `Org chart ${chart.id}: ${person.name || person.id} reports to unknown person ${person.managerId}.`,
        );
      }
    }
  }
  for (const sheet of design.sheets || []) {
    try {
      sheetDimensions(sheet.sizeId, sheet.orientation);
    } catch {
      errors.push(`Sheet ${sheet.id} references an unknown size/orientation.`);
    }
    if (
      !(sheet.planWidthIn > 0) ||
      !(sheet.planHeightIn > 0) ||
      !(sheet.fitScale > 0) ||
      !isFiniteNumber(sheet.x) ||
      !isFiniteNumber(sheet.y)
    ) {
      errors.push(`Sheet ${sheet.id} has bad geometry (bounds, fit scale, or anchor).`);
    }
  }
  return errors;
}

export function serializeDesign(design) {
  assertDesign(design);
  return JSON.stringify(design);
}

export function parseDesign(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Design is not valid JSON.");
  }
  assertDesign(parsed);
  // Documents saved before the annotations array existed load safely:
  // normalize the missing array instead of bumping the version.
  if (!Array.isArray(parsed.annotations)) parsed.annotations = [];
  return parsed;
}

/** Total wall length across the design, in inches (for material estimates). */
export function totalWallLengthIn(design) {
  assertDesign(design);
  return design.walls.reduce((sum, w) => sum + wallLength(w), 0);
}

/** Sum of labeled room areas in square feet. */
export function totalRoomAreaSqFt(design) {
  assertDesign(design);
  return (design.rooms || []).reduce((sum, r) => sum + polygonArea(r.polygon) / 144, 0);
}

// ---- Background underlay (Visio trace-over workflow) ----
// Phase 1 stores the image as a data URL inside the design document.
// Follow-up if images get large: migrate to Supabase Storage and keep
// only the storage path + dimensions on the design.

/** Default underlay record fields for a freshly imported image. */
export function buildUnderlayRecord({ name, mimeType, dataUrl, widthPx, heightPx }) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("Underlay must be a PNG/JPEG data URL.");
  }
  if (!(widthPx > 0) || !(heightPx > 0)) throw new Error("Underlay image dimensions must be positive.");
  return {
    id: nextId("underlay"),
    name: typeof name === "string" && name.trim() ? name.trim() : "background",
    mimeType: mimeType === "image/jpeg" ? "image/jpeg" : "image/png",
    dataUrl,
    widthPx,
    heightPx,
    opacity: DEFAULT_UNDERLAY_OPACITY,
    locked: false,
    x: 0,
    y: 0,
    pxPerIn: widthPx / DEFAULT_UNDERLAY_WIDTH_IN,
  };
}

/** Import (or replace) the background underlay image. */
export function setUnderlay(design, image) {
  assertDesign(design);
  return { ...design, underlay: buildUnderlayRecord(image) };
}

function clamp01(value) {
  if (!(value >= 0)) return 0;
  if (!(value <= 1)) return 1;
  return value;
}

/** Patch underlay display settings: opacity (0..1, clamped), locked, x/y, pxPerIn. */
export function updateUnderlay(design, patch) {
  assertDesign(design);
  if (!design.underlay) throw new Error("Design has no background underlay.");
  const u = { ...design.underlay };
  if (patch.opacity !== undefined) u.opacity = clamp01(Number(patch.opacity));
  if (patch.locked !== undefined) u.locked = Boolean(patch.locked);
  if (patch.x !== undefined || patch.y !== undefined) {
    const x = patch.x !== undefined ? Number(patch.x) : u.x;
    const y = patch.y !== undefined ? Number(patch.y) : u.y;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) throw new Error("Underlay position must be finite.");
    u.x = x;
    u.y = y;
  }
  if (patch.pxPerIn !== undefined) {
    const pxPerIn = Number(patch.pxPerIn);
    if (!(pxPerIn > 0)) throw new Error("Underlay scale must be positive.");
    u.pxPerIn = pxPerIn;
  }
  return { ...design, underlay: u };
}

/** Remove the background underlay. */
export function removeUnderlay(design) {
  assertDesign(design);
  return { ...design, underlay: null };
}

/** Reposition the underlay's top-left anchor (plan inches). */
export function moveUnderlay(design, x, y) {
  return updateUnderlay(design, { x, y });
}

/**
 * Calibrate the underlay scale from two clicked plan points that are
 * `realDistanceIn` inches apart in the real world. The first calibration
 * point (clickA) is kept registered to the same image pixel -- the
 * top-left anchor (x, y) is repositioned so the rescaled image does not
 * pivot around the image corner and disturb careful registration. Pure.
 */
export function calibrateUnderlay(design, clickA, clickB, realDistanceIn) {
  assertDesign(design);
  if (!design.underlay) throw new Error("Design has no background underlay.");
  const u = design.underlay;
  const pxPerIn = calibrateUnderlayScale(u, clickA, clickB, realDistanceIn);
  const scaleRatio = u.pxPerIn / pxPerIn;
  const x = clickA.x - (clickA.x - u.x) * scaleRatio;
  const y = clickA.y - (clickA.y - u.y) * scaleRatio;
  return updateUnderlay(design, { pxPerIn, x, y });
}

// ---------------------------------------------------------------------------
// Printable paper sheets
//
// A sheet is a positioned printable paper frame:
//   { id, sizeId, orientation, x, y, planWidthIn, planHeightIn, fitScale }
//
// (x, y) is the TOP-LEFT anchor of the frame in plan inches. The plan
// bounds and fitScale are fixed when the sheet is placed (or its format
// changes) and are never recomputed from later content — adding content
// later cannot silently alter what a sheet represents or prints.
//
// Fit scale is UNIFORM: min(printablePaperWidth / planWidth,
// printablePaperHeight / planHeight). X and Y are never scaled separately,
// so geometry never distorts. The print view clips everything outside the
// fixed frame.
// ---------------------------------------------------------------------------

/** Sheets of a design; old documents that predate sheets read as []. */
export function sheetsOf(design) {
  return design?.sheets || [];
}

export function findSheet(design, sheetId) {
  return sheetsOf(design).find((s) => s.id === sheetId);
}

/**
 * The plan region a sheet represents: the fixed top-left anchor plus the
 * fixed placement-time dimensions. Never derived from current content.
 */
export function sheetPlanBounds(sheet) {
  if (!sheet) throw new Error("Unknown sheet.");
  return { x: sheet.x, y: sheet.y, widthIn: sheet.planWidthIn, heightIn: sheet.planHeightIn };
}

/**
 * Tight axis-aligned bounds of every drawable element in plan inches:
 * { x, y, widthIn, heightIn } at the top-left, or null when the design is
 * empty. Used ONCE at sheet placement / format change to fix the sheet's
 * plan region; never consulted again afterward.
 */
export function designContentBounds(design) {
  assertDesign(design);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (x, y) => {
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const eatRect = (cx, cy, w, h) => {
    eat(cx - w / 2, cy - h / 2);
    eat(cx + w / 2, cy + h / 2);
  };
  for (const wall of design.walls || []) {
    eat(wall.a?.x, wall.a?.y);
    eat(wall.b?.x, wall.b?.y);
  }
  for (const room of design.rooms || []) {
    for (const p of room.polygon || []) eat(p?.x, p?.y);
  }
  for (const piece of design.furniture || []) {
    const { widthIn, depthIn } = pieceSize(piece);
    eatRect(piece.x, piece.y, widthIn, depthIn);
  }
  for (const run of design.pipes || []) {
    for (const p of run.points || []) eat(p?.x, p?.y);
  }
  for (const instance of design.symbols || []) {
    const sym = findSymbol(instance.domain, instance.symbolId);
    eatRect(instance.x, instance.y, sym?.widthIn || 0, sym?.depthIn || 0);
  }
  for (const chart of design.orgCharts || []) {
    const layout = layoutOrgChart(chart.nodes || []);
    const w = Math.max(layout.widthIn, ORG_CHART_METRICS.boxWidthIn);
    const h = Math.max(layout.heightIn, ORG_CHART_METRICS.boxHeightIn);
    eat(chart.x - w / 2, chart.y);
    eat(chart.x + w / 2, chart.y + h);
  }
  const u = design.underlay;
  if (u) {
    const w = u.widthPx / u.pxPerIn;
    const h = u.heightPx / u.pxPerIn;
    eat(u.x, u.y);
    eat(u.x + w, u.y + h);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, widthIn: maxX - minX, heightIn: maxY - minY };
}

/**
 * Uniform fit scale: paper inches of PRINTED line per plan inch, against the
 * printable area (paper minus the print margin on every side). Uniform —
 * min() of the two axes — so geometry never distorts. Degenerate content
 * dimensions are padded to 1 inch so the scale stays finite.
 */
export function computeFitScale(paperW, paperH, contentW, contentH, marginIn = PRINT_MARGIN_IN) {
  const printableW = paperW - 2 * marginIn;
  const printableH = paperH - 2 * marginIn;
  if (!(printableW > 0) || !(printableH > 0)) {
    throw new Error("Sheet is too small for the print margin.");
  }
  const cw = Math.max(contentW, 1);
  const ch = Math.max(contentH, 1);
  return Math.min(printableW / cw, printableH / ch);
}

/**
 * Exact fit label, e.g. Fit scale: 1" = 53.7". Computed from the exact
 * stored scale — never a rounded architectural ratio.
 */
export function fitScaleLabel(fitScale) {
  if (!(fitScale > 0)) throw new Error("Fit scale must be positive.");
  const planInPerPaperIn = 1 / fitScale;
  const rounded = Math.round(planInPerPaperIn * 10) / 10;
  return `Fit scale: 1" = ${rounded}"`;
}

/**
 * Place a new sheet. On a non-empty design the frame is fitted around the
 * CURRENT content (uniform fit scale, printable area, frame centered on the
 * content) and that region + scale is then fixed. On an empty design the
 * frame starts as a 1:1 paper-size region centered at the plan origin.
 * Pass { x, y } to override the top-left anchor explicitly.
 *
 * The final anchor snaps to the design's grid unless snap is disabled
 * (settings.snapEnabled === false), so the frame border sits on grid lines
 * and zooming inside it keeps the drawing grid-aligned.
 */
export function addSheet(design, sizeId, orientation = "portrait", { x, y } = {}) {
  assertDesign(design);
  const { widthIn: paperW, heightIn: paperH } = sheetDimensions(sizeId, orientation);
  const content = designContentBounds(design);
  let fitScale;
  let planWidthIn;
  let planHeightIn;
  let anchorX = x;
  let anchorY = y;
  if (!content) {
    fitScale = 1;
    planWidthIn = paperW;
    planHeightIn = paperH;
    if (anchorX == null) anchorX = -paperW / 2;
    if (anchorY == null) anchorY = -paperH / 2;
  } else {
    fitScale = computeFitScale(paperW, paperH, content.widthIn, content.heightIn);
    planWidthIn = paperW / fitScale;
    planHeightIn = paperH / fitScale;
    if (anchorX == null) anchorX = content.x + content.widthIn / 2 - planWidthIn / 2;
    if (anchorY == null) anchorY = content.y + content.heightIn / 2 - planHeightIn / 2;
  }
  if (!isFiniteNumber(anchorX) || !isFiniteNumber(anchorY)) {
    throw new Error("Sheet anchor must be finite plan coordinates.");
  }
  const snappedAnchor = snapSheetAnchor(design, anchorX, anchorY);
  anchorX = snappedAnchor.x;
  anchorY = snappedAnchor.y;
  const sheet = {
    id: nextId("sheet"),
    sizeId,
    orientation,
    x: anchorX,
    y: anchorY,
    planWidthIn,
    planHeightIn,
    fitScale,
    header: defaultSheetHeader(),
    footer: defaultSheetFooter(),
  };
  return { ...design, sheets: [...sheetsOf(design), sheet] };
}

/** Grid spacing used for sheet-frame snapping; falls back to the 6″ default. */
function sheetSnapGridIn(design) {
  const gridIn = design.settings?.gridIn;
  return gridIn > 0 ? gridIn : DEFAULT_GRID_IN;
}

/**
 * Snap a sheet frame's top-left anchor to the design grid. Returns the point
 * unchanged when the user turned snap off (settings.snapEnabled === false).
 * Normalizes -0 to 0 so the anchor survives a JSON save/reload unchanged
 * (JSON.stringify(-0) is "0").
 */
function snapSheetAnchor(design, x, y) {
  if (design.settings?.snapEnabled === false) return { x, y };
  const gridIn = sheetSnapGridIn(design);
  const snap = (v) => {
    const snapped = snapScalar(v, gridIn);
    return snapped === 0 ? 0 : snapped;
  };
  return { x: snap(x), y: snap(y) };
}

/**
 * Reposition a sheet's top-left anchor. Bounds and fit scale are untouched.
 * The anchor snaps to the design grid unless snap is disabled, so a dragged
 * frame re-seats on grid lines when the drag ends.
 */
export function moveSheet(design, sheetId, x, y) {
  assertDesign(design);
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    throw new Error("Sheet anchor must be finite plan coordinates.");
  }
  const sheet = findSheet(design, sheetId);
  if (!sheet) throw new Error(`Unknown sheet: ${sheetId}`);
  const snapped = snapSheetAnchor(design, x, y);
  return {
    ...design,
    sheets: sheetsOf(design).map((s) => (s.id === sheetId ? { ...s, x: snapped.x, y: snapped.y } : s)),
  };
}

/** Delete a sheet by id (no-op when missing, like other delete ops). */
export function deleteSheet(design, sheetId) {
  assertDesign(design);
  return { ...design, sheets: sheetsOf(design).filter((s) => s.id !== sheetId) };
}

/**
 * Change a sheet's size and/or orientation. The fit scale and plan region
 * are re-fixed against the CURRENT content (same rule as placement) while
 * the frame CENTER stays put, so the sheet does not jump across the plan.
 */
export function updateSheetFormat(design, sheetId, { sizeId, orientation } = {}) {
  assertDesign(design);
  const sheet = findSheet(design, sheetId);
  if (!sheet) throw new Error(`Unknown sheet: ${sheetId}`);
  const nextSizeId = sizeId || sheet.sizeId;
  const nextOrientation = orientation || sheet.orientation;
  const { widthIn: paperW, heightIn: paperH } = sheetDimensions(nextSizeId, nextOrientation);
  const content = designContentBounds(design);
  let fitScale;
  let planWidthIn;
  let planHeightIn;
  if (!content) {
    fitScale = 1;
    planWidthIn = paperW;
    planHeightIn = paperH;
  } else {
    fitScale = computeFitScale(paperW, paperH, content.widthIn, content.heightIn);
    planWidthIn = paperW / fitScale;
    planHeightIn = paperH / fitScale;
  }
  const centerX = sheet.x + sheet.planWidthIn / 2;
  const centerY = sheet.y + sheet.planHeightIn / 2;
  return {
    ...design,
    sheets: sheetsOf(design).map((s) =>
      s.id === sheetId
        ? {
            ...s,
            sizeId: nextSizeId,
            orientation: nextOrientation,
            x: centerX - planWidthIn / 2,
            y: centerY - planHeightIn / 2,
            planWidthIn,
            planHeightIn,
            fitScale,
          }
        : s,
    ),
  };
}

// ---------------------------------------------------------------------------
// Sheet header/footer: printable title block per sheet.
// ---------------------------------------------------------------------------

/**
 * Logo budget: the stored PNG data URL must stay under ~1.5 MB so sheets
 * keep saving fast. Browser-local only — logos are never uploaded anywhere.
 */
export const SHEET_LOGO_MAX_BYTES = 1572864; // 1.5 * 1024 * 1024

/** Only PNG data URLs are accepted for sheet logos — never remote URLs. */
export const SHEET_PNG_DATA_URL_PREFIX = "data:image/png;base64,";

/** Printable label fields are capped so a runaway string can't wreck the title block. */
export const SHEET_LABEL_MAX_LENGTH = 200;

/** Fresh default header: title/subtitle labels plus an optional PNG logo. */
export function defaultSheetHeader() {
  return { title: "", subtitle: "", logo: null };
}

/** Fresh default footer: three free-text columns. */
export function defaultSheetFooter() {
  return { left: "", center: "", right: "" };
}

/**
 * Read a sheet's header with defaults for legacy sheets that predate
 * header/footer (they print exactly as before: no header zone).
 */
export function sheetHeaderOf(sheet) {
  return { ...defaultSheetHeader(), ...(sheet?.header || {}) };
}

/** Read a sheet's footer with defaults for legacy sheets (legacy title strip). */
export function sheetFooterOf(sheet) {
  return { ...defaultSheetFooter(), ...(sheet?.footer || {}) };
}

function assertSheetLabel(value, field) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  if (value.length > SHEET_LABEL_MAX_LENGTH) {
    throw new Error(`${field} must be ${SHEET_LABEL_MAX_LENGTH} characters or fewer.`);
  }
}

function assertSheetLogo(logo) {
  if (logo == null) return;
  if (typeof logo !== "string" || !logo.startsWith(SHEET_PNG_DATA_URL_PREFIX)) {
    throw new Error("Sheet logo must be a PNG data URL.");
  }
  if (logo.length > SHEET_LOGO_MAX_BYTES) {
    throw new Error("Sheet logo must be under 1.5 MB.");
  }
}

function assertSheetHeader(header) {
  if (!header || typeof header !== "object" || Array.isArray(header)) {
    throw new Error("Sheet header must be an object.");
  }
  assertSheetLabel(header.title ?? "", "Header title");
  assertSheetLabel(header.subtitle ?? "", "Header subtitle");
  assertSheetLogo(header.logo ?? null);
}

function assertSheetFooter(footer) {
  if (!footer || typeof footer !== "object" || Array.isArray(footer)) {
    throw new Error("Sheet footer must be an object.");
  }
  assertSheetLabel(footer.left ?? "", "Footer left");
  assertSheetLabel(footer.center ?? "", "Footer center");
  assertSheetLabel(footer.right ?? "", "Footer right");
}

/**
 * Patch a sheet's header and/or footer: patch = { header?, footer? } with
 * partial objects (missing fields keep their current values). Unknown patch
 * keys, non-string labels, non-PNG logos, and oversized logos throw — the
 * UI surfaces the message and nothing is persisted. Unknown sheet id throws.
 */
export function patchSheet(design, sheetId, patch) {
  assertDesign(design);
  const sheet = findSheet(design, sheetId);
  if (!sheet) throw new Error(`Unknown sheet: ${sheetId}`);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Sheet patch must be an object.");
  }
  const known = new Set(["header", "footer"]);
  for (const key of Object.keys(patch)) {
    if (!known.has(key)) throw new Error(`Unknown sheet patch field: ${key}`);
  }
  const next = { ...sheet };
  if (patch.header !== undefined) {
    const header = { ...sheetHeaderOf(sheet), ...patch.header };
    assertSheetHeader(header);
    next.header = header;
  }
  if (patch.footer !== undefined) {
    const footer = { ...sheetFooterOf(sheet), ...patch.footer };
    assertSheetFooter(footer);
    next.footer = footer;
  }
  return {
    ...design,
    sheets: sheetsOf(design).map((s) => (s.id === sheetId ? next : s)),
  };
}
