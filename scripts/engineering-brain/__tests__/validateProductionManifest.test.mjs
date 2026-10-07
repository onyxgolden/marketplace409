import { describe, expect, it } from "vitest";
import { validateProductionManifest } from "../validateProductionManifest.mjs";

const base = () => ({
  schema_version: 1,
  commit_sha: "abc123",
  records: [{ source_path: "a.md", authority_level: "canonical_document" }],
  coverage_issues: [],
  generated_at: "2026-01-01T00:00:00.000Z",
});

describe("validateProductionManifest", () => {
  it("passes when the committed artifact matches a fresh build of its OWN recorded commit, ignoring generated_at", () => {
    const committed = base();
    const fresh = { ...base(), generated_at: "2026-06-01T00:00:00.000Z" };
    expect(validateProductionManifest({ committedManifest: committed, freshManifest: fresh, isAncestor: true })).toEqual({ ok: true, problems: [] });
  });

  it("never claims commit_sha must equal the current HEAD -- only that a fresh build of its OWN commit matches, and that commit is an ancestor", () => {
    // freshManifest is always built at committedManifest.commit_sha by the caller (runValidation), so
    // the two commit_sha values are expected to be equal here; what this proves is that the function
    // itself never compares against a separate "current HEAD" value.
    const committed = base();
    const fresh = base();
    const result = validateProductionManifest({ committedManifest: committed, freshManifest: fresh, isAncestor: true });
    expect(result.ok).toBe(true);
  });

  it("fails when the committed commit is not an ancestor of HEAD", () => {
    const committed = base();
    const result = validateProductionManifest({ committedManifest: committed, freshManifest: base(), isAncestor: false });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/not an ancestor of the current HEAD/);
  });

  it("fails when a fresh build of the committed commit does not match the committed content", () => {
    const committed = base();
    const fresh = { ...base(), records: [{ source_path: "a.md", authority_level: "historical_snapshot" }] };
    const result = validateProductionManifest({ committedManifest: committed, freshManifest: fresh, isAncestor: true });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/does not accurately reproduce a fresh build of its own recorded commit/);
  });

  it("fails and lists every coverage issue found at the committed commit, including a present-but-unregistered declared reference", () => {
    const committed = base();
    const fresh = base();
    const coverageIssueRows = [
      { path: "x.md", classification: "canonical", issue: "registered_path_missing" },
      { path: "docs/governance/FORGE_IDEA_REGISTER.md", classification: null, issue: "declared_reference_present_but_unregistered" },
    ];
    const result = validateProductionManifest({ committedManifest: committed, freshManifest: fresh, isAncestor: true, coverageIssueRows });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "Coverage issue at the committed artifact's own commit (abc123): x.md -- registered_path_missing",
      "Coverage issue at the committed artifact's own commit (abc123): docs/governance/FORGE_IDEA_REGISTER.md -- declared_reference_present_but_unregistered",
    ]);
  });

  it("fails cleanly when there is no committed manifest to validate against", () => {
    const result = validateProductionManifest({ committedManifest: null, freshManifest: base(), isAncestor: true });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/missing/);
  });
});
