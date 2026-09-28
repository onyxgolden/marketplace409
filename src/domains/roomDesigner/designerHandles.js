// designerHandles.js — pure geometry behind the plan's on-canvas handles.
//
// Door swing: an opening may store `hinge` ("start" = its offset edge, the
// default; "end" = its far edge) and `swing` ("positive" = leaf opens to the
// wall's left-hand normal (dir.y, -dir.x), the default; "negative" = the
// other face). Both are optional so every existing design draws exactly as
// before.
//
// Rotation handle: Visio-style round handle above a selected piece; dragging
// it sets the piece's rotation (clockwise degrees, 0 = up), snapped.

export const DOOR_HINGES = Object.freeze(["start", "end"]);
export const DOOR_SWINGS = Object.freeze(["positive", "negative"]);

/** Screen distance of the door flip handles from the door geometry. */
export const DOOR_HANDLE_OFFSET_PX = 14;
/** Screen gap between a piece's top edge and its rotation handle. */
export const ROTATION_HANDLE_GAP_PX = 28;
/** Default rotation-handle snap; the canvas passes 45 while Shift is held. */
export const ROTATION_SNAP_DEG = 15;

/** Effective hinge/swing of an opening, defaulting anything missing or invalid. */
export function doorSwingOf(opening) {
  const hinge = DOOR_HINGES.includes(opening?.hinge) ? opening.hinge : "start";
  const swing = DOOR_SWINGS.includes(opening?.swing) ? opening.swing : "positive";
  return { hinge, swing };
}

/**
 * Door geometry in plan inches (centerline of the wall):
 * hinge/latch points, closedDir (unit, hinge -> latch along the wall) and
 * openDir (unit normal on the face the leaf swings to). Null for a
 * degenerate wall.
 */
export function doorSwingFrame(wall, opening) {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  const dir = { x: dx / len, y: dy / len };
  const normal = { x: dir.y, y: -dir.x };
  const { hinge, swing } = doorSwingOf(opening);
  const along = (s) => ({ x: wall.a.x + dir.x * s, y: wall.a.y + dir.y * s });
  const start = along(opening.offsetIn);
  const end = along(opening.offsetIn + opening.widthIn);
  const sign = swing === "negative" ? -1 : 1;
  return {
    hinge: hinge === "end" ? end : start,
    latch: hinge === "end" ? start : end,
    closedDir: hinge === "end" ? { x: -dir.x, y: -dir.y } : dir,
    openDir: { x: normal.x * sign, y: normal.y * sign },
    widthIn: opening.widthIn,
  };
}

/**
 * Click targets for a selected door, in plan inches. "Click where you want
 * it": flipSwing sits on the face the door does NOT open to (mid-opening),
 * flipHinge sits just past the latch on the swing face.
 */
export function doorHandlePoints(frame, scale) {
  const off = DOOR_HANDLE_OFFSET_PX / scale;
  const mid = { x: (frame.hinge.x + frame.latch.x) / 2, y: (frame.hinge.y + frame.latch.y) / 2 };
  return {
    flipSwing: { x: mid.x - frame.openDir.x * off, y: mid.y - frame.openDir.y * off },
    flipHinge: {
      x: frame.latch.x + frame.closedDir.x * off + frame.openDir.x * off,
      y: frame.latch.y + frame.closedDir.y * off + frame.openDir.y * off,
    },
  };
}

/** Rotation handle position for a piece centred at (x, y), plan inches. */
export function rotationHandlePoint({ x, y, depthIn, rotationDeg = 0 }, scale) {
  const r = depthIn / 2 + ROTATION_HANDLE_GAP_PX / scale;
  const rad = (rotationDeg * Math.PI) / 180;
  // local "up" (0, -1) turned clockwise by rotationDeg (plan is y-down)
  return { x: x + Math.sin(rad) * r, y: y - Math.cos(rad) * r };
}

/**
 * Rotation for a pointer dragged around `center`: clockwise degrees from
 * straight up, snapped to `snapDeg`, normalized into 0..359. Null when the
 * pointer sits on the centre (no direction).
 */
export function angleFromPointer(center, pointer, { snapDeg = ROTATION_SNAP_DEG } = {}) {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  const raw = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const step = snapDeg > 0 ? snapDeg : 1;
  const snapped = Math.round(raw / step) * step;
  return ((Math.round(snapped) % 360) + 360) % 360;
}
