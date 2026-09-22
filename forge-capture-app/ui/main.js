// FORGE Capture main window: plain script, no bundler. Talks to the Rust
// backend through the Tauri v2 `__TAURI_INTERNALS__.invoke` bridge. (No
// @tauri-apps/api dependency: the invoke IPC is stable and this keeps the
// shell dependency-free on the frontend side.)
"use strict";

function invoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

async function refreshLists() {
  try {
    const [monitors, windows, dir] = await Promise.all([
      invoke("list_monitors"),
      invoke("list_windows"),
      invoke("captures_dir_path"),
    ]);
    const monitorSel = $("monitor");
    monitorSel.innerHTML = "";
    for (const m of monitors) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.name} — ${m.size_logical[0]}x${m.size_logical[1]} @ ${m.scale}x`;
      monitorSel.appendChild(opt);
    }
    const windowSel = $("window");
    windowSel.innerHTML = "";
    const scrollWindowSel = $("scroll-window");
    scrollWindowSel.innerHTML = "";
    for (const w of windows) {
      const opt = document.createElement("option");
      opt.value = w.window_id;
      const proc = w.process_name ? ` (${w.process_name})` : "";
      opt.textContent = `${w.title || "(untitled)"}${proc}`;
      windowSel.appendChild(opt);
      scrollWindowSel.appendChild(opt.cloneNode(true));
    }
    $("captures-dir").textContent = dir;
    setStatus(`Ready — ${monitors.length} monitor(s), ${windows.length} window(s).`);
  } catch (e) {
    setStatus(`Cannot list monitors/windows: ${e}`, "error");
  }
}

function onModeChange() {
  const mode = $("mode").value;
  $("monitor-row").hidden = mode === "window";
  $("window-row").hidden = mode !== "window";
}

function onScrollTargetChange() {
  const kind = $("scroll-target-kind").value;
  $("scroll-window-row").hidden = kind !== "window";
  $("scroll-region-rows").hidden = kind !== "region";
}

let scrollRunId = null;

function setScrollStatus(text, kind) {
  const el = $("scroll-status");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

function scrollControlsRunning(running) {
  $("scroll-btn").disabled = running;
  $("scroll-stop-btn").hidden = !running;
}

async function doScrollCapture() {
  const kind = $("scroll-target-kind").value;
  const dto = {
    target: { type: kind },
    engine: $("scroll-engine").value,
    direction: $("scroll-direction").value,
  };
  if (kind === "window") {
    dto.target.windowId = $("scroll-window").value || null;
  } else {
    dto.target.region = {
      x: Number($("scroll-x").value) || 0,
      y: Number($("scroll-y").value) || 0,
      w: Math.max(1, Number($("scroll-w").value) || 1),
      h: Math.max(1, Number($("scroll-h").value) || 1),
    };
  }
  try {
    scrollRunId = await invoke("start_scroll_capture", { dto });
    scrollControlsRunning(true);
    setScrollStatus("Scrolling… tiles will appear below as they land.");
  } catch (e) {
    setScrollStatus(`Could not start scrolling capture: ${e}`, "error");
  }
}

async function doScrollStop() {
  if (!scrollRunId) return;
  try {
    await invoke("stop_scroll_capture", { id: scrollRunId });
    setScrollStatus("Stopping… the run will report what it captured.");
  } catch (e) {
    setScrollStatus(`Stop failed: ${e}`, "error");
  }
}

function onScrollProgress(dto) {
  if (!dto || dto.id !== scrollRunId) return;
  const expected = dto.tiles_expected ? ` of ~${dto.tiles_expected}` : "";
  setScrollStatus(`Scrolling… ${dto.tiles_captured}${expected} tiles, ${dto.distance_px}px.`);
}

function onScrollFinished(result) {
  if (!result || result.id !== scrollRunId) return;
  scrollRunId = null;
  scrollControlsRunning(false);
  const scroll = result.scroll;
  const info = scroll
    ? ` (${scroll.engine}, ${scroll.direction}, ${scroll.tiles_captured} tiles, ${scroll.distance_px}px)`
    : "";
  if (result.outcome === "complete" && result.capture) {
    captureItem(result.capture);
    setScrollStatus(`Scrolling capture complete${info}.`, "ok");
    return;
  }
  if (result.outcome === "incomplete") {
    // Honest partial: show the reason and evidence, and still surface the
    // partial stitch (Copy / Export / Provenance all work on it).
    if (result.capture) captureItem(result.capture);
    const evidence = (result.evidence || []).join(" | ");
    setScrollStatus(
      `Incomplete${info}: ${result.reason || "stopped early"}. ${evidence}`,
      "warning"
    );
    return;
  }
  const evidence = (result.evidence || []).join(" | ");
  setScrollStatus(`Scrolling capture failed: ${result.reason || "unknown"}. ${evidence}`, "error");
}

const seenCaptureIds = new Set();

function captureItem(ref) {
  // The backend emits capture-saved for EVERY capture, and direct callers
  // also add the returned ref: without this guard each main-window capture
  // would appear twice in the list.
  if (!ref || seenCaptureIds.has(ref.id)) return;
  seenCaptureIds.add(ref.id);
  const li = document.createElement("li");
  const title = document.createElement("div");
  title.textContent = `${ref.kind} — ${ref.width}x${ref.height}`;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = ref.png_path;
  const actions = document.createElement("div");
  actions.className = "actions";

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy";
  copyBtn.onclick = async () => {
    try {
      await invoke("copy_to_clipboard", { id: ref.id });
      setStatus("Copied to clipboard.", "ok");
    } catch (e) {
      setStatus(`Copy failed: ${e}`, "error");
    }
  };

  const exportBtn = document.createElement("button");
  exportBtn.textContent = "Export…";
  exportBtn.onclick = async () => {
    try {
      const path = await invoke("export_capture", { id: ref.id });
      setStatus(`Exported to ${path}`, "ok");
    } catch (e) {
      setStatus(`Export failed: ${e}`, "error");
    }
  };

  const metaBtn = document.createElement("button");
  metaBtn.textContent = "Provenance";
  metaBtn.onclick = async () => {
    try {
      const sidecar = await invoke("get_sidecar", { id: ref.id });
      const pretty = JSON.stringify(JSON.parse(sidecar), null, 2);
      setStatus(pretty);
    } catch (e) {
      setStatus(`Provenance failed: ${e}`, "error");
    }
  };

  // Rung 5 — opt-in "Save to FORGE". Fail closed: with no stored session the
  // button offers sign-in and never uploads.
  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save to FORGE";
  saveBtn.setAttribute("data-forge-save", "1");
  saveBtn.onclick = () => void window.ForgeSaveUI.saveToForge({
    button: saveBtn,
    actions,
    setStatusFn: setStatus,
    getPayload: async () => {
      const payload = await invoke("get_capture_upload_payload", { id: ref.id });
      const bin = atob(payload.bytes_b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (!ref.forgeCaptureId) ref.forgeCaptureId = window.ForgeUpload.newCaptureId();
      return {
        bytes,
        mime: payload.mime,
        kind: "screenshot",
        title: `${ref.kind} — ${ref.width}x${ref.height}`,
        width: ref.width,
        height: ref.height,
        captureId: ref.forgeCaptureId,
      };
    },
  });

  actions.append(copyBtn, exportBtn, metaBtn, saveBtn);
  li.append(title, meta, actions);
  $("captures").prepend(li);
}

/// Rung 5 — shared "Save to FORGE" driver for screenshots (main.js) and
/// recordings (record.js). Exposed on window for the record.js module.
async function saveToForge({ button, actions, setStatusFn, getPayload }) {
  const F = window.ForgeUpload;
  if (!F) {
    setStatusFn("Save to FORGE is unavailable in this build.", "error");
    return;
  }
  const baseUrl = F.resolveBaseUrl();
  await F.runForgeSave({
    invoke,
    baseUrl,
    button,
    setStatus: setStatusFn,
    getPayload,
    afterSave: (result) => {
      // The web library view ships in a later rung; until then the button
      // copies the deep link instead of navigating anywhere.
      const linkBtn = document.createElement("button");
      linkBtn.textContent = "Copy link";
      linkBtn.onclick = async () => {
        try {
          await invoke("copy_text_to_clipboard", { text: F.libraryLink(baseUrl, result.id) });
          setStatusFn("Library link copied — the web library view ships in a later rung.", "ok");
        } catch (e) {
          setStatusFn(`Copy failed: ${e}`, "error");
        }
      };
      actions.append(linkBtn);
    },
  });
}

/// Rung 5 — probes the OS credential store once at startup so every
/// Save-to-FORGE button shows the honest label up front ("Sign in to FORGE"
/// when there is no session). Never uploads.
async function probeForgeSaveButtons() {
  const F = window.ForgeUpload;
  if (!F) return;
  let signedIn = false;
  try {
    signedIn = !!(await F.getUsableSession({ invoke, baseUrl: F.resolveBaseUrl() }));
  } catch {
    /* fail closed: the sign-in label stays */
  }
  document.querySelectorAll("button[data-forge-save]").forEach((b) => {
    if (b.textContent !== "Saved ✓") {
      b.textContent = signedIn ? "Save to FORGE" : "Sign in to FORGE";
    }
  });
}

window.ForgeSaveUI = { saveToForge, probeForgeSaveButtons };

async function doCapture() {
  const mode = $("mode").value;
  const delayMs = Math.max(0, Math.min(60, Number($("delay").value) || 0)) * 1000;
  const includeCursor = $("cursor").checked;
  const btn = $("capture-btn");
  btn.disabled = true;

  try {
    if (mode === "region-overlay") {
      // The overlay window drives the rest: it collects the drag rect and
      // calls `capture` itself with mode "region-overlay". The user's
      // delay/cursor selections travel with begin_region_pick because the
      // overlay page cannot see this window's controls.
      await invoke("begin_region_pick", {
        monitorId: $("monitor").value,
        delayMs,
        includeCursor,
      });
      setStatus("Drag a region on screen — Esc cancels.");
      return;
    }
    setStatus(delayMs > 0 ? `Capturing in ${delayMs / 1000}s…` : "Capturing…");
    const ref = await invoke("capture", {
      dto: {
        mode,
        monitorId: $("monitor").value || null,
        windowId: $("window").value || null,
        region: null,
        overlayRect: null,
        delayMs,
        includeCursor,
      },
    });
    captureItem(ref);
    setStatus(`Saved ${ref.width}x${ref.height}.`, "ok");
  } catch (e) {
    setStatus(`Capture failed: ${e}`, "error");
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  try {
    $("version").textContent = "v" + (await invoke("app_version"));
  } catch (e) {
    /* non-fatal */
  }
  $("mode").addEventListener("change", onModeChange);
  $("capture-btn").addEventListener("click", doCapture);
  $("refresh-btn").addEventListener("click", refreshLists);
  $("scroll-target-kind").addEventListener("change", onScrollTargetChange);
  $("scroll-btn").addEventListener("click", doScrollCapture);
  $("scroll-stop-btn").addEventListener("click", doScrollStop);
  onModeChange();
  onScrollTargetChange();
  await listenCaptureSaved();
  await listenScrollEvents();
  await refreshLists();
  // Rung 5: label every Save-to-FORGE button honestly up front.
  void probeForgeSaveButtons();
}

// Region captures originate from the overlay window (which closes itself
// before capturing), so the main window learns about them through this
// event. Vendored minimal listener over the Tauri v2 event IPC — no
// @tauri-apps/api dependency. Non-fatal if the internals ever change.
async function listenCaptureSaved() {
  await listenEvent("capture-saved", (msg) => {
    if (msg && msg.payload) captureItem(msg.payload);
  });
}

// Scrolling-capture progress and final outcome events from the backend
// worker thread.
async function listenScrollEvents() {
  await listenEvent("scroll-progress", (msg) => {
    if (msg && msg.payload) onScrollProgress(msg.payload);
  });
  await listenEvent("scroll-finished", (msg) => {
    if (msg && msg.payload) onScrollFinished(msg.payload);
  });
}

async function listenEvent(event, onMessage) {
  try {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.Channel !== "function") return;
    const channel = new internals.Channel();
    channel.onmessage = onMessage;
    await internals.invoke("plugin:event|listen", {
      event,
      target: { kind: "Any" },
      handler: channel,
    });
  } catch (e) {
    /* the session list just won't auto-update for this event */
  }
}

document.addEventListener("DOMContentLoaded", init);
