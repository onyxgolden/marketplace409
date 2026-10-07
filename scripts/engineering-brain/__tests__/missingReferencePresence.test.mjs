import { describe, expect, it } from "vitest";
import { MISSING_REFERENCES } from "../canonicalDocumentRegistry.mjs";
import { missingReferenceStatusFromTrackedPaths } from "../missingReferencePresence.mjs";

describe("missingReferenceStatusFromTrackedPaths", () => {
  it("marks a declared reference present when it is in the tracked-path list", () => {
    const [first] = MISSING_REFERENCES;
    const status = missingReferenceStatusFromTrackedPaths([first, "unrelated/other.md"]);
    expect(status.get(first)).toBe(true);
  });

  it("marks every declared reference absent when the tracked-path list has none of them", () => {
    const status = missingReferenceStatusFromTrackedPaths(["unrelated/other.md"]);
    for (const rel of MISSING_REFERENCES) expect(status.get(rel)).toBe(false);
  });

  it("covers every declared reference, never silently omitting one", () => {
    const status = missingReferenceStatusFromTrackedPaths([]);
    expect([...status.keys()].sort()).toEqual([...MISSING_REFERENCES].sort());
  });

  it("accepts a Set as well as an array", () => {
    const [first] = MISSING_REFERENCES;
    expect(missingReferenceStatusFromTrackedPaths(new Set([first])).get(first)).toBe(true);
  });
});
