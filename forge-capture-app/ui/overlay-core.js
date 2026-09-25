// FORGE Capture — region-picker overlay math (ui/overlay-core.js).
//
// Framework-neutral, DOM-free pure logic for the Snagit-style region
// picker: frozen-frame crosshairs, magnifier loupe geometry, and live
// pixel readouts. Runs unmodified under vitest (node) and in the Tauri
// webview; overlay.js owns the DOM/canvas.

/// Rectangle spanning two points (CSS px), normalized to positive w/h.
export function rectOf(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/// CSS px → physical px using the overlay's devicePixelRatio. Mirrors the
/// backend's `coords::css_to_physical` scale step (the backend adds the
/// monitor's virtual-desktop origin on top).
export function cssToPhysical(cssPx, dpr) {
  return Math.round(cssPx * dpr);
}

export function dimsText(wCss, hCss, dpr) {
  return `${cssToPhysical(wCss, dpr)} x ${cssToPhysical(hCss, dpr)}`;
}

export function coordsText(xCss, yCss, dpr) {
  return `${cssToPhysical(xCss, dpr)}, ${cssToPhysical(yCss, dpr)}`;
}

/// Clamp a value into [min, max].
export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Source rectangle (natural/backdrop px) for the magnifier loupe centered
 * on the cursor.
 *
 * @param {number} xCss cursor x in CSS px (overlay-window coordinates)
 * @param {number} yCss cursor y in CSS px
 * @param {number} naturalW backdrop natural width (physical px)
 * @param {number} naturalH backdrop natural height
 * @param {number} clientW overlay window CSS width
 * @param {number} clientH overlay window CSS height
 * @param {number} halfCss half the loupe's source span in CSS px
 * @returns {{sx,sy,sw,sh,centerX,centerY}} source rect + the cursor's
 *          position inside it (natural px), clamped to the image bounds.
 */
export function loupeSourceRect(xCss, yCss, naturalW, naturalH, clientW, clientH, halfCss = 17) {
  const scaleX = naturalW / clientW;
  const scaleY = naturalH / clientH;
  const cx = xCss * scaleX;
  const cy = yCss * scaleY;
  const halfW = halfCss * scaleX;
  const halfH = halfCss * scaleY;
  const sw = Math.min(naturalW, halfW * 2);
  const sh = Math.min(naturalH, halfH * 2);
  const sx = clamp(cx - sw / 2, 0, Math.max(0, naturalW - sw));
  const sy = clamp(cy - sh / 2, 0, Math.max(0, naturalH - sh));
  return { sx, sy, sw, sh, centerX: cx - sx, centerY: cy - sy };
}

/// Where to place the live readout so it never leaves the window.
export function readoutPosition(xCss, yCss, clientW, clientH, boxW, boxH, margin = 12) {
  let left = xCss + 18;
  let top = yCss + 18;
  if (left + boxW > clientW - margin) left = xCss - boxW - 18;
  if (top + boxH > clientH - margin) top = yCss - boxH - 18;
  return { left: Math.max(margin, left), top: Math.max(margin, top) };
}
