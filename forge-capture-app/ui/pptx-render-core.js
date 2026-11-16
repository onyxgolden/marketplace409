// FORGE Capture — PPTX render orchestration (ui/pptx-render-core.js).
//
// DOM-free except for the rasterizer, whose canvas/image factories are
// injected so the orchestration stays unit-testable under vitest (node).
// Runs in the Tauri webview for real work.
//
// Rendering uses the vendored Pagus bundle (ui/vendor/pptx.bundle.mjs):
//   parse(ArrayBuffer) -> Presentation IR
//   renderSlide(slide, slideSizePt, { scale, fontSubstitutes }) -> SVG
//
// Font rule (brief §2.2): fonts already installed on the machine only.
// No Google Fonts, no fetched fonts, no embedded-font extraction.
// Every used font that is not locally available is mapped to the first
// available documented fallback (Segoe UI, then Arial) and reported as
// an unresolved-font warning — a fidelity tradeoff, never a silent
// failure and never a network request.
import { parse as pagusParse, renderSlide as pagusRenderSlide } from "./vendor/pptx.bundle.mjs";

export const LOCAL_FONT_FALLBACKS = Object.freeze(["Segoe UI", "Arial", "sans-serif"]);

/** Default still-image output size (brief §2.5): 1080p landscape. */
export const RENDER_TARGET = Object.freeze({ width: 1920, height: 1080 });

/** SHA-256 hex of bytes (WebCrypto; available in the webview and node). */
export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Map every used font to a locally available substitute.
 * @param {string[]} usedFonts
 * @param {(name: string) => boolean} fontAvailable — probe; in the
 *   webview this is the canvas-measurement `webviewFontAvailable`, in
 *   tests an injected stub.
 * @returns {{ substitutes: Record<string,string>, unresolved: string[] }}
 *   `unresolved` lists fonts that needed a substitute (fidelity warning).
 */
export function resolveFontSubstitutes(usedFonts, fontAvailable) {
  const substitutes = {};
  const unresolved = [];
  const availableFallback =
    LOCAL_FONT_FALLBACKS.find((name) => name === "sans-serif" || fontAvailable(name)) ||
    "sans-serif";
  for (const font of usedFonts) {
    if (fontAvailable(font)) continue;
    substitutes[font] = availableFallback;
    unresolved.push(font);
  }
  return { substitutes, unresolved };
}

/** Default `fontAvailable` probe for the webview (canvas measurement). */
export function webviewFontAvailable(name) {
  // document.fonts.check() cannot detect a missing system font in
  // Chromium: it returns true for any family name, because text always
  // renders with *some* fallback — so the font-substitution warning
  // could never fire in the real app. Measure instead: a test string
  // set in the candidate font is exactly as wide as the same string in
  // the bare fallback only when the candidate is not installed and the
  // text fell back.
  try {
    const canvas = globalThis.document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const probe = "mmmmmmmmmmlli";
    ctx.font = `16px "${name}", monospace`;
    const withCandidate = ctx.measureText(probe).width;
    ctx.font = "16px monospace";
    const fallbackOnly = ctx.measureText(probe).width;
    return withCandidate !== fallbackOnly;
  } catch {
    return false;
  }
}

/** Render scale so the slide's long edge lands on the target long edge. */
export function renderScaleForSlide(slideSizePt, targetLongEdge = RENDER_TARGET.width) {
  const basePx = (slideSizePt.width * 96) / 72;
  const scale = targetLongEdge / basePx;
  return Math.min(3, Math.max(0.5, scale));
}

/**
 * Parse + render every slide of a validated package to SVG.
 * @param {object} pkg — from validateAndExtractPptx.
 * @param {object} [options]
 * @param {(name: string) => boolean} [options.fontAvailable]
 * @param {AbortSignal} [options.signal]
 * @param {(slide: object) => void} [options.onSlide]
 * @returns {{ slides, slideSize, fonts }} — slides carry svg, dimensions,
 *   sha256 and warnings. Throws on a Pagus parse failure or a slide-count
 *   mismatch (never a silent partial render).
 */
