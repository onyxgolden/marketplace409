import { describe, expect, it } from "vitest";
import { canonicalCoverageDriftFindings } from "../canonicalCoverageDriftFindings.mjs";

describe("canonicalCoverageDriftFindings", () => {
  it("a clean coverage model (no issueRows) adds no drift noise", () => {
    expect(canonicalCoverageDriftFindings({ issueRows: [] })).toEqual([]);
    expect(canonicalCoverageDriftFindings({})).toEqual([]);
    expect(canonicalCoverageDriftFindings(null)).toEqual([]);
  });

  it("a real coverage issue becomes a finding carrying its path and reason", () => {
    const model = {
      issueRows: [
        { path: "docs/product/FORGE_GONE.md", classification: "canonical", issue: "registered_path_missing" },
      ],
    };
    expect(canonicalCoverageDriftFindings(model)).toEqual([
      { driftClass: "canonical_coverage", docPath: "docs/product/FORGE_GONE.md", line: 0, literal: "registered_path_missing" },
    ]);
  });

  it("is deterministic: the same model gives the same findings", () => {
    const model = { issueRows: [{ path: "a.md", classification: "canonical", issue: "x" }, { path: "b.md", classification: "canonical", issue: "y" }] };
    expect(canonicalCoverageDriftFindings(model)).toEqual(canonicalCoverageDriftFindings(model));
  });
});
