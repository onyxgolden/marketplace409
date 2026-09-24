// pdfRaster.test.js — scanned-page rasterization.
//
// The sizing decision is pure and is what these tests pin: the bitmap's pixel
// size, the DPI actually achievable inside the image budget, and the pxPerIn
// the underlay must be tagged with so a traced scan measures correctly.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDER_DPI,
  MAX_CANVAS_DIMENSION,
  MAX_RENDER_PIXELS,
  RENDER_DPI_CHOICES,
  rasterizePdfPage,
  renderPlan,
} from "./pdfRaster";
import { PDF_POINTS_PER_INCH } from "./pdfCoordinates";
import { ARCH_D_PAGE, LETTER_PAGE, fakeCanvasFactory } from "./testUtils/pdfFixture";
import { buildUnderlayRecord } from "../../designerDocument";

describe("renderPlan", () => {
  it("sizes a US Letter page at the requested DPI", () => {
    const plan = renderPlan(LETTER_PAGE, { dpi: 150 });
    expect(plan.dpi).toBe(150);
    expect(plan.downgraded).toBe(false);
    expect(plan.widthPx).toBe(Math.round(8.5 * 150));
    expect(plan.heightPx).toBe(Math.round(11 * 150));
    expect(plan.pageWidthIn).toBe(8.5);
    expect(plan.pageHeightIn).toBe(11);
  });

  it("gives pdf.js a scale in points, not inches", () => {
    const plan = renderPlan(LETTER_PAGE, { dpi: 144 });
    expect(plan.scale).toBeCloseTo(144 / PDF_POINTS_PER_INCH, 12);
    expect(plan.scale).toBeCloseTo(2, 12);
  });

  it("tags an uncalibrated render as paper-true: pxPerIn equals the DPI", () => {
    const plan = renderPlan(LETTER_PAGE, { dpi: 150, scaleFactor: 1 });
    expect(plan.pxPerIn).toBe(150);
    // 8.5 inches of paper covers 8.5 plan inches.
    expect(plan.widthPx / plan.pxPerIn).toBeCloseTo(8.5, 9);
  });

  it("tags a scaled render so the underlay covers real-world inches", () => {
    // At 1/4" = 1'-0", an 8.5×11 sheet is 34×44 feet of building.
    const plan = renderPlan(LETTER_PAGE, { dpi: 150, scaleFactor: 48 });
    expect(plan.pxPerIn).toBeCloseTo(150 / 48, 9);
    expect(plan.widthPx / plan.pxPerIn).toBeCloseTo(8.5 * 48, 6);
    expect(plan.widthPx / plan.pxPerIn / 12).toBeCloseTo(34, 6);
  });

  it("swaps dimensions for a rotated page", () => {
    const plan = renderPlan({ ...LETTER_PAGE, rotation: 90 }, { dpi: 100 });
    expect(plan.pageWidthIn).toBe(11);
    expect(plan.pageHeightIn).toBe(8.5);
    expect(plan.widthPx).toBe(1100);
    expect(plan.heightPx).toBe(850);
  });

  it("downgrades the DPI for a large sheet instead of allocating past the budget", () => {
    // ARCH-D is 36×24 inches: 300 DPI would be 10800×7200 = 78 megapixels.
    const plan = renderPlan(ARCH_D_PAGE, { dpi: 300 });
    expect(plan.downgraded).toBe(true);
    expect(plan.requestedDpi).toBe(300);
    expect(plan.dpi).toBeLessThan(300);
    expect(plan.widthPx * plan.heightPx).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
  });

  it("keeps pxPerIn consistent with the DOWNGRADED dpi, not the requested one", () => {
    // If these disagreed, a traced scan would measure wrong by the ratio.
    const plan = renderPlan(ARCH_D_PAGE, { dpi: 300, scaleFactor: 1 });
    expect(plan.pxPerIn).toBe(plan.dpi);
    expect(plan.widthPx / plan.pxPerIn).toBeCloseTo(36, 1);
  });

  it("never exceeds the single-dimension canvas limit", () => {
    const plan = renderPlan({ viewBox: [0, 0, 72 * 200, 72 * 10], rotation: 0, userUnit: 1 }, { dpi: 300 });
    expect(plan.widthPx).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
    expect(plan.heightPx).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
  });

  it("does not upscale a small page past what was asked for", () => {
    const plan = renderPlan({ viewBox: [0, 0, 72, 72], rotation: 0, userUnit: 1 }, { dpi: 96 });
    expect(plan.dpi).toBe(96);
    expect(plan.downgraded).toBe(false);
    expect(plan.widthPx).toBe(96);
  });

  it("falls back to the default DPI for a bad request", () => {
    expect(renderPlan(LETTER_PAGE, { dpi: 0 }).dpi).toBe(DEFAULT_RENDER_DPI);
    expect(renderPlan(LETTER_PAGE, { dpi: NaN }).dpi).toBe(DEFAULT_RENDER_DPI);
    expect(renderPlan(LETTER_PAGE, {}).dpi).toBe(DEFAULT_RENDER_DPI);
  });

  it("falls back to an unscaled factor for a bad scale", () => {
    expect(renderPlan(LETTER_PAGE, { dpi: 100, scaleFactor: 0 }).pxPerIn).toBe(100);
    expect(renderPlan(LETTER_PAGE, { dpi: 100, scaleFactor: NaN }).pxPerIn).toBe(100);
  });

  it("offers only DPI choices it can honour for a normal sheet", () => {
    for (const dpi of RENDER_DPI_CHOICES) {
      expect(renderPlan(LETTER_PAGE, { dpi }).downgraded, `${dpi} DPI`).toBe(false);
    }
  });

  it("refuses a page with no usable size", () => {
    expect(() => renderPlan({ viewBox: [0, 0, 0, 0] }, {})).toThrow(/no usable size/);
  });
});

