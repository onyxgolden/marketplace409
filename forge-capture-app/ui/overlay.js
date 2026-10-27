// FORGE Capture region-picker overlay — Snagit-style aiming.
//
// Fullscreen window on the target monitor. On open it asks the backend for
// a frozen frame (`region_pick_backdrop`) and draws crosshair lines, a
// magnifier loupe, and a live pixel readout over it. The user drags a
// rectangle in CSS px; on release we invoke `capture` with mode
// "region-overlay" — the backend closes this window before acquiring so the
// overlay never appears in its own capture. Esc / right-click cancels.
//
// C639 Option C (design verdict 2026-10-23): the page init shares ONE
// 5,000 ms budget across overlay_context + region_pick_backdrop + image
// decode — never 5 s per await. Image handlers are assigned BEFORE src,
// and the already-complete (cached) image resolves without waiting for an
// event that already fired. Until a verified backdrop exists the page shows
// an honest "preview unavailable" state and capture commit is DISABLED —
// no loupe, no pixel readout, no fake image, no blind selection. Esc /
// right-click / aim controls are live immediately and never wait for the
// preview.
//
// Pure geometry lives in overlay-core.js (unit-tested); this module owns
// the DOM, canvas, and IPC. The controller is a factory
// (`createOverlayController`) so tests can drive it with fake DOM and a
// controllable invoke; the real page wiring is at the bottom.
import {
  rectOf,
  dimsText,
  coordsText,
  loupeSourceRect,
  readoutPosition,
} from "./overlay-core.js";

const LOUPE_PX = 148;
const INIT_BUDGET_MS = 5000;

