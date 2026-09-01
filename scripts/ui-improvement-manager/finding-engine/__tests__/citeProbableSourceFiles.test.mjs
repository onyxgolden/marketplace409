import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { citeProbableSourceFiles, loadEngineeringBrainManifest } from "../citeProbableSourceFiles.mjs";

function fixtureManifest(records) {
  return { schema_version: "1.0", commit_sha: "abc123def456abc123def456abc123def456abc1", index_content_hash: "hash", records };
}

function record(overrides = {}) {
  return {
    source_path: "src/components/forge/financial/FinancialAccountBalancesPanel.jsx",
    source_type: "application_source_file", symbol_or_section: "FinancialAccountBalancesPanel",
    commit_sha: "abc123def456abc123def456abc123def456abc1", content_hash: "h1", authority_level: "current", version: null,
    ...overrides,
  };
}

describe("citeProbableSourceFiles", () => {
  it("returns real, ranked citations with source path, authority level, and commit for a real match", () => {
    const manifest = fixtureManifest([record()]);
    const citations = citeProbableSourceFiles({ manifest, queryText: "forge financial FinancialAccountBalancesPanel" });
    expect(citations).toHaveLength(1);
    expect(citations[0]).toContain("src/components/forge/financial/FinancialAccountBalancesPanel.jsx");
    expect(citations[0]).toContain("authority: current");
    expect(citations[0]).toContain("abc123def456");
  });

  it("reuses the Engineering Brain's own authority ranking -- a higher-authority record is cited first", () => {
    const manifest = fixtureManifest([
      record({ source_path: "docs/stale-note.md", source_type: "historical_snapshot", authority_level: "historical_snapshot", symbol_or_section: "forge financial note" }),
      record({ source_path: "src/components/forge/financial/FinancialAccountBalancesPanel.jsx", authority_level: "current", symbol_or_section: "forge financial live" }),
    ]);
    const citations = citeProbableSourceFiles({ manifest, queryText: "forge financial" });
    expect(citations[0]).toContain("FinancialAccountBalancesPanel.jsx");
    expect(citations[0]).toContain("authority: current");
  });

  it("returns no citations (never a guess) when nothing in the index matches -- reuses the Engineering Brain's own insufficient_evidence signal", () => {
    const manifest = fixtureManifest([record()]);
    expect(citeProbableSourceFiles({ manifest, queryText: "completely unrelated nonexistent xyzzy plugh" })).toEqual([]);
  });

  it("returns no citations when no manifest is available, rather than throwing", () => {
    expect(citeProbableSourceFiles({ manifest: null, queryText: "forge financial" })).toEqual([]);
  });

  it("returns no citations for empty query text", () => {
    const manifest = fixtureManifest([record()]);
    expect(citeProbableSourceFiles({ manifest, queryText: "" })).toEqual([]);
  });

  it("respects maxResults", () => {
    const manifest = fixtureManifest([
      record({ source_path: "a/financial.jsx", symbol_or_section: "financial" }),
      record({ source_path: "b/financial.jsx", symbol_or_section: "financial" }),
      record({ source_path: "c/financial.jsx", symbol_or_section: "financial" }),
      record({ source_path: "d/financial.jsx", symbol_or_section: "financial" }),
    ]);
    expect(citeProbableSourceFiles({ manifest, queryText: "financial", maxResults: 2 })).toHaveLength(2);
  });
});

describe("loadEngineeringBrainManifest", () => {
  let tempDir;
  afterEach(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); tempDir = undefined; });
  beforeEach(() => { tempDir = mkdtempSync(path.join(tmpdir(), "fb-ui-2-eb-manifest-")); });

  it("returns null (not a throw) when no manifest file exists at the given path -- enrichment is skipped, not fatal", () => {
    expect(loadEngineeringBrainManifest(path.join(tempDir, "does-not-exist.json"))).toBeNull();
  });

  it("returns null for a malformed manifest rather than throwing", () => {
    const manifestPath = path.join(tempDir, "index-manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ not: "a valid manifest shape" }));
    expect(loadEngineeringBrainManifest(manifestPath)).toBeNull();
  });

  it("loads a well-formed manifest successfully", () => {
    const manifestPath = path.join(tempDir, "index-manifest.json");
    writeFileSync(manifestPath, JSON.stringify(fixtureManifest([record()])));
    const manifest = loadEngineeringBrainManifest(manifestPath);
    expect(manifest.records).toHaveLength(1);
  });
});
