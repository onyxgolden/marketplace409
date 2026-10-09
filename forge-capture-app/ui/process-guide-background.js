// FORGE Capture — Slice B plot-plan background / raster-overlay loader
// and store (ui/process-guide-background.js).
//
// Per commands/muse/capture-plotter-sizes-and-plot-import-after-pt5.md's
// Slice B + "supplement 2" sections. Begins only after Slice A merged
// (267f8d49) -- no edits to PT-4/PT-5's symbol registries or to
// GuideMarkupOverlay; this is a wholly separate, parallel store.
//
// Pure where it matters: magic-byte sniffing, size/pixel-budget checks,
// and the aspect-fit math are DOM-free and unit-tested under plain node.
// `GuideBackgroundStore` is pure bookkeeping -- it never decodes an image
// itself and never calls a browser API directly. The actual image decode
// and object-URL creation/revocation are real browser primitives that
// process-training.js performs and then hands this module an already-
// decoded `{url, bitmap, width, height}` record (same dependency-
// injection convention as annotations-render.js's
// flattenAnnotations({createCanvas, getContext2d}) -- the only injected
// capability here is `revokeObjectURL`, used purely for lifecycle
// bookkeeping/testing, never to decide whether to accept a file).
//
// Security/privacy contract (brief, restated): local author-selected
// PNG/JPEG files only -- never a network fetch, never persisted (no
// localStorage/IndexedDB/filesystem), never embedded in compiled
// evidence, never included in GuideMarkupOverlay's shape/undo
// snapshots, never logged by filename/bytes/metadata. PDF is explicitly
// NOT supported in this version: a PDF's own magic bytes are
// recognized and rejected with a specific "not supported" message,
// never silently accepted and never lumped in with a truly-
// unrecognized file (brief: "file PDF as explicitly blocked follow-up
// rather than silently accepting PDFs").

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MiB
export const MAX_DECODED_PIXELS = 20_000_000;
export const MAX_DIMENSION_PX = 10000;
export const MAX_OVERLAYS_PER_STEP = 8;
export const MAX_AGGREGATE_PIXELS_PER_STEP = 40_000_000;

export class BackgroundImageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackgroundImageError";
    this.code = code;
  }
}

// --- Magic-byte sniffing -- never trust a claimed MIME type or filename
// extension, either of which a caller (or an attacker) can set to
// anything regardless of the file's real content. ----------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function bytesStartWith(bytes, sig) {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Sniffs the real file type from its own leading bytes. Returns
 * "png" | "jpeg" on success. Throws `BackgroundImageError` on anything
 * else -- a recognized-but-unsupported PDF gets its own specific
 * "pdf-not-supported" code/message (never silently accepted, never
 * confused with a genuinely unrecognized file); anything else is
 * "unsupported-type".
 */
export function sniffImageType(bytes) {
  const header = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (bytesStartWith(header, PNG_SIGNATURE)) return "png";
  if (bytesStartWith(header, JPEG_SIGNATURE)) return "jpeg";
  if (bytesStartWith(header, PDF_SIGNATURE)) {
    throw new BackgroundImageError(
      "pdf-not-supported",
      "PDF is not supported in this version -- export or save the plan as a local PNG or JPEG instead"
    );
  }
  throw new BackgroundImageError("unsupported-type", "unsupported or unrecognized file type");
}

/**
 * Validates a candidate file's raw size and leading bytes BEFORE any
 * decode is attempted -- no image API involved yet, so a hostile or
 * malformed file never even reaches a decoder. Fails closed on an empty
 * file, an oversized one, or an unrecognized/unsupported signature.
 * Returns the sniffed type so the caller knows what it's about to try
 * to decode.
 */
export function validateCandidateBytes(byteLength, headerBytes) {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new BackgroundImageError("empty-file", "file is empty or unreadable");
  }
  if (byteLength > MAX_FILE_BYTES) {
    throw new BackgroundImageError("too-large", `file exceeds the ${MAX_FILE_BYTES}-byte limit`);
  }
  return sniffImageType(headerBytes);
}

/**
 * Validates DECODED intrinsic dimensions -- called only after a real
 * decode (e.g. `createImageBitmap`) has already produced a width/height.
 * Fails closed on an invalid or oversized result; never clamps,
 * downsamples, or silently accepts a partial decode.
 */
export function validateDecodedDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new BackgroundImageError("decode-failed", "decoded image has no valid dimensions");
  }
  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
    throw new BackgroundImageError(
      "dimension-too-large",
      `decoded image exceeds the ${MAX_DIMENSION_PX}px maximum dimension`
    );
  }
  const pixels = width * height;
  if (pixels > MAX_DECODED_PIXELS) {
    throw new BackgroundImageError("too-many-pixels", `decoded image exceeds ${MAX_DECODED_PIXELS} pixels`);
  }
  return pixels;
}

// --- Aspect-fit math ----------------------------------------------------

/**
 * Pure aspect-preserving "contain"/letterbox fit: centers `srcW x srcH`
 * inside `destW x destH` without ever stretching, cropping, or
 * exceeding the destination rectangle. One deterministic transform --
 * the same inputs always produce the same `{x,y,w,h}`, and the blank
 * margin (if any) is simply whatever space `x`/`y` leave uncovered,
 * never hidden or papered over.
 */
