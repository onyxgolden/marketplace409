// FORGE Capture — PT-3 guide markup overlay (ui/process-guide-markup.js).
//
// Pure, DOM-free, in-memory annotation overlay for a PT-2 compiled guide's
// steps. Reuse decision, from the source audit the PT-3 brief requires
// (core/src/annotations.rs, ui/annotations-render.js, docs/annotations.md)
// done before writing a line of this module:
//
//   - NOT reused: core/src/annotations.rs's schema/validation. It is Rust
//     (not importable here) and, more fundamentally, it is bound to a real
//     source image (`sourceSha256`, `canvas` dimensions decoded from a real
//     PNG). PT-3 has no real image at all; constructing a fake sidecar to
//     satisfy that contract would blur exactly the
//     real-evidence-vs-author-overlay line this slice's own brief insists
//     on keeping separate.
//   - NOT reused: ui/annotations-render.js's `resolveDrawOps(sidecar)`. Its
//     own doc comment is explicit that it "NEVER parses or validates a
//     sidecar on its own" and requires "an already-validated sidecar
//     object exactly as returned by the Tauri `load_annotations` command"
//     — a caller that hands it anything else "has already broken the
//     contract." PT-3's markup never goes through `load_annotations`/
//     `parse_sidecar`, so it would be exactly that caller.
//   - NOT reused, because it does not exist anywhere in this codebase yet:
//     interactive editing — hit-testing, selection, move/resize, undo/
//     redo. `docs/annotations.md`'s own "What is not yet wired" section is
//     explicit: "The interactive drawing UI (mouse-driven creation/editing
//     of annotations) is not part of Slice 1 ... not the toolbar and
//     pointer-event handling." Slices 1–4 built the data contract and a
//     renderer, never an editor — there is nothing of that kind to reuse.
//   - REUSED: `ui/annotations-render.js`'s `drawOpsToCanvas(ctx, ops)`. Its
//     own design is already decoupled from where `ops` came from — "ctx
//     only needs to implement the small subset of CanvasRenderingContext2D
//     used," tested against a recording mock, no dependency on the sidecar
//     schema at all. This module's own `resolveMarkupDrawOps` (below)
//     emits ops in that exact same vocabulary (`rect`, `line` +
//     `filledTriangle` for an arrowhead, `text`) so that existing renderer
//     primitive draws them unmodified — genuine reuse of the one piece of
//     the existing system actually built to be reused this way, not a
//     re-implementation of it. (The arrowhead geometry itself is a ~15-line
//     private helper in that file, not exported; duplicated here rather
//     than imported, which is not "a whole editor.")
//
// PT-4 adds one additive `symbol` kind (the ISO 5807 workflow-symbol
// palette — see workflow-symbols.js's own header for the full reuse/
// legal reasoning) on top of PT-3's three original kinds (`rect`,
// `arrow`, `text`), which this module preserves unchanged: existing
// shape data and undo snapshots round-trip exactly as before.
// `MARKUP_MODEL_VERSION` is an in-memory diagnostic/projection constant
// only — it is not a persisted schema version (there is no persistence),
// and it never changes PT-2 guide's own `schemaVersion`/`source`/
// `status`. This module still owns canvas-bounds validation (`x`, `y`,
// and `x+w`/`y+h` against `MARKUP_CANVAS`); the symbol registries own only
// a symbol's own minimum size and its label, since neither has a notion
// of where on the shared canvas a shape is placed.
//
// PT-5 adds a second symbol registry (`pid-symbols.js`, 35 P&ID-inspired
// glyphs, namespaced `pid.<family>.<name>` ids) alongside PT-4's
// `workflow-symbols.js` (17 ISO 5807 ids) — still exactly one `symbol`
// kind here, no schema/version change. This module imports both through
// `symbol-registry.js`'s shared adapter, never either registry directly,
// so it has no notion that there are two of them; see that module's own
// header for the dispatch/error-normalization contract.
//
// Plotter-size Slice A adds a per-step canvas IDENTITY (one of
// `markup-canvas-sizes.js`'s catalog ids + orientation, or the legacy
// 640x480 default) alongside the existing per-step shapes/undo/redo state
// -- every step still defaults to the legacy canvas exactly as before, so
// nothing about PT-3/4/5's existing behavior changes unless a caller
// explicitly picks a different size. Canvas-bounds validation (`inBounds`,
// below) is now parameterized by the step's own resolved canvas size
// instead of the fixed `MARKUP_CANVAS` constant; neither symbol registry
// needed any change for this -- both already only validate a symbol's OWN
// minimum size/label, never the shared canvas (see their own
// `validateSymbolPlacement` doc comments), so the canvas-size parameter
// never needs to reach them. Switching a step's canvas is only allowed
// while that step has zero shapes and zero undo/redo history (see
// `setCanvasSize` below) -- this is what makes "canvas identity stamped on
// new shapes" a trivial invariant to hold: a step's shapes can never
// actually span two different canvas identities, since resizing a
// non-empty step is rejected outright, never silently migrated/rescaled.
// `MARKUP_MODEL_VERSION` bumps from 2 to 3 for this additive field; still
// an in-memory diagnostic/projection constant only, per this file's own
// established convention above -- never a persisted schema version.
//
// Everything here is an author-added OVERLAY, never evidence: kept
// entirely separate from PT-2's compiled guide (process-guide-compiler.js)
// and associated by the evidence's own immutable `sequenceId`, never by
// array/list index, so it stays correctly attached even if a step's
// position in a re-compiled guide changes. Nothing here ever upgrades
// `source: "fixture"` / `status: "draft_unverified"` — see
// `projectGuideWithMarkup`'s own doc comment below.
//
// No persistence of any kind: no localStorage/sessionStorage/IndexedDB, no
// files, no server API, no export, no clipboard, no AI. Markup lives only
// in one `GuideMarkupOverlay` instance for the lifetime of the review
// session that created it — process-training.js's discard/reset/target-
// change/compile-failure handlers drop the instance entirely, not just
// hide it.

