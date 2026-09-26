// designer3DEditing.js — P1-B: editing the design FROM the 3D viewport.
//
// Everything the 3D viewport needs to turn a pointer gesture or a typed
// dimension into a reducer action lives here, pure and framework-free: no
// Three.js, no DOM. The viewport's only jobs are raycasting (turning a screen
// point into a picked entity or a point on a horizontal plane) and
// dispatching whatever these functions return. That keeps the interesting
// logic — snapping, grab offsets, size validation — unit-testable against
// plain design objects, exactly like highlightKeysForSelection in P1-A.
//
// Coordinates: the 3D scene maps plan (x, y) to world (x, z), inches both.

import {
  FURNITURE_MAX_SIZE_IN,
  FURNITURE_MIN_SIZE_IN,
  findWall,
  pieceSize,
} from "./designerDocument";
import { getCatalogEntry } from "./furnitureCatalog";
import {
  DEFAULT_GRID_IN,
  offsetAlongWall,
  parseDimensionInput,
  snapPoint,
  snapScalar,
  wallLength,
} from "./designerGeometry";
import { MAX_MOUNT_IN } from "./furnitureSizing";

/** Entity kinds that can be picked, dragged and sized from the 3D view. */
export const EDITABLE_3D_KINDS = Object.freeze(["wall", "opening", "furniture", "symbol"]);

/** Pointer travel (px) under which a press-release counts as a click, not an orbit. */
export const CLICK_TOLERANCE_PX = 5;

/** Same snap radius the 2D canvas uses for body drags. */
const DRAG_SNAP_RADIUS_IN = 9;

/** Shortest wall a typed length may produce. */
export const MIN_WALL_LENGTH_IN = 6;

/**
 * A mesh's entity tag ({ entityKind, entityId } in userData) -> a reducer
 * selection, or null for anything not editable (floor, stairs, untagged).
 */
export function selectionFromPick(tag) {
  if (!tag || !EDITABLE_3D_KINDS.includes(tag.entityKind) || tag.entityId == null) return null;
  return { kind: tag.entityKind, id: tag.entityId };
}

/** World-space hit (x, z) -> plan point (x, y). */
export function planPointFromWorld(hit) {
  return { x: hit.x, y: hit.z };
}

/** True when a press and release are close enough to be a click. */
export function isClickGesture(down, up, tolerancePx = CLICK_TOLERANCE_PX) {
  if (!down || !up) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= tolerancePx;
}

function snapOptionsFor(design) {
  const gridIn = design?.settings?.gridIn > 0 ? design.settings.gridIn : DEFAULT_GRID_IN;
  return { gridIn, snapToGrid: design?.settings?.snapEnabled !== false };
}

/**
 * Start a 3D drag on the selected entity, grabbed at plan point `p`.
 * Returns the drag state, or null when the selection isn't draggable.
 * The grab offset is kept so the entity doesn't jump to the pointer.
 */
export function beginDrag3D(selection, design, p) {
  if (!selection || !design || !p) return null;
  if (selection.kind === "wall") {
    const wall = findWall(design, selection.id);
    if (!wall) return null;
    // The grab point is snapped exactly as every later pointer position is,
    // so each step moves the wall by whole grid increments and a wall that
    // starts on the grid stays on it. (A raw grab would carry the fractional
    // hit point into the wall's coordinates on the first step.)
    const { point: grabAt } = snapPoint(p, { ...snapOptionsFor(design), snapRadiusIn: DRAG_SNAP_RADIUS_IN });
    return {
      kind: "wall",
      id: wall.id,
      grab: { x: grabAt.x - wall.a.x, y: grabAt.y - wall.a.y },
      last: { x: wall.a.x, y: wall.a.y },
    };
  }
  if (selection.kind === "furniture") {
    const piece = (design.furniture || []).find((f) => f.id === selection.id);
    if (!piece) return null;
    return { kind: "furniture", id: piece.id, grab: { x: p.x - piece.x, y: p.y - piece.y } };
  }
  if (selection.kind === "opening") {
    const opening = (design.openings || []).find((o) => o.id === selection.id);
    const wall = opening && findWall(design, opening.wallId);
    if (!wall) return null;
    return { kind: "opening", id: opening.id, grabOffsetIn: offsetAlongWall(p, wall) - opening.offsetIn };
  }
  if (selection.kind === "symbol") {
    const inst = (design.symbols || []).find((s) => s.id === selection.id);
    if (!inst) return null;
    return { kind: "symbol", id: inst.id, grab: { x: p.x - inst.x, y: p.y - inst.y } };
  }
  return null;
}

