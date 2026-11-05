// FORGE Doc-to-Overview — slice A: bounded extraction tests.

import { describe, expect, it } from "vitest";
import { extractBounded, splitSections } from "./extraction.js";
import { sha256Hex } from "./sourceSets.js";

const PAGES = ["Page one: photosynthesis.", "Page two: chlorophyll.", "   "];

describe("extractBounded pages", () => {
  it("extracts exactly the allowed pages with checksums, skipping blanks", () => {
    const result = extractBounded({
      document: { id: "doc-1", text: PAGES.join("\n"), pages: PAGES },
      ranges: [{ type: "page", start: 1, end: 3 }],
    });
    expect(result.ok).toBe(true);
    expect(result.extracts).toHaveLength(2);
    expect(result.skippedBlank).toBe(1);
    expect(result.extracts[0]).toEqual({
      documentId: "doc-1",
      locator: { type: "page", page: 1 },
      text: "Page one: photosynthesis.",
      checksum: sha256Hex("Page one: photosynthesis."),
    });
    expect(result.extracts[1].locator).toEqual({ type: "page", page: 2 });
  });

  it("fails loud on pages that do not exist", () => {
    const result = extractBounded({
      document: { id: "doc-1", text: "x", pages: PAGES },
      ranges: [{ type: "page", start: 2, end: 5 }],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("OUT_OF_RANGE");
    expect(result.extracts).toEqual([]);
  });

  it("fails loud when page ranges are used without pages", () => {
    const result = extractBounded({
      document: { id: "doc-1", text: "x" },
      ranges: [{ type: "page", start: 1, end: 1 }],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_DOCUMENT");
  });
});

describe("extractBounded sections", () => {
  const text = "# Overview\nSunlight drives the process.\n## Methods\nMeasure oxygen output.\n## Results\nOutput doubled.";
  it("extracts a named section with its heading", () => {
    const result = extractBounded({
      document: { id: "doc-1", text },
      ranges: [{ type: "section", name: "Methods" }],
    });
    expect(result.ok).toBe(true);
    expect(result.extracts).toHaveLength(1);
    expect(result.extracts[0].locator).toEqual({ type: "section", name: "Methods" });
    expect(result.extracts[0].text).toContain("Measure oxygen output.");
  });

  it("fails loud on a missing section", () => {
    const result = extractBounded({
      document: { id: "doc-1", text },
      ranges: [{ type: "section", name: "Nope" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("OUT_OF_RANGE");
  });

  it("splits sections deterministically", () => {
    const sections = splitSections(text);
    expect([...sections.keys()]).toEqual(["Overview", "Methods", "Results"]);
    expect(sections.get("Overview")).toContain("Sunlight drives the process.");
  });
});

describe("extraction bounds and determinism", () => {
  it("is byte-for-byte deterministic", () => {
    const input = {
      document: { id: "doc-1", text: "## A\nAlpha.\n## B\nBeta.", pages: undefined },
      ranges: [{ type: "section", name: "A" }, { type: "section", name: "B" }],
    };
    expect(extractBounded(input)).toEqual(extractBounded(input));
  });

  it("refuses more extracts than the limit instead of silently clipping", () => {
    const pages = Array.from({ length: 201 }, (_, i) => `Page ${i + 1}.`);
    const result = extractBounded({
      document: { id: "doc-1", text: pages.join("\n"), pages },
      ranges: [{ type: "page", start: 1, end: 201 }],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BOUND_EXCEEDED");
  });

  it("refuses more characters than the limit", () => {
    const result = extractBounded({
      document: { id: "doc-1", text: "y".repeat(500001), pages: ["y".repeat(500001)] },
      ranges: [{ type: "page", start: 1, end: 1 }],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BOUND_EXCEEDED");
  });
});
