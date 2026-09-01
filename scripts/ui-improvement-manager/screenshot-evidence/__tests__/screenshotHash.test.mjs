import { describe, expect, it } from "vitest";
import { hashScreenshotBuffer } from "../screenshotHash.mjs";

describe("hashScreenshotBuffer", () => {
  it("produces a sha256:<hex> string", () => {
    const hash = hashScreenshotBuffer(Buffer.from("fake-png-bytes"));
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic: the same bytes always hash the same way", () => {
    const buffer = Buffer.from([1, 2, 3, 4, 5]);
    expect(hashScreenshotBuffer(buffer)).toBe(hashScreenshotBuffer(Buffer.from([1, 2, 3, 4, 5])));
  });

  it("produces a different hash for different bytes", () => {
    expect(hashScreenshotBuffer(Buffer.from("a"))).not.toBe(hashScreenshotBuffer(Buffer.from("b")));
  });

  it("throws on non-Buffer input rather than silently coercing it", () => {
    expect(() => hashScreenshotBuffer("not a buffer")).toThrow(TypeError);
    expect(() => hashScreenshotBuffer(null)).toThrow(TypeError);
  });
});
