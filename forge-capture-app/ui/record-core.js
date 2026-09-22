// FORGE Capture — Rung 4 recording core (record-core.js).
//
// Framework-neutral, DOM-free pure logic for screen recording. This module
// never touches the DOM, MediaRecorder, the network, or the filesystem, so
// it runs unmodified under vitest (node) and in the Tauri webview.
//
// Responsibilities:
//   - capability probing + MediaRecorder mime selection (WebM-first),
//   - trim-range validation,
//   - minimal EBML/WebM parsing: header extraction, cluster splitting,
//     cluster timestamp read/rewrite,
//   - trim (header-preserving cluster filter, rebased to t=0) and combine
//     (cluster timestamp offsetting) as pure byte operations,
//   - GIF frame planning + GIF encoding (via the vendored gifenc build),
//   - compositor overlay geometry (cursor highlight / spotlight / magnifier).
//
// The DOM/MediaRecorder orchestration lives in record.js; the Rust side owns
// file I/O (chunked media upload commands) and cursor position
// (get_cursor_pos). The webview produces recording bytes with the
// *platform* MediaRecorder — FORGE Capture ships zero codec bytes
// (see docs/product/forge-capture/RUNG4_ENCODER_LICENSE_AUDIT.md).

import { GIFEncoder, quantize, applyPalette } from "./vendor/gifenc.js";

export class RecordingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RecordingError";
    this.code = code;
  }
}

// --- capability probing / mime selection ---------------------------------

/// WebM-first mime priority: royalty-free VP8/VP9 encoders provided by the
/// platform. MP4 is never in this list — it is offered separately, only
/// where the platform reports support (see mp4RecordingSupported).
export const RECORDING_MIME_PRIORITY = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export const MP4_MIME = "video/mp4";

/// MediaRecorder timeslice: one ondataavailable blob per interval. This is
/// also the documented trim granularity floor (cluster boundaries).
export const RECORDING_TIMESLICE_MS = 1000;

/// In-memory recording safeguards, in the spirit of Rung 2b's capture
/// safeguards: warn at the soft limit, hard-stop at the hard limit. Chunks
/// are held in memory until the recording is saved.
export const RECORDING_SOFT_LIMIT_BYTES = 500 * 1024 * 1024;
export const RECORDING_HARD_LIMIT_BYTES = 1024 * 1024 * 1024;

/// Default encoder bitrate: a reasonable quality/size tradeoff for screen
/// content at 1080p. The platform encoder may clamp or ignore it.
export const RECORDING_DEFAULT_VIDEO_BITS_PER_SECOND = 8_000_000;

/// Bytes per chunked-upload invoke call. Tauri invoke args are JSON, so one
/// giant number array would jank or OOM the webview; 1 MiB chunks keep each
/// call small and give a natural save-progress signal.
export const MEDIA_UPLOAD_CHUNK_BYTES = 1024 * 1024;

export const GIF_DEFAULT_FPS = 10;
export const GIF_MAX_FPS = 15;
export const GIF_MAX_FRAMES = 150;
/// GIF frames are downscaled to this max width: bounds memory (frames x
/// fps x pixels) and matches the utility's "quick shareable clip" role.
export const GIF_MAX_DIMENSION = 480;

/**
 * Probe what the host can do. The caller injects the platform queries so
 * this stays DOM-free and unit-testable:
 *   { hasDisplayMedia: bool, hasMediaRecorder: bool,
 *     isTypeSupported: (mime) -> bool }
 */
export function probeRecordingSupport({ hasDisplayMedia, hasMediaRecorder, isTypeSupported }) {
  const probe = typeof isTypeSupported === "function" ? isTypeSupported : () => false;
  const tryProbe = (mime) => {
    try {
      return !!probe(mime);
    } catch {
      return false; // probing must never throw
    }
  };
  let webmMime = null;
  if (hasMediaRecorder) {
    for (const mime of RECORDING_MIME_PRIORITY) {
      if (tryProbe(mime)) {
        webmMime = mime;
        break;
      }
    }
  }
  const mp4Supported = hasMediaRecorder ? tryProbe(MP4_MIME) : false;
  return {
    displayMedia: !!hasDisplayMedia,
    mediaRecorder: !!hasMediaRecorder,
    webmMime, // string | null — the exact mime to pass to MediaRecorder
    mp4Supported,
    canRecord: !!hasDisplayMedia && !!hasMediaRecorder && webmMime !== null,
  };
}