import { validateSymbolPlacement, symbolToDrawOps, SymbolRegistryError } from "./symbol-registry.js";
import { resolveCanvasSize, DEFAULT_CANVAS_SIZE, canvasSizeKey, CanvasSizeError } from "./markup-canvas-sizes.js";

/** The legacy default canvas, re-exported under its original name for every pre-existing caller/test -- same 640x480 as before, now sourced from markup-canvas-sizes.js's own single definition rather than a second literal here. */
export const MARKUP_CANVAS = Object.freeze({ width: DEFAULT_CANVAS_SIZE.width, height: DEFAULT_CANVAS_SIZE.height });
export const MARKUP_SHAPE_KINDS = Object.freeze(["rect", "arrow", "text", "symbol"]);
export const MAX_TEXT_LENGTH = 200;
/** In-memory diagnostic/projection version only -- see this file's own header comment. Bumped 2 -> 3 for the additive per-step canvas-size field. */
export const MARKUP_MODEL_VERSION = 3;
const MAX_UNDO_DEPTH = 50;

export class MarkupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MarkupError";
    this.code = code;
  }
}

/** Parameterized by the step's own resolved canvas size (Slice A) -- never the fixed `MARKUP_CANVAS` constant directly, so a step's bounds check always reflects whichever size it's actually using. */
function inBounds(x, y, canvasSize) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x <= canvasSize.width &&
    y <= canvasSize.height
  );
}

/**
 * Validates and normalizes one shape's input data, per kind. Never
 * invents a screenshot pixel dimension — bounds are always the step's own
 * resolved `canvasSize` (legacy 640x480 by default, or whichever plotter
 * size that step was explicitly switched to), never anything derived from
 * a real capture (there isn't one). Throws `MarkupError` on anything
 * malformed — fails closed rather than clamping/guessing at a usable
 * shape.
 */
