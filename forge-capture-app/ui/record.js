// FORGE Capture — Rung 4 recording UI orchestration (record.js).
//
// ES module (no bundler): loaded via <script type="module"> in index.html.
// Owns the DOM, getDisplayMedia, MediaRecorder, and the canvas compositor.
// All pure logic (mime selection, EBML trim/combine, GIF planning/encoding,
// overlay geometry) lives in record-core.js and is unit-tested under vitest.
//
// The Rust backend owns: cursor position (get_cursor_pos), monitor list
// (list_monitors), and chunked media file writes (begin/append/finish_media_upload).

import {
  RecordingError,
  RECORDING_TIMESLICE_MS,
  RECORDING_SOFT_LIMIT_BYTES,
  RECORDING_HARD_LIMIT_BYTES,
  RECORDING_DEFAULT_VIDEO_BITS_PER_SECOND,
  MEDIA_UPLOAD_CHUNK_BYTES,
  GIF_DEFAULT_FPS,
  probeRecordingSupport,
  pickRecordingMime,
  mp4RecordingSupported,
  describeRecordingBlocker,
  validateTrimRange,
  sniffWebm,
  trimWebm,
  combineWebm,
  planGifFrames,
  gifFrameSize,
  encodeGifFrames,
  resolveOverlayMapping,
  regionOverlayMapping,
  mapCursorToFrame,
  cursorOverlayGeometry,
} from "./record-core.js";

export { RecordingError };

const CURSOR_POLL_MS = 120;
const PREVIEW_REVOKE_DELAY_MS = 30000;

function defaultInvoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, "0")}`;
}

// --- canvas compositor ------------------------------------------------------
// Draws the captured frames and paints the cursor overlay on top, so the
// overlay is baked into the recording. The MediaRecorder records
// canvas.captureStream(), not the raw display stream.

export class Compositor {
  constructor({ width, height, crop = null, overlay = "highlight" }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RecordingError("invalid-compositor", "compositor needs positive integer dimensions");
    }
    this.width = width;
    this.height = height;
    this.crop = crop; // { x, y, w, h } in source-frame px, or null
    this.overlay = overlay;
    this.cursor = null;
    this.raf = 0;

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");

    // Offscreen dim layer for the spotlight (the hole is punched in the
    // dim layer only, never in the video frame beneath).
    this.dim = document.createElement("canvas");
    this.dim.width = width;
    this.dim.height = height;
    this.dimCtx = this.dim.getContext("2d");

    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;

    this.stream = this.canvas.captureStream(30);
  }

  async attach(sourceStream) {
    this.video.srcObject = sourceStream;
    await this.video.play();
  }

  setCursor(x, y) {
    this.cursor = { x, y };
  }

  clearCursor() {
    this.cursor = null;
  }

  start() {
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  draw() {
    const { ctx, video } = this;
    if (video.readyState >= 2) {
      if (this.crop) {
        ctx.drawImage(
          video,
          this.crop.x, this.crop.y, this.crop.w, this.crop.h,
          0, 0, this.width, this.height,
        );
      } else {
        ctx.drawImage(video, 0, 0, this.width, this.height);
      }
    }
    if (this.cursor && this.overlay && this.overlay !== "none") {
      const g = cursorOverlayGeometry({
        frameW: this.width,
        frameH: this.height,
        x: this.cursor.x,
        y: this.cursor.y,
        mode: this.overlay,
      });
      if (g.kind === "ring") {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 59, 48, 0.95)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 59, 48, 0.95)";
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (g.kind === "spotlight") {
        const d = this.dimCtx;
        d.clearRect(0, 0, this.width, this.height);
        d.fillStyle = "rgba(0, 0, 0, 0.55)";
        d.fillRect(0, 0, this.width, this.height);
        d.save();
        d.globalCompositeOperation = "destination-out";
        d.beginPath();
        d.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
        d.fill();
        d.restore();
        ctx.drawImage(this.dim, 0, 0);
      } else if (g.kind === "magnifier") {
        // drawImage(canvas, …) onto itself reads the current bitmap.
        ctx.save();
        ctx.drawImage(
          this.canvas,
          g.src.x, g.src.y, g.src.w, g.src.h,
          g.dest.x, g.dest.y, g.dest.w, g.dest.h,
        );
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(g.dest.x, g.dest.y, g.dest.w, g.dest.h);
        ctx.restore();
      }
    }
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* already stopped */
      }
    });
    this.video.srcObject = null;
  }
}

// --- recording session -------------------------------------------------------
// DOM-free except for the compositor (injected). Drives getDisplayMedia +
// MediaRecorder, enforces the in-memory size limits, and reports progress.

export class RecordingSession {
  constructor({ invoke = defaultInvoke, mediaDevices = null, Recorder = null, compositorFactory = null, monitors = [] } = {}) {
    this.invoke = invoke;
    this.mediaDevices = mediaDevices || (typeof navigator !== "undefined" ? navigator.mediaDevices : null);
    this.Recorder = Recorder || (typeof MediaRecorder !== "undefined" ? MediaRecorder : null);
    this.compositorFactory = compositorFactory || ((opts) => new Compositor(opts));
    this.monitors = monitors;
    this.state = "idle";
    this.listeners = { tick: [], warning: [], ended: [], error: [] };
    this.stopPromise = null; // in-flight stop(), shared by concurrent callers
    this.reset();
  }

  reset() {
    this.stream = null;
    this.recordStream = null;
    this.recorder = null;
    this.compositor = null;
    this.chunks = [];
    this.bytes = 0;
    this.mime = null;
    this.startTime = 0;
    this.durationMs = 0;
    this.cursorTimer = 0;
    this.stopTimer = 0;
    this.mapping = null;
    this.trackInfo = null;
    this.softWarned = false;
    this.maxDurationMs = 0;
    this.stopPromise = null;
  }

  on(event, fn) {
    if (this.listeners[event]) this.listeners[event].push(fn);
    return this;
  }

  emit(event, payload) {
    for (const fn of this.listeners[event] || []) {
      try {
        fn(payload);
      } catch {
        /* listener errors must not break the recording */
      }
    }
  }

  support() {
    const R = this.Recorder;
    return probeRecordingSupport({
      hasDisplayMedia: !!(this.mediaDevices && this.mediaDevices.getDisplayMedia),
      hasMediaRecorder: !!R,
      isTypeSupported: R && typeof R.isTypeSupported === "function" ? (...a) => R.isTypeSupported(...a) : undefined,
    });
  }

  async start({ mode = "monitor", region = null, cursorMode = "none", includeAudio = false, format = "webm", maxDurationMs = 0 } = {}) {
    if (this.state === "recording") throw new RecordingError("already-recording", "a recording is already in progress");
    this.reset();
    const support = this.support();
    if (!support.canRecord) {
      throw new RecordingError("unsupported", describeRecordingBlocker(support) || "recording is not supported here");
    }

    let mime;
    if (format === "mp4") {
      if (!mp4RecordingSupported((m) => this.Recorder.isTypeSupported(m))) {
        throw new RecordingError("unsupported", "this webview cannot encode MP4 — use WebM");
      }
      mime = "video/mp4";
    } else {
      mime = pickRecordingMime((m) => this.Recorder.isTypeSupported(m));
    }

    const displaySurface = mode === "window" ? "window" : "monitor"; // region crops a monitor capture
    let stream;
    try {
      stream = await this.mediaDevices.getDisplayMedia({
        video: { displaySurface },
        audio: !!includeAudio,
      });
    } catch (e) {
      throw new RecordingError(
        e && e.name === "NotAllowedError" ? "capture-denied" : "capture-failed",
        e && e.name === "NotAllowedError"
          ? "screen capture was dismissed — pick a screen, window, or tab and share it to record"
          : `could not start screen capture: ${(e && e.message) || e}`,
      );
    }
    this.stream = stream;

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      this.stopTracks();
      throw new RecordingError("no-video", "the shared source has no video track");
    }
    const s = videoTrack.getSettings();
    this.trackInfo = {
      displaySurface: s.displaySurface || "unknown",
      width: s.width || 0,
      height: s.height || 0,
      hasAudio: stream.getAudioTracks().length > 0,
    };

    // Compositor + cursor overlay. Overlays need a full-monitor capture so
    // OS cursor coordinates map 1:1 onto frame pixels; anything else gets
    // an honest warning and records without the overlay.
    let recordStream = stream;
    if (cursorMode && cursorMode !== "none") {
      const base = resolveOverlayMapping({ trackInfo: this.trackInfo, monitors: this.monitors });
      let mapping = null;
      let frameW = this.trackInfo.width;
      let frameH = this.trackInfo.height;
      let crop = null;
      if (mode === "region" && region) {
        const m = base ? regionOverlayMapping(base, region, region.w, region.h) : null;
        if (m) {
          mapping = m;
          frameW = Math.max(64, Math.round(region.w));
          frameH = Math.max(64, Math.round(region.h));
          // Crop rect in source-frame px: region is virtual-desktop px, the
          // base mapping's origin is too, and base scale is 1 when sizes matched.
          crop = {
            x: Math.round((region.x - base.offsetX) * base.scaleX),
            y: Math.round((region.y - base.offsetY) * base.scaleY),
            w: Math.round(region.w * base.scaleX),
            h: Math.round(region.h * base.scaleY),
          };
          // Clamp the crop inside the source frame.
          crop.x = Math.min(Math.max(crop.x, 0), Math.max(0, this.trackInfo.width - 1));
          crop.y = Math.min(Math.max(crop.y, 0), Math.max(0, this.trackInfo.height - 1));
          crop.w = Math.min(crop.w, this.trackInfo.width - crop.x);
          crop.h = Math.min(crop.h, this.trackInfo.height - crop.y);
        }
      } else if (base) {
        mapping = base;
      }
      if (mapping) {
        this.mapping = mapping;
        this.compositor = this.compositorFactory({ width: frameW, height: frameH, crop, overlay: cursorMode });
        await this.compositor.attach(stream);
        this.compositor.start();
        recordStream = this.compositor.stream;
        this.startCursorPoll();
      } else {
        this.emit("warning", {
          kind: "overlay-unavailable",
          message:
            "Cursor overlay needs a full-monitor capture whose size matches a known monitor — " +
            "recording without the overlay instead of drawing it in the wrong place.",
        });
      }
    }
    this.recordStream = recordStream;

    let recorder;
    try {
      recorder = new this.Recorder(recordStream, {
        mimeType: mime,
        videoBitsPerSecond: RECORDING_DEFAULT_VIDEO_BITS_PER_SECOND,
      });
    } catch (e) {
      this.stopTracks();
      throw new RecordingError("recorder-failed", `could not start the ${mime} encoder: ${(e && e.message) || e}`);
    }
    this.recorder = recorder;
    this.mime = mime;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
        this.bytes += e.data.size;
        if (this.bytes >= RECORDING_HARD_LIMIT_BYTES) {
          this.emit("warning", { kind: "hard-limit", message: "Recording hit the 1 GiB memory cap and was stopped." });
          void this.stop();
          return;
        }
        if (!this.softWarned && this.bytes >= RECORDING_SOFT_LIMIT_BYTES) {
          this.softWarned = true;
          this.emit("warning", { kind: "soft-limit", message: "Recording passed 500 MiB in memory — consider stopping soon." });
        }
        this.emit("tick", { elapsedMs: Date.now() - this.startTime, bytes: this.bytes });
      }
    };
    recorder.onerror = (e) => {
      this.emit("error", new RecordingError("recorder-error", `encoder error: ${(e && e.error && e.error.message) || "unknown"}`));
      // A failed encoder must never leave an active recording session behind.
      void this.stop();
    };
    videoTrack.onended = () => {
      if (this.state === "recording") {
        // Defect #3 fix: capture stop()'s result instead of discarding it
        // (`void this.stop()` built a valid blob and threw it away). The
        // "ended" payload now carries the same { blob, mime, durationMs,
        // byteLength, ... } shape onStop() resolves with, so a caller can
        // treat a track-end exactly like a manual stop — preview/save
        // offered, never silently lost.
        // FR1 (2026-11-13, PR #792 review P1): a rejected stop() used to
        // turn this IIFE into an unhandled rejection that never emitted
        // "ended" — the UI's only source-end recovery path got nothing.
        // Emit the failure as an ended-with-error result instead: the
        // session is still alive (stop() reset it to "recording"), so the
        // caller can retry Stop manually. Never swallow it silently.
        void (async () => {
          try {
            const result = await this.stop();
            this.emit("ended", {
              message: "The shared source ended (the browser picker was closed) — stopping.",
              result,
            });
          } catch (e) {
            this.emit("ended", {
              message: "The shared source ended (the browser picker was closed) — stopping.",
              result: null,
              error: e,
            });
          }
        })();
      }
    };

    this.maxDurationMs = maxDurationMs;
    this.state = "recording";
    this.startTime = Date.now();
    recorder.start(RECORDING_TIMESLICE_MS);
    if (maxDurationMs > 0) {
      this.stopTimer = setTimeout(() => {
        if (this.state === "recording") {
          this.emit("warning", { kind: "max-duration", message: "Reached the chosen max duration — stopping." });
          void this.stop();
        }
      }, maxDurationMs);
    }
    return { mime, trackInfo: this.trackInfo };
  }

  startCursorPoll() {
    if (this.cursorTimer) return;
    const poll = async () => {
      if (this.state !== "recording" || !this.compositor || !this.mapping) return;
      try {
        const pos = await this.invoke("get_cursor_pos");
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          const p = mapCursorToFrame(pos, this.mapping, this.compositor.width, this.compositor.height);
          this.compositor.setCursor(p.x, p.y);
        }
      } catch {
        /* cursor is decoration — never break the recording over it */
      }
    };
    void poll();
    this.cursorTimer = setInterval(poll, CURSOR_POLL_MS);
  }

  stopTracks() {
    for (const st of [this.stream, this.recordStream]) {
      if (st) {
        st.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* already stopped */
          }
        });
      }
    }
  }

  async stop() {
    // Idempotent: a second caller while a stop is in flight joins the same
    // promise instead of getting null or starting a second teardown.
    if (this.state === "stopping") return this.stopPromise;
    if (this.state !== "recording") return null;
    this.state = "stopping";
    this.stopPromise = this.finishStop();
    try {
      return await this.stopPromise;
    } catch (e) {
      // FR1 (2026-11-13, PR #792 review P1): a failed stop used to strand
      // the session in "stopping" forever (stopPromise nulled, so a retry
      // returned null) — no recovery path. The recorded chunks are still
      // in this.chunks, so return to "recording" and let the caller retry
      // the stop instead of leaving the bytes unreachable.
      this.state = "recording";
      throw e;
    } finally {
      this.stopPromise = null;
    }
  }

  // Internal: the actual teardown. Only runs via stop().
  async finishStop() {
    if (this.cursorTimer) {
      clearInterval(this.cursorTimer);
      this.cursorTimer = 0;
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = 0;
    }
    const frameW = this.compositor ? this.compositor.width : 0;
    const frameH = this.compositor ? this.compositor.height : 0;
    if (this.compositor) {
      try {
        this.compositor.dispose();
      } catch {
        /* ignore */
      }
      this.compositor = null;
    }
    const recorder = this.recorder;
    await new Promise((resolve) => {
      const done = () => resolve();
      recorder.onstop = done;
      try {
        recorder.stop();
      } catch {
        done();
      }
      // Safety net: never hang the UI if onstop never fires.
      setTimeout(done, 3000);
    });
    this.stopTracks();
    this.durationMs = Date.now() - this.startTime;
    const blob = new Blob(this.chunks, { type: this.mime });
    const result = {
      blob,
      mime: this.mime,
      durationMs: this.durationMs,
      byteLength: blob.size,
      width: frameW || this.trackInfo?.width || 0,
      height: frameH || this.trackInfo?.height || 0,
      trackInfo: this.trackInfo,
    };
    this.state = "stopped";
    return result;
  }

}

// --- chunked upload to the Rust backend ---------------------------------------

async function uploadBytes(invoke, { bytes, mime, suggestedExtension = null, nameHint = null }, onProgress) {
  const uploadId = await invoke("begin_media_upload", {
    dto: {
      totalBytes: bytes.length,
      mime,
      suggestedExtension: suggestedExtension,
      nameHint: nameHint,
    },
  });
  try {
    for (let off = 0; off < bytes.length; off += MEDIA_UPLOAD_CHUNK_BYTES) {
      const chunk = bytes.subarray(off, off + MEDIA_UPLOAD_CHUNK_BYTES);
      await invoke("append_media_chunk", {
        dto: { uploadId: uploadId, offset: off, bytes: Array.from(chunk) },
      });
      if (onProgress) onProgress(Math.min(bytes.length, off + chunk.length), bytes.length);
    }
    return await invoke("finish_media_upload", { id: uploadId });
  } catch (e) {
    try {
      await invoke("cancel_media_upload", { id: uploadId });
    } catch {
      /* best effort */
    }
    throw e;
  }
}

// --- GIF frame extraction --------------------------------------------------------
// Seeks a hidden <video> through the WebM blob and grabs canvas frames at
// the planned timestamps.

function seekVideo(video, seconds) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("video seek failed"));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("video seek timed out"));
    }, 8000);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try {
      video.currentTime = seconds;
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

async function extractGifFrames(blob, timestamps, width, height, onProgress) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("video metadata timed out")), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("could not play this recording for GIF export"));
      };
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const frames = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      await seekVideo(video, timestamps[i] / 1000);
      ctx.drawImage(video, 0, 0, width, height);
      frames.push(ctx.getImageData(0, 0, width, height).data);
      if (onProgress) onProgress(i + 1, timestamps.length);
    }
    return frames;
  } finally {
    video.src = "";
    URL.revokeObjectURL(url);
  }
}

// --- controls UI --------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "hidden") node.hidden = !!v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(c);
  }
  return node;
}

function label(text, control) {
  return el("label", {}, text, control);
}

/**
 * Render the recording controls into `container`.
 * deps: { invoke, mediaDevices, Recorder } — all optional; browser globals
 * are the default. Returns { destroy }.
 */
export function renderRecordControls(container, deps = {}) {
  const invoke = deps.invoke || defaultInvoke;
  const sessionDeps = {
    invoke,
    mediaDevices: deps.mediaDevices,
    Recorder: deps.Recorder,
    monitors: [],
  };

  const recordings = []; // { id, name, bytes, mime, durationMs, width, height, path, sizeBytes }
  let nextId = 1;
  let session = null;
  let previewUrl = null;
  let pendingResult = null; // { blob, byteArray, mime, durationMs, width, height }
  let busy = false;

  const section = el("section", { class: "card" });
  const supportNote = el("p", { class: "hint", id: "rec-support" });
  // Defect #2 fix: the Video tab had no always-visible storage location —
  // stills (main.js `#captures-dir`) and Test Audio (meeting.js `Saved to:`)
  // both show where a file lands; recordings only did after a successful
  // manual Save. This line is populated once below and never hidden.
  const capturesDirNote = el("p", { class: "hint", id: "rec-captures-dir" }, "Loading storage location…");
  section.append(
    el("h2", {}, "Screen recording"),
    el(
      "p",
      { class: "hint" },
      "Record the screen, a window, or a region to WebM (VP9/VP8) or MP4 — encoded by this machine, saved locally. ",
      "Nothing is uploaded anywhere; the file lands in the captures folder next to stills.",
    ),
    capturesDirNote,
    supportNote,
  );

  const modeSel = el(
    "select",
    { id: "rec-mode" },
    el("option", { value: "monitor" }, "Monitor"),
    el("option", { value: "window" }, "Window"),
    el("option", { value: "region" }, "Region (virtual-desktop px)"),
  );
  const regionRows = el(
    "div",
    { id: "rec-region-rows", hidden: true },
    el(
      "div",
      { class: "row" },
      label("X ", el("input", { id: "rec-x", type: "number", value: "0" })),
      label("Y ", el("input", { id: "rec-y", type: "number", value: "0" })),
    ),
    el(
      "div",
      { class: "row" },
      label("W ", el("input", { id: "rec-w", type: "number", value: "800" })),
      label("H ", el("input", { id: "rec-h", type: "number", value: "600" })),
    ),
    el("p", { class: "hint" }, "The region is cropped out of a full-monitor capture — the screen picker still asks which monitor to share."),
  );
  const formatSel = el(
    "select",
    { id: "rec-format" },
    el("option", { value: "webm" }, "WebM (recommended — trim, combine & GIF supported)"),
    el("option", { value: "mp4" }, "MP4 (only where this webview encodes it)"),
  );
  const cursorSel = el(
    "select",
    { id: "rec-cursor" },
    el("option", { value: "none" }, "None — OS cursor as captured"),
    el("option", { value: "highlight" }, "Highlight ring"),
    el("option", { value: "spotlight" }, "Spotlight"),
    el("option", { value: "magnifier" }, "Magnifier inset"),
  );
  const audioChk = el("input", { id: "rec-audio", type: "checkbox" });
  const maxSel = el(
    "select",
    { id: "rec-max" },
    el("option", { value: "0" }, "No limit"),
    el("option", { value: "60000" }, "1 minute"),
    el("option", { value: "300000" }, "5 minutes"),
    el("option", { value: "900000" }, "15 minutes"),
  );

  const startBtn = el("button", { id: "rec-start", class: "primary" }, "Start recording");
  const stopBtn = el("button", { id: "rec-stop", hidden: true }, "Stop");
  // FR1 (2026-11-13, PR #792 review P1): shown only when a stop result
  // could not be turned into a preview (blob.arrayBuffer() failed). The
  // bytes are retained in pendingResult, so retrying the conversion can
  // still recover the recording instead of losing it silently.
  const retryBtn = el("button", { id: "rec-retry-preview", hidden: true }, "Retry preview");
  const status = el("p", { class: "status", role: "status", id: "rec-status" });

  section.append(
    label("Source ", modeSel),
    regionRows,
    label("Format ", formatSel),
    label("Cursor overlay ", cursorSel),
    el("p", { class: "hint" }, "Cursor overlays need a full-monitor capture whose size matches a known monitor. Window captures record without the overlay rather than drawing it in the wrong place."),
    label("Max length ", maxSel),
    el("label", { class: "inline" }, audioChk, " Include system audio (only when the screen picker offers it)"),
    el("div", { class: "row" }, startBtn, stopBtn, retryBtn),
    status,
  );

  // Post-recording: preview + actions.
  const previewWrap = el("div", { id: "rec-preview-wrap", hidden: true });
  const previewVideo = el("video", { id: "rec-preview", controls: true });
  previewVideo.style.maxWidth = "100%";
  const trimStart = el("input", { id: "rec-trim-start", type: "number", min: "0", step: "0.5", value: "0" });
  const trimEnd = el("input", { id: "rec-trim-end", type: "number", min: "0", step: "0.5", value: "0" });
  const saveBtn = el("button", {}, "Save recording");
  const trimBtn = el("button", {}, "Trim & save");
  const gifBtn = el("button", {}, "Export GIF");
  const discardBtn = el("button", {}, "Discard");
  previewWrap.append(
    previewVideo,
    el("p", { class: "hint" }, "Trim is cluster-granular (~1 s steps): the trimmed clip starts at the first whole cluster inside your range."),
    el(
      "div",
      { class: "row" },
      label("Trim start (s) ", trimStart),
      label("End (s) ", trimEnd),
      trimBtn,
    ),
    el("div", { class: "row" }, saveBtn, gifBtn, discardBtn),
  );
  section.append(previewWrap);

  // Saved recordings.
  const listEl = el("ul", { id: "rec-list" });
  const combineBtn = el("button", { id: "rec-combine" }, "Combine selected");
  section.append(
    el("h3", {}, "Saved recordings"),
    el("p", { class: "hint" }, "Tick two or more to join them end to end (same format only). Joining preserves clip order, not frame-perfect continuity."),
    listEl,
    el("div", { class: "row" }, combineBtn),
  );

  container.append(section);

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = "status" + (kind ? " " + kind : "");
  }

  function setBusy(v) {
    busy = v;
    for (const b of [startBtn, stopBtn, retryBtn, saveBtn, trimBtn, gifBtn, discardBtn, combineBtn]) b.disabled = v;
  }

  function refreshMonitors() {
    invoke("list_monitors")
      .then((ms) => {
        sessionDeps.monitors = Array.isArray(ms) ? ms : [];
      })
      .catch(() => {
        sessionDeps.monitors = [];
      });
  }

  // Defect #2 fix: always show the captures folder, the same way main.js's
  // stills tab does via `invoke("captures_dir_path")` — never only after a
  // save. Best-effort: a failure here must not block recording.
  function loadCapturesDir() {
    invoke("captures_dir_path")
      .then((dir) => {
        capturesDirNote.textContent = dir ? `Recordings save to: ${dir}` : "Storage location unavailable.";
      })
      .catch(() => {
        capturesDirNote.textContent = "Storage location unavailable.";
      });
  }

  function probe() {
    try {
      const s = new RecordingSession(sessionDeps).support();
      const blocker = describeRecordingBlocker(s);
      if (blocker) {
        supportNote.textContent = `Recording unavailable: ${blocker}.`;
        supportNote.className = "hint";
        startBtn.disabled = true;
      } else {
        const mp4 = s.mp4Supported ? " MP4 recording is available on this machine." : "";
        supportNote.textContent = `Ready — recording to ${s.webmMime}.${mp4}`;
        startBtn.disabled = false;
      }
      const mp4Opt = formatSel.querySelector('option[value="mp4"]');
      if (mp4Opt) mp4Opt.disabled = !s.mp4Supported;
    } catch (e) {
      supportNote.textContent = `Recording unavailable: ${e.message || e}.`;
      startBtn.disabled = true;
    }
  }

  function readRegion() {
    const num = (id, fallback) => {
      const v = Number(document.getElementById(id).value);
      return Number.isFinite(v) ? v : fallback;
    };
    const region = {
      x: num("rec-x", 0),
      y: num("rec-y", 0),
      w: Math.max(64, num("rec-w", 800)),
      h: Math.max(64, num("rec-h", 600)),
    };
    return region;
  }

  async function onStart() {
    if (session || busy) return;
    const mode = modeSel.value;
    const format = formatSel.value;
    const cursorMode = cursorSel.value;
    const includeAudio = audioChk.checked;
    const maxDurationMs = Number(maxSel.value) || 0;
    const region = mode === "region" ? readRegion() : null;
    session = new RecordingSession(sessionDeps);
    session.on("tick", ({ elapsedMs, bytes }) => {
      setStatus(`Recording… ${formatDuration(elapsedMs)} · ${formatBytes(bytes)}`);
    });
    session.on("warning", ({ message }) => {
      setStatus(message, "warning");
    });
    // Defect #3 fix: an "ended" stop (the shared source closed — the only
    // stop Jason could previously reach) now carries its result and is
    // presented through the exact same preview/save path a manual Stop
    // uses, instead of leaving a dangling warning with nothing to save.
    // FR1 (2026-11-13, PR #792 review P1): the automatic stop after a
    // source-end can fail, and presentStopResult itself can fail while
    // converting the blob. Both used to escape as unhandled rejections
    // with the recording lost. An ended-with-error keeps the session
    // alive (stop() reset it to "recording") so the user retries Stop
    // manually; a presentStopResult failure is caught here too, as a
    // belt-and-braces behind its own internal handling.
    session.on("ended", ({ message, result, error }) => {
      if (error) {
        setStatus(
          `${message} Automatic stop failed: ${error.message || error}. The recording is still held — click Stop to try again.`,
          "error",
        );
        return;
      }
      void presentStopResult(result, { endedNote: message }).catch((e) => {
        setStatus(`Couldn't show the recording: ${e.message || e}`, "error");
      });
    });
    session.on("error", (e) => {
      setStatus(`Recording error: ${e.message || e}`, "error");
    });
    startBtn.hidden = true;
    stopBtn.hidden = false;
    previewWrap.hidden = true;
    retryBtn.hidden = true;
    setStatus("Pick a screen, window, or tab to share…");
    try {
      const { mime, trackInfo } = await session.start({ mode, region, cursorMode, includeAudio, format, maxDurationMs });
      let note = `Recording (${mime}) — shared surface: ${trackInfo.displaySurface}, ${trackInfo.width}x${trackInfo.height}.`;
      if (includeAudio && !trackInfo.hasAudio) note += " No audio track was shared — the clip is silent.";
      if (cursorMode !== "none" && !session.mapping) {
        note += " Cursor overlay unavailable for this source — recording without it.";
      }
      setStatus(note);
    } catch (e) {
      session = null;
      startBtn.hidden = false;
      stopBtn.hidden = true;
      setStatus(e.message || String(e), "error");
    }
  }

  async function onStop() {
    if (!session) return;
    setBusy(true);
    setStatus("Stopping…");
    try {
      const result = await session.stop();
      await presentStopResult(result);
    } catch (e) {
      setStatus(`Stop failed: ${e.message || e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  // Defect #3 fix — the one place that turns a RecordingSession.stop()
  // result into UI state, shared by a manual Stop click and a track-ended
  // stop (the shared screen was closed). Before this fix, the ended path
  // called stop() and threw the result away (`void this.stop()`): the
  // bytes existed but nothing downstream of record.js ever saw them, so
  // the only way Jason could reach to end a recording destroyed it.
  async function presentStopResult(result, { endedNote = null } = {}) {
    session = null;
    startBtn.hidden = false;
    stopBtn.hidden = true;
    retryBtn.hidden = true;
    if (!result || result.byteLength === 0) {
      const prefix = endedNote ? `${endedNote} ` : "";
      setStatus(`${prefix}The recording came back empty — nothing was captured.`, "error");
      return;
    }
    // FR1 (2026-11-13, PR #792 review P1): retain the original result
    // BEFORE the conversion. arrayBuffer() used to run before
    // pendingResult was assigned, so a failed conversion lost the only
    // reference to the bytes, the rejection escaped unhandled, and the
    // preview/save controls were never presented with session already
    // reset to null — no retry. A transient conversion failure now keeps
    // the blob in pendingResult, shows an actionable error, and offers
    // Retry preview (see onRetryPreview) instead of losing the recording.
    pendingResult = result;
    let byteArray;
    try {
      byteArray = new Uint8Array(await result.blob.arrayBuffer());
    } catch (e) {
      retryBtn.hidden = false;
      setStatus(
        `${endedNote ? `${endedNote} ` : ""}Couldn't read the recording for preview (${e.message || e}). Your recording is kept — click “Retry preview” to try again, or Discard to throw it away.`,
        "error",
      );
      return;
    }
    pendingResult = { ...result, byteArray };
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(result.blob);
    previewVideo.src = previewUrl;
    trimEnd.value = (result.durationMs / 1000).toFixed(1);
    trimStart.value = "0";
    previewWrap.hidden = false;
    const prefix = endedNote ? `${endedNote} ` : "";
    setStatus(
      `${prefix}Recorded ${formatDuration(result.durationMs)} · ${formatBytes(result.byteLength)}. Preview, trim, save, or export a GIF.`,
      "ok",
    );
    setTimeout(() => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        previewVideo.removeAttribute("src");
      }
    }, PREVIEW_REVOKE_DELAY_MS);
  }

  // FR1 (2026-11-13, PR #792 review P1): re-runs presentStopResult
  // against the result retained in pendingResult after a failed
  // blob.arrayBuffer(). A transient conversion failure is recoverable
  // this way — the bytes were never dropped, so the preview/save flow
  // can still complete on the retry.
  async function onRetryPreview() {
    if (!pendingResult || busy) return;
    setBusy(true);
    try {
      await presentStopResult(pendingResult);
    } catch (e) {
      setStatus(`Retry failed: ${e.message || e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function clearPending() {
    pendingResult = null;
    previewWrap.hidden = true;
    retryBtn.hidden = true;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    previewVideo.removeAttribute("src");
  }

  function addRecording({ name, bytes, mime, durationMs, width, height, path }) {
    const rec = { id: nextId++, name, bytes, mime, durationMs, width, height, path, sizeBytes: bytes.length };
    recordings.push(rec);
    renderList();
    return rec;
  }

  function renderList() {
    listEl.innerHTML = "";
    if (recordings.length === 0) {
      listEl.append(el("li", { class: "hint" }, "Nothing saved yet this session."));
      return;
    }
    for (const rec of recordings) {
      const chk = el("input", { type: "checkbox", "data-rec": rec.id });
      const title = el("div", {}, `${rec.name} — ${formatDuration(rec.durationMs)} · ${formatBytes(rec.sizeBytes)} · ${rec.mime}`);
      const meta = el("div", { class: "meta" }, rec.path);
      const gifOne = el("button", {}, "GIF");
      gifOne.onclick = () => void onExportGif(rec);
      const trimOne = el("button", {}, "Trim…");
      trimOne.onclick = () => {
        // Load this recording into the trim UI via the preview area.
        pendingResult = {
          blob: new Blob([rec.bytes], { type: rec.mime }),
          byteArray: rec.bytes,
          mime: rec.mime,
          durationMs: rec.durationMs,
          byteLength: rec.sizeBytes,
          width: rec.width,
          height: rec.height,
        };
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(pendingResult.blob);
        previewVideo.src = previewUrl;
        trimStart.value = "0";
        trimEnd.value = (rec.durationMs / 1000).toFixed(1);
        previewWrap.hidden = false;
        setStatus(`Trimming ${rec.name} — set the range and choose “Trim & save”.`, "");
        previewWrap.scrollIntoView({ block: "nearest" });
      };
      const forget = el("button", {}, "Forget");
      forget.onclick = () => {
        const i = recordings.findIndex((r) => r.id === rec.id);
        if (i >= 0) recordings.splice(i, 1);
        renderList();
        setStatus(`Removed ${rec.name} from this list. The file stays on disk at ${rec.path}.`, "");
      };
      // Rung 5 — opt-in "Save to FORGE" for recordings. Fail closed: with no
      // stored session the button offers sign-in and never uploads.
      const saveOne = el("button", { "data-forge-save": "1" }, "Save to FORGE");
      saveOne.onclick = () => {
        if (!window.ForgeSaveUI) {
          setStatus("Save to FORGE is unavailable in this build.", "error");
          return;
        }
        void window.ForgeSaveUI.saveToForge({
          button: saveOne,
          actions,
          setStatusFn: setStatus,
          getPayload: async () => {
            if (!rec.forgeCaptureId) rec.forgeCaptureId = window.ForgeUpload.newCaptureId();
            return {
              bytes: rec.bytes,
              mime: rec.mime,
              kind: "recording",
              title: rec.name || `recording — ${rec.width}x${rec.height}`,
              width: rec.width,
              height: rec.height,
              captureId: rec.forgeCaptureId,
            };
          },
        });
      };
      const actions = el("div", { class: "actions" }, gifOne, trimOne, saveOne, forget);
      listEl.append(el("li", {}, el("label", { class: "inline" }, chk, " combine"), title, meta, actions));
    }
  }

  async function onSave() {
    if (!pendingResult || busy) return;
    setBusy(true);
    try {
      const saved = await uploadBytes(
        invoke,
        { bytes: pendingResult.byteArray, mime: pendingResult.mime, nameHint: "recording" },
        (done, total) => setStatus(`Saving… ${formatBytes(done)} / ${formatBytes(total)}`),
      );
      addRecording({
        name: saved.path.split(/[/\\]/).pop() || "recording",
        bytes: pendingResult.byteArray,
        mime: pendingResult.mime,
        durationMs: pendingResult.durationMs,
        width: pendingResult.width,
        height: pendingResult.height,
        path: saved.path,
      });
      clearPending();
      setStatus(`Saved to ${saved.path}`, "ok");
    } catch (e) {
      setStatus(`Save failed: ${e.message || e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function onTrimSave() {
    if (!pendingResult || busy) return;
    const startS = Number(trimStart.value);
    const endS = Number(trimEnd.value);
    setBusy(true);
    try {
      if (!sniffWebm(pendingResult.byteArray)) {
        throw new RecordingError("unsupported", "Trimming is only available for WebM recordings in this version.");
      }
      const { startMs, endMs } = validateTrimRange({
        durationMs: pendingResult.durationMs,
        startMs: startS * 1000,
        endMs: endS * 1000,
      });
      setStatus("Trimming…");
      const trimmed = trimWebm(pendingResult.byteArray, startMs, endMs);
      const saved = await uploadBytes(
        invoke,
        { bytes: trimmed, mime: pendingResult.mime, nameHint: "recording-trimmed" },
        (done, total) => setStatus(`Saving trimmed clip… ${formatBytes(done)} / ${formatBytes(total)}`),
      );
      addRecording({
        name: saved.path.split(/[/\\]/).pop() || "recording-trimmed",
        bytes: trimmed,
        mime: pendingResult.mime,
        durationMs: endMs - startMs,
        width: pendingResult.width,
        height: pendingResult.height,
        path: saved.path,
      });
      clearPending();
      setStatus(`Trimmed clip saved to ${saved.path} (cluster-granular: starts at the first whole cluster in range).`, "ok");
    } catch (e) {
      setStatus(`Trim failed: ${e.message || e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function onExportGif(rec) {
    const target = rec || (pendingResult
      ? {
        bytes: pendingResult.byteArray,
        blob: pendingResult.blob,
        mime: pendingResult.mime,
        durationMs: pendingResult.durationMs,
        width: pendingResult.width,
        height: pendingResult.height,
      }
      : null);
    if (!target || busy) return;
    if (!sniffWebm(target.bytes)) {
      setStatus("GIF export is only available for WebM recordings in this version.", "error");
      return;
    }
    setBusy(true);
    try {
      const { timestamps, fps, frameCount } = planGifFrames({ durationMs: target.durationMs, fps: GIF_DEFAULT_FPS });
      const { width, height } = gifFrameSize({ width: Math.max(1, target.width), height: Math.max(1, target.height) });
      setStatus(`Exporting GIF: ${frameCount} frames at ${fps} fps…`);
      const frames = await extractGifFrames(target.blob, timestamps, width, height, (i, n) =>
        setStatus(`Exporting GIF: grabbing frame ${i}/${n}…`),
      );
      setStatus("Encoding GIF…");
      const bytes = encodeGifFrames({ frames, width, height, fps });
      setStatus(`Saving GIF (${formatBytes(bytes.length)})…`);
      const saved = await uploadBytes(
        invoke,
        { bytes, mime: "image/gif", suggestedExtension: "gif", nameHint: "recording-clip" },
        (done, total) => setStatus(`Saving GIF… ${formatBytes(done)} / ${formatBytes(total)}`),
      );
      setStatus(`GIF saved to ${saved.path} (${frameCount} frames, ${width}x${height}).`, "ok");
    } catch (e) {
      setStatus(`GIF export failed: ${e.message || e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function onCombine() {
    if (busy) return;
    const checked = [...listEl.querySelectorAll('input[type="checkbox"][data-rec]:checked')]
      .map((c) => recordings.find((r) => r.id === Number(c.dataset.rec)))
      .filter(Boolean);
    if (checked.length < 2) {
      setStatus("Tick at least two recordings to combine them.", "error");
      return;
    }
    if (!checked[0].mime.startsWith("video/webm")) {
      setStatus(
        `Combine supports WebM recordings only — ${checked[0].mime} cannot be joined by concatenation. Record in WebM to combine clips.`,
        "error",
      );
      return;
    }
    setBusy(true);
    try {
      setStatus(`Combining ${checked.length} clips…`);
      const combined = combineWebm(
        checked.map((r) => ({ bytes: r.bytes, durationMs: r.durationMs, mime: r.mime })),
      );
      const totalDuration = checked.reduce((n, r) => n + r.durationMs, 0);
      const saved = await uploadBytes(
        invoke,
        { bytes: combined, mime: checked[0].mime, nameHint: "recording-combined" },
        (done, total) => setStatus(`Saving combined clip… ${formatBytes(done)} / ${formatBytes(total)}`),
      );
      addRecording({
        name: saved.path.split(/[/\\]/).pop() || "recording-combined",
        bytes: combined,
        mime: checked[0].mime,
        durationMs: totalDuration,
        width: checked[0].width,
        height: checked[0].height,
        path: saved.path,
      });
      setStatus(`Combined clip saved to ${saved.path}.`, "ok");
    } catch (e) {
      setStatus(`Combine failed: ${e.message || e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  modeSel.addEventListener("change", () => {
    regionRows.hidden = modeSel.value !== "region";
  });
  startBtn.addEventListener("click", () => void onStart());
  stopBtn.addEventListener("click", () => void onStop());
  retryBtn.addEventListener("click", () => void onRetryPreview());
  saveBtn.addEventListener("click", () => void onSave());
  trimBtn.addEventListener("click", () => void onTrimSave());
  gifBtn.addEventListener("click", () => void onExportGif(null));
  discardBtn.addEventListener("click", () => {
    clearPending();
    setStatus("Discarded the recording.", "");
  });
  combineBtn.addEventListener("click", () => void onCombine());

  // Defect #1 fix: while recording, the only Stop a user could reach was
  // inside the app window — unreachable once a fullscreen/maximized video
  // sits on top of it (Jason's exact symptom), and the only way out (closing
  // the recorded screen) is the data-loss path defect #3 fixes. A global
  // shortcut fires the real stop handler (preview + save offered, see
  // presentStopResult above) from anywhere, without raising the app window
  // or touching the recorded screen — unlike the Ctrl+PrintScreen window
  // shortcut, this listener must never call focus/raise.
  async function listenStopHotkey() {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.transformCallback !== "function") return;
    // Same `plugin:event|listen` convention as main.js's listenEvent /
    // listenHotkeyEvents — fire-and-forget for this page's lifetime, no
    // unlisten (this app never tears one down elsewhere either).
    const handlerId = internals.transformCallback(() => {
      if (session && session.state === "recording" && !busy) void onStop();
    });
    try {
      await internals.invoke("plugin:event|listen", {
        event: "stop-recording-requested",
        target: { kind: "Any" },
        handler: handlerId,
      });
    } catch {
      /* best effort — the global hotkey degrades gracefully, same as the
         capture shortcuts' own registration (see main.rs register_capture_shortcuts) */
    }
  }

  renderList();
  refreshMonitors();
  loadCapturesDir();
  probe();
  void listenStopHotkey();

  return {
    destroy() {
      if (session) void session.stop();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      section.remove();
    },
  };
}

// Auto-mount when loaded as a page script next to index.html.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const mount = document.getElementById("record-mount");
    if (mount && !mount.dataset.mounted) {
      mount.dataset.mounted = "1";
      try {
        renderRecordControls(mount, {});
      } catch (e) {
        mount.textContent = `Screen recording could not start: ${e.message || e}`;
      }
    }
  });
}
