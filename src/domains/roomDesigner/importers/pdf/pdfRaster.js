/**
 * Scanned-page rasterization: a PDF page → a scaled Designer underlay image.
 *
 * The pure, testable part is the SIZING decision (renderPlan): what pixel
 * dimensions to ask for, what DPI is actually achievable inside the canvas
 * budget, and what pxPerIn the resulting bitmap must be tagged with so it
 * lands true to scale on the plan. Nothing in renderPlan touches pdf.js or
 * the DOM.
 *
 * The impure part (rasterizePdfPage) is a thin wrapper: allocate a canvas,
 * let pdf.js paint the page, read back a PNG data URL. It is browser-only,
 * and it is the ONLY place in this importer that needs a canvas.
 *
 * Scale contract: a rendered page is tagged pxPerIn = dpi / scaleFactor.
 *   - scaleFactor 1 (uncalibrated) → the underlay is PAPER size on the plan:
 *     an 8.5×11 sheet covers 8.5×11 plan inches.
 *   - scaleFactor 48 (1/4" = 1'-0") → the same sheet covers 34×44 feet, i.e.
 *     real-world size, so tracing over it produces true dimensions.
 * Either way the user can re-calibrate afterwards with the Designer's
 * existing two-click calibrate tool, which edits exactly this pxPerIn.
 */

import { PDF_POINTS_PER_INCH, designerPageSize } from "./pdfCoordinates";

/** Default render resolution: legible for tracing without exploding memory. */
export const DEFAULT_RENDER_DPI = 150;

/** Selectable resolutions offered in the UI. */
export const RENDER_DPI_CHOICES = Object.freeze([96, 150, 200, 300]);

/**
 * Pixel budget for one rendered page (~40 megapixels). Chromium's own canvas
 * area limit is higher, but a data-URL PNG of that page has to fit in the
 * design document, so the real constraint is memory, not the canvas cap.
 */
export const MAX_RENDER_PIXELS = 40_000_000;

/** Largest single dimension any 2-D canvas is guaranteed to support. */
export const MAX_CANVAS_DIMENSION = 16384;

/**
 * Decide how to rasterize a page. Pure.
 *
 * Returns { dpi, requestedDpi, scale, widthPx, heightPx, pxPerIn,
 *           pageWidthIn, pageHeightIn, downgraded }.
 * `scale` is what to pass to pdf.js's getViewport; `dpi` is what was actually
 * achievable after clamping, and `downgraded` says whether clamping happened
 * so the UI can say so instead of quietly producing a blurrier trace.
 */
export function renderPlan({ viewBox, rotation = 0, userUnit = 1 }, { dpi = DEFAULT_RENDER_DPI, scaleFactor = 1 } = {}) {
  const requestedDpi = Number.isFinite(dpi) && dpi > 0 ? dpi : DEFAULT_RENDER_DPI;
  const factor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const { widthIn: pageWidthIn, heightIn: pageHeightIn } = designerPageSize({ viewBox, rotation, userUnit });

  if (!(pageWidthIn > 0) || !(pageHeightIn > 0)) {
    throw new Error("The page has no usable size to render.");
  }

  // Clamp for total pixels and for each dimension, then re-derive the DPI
  // that the clamp actually allows, so pxPerIn always matches the bitmap.
  let effectiveDpi = requestedDpi;
  const areaLimitedDpi = Math.sqrt(MAX_RENDER_PIXELS / (pageWidthIn * pageHeightIn));
  const sideLimitedDpi = MAX_CANVAS_DIMENSION / Math.max(pageWidthIn, pageHeightIn);
  effectiveDpi = Math.min(effectiveDpi, areaLimitedDpi, sideLimitedDpi);
  // Whole DPI keeps the numbers the UI shows honest and reproducible.
  effectiveDpi = Math.max(24, Math.floor(effectiveDpi));

  const widthPx = Math.max(1, Math.round(pageWidthIn * effectiveDpi));
  const heightPx = Math.max(1, Math.round(pageHeightIn * effectiveDpi));

  return {
    dpi: effectiveDpi,
    requestedDpi,
    downgraded: effectiveDpi < requestedDpi,
    scale: effectiveDpi / PDF_POINTS_PER_INCH,
    widthPx,
    heightPx,
    // Real-world inches per bitmap pixel, inverted: the underlay covers
    // pageWidthIn * factor plan inches.
    pxPerIn: effectiveDpi / factor,
    pageWidthIn,
    pageHeightIn,
  };
}

/**
 * Render a pdf.js page proxy to an underlay image descriptor.
 * Browser-only (needs a canvas). Returns the shape setUnderlay expects:
 * { name, mimeType, dataUrl, widthPx, heightPx, pxPerIn } plus the plan.
 *
 * `createCanvas` is injectable so this can be exercised against a fake canvas
 * without a headless browser.
 */
export async function rasterizePdfPage(page, { dpi = DEFAULT_RENDER_DPI, scaleFactor = 1, name = "pdf page", createCanvas } = {}) {
  if (!page || typeof page.getViewport !== "function" || typeof page.render !== "function") {
    throw new Error("rasterizePdfPage needs a pdf.js page proxy.");
  }
  const plan = renderPlan(
    { viewBox: page.view, rotation: page.rotate, userUnit: page.userUnit },
    { dpi, scaleFactor },
  );

  const canvas = typeof createCanvas === "function"
    ? createCanvas(plan.widthPx, plan.heightPx)
    : defaultCanvas(plan.widthPx, plan.heightPx);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not get a 2-D canvas context to render the page.");

  // A scan's white paper must actually be white: an unpainted canvas is
  // transparent, which reads as black on a dark plan background.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, plan.widthPx, plan.heightPx);

  const viewport = page.getViewport({ scale: plan.scale });
  await page.render({ canvasContext: context, viewport, canvas }).promise;

  const dataUrl = canvas.toDataURL("image/png");
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("The rendered page could not be read back as an image.");
  }

  return {
    image: {
      name,
      mimeType: "image/png",
      dataUrl,
      widthPx: plan.widthPx,
      heightPx: plan.heightPx,
      pxPerIn: plan.pxPerIn,
    },
    plan,
  };
}

function defaultCanvas(width, height) {
  if (typeof document === "undefined") {
    throw new Error("Rendering a scanned page needs a browser canvas.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
