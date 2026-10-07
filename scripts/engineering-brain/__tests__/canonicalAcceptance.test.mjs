// Canonical Knowledge Slice 4 — incremental-reuse correctness, and secret/PII absence across
// surfaces. Drives the real production functions (partitionFilesForIncrementalBuild,
// buildIndexRecords, buildManifest, registryCoverageIssues, validateRegistry) directly on synthetic
// file content, the same way runEngineeringBrainIndexer.mjs composes them -- just without git I/O,
// so these run in milliseconds and stay focused on one invalidation reason at a time.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { partitionFilesForIncrementalBuild } from "../incrementalReuse.mjs";
import { buildIndexRecords } from "../buildIndexRecords.mjs";
import { buildManifest } from "../buildManifest.mjs";
import { registryCoverageIssues, registryFingerprint } from "../registryCoverage.mjs";
import { getRegistry, validateRegistry, CLASSIFICATIONS } from "../canonicalDocumentRegistry.mjs";
import { EXTRACTOR_VERSION } from "../extractorVersion.mjs";
import { hashContent } from "../hashContent.mjs";
import { buildCoverageModel, renderCanonicalCoverageReport } from "../canonicalCoverageReport.mjs";
import { runQuery } from "../query/runQuery.mjs";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const NORTH_STAR = "docs/product/FORGE_NORTH_STAR.md";
const registry = getRegistry();

function file(p, content, blobSha = hashContent(content)) {
  return { path: p, blobSha, content };
}

// Mirrors runEngineeringBrainIndexer.mjs's own composition of these functions, minus git I/O.
function indexAll({ files, registry: reg, commitSha, generatedAt }) {
  const { records, excluded, outOfScope } = buildIndexRecords({ commitSha, files, registry: reg });
  return finish({ files, reg, commitSha, generatedAt, records, excluded, outOfScope, registryHash: registryFingerprint(reg) });
}

function indexIncremental({ files, registry: reg, previousManifest, commitSha, generatedAt }) {
  const registryHash = registryFingerprint(reg);
  const { toProcess, reusableRecordsByPath } = partitionFilesForIncrementalBuild(files, previousManifest, EXTRACTOR_VERSION, registryHash);
  const { records: freshRecords, excluded, outOfScope } = buildIndexRecords({ commitSha, files: toProcess, registry: reg });
  const reusedRecords = [];
  for (const recs of reusableRecordsByPath.values()) for (const r of recs) reusedRecords.push({ ...r, commit_sha: commitSha });
  return finish({ files, reg, commitSha, generatedAt, records: [...freshRecords, ...reusedRecords], excluded, outOfScope, registryHash });
}

function finish({ files, reg, commitSha, generatedAt, records, excluded, outOfScope, registryHash }) {
  const indexedPaths = new Set(records.map((r) => r.source_path));
  const excludedReasons = new Map(excluded.map((e) => [e.source_path, e.reason]));
  const emittedAuthorityByPath = new Map();
  for (const r of records) {
    if (!emittedAuthorityByPath.has(r.source_path)) emittedAuthorityByPath.set(r.source_path, new Set());
    emittedAuthorityByPath.get(r.source_path).add(r.authority_level);
  }
  const coverageIssues = [
    ...registryCoverageIssues({ registry: reg, trackedPaths: new Set(files.map((f) => f.path)), indexedPaths, excludedReasons, emittedAuthorityByPath }),
    ...validateRegistry(reg).map((issue) => ({ path: "(registry)", classification: null, issue })),
  ];
  return buildManifest({
    commitSha, generatedAt,
    trackedFiles: files.map((f) => ({ path: f.path, blobSha: f.blobSha })),
    records, excluded, outOfScope, deletedPaths: [],
    extractorVersion: EXTRACTOR_VERSION, registryHash, coverageIssues,
  });
}

const withoutGeneratedAt = (m) => { const c = { ...m }; delete c.generated_at; return c; };

describe("incremental reuse: the unchanged, common case converges with a full build", () => {
  it("rebuilding from an up-to-date manifest with nothing changed gives the same manifest", () => {
    const files = [file(NORTH_STAR, read(NORTH_STAR))];
    const full = indexAll({ files, registry, commitSha: "sha1", generatedAt: "t1" });
    const incremental = indexIncremental({ files, registry, previousManifest: full, commitSha: "sha1", generatedAt: "t2" });
    expect(withoutGeneratedAt(incremental)).toEqual(withoutGeneratedAt(full));
  });
});

