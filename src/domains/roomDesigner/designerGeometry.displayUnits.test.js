/** @vitest-environment jsdom */
// designerGeometry.displayUnits.test.js — the measurement display-units
// preference (getDisplayUnits/setDisplayUnits) and feetInchesLabel's
// inches-only mode. Needs real localStorage, so it runs under jsdom, unlike
// designerGeometry.test.js's plain-node environment (which only ever
// exercises the default ft-in behavior, since `window` doesn't exist there).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DISPLAY_UNITS_STORAGE_KEY,
  feetInchesLabel,
  getDisplayUnits,
  parseDimensionInput,
  setDisplayUnits,
} from "./designerGeometry";

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe("getDisplayUnits / setDisplayUnits", () => {
  it("defaults to ft-in when nothing is stored", () => {
    expect(getDisplayUnits()).toBe("ft-in");
  });

  it("persists and reads back the inches preference", () => {
    setDisplayUnits("in");
    expect(getDisplayUnits()).toBe("in");
    expect(window.localStorage.getItem(DISPLAY_UNITS_STORAGE_KEY)).toBe("in");
  });

  it("restores the default when set back to ft-in", () => {
    setDisplayUnits("in");
    setDisplayUnits("ft-in");
    expect(getDisplayUnits()).toBe("ft-in");
  });

  it("treats any stored value other than exactly \"in\" as the default", () => {
    window.localStorage.setItem(DISPLAY_UNITS_STORAGE_KEY, "garbage");
    expect(getDisplayUnits()).toBe("ft-in");
  });

  it("normalizes an invalid argument to setDisplayUnits to ft-in rather than storing it verbatim", () => {
    setDisplayUnits("meters");
    expect(getDisplayUnits()).toBe("ft-in");
    expect(window.localStorage.getItem(DISPLAY_UNITS_STORAGE_KEY)).toBe("ft-in");
  });
});

describe("feetInchesLabel with the inches display preference", () => {
  it("formats as plain inches (ASCII double-quote) once the preference is set", () => {
    setDisplayUnits("in");
    expect(feetInchesLabel(144)).toBe('144"');
    expect(feetInchesLabel(150)).toBe('150"');
    expect(feetInchesLabel(7)).toBe('7"');
  });

  it("still returns the not-a-number placeholder regardless of preference", () => {
    setDisplayUnits("in");
    expect(feetInchesLabel(NaN)).toBe("—");
  });

  it("reverts to feet-and-inches once the preference is cleared", () => {
    setDisplayUnits("in");
    expect(feetInchesLabel(150)).toBe('150"');
    setDisplayUnits("ft-in");
    expect(feetInchesLabel(150)).toBe("12' 6\"");
  });

  // Regression: this formatter also seeds an editable field
  // (Viewport3DSizePopup's SizeField) that re-parses its own displayed text
  // via parseDimensionInput if the user edits and resubmits it. An earlier
  // version of this feature used the typographic "″" prime mark here, which
  // parseDimensionInput doesn't recognize as an inches suffix at all — that
  // value would round-trip to NaN instead of back to itself.
  it("round-trips through parseDimensionInput in both display modes", () => {
    setDisplayUnits("in");
    expect(parseDimensionInput(feetInchesLabel(150))).toBe(150);
    setDisplayUnits("ft-in");
    expect(parseDimensionInput(feetInchesLabel(150))).toBe(150);
  });
});
