// FORGE Capture region-picker overlay — Snagit-style aiming.
//
// Fullscreen window on the target monitor. On open it asks the backend for
// a frozen frame (`region_pick_backdrop`) and draws crosshair lines, a
// magnifier loupe, and a live pixel readout over it. The user drags a
// rectangle in CSS px; on release we invoke `capture` with mode
// "region-overlay" — the backend closes this window before acquiring so the
// overlay never appears in its own capture. Esc / right-click cancels.
//
// Pure geometry lives in overlay-core.js (unit-tested); this module owns
// the DOM, canvas, and IPC.
import {
  rectOf,
  dimsText,
  coordsText,
  loupeSourceRect,
  readoutPosition,
} from "./overlay-core.js";

function invoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

const backdrop = document.getElementById("backdrop");
const chV = document.getElementById("ch-v");
const chH = document.getElementById("ch-h");
const loupe = document.getElementById("loupe");
const lctx = loupe.getContext("2d");
const coords = document.getElementById("coords");
const sel = document.getElementById("sel");
const dims = document.getElementById("dims");
const hint = document.getElementById("hint");

const LOUPE_PX = 148;
let start = null;
let busy = false;
let dpr = window.devicePixelRatio || 1;
let backdropReady = false;

function showAimTools() {
  // Crosshairs stay up while dragging (the OS cursor is hidden); the
  // loupe and readout stand down so the selection stays readable.
  const cross = backdropReady && !busy;
  const hover = cross && !start;
  chV.style.display = cross ? "block" : "none";
  chH.style.display = cross ? "block" : "none";
  loupe.style.display = hover ? "block" : "none";
  coords.style.display = hover ? "block" : "none";
}

function drawLoupe(xCss, yCss) {
  const nw = backdrop.naturalWidth;
  const nh = backdrop.naturalHeight;
  if (!nw || !nh) return;
  const r = loupeSourceRect(xCss, yCss, nw, nh, window.innerWidth, window.innerHeight);
  lctx.imageSmoothingEnabled = false;
  lctx.clearRect(0, 0, LOUPE_PX, LOUPE_PX);
  lctx.drawImage(backdrop, r.sx, r.sy, r.sw, r.sh, 0, 0, LOUPE_PX, LOUPE_PX);
  // Center marker on the exact pixel under the cursor.
  const mx = (r.centerX / r.sw) * LOUPE_PX;
  const my = (r.centerY / r.sh) * LOUPE_PX;
  lctx.strokeStyle = "#d99a3d";
  lctx.lineWidth = 1;
  lctx.beginPath();
  lctx.moveTo(mx - 7, my);
  lctx.lineTo(mx + 7, my);
  lctx.moveTo(mx, my - 7);
  lctx.lineTo(mx, my + 7);
  lctx.stroke();
  lctx.strokeStyle = "rgba(0,0,0,0.6)";
  lctx.strokeRect(mx - 3.5, my - 3.5, 7, 7);
}

function positionAimTools(xCss, yCss) {
  chV.style.left = xCss + "px";
  chH.style.top = yCss + "px";
  // Loupe follows the cursor; readoutPosition flips it inside the window
  // near the edges.
  const loupePos = readoutPosition(
    xCss,
    yCss,
    window.innerWidth,
    window.innerHeight,
    LOUPE_PX,
    LOUPE_PX
  );
  loupe.style.left = loupePos.left + "px";
  loupe.style.top = loupePos.top + "px";
  drawLoupe(xCss, yCss);
  coords.textContent = coordsText(xCss, yCss, dpr);
  const coordsPos = readoutPosition(
    xCss,
    yCss,
    window.innerWidth,
    window.innerHeight,
    110,
    26
  );
  coords.style.left = coordsPos.left + "px";
  coords.style.top = coordsPos.top + "px";
}

function drawSelection(r) {
  sel.style.display = "block";
  sel.style.left = r.x + "px";
  sel.style.top = r.y + "px";
  sel.style.width = r.w + "px";
  sel.style.height = r.h + "px";
  dims.style.display = "block";
  dims.style.left = r.x + "px";
  dims.style.top = r.y + r.h + 6 + "px";
  dims.textContent = dimsText(r.w, r.h, dpr);
}

async function init() {
  try {
    const ctx = await invoke("overlay_context");
    if (ctx && ctx.dpr) dpr = ctx.dpr;
  } catch {
    /* fall back to window.devicePixelRatio */
  }
  try {
    const shot = await invoke("region_pick_backdrop");
    backdrop.src = "data:image/png;base64," + shot.png_b64;
    await new Promise((resolve, reject) => {
      backdrop.onload = resolve;
      backdrop.onerror = reject;
    });
    backdrop.style.display = "block";
    backdropReady = true;
  } catch {
    // Honest degradation: no frozen frame, no loupe — the drag picker
    // still works exactly as before.
    hint.textContent = "Drag to select a region — Esc cancels (preview unavailable)";
  }
  showAimTools();
}

document.addEventListener("mousemove", (e) => {
  if (busy) return;
  if (start) {
    drawSelection(rectOf(start, { x: e.clientX, y: e.clientY }));
    return;
  }
  if (backdropReady) positionAimTools(e.clientX, e.clientY);
  showAimTools();
});

document.addEventListener("mousedown", (e) => {
  if (busy || e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  hint.style.display = "none";
  showAimTools();
});

document.addEventListener("mouseup", async (e) => {
  if (!start || busy || e.button !== 0) return;
  busy = true;
  const r = rectOf(start, { x: e.clientX, y: e.clientY });
  start = null;
  if (r.w < 4 || r.h < 4) {
    // Accidental click: cancel rather than capture a sliver.
    await invoke("cancel_region_pick");
    return;
  }
  try {
    await invoke("capture", {
      dto: {
        mode: "region-overlay",
        monitorId: null,
        windowId: null,
        region: null,
        overlayRect: r,
        // Ignored for region-overlay: the backend applies the delay/cursor
        // selections recorded by begin_region_pick (this page cannot see
        // the main window's controls).
        delayMs: 0,
        includeCursor: false,
      },
    });
    // The backend closed this window before capturing; nothing left to do.
  } catch (err) {
    // Surface the failure briefly, then cancel so the user is not stuck on
    // a dead overlay.
    hint.style.display = "block";
    hint.textContent = `Capture failed: ${err}`;
    setTimeout(() => invoke("cancel_region_pick"), 2500);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !busy) invoke("cancel_region_pick");
});

// Right-click also cancels (a deliberate, discoverable escape hatch).
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (!busy) invoke("cancel_region_pick");
});

document.addEventListener("DOMContentLoaded", init);