/// Pick the WebM mime for a new recording. Throws when the host cannot
/// encode WebM at all.
export function pickRecordingMime(isTypeSupported) {
  const support = probeRecordingSupport({
    hasDisplayMedia: true,
    hasMediaRecorder: typeof isTypeSupported === "function",
    isTypeSupported,
  });
  if (!support.webmMime) {
    throw new RecordingError("no-webm", "this host cannot encode WebM video");
  }
  return support.webmMime;
}

/// MP4 recording is offered only where the platform reports support via
/// isTypeSupported. The H.264 encoder is the platform's (see the Rung 4
/// license audit); we never ship one.
export function mp4RecordingSupported(isTypeSupported) {
  if (typeof isTypeSupported !== "function") return false;
  try {
    return !!isTypeSupported(MP4_MIME);
  } catch {
    return false;
  }
}

/// Human-readable reason recording is unavailable ("" when available).
export function describeRecordingBlocker(support) {
  if (!support) return "recording support could not be probed";
  if (!support.displayMedia) return "screen capture (getDisplayMedia) is not available in this webview";
  if (!support.mediaRecorder) return "MediaRecorder is not available in this webview";
  if (!support.webmMime) return "this webview cannot encode WebM video";
  return "";
}

// --- trim ---------------------------------------------------------------

/**
 * Validate a [startMs, endMs) trim range against the recording duration.
 * Returns the clamped range. Throws RecordingError on nonsense input —
 * never silently produces an empty or inverted trim.
 */
export function validateTrimRange({ durationMs, startMs, endMs }) {
  if (!Number.isFinite(durationMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new RecordingError("invalid-trim", "trim range must be finite numbers");
  }
  if (durationMs <= 0) throw new RecordingError("invalid-trim", "recording has no duration");
  if (startMs < 0 || endMs < 0) throw new RecordingError("invalid-trim", "trim range cannot be negative");
  if (startMs >= endMs) throw new RecordingError("invalid-trim", "trim start must be before trim end");
  if (startMs >= durationMs) throw new RecordingError("invalid-trim", "trim start is past the end of the recording");
  return { startMs: Math.max(0, startMs), endMs: Math.min(durationMs, endMs) };
}

// --- minimal EBML/WebM parsing -------------------------------------------
//
// Only what trim/combine need: walk the top-level Segment children to find
// Clusters, and read/rewrite each Cluster's Timestamp child. This is proper
// EBML walking by element sizes (no byte-pattern scanning), so payload
// bytes that happen to look like a Cluster ID can never confuse it.

const EBML_ID_EBML = 0x1a45dfa3;
const EBML_ID_SEGMENT = 0x18538067;
const EBML_ID_CLUSTER = 0x1f43b675;
const EBML_ID_CLUSTER_TIMESTAMP = 0xe7;

function assertRange(bytes, offset, length, what) {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new RecordingError("bad-ebml", `${what} runs past the end of the buffer`);
  }
}

function readEbmlId(bytes, offset) {
  assertRange(bytes, offset, 1, "EBML ID");
  const first = bytes[offset];
  let length;
  if ((first & 0x80) !== 0) length = 1;
  else if ((first & 0x40) !== 0) length = 2;
  else if ((first & 0x20) !== 0) length = 3;
  else if ((first & 0x10) !== 0) length = 4;
  else throw new RecordingError("bad-ebml", `invalid EBML ID prefix 0x${first.toString(16)} at offset ${offset}`);
  assertRange(bytes, offset, length, "EBML ID");
  let value = 0;
  for (let i = 0; i < length; i += 1) value = value * 256 + bytes[offset + i];
  return { value, length };
}