function validateShapeInput(kind, data, canvasSize) {
  if (!MARKUP_SHAPE_KINDS.includes(kind)) {
    throw new MarkupError("invalid-kind", `unknown shape kind: ${kind}`);
  }
  if (kind === "rect") {
    const { x, y, w, h } = data;
    if (!inBounds(x, y, canvasSize) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new MarkupError("invalid-shape", "rect requires finite x,y,w,h with w,h > 0");
    }
    if (!inBounds(x + w, y + h, canvasSize)) {
      throw new MarkupError("invalid-shape", "rect extends outside the markup canvas bounds");
    }
    return { kind, x, y, w, h };
  }
  if (kind === "arrow") {
    const { x1, y1, x2, y2 } = data;
    if (!inBounds(x1, y1, canvasSize) || !inBounds(x2, y2, canvasSize)) {
      throw new MarkupError(
        "invalid-shape",
        "arrow endpoints must be within the markup canvas bounds"
      );
    }
    if (x1 === x2 && y1 === y2) {
      throw new MarkupError("invalid-shape", "arrow must have distinct endpoints");
    }
    return { kind, x1, y1, x2, y2 };
  }
  if (kind === "symbol") {
    const { symbolType, x, y, w, h, label } = data;
    if (!inBounds(x, y, canvasSize)) {
      throw new MarkupError("invalid-shape", "symbol placement must be within the markup canvas bounds");
    }
    // Delegates the symbol's own minimum-size/label validation to
    // whichever registry owns `symbolType`, via symbol-registry.js's
    // shared adapter (never duplicated here); this function still owns
    // the shared-canvas placement bounds, which neither registry has a
    // notion of.
    let normalized;
    try {
      normalized = validateSymbolPlacement(symbolType, { w, h, label });
    } catch (e) {
      if (e instanceof SymbolRegistryError) {
        throw new MarkupError("invalid-shape", e.message);
      }
      throw e;
    }
    if (!inBounds(x + normalized.w, y + normalized.h, canvasSize)) {
      throw new MarkupError("invalid-shape", "symbol extends outside the markup canvas bounds");
    }
    return { kind, symbolType: normalized.symbolType, x, y, w: normalized.w, h: normalized.h, label: normalized.label };
  }
  // text
  const { x, y, text } = data;
  if (!inBounds(x, y, canvasSize)) {
    throw new MarkupError("invalid-shape", "text anchor must be within the markup canvas bounds");
  }
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length === 0) {
    throw new MarkupError("invalid-shape", "text annotation must not be empty");
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new MarkupError("invalid-shape", `text annotation exceeds ${MAX_TEXT_LENGTH} characters`);
  }
  // Stored as plain text only. Rendering is the caller's job and must use
  // textContent/escaping, never innerHTML, with this value — see
  // process-training.js's own rendering and the structural test that
  // pins this module never does DOM/HTML work itself.
  return { kind, x, y, text: trimmed };
}

function cloneShapes(shapes) {
  return shapes.map((s) => ({ ...s }));
}

/**
 * In-memory markup overlay for one PT-1C review session, keyed by the
 * evidence's own `sequenceId` (never a list index — see this module's own
 * header comment for why). One instance = one session's worth of
 * annotations; discard/reset simply drops the instance.
 */
export class GuideMarkupOverlay {
  constructor() {
    this._byStep = new Map();
  }

  _state(sequenceId) {
    if (!Number.isInteger(sequenceId) || sequenceId < 0) {
      throw new MarkupError("invalid-sequence-id", `invalid sequenceId: ${String(sequenceId)}`);
    }
    let s = this._byStep.get(sequenceId);
    if (!s) {
      s = { shapes: [], undo: [], redo: [], nextShapeId: 1, canvasSize: DEFAULT_CANVAS_SIZE };
      this._byStep.set(sequenceId, s);
    }
    return s;
  }

  /** The step's current resolved canvas identity -- the legacy 640x480 default until explicitly switched. */
  canvasSizeFor(sequenceId) {
    return this._state(sequenceId).canvasSize;
  }

  /**
   * Switches one step's canvas to a different catalog size/orientation
   * (or back to legacy). Only allowed while that step has zero shapes AND
   * zero undo/redo history -- otherwise rejects WITHOUT any mutation,
   * same fail-closed stance as every other validation in this module.
   * Never migrates, rescales, or silently discards existing shapes; the
   * caller's own UI is expected to offer `clearStep` first if the step
   * isn't empty (see process-training.js).
   */
  setCanvasSize(sequenceId, sizeId, orientation) {
    const state = this._state(sequenceId);
    if (state.shapes.length > 0 || state.undo.length > 0 || state.redo.length > 0) {
      throw new MarkupError(
        "canvas-locked",
        "clear this step's shapes and undo/redo history before changing its canvas size"
      );
    }
    let resolved;
    try {
      resolved = resolveCanvasSize(sizeId, orientation);
    } catch (e) {
      if (e instanceof CanvasSizeError) {
        throw new MarkupError(e.code, e.message);
      }
      throw e;
    }
    state.canvasSize = resolved;
    return resolved;
  }

