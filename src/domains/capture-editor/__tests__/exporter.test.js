import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMATS,
  ExportError,
  exportExtensionForFormat,
  exportLabelForFormat,
  exportMimeForFormat,
  flattenDocument,
  isNativeBlobFormat,
} from "../exporter.js";
import { addAnnotation, createDocument } from "../document.js";
import { createAnnotation } from "../annotations.js";
import { FakeCanvas, fillCanvasSolid, pixelAt } from "./fake-canvas.js";

function makeDoc(width = 48, height = 32) {
  return createDocument({
    id: "export-doc-1",
    width,
    height,
    source: { kind: "embedded", mime: "image/png", bytes: "aGVsbG8=" },
  });
}

function makeSource(width, height, r = 10, g = 120, b = 200) {
  const canvas = new FakeCanvas(width, height);
  fillCanvasSolid(canvas, r, g, b, 255);
  return canvas;
}

const createCanvas = (w, h) => new FakeCanvas(w, h);

// Stand-in encoder: returns the raw RGBA bytes so tests can assert on pixels
// without a real PNG codec (the PNG round trip is covered in redaction-export).
const encodeRaster = async ({ canvas }) => {
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  return new Uint8Array(data);
};

function solidRectAnnotation(id, type, geometry, color) {
  return createAnnotation(type, geometry, {
    id,
    style: { stroke: color, fill: color, strokeWidth: 1 },
  });
}

describe("flattenDocument", () => {
  it("defaults to PNG and reports its shape", async () => {
    expect(EXPORT_FORMATS).toEqual(["png", "jpeg", "webp", "gif", "tiff", "bmp"]);
    const artifact = await flattenDocument({
      doc: makeDoc(),
      sourceImage: makeSource(48, 32),
      createCanvas,
      encodeRaster,
    });
    expect(artifact.format).toBe("png");
    expect(artifact.mime).toBe("image/png");
    expect(artifact.width).toBe(48);
    expect(artifact.height).toBe(32);
    expect(artifact.bytes).toBeInstanceOf(Uint8Array);
    expect(artifact.bytes.length).toBe(48 * 32 * 4);
    expect(Object.isFrozen(artifact)).toBe(true);
  });

  it("composes on a fresh canvas at source resolution", async () => {
    const seen = [];
    const trackingCreateCanvas = (w, h) => {
      seen.push([w, h]);
      return new FakeCanvas(w, h);
    };
    await flattenDocument({ doc: makeDoc(96, 64), sourceImage: makeSource(96, 64), createCanvas: trackingCreateCanvas, encodeRaster });
    expect(seen[0]).toEqual([96, 64]);
  });

  it("draws the source image first, then annotations over it", async () => {
    let doc = makeDoc();
    doc = addAnnotation(doc, solidRectAnnotation("r1", "rectangle", { x: 4, y: 4, w: 8, h: 8 }, "#ff0000"));
    const artifact = await flattenDocument({ doc, sourceImage: makeSource(48, 32), createCanvas, encodeRaster });
    const px = (x, y) => {
      const i = (y * 48 + x) * 4;
      return [artifact.bytes[i], artifact.bytes[i + 1], artifact.bytes[i + 2], artifact.bytes[i + 3]];
    };
    expect(px(6, 6)).toEqual([255, 0, 0, 255]); // annotation
    expect(px(40, 28)).toEqual([10, 120, 200, 255]); // untouched source
  });

  it("composites annotations in deterministic z-order", async () => {
    let doc = makeDoc();
    doc = addAnnotation(doc, solidRectAnnotation("red", "rectangle", { x: 4, y: 4, w: 16, h: 16 }, "#ff0000"));
    doc = addAnnotation(doc, solidRectAnnotation("blue", "rectangle", { x: 10, y: 10, w: 16, h: 16 }, "#0000ff"));
    const artifact = await flattenDocument({ doc, sourceImage: makeSource(48, 32), createCanvas, encodeRaster });
    const i = (14 * 48 + 14) * 4; // inside the overlap
    expect([artifact.bytes[i], artifact.bytes[i + 1], artifact.bytes[i + 2]]).toEqual([0, 0, 255]);
  });

  it("rejects unsupported formats", async () => {
    await expect(
      flattenDocument({ doc: makeDoc(), sourceImage: makeSource(48, 32), createCanvas, encodeRaster, format: "pdf" }),
    ).rejects.toThrow(ExportError);
  });

  it("carries the requested format and mime through the artifact", async () => {
    const artifact = await flattenDocument({
      doc: makeDoc(), sourceImage: makeSource(48, 32), createCanvas, encodeRaster, format: "jpeg",
    });
    expect(artifact.format).toBe("jpeg");
    expect(artifact.mime).toBe("image/jpeg");
  });

  it("fails closed when required inputs are missing", async () => {
    const base = { doc: makeDoc(), sourceImage: makeSource(48, 32), createCanvas, encodeRaster };
    await expect(flattenDocument({ ...base, doc: null })).rejects.toThrow(ExportError);
    await expect(flattenDocument({ ...base, sourceImage: null })).rejects.toThrow(ExportError);
    await expect(flattenDocument({ ...base, createCanvas: null })).rejects.toThrow(ExportError);
    await expect(flattenDocument({ ...base, encodeRaster: null })).rejects.toThrow(ExportError);
    await expect(
      flattenDocument({ ...base, doc: { ...base.doc, canvas: { width: 0, height: 32 } } }),
    ).rejects.toThrow(ExportError);
  });

  it("fails closed when createCanvas throws or has no 2d context", async () => {
    const base = { doc: makeDoc(), sourceImage: makeSource(48, 32), encodeRaster };
    await expect(
      flattenDocument({ ...base, createCanvas: () => { throw new Error("nope"); } }),
    ).rejects.toThrow(/createCanvas failed/);
    await expect(
      flattenDocument({ ...base, createCanvas: () => ({ getContext: () => null }) }),
    ).rejects.toThrow(/2d context unavailable/);
  });

  it("fails closed when rendering throws", async () => {
    const evilSource = {
      width: 48,
      height: 32,
      get data() {
        throw new Error("boom");
      },
    };
    await expect(
      flattenDocument({ doc: makeDoc(), sourceImage: evilSource, createCanvas, encodeRaster }),
    ).rejects.toThrow(/render failed/);
  });

  it("fails closed when the encoder throws or returns nothing", async () => {
    const base = { doc: makeDoc(), sourceImage: makeSource(48, 32), createCanvas };
    await expect(
      flattenDocument({ ...base, encodeRaster: async () => { throw new Error("encoder down"); } }),
    ).rejects.toThrow(/encode failed/);
    await expect(
      flattenDocument({ ...base, encodeRaster: async () => new Uint8Array(0) }),
    ).rejects.toThrow(/no bytes/);
    await expect(
      flattenDocument({ ...base, encodeRaster: async () => "not-bytes" }),
    ).rejects.toThrow(/no bytes/);
  });

  it("renders blur annotations through the injected canvas factory", async () => {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("blur", { x: 8, y: 8, w: 16, h: 16 }));
    const artifact = await flattenDocument({ doc, sourceImage: makeSource(48, 32), createCanvas, encodeRaster });
    expect(artifact.bytes.length).toBe(48 * 32 * 4);
    // The blur region is composited from the source (opaque), not transparent.
    const i = (12 * 48 + 12) * 4;
    expect(artifact.bytes[i + 3]).toBe(255);
  });

  it("pixel output is deterministic across runs", async () => {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("blackout", { x: 8, y: 8, w: 16, h: 16 }));
    doc = addAnnotation(doc, createAnnotation("arrow", { points: [[0, 0], [47, 31]] }));
    const source = makeSource(48, 32);
    const first = await flattenDocument({ doc, sourceImage: source, createCanvas, encodeRaster });
    const second = await flattenDocument({ doc, sourceImage: source, createCanvas, encodeRaster });
    expect(first.bytes).toEqual(second.bytes);
  });

  it("renders through a viewport-independent path (display zoom never leaks in)", async () => {
    // flattenDocument takes no viewport at all: the composition is always at
    // source resolution with an identity transform.
    let doc = makeDoc();
    doc = addAnnotation(doc, solidRectAnnotation("r1", "rectangle", { x: 4, y: 4, w: 8, h: 8 }, "#ff0000"));
    const a = await flattenDocument({ doc, sourceImage: makeSource(48, 32), createCanvas, encodeRaster });
    const c = new FakeCanvas(48, 32);
    const p = pixelAt(c, 0, 0);
    expect(p).toEqual([0, 0, 0, 0]); // sanity: helper canvas starts transparent
    const i = (6 * 48 + 6) * 4;
    expect([a.bytes[i], a.bytes[i + 1], a.bytes[i + 2], a.bytes[i + 3]]).toEqual([255, 0, 0, 255]);
  });
});

