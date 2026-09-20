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
import {
  calibrateUnderlayScale,
  DEFAULT_UNDERLAY_OPACITY,
  DEFAULT_UNDERLAY_WIDTH_IN,
  isFiniteNumber,
  isValidPoint,
  polygonArea,
  wallLength,
} from "./designerGeometry";

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
 * `realDistanceIn` inches apart in the real world. Pure.
 */
export function calibrateUnderlay(design, clickA, clickB, realDistanceIn) {
  assertDesign(design);
  if (!design.underlay) throw new Error("Design has no background underlay.");
  const pxPerIn = calibrateUnderlayScale(design.underlay, clickA, clickB, realDistanceIn);
  return updateUnderlay(design, { pxPerIn });
}
