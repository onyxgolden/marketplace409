// FORGE Capture region-picker overlay. Fullscreen transparent window on the
// target monitor; the user drags a rectangle in CSS px. On release we invoke
// `capture` with mode "region-overlay" — the backend closes this window
// before acquiring so the overlay never appears in its own capture.
"use strict";

function invoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

const sel = document.getElementById("sel");
const dims = document.getElementById("dims");
const hint = document.getElementById("hint");
let start = null;
let busy = false;

function rectOf(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function draw(r) {
  sel.style.display = "block";
  sel.style.left = r.x + "px";
  sel.style.top = r.y + "px";
  sel.style.width = r.w + "px";
  sel.style.height = r.h + "px";
  dims.style.display = "block";
  dims.style.left = r.x + "px";
  dims.style.top = r.y + r.h + 6 + "px";
  dims.textContent = `${Math.round(r.w)} x ${Math.round(r.h)}`;
}

document.addEventListener("mousedown", (e) => {
  if (busy || e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  hint.style.display = "none";
});

document.addEventListener("mousemove", (e) => {
  if (!start || busy) return;
  draw(rectOf(start, { x: e.clientX, y: e.clientY }));
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