function readEbmlSize(bytes, offset) {
  // Returns { value, length }. value === -1 means "unknown size"
  // (all value bits set), which is legal for Segment and Cluster.
  assertRange(bytes, offset, 1, "EBML size");
  const first = bytes[offset];
  let zeros = 0;
  let mask = 0x80;
  while (zeros < 8 && (first & mask) === 0) {
    zeros += 1;
    mask >>= 1;
  }
  const length = zeros + 1;
  if (length > 8) throw new RecordingError("bad-ebml", `EBML size too long at offset ${offset}`);
  assertRange(bytes, offset, length, "EBML size");
  let value = first & (mask - 1);
  for (let i = 1; i < length; i += 1) value = value * 256 + bytes[offset + i];
  const maxForLength = 2 ** (7 * length) - 1;
  return { value: value === maxForLength ? -1 : value, length };
}

/**
 * Split a complete WebM byte stream into:
 *   header   — EBML header + Segment header + every top-level element
 *              before the first Cluster (Info, Tracks, …),
 *   clusters — the Cluster elements in file order (subarrays of the input).
 * Trailing non-cluster elements (e.g. Cues, which MediaRecorder never
 * writes) are dropped; this is documented, not silent — callers that need
 * them do not exist in Rung 4.
 */
export function splitWebmSegment(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) {
    throw new RecordingError("bad-webm", "not enough bytes for a WebM header");
  }
  let offset = 0;
  const idEbml = readEbmlId(bytes, offset);
  if (idEbml.value !== EBML_ID_EBML) throw new RecordingError("bad-webm", "missing EBML header — not WebM");
  const sizeEbml = readEbmlSize(bytes, offset + idEbml.length);
  if (sizeEbml.value === -1) throw new RecordingError("bad-webm", "EBML header has unknown size");
  offset += idEbml.length + sizeEbml.length + sizeEbml.value;

  const idSeg = readEbmlId(bytes, offset);
  if (idSeg.value !== EBML_ID_SEGMENT) throw new RecordingError("bad-webm", "missing Segment element — not WebM");
  const sizeSeg = readEbmlSize(bytes, offset + idSeg.length);
  const segStart = offset + idSeg.length + sizeSeg.length;
  const segEnd = sizeSeg.value === -1 ? bytes.length : segStart + sizeSeg.value;
  if (segEnd > bytes.length) throw new RecordingError("bad-webm", "Segment size runs past the end of the buffer");

  const clusters = [];
  let headerEnd = segStart;
  let p = segStart;
  while (p < segEnd) {
    const id = readEbmlId(bytes, p);
    const size = readEbmlSize(bytes, p + id.length);
    const dataStart = p + id.length + size.length;
    const dataEnd = size.value === -1 ? segEnd : dataStart + size.value;
    if (dataEnd > segEnd) throw new RecordingError("bad-webm", "element runs past the end of the Segment");
    if (id.value === EBML_ID_CLUSTER) {
      if (clusters.length === 0) headerEnd = p;
      clusters.push(bytes.subarray(p, dataEnd));
    }
    p = dataEnd;
  }
  return { header: bytes.subarray(0, headerEnd), clusters };
}

/**
 * Read a Cluster's Timestamp child. Returns { value, valueOffset,
 * byteLength } — the pieces offsetClusterTimestamp needs to rewrite it.
 */
export function clusterTimestamp(cluster) {
  if (!(cluster instanceof Uint8Array)) throw new RecordingError("bad-cluster", "cluster must be bytes");
  const id = readEbmlId(cluster, 0);
  if (id.value !== EBML_ID_CLUSTER) throw new RecordingError("bad-cluster", "not a Cluster element");
  const size = readEbmlSize(cluster, id.length);
  let p = id.length + size.length;
  const end = cluster.length;
  while (p < end) {
    const childId = readEbmlId(cluster, p);
    const childSize = readEbmlSize(cluster, p + childId.length);
    const valueOffset = p + childId.length + childSize.length;
    if (childSize.value === -1) throw new RecordingError("bad-cluster", "cluster child has unknown size");
    if (childId.value === EBML_ID_CLUSTER_TIMESTAMP) {
      if (childSize.value < 1 || childSize.value > 6) {
        throw new RecordingError("bad-cluster", `cluster Timestamp is ${childSize.value} bytes — outside the sane range`);
      }
      let value = 0;
      for (let i = 0; i < childSize.value; i += 1) value = value * 256 + cluster[valueOffset + i];
      const bits = childSize.value * 8;
      if (value >= 2 ** (bits - 1)) value -= 2 ** bits; // sign-extend
      return { value, valueOffset, byteLength: childSize.value };
    }
    p = valueOffset + childSize.value;
  }
  throw new RecordingError("bad-cluster", "cluster has no Timestamp element");
}

