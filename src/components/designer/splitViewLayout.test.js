// splitViewLayout.test.js — the split-divider's persisted ratio.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  SPLIT_RATIO_STORAGE_KEY,
  clampSplitRatio,
  readSplitRatio,
  saveSplitRatio,
} from "./splitViewLayout";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  };
}

describe("clampSplitRatio", () => {
  it("passes values already in range through unchanged", () => {
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(MIN_SPLIT_RATIO)).toBe(MIN_SPLIT_RATIO);
    expect(clampSplitRatio(MAX_SPLIT_RATIO)).toBe(MAX_SPLIT_RATIO);
  });

  it("clamps out-of-range values to the nearest bound", () => {
    expect(clampSplitRatio(0)).toBe(MIN_SPLIT_RATIO);
    expect(clampSplitRatio(1)).toBe(MAX_SPLIT_RATIO);
    expect(clampSplitRatio(-5)).toBe(MIN_SPLIT_RATIO);
    expect(clampSplitRatio(50)).toBe(MAX_SPLIT_RATIO);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampSplitRatio(NaN)).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio(Infinity)).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio(undefined)).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio("nope")).toBe(DEFAULT_SPLIT_RATIO);
  });
});

describe("readSplitRatio / saveSplitRatio", () => {
  it("round-trips a saved ratio", () => {
    const storage = fakeStorage();
    saveSplitRatio(0.35, storage);
    expect(readSplitRatio(storage)).toBe(0.35);
  });

  it("uses a versioned key", () => {
    expect(SPLIT_RATIO_STORAGE_KEY).toMatch(/\.v1$/);
  });

  it("defaults when nothing is stored", () => {
    expect(readSplitRatio(fakeStorage())).toBe(DEFAULT_SPLIT_RATIO);
  });

  it("defaults on corrupt stored data instead of throwing", () => {
    expect(readSplitRatio(fakeStorage({ [SPLIT_RATIO_STORAGE_KEY]: "not-a-number" }))).toBe(
      DEFAULT_SPLIT_RATIO,
    );
  });

  it("clamps a stored value that is out of range (e.g. from a hand-edited value)", () => {
    expect(readSplitRatio(fakeStorage({ [SPLIT_RATIO_STORAGE_KEY]: "1.5" }))).toBe(MAX_SPLIT_RATIO);
    expect(readSplitRatio(fakeStorage({ [SPLIT_RATIO_STORAGE_KEY]: "-1" }))).toBe(MIN_SPLIT_RATIO);
  });

  it("saveSplitRatio clamps before writing", () => {
    const storage = fakeStorage();
    saveSplitRatio(0.99, storage);
    expect(storage._map.get(SPLIT_RATIO_STORAGE_KEY)).toBe(String(MAX_SPLIT_RATIO));
  });

  it("reports a write storage refuses, without throwing", () => {
    const refusing = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(saveSplitRatio(0.5, refusing)).toBe(false);
  });

  it("reports a read failure as the default, without throwing", () => {
    const refusing = { getItem: () => { throw new Error("SecurityError"); } };
    expect(readSplitRatio(refusing)).toBe(DEFAULT_SPLIT_RATIO);
  });

  it("works with no storage at all (SSR)", () => {
    expect(readSplitRatio(null)).toBe(DEFAULT_SPLIT_RATIO);
    expect(saveSplitRatio(0.5, null)).toBe(false);
  });
});
