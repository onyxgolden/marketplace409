import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIndexRecords } from "../buildIndexRecords.mjs";
import { getRegistry, CLASSIFICATIONS } from "../canonicalDocumentRegistry.mjs";
import { registryCoverageIssues, registryFingerprint } from "../registryCoverage.mjs";
import { partitionFilesForIncrementalBuild } from "../incrementalReuse.mjs";
import { EXTRACTOR_VERSION } from "../extractorVersion.mjs";
import { runQuery } from "../query/runQuery.mjs";
import { rankResults } from "../query/rankResults.mjs";
import { computeFreshness } from "../query/computeFreshnessAndConfidence.mjs";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const registry = getRegistry();
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const file = (rel, content = read(rel)) => ({ path: rel, blobSha: `sha-${rel}`, content });

const NORTH_STAR = "docs/product/FORGE_NORTH_STAR.md";
const BOOTSTRAP = "docs/architecture/FORGE_EXECUTIVE_BOOTSTRAP.md";
const SYNC_STATUS = "docs/architecture/synchronized/FORGE_SYNC_STATUS.md";

// Retrieval runs through the real query path with fixture excerpts (no git checkout needed).
function queryAll(records, queryText) {
  const manifest = { commit_sha: "sha", records };
  const readFileAtCommit = (_sha, rel) => read(rel);
  return runQuery({
    manifest,
    queryText,
    excerptReader: { readFileAtCommit, readMigrationsAtCommit: () => [] },
    contentProvider: null,
  });
}

