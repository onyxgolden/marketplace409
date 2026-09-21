// FORGE Capture — pixel encoders for still-image formats the browser cannot
// encode natively via canvas.toBlob (GIF, TIFF, BMP). Pure functions over
// RGBA bytes: framework-neutral and unit-testable in Node. PNG/JPEG/WebP
// stay on the native canvas.toBlob path in the host.

import { applyPalette, GIFEncoder, quantize } from "gifenc";
import UTIF from "utif";

function assertPixels(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("pixel encoders require positive integer dimensions");
  }
  if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4) {
    throw new Error("pixel encoders require RGBA bytes of length width*height*4");
  }
}

// GIF89a, single frame, 256-color palette quantized from the source pixels.
export function encodeGif(rgba, width, height) {
  assertPixels(rgba, width, height);
  const palette = quantize(rgba, 256);
  const indexed = applyPalette(rgba, palette);
  const encoder = new GIFEncoder();
  encoder.writeFrame(indexed, width, height, { palette });
  encoder.finish();
  return new Uint8Array(encoder.bytes());
}

// TIFF (big-endian) via UTIF.js.
export function encodeTiff(rgba, width, height) {
  assertPixels(rgba, width, height);
  return new Uint8Array(UTIF.encodeImage(rgba, width, height));
}

// 24-bit uncompressed BMP, hand-rolled: the format is tiny enough that no
// dependency is warranted. BGR order, bottom-up rows, 4-byte row padding.
export function encodeBmp(rgba, width, height) {
  assertPixels(rgba, width, height);
  const rowStride = Math.floor((width * 3 + 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const out = new Uint8Array(54 + pixelBytes);
  const view = new DataView(out.buffer);
  out[0] = 0x42; // "B"
  out[1] = 0x4d; // "M"
  view.setUint32(2, out.length, true); // file size
  view.setUint32(10, 54, true); // pixel data offset
  view.setUint32(14, 40, true); // BITMAPINFOHEADER size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive height = bottom-up
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, pixelBytes, true); // image data size
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = 54 + y * rowStride;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 3;
      out[d] = rgba[s + 2];
      out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s];
    }
  }
  return out;
}
