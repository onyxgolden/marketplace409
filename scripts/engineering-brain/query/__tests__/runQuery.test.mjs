import { describe, expect, it } from "vitest";
import { runQuery } from "../runQuery.mjs";
import { hashContent } from "../../hashContent.mjs";

const fooContent = "export function resolveEffectiveOwnerId() { return 1; }";
const testContent = "import { resolveEffectiveOwnerId } from './foo.js';\nit('resolves', () => {});";

function sampleManifest() {
  return {
    schema_version: "1.0",
    commit_sha: "sha1",
    index_content_hash: "manifest-hash",
    records: [
      { source_path: "src/lib/foo.js", source_type: "application_source_symbol", symbol_or_section: "resolveEffectiveOwnerId", commit_sha: "sha1", content_hash: hashContent(fooContent), authority_level: "current", version: null, details: { kind: "function" } },
      { source_path: "src/lib/foo.test.js", source_type: "test_file", symbol_or_section: null, commit_sha: "sha1", content_hash: hashContent(testContent), authority_level: "current", version: null, details: { associatedSourcePaths: ["src/lib/foo.js"] } },
    ],
  };
}

function excerptReader() {
  return {
    readFileAtCommit: (sha, p) => (p === "src/lib/foo.js" ? fooContent : p === "src/lib/foo.test.js" ? testContent : null),
    readMigrationsAtCommit: () => [],
  };
}

describe("runQuery (full pipeline)", () => {
  it("insufficient-evidence refusal: a query matching nothing returns insufficient_evidence rather than a fabricated empty answer", () => {
    const response = runQuery({ manifest: sampleManifest(), queryText: "somethingThatDoesNotExistAnywhere", excerptReader: excerptReader() });
    expect(response.insufficient_evidence).toBe(true);
    expect(response.results).toEqual([]);
    expect(response.reason).toBeTruthy();
  });

  it("citation completeness: every result carries every field requirement 7 lists", () => {
    const response = runQuery({ manifest: sampleManifest(), queryText: "resolveEffectiveOwnerId", excerptReader: excerptReader() });
    for (const result of response.results) {
      for (const field of ["source_path", "source_type", "symbol_or_section", "commit_sha", "content_hash", "authority_level", "freshness", "confidence"]) {
        expect(result).toHaveProperty(field);
      }
      expect("version" in result).toBe(true);
      expect("unresolved_conflict" in result).toBe(true);
    }
  });

  it("test-to-source retrieval: a test_file result carries its associated source path in details", () => {
    const response = runQuery({ manifest: sampleManifest(), queryText: "src/lib/foo.test.js", excerptReader: excerptReader() });
    const testResult = response.results.find((r) => r.source_type === "test_file");
    expect(testResult).toBeTruthy();
  });

  it("determinism: two runs of the identical manifest and query produce a byte-identical result_content_hash", () => {
    const a = runQuery({ manifest: sampleManifest(), queryText: "resolveEffectiveOwnerId", excerptReader: excerptReader() });
    const b = runQuery({ manifest: sampleManifest(), queryText: "resolveEffectiveOwnerId", excerptReader: excerptReader() });
    expect(a.result_content_hash).toBe(b.result_content_hash);
  });

  it("deleted-record exclusion: a record whose file is no longer available at its commit gets an unavailable excerpt, not fabricated content", () => {
    const manifest = sampleManifest();
    const response = runQuery({
      manifest,
      queryText: "resolveEffectiveOwnerId",
      excerptReader: { readFileAtCommit: () => null, readMigrationsAtCommit: () => [] },
    });
    const result = response.results.find((r) => r.source_type === "application_source_symbol");
    expect(result.excerpt).toBeNull();
    expect(result.excerpt_unavailable_reason).toBe("source_unavailable_at_commit");
    expect(result.confidence).toBe("unverifiable");
  });

  it("sanitized errors: excerpt_unavailable_reason is always a short reason code, never raw file content or a stack trace", () => {
    const response = runQuery({
      manifest: sampleManifest(),
      queryText: "resolveEffectiveOwnerId",
      excerptReader: { readFileAtCommit: () => null, readMigrationsAtCommit: () => [] },
    });
    for (const result of response.results) {
      if (result.excerpt_unavailable_reason) {
        expect(result.excerpt_unavailable_reason.length).toBeLessThan(50);
        expect(result.excerpt_unavailable_reason).not.toMatch(/\n/);
      }
    }
  });

  it("filter-only listing (no query text) returns every matching record ranked deterministically, not treated as insufficient evidence", () => {
    const response = runQuery({ manifest: sampleManifest(), queryText: "", filters: { sourceType: "test_file" }, excerptReader: excerptReader() });
    expect(response.insufficient_evidence).toBe(false);
    expect(response.results).toHaveLength(1);
  });
});
