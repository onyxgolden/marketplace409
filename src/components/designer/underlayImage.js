/**
 * Background-underlay image import for the FORGE Designer.
 *
 * This is the SINGLE import path every image format flows through:
 * decodeUnderlayFile(file) -> { dataUrl, widthPx, heightPx, mimeType } ->
 * SET_UNDERLAY -> buildUnderlayRecord. Chromium cannot decode TIFF natively,
 * so TIFF files are decoded with UTIF.js into RGBA pixels and re-encoded as
 * a PNG data URL in the browser; PNG/JPEG/WebP/GIF/BMP go through the
 * browser's native <img> decoder.
 */

import UTIF from "utif";

export const UNDERLAY_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/tiff,image/bmp";
export const UNDERLAY_ACCEPT_LABEL = "PNG, JPG, WebP, GIF, TIFF, BMP";

export function isTiffFile({ name, type } = {}) {
  return type === "image/tiff" || /\.tiff?$/i.test(String(name || ""));
}

/**
 * Pure TIFF decode: file bytes -> { rgba, width, height }. Runs in Node and
 * browsers (no DOM needed), so the pixel round trip is unit-testable.
 */
export function decodeTiffRgba(bytes) {
  const ifds = UTIF.decode(bytes);
  if (!ifds || ifds.length === 0) throw new Error("Could not decode that TIFF image.");
  const page = ifds[0];
  UTIF.decodeImage(bytes, page);
  const rgba = UTIF.toRGBA8(page);
  if (!rgba || !(page.width > 0) || !(page.height > 0)) {
    throw new Error("Could not decode that TIFF image.");
  }
  return { rgba, width: page.width, height: page.height };
}

/**
 * Browser-only: RGBA pixels -> PNG data URL via an offscreen canvas.
 */
export function rgbaToPngDataUrl(rgba, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Decode an uploaded underlay file to { dataUrl, widthPx, heightPx, mimeType }.
 * `file` is a File/Blob with name + type. Throws a human-readable Error when
 * the file cannot be decoded.
 */
export async function decodeUnderlayFile(file) {
  if (!file) throw new Error("No file selected.");
  if (isTiffFile(file)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { rgba, width, height } = decodeTiffRgba(bytes);
    return {
      dataUrl: rgbaToPngDataUrl(rgba, width, height),
      widthPx: width,
      heightPx: height,
      mimeType: "image/png",
    };
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
  const dims = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not read that image — the format may be unsupported."));
    img.src = dataUrl;
  });
  return { dataUrl, ...dims, mimeType: file.type || "image/png" };
}
