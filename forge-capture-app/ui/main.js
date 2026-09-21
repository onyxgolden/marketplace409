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
    for (const w of windows) {
      const opt = document.createElement("option");
      opt.value = w.window_id;
      const proc = w.process_name ? ` (${w.process_name})` : "";
      opt.textContent = `${w.title || "(untitled)"}${proc}`;
      windowSel.appendChild(opt);
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

  actions.append(copyBtn, exportBtn, metaBtn);
  li.append(title, meta, actions);
  $("captures").prepend(li);
}

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
  onModeChange();
  await listenCaptureSaved();
  await refreshLists();
}

// Region captures originate from the overlay window (which closes itself
// before capturing), so the main window learns about them through this
// event. Vendored minimal listener over the Tauri v2 event IPC — no
// @tauri-apps/api dependency. Non-fatal if the internals ever change.
async function listenCaptureSaved() {
  try {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.Channel !== "function") return;
    const channel = new internals.Channel();
    channel.onmessage = (msg) => {
      if (msg && msg.payload) captureItem(msg.payload);
    };
    await internals.invoke("plugin:event|listen", {
      event: "capture-saved",
      target: { kind: "Any" },
      handler: channel,
    });
  } catch (e) {
    /* the session list just won't auto-update for overlay captures */
  }
}

document.addEventListener("DOMContentLoaded", init);