/**
 * Advance a 3D drag to plan point `p`.
 * Returns { drag, action }: the next drag state and the reducer action to
 * dispatch (null when the snapped position didn't change). Actions carry the
 * same coalesce keys as the 2D canvas, so one drag is one undo step.
 */
export function dragStep3D(drag, design, p) {
  if (!drag || !design || !p) return { drag, action: null };
  const snap = snapOptionsFor(design);

  if (drag.kind === "wall") {
    const { point } = snapPoint(p, { ...snap, snapRadiusIn: DRAG_SNAP_RADIUS_IN });
    const anchor = { x: point.x - drag.grab.x, y: point.y - drag.grab.y };
    const dx = anchor.x - drag.last.x;
    const dy = anchor.y - drag.last.y;
    if (dx === 0 && dy === 0) return { drag, action: null };
    return {
      drag: { ...drag, last: anchor },
      action: { type: "MOVE_WALL", wallId: drag.id, dx, dy, coalesce: `move-wall:${drag.id}` },
    };
  }

  if (drag.kind === "furniture") {
    const { point } = snapPoint(
      { x: p.x - drag.grab.x, y: p.y - drag.grab.y },
      { ...snap, snapRadiusIn: DRAG_SNAP_RADIUS_IN },
    );
    const piece = (design.furniture || []).find((f) => f.id === drag.id);
    if (!piece || (piece.x === point.x && piece.y === point.y)) return { drag, action: null };
    return {
      drag,
      action: { type: "MOVE_FURNITURE", furnitureId: drag.id, x: point.x, y: point.y, coalesce: `move-furniture:${drag.id}` },
    };
  }

  if (drag.kind === "symbol") {
    const { point } = snapPoint(
      { x: p.x - drag.grab.x, y: p.y - drag.grab.y },
      { ...snap, snapRadiusIn: DRAG_SNAP_RADIUS_IN },
    );
    const inst = (design.symbols || []).find((s) => s.id === drag.id);
    if (!inst || (inst.x === point.x && inst.y === point.y)) return { drag, action: null };
    return {
      drag,
      action: { type: "MOVE_SYMBOL", symbolId: drag.id, x: point.x, y: point.y, coalesce: `move-symbol:${drag.id}` },
    };
  }

  if (drag.kind === "opening") {
    const opening = (design.openings || []).find((o) => o.id === drag.id);
    const wall = opening && findWall(design, opening.wallId);
    if (!wall) return { drag, action: null };
    const raw = offsetAlongWall(p, wall) - drag.grabOffsetIn;
    const target = Math.max(0, snap.snapToGrid ? snapScalar(raw, snap.gridIn) : raw);
    if (target === opening.offsetIn) return { drag, action: null };
    return {
      drag,
      action: { type: "MOVE_OPENING", openingId: drag.id, offsetIn: target, coalesce: `move-opening:${drag.id}` },
    };
  }

  return { drag, action: null };
}

/**
 * The size popup's content for a selection: a title plus the editable
 * dimensions in inches. Null when the selection has no 3D-editable size.
 */
export function sizeFieldsForSelection(selection, design) {
  if (!selection || !design) return null;
  if (selection.kind === "wall") {
    const wall = findWall(design, selection.id);
    if (!wall) return null;
    return { title: "Wall", fields: [{ key: "lengthIn", label: "Length", valueIn: wallLength(wall) }] };
  }
  if (selection.kind === "opening") {
    const opening = (design.openings || []).find((o) => o.id === selection.id);
    if (!opening) return null;
    return {
      title: opening.type === "door" ? "Door" : "Window",
      fields: [{ key: "widthIn", label: "Width", valueIn: opening.widthIn }],
    };
  }
  if (selection.kind === "furniture") {
    const piece = (design.furniture || []).find((f) => f.id === selection.id);
    if (!piece) return null;
    const { widthIn, depthIn, heightIn, mountIn } = pieceSize(piece);
    const entry = getCatalogEntry(piece.catalogId);
    const fields = [
      { key: "widthIn", label: "Width", valueIn: widthIn },
      { key: "depthIn", label: "Depth", valueIn: depthIn },
      { key: "heightIn", label: "Height", valueIn: heightIn },
    ];
    // Wall cabinets and shelves: how high the bottom hangs.
    if (entry?.mountIn !== undefined) fields.push({ key: "mountIn", label: "Mount", valueIn: mountIn });
    return { title: entry?.label || "Furniture", fields };
  }
  return null;
}

/**
 * Turn a typed dimension into a reducer action.
 * Returns { action } on success or { error } with a user-facing message.
 * Validation happens here, before dispatch, because several domain
 * functions throw on out-of-range input and a throw inside the reducer
 * would take down the screen.
 */
