import { describe, expect, it } from "vitest";
import {
  PREFERENCE_DEFAULTS,
  clampIconPosition,
  clampPercent,
  validatePreference,
} from "../preferences.js";

describe("preference validation", () => {
  it("defaults to a 7-day decay window and a bottom-right collapsed icon", () => {
    expect(PREFERENCE_DEFAULTS.inferred_decay_days).toBe(7);
    expect(PREFERENCE_DEFAULTS.brain_icon_position).toEqual({ x: 92, y: 85, collapsed: true });
  });

  it("accepts decay windows from 1 to 90 and rejects the rest", () => {
    expect(validatePreference("inferred_decay_days", 1)).toBe(1);
    expect(validatePreference("inferred_decay_days", 90)).toBe(90);
    expect(() => validatePreference("inferred_decay_days", 0)).toThrow();
    expect(() => validatePreference("inferred_decay_days", 91)).toThrow();
    expect(() => validatePreference("inferred_decay_days", 7.5)).toThrow();
    expect(() => validatePreference("inferred_decay_days", "7")).toThrow();
  });

  it("accepts a well-formed icon position and clamps out-of-range percents", () => {
    expect(validatePreference("brain_icon_position", { x: 10, y: 20, collapsed: false })).toEqual({
      x: 10,
      y: 20,
      collapsed: false,
    });
    expect(clampIconPosition({ x: 150, y: -5, collapsed: true })).toEqual({
      x: 100,
      y: 0,
      collapsed: true,
    });
  });

  it("rejects malformed icon positions and unknown keys", () => {
    expect(() => validatePreference("brain_icon_position", { x: "left", y: 20, collapsed: true })).toThrow();
    expect(() => validatePreference("brain_icon_position", { x: 10, y: 20 })).toThrow();
    expect(() => validatePreference("brain_icon_position", null)).toThrow();
    expect(() => validatePreference("unknown_key", 1)).toThrow();
  });

  it("clamps percents and fills non-numbers with zero", () => {
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(101)).toBe(100);
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent("x")).toBe(0);
  });
});
