// FORGE Chart Builder — drawing-grid preference (slice 2).
// The grid toggle is a UI preference only: it lives in localStorage, never on
// the chart document. The storage parameter keeps this testable without a DOM
// (SSR and vitest pass a fake); the default is the browser localStorage when
// it exists.

export const GRID_PREFERENCE_KEY = "forge.charts.grid";

export const GRID_PREFERENCES = Object.freeze(["light", "dark", "off"]);

export const DEFAULT_GRID_PREFERENCE = "light";

function defaultStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function getGridPreference(storage) {
  const store = storage ?? defaultStorage();
  const value = store?.getItem?.(GRID_PREFERENCE_KEY);
  return GRID_PREFERENCES.includes(value) ? value : DEFAULT_GRID_PREFERENCE;
}

export function setGridPreference(value, storage) {
  if (!GRID_PREFERENCES.includes(value)) {
    throw new Error(`unknown grid preference "${value}"`);
  }
  const store = storage ?? defaultStorage();
  store?.setItem?.(GRID_PREFERENCE_KEY, value);
  return value;
}

export function gridLineColor(preference) {
  // Line colors are tuned per canvas ink so the grid stays subtle on both
  // light and dark slide backgrounds.
  switch (preference) {
    case "dark":
      return "rgba(255,255,255,0.14)";
    case "light":
      return "rgba(15,23,42,0.08)";
    default:
      return null;
  }
}
