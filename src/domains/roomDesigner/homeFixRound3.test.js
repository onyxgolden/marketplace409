import { describe, it, expect } from "vitest";
import {
  createHomeLayerMask,
  resolveHomeLayers,
} from "./homeLayers";

// H0 fix round 3 — H679-003B: the mask is built from the SAME captured
// primitive values that passed validation. Each accepted key is read
// exactly once, so a changing getter cannot make construction consume a
// different value than the one validated, and the frozen mask can hold
// no mutable alias. No Boolean-coercion of a second read anywhere.

function changingGetter(first, second, inherited) {
  let reads = 0;
  const holder = {};
  Object.defineProperty(holder, "electrical", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? first : second;
    },
  });
  const input = inherited ? Object.create(holder) : holder;
  return { input, reads: () => reads };
}

describe("H679-003B single-read capture", () => {
  it("own changing getter: mask holds the validated first read only", () => {
    const { input, reads } = changingGetter(false, "false", false);
    const mask = createHomeLayerMask(input);
    expect(reads()).toBe(1);
    expect(mask.electrical).toBe(false);
    expect(resolveHomeLayers(mask, { mode: "home" }).trades.electrical).toBe(
      false,
    );
    expect(Object.isFrozen(mask)).toBe(true);
  });

  it("inherited changing getter: mask holds the validated first read only", () => {
    const { input, reads } = changingGetter(false, "false", true);
    const mask = createHomeLayerMask(input);
    expect(reads()).toBe(1);
    expect(mask.electrical).toBe(false);
    expect(resolveHomeLayers(mask, { mode: "home" }).trades.electrical).toBe(
      false,
    );
  });

  it("inherited getter returning a mutable object second: no alias in the mask", () => {
    let reads = 0;
    const mutable = { enabled: true };
    const input = Object.create({
      get plumbing() {
        reads += 1;
        return reads === 1 ? false : mutable;
      },
    });
    const mask = createHomeLayerMask(input);
    expect(reads).toBe(1);
    expect(mask.plumbing).toBe(false);
    mutable.enabled = false;
    expect(mask.plumbing).toBe(false);
    expect(Object.isFrozen(mask)).toBe(true);
  });

  it("own getter returning a non-boolean first: still refused", () => {
    const holder = {};
    Object.defineProperty(holder, "hvac", {
      enumerable: true,
      get() {
        return "true";
      },
    });
    expect(() => createHomeLayerMask(holder)).toThrow();
  });

  it("legitimate inherited booleans are still consumed", () => {
    const mask = createHomeLayerMask(Object.create({ electrical: true }));
    expect(mask.electrical).toBe(true);
    expect(resolveHomeLayers(mask, { mode: "home" }).trades.electrical).toBe(
      true,
    );
  });

  it("inherited undefined still counts as absent (defaults apply)", () => {
    const mask = createHomeLayerMask(
      Object.create({ base: undefined, electrical: undefined }),
    );
    expect(mask.base).toBe(true);
    expect(mask.electrical).toBe(false);
  });

  it("unknown own keys are still rejected", () => {
    expect(() => createHomeLayerMask({ bogus: true })).toThrow();
  });

  it("null-prototype positives still work", () => {
    const input = Object.create(null);
    input.base = false;
    input.plumbing = true;
    const mask = createHomeLayerMask(input);
    expect(mask.base).toBe(false);
    expect(mask.plumbing).toBe(true);
  });

  it("mask is detached from later input mutation", () => {
    const input = { electrical: true };
    const mask = createHomeLayerMask(input);
    input.electrical = false;
    expect(mask.electrical).toBe(true);
    expect(Object.isFrozen(mask)).toBe(true);
  });

  it("static invalid values are still refused (003A preserved)", () => {
    expect(() =>
      createHomeLayerMask(Object.create({ electrical: "false" })),
    ).toThrow();
    expect(() => createHomeLayerMask({ plumbing: null })).toThrow();
    expect(() => createHomeLayerMask({ hvac: {} })).toThrow();
  });
});