export function createOverlayController({
  els,
  invoke,
  doc = typeof document !== "undefined" ? document : null,
  win = typeof window !== "undefined" ? window : null,
  budgetMs = INIT_BUDGET_MS,
  now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now(),
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutFn = (id) => clearTimeout(id),
  // Phase diagnostics: reported to the backend ring log (fire-and-forget).
  // Overridable in tests.
  reportPhase = (phase, ms, detail) =>
    invoke("capture_overlay_phase", { phase, ms, detail }),
}) {
  let start = null;
  let busy = false;
  let dpr = (win && win.devicePixelRatio) || 1;
  let backdropReady = false;
  // Generation: supersedes in-flight inits (e.g. a retry racing a slow
  // first load) so a late arrival can never clobber the current session.
  let gen = 0;

  function showAimTools() {
    // Crosshairs stay up while dragging (the OS cursor is hidden); the
    // loupe and readout stand down so the selection stays readable.
    // The crosshair never depends on the frozen backdrop: even when the
    // preview is unavailable the drag picker (and Esc) must keep working.
    const cross = !busy;
    const hover = backdropReady && cross && !start;
    els.chV.style.display = cross ? "block" : "none";
    els.chH.style.display = cross ? "block" : "none";
    els.loupe.style.display = hover ? "block" : "none";
    els.coords.style.display = hover ? "block" : "none";
  }

  function drawLoupe(xCss, yCss) {
    const nw = els.backdrop.naturalWidth;
    const nh = els.backdrop.naturalHeight;
    if (!nw || !nh) return;
    const r = loupeSourceRect(
      xCss,
      yCss,
      nw,
      nh,
      win.innerWidth,
      win.innerHeight
    );
    els.lctx.imageSmoothingEnabled = false;
    els.lctx.clearRect(0, 0, LOUPE_PX, LOUPE_PX);
    els.lctx.drawImage(els.backdrop, r.sx, r.sy, r.sw, r.sh, 0, 0, LOUPE_PX, LOUPE_PX);
    // Center marker on the exact pixel under the cursor.
    const mx = (r.centerX / r.sw) * LOUPE_PX;
    const my = (r.centerY / r.sh) * LOUPE_PX;
    els.lctx.strokeStyle = "#d99a3d";
    els.lctx.lineWidth = 1;
    els.lctx.beginPath();
    els.lctx.moveTo(mx - 7, my);
    els.lctx.lineTo(mx + 7, my);
    els.lctx.moveTo(mx, my - 7);
    els.lctx.lineTo(mx, my + 7);
    els.lctx.stroke();
    els.lctx.strokeStyle = "rgba(0,0,0,0.6)";
    els.lctx.strokeRect(mx - 3.5, my - 3.5, 7, 7);
  }

  function positionAimTools(xCss, yCss) {
    els.chV.style.left = xCss + "px";
    els.chH.style.top = yCss + "px";
    // Loupe follows the cursor; readoutPosition flips it inside the window
    // near the edges.
    const loupePos = readoutPosition(
      xCss,
      yCss,
      win.innerWidth,
      win.innerHeight,
      LOUPE_PX,
      LOUPE_PX
    );
    els.loupe.style.left = loupePos.left + "px";
    els.loupe.style.top = loupePos.top + "px";
    drawLoupe(xCss, yCss);
    els.coords.textContent = coordsText(xCss, yCss, dpr);
    const coordsPos = readoutPosition(
      xCss,
      yCss,
      win.innerWidth,
      win.innerHeight,
      110,
      26
    );
    els.coords.style.left = coordsPos.left + "px";
    els.coords.style.top = coordsPos.top + "px";
  }

  function drawSelection(r) {
    els.sel.style.display = "block";
    els.sel.style.left = r.x + "px";
    els.sel.style.top = r.y + "px";
    els.sel.style.width = r.w + "px";
    els.sel.style.height = r.h + "px";
    els.dims.style.display = "block";
    els.dims.style.left = r.x + "px";
    els.dims.style.top = r.y + r.h + 6 + "px";
    els.dims.textContent = dimsText(r.w, r.h, dpr);
  }

  function withDeadline(promise, deadline, what) {
    return new Promise((resolve, reject) => {
      const ms = Math.max(0, deadline - now());
      const t = setTimeoutFn(
        () => reject(new Error(`${what} did not complete in time`)),
        ms
      );
      promise.then(
        (v) => {
          clearTimeoutFn(t);
          resolve(v);
        },
        (e) => {
          clearTimeoutFn(t);
          reject(e);
        }
      );
    });
  }

  function setLoading(loading) {
    if (loading) {
      els.hint.style.display = "block";
      els.hint.textContent = "Loading preview…";
    } else {
      els.hint.style.display = "none";
    }
  }

  function showPreviewUnavailable(show, err) {
    if (show) {
      // Honest degradation: no frozen frame, no loupe, no pixel readout,
      // no fake image — and capture commit stays disabled until a verified
      // backdrop exists. Esc cancels; Retry reloads.
      els.hint.style.display = "block";
      els.hint.textContent =
        "Preview unavailable — drag-select is disabled. Press Esc to cancel or Retry to reload." +
        (err ? ` (${err.message || err})` : "");
      backdropReady = false;
    } else {
      els.hint.style.display = "none";
    }
  }

  function loadBackdropImage(pngB64, deadline) {
    return withDeadline(
      new Promise((resolve, reject) => {
        const img = els.backdrop;
        // Handlers BEFORE src — and the already-complete (cached) image
        // must not wait for an event that fired before we attached.
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("backdrop image failed to decode"));
        img.src = "data:image/png;base64," + pngB64;
        if (img.complete) {
          if (img.naturalWidth > 0) resolve();
          else reject(new Error("backdrop image failed to decode"));
        }
      }),
      deadline,
      "backdrop image"
    );
  }

  async function init() {
    const myGen = ++gen;
    const deadline = now() + budgetMs;
    backdropReady = false;
    setLoading(true);
    // Aim controls and escape hatches are live immediately — they never
    // wait for preview pixels.
    showAimTools();
    // Phase markers for the backend ring log (C639 §5): frontend markers
    // are namespaced "overlay.*" so they stay distinguishable from native
    // markers. Fire-and-forget; diagnostics never break the picker.
    const t0 = now();
    const mark = (phase, detail) => {
      try {
        const p = reportPhase(phase, Math.round(now() - t0), detail || null);
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        /* ignore */
      }
    };
    mark("page_boot");
    try {
      const ctx = await withDeadline(
        invoke("overlay_context"),
        deadline,
        "overlay_context"
      );
      mark("context");
      if (ctx && ctx.dpr) dpr = ctx.dpr;
      // Blank-frame warning: the frozen frame came back a single solid
      // color. Retry re-captures with the picker hidden; proceed picks on
      // the frame as-is (legit for a truly solid-color desktop); Esc still
      // cancels.
      if (ctx && ctx.backdrop_blank) els.blankwarn.style.display = "block";
    } catch {
      /* fall back to window.devicePixelRatio; the backdrop step decides */
    }
    if (myGen !== gen) return;
    try {
      const shot = await withDeadline(
        invoke("region_pick_backdrop"),
        deadline,
        "region_pick_backdrop"
      );
      mark("backdrop");
      if (myGen !== gen) return;
      await loadBackdropImage(shot.png_b64, deadline);
      mark("image");
      if (myGen !== gen) return;
      els.backdrop.style.display = "block";
      backdropReady = true;
      setLoading(false);
      showPreviewUnavailable(false);
      mark("aim_ready");
    } catch (err) {
      if (myGen !== gen) return;
      mark("preview_unavailable", (err && err.message) || String(err));
      showPreviewUnavailable(true, err);
    }
    showAimTools();
  }

  async function onRetry() {
    els.bwRetry.disabled = true;
    try {
      const deadline = now() + budgetMs;
      await withDeadline(
        invoke("retry_region_backdrop"),
        deadline,
        "retry_region_backdrop"
      );
      // Re-read the session: the retry stored a fresh frame and an updated
      // blank flag, so the warning reappears only if still blank.
      els.blankwarn.style.display = "none";
      backdropReady = false;
      els.backdrop.removeAttribute("src");
      await init();
    } catch (err) {
      els.hint.style.display = "block";
      els.hint.textContent = `Retry failed: ${err.message || err}`;
    } finally {
      els.bwRetry.disabled = false;
    }
  }

  async function onMouseUp(e) {
    if (!start || busy || e.button !== 0) return;
    busy = true;
    const r = rectOf(start, { x: e.clientX, y: e.clientY });
    start = null;
    if (r.w < 4 || r.h < 4) {
      // Accidental click: cancel rather than capture a sliver.
      await invoke("cancel_region_pick");
      return;
    }
    if (!backdropReady) {
      // No verified backdrop: capture commit stays disabled. Never call a
      // blind selection a success.
      busy = false;
      showPreviewUnavailable(true);
      showAimTools();
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
      busy = false;
      els.hint.style.display = "block";
      els.hint.textContent = `Capture failed: ${err.message || err}`;
      setTimeoutFn(() => invoke("cancel_region_pick"), 2500);
      showAimTools();
    }
  }

  function wireStaticControls() {
    doc.addEventListener("mousemove", (e) => {
      if (busy) return;
      if (start) {
        drawSelection(rectOf(start, { x: e.clientX, y: e.clientY }));
        return;
      }
      // The crosshair tracks the cursor even when the frozen preview failed
      // to load — drawLoupe no-ops without frame pixels and the loupe/readout
      // stay hidden until backdropReady, but aiming must never freeze.
      positionAimTools(e.clientX, e.clientY);
      showAimTools();
    });

    els.bwRetry.addEventListener("click", onRetry);
    els.bwProceed.addEventListener("click", () => {
      els.blankwarn.style.display = "none";
    });

    doc.addEventListener("mousedown", (e) => {
      if (busy || e.button !== 0) return;
      // Clicks on the blank-frame warning buttons are UI clicks, not the
      // start of a drag-select.
      if (e.target.closest("#blankwarn")) return;
      start = { x: e.clientX, y: e.clientY };
      els.hint.style.display = "none";
      // Starting a drag is an implicit "proceed" on a blank frame.
      els.blankwarn.style.display = "none";
      showAimTools();
    });

    doc.addEventListener("mouseup", onMouseUp);

    doc.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !busy) invoke("cancel_region_pick");
    });

    // Right-click also cancels (a deliberate, discoverable escape hatch).
    doc.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!busy) invoke("cancel_region_pick");
    });
  }

  return {
    init,
    onRetry,
    onMouseUp,
    wireStaticControls,
    showAimTools,
    // Test introspection only.
    _state: () => ({ busy, backdropReady, dpr, gen }),
  };
}

// ---------------------------------------------------------------------------
// Real page wiring (browser only — skipped when imported by the node test
// harness).
// ---------------------------------------------------------------------------

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const els = {
    backdrop: document.getElementById("backdrop"),
    chV: document.getElementById("ch-v"),
    chH: document.getElementById("ch-h"),
    loupe: document.getElementById("loupe"),
    coords: document.getElementById("coords"),
    sel: document.getElementById("sel"),
    dims: document.getElementById("dims"),
    hint: document.getElementById("hint"),
    blankwarn: document.getElementById("blankwarn"),
    bwRetry: document.getElementById("bw-retry"),
    bwProceed: document.getElementById("bw-proceed"),
  };
  els.lctx = els.loupe.getContext("2d");

  const controller = createOverlayController({
    els,
    invoke: (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args),
  });
  controller.wireStaticControls();
  document.addEventListener("DOMContentLoaded", () => controller.init());
}
