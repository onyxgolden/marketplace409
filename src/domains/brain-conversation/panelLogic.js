// FORGE Brain conversation harness — panel drag math (Q1).
//
// The icon lives at a viewport-percentage position so it survives resizes and
// sessions. Drag math is pure: given the drag start (percent), the pointer
// delta (pixels), and the viewport (pixels), the new position is the start
// plus the delta as a percentage, clamped to the viewport.

import { clampPercent } from "./preferences.js";

export function dragPosition({
  startX,
  startY,
  deltaXPixels,
  deltaYPixels,
  viewportWidth,
  viewportHeight,
}) {
  const width = viewportWidth > 0 ? viewportWidth : 1;
  const height = viewportHeight > 0 ? viewportHeight : 1;
  return {
    x: clampPercent(startX + (deltaXPixels / width) * 100),
    y: clampPercent(startY + (deltaYPixels / height) * 100),
  };
}

export function dragDistancePixels(deltaXPixels, deltaYPixels) {
  return Math.hypot(deltaXPixels, deltaYPixels);
}

// Pointer moves smaller than this are a tap (expand/collapse), not a drag.
export const DRAG_TAP_THRESHOLD_PIXELS = 4;