  _snapshot(state) {
    state.undo.push(cloneShapes(state.shapes));
    if (state.undo.length > MAX_UNDO_DEPTH) state.undo.shift();
    state.redo = [];
  }

  /** Read-only snapshot of one step's current shapes — never a live reference an outside caller could mutate. */
  shapesFor(sequenceId) {
    return cloneShapes(this._state(sequenceId).shapes);
  }

  canUndo(sequenceId) {
    return this._state(sequenceId).undo.length > 0;
  }

  canRedo(sequenceId) {
    return this._state(sequenceId).redo.length > 0;
  }

  /** Adds a validated shape to one step and returns its new id. Fails closed (throws) on any malformed input — nothing partial is ever added. Stamped with the step's current `canvasId` (Slice A) -- a legacy-canvas step's shapes carry the legacy id, same as if this field had always existed. */
  addShape(sequenceId, kind, data) {
    const state = this._state(sequenceId);
    const shape = validateShapeInput(kind, data, state.canvasSize);
    this._snapshot(state);
    const id = `m${sequenceId}-${state.nextShapeId++}`;
    state.shapes.push({ id, canvasId: canvasSizeKey(state.canvasSize), ...shape });
    return id;
  }

  /** Updates (move/resize/retext) an existing shape by id. Unknown id fails closed — never a silent no-op. The shape's original `canvasId` is preserved, never recomputed -- a step's canvas can't have changed since this shape was added (switching is only allowed while a step is empty), so this is a defensive invariant, not a behavior change. */
  updateShape(sequenceId, shapeId, patch) {
    const state = this._state(sequenceId);
    const idx = state.shapes.findIndex((s) => s.id === shapeId);
    if (idx === -1) {
      throw new MarkupError(
        "unknown-shape",
        `no shape with id ${String(shapeId)} on sequenceId ${sequenceId}`
      );
    }
    const existing = state.shapes[idx];
    const merged = validateShapeInput(existing.kind, { ...existing, ...patch }, state.canvasSize);
    this._snapshot(state);
    state.shapes[idx] = { id: shapeId, canvasId: existing.canvasId, ...merged };
  }

  /** Deletes a shape by id. Unknown id fails closed. */
  deleteShape(sequenceId, shapeId) {
    const state = this._state(sequenceId);
    const idx = state.shapes.findIndex((s) => s.id === shapeId);
    if (idx === -1) {
      throw new MarkupError(
        "unknown-shape",
        `no shape with id ${String(shapeId)} on sequenceId ${sequenceId}`
      );
    }
    this._snapshot(state);
    state.shapes.splice(idx, 1);
  }

  /** Returns false (a no-op) rather than throwing when there is nothing to undo — an empty stack is an ordinary state, not an error. */
  undo(sequenceId) {
    const state = this._state(sequenceId);
    if (state.undo.length === 0) return false;
    state.redo.push(cloneShapes(state.shapes));
    state.shapes = state.undo.pop();
    return true;
  }

  redo(sequenceId) {
    const state = this._state(sequenceId);
    if (state.redo.length === 0) return false;
    state.undo.push(cloneShapes(state.shapes));
    state.shapes = state.redo.pop();
    return true;
  }

  /** Clears one step's markup and its undo/redo history entirely -- including its chosen canvas size, which reverts to the legacy default on next access. This is the explicit "clear-step/history first" unlock the brief names for switching a non-empty step's canvas; a caller that wants to keep the same non-legacy size after clearing calls `setCanvasSize` again right after. */
  clearStep(sequenceId) {
    this._byStep.delete(sequenceId);
  }

  /** Clears every step's markup. Called on discard/reset/target-change/compile-failure — see process-training.js. */
  clearAll() {
    this._byStep.clear();
  }
}

