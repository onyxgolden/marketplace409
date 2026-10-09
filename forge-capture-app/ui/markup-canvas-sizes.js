// FORGE Capture — plotter/paper canvas size catalog (ui/markup-canvas-sizes.js).
//
// Pure, DOM-free registry of named per-step markup canvas sizes, for the
// plotter-paper-size slice (Capture plotter canvases and refinery plot-plan
// backgrounds -- Slice A: per-step paper sizes). See
// commands/muse/capture-plotter-sizes-and-plot-import-after-pt5.md for the
// full brief this follows. Built after PT-5 (P&ID symbols) merged at
// 18af0188; no edits to workflow-symbols.js or pid-symbols.js (neither has
// any notion of the shared canvas -- see process-guide-markup.js's own
// header comment for that boundary, unchanged by this slice).
//
// Contract: every logical size is DERIVED from a catalog id + orientation,
// at a fixed 96 logical units/inch, independent of the viewer's monitor
// DPI -- there is no code path anywhere in this module that accepts a raw
// width/height from a caller. This is what "reject forged arbitrary sizes"
// means in practice: forgery is not merely rejected by a check, it is
// structurally impossible, because `resolveCanvasSize` is the only way to
// produce a `{id, orientation, width, height}` identity and it only ever
// derives width/height from the catalog's own inch values.
//
// Physical print scale is NOT promised by this module or by anything that
// consumes it -- "96 logical units/inch" is a fixed internal coordinate
// convention for keeping shapes/labels proportioned sensibly across very
// different canvas sizes, not a calibrated plotter/print output guarantee.

export const LOGICAL_UNITS_PER_INCH = 96;

/**
 * The legacy, pre-existing default canvas -- unchanged from PT-3/4/5's own
 * fixed 640x480 placeholder. Not a paper size (no inch dimensions), so it
 * is kept as its own special-cased id rather than forced into the
 * PAPER_SIZES catalog below.
 */
export const LEGACY_CANVAS_ID = "legacy";
const LEGACY_WIDTH = 640;
const LEGACY_HEIGHT = 480;

/** Landscape intrinsic inches for each catalog entry; portrait swaps width/height at resolve time, never stored twice. */
export const PAPER_SIZES = Object.freeze([
  { id: "ansi_b", name: "ANSI B (17×11 in)", widthIn: 17, heightIn: 11 },
  { id: "ansi_c", name: "ANSI C (22×17 in)", widthIn: 22, heightIn: 17 },
  { id: "ansi_d", name: "ANSI D (34×22 in)", widthIn: 34, heightIn: 22 },
  { id: "ansi_e", name: "ANSI E (44×34 in)", widthIn: 44, heightIn: 34 },
  { id: "arch_c", name: "Arch C (24×18 in)", widthIn: 24, heightIn: 18 },
  { id: "arch_d", name: "Arch D (36×24 in)", widthIn: 36, heightIn: 24 },
  { id: "arch_e", name: "Arch E (48×36 in)", widthIn: 48, heightIn: 36 },
]);

const PAPER_SIZES_BY_ID = new Map(PAPER_SIZES.map((s) => [s.id, s]));

export const ORIENTATIONS = Object.freeze(["landscape", "portrait"]);

export class CanvasSizeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanvasSizeError";
    this.code = code;
  }
}

/**
 * The ONLY function in this module that produces a usable canvas
 * identity. Always derives `width`/`height` from the catalog's own inch
 * values (or the legacy fixed pixels) -- never accepts them as input, so
 * there is no parameter an arbitrary/forged size could be smuggled
 * through. Fails closed on an unknown id or an invalid orientation.
 *
 * @param {string} sizeId - `LEGACY_CANVAS_ID` or one of `PAPER_SIZES`' own ids
 * @param {"landscape"|"portrait"} [orientation] - required for a paper size; ignored (must be omitted or "landscape") for legacy, which has no orientation concept
 * @returns {Readonly<{id: string, orientation: ("landscape"|"portrait"|null), width: number, height: number}>}
 *
 * Review finding (PR #600 round 1): without this, a resolved identity was
 * an ordinary mutable object, and `DEFAULT_CANVAS_SIZE` below was a single
 * SHARED instance assigned by reference to every step that had never
 * called `setCanvasSize` -- so a caller holding one step's
 * `canvasSizeFor()` result could write `size.width = ...` and silently
 * corrupt every other legacy-default step's bounds too, bypassing the
 * catalog-only derivation this module exists to guarantee. Every
 * identity this function returns is now frozen -- in ES module strict
 * mode, an assignment to a frozen object's property throws a TypeError
 * rather than silently no-opping, so the bypass is closed, not just
 * discouraged.
 */
export function resolveCanvasSize(sizeId, orientation) {
  if (sizeId === LEGACY_CANVAS_ID) {
    if (orientation !== undefined && orientation !== null && orientation !== "landscape") {
      throw new CanvasSizeError("invalid-orientation", "the legacy canvas has no orientation concept");
    }
    return Object.freeze({ id: LEGACY_CANVAS_ID, orientation: null, width: LEGACY_WIDTH, height: LEGACY_HEIGHT });
  }
  const def = PAPER_SIZES_BY_ID.get(sizeId);
  if (!def) {
    throw new CanvasSizeError("unknown-size", `unknown canvas size id: ${String(sizeId)}`);
  }
  if (!ORIENTATIONS.includes(orientation)) {
    throw new CanvasSizeError(
      "invalid-orientation",
      `orientation must be one of ${ORIENTATIONS.join(", ")} for a paper size`
    );
  }
  const landscape = orientation === "landscape";
  const widthIn = landscape ? def.widthIn : def.heightIn;
  const heightIn = landscape ? def.heightIn : def.widthIn;
  return Object.freeze({
    id: def.id,
    orientation,
    width: widthIn * LOGICAL_UNITS_PER_INCH,
    height: heightIn * LOGICAL_UNITS_PER_INCH,
  });
}

/** The step default when no size has ever been explicitly chosen -- same 640x480 every pre-existing test/caller already assumes. */
export const DEFAULT_CANVAS_SIZE = resolveCanvasSize(LEGACY_CANVAS_ID);

/** A stable string key for comparing/stamping canvas identities (never used to derive width/height -- resolveCanvasSize is the only source of those). */
export function canvasSizeKey(canvasSize) {
  return `${canvasSize.id}:${canvasSize.orientation ?? ""}`;
}
