import { describe, expect, it } from "vitest";
import { renderQueryOutputJson, renderQueryOutputText } from "../renderQueryOutput.mjs";

const sampleResponse = {
  query: "foo",
  filters: {},
  manifest_commit_sha: "sha1",
  insufficient_evidence: false,
  results: [{
    source_path: "src/lib/foo.js", source_type: "application_source_symbol", symbol_or_section: "foo",
    commit_sha: "sha1", content_hash: "hash1", authority_level: "current", version: null,
    freshness: "current", confidence: "high", excerpt: "export function foo() {}", excerpt_truncated: false,
    excerpt_unavailable_reason: null, unresolved_conflict: null,
  }],
  conflicts: [],
};

describe("renderQueryOutput (JSON + sanitized human-readable output)", () => {
  it("JSON output round-trips to structurally valid JSON carrying every field", () => {
    const parsed = JSON.parse(renderQueryOutputJson(sampleResponse));
    expect(parsed.results[0].source_path).toBe("src/lib/foo.js");
    expect(parsed.results[0].authority_level).toBe("current");
  });

  it("human-readable output includes the key citation fields for every result", () => {
    const text = renderQueryOutputText(sampleResponse);
    expect(text).toContain("src/lib/foo.js");
    expect(text).toContain("authority=current");
    expect(text).toContain("commit=sha1");
    expect(text).toContain("content_hash=hash1");
  });

  it("human-readable output for insufficient evidence says so plainly rather than showing an empty results list", () => {
    const text = renderQueryOutputText({ query: "x", filters: {}, manifest_commit_sha: "sha1", insufficient_evidence: true, reason: "no match", results: [], conflicts: [] });
    expect(text).toContain("INSUFFICIENT EVIDENCE");
    expect(text).toContain("no match");
  });

  it("human-readable output flags an unresolved conflict on a result", () => {
    const withConflict = {
      ...sampleResponse,
      results: [{ ...sampleResponse.results[0], unresolved_conflict: { subject: "foo", outranked_by_or_outranks: "wins" } }],
    };
    expect(renderQueryOutputText(withConflict)).toContain("unresolved conflict");
  });

  it("does not render an excerpt when excerpt is null, and explains why instead", () => {
    const unavailable = { ...sampleResponse, results: [{ ...sampleResponse.results[0], excerpt: null, excerpt_unavailable_reason: "content_hash_mismatch" }] };
    const text = renderQueryOutputText(unavailable);
    expect(text).toContain("excerpt unavailable: content_hash_mismatch");
  });
});
