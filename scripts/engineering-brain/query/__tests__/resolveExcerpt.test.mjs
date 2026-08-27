import { describe, expect, it } from "vitest";
import { resolveExcerpt } from "../resolveExcerpt.mjs";
import { hashContent } from "../../hashContent.mjs";

function readerFor(filesByPath, migrationsByCommit = {}) {
  return {
    readFileAtCommit: (commitSha, sourcePath) => filesByPath[sourcePath] ?? null,
    readMigrationsAtCommit: (commitSha) => migrationsByCommit[commitSha] || [],
  };
}

describe("resolveExcerpt (citation completeness + stale-source labeling)", () => {
  it("returns a verified excerpt for a whole-file record whose re-fetched content matches the stored hash", () => {
    const content = "export function foo() { return 1; }";
    const record = { source_path: "src/lib/foo.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha1", content_hash: hashContent(content) };
    const result = resolveExcerpt(record, readerFor({ "src/lib/foo.js": content }));
    expect(result.verified).toBe(true);
    expect(result.excerpt).toBe(content);
  });

  it("re-derives a symbol-level excerpt by re-running the same extractor Phase 1 used, not by storing content redundantly", () => {
    const content = "export function foo() { return 1; }\nexport const BAR = 2;";
    const record = { source_path: "src/lib/foo.js", source_type: "application_source_symbol", symbol_or_section: "BAR", commit_sha: "sha1", content_hash: hashContent("export const BAR = 2;") };
    const result = resolveExcerpt(record, readerFor({ "src/lib/foo.js": content }));
    expect(result.verified).toBe(true);
    expect(result.excerpt).toBe("export const BAR = 2;");
  });

  it("re-derives a SQL object's current-effective definition by re-running extractSqlObjects against the full migration set", () => {
    const migrations = [{ path: "0001.sql", content: `create table if not exists widgets (id text primary key);` }];
    const definition = migrations[0].content;
    const record = { source_path: "0001.sql", source_type: "sql_table", symbol_or_section: "widgets", commit_sha: "sha1", content_hash: hashContent(definition) };
    const result = resolveExcerpt(record, readerFor({}, { sha1: migrations }));
    expect(result.verified).toBe(true);
    expect(result.excerpt).toContain("widgets");
  });

  it("stale-source labeling: a content_hash that no longer matches the re-fetched content fails closed rather than showing possibly-wrong content", () => {
    const record = { source_path: "src/lib/foo.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha1", content_hash: "a-hash-that-will-never-match" };
    const result = resolveExcerpt(record, readerFor({ "src/lib/foo.js": "export function foo() {}" }));
    expect(result.verified).toBe(false);
    expect(result.excerpt).toBeNull();
    expect(result.reason).toBe("content_hash_mismatch");
  });

  it("deleted-record exclusion: a source no longer available at the recorded commit is reported, not fabricated", () => {
    const record = { source_path: "src/lib/removed.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha1", content_hash: "whatever" };
    const result = resolveExcerpt(record, readerFor({}));
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("source_unavailable_at_commit");
  });

  it("ADVERSARIAL: an excerpt that would contain a live-looking secret is refused even if its hash verifies correctly", () => {
    const content = "const key = 'sk_live_0000000000000002';";
    const record = { source_path: "src/lib/config.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha1", content_hash: hashContent(content) };
    const result = resolveExcerpt(record, readerFor({ "src/lib/config.js": content }));
    expect(result.verified).toBe(false);
    expect(result.excerpt).toBeNull();
    expect(result.reason).toBe("excerpt_would_expose_sensitive_content");
  });

  it("ADVERSARIAL: an excerpt that would contain PII is refused even if its hash verifies correctly", () => {
    const content = "// real customer ssn: 217-63-9048";
    const record = { source_path: "src/lib/note.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha1", content_hash: hashContent(content) };
    const result = resolveExcerpt(record, readerFor({ "src/lib/note.js": content }));
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("excerpt_would_expose_sensitive_content");
  });

  it("very long excerpts are truncated with a marker rather than dumping unbounded content", () => {
    const content = "x".repeat(5000);
    const record = { source_path: "src/lib/big.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha1", content_hash: hashContent(content) };
    const result = resolveExcerpt(record, readerFor({ "src/lib/big.js": content }));
    expect(result.verified).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.excerpt.length).toBeLessThan(5000);
    expect(result.excerpt).toContain("truncated");
  });
});
