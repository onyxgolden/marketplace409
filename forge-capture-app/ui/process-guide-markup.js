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
// and `x+w`/`y+h` against `MARKUP_CANVAS`); workflow-symbols.js owns only
// a symbol's own minimum size and its label, since it has no notion of
// where on the shared canvas a shape is placed.
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

import { validateSymbolPlacement, symbolToDrawOps, WorkflowSymbolError } from "./workflow-symbols.js";

export const MARKUP_CANVAS = Object.freeze({ width: 640, height: 480 });
export const MARKUP_SHAPE_KINDS = Object.freeze(["rect", "arrow", "text", "symbol"]);
export const MAX_TEXT_LENGTH = 200;
/** In-memory diagnostic/projection version only -- see this file's own header comment. */
export const MARKUP_MODEL_VERSION = 2;
const MAX_UNDO_DEPTH = 50;

export class MarkupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MarkupError";
    this.code = code;
  }
}

function inBounds(x, y) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x <= MARKUP_CANVAS.width &&
    y <= MARKUP_CANVAS.height
  );
}

/**
 * Validates and normalizes one shape's input data, per kind. Never
 * invents a screenshot pixel dimension — bounds are always this module's
 * own fixed, explicit `MARKUP_CANVAS`, not anything derived from a real
 * capture (there isn't one). Throws `MarkupError` on anything malformed
 * — fails closed rather than clamping/guessing at a usable shape.
 */
function validateShapeInput(kind, data) {
  if (!MARKUP_SHAPE_KINDS.includes(kind)) {
    throw new MarkupError("invalid-kind", `unknown shape kind: ${kind}`);
  }
  if (kind === "rect") {
    const { x, y, w, h } = data;
    if (!inBounds(x, y) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new MarkupError("invalid-shape", "rect requires finite x,y,w,h with w,h > 0");
    }
    if (!inBounds(x + w, y + h)) {
      throw new MarkupError("invalid-shape", "rect extends outside the markup canvas bounds");
    }
    return { kind, x, y, w, h };
  }
  if (kind === "arrow") {
    const { x1, y1, x2, y2 } = data;
    if (!inBounds(x1, y1) || !inBounds(x2, y2)) {
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
    if (!inBounds(x, y)) {
      throw new MarkupError("invalid-shape", "symbol placement must be within the markup canvas bounds");
    }
    // Delegates the symbol's own minimum-size/label validation to
    // workflow-symbols.js (never duplicated here); this function still
    // owns the shared-canvas placement bounds, which that module has no
    // notion of.
    let normalized;
    try {
      normalized = validateSymbolPlacement(symbolType, { w, h, label });
    } catch (e) {
      if (e instanceof WorkflowSymbolError) {
        throw new MarkupError("invalid-shape", e.message);
      }
      throw e;
    }
    if (!inBounds(x + normalized.w, y + normalized.h)) {
      throw new MarkupError("invalid-shape", "symbol extends outside the markup canvas bounds");
    }
    return { kind, symbolType: normalized.symbolType, x, y, w: normalized.w, h: normalized.h, label: normalized.label };
  }
  // text
  const { x, y, text } = data;
  if (!inBounds(x, y)) {
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
      s = { shapes: [], undo: [], redo: [], nextShapeId: 1 };
      this._byStep.set(sequenceId, s);
    }
    return s;
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

  /** Adds a validated shape to one step and returns its new id. Fails closed (throws) on any malformed input — nothing partial is ever added. */
  addShape(sequenceId, kind, data) {
    const shape = validateShapeInput(kind, data);
    const state = this._state(sequenceId);
    this._snapshot(state);
    const id = `m${sequenceId}-${state.nextShapeId++}`;
    state.shapes.push({ id, ...shape });
    return id;
  }

  /** Updates (move/resize/retext) an existing shape by id. Unknown id fails closed — never a silent no-op. */
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
    const merged = validateShapeInput(existing.kind, { ...existing, ...patch });
    this._snapshot(state);
    state.shapes[idx] = { id: shapeId, ...merged };
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

  /** Clears one step's markup and its undo/redo history entirely. */
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
 */
export function resolveMarkupDrawOps(shapes) {
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
        maxWidth: MARKUP_CANVAS.width - shape.x,
        color: MARKUP_COLOR,
        text: shape.text,
      });
    } else if (shape.kind === "symbol") {
      // Delegated entirely to workflow-symbols.js -- this module never
      // duplicates symbol geometry, only wires the already-validated
      // shape into the same draw-op pipeline the other three kinds use.
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