/**
 * Return a copy of the cluster with its Timestamp shifted by deltaMs
 * (may be negative). The byte width is preserved; an overflow beyond the
 * existing width throws rather than corrupting the stream.
 */
export function offsetClusterTimestamp(cluster, deltaMs) {
  if (!Number.isInteger(deltaMs)) {
    throw new RecordingError("invalid-offset", "cluster timestamp offset must be an integer number of ms");
  }
  const { value, valueOffset, byteLength } = clusterTimestamp(cluster);
  const next = value + deltaMs;
  const bits = byteLength * 8;
  const min = -(2 ** (bits - 1));
  const max = 2 ** (bits - 1) - 1;
  if (next < min || next > max) {
    throw new RecordingError("timestamp-overflow", `timestamp ${next}ms does not fit in ${byteLength} bytes`);
  }
  const out = new Uint8Array(cluster); // copy — never mutate the caller's bytes
  let v = next < 0 ? next + 2 ** bits : next;
  for (let i = byteLength - 1; i >= 0; i -= 1) {
    out[valueOffset + i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/// Quick magic-byte check: EBML header ID. (The Rust side re-sniffs before
/// writing to disk; this is the UI's early honest rejection.)
export function sniffWebm(bytes) {
  return (
    bytes instanceof Uint8Array &&
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

/**
 * Trim a complete WebM recording to [startMs, endMs), keeping whole
 * clusters whose timestamps fall in the range. The result is rebased so its
 * first kept cluster starts at ~0 (players begin at the first kept frame
 * instead of holding on the original timeline offset).
 *
 * Granularity is one cluster (the recorder emits a cluster per timeslice,
 * 1 s by default) — documented, not frame-accurate.
 */
export function trimWebm(fullBytes, startMs, endMs) {
  const { header, clusters } = splitWebmSegment(fullBytes);
  if (clusters.length === 0) throw new RecordingError("empty-recording", "recording has no clusters");
  const stamped = clusters.map((bytes) => ({ bytes, ts: clusterTimestamp(bytes).value }));
  const kept = stamped.filter((s) => s.ts >= startMs && s.ts < endMs);
  if (kept.length === 0) {
    throw new RecordingError("empty-trim", "trim range contains no complete clusters — widen the range");
  }
  const base = kept[0].ts;
  return concatBytes([header, ...kept.map((k) => offsetClusterTimestamp(k.bytes, -base))]);
}

/**
 * Join recordings end to end.
 * segments: [{ bytes: Uint8Array, durationMs: number, mime: string }]
 * Every segment must share the exact recording mime (same container +
 * codec); later segments' cluster timestamps are offset by the cumulative
 * durations of the earlier ones. The header comes from the first segment.
 */
export function combineWebm(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new RecordingError("invalid-combine", "nothing to combine");
  }
  const mime = segments[0].mime;
  segments.forEach((s, i) => {
    if (s.mime !== mime) {
      throw new RecordingError(
        "mime-mismatch",
        `segment ${i} is ${s.mime}; expected ${mime} — only identical recordings can be combined`,
      );
    }
    if (!(s.bytes instanceof Uint8Array) || s.bytes.length === 0) {
      throw new RecordingError("invalid-combine", `segment ${i} has no bytes`);
    }
    if (!Number.isFinite(s.durationMs) || s.durationMs <= 0) {
      throw new RecordingError("invalid-combine", `segment ${i} has no usable duration`);
    }
  });
  const out = [];
  let offset = 0;
  let first = true;
  segments.forEach((s) => {
    const { header, clusters } = splitWebmSegment(s.bytes);
    if (clusters.length === 0) throw new RecordingError("empty-segment", "a segment has no clusters");
    if (first) {
      out.push(header);
      first = false;
    }
    for (const c of clusters) out.push(offsetClusterTimestamp(c, offset));
    offset += Math.round(s.durationMs);
  });
  return concatBytes(out);
}

// --- GIF export --------------------------------------------------------

/**
 * Plan the frame sample timestamps for a GIF export. Caps fps and total
 * frames so a long recording cannot OOM the encoder; the caller reports the
 * actual fps/frame count to the user.
 */
export function planGifFrames({ durationMs, fps = GIF_DEFAULT_FPS, maxFrames = GIF_MAX_FRAMES } = {}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RecordingError("invalid-gif", "GIF export needs a positive duration");
  }
  const actualFps = Math.min(Math.max(1, Math.floor(fps)), GIF_MAX_FPS);
  const count = Math.min(maxFrames, Math.max(1, Math.floor((durationMs / 1000) * actualFps)));
  const step = durationMs / count;
  const timestamps = [];
  for (let i = 0; i < count; i += 1) {
    timestamps.push(Math.min(durationMs - 1, Math.floor(i * step)));
  }
  return { timestamps, fps: actualFps, frameCount: count };
}

/**
 * Fit frame dimensions inside GIF_MAX_DIMENSION (width), preserving aspect
 * ratio. Returns integer { width, height }.
 */
export function gifFrameSize({ width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RecordingError("invalid-gif", "frame dimensions must be positive integers");
  }
  if (width <= GIF_MAX_DIMENSION) return { width, height };
  const scale = GIF_MAX_DIMENSION / width;
  return { width: GIF_MAX_DIMENSION, height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Encode RGBA frames to an animated GIF. `frames` are width*height*4
 * byte views (Uint8Array from tests, Uint8ClampedArray from canvas
 * getImageData — both accepted). Pure apart from the vendored gifenc
 * dependency — no DOM.
 */
export function encodeGifFrames({ frames, width, height, fps = GIF_DEFAULT_FPS }) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new RecordingError("invalid-gif", "no frames to encode");
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RecordingError("invalid-gif", "frame dimensions must be positive integers");
  }
  const expected = width * height * 4;
  const asBytes = (view) => {
    if (view instanceof Uint8Array) return view;
    if (ArrayBuffer.isView(view)) return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    return null;
  };
  const encoder = GIFEncoder();
  const delayMs = Math.round(1000 / Math.min(Math.max(1, fps), GIF_MAX_FPS));
  frames.forEach((frame, i) => {
    const rgba = asBytes(frame);
    if (!rgba || rgba.length !== expected) {
      throw new RecordingError("invalid-gif", `frame ${i} is ${frame?.length ?? 0} bytes; expected ${expected}`);
    }
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    encoder.writeFrame(indexed, width, height, {
      palette,
      delay: delayMs,
      first: i === 0,
      repeat: 0,
    });
  });
  encoder.finish();
  return encoder.bytes();
}

// --- compositor overlay geometry ------------------------------------------

/**
 * Resolve whether cursor overlays can be drawn for a recording, and how to
 * map OS cursor coordinates (virtual-desktop physical px, from
 * get_cursor_pos) into frame pixels.
 *
 * Overlays need a full-monitor capture: the picked track's displaySurface
 * must be "monitor" and its frame size must match a known monitor's
 * physical size exactly. Window captures cannot be mapped reliably (the
 * webview never learns the window's screen rect), so they get overlays
 * disabled with an honest reason instead of a misplaced ring.
 *
 * monitors: [{ id, origin_virtual: [x, y], size_physical: [w, h] }]
 * trackInfo: { displaySurface: "monitor"|"window"|"browser"|..., width, height }
 * Returns { offsetX, offsetY, scaleX, scaleY, monitorId } or null.
 */
export function resolveOverlayMapping({ trackInfo, monitors }) {
  if (!trackInfo || trackInfo.displaySurface !== "monitor") return null;
  if (!Number.isInteger(trackInfo.width) || !Number.isInteger(trackInfo.height)) return null;
  const list = Array.isArray(monitors) ? monitors : [];
  const match = list.find(
    (m) =>
      Array.isArray(m.size_physical) &&
      m.size_physical[0] === trackInfo.width &&
      m.size_physical[1] === trackInfo.height,
  );
  if (!match) return null;
  const [ox, oy] = match.origin_virtual;
  return { offsetX: ox, offsetY: oy, scaleX: 1, scaleY: 1, monitorId: match.id };
}

/** Map an OS cursor position into frame pixels via a resolved mapping. */
export function mapCursorToFrame({ x, y }, mapping, frameW, frameH) {
  const fx = (x - mapping.offsetX) * mapping.scaleX;
  const fy = (y - mapping.offsetY) * mapping.scaleY;
  return {
    x: Math.min(Math.max(fx, 0), frameW),
    y: Math.min(Math.max(fy, 0), frameH),
  };
}

/**
 * Region-mode overlay mapping. The compositor crops a user region (virtual-
 * desktop px, same space as the monitor origins) out of a full-monitor
 * capture and draws it onto a frameW x frameH canvas. `base` is the
 * resolveOverlayMapping result for the track (null-checked here); the base
 * scale cancels out, leaving a pure region-relative mapping.
 */
export function regionOverlayMapping(base, region, frameW, frameH) {
  if (!base) return null;
  if (
    !region ||
    !Number.isFinite(region.x) ||
    !Number.isFinite(region.y) ||
    !Number.isFinite(region.w) ||
    !Number.isFinite(region.h) ||
    region.w <= 0 ||
    region.h <= 0
  ) {
    return null;
  }
  if (!Number.isFinite(frameW) || !Number.isFinite(frameH) || frameW <= 0 || frameH <= 0) return null;
  return {
    offsetX: region.x,
    offsetY: region.y,
    scaleX: frameW / region.w,
    scaleY: frameH / region.h,
    monitorId: base.monitorId,
  };
}

/**
 * Overlay geometry for one composited frame. All inputs/outputs are frame
 * pixels. mode: "highlight" | "spotlight" | "magnifier".
 */
export function cursorOverlayGeometry({ frameW, frameH, x, y, mode }) {
  if (!Number.isFinite(frameW) || !Number.isFinite(frameH) || frameW <= 0 || frameH <= 0) {
    throw new RecordingError("invalid-overlay", "frame dimensions must be positive");
  }
  if (!["highlight", "spotlight", "magnifier"].includes(mode)) {
    throw new RecordingError("invalid-overlay", `unknown overlay mode: ${mode}`);
  }
  const cx = Math.min(Math.max(x, 0), frameW);
  const cy = Math.min(Math.max(y, 0), frameH);
  const minSide = Math.min(frameW, frameH);
  if (mode === "highlight") {
    return { kind: "ring", cx, cy, r: Math.max(16, minSide * 0.025) };
  }
  if (mode === "spotlight") {
    return { kind: "spotlight", cx, cy, r: Math.max(80, minSide * 0.22) };
  }
  // magnifier: 2.5x zoom inset pinned to the top-right corner; the source
  // rect follows the cursor and is clamped inside the frame.
  const zoom = 2.5;
  const destW = Math.min(320, frameW * 0.3);
  const destH = (destW * 9) / 16;
  const srcW = destW / zoom;
  const srcH = destH / zoom;
  const margin = 16;
  const src = {
    x: Math.min(Math.max(cx - srcW / 2, 0), Math.max(0, frameW - srcW)),
    y: Math.min(Math.max(cy - srcH / 2, 0), Math.max(0, frameH - srcH)),
    w: srcW,
    h: srcH,
  };
  const dest = { x: Math.max(0, frameW - destW - margin), y: margin, w: destW, h: destH };
  return { kind: "magnifier", cx, cy, src, dest };
}