export function sizeEditAction(selection, design, key, text) {
  const inches = parseDimensionInput(String(text ?? ""));
  // A mounting height of 0 (on the floor) is valid; every size must be > 0.
  if (!Number.isFinite(inches) || inches < 0 || (inches === 0 && key !== "mountIn")) {
    return { error: `Couldn't read "${text}". Try 12'6", 150", or 150.` };
  }

  if (selection?.kind === "wall" && key === "lengthIn") {
    const wall = findWall(design, selection.id);
    if (!wall) return { error: "That wall no longer exists." };
    const current = wallLength(wall);
    if (current === 0) return { error: "Can't size a zero-length wall." };
    const minLength = Math.max(
      MIN_WALL_LENGTH_IN,
      ...(design.openings || [])
        .filter((o) => o.wallId === wall.id)
        .map((o) => o.offsetIn + o.widthIn),
    );
    if (inches < minLength) {
      return { error: `Wall must be at least ${Math.ceil(minLength)}" to keep its openings.` };
    }
    // Endpoint `a` stays put; `b` moves along the wall's own direction, so
    // the angle is preserved and openings (offsets from `a`) don't move.
    const ux = (wall.b.x - wall.a.x) / current;
    const uy = (wall.b.y - wall.a.y) / current;
    const point = { x: wall.a.x + ux * inches, y: wall.a.y + uy * inches };
    return { action: { type: "MOVE_WALL_ENDPOINT", wallId: wall.id, end: "b", point } };
  }

  if (selection?.kind === "opening" && key === "widthIn") {
    const opening = (design.openings || []).find((o) => o.id === selection.id);
    if (!opening) return { error: "That opening no longer exists." };
    return { action: { type: "RESIZE_OPENING", openingId: opening.id, widthIn: inches } };
  }

  if (selection?.kind === "furniture" && key === "mountIn") {
    const piece = (design.furniture || []).find((f) => f.id === selection.id);
    if (!piece) return { error: "That piece no longer exists." };
    if (inches > MAX_MOUNT_IN) return { error: `Mounting height must be ${MAX_MOUNT_IN}" or less.` };
    return { action: { type: "SET_FURNITURE_MOUNT", furnitureId: piece.id, mountIn: inches } };
  }

  if (selection?.kind === "furniture" && (key === "widthIn" || key === "depthIn" || key === "heightIn")) {
    const piece = (design.furniture || []).find((f) => f.id === selection.id);
    if (!piece) return { error: "That piece no longer exists." };
    if (inches < FURNITURE_MIN_SIZE_IN || inches > FURNITURE_MAX_SIZE_IN) {
      return { error: `Size must be between ${FURNITURE_MIN_SIZE_IN}" and ${FURNITURE_MAX_SIZE_IN}".` };
    }
    const size = pieceSize(piece);
    const widthIn = key === "widthIn" ? inches : size.widthIn;
    const depthIn = key === "depthIn" ? inches : size.depthIn;
    const action = { type: "RESIZE_FURNITURE", furnitureId: piece.id, widthIn, depthIn };
    if (key === "heightIn") action.heightIn = inches;
    return { action };
  }

  return { error: "That can't be resized here." };
}

/**
 * World-space point the size popup pins to: just above the top of the
 * selected entity, so it follows the entity as the camera orbits.
 */
export function popupAnchorForSelection(selection, design) {
  if (!selection || !design) return null;
  const wallHeightIn = design.settings?.wallHeightIn ?? 108;
  if (selection.kind === "wall") {
    const wall = findWall(design, selection.id);
    if (!wall) return null;
    return { x: (wall.a.x + wall.b.x) / 2, y: wallHeightIn + 6, z: (wall.a.y + wall.b.y) / 2 };
  }
  if (selection.kind === "opening") {
    const opening = (design.openings || []).find((o) => o.id === selection.id);
    const wall = opening && findWall(design, opening.wallId);
    const length = wall ? wallLength(wall) : 0;
    if (!wall || length === 0) return null;
    const t = (opening.offsetIn + opening.widthIn / 2) / length;
    return {
      x: wall.a.x + (wall.b.x - wall.a.x) * t,
      y: wallHeightIn + 6,
      z: wall.a.y + (wall.b.y - wall.a.y) * t,
    };
  }
  if (selection.kind === "furniture") {
    const piece = (design.furniture || []).find((f) => f.id === selection.id);
    if (!piece) return null;
    const { heightIn, mountIn } = pieceSize(piece);
    return { x: piece.x, y: mountIn + (heightIn || 30) + 12, z: piece.y };
  }
  return null;
}
