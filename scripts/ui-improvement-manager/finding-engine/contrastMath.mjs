// WCAG 2.x relative-luminance and contrast-ratio math (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance,
// #dfn-contrast-ratio). Pure arithmetic, not a design opinion -- these formulas and the 3:1/4.5:1
// thresholds are the published objective standard, which is exactly why "unreadable contrast" and
// "missing dark-mode foreground colors" belong in this checkpoint's DETERMINISTIC finding set rather
// than its (currently empty, see the FB-UI-2 report) subjective-suggestion set.

function srgbChannelToLinear(channel255) {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }) {
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(colorA, colorB) {
  const lA = relativeLuminance(colorA);
  const lB = relativeLuminance(colorB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG 2.1 SC 1.4.3 (AA): 4.5:1 for normal text, 3:1 for "large" text (>=24px, or >=18.66px/14pt and
// bold) and for graphical objects/UI components (SC 1.4.11).
export const WCAG_AA_NORMAL_TEXT_RATIO = 4.5;
export const WCAG_AA_LARGE_TEXT_RATIO = 3;
export const WCAG_AA_UI_COMPONENT_RATIO = 3;

export function isLargeText({ fontSizePx, fontWeight }) {
  if (fontSizePx >= 24) return true;
  return fontSizePx >= 18.66 && Number(fontWeight) >= 700;
}

// Parses a CSS `rgb(r, g, b)` / `rgba(r, g, b, a)` computed-style string, exactly the format
// `getComputedStyle(...).color` and `...backgroundColor` return in every evergreen browser (including
// Chromium/Playwright) -- never a hex or named color at the computed-style layer, so this is the only
// shape this module needs to parse. Returns null (rather than throwing) for "transparent"/unparseable
// input so a caller can decide how to walk up the ancestor chain for an effective background color.
export function parseComputedRgb(value) {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value || "");
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (alpha === 0) return null; // fully transparent -- not an effective background
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}
