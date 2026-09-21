import { describe, expect, it } from "vitest";
import {
  GRID_PREFERENCE_KEY,
  GRID_PREFERENCES,
  DEFAULT_GRID_PREFERENCE,
  getGridPreference,
  setGridPreference,
  gridLineColor,
} from "./gridPreference.js";

function fakeStorage() {
  const data = {};
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("grid preference", () => {
  it("defaults to the light grid when nothing is stored", () => {
    expect(getGridPreference(fakeStorage())).toBe(DEFAULT_GRID_PREFERENCE);
    expect(DEFAULT_GRID_PREFERENCE).toBe("light");
  });

  it("round-trips light / dark / off through storage", () => {
    const store = fakeStorage();
    for (const pref of GRID_PREFERENCES) {
      expect(setGridPreference(pref, store)).toBe(pref);
      expect(getGridPreference(store)).toBe(pref);
      expect(store.getItem(GRID_PREFERENCE_KEY)).toBe(pref);
    }
  });

  it("falls back to the default for corrupted stored values", () => {
    const store = fakeStorage();
    store.setItem(GRID_PREFERENCE_KEY, "neon");
    expect(getGridPreference(store)).toBe(DEFAULT_GRID_PREFERENCE);
  });

  it("rejects unknown preference values", () => {
    expect(() => setGridPreference("neon", fakeStorage())).toThrow(
      /unknown grid preference/
    );
  });

  it("returns null line color when the grid is off", () => {
    expect(gridLineColor("light")).toMatch(/rgba\(15,23,42/);
    expect(gridLineColor("dark")).toMatch(/rgba\(255,255,255/);
    expect(gridLineColor("off")).toBe(null);
  });
});
