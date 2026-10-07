// Canonical Knowledge Slice 4: scanAndPropose's optional coverageModel param.
// Isolated from the filesystem: docs: [] and files: [] skip the real doc scan, so only the
// canonical-coverage merge path is under test.

import { describe, expect, it } from "vitest";
import { scanAndPropose } from "../runDocDriftCli.mjs";

const repoRoot = process.cwd();

describe("scanAndPropose: canonical coverage integration", () => {
  it("adds no findings when the coverage model is clean", () => {
    const report = scanAndPropose({ repoRoot, files: [], coverageModel: { issueRows: [] } });
    expect(report).toEqual([]);
  });

  it("adds no findings when no coverage model is given at all (current behavior unchanged)", () => {
    const report = scanAndPropose({ repoRoot, files: [] });
    expect(report).toEqual([]);
  });

  it("surfaces a real coverage issue, marked non-proposable with no patch", () => {
    const model = { issueRows: [{ path: "docs/product/FORGE_GONE.md", classification: "canonical", issue: "registered_path_missing" }] };
    const report = scanAndPropose({ repoRoot, files: [], coverageModel: model });
    expect(report).toHaveLength(1);
    const [entry] = report;
    expect(entry.finding).toEqual({ driftClass: "canonical_coverage", docPath: "docs/product/FORGE_GONE.md", line: 0, literal: "registered_path_missing" });
    expect(entry.proposable).toBe(false);
    expect(entry.patch).toBeNull();
    expect(entry.explanation).toContain("registered_path_missing");
  });

  it("never proposes a patch for a coverage issue, so --apply can never auto-fix one", () => {
    const model = { issueRows: [{ path: "a.md", classification: "canonical", issue: "x" }, { path: "b.md", classification: "canonical", issue: "y" }] };
    const report = scanAndPropose({ repoRoot, files: [], coverageModel: model });
    expect(report.every((r) => r.proposable === false && r.patch === null)).toBe(true);
  });

  it("sorts coverage findings by path alongside ordinary drift findings", () => {
    const model = { issueRows: [{ path: "z.md", classification: "canonical", issue: "x" }, { path: "a.md", classification: "canonical", issue: "y" }] };
    const report = scanAndPropose({ repoRoot, files: [], coverageModel: model });
    expect(report.map((r) => r.finding.docPath)).toEqual(["a.md", "z.md"]);
  });
});