export function computeContainFit(srcW, srcH, destW, destH) {
  for (const n of [srcW, srcH, destW, destH]) {
    if (!Number.isFinite(n) || n <= 0) {
      throw new BackgroundImageError("invalid-fit-input", "fit requires finite, positive dimensions");
    }
  }
  const scale = Math.min(destW / srcW, destH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (destW - w) / 2, y: (destH - h) / 2, w, h };
}

function canvasKeyOf(canvasSize) {
  return `${canvasSize.id}:${canvasSize.orientation ?? ""}`;
}

/**
 * In-memory, per-step (`sequenceId`-keyed) store for one background
 * image plus its raster overlays. Mirrors `GuideMarkupOverlay`'s own
 * per-step `Map` convention and `clearStep`/`clearAll` lifecycle hooks,
 * but is a wholly SEPARATE store -- background/overlay data never lives
 * inside `GuideMarkupOverlay`'s shape arrays or undo/redo snapshots
 * (brief's own explicit instruction), so a background/overlay can never
 * be undone/redone as if it were author markup, and clearing markup
 * history never touches a background.
 *
 * This store never decodes an image itself. Every `decoded` argument
 * below is an ALREADY-decoded, already-validated
 * `{url, bitmap, width, height}` record that the caller (process-
 * training.js) produced via the real browser decode + this module's own
 * `validateCandidateBytes`/`validateDecodedDimensions`. `deps.revokeObjectURL`
 * is called for every owned resource this store ever drops (replace,
 * remove, clearStep, clearAll), so a caller using the real browser API
 * there never leaks an object URL; a test can inject a recording mock
 * instead to prove the call actually happened.
 */
export class GuideBackgroundStore {
  constructor(deps) {
    this._revokeObjectURL = deps?.revokeObjectURL ?? (() => {});
    this._byStep = new Map();
  }

  _state(sequenceId) {
    if (!Number.isInteger(sequenceId) || sequenceId < 0) {
      throw new BackgroundImageError("invalid-sequence-id", `invalid sequenceId: ${String(sequenceId)}`);
    }
    let s = this._byStep.get(sequenceId);
    if (!s) {
      s = { background: null, overlays: [], nextOverlayId: 1 };
      this._byStep.set(sequenceId, s);
    }
    return s;
  }

  /** Read-only: a step's current background record, or `null`. Never a live reference a caller could mutate. */
  backgroundFor(sequenceId) {
    const bg = this._state(sequenceId).background;
    return bg ? { ...bg } : null;
  }

  /** Read-only snapshot of a step's current overlays, in back-to-front order. Never a live reference. */
  overlaysFor(sequenceId) {
    return this._state(sequenceId).overlays.map((o) => ({ ...o }));
  }

  /** True if the step has a background or any overlay -- the brief's own "any background or raster overlays also block a silent size change" check, independently testable here rather than only assumed at the UI layer. */
  hasContentFor(sequenceId) {
    const state = this._state(sequenceId);
    return state.background !== null || state.overlays.length > 0;
  }

  /**
   * Sets (or replaces) a step's background. Replacing an existing one
   * revokes its own URL AND clears+revokes every existing overlay
   * (brief's own rule) -- this method performs that once called; the
   * caller (process-training.js) is responsible for confirming with the
   * author first when overlays already exist, per the brief's explicit
   * "warning/confirmation before replacement if any exist" UX
   * requirement -- a UI concern, not this pure store's job.
   */
  setBackground(sequenceId, decoded, canvasSize) {
    validateDecodedDimensions(decoded.width, decoded.height);
    const state = this._state(sequenceId);
    const fit = computeContainFit(decoded.width, decoded.height, canvasSize.width, canvasSize.height);
    if (state.background) this._revokeObjectURL(state.background.url);
    for (const overlay of state.overlays) this._revokeObjectURL(overlay.url);
    state.overlays = [];
    state.background = {
      url: decoded.url,
      bitmap: decoded.bitmap,
      width: decoded.width,
      height: decoded.height,
      canvasId: canvasKeyOf(canvasSize),
      ...fit,
    };
  }

  /** Removes a step's background (and, per the brief, every overlay with it), revoking both resources. A no-op (not an error) if there was none. */
  clearBackground(sequenceId) {
    const state = this._state(sequenceId);
    if (state.background) this._revokeObjectURL(state.background.url);
    for (const overlay of state.overlays) this._revokeObjectURL(overlay.url);
    state.background = null;
    state.overlays = [];
  }

