import { describe, expect, it } from "vitest";
import { canonicalPropertySlug, PROPERTY_ALIASES } from "./propertyAliases";

describe("canonicalPropertySlug", () => {
  it("resolves each known Rentec API variant slug to its legacy CSV canonical slug", () => {
    expect(canonicalPropertySlug("185-laxon-st")).toBe("185-laxon");
    expect(canonicalPropertySlug("1900-west-decker")).toBe("1900-w-decker");
    expect(canonicalPropertySlug("1932-west-decker")).toBe("1932-w-decker");
    expect(canonicalPropertySlug("4800-kent")).toBe("4800-kent-ave");
    expect(canonicalPropertySlug("605-south-dewitt")).toBe("605-dewitt");
  });

  it("is an identity for canonical and unknown slugs", () => {
    expect(canonicalPropertySlug("185-laxon")).toBe("185-laxon");
    expect(canonicalPropertySlug("335-butler")).toBe("335-butler");
    expect(canonicalPropertySlug("unassigned")).toBe("unassigned");
    expect(canonicalPropertySlug("business-expenses")).toBe("business-expenses");
  });

  it("passes falsy values through so callers can keep their || fallbacks", () => {
    expect(canonicalPropertySlug(null)).toBeNull();
    expect(canonicalPropertySlug(undefined)).toBeUndefined();
    expect(canonicalPropertySlug("")).toBe("");
  });

  it("keeps the alias map frozen and one-directional", () => {
    expect(Object.isFrozen(PROPERTY_ALIASES)).toBe(true);
    for (const [alias, canonical] of Object.entries(PROPERTY_ALIASES)) {
      expect(canonicalPropertySlug(canonical)).toBe(canonical);
      expect(alias).not.toBe(canonical);
    }
  });
});
