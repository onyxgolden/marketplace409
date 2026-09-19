import { describe, expect, test } from "vitest";
import { isAmbiguousRowResolved } from "../isAmbiguousRowResolved.js";

// The ambiguous list must keep showing undecided rows ('other' = the
// CategoryNormalizer fallback) but stop resurfacing rows a human or a previous
// apply already classified -- otherwise one-sided external transfers (e.g. the
// Fidelity emergency-fund legs, whose counterpart can never be connected) linger
// in the panel forever after being resolved.
describe("isAmbiguousRowResolved", () => {
  test("undecided 'other' rows stay visible", () => {
    expect(isAmbiguousRowResolved("other")).toBe(false);
  });

  test("null/undefined categories stay visible", () => {
    expect(isAmbiguousRowResolved(null)).toBe(false);
    expect(isAmbiguousRowResolved(undefined)).toBe(false);
  });

  test("one-sided external transfers marked internal_transfer are resolved", () => {
    expect(isAmbiguousRowResolved("internal_transfer")).toBe(true);
  });

  test("already-applied distribution legs are resolved", () => {
    expect(isAmbiguousRowResolved("owner_distribution")).toBe(true);
  });

  test("real expense categories are resolved", () => {
    expect(isAmbiguousRowResolved("mortgage_payment")).toBe(true);
    expect(isAmbiguousRowResolved("rent")).toBe(true);
  });
});