const ARROWHEAD_MIN_LEN = 10;
const ARROWHEAD_ANGLE_RAD = (25 * Math.PI) / 180;
const ARROWHEAD_STROKE_WIDTH = 2;

/** A small, local arrowhead-geometry helper (same algorithm as annotations-render.js's private, unexported `arrowheadPoints` — duplicated rather than imported, since it is not exported and is ~15 lines, not "a whole editor"). */
function arrowheadOps(shape, color) {
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const headLen = Math.max(ARROWHEAD_MIN_LEN, ARROWHEAD_STROKE_WIDTH * 4);
  const back = (angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = -ux * cos - -uy * sin;
    const ry = -ux * sin + -uy * cos;
    return { x: shape.x2 + rx * headLen, y: shape.y2 + ry * headLen };
  };
  const to = { x: shape.x2, y: shape.y2 };
  return [
    {
      op: "filledTriangle",
      id: shape.id,
      points: [to, back(ARROWHEAD_ANGLE_RAD), back(-ARROWHEAD_ANGLE_RAD)],
      color,
    },
  ];
}

const MARKUP_COLOR = Object.freeze({ r: 217, g: 154, b: 61, a: 255 }); // matches styles.css --accent

/**
 * Turns one step's shape list into the same draw-op vocabulary
 * `ui/annotations-render.js`'s `drawOpsToCanvas` already knows how to draw
 * (`rect`, `line` + `filledTriangle` for an arrow's head, `text`) — see
 * this module's own header comment for why that function, specifically
 * and only that function, is reused rather than re-implemented. Pure: no
 * canvas calls here, just plain op data.
 *
 * `canvasSize` (Slice A) bounds a text shape's `maxWidth` against the
 * STEP'S OWN resolved canvas, not the fixed legacy default -- defaults to
 * `DEFAULT_CANVAS_SIZE` so every pre-existing caller/test that doesn't
 * pass it keeps its exact prior behavior (legacy 640-wide bounding).
 */
export function resolveMarkupDrawOps(shapes, canvasSize = DEFAULT_CANVAS_SIZE) {
  const ops = [];
  for (const shape of shapes) {
    if (shape.kind === "rect") {
      ops.push({
        op: "rect",
        id: shape.id,
        x: shape.x,
        y: shape.y,
        w: shape.w,
        h: shape.h,
        color: MARKUP_COLOR,
        strokeWidth: ARROWHEAD_STROKE_WIDTH,
      });
    } else if (shape.kind === "arrow") {
      ops.push({
        op: "line",
        id: shape.id,
        x1: shape.x1,
        y1: shape.y1,
        x2: shape.x2,
        y2: shape.y2,
        color: MARKUP_COLOR,
        strokeWidth: ARROWHEAD_STROKE_WIDTH,
      });
      ops.push(...arrowheadOps(shape, MARKUP_COLOR));
    } else if (shape.kind === "text") {
      ops.push({
        op: "text",
        id: shape.id,
        x: shape.x,
        y: shape.y,
        maxWidth: canvasSize.width - shape.x,
        color: MARKUP_COLOR,
        text: shape.text,
      });
    } else if (shape.kind === "symbol") {
      // Delegated entirely to whichever registry owns `shape.symbolType`
      // (via symbol-registry.js) -- this module never duplicates symbol
      // geometry, only wires the already-validated shape into the same
      // draw-op pipeline the other three kinds use.
      ops.push(...symbolToDrawOps(shape));
    }
  }
  return ops;
}

/**
 * A pure projection: combines a PT-2 compiled guide with one overlay's
 * markup, per step, keyed by `sequenceId`. Never mutates `guide` (every
 * object is freshly spread); never touches `guide.source`/`guide.status`
 * — markup is an author-added overlay, not a reason to call anything
 * "verified." A step whose `sequenceId` has no markup yet gets an empty
 * `markup: []`, never an error.
 */
export function projectGuideWithMarkup(guide, overlay) {
  if (!guide || !Array.isArray(guide.steps)) {
    throw new MarkupError("invalid-guide", "guide must have a steps array");
  }
  return {
    ...guide,
    steps: guide.steps.map((step) => ({
      ...step,
      markup: overlay.shapesFor(step.sequenceId),
    })),
  };
}