describe("Slice 2: registered documents feed the index", () => {
  it("a real canonical OS/product document produces a canonical record and is retrievable", () => {
    const { records } = buildIndexRecords({ commitSha: "sha", files: [file(NORTH_STAR)], registry });
    const canonical = records.filter((r) => r.source_path === NORTH_STAR);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].source_type).toBe("canonical_document_file");
    expect(canonical[0].authority_level).toBe("canonical_document");
    expect(canonical[0].details.families).toEqual(["vision_north_star"]);

    const response = queryAll(records, "FORGE North Star product vision");
    expect(response.insufficient_evidence).toBeFalsy();
    expect(response.results.map((r) => r.source_path)).toContain(NORTH_STAR);
  });

  it("canonical intent is labeled as intent, freshness review, never current implementation truth", () => {
    expect(computeFreshness({ authority_level: "canonical_document" })).toBe("review");
    const { records } = buildIndexRecords({ commitSha: "sha", files: [file(NORTH_STAR)], registry });
    expect(records[0].authority_level).not.toBe("current");
  });

  it("the Executive Bootstrap cannot outrank a conflicting canonical document in results", () => {
    const canonicalText = "Alpha billing policy: invoices close on the first business day.";
    const bootstrapText = "Alpha billing policy: invoices close on the last day of the month (older continuity note).";
    const { records } = buildIndexRecords({
      commitSha: "sha",
      files: [file(NORTH_STAR, canonicalText), file(BOOTSTRAP, bootstrapText)],
      registry,
    });
    const response = queryAll(records, "alpha billing policy invoices close");
    const order = response.results.map((r) => r.authority_level);
    expect(order).toContain("canonical_document");
    expect(order).toContain("historical_snapshot");
    expect(order.indexOf("canonical_document")).toBeLessThan(order.indexOf("historical_snapshot"));
  });

  it("the ranking comparator puts a canonical document above historical material on equal matches", () => {
    const canonical = { record: { authority_level: "canonical_document", source_path: "a", content_hash: "1" } };
    const historical = { record: { authority_level: "historical_snapshot", source_path: "b", content_hash: "2" } };
    const ranked = rankResults([historical, canonical]);
    expect(ranked[0].record.authority_level).toBe("canonical_document");
  });

  it("excluded registry entries never become indexed canonical knowledge", () => {
    const files = [file("ROADMAP.md"), file("docs/theory/FORGE_THEORY.md"), file("FORGE_CONSTITUTION.md")];
    const { records, excluded } = buildIndexRecords({ commitSha: "sha", files, registry });
    expect(records).toHaveLength(0);
    const reasons = Object.fromEntries(excluded.map((e) => [e.source_path, e.reason]));
    expect(reasons["ROADMAP.md"]).toMatch(/^registry_excluded:/);
    expect(reasons["docs/theory/FORGE_THEORY.md"]).toMatch(/^registry_excluded:/);
  });

  it("existing FORGE_SYNC documents still index as synchronized sections, not as canonical documents", () => {
    const { records } = buildIndexRecords({ commitSha: "sha", files: [file(SYNC_STATUS)], registry });
    const sections = records.filter((r) => r.source_path === SYNC_STATUS);
    expect(sections.length).toBeGreaterThan(0);
    for (const record of sections) {
      expect(record.source_type).toBe("synchronized_document_section");
      expect(record.authority_level).toBe("synchronized_document");
    }
  });

  it("secret/PII detection still excludes a newly covered canonical document (fail closed)", () => {
    // An SSN-shaped value that is not one of the scanner's known synthetic test values.
    const withPii = "Product vision. Owner record: SSN 482-17-3390 on file.";
    const { records, excluded } = buildIndexRecords({
      commitSha: "sha",
      files: [file(NORTH_STAR, withPii)],
      registry,
    });
    expect(records.some((r) => r.source_path === NORTH_STAR)).toBe(false);
    const hit = excluded.find((e) => e.source_path === NORTH_STAR);
    expect(hit?.reason).toMatch(/^likely_(pii|secret)/);
  });

  it("the same commit and the same registry produce identical records", () => {
    const files = [file(NORTH_STAR), file(BOOTSTRAP), file(SYNC_STATUS)];
    const first = buildIndexRecords({ commitSha: "sha", files, registry });
    const second = buildIndexRecords({ commitSha: "sha", files, registry });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("Slice 2: cache invalidation on registry change", () => {
  const trackedFiles = [{ path: NORTH_STAR, blobSha: "sha-north" }, { path: BOOTSTRAP, blobSha: "sha-boot" }];
  const previous = {
    extractor_version: EXTRACTOR_VERSION,
    registry_hash: "old-registry",
    file_blob_shas: { [NORTH_STAR]: "sha-north", [BOOTSTRAP]: "sha-boot" },
    records: [
      { source_path: NORTH_STAR, source_type: "canonical_document_file" },
      { source_path: BOOTSTRAP, source_type: "historical_document_file" },
    ],
  };

  it("a changed registry forces a full rebuild and reuses no stale record", () => {
    const { toProcess, reusableRecordsByPath } = partitionFilesForIncrementalBuild(
      trackedFiles, previous, EXTRACTOR_VERSION, "new-registry",
    );
    expect(toProcess.map((f) => f.path).sort()).toEqual([BOOTSTRAP, NORTH_STAR].sort());
    expect(reusableRecordsByPath.size).toBe(0);
  });

  it("an unchanged registry and unchanged blobs still reuse prior records", () => {
    const { toProcess, reusableRecordsByPath } = partitionFilesForIncrementalBuild(
      trackedFiles, { ...previous, registry_hash: "same" }, EXTRACTOR_VERSION, "same",
    );
    expect(toProcess).toHaveLength(0);
    expect(reusableRecordsByPath.has(NORTH_STAR)).toBe(true);
  });

  it("the registry fingerprint changes when a document's classification changes", () => {
    const changed = registry.map((e) => (e.path === NORTH_STAR ? { ...e, classification: CLASSIFICATIONS.EXCLUDED, brain_authority: null, reason: "test" } : e));
    expect(registryFingerprint(changed)).not.toBe(registryFingerprint(registry));
  });

  it("the extractor version is bumped for the classification change", () => {
    expect(EXTRACTOR_VERSION).toBe(4);
  });
});

describe("Slice 2: missing registered documents surface as explicit coverage issues", () => {
  it("a registered canonical path missing from the tracked repository is reported, not dropped", () => {
    const tracked = new Set(registry.map((e) => e.path).filter((p) => p !== NORTH_STAR));
    const issues = registryCoverageIssues({
      registry,
      trackedPaths: tracked,
      indexedPaths: new Set(),
      excludedReasons: new Map(),
    });
    expect(issues).toContainEqual(expect.objectContaining({ path: NORTH_STAR, issue: "registered_path_missing" }));
  });

  it("a registered canonical document excluded by content scanning is reported with its reason", () => {
    const issues = registryCoverageIssues({
      registry,
      trackedPaths: new Set([NORTH_STAR]),
      indexedPaths: new Set(),
      excludedReasons: new Map([[NORTH_STAR, "likely_pii:email"]]),
    });
    expect(issues).toContainEqual(expect.objectContaining({ path: NORTH_STAR, issue: "not_indexed:likely_pii:email" }));
  });

  it("an indexed registered document produces no coverage issue", () => {
    const issues = registryCoverageIssues({
      registry,
      trackedPaths: new Set([NORTH_STAR]),
      indexedPaths: new Set([NORTH_STAR]),
      excludedReasons: new Map(),
    });
    expect(issues.find((i) => i.path === NORTH_STAR)).toBeUndefined();
  });
});

describe("Slice 2: persistence accepts the new types without dropping them", () => {
  // The Supabase row mapping passes source_type and authority_level through unchanged, so the database
  // must not constrain their values. Checked against the migration itself, because the persistence
  // module cannot be loaded under vitest (its bug-catalog import is pre-existing; see the baseline).
  it("the engineering brain record columns carry no value check, so new source types and tiers persist", () => {
    const migration = read("supabase/migrations/20260830000000_create_engineering_brain_persistence.sql");
    const recordsTable = migration.slice(migration.indexOf("create table if not exists engineering_brain_records"));
    const block = recordsTable.slice(0, recordsTable.indexOf(");") + 2);
    expect(block).toMatch(/source_type text not null/);
    expect(block).toMatch(/authority_level text not null/);
    expect(block).not.toMatch(/check\s*\(\s*(source_type|authority_level)/i);
  });
});
