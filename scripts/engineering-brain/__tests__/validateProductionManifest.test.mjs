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
  it("passes when the committed artifact matches a fresh build, ignoring generated_at", () => {
    const committed = base();
    const fresh = { ...base(), generated_at: "2026-06-01T00:00:00.000Z" };
    expect(validateProductionManifest({ committedManifest: committed, freshManifest: fresh })).toEqual({ ok: true, problems: [] });
  });

  it("fails when the committed commit_sha does not match the current head", () => {
    const committed = base();
    const fresh = { ...base(), commit_sha: "def456" };
    const result = validateProductionManifest({ committedManifest: committed, freshManifest: fresh });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/abc123.*def456|current head/);
  });

  it("fails when the records differ even at the same commit", () => {
    const committed = base();
    const fresh = { ...base(), records: [{ source_path: "a.md", authority_level: "historical_snapshot" }] };
    const result = validateProductionManifest({ committedManifest: committed, freshManifest: fresh });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/does not match a fresh build/);
  });

  it("fails and lists every coverage issue on the fresh build, even when the artifact matches", () => {
    const committed = base();
    const fresh = { ...base(), coverage_issues: [{ path: "x.md", issue: "registered_path_missing" }, { path: "y.md", issue: "authority_mismatch:a,b" }] };
    const result = validateProductionManifest({ committedManifest: committed, freshManifest: fresh });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "Coverage issue: x.md -- registered_path_missing",
      "Coverage issue: y.md -- authority_mismatch:a,b",
    ]);
  });

  it("fails cleanly when there is no committed manifest to validate against", () => {
    const result = validateProductionManifest({ committedManifest: null, freshManifest: base() });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/missing/);
  });
});