describe("incremental reuse: a content change invalidates the stale record", () => {
  it("new content is reprocessed, not served from the stale cached record", () => {
    const v1 = indexAll({ files: [file(NORTH_STAR, "V1 content.")], registry, commitSha: "sha1", generatedAt: "t1" });
    const v2 = indexIncremental({
      files: [file(NORTH_STAR, "V2 content, materially different.")],
      registry, previousManifest: v1, commitSha: "sha2", generatedAt: "t2",
    });
    const recordV1 = v1.records.find((r) => r.source_path === NORTH_STAR);
    const recordV2 = v2.records.find((r) => r.source_path === NORTH_STAR);
    expect(recordV2.content_hash).not.toBe(recordV1.content_hash);
    expect(recordV2.content_hash).toBe(hashContent("V2 content, materially different."));
  });
});

describe("incremental reuse: an authority-only registry change invalidates stale reuse", () => {
  it("the new authority is emitted, not the stale one, even though the file content is unchanged", () => {
    const content = read(NORTH_STAR);
    const original = indexAll({ files: [file(NORTH_STAR, content)], registry, commitSha: "sha1", generatedAt: "t1" });
    const entry = registry.find((e) => e.path === NORTH_STAR);
    expect(entry.brain_authority).toBe("canonical_document");
    const changedRegistry = registry.map((e) => (e.path === NORTH_STAR ? { ...e, brain_authority: "reviewed_decision" } : e));
    const after = indexIncremental({
      files: [file(NORTH_STAR, content)], registry: changedRegistry, previousManifest: original, commitSha: "sha2", generatedAt: "t2",
    });
    const record = after.records.find((r) => r.source_path === NORTH_STAR);
    expect(record.authority_level).toBe("reviewed_decision");
  });
});

describe("incremental reuse: a canonical-to-excluded transition removes the stale record", () => {
  it("the record is gone, and it cannot leak into a query result", () => {
    const content = "Alpha billing policy: invoices close on the first business day.";
    const original = indexAll({ files: [file(NORTH_STAR, content)], registry, commitSha: "sha1", generatedAt: "t1" });
    expect(original.records.some((r) => r.source_path === NORTH_STAR)).toBe(true);

    const excludedRegistry = registry.map((e) =>
      e.path === NORTH_STAR ? { ...e, classification: CLASSIFICATIONS.EXCLUDED, reason: "test_exclusion_transition" } : e,
    );
    const after = indexIncremental({
      files: [file(NORTH_STAR, content)], registry: excludedRegistry, previousManifest: original, commitSha: "sha2", generatedAt: "t2",
    });
    expect(after.records.some((r) => r.source_path === NORTH_STAR)).toBe(false);

    const excerptReader = { readFileAtCommit: () => content, readMigrationsAtCommit: () => [] };
    const response = runQuery({ manifest: after, queryText: "alpha billing policy invoices close", excerptReader, contentProvider: null });
    expect(response.results.some((r) => r.source_path === NORTH_STAR)).toBe(false);
  });
});

describe("incremental reuse: an unreadable registered path fails closed even when reprocessed", () => {
  it("is excluded with a reason, and shown as an issue, never silently covered", () => {
    const original = indexAll({ files: [file(NORTH_STAR, read(NORTH_STAR))], registry, commitSha: "sha1", generatedAt: "t1" });
    const after = indexIncremental({
      files: [file(NORTH_STAR, null, "forced-reprocess-blob-sha")],
      registry, previousManifest: original, commitSha: "sha2", generatedAt: "t2",
    });
    expect(after.records.some((r) => r.source_path === NORTH_STAR)).toBe(false);
    const issue = after.coverage_issues.find((i) => i.path === NORTH_STAR);
    expect(issue?.issue).toBe("not_indexed:binary_or_unreadable");
  });
});

describe("secret/PII content never reaches any output surface", () => {
  it("is absent from records, the coverage report, and query results, even though the path is registered canonical", () => {
    // Built from parts, not a literal, so these bytes never form a string GitHub's own
    // push-protection secret scanner flags as a real Stripe key.
    const secretLooking = `const key = "${["sk", "live", "abcdefghijklmnopqrstuvwx1234567890ABCD"].join("_")}";`;
    const manifest = indexAll({ files: [file(NORTH_STAR, secretLooking)], registry, commitSha: "sha1", generatedAt: "t1" });

    expect(manifest.records.some((r) => r.source_path === NORTH_STAR)).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain("sk_live_");

    const coverageModel = buildCoverageModel({ registry, manifest, missingReferenceStatus: new Map() });
    const report = renderCanonicalCoverageReport(coverageModel);
    expect(report).not.toContain("sk_live_");
    expect(report).toMatch(new RegExp("`" + NORTH_STAR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "`[^\\n]*\\| no \\|"));

    const excerptReader = { readFileAtCommit: () => secretLooking, readMigrationsAtCommit: () => [] };
    const response = runQuery({ manifest, queryText: "sk_live key secret", excerptReader, contentProvider: null });
    expect(response.results.some((r) => r.source_path === NORTH_STAR)).toBe(false);
  });
});
