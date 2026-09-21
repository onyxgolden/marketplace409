// FORGE Capture editor — flattened raster export (framework-neutral).
// The exporter composes a FRESH source-sized canvas: source bitmap first, then
// every annotation in deterministic z-order. Blur and blackout are baked into
// raster pixels by the renderer, so the artifact can never be "un-redacted".
// The artifact contains only pixels: no source bytes, no project JSON, no
// editable overlays. Any failure fails closed with ExportError.

import { drawAnnotation } from "./renderer.js";

export class ExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExportError";
  }
}

// Rung 1 exports PNG only: lossless, so redaction proofs are pixel-exact and
// the artifact never carries compression ambiguity around blurred regions.
export const EXPORT_FORMATS = Object.freeze(["png"]);

export function exportMimeForFormat(format) {
  if (format === "png") return "image/png";
  throw new ExportError(`unsupported export format: ${format}`);
}

function fail(message) {
  throw new ExportError(message);
}

// capabilities:
//   createCanvas(width, height) -> canvas with getContext("2d") and .canvas
//   encodeRaster({ canvas, format, width, height }) -> Uint8Array (or Promise of one)
// The encoder is injected so the core never touches browser/Node encoding APIs.
// Returns { bytes, format, mime, width, height }. Always async: browser
// encoders (canvas.toBlob) are async, and sync test doubles resolve fine.
export async function flattenDocument({ doc, sourceImage, createCanvas, encodeRaster, format = "png" }) {
  if (!EXPORT_FORMATS.includes(format)) fail(`unsupported export format: ${format}`);
  if (!doc || typeof doc !== "object" || !doc.canvas) fail("flattenDocument requires a document");
  const { width, height } = doc.canvas;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    fail("document canvas has invalid dimensions");
  }
  if (!sourceImage) fail("flattenDocument requires sourceImage");
  if (typeof createCanvas !== "function") fail("flattenDocument requires createCanvas");
  if (typeof encodeRaster !== "function") fail("flattenDocument requires encodeRaster");

  let canvas;
  try {
    canvas = createCanvas(width, height);
  } catch (e) {
    fail(`createCanvas failed: ${e?.message ?? e}`);
  }
  if (!canvas || typeof canvas.getContext !== "function") fail("createCanvas did not return a canvas");

  let ctx;
  try {
    ctx = canvas.getContext("2d");
  } catch (e) {
    fail(`2d context unavailable: ${e?.message ?? e}`);
  }
  if (!ctx) fail("2d context unavailable");

  // Fresh composition at source resolution: the export never reuses a
  // display or editing canvas, so viewport state cannot leak into pixels.
  try {
    ctx.drawImage(sourceImage, 0, 0, width, height);
    const ordered = [...(doc.annotations ?? [])].sort((a, b) => a.z - b.z);
    for (const annotation of ordered) drawAnnotation(ctx, annotation, { createCanvas });
  } catch (e) {
    if (e instanceof ExportError) throw e;
    fail(`render failed: ${e?.message ?? e}`);
  }

  let bytes;
  try {
    bytes = await encodeRaster({ canvas, format, width, height });
  } catch (e) {
    if (e instanceof ExportError) throw e;
    fail(`encode failed: ${e?.message ?? e}`);
  }
  // Buffer extends Uint8Array, so one check covers Node and browser bytes.
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    fail("encoder returned no bytes");
  }
  return Object.freeze({
    bytes,
    format,
    mime: exportMimeForFormat(format),
    width,
    height,
  });
}