describe("rasterizePdfPage", () => {
  const fakePage = (facts = LETTER_PAGE) => ({
    view: facts.viewBox,
    rotate: facts.rotation,
    userUnit: facts.userUnit,
    getViewport: ({ scale }) => ({ scale, width: 100, height: 100 }),
    render: () => ({ promise: Promise.resolve() }),
  });

  it("returns an image descriptor setUnderlay accepts, carrying the true scale", async () => {
    const record = {};
    const { image, plan } = await rasterizePdfPage(fakePage(), {
      dpi: 150,
      scaleFactor: 48,
      name: "plan.pdf — page 1",
      createCanvas: fakeCanvasFactory(record),
    });
    expect(record.width).toBe(plan.widthPx);
    expect(record.height).toBe(plan.heightPx);
    expect(image.mimeType).toBe("image/png");
    expect(image.dataUrl.startsWith("data:image/png")).toBe(true);
    expect(image.widthPx).toBe(plan.widthPx);
    expect(image.pxPerIn).toBeCloseTo(150 / 48, 9);
    expect(image.name).toBe("plan.pdf — page 1");
  });

  it("paints the sheet white first, so a scan is not transparent on a dark canvas", async () => {
    const record = {};
    const { plan } = await rasterizePdfPage(fakePage(), { createCanvas: fakeCanvasFactory(record) });
    expect(record.filled).toEqual({ x: 0, y: 0, w: plan.widthPx, h: plan.heightPx });
  });

  it("hands the descriptor straight to buildUnderlayRecord without losing the scale", async () => {
    const { image } = await rasterizePdfPage(fakePage(), {
      dpi: 200,
      scaleFactor: 96,
      createCanvas: fakeCanvasFactory({}),
    });
    const underlay = buildUnderlayRecord(image);
    expect(underlay.pxPerIn).toBeCloseTo(200 / 96, 9);
    // The underlay spans the sheet's real-world width, 8.5 ft × 96.
    expect(underlay.widthPx / underlay.pxPerIn).toBeCloseTo(8.5 * 96, 4);
  });

  it("refuses anything that is not a pdf.js page proxy", async () => {
    await expect(rasterizePdfPage(null, {})).rejects.toThrow(/page proxy/);
    await expect(rasterizePdfPage({}, {})).rejects.toThrow(/page proxy/);
  });

  it("reports a canvas that yields no context", async () => {
    const badCanvas = () => ({ getContext: () => null, toDataURL: () => "" });
    await expect(rasterizePdfPage(fakePage(), { createCanvas: badCanvas })).rejects.toThrow(/2-D canvas/);
  });

  it("reports a canvas that cannot be read back as an image", async () => {
    const badCanvas = (w, h) => ({
      width: w, height: h,
      getContext: () => ({ fillRect: () => {} }),
      toDataURL: () => "nope",
    });
    await expect(rasterizePdfPage(fakePage(), { createCanvas: badCanvas })).rejects.toThrow(/read back/);
  });
});
