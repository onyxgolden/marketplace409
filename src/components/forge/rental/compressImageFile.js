const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;
// Below this, compressing isn't worth the quality loss -- most real-world PDFs and already-
// reasonably-sized images pass through untouched. Phone-camera photos of paper documents (the
// common case for surveys, deeds, and similar scans) are the ones that actually need this: Vercel's
// request body limit is well under what a modern phone camera produces, so an uncompressed upload
// can fail with a 413 before it ever reaches the app's own (larger) file-size validation.
const SKIP_COMPRESSION_UNDER_BYTES = 2 * 1024 * 1024;

// Downscales and re-encodes an oversized image client-side before upload. Never touches non-image
// files (PDF, text) -- those aren't affected by this failure mode and aren't safely re-encodable
// this way. Falls back to the original file if compression doesn't actually help or the browser
// can't perform it, rather than blocking the upload.
export async function compressImageFile(file, { createBitmap, createCanvas } = {}) {
  if (!file || !file.type.startsWith("image/") || file.size <= SKIP_COMPRESSION_UNDER_BYTES) return file;

  try {
    // Referenced lazily (not as a parameter default) so this module can load in environments
    // without a browser image-decoding API (e.g. server-side or tests) without throwing.
    const bitmap = await (createBitmap ?? globalThis.createImageBitmap)(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = (createCanvas ?? (() => document.createElement("canvas")))();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
