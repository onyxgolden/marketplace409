import { describe, expect, it } from "vitest";
import { canonicalPropertySlug, PROPERTY_ALIASES, propertySlugsResolvingTo } from "./propertyAliases";

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

describe("propertySlugsResolvingTo", () => {
  it("returns the canonical slug plus every alias key resolving to it", () => {
    expect(propertySlugsResolvingTo("1900-w-decker")).toEqual(["1900-w-decker", "1900-west-decker"]);
    expect(propertySlugsResolvingTo("185-laxon")).toEqual(["185-laxon", "185-laxon-st"]);
    expect(propertySlugsResolvingTo("4800-kent-ave")).toEqual(["4800-kent-ave", "4800-kent"]);
  });

  it("resolves from the alias side too: querying by a variant finds the canonical form", () => {
    expect(new Set(propertySlugsResolvingTo("1900-west-decker"))).toEqual(
      new Set(["1900-west-decker", "1900-w-decker"]),
    );
  });

  it("is a singleton for slugs with no aliases, and empty for falsy input", () => {
    expect(propertySlugsResolvingTo("335-butler")).toEqual(["335-butler"]);
    expect(propertySlugsResolvingTo(null)).toEqual([]);
    expect(propertySlugsResolvingTo(undefined)).toEqual([]);
    expect(propertySlugsResolvingTo("")).toEqual([]);
  });

  it("never mixes houses: each canonical slug's set stays disjoint from other houses", () => {
    const decker = new Set(propertySlugsResolvingTo("1900-w-decker"));
    expect(decker.has("185-laxon")).toBe(false);
    expect(decker.has("185-laxon-st")).toBe(false);
    expect(decker.has("4800-kent")).toBe(false);
    // Every returned slug canonicalizes back to the requested property.
    for (const slug of decker) {
      expect(canonicalPropertySlug(slug)).toBe("1900-w-decker");
    }
  });
});
