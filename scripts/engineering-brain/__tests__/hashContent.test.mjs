import { describe, expect, it } from "vitest";
import { hashContent } from "../hashContent.mjs";

describe("hashContent (stable hashes)", () => {
  it("produces the same hash for identical content across repeated calls", () => {
    const content = "export function foo() { return 1; }";
    expect(hashContent(content)).toBe(hashContent(content));
  });

  it("produces different hashes for different content", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });

  it("is sensitive to whitespace -- not a loose/normalized hash", () => {
    expect(hashContent("a")).not.toBe(hashContent("a "));
  });
});