export async function renderPresentation(pkg, options = {}) {
  const fontAvailable = options.fontAvailable || webviewFontAvailable;
  const signal = options.signal || null;
  const source = pkg.sourceBytes;
  const buffer =
    source instanceof Uint8Array
      ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
      : source;
  let presentation;
  try {
    presentation = await pagusParse(buffer);
  } catch (e) {
    throw new Error(`The slides could not be rendered: ${e && e.message ? e.message : "parser failed"}`);
  }
  if (presentation.slides.length !== pkg.slideCount) {
    throw new Error(
      `The slides could not be rendered: the file lists ${pkg.slideCount} slides but the renderer found ${presentation.slides.length}.`,
    );
  }
  const usedFonts = [...(presentation.fonts?.usedFontFamilies || [])];
  const { substitutes, unresolved } = resolveFontSubstitutes(usedFonts, fontAvailable);
  const fonts = { used: usedFonts, substitutes, unresolved };
  // Pagus takes slide size as { width, height } in points; the package
  // carries it as widthPt/heightPt (plus the raw EMU values).
  const slideSizePt = { width: pkg.slideSize.widthPt, height: pkg.slideSize.heightPt };
  const scale = renderScaleForSlide(slideSizePt);
  const slides = [];
  for (let i = 0; i < presentation.slides.length; i += 1) {
    if (signal && signal.aborted) throw new DOMException("Import was cancelled.", "AbortError");
    const slide = presentation.slides[i];
    let rendered;
    try {
      rendered = pagusRenderSlide(slide, slideSizePt, { scale, fontSubstitutes: substitutes });
    } catch (e) {
      throw new Error(`Slide ${i + 1} could not be rendered: ${e && e.message ? e.message : "renderer failed"}`);
    }
    const svgBytes = new TextEncoder().encode(rendered.svg);
    const record = {
      index: i,
      svg: rendered.svg,
      widthPx: rendered.width,
      heightPx: rendered.height,
      sha256: await sha256Hex(svgBytes),
      warnings:
        unresolved.length > 0
          ? [
              {
                code: "font-substituted",
                message: `Fonts ${unresolved.join(", ")} are not installed on this machine, so Segoe UI/Arial was used instead.`,
              },
            ]
          : [],
    };
    slides.push(record);
    if (options.onSlide) options.onSlide(record);
  }
  return { slides, slideSize: pkg.slideSize, fonts };
}

/**
 * Letterbox rect: fit a slide image inside a target frame without
 * stretching. Pure math — unit-tested.
 */
export function letterboxRect(slideWidth, slideHeight, targetWidth, targetHeight) {
  const scale = Math.min(targetWidth / slideWidth, targetHeight / slideHeight);
  const width = Math.floor(slideWidth * scale);
  const height = Math.floor(slideHeight * scale);
  return { x: Math.floor((targetWidth - width) / 2), y: Math.floor((targetHeight - height) / 2), width, height };
}

const DEFAULT_RASTER_FACTORIES = Object.freeze({
  createImage: () => new globalThis.Image(),
  createCanvas: (width, height) => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  createObjectUrl: (blob) => globalThis.URL.createObjectURL(blob),
  revokeObjectUrl: (url) => globalThis.URL.revokeObjectURL(url),
});

/**
 * Rasterize one slide SVG to a PNG at the render target size
 * (letterboxed, never stretched). The PNG is the canonical still image
 * for the later video renderer (Slice 4).
 *
 * KNOWN LIMIT (found in E2E, Nov 15): Pagus draws all slide text inside
 * <foreignObject>, and Chromium taints any canvas an SVG-with-
 * foreignObject is drawn onto, so `canvas.toBlob()` throws
 * SecurityError for every real slide in the browser. Slice 1 therefore
 * stores the SVG itself as the thumbnail and does not call this
 * function. Slice 4 must rasterize by another path (e.g. a renderer
 * that emits plain <text>, or a native SVG→PNG step) — do not wire this
 * into the Slice 4 assembly assuming it works on Pagus output.
 *
 * @param {string} svg — complete <svg> string from renderPresentation.
 * @param {number} slideWidthPx — SVG width in px.
 * @param {number} slideHeightPx — SVG height in px.
 * @param {object} [factories] — injectable { createImage, createCanvas,
 *   createObjectUrl, revokeObjectUrl } (browser defaults; stubbed in tests).
 * @returns {{ bytes: Uint8Array, width: number, height: number, sha256: string }}
 */
export async function rasterizeSvgToPng(svg, slideWidthPx, slideHeightPx, factories = DEFAULT_RASTER_FACTORIES) {
  const { width: targetWidth, height: targetHeight } = RENDER_TARGET;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = factories.createObjectUrl(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = factories.createImage();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The slide picture could not be drawn."));
      image.src = url;
    });
    const canvas = factories.createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The slide picture could not be drawn: no 2D canvas.");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    const rect = letterboxRect(slideWidthPx, slideHeightPx, targetWidth, targetHeight);
    ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height);
    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("The slide picture could not be saved as a PNG."));
      }, "image/png");
    });
    const bytes = new Uint8Array(await pngBlob.arrayBuffer());
    return { bytes, width: targetWidth, height: targetHeight, sha256: await sha256Hex(bytes) };
  } finally {
    factories.revokeObjectUrl(url);
  }
}