describe("export format registry", () => {
  it("maps every format to a mime type, extension, and label", () => {
    expect(exportMimeForFormat("png")).toBe("image/png");
    expect(exportMimeForFormat("jpeg")).toBe("image/jpeg");
    expect(exportMimeForFormat("webp")).toBe("image/webp");
    expect(exportMimeForFormat("gif")).toBe("image/gif");
    expect(exportMimeForFormat("tiff")).toBe("image/tiff");
    expect(exportMimeForFormat("bmp")).toBe("image/bmp");
    expect(exportExtensionForFormat("jpeg")).toBe("jpg");
    expect(exportExtensionForFormat("tiff")).toBe("tif");
    expect(exportExtensionForFormat("png")).toBe("png");
    expect(exportLabelForFormat("webp")).toBe("WebP");
    expect(exportLabelForFormat("gif")).toBe("GIF");
  });

  it("rejects unknown formats in every lookup", () => {
    expect(() => exportMimeForFormat("pdf")).toThrow(ExportError);
    expect(() => exportExtensionForFormat("pdf")).toThrow(ExportError);
    expect(() => exportLabelForFormat("pdf")).toThrow(ExportError);
  });

  it("marks only canvas-native formats for the toBlob path", () => {
    expect(isNativeBlobFormat("png")).toBe(true);
    expect(isNativeBlobFormat("jpeg")).toBe(true);
    expect(isNativeBlobFormat("webp")).toBe(true);
    expect(isNativeBlobFormat("gif")).toBe(false);
    expect(isNativeBlobFormat("tiff")).toBe(false);
    expect(isNativeBlobFormat("bmp")).toBe(false);
  });
});
