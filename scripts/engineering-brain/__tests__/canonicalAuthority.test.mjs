import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIndexRecords } from "../buildIndexRecords.mjs";
import { getRegistry } from "../canonicalDocumentRegistry.mjs";
import { registryCoverageIssues, registryFingerprint } from "../registryCoverage.mjs";
import { partitionFilesForIncrementalBuild } from "../incrementalReuse.mjs";
import { EXTRACTOR_VERSION } from "../extractorVersion.mjs";
import { computeFreshness } from "../query/computeFreshnessAndConfidence.mjs";

// The registry's authority field must control the emitted authority. These tests pin that down,
// and check that the existing FORGE_SYNC handling is preserved.

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const registry = getRegistry();
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const file = (rel, content = read(rel)) => ({ path: rel, blobSha: `sha-${rel}`, content });

const NORTH_STAR = "docs/product/FORGE_NORTH_STAR.md";
const PRODUCT_DECISIONS = "docs/product/FORGE_PRODUCT_DECISIONS.md";
const SYNC_STATUS = "docs/architecture/synchronized/FORGE_SYNC_STATUS.md";

// A copy of the registry with one entry's authority field changed, and nothing else.
function withAuthority(reg, targetPath, brainAuthority) {
  return reg.map((entry) => (entry.path === targetPath ? { ...entry, brain_authority: brainAuthority } : entry));
}

// Emitted authority per path, the way the indexer computes it for the coverage check.
function emittedByPath(records) {
  const map = new Map();
  for (const record of records) {
    if (!map.has(record.source_path)) map.set(record.source_path, new Set());
    map.get(record.source_path).add(record.authority_level);
  }
  return map;
}

describe("registry authority controls emitted authority", () => {
  it("a real reviewed-decision document emits reviewed_decision, not canonical_document", () => {
    const { records } = buildIndexRecords({ commitSha: "sha", files: [file(PRODUCT_DECISIONS)], registry });
    const decisions = records.filter((r) => r.source_path === PRODUCT_DECISIONS);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].source_type).toBe("canonical_document_file");
    expect(decisions[0].authority_level).toBe("reviewed_decision");
    expect(computeFreshness(decisions[0])).toBe("review");
  });

  it("a canonical product document emits canonical_document, as its registry entry names", () => {
    const { records } = buildIndexRecords({ commitSha: "sha", files: [file(NORTH_STAR)], registry });
    expect(records.find((r) => r.source_path === NORTH_STAR).authority_level).toBe("canonical_document");
  });

  it("an authority-only registry change changes the emitted authority of that document", () => {
    const changed = withAuthority(registry, NORTH_STAR, "reviewed_decision");
    const { records } = buildIndexRecords({ commitSha: "sha", files: [file(NORTH_STAR)], registry: changed });
    expect(records.find((r) => r.source_path === NORTH_STAR).authority_level).toBe("reviewed_decision");
  });

  it("an authority-only registry change changes the fingerprint, so cached records are not reused", () => {
    const changed = withAuthority(registry, NORTH_STAR, "reviewed_decision");
    expect(registryFingerprint(changed)).not.toBe(registryFingerprint(registry));
    const trackedFiles = [{ path: NORTH_STAR, blobSha: "sha-north" }];
    const previous = {
      extractor_version: EXTRACTOR_VERSION,
      registry_hash: registryFingerprint(registry),
      file_blob_shas: { [NORTH_STAR]: "sha-north" },
      records: [{ source_path: NORTH_STAR, authority_level: "canonical_document" }],
    };
    const { toProcess, reusableRecordsByPath } = partitionFilesForIncrementalBuild(
      trackedFiles, previous, EXTRACTOR_VERSION, registryFingerprint(changed),
    );
    expect(toProcess).toHaveLength(1);
    expect(reusableRecordsByPath.size).toBe(0);
  });

  it("an unknown registry tier fails closed: nothing is emitted under a guessed authority", () => {
    const broken = withAuthority(registry, NORTH_STAR, "super_canonical");
    const { records, excluded } = buildIndexRecords({ commitSha: "sha", files: [file(NORTH_STAR)], registry: broken });
    expect(records.some((r) => r.source_path === NORTH_STAR)).toBe(false);
    expect(excluded).toContainEqual({ source_path: NORTH_STAR, reason: "registry_invalid_authority:super_canonical" });
  });
});

describe("FORGE_SYNC handling is preserved, and any disagreement is reported", () => {
  it("FORGE_SYNC sections still emit synchronized_document under the shipped registry", () => {
    const { records } = buildIndexRecords({ commitSha: "sha", files: [file(SYNC_STATUS)], registry });
    const sections = records.filter((r) => r.source_path === SYNC_STATUS);
    expect(sections.length).toBeGreaterThan(0);
    for (const record of sections) {
      expect(record.source_type).toBe("synchronized_document_section");
      expect(record.authority_level).toBe("synchronized_document");
    }
  });

  it("a registry edit that disagrees with the FORGE_SYNC classifier is reported as a coverage issue", () => {
    const disagreeing = withAuthority(registry, SYNC_STATUS, "reviewed_decision");
    const { records } = buildIndexRecords({ commitSha: "sha", files: [file(SYNC_STATUS)], registry: disagreeing });
    // The classifier keeps its existing special handling: the emitted tier does not follow the edit.
    expect([...new Set(records.filter((r) => r.source_path === SYNC_STATUS).map((r) => r.authority_level))])
      .toEqual(["synchronized_document"]);
    const issues = registryCoverageIssues({
      registry: disagreeing,
      trackedPaths: new Set([SYNC_STATUS]),
      indexedPaths: new Set(records.map((r) => r.source_path)),
      excludedReasons: new Map(),
      emittedAuthorityByPath: emittedByPath(records),
    });
    expect(issues).toContainEqual(expect.objectContaining({
      path: SYNC_STATUS,
      issue: "authority_mismatch:registry=reviewed_decision,emitted=synchronized_document",
    }));
  });

  it("a registry that agrees with the emitted tiers reports no mismatch", () => {
    const { records } = buildIndexRecords({
      commitSha: "sha",
      files: [file(NORTH_STAR), file(PRODUCT_DECISIONS), file(SYNC_STATUS)],
      registry,
    });
    const issues = registryCoverageIssues({
      registry,
      trackedPaths: new Set([NORTH_STAR, PRODUCT_DECISIONS, SYNC_STATUS]),
      indexedPaths: new Set(records.map((r) => r.source_path)),
      excludedReasons: new Map(),
      emittedAuthorityByPath: emittedByPath(records),
    });
    expect(issues.filter((i) => i.issue.startsWith("authority_mismatch"))).toEqual([]);
  });
});