  /**
   * Adds one raster overlay, back-to-front order (new ones on top).
   * Fails closed on the per-step overlay-count cap or the aggregate
   * decoded-pixel budget (background + every overlay) -- never silently
   * drops an existing layer to make room.
   */
  addOverlay(sequenceId, decoded, canvasSize) {
    validateDecodedDimensions(decoded.width, decoded.height);
    const state = this._state(sequenceId);
    if (state.overlays.length >= MAX_OVERLAYS_PER_STEP) {
      throw new BackgroundImageError("too-many-overlays", `at most ${MAX_OVERLAYS_PER_STEP} overlays are allowed per step`);
    }
    const existingPixels =
      (state.background ? state.background.width * state.background.height : 0) +
      state.overlays.reduce((sum, o) => sum + o.width * o.height, 0);
    if (existingPixels + decoded.width * decoded.height > MAX_AGGREGATE_PIXELS_PER_STEP) {
      throw new BackgroundImageError(
        "aggregate-budget-exceeded",
        `background + overlays would exceed the ${MAX_AGGREGATE_PIXELS_PER_STEP}-pixel aggregate budget for this step`
      );
    }
    const fit = computeContainFit(decoded.width, decoded.height, canvasSize.width, canvasSize.height);
    const id = `bg${sequenceId}-ov${state.nextOverlayId++}`;
    state.overlays.push({
      id,
      url: decoded.url,
      bitmap: decoded.bitmap,
      width: decoded.width,
      height: decoded.height,
      canvasId: canvasKeyOf(canvasSize),
      ...fit,
    });
    return id;
  }

  /**
   * Explicit numeric placement edit for one overlay. Requires the
   * ENTIRE destination rectangle to stay inside the given canvas size;
   * rejects rather than clamps, and rejects without mutating anything
   * on failure. Also re-verifies the overlay's own stamped canvas
   * identity still matches -- unreachable in normal operation (canvas
   * switching is blocked while any overlay exists), but checked anyway
   * as a real, test-checked invariant rather than an assumption, same
   * stance Slice A took for shape `canvasId` stamping.
   */
  updateOverlayPlacement(sequenceId, overlayId, { x, y, w, h }, canvasSize) {
    const state = this._state(sequenceId);
    const overlay = state.overlays.find((o) => o.id === overlayId);
    if (!overlay) {
      throw new BackgroundImageError("unknown-overlay", `no overlay with id ${String(overlayId)} on sequenceId ${sequenceId}`);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new BackgroundImageError("invalid-placement", "overlay placement requires finite x,y,w,h with w,h > 0");
    }
    if (x < 0 || y < 0 || x + w > canvasSize.width || y + h > canvasSize.height) {
      throw new BackgroundImageError("invalid-placement", "overlay placement must stay entirely inside the step canvas");
    }
    if (overlay.canvasId !== canvasKeyOf(canvasSize)) {
      throw new BackgroundImageError("canvas-mismatch", "overlay's stamped canvas no longer matches the step's current canvas");
    }
    overlay.x = x;
    overlay.y = y;
    overlay.w = w;
    overlay.h = h;
  }

  /** Swaps one overlay forward (toward the top/front) in z-order. A no-op if it's already frontmost. Fails closed on an unknown id. */
  moveOverlayForward(sequenceId, overlayId) {
    const state = this._state(sequenceId);
    const idx = state.overlays.findIndex((o) => o.id === overlayId);
    if (idx === -1) {
      throw new BackgroundImageError("unknown-overlay", `no overlay with id ${String(overlayId)} on sequenceId ${sequenceId}`);
    }
    if (idx < state.overlays.length - 1) {
      [state.overlays[idx], state.overlays[idx + 1]] = [state.overlays[idx + 1], state.overlays[idx]];
    }
  }

  /** Swaps one overlay backward (toward the back, but never behind the background) in z-order. A no-op if it's already backmost. Fails closed on an unknown id. */
  moveOverlayBackward(sequenceId, overlayId) {
    const state = this._state(sequenceId);
    const idx = state.overlays.findIndex((o) => o.id === overlayId);
    if (idx === -1) {
      throw new BackgroundImageError("unknown-overlay", `no overlay with id ${String(overlayId)} on sequenceId ${sequenceId}`);
    }
    if (idx > 0) {
      [state.overlays[idx], state.overlays[idx - 1]] = [state.overlays[idx - 1], state.overlays[idx]];
    }
  }

  /** Removes one overlay, revoking its own resource. Fails closed on an unknown id -- never a silent no-op, same stance as GuideMarkupOverlay.deleteShape. */
  removeOverlay(sequenceId, overlayId) {
    const state = this._state(sequenceId);
    const idx = state.overlays.findIndex((o) => o.id === overlayId);
    if (idx === -1) {
      throw new BackgroundImageError("unknown-overlay", `no overlay with id ${String(overlayId)} on sequenceId ${sequenceId}`);
    }
    this._revokeObjectURL(state.overlays[idx].url);
    state.overlays.splice(idx, 1);
  }

  /** Clears one step's background and every overlay, revoking every owned resource, and drops the step's state entirely. */
  clearStep(sequenceId) {
    this.clearBackground(sequenceId);
    this._byStep.delete(sequenceId);
  }

  /** Clears every step's background/overlays, revoking every owned resource. Called on discard/reset/target-change/compile-failure, alongside `GuideMarkupOverlay.clearAll()` -- see process-training.js. */
  clearAll() {
    for (const sequenceId of [...this._byStep.keys()]) {
      this.clearStep(sequenceId);
    }
  }
}
