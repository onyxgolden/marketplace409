/**
 * Split-view layout: the divider ratio between the 2D and 3D panes.
 *
 * Follows the Designer's established local-persistence pattern (ToolPalette's
 * collapsed-category/favorite-tool keys, the custom-shape library): a
 * versioned localStorage key, a defensive read where any corrupt or
 * out-of-range value degrades to the default rather than throwing, and a
 * write that swallows quota/private-mode failures.
 */

export const SPLIT_RATIO_STORAGE_KEY = "forge-designer.split-ratio.v1";

/** Default 2D-pane share of the split width. */
export const DEFAULT_SPLIT_RATIO = 0.5;

/** The divider is never dragged fully to an edge — each pane keeps a usable minimum. */
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;

/** Clamp to the usable range; anything non-finite falls back to the default. */
export function clampSplitRatio(ratio) {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

/** Read the stored ratio; any missing/corrupt/out-of-range value yields the default. */
export function readSplitRatio(storage = defaultStorage()) {
  if (!storage) return DEFAULT_SPLIT_RATIO;
  try {
    const raw = storage.getItem(SPLIT_RATIO_STORAGE_KEY);
    if (raw === null) return DEFAULT_SPLIT_RATIO;
    const parsed = Number(raw);
    return clampSplitRatio(parsed);
  } catch {
    return DEFAULT_SPLIT_RATIO;
  }
}

/** Persist the ratio; returns false (never throws) when storage refuses the write. */
export function saveSplitRatio(ratio, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(SPLIT_RATIO_STORAGE_KEY, String(clampSplitRatio(ratio)));
    return true;
  } catch {
    return false;
  }
}

function defaultStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
