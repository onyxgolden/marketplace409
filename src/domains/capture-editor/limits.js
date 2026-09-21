// FORGE Capture editor — hard limits (Rung 0 schema §"Limits (Rung 1 enforcement)").
// Framework-neutral: no DOM, no React, no Next.js.

export const CAPTURE_SCHEMA_VERSION = 1;

// Maximum source-image dimension per side (pixels). Matches the Rung 0 schema.
export const MAX_SOURCE_DIMENSION = 16384;

// Maximum decoded source-image memory (bytes, 4 bytes per RGBA pixel).
// 16384 x 16384 x 4 = 1 GiB would be allowed by the dimension cap alone;
// the memory cap is the binding constraint for very large images.
export const MAX_DECODED_BYTES = 128 * 1024 * 1024;

// Undo history depth (session-only, never serialized). Mirrors the scheduling
// board's HISTORY_LIMIT convention.
export const UNDO_DEPTH = 50;

// Source images the Rung 1 importer accepts. SVG is rejected (scriptable image
// format); GIF is rejected (animated input); everything else outside this list
// is rejected as an unsupported form.
export const SUPPORTED_SOURCE_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export class SourceRejectedError extends Error {
  constructor(reason, detail) {
    super(`Source image rejected (${reason})${detail ? `: ${detail}` : ""}`);
    this.name = "SourceRejectedError";
    this.reason = reason;
  }
}

function mimeRejectionReason(mime) {
  if (mime === "image/svg+xml") return "svg-not-supported";
  if (mime === "image/gif") return "animated-not-supported";
  return "unsupported-mime";
}

export function assertSourceMime(mime) {
  if (typeof mime !== "string" || !SUPPORTED_SOURCE_MIME_TYPES.includes(mime)) {
    throw new SourceRejectedError(mimeRejectionReason(mime), String(mime));
  }
  return mime;
}

export function assertSourceDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new SourceRejectedError("invalid-dimensions", `${width}x${height}`);
  }
  if (width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) {
    throw new SourceRejectedError("dimensions-exceed-limit", `${width}x${height}`);
  }
  return { width, height };
}

export function assertDecodedSize(width, height) {
  const bytes = width * height * 4;
  if (bytes > MAX_DECODED_BYTES) {
    throw new SourceRejectedError("decoded-memory-exceeds-limit", `${width}x${height} (${bytes} bytes)`);
  }
  return bytes;
}

// Runs every Rung 1 import gate in one call. Throws SourceRejectedError.
export function validateSourceImage({ width, height, mime }) {
  assertSourceMime(mime);
  assertSourceDimensions(width, height);
  assertDecodedSize(width, height);
  return { width, height, mime };
}
