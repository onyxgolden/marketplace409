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
//   }
//
// Every operation is pure: it takes a design and returns a new design.
// Coordinates are inches; opening offsets are inches from wall.a.

import { getCatalogEntry, ROOM_TEMPLATES } from "./furnitureCatalog";
import { findSymbol } from "./symbolRegistry";
// Side-effect import: registers the "piping" symbol set so placeSymbol
// and validateDesign resolve it in every context that loads the document
// model (app, API routes, tests).
import "./pipingCatalog";
import { wouldCreateCycle } from "./orgChartLayout";
import {
  calibrateUnderlayScale,
  DEFAULT_UNDERLAY_OPACITY,
  DEFAULT_UNDERLAY_WIDTH_IN,
  isFiniteNumber,
  isValidPoint,
  polygonArea,
  wallLength,
} from "./designerGeometry";
import {
  dedupeConsecutivePoints,
  PIPE_LAYERS,
} from "./pipingGeometry";

// Re-exported for the catalog UI; the canonical definition lives in
// furnitureCatalog.js, where the "rooms" symbol set is registered.
export { ROOM_TEMPLATES };

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

/** Drag a wall endpoint to a new point (resize). */
export function moveWallEndpoint(design, wallId, end, point) {
  assertDesign(design);
  if (end !== "a" && end !== "b") throw new Error("end must be \"a\" or \"b\".");
  if (!isValidPoint(point)) throw new Error("Target point must be valid.");
  let changed = false;
  const walls = design.walls.map((w) => {
    if (w.id !== wallId) return w;
    const candidate = { ...w, [end]: clonePoint(point) };
    if (wallLength(candidate) < 1) throw new Error("Wall would collapse under 1 inch.");
    changed = true;
    return candidate;
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
  return ROOM_TEMPLATES.find((t) => t.id === templateId);
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

function clampOpening(wall, type, offsetIn, widthIn) {
  const length = wallLength(wall);
  const width = Math.min(Math.max(widthIn, 6), Math.max(length - 2, 6));
  const offset = Math.min(Math.max(offsetIn, 1), Math.max(length - width - 1, 1));
  return { type, offsetIn: offset, widthIn: width };
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
        const cleanName = cleanText(fields.name, 80);
        if (!cleanName) throw new Error("Person name is required.");
        next.name = cleanName;
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
