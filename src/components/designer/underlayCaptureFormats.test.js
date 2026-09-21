// Capture-format underlay import: all six FORGE Capture export formats
// (PNG, JPEG, WebP, GIF, TIFF, BMP) decode through the single Designer
// underlay import path (decodeUnderlayFile -> SET_UNDERLAY ->
// buildUnderlayRecord). TIFF — which Chromium cannot decode natively —
// round-trips pixel-exact through the UTIF decode used by that path.
//
// The native-decode legs (PNG/JPEG/WebP/GIF/BMP via <img>, TIFF->PNG via
// canvas) need a real browser DOM, so here we verify: the accept list, TIFF
// detection, the pixel-exact TIFF round trip, and that the record builder
// accepts every format's data URL.

import { encodeBmp, encodeGif, encodeTiff } from "@/domains/capture-editor/pixelEncoders";
import { buildUnderlayRecord } from "@/domains/roomDesigner/designerDocument";
import {
  UNDERLAY_ACCEPT,
  decodeTiffRgba,
  isTiffFile,
} from "./underlayImage";

// 4x3 RGBA swatch: distinct colors per pixel, mixed alpha.
const W = 4;
const H = 3;
const PIXELS = new Uint8Array([
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128,
  0, 0, 0, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255, 255, 0,
  128, 128, 128, 255, 64, 32, 16, 255, 16, 32, 64, 200, 255, 128, 64, 255,
]);

const dataUrlFor = (mime, bytes) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
// Minimal 1x1 transparent PNG (real bytes) for the native-format data URLs.
const TINY_PNG = dataUrlFor(
  "image/png",
  new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
    8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 24, 5,
    163, 96, 20, 140, 2, 0, 0, 16, 0, 1, 203, 207, 203, 181, 0, 0, 0, 0, 73, 69, 78, 68,
    174, 66, 96, 130,
  ]),
);

describe("capture-format underlay import", () => {
  it("accepts all six capture export formats", () => {
    const accepted = UNDERLAY_ACCEPT.split(",");
    for (const mime of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/tiff",
      "image/bmp",
    ]) {
      expect(accepted).toContain(mime);
    }
  });

  it("detects TIFF files by MIME type or extension", () => {
    expect(isTiffFile({ name: "scan.tiff", type: "image/tiff" })).toBe(true);
    expect(isTiffFile({ name: "scan.tif", type: "" })).toBe(true);
    expect(isTiffFile({ name: "photo.png", type: "image/png" })).toBe(false);
    expect(isTiffFile({ name: "photo.bmp", type: "image/bmp" })).toBe(false);
  });

  it("TIFF round-trips pixel-exact through the Designer's UTIF decode", () => {
    const tiffBytes = encodeTiff(PIXELS, W, H);
    const { rgba, width, height } = decodeTiffRgba(tiffBytes);
    expect(width).toBe(W);
    expect(height).toBe(H);
    expect(Array.from(rgba)).toEqual(Array.from(PIXELS));
  });

  it("TIFF decodes from File bytes the same way decodeUnderlayFile feeds them", async () => {
    const tiffBytes = encodeTiff(PIXELS, W, H);
    const file = new Blob([tiffBytes], { type: "image/tiff" });
    expect(isTiffFile(file)).toBe(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { rgba, width, height } = decodeTiffRgba(bytes);
    expect(width).toBe(W);
    expect(height).toBe(H);
    expect(Array.from(rgba)).toEqual(Array.from(PIXELS));
  });

  it("rejects corrupt TIFF bytes with a readable error", () => {
    expect(() => decodeTiffRgba(new Uint8Array([1, 2, 3, 4]))).toThrow(/decode/i);
  });

  it("GIF exports carry a GIF header and their data URL builds an underlay record", () => {
    const gifBytes = encodeGif(PIXELS, W, H);
    expect(String.fromCharCode(...gifBytes.slice(0, 6))).toMatch(/^GIF8[79]a$/);
    const record = buildUnderlayRecord({
      name: "capture.gif",
      mimeType: "image/gif",
      dataUrl: dataUrlFor("image/gif", gifBytes),
      widthPx: W,
      heightPx: H,
    });
    expect(record.widthPx).toBe(W);
    expect(record.heightPx).toBe(H);
  });

  it("BMP exports carry the BM magic and their data URL builds an underlay record", () => {
    const bmpBytes = encodeBmp(PIXELS, W, H);
    expect(String.fromCharCode(bmpBytes[0], bmpBytes[1])).toBe("BM");
    const record = buildUnderlayRecord({
      name: "capture.bmp",
      mimeType: "image/bmp",
      dataUrl: dataUrlFor("image/bmp", bmpBytes),
      widthPx: W,
      heightPx: H,
    });
    expect(record.widthPx).toBe(W);
    expect(record.heightPx).toBe(H);
  });

  it("PNG/JPEG/WebP data URLs build underlay records", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      const record = buildUnderlayRecord({
        name: `capture${mime === "image/png" ? ".png" : ""}`,
        mimeType: mime,
        dataUrl: TINY_PNG.replace("image/png", mime),
        widthPx: 1,
        heightPx: 1,
      });
      expect(record.widthPx).toBe(1);
    }
  });
});
