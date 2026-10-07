import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIndexRecords } from "../buildIndexRecords.mjs";
import { buildManifest } from "../buildManifest.mjs";
import { getRegistry, MISSING_REFERENCES } from "../canonicalDocumentRegistry.mjs";
import { buildCoverageModel, renderCanonicalCoverageReport } from "../canonicalCoverageReport.mjs";

import { runQuery } from "../query/runQuery.mjs";
import { renderQueryOutputText } from "../query/renderQueryOutput.mjs";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const registry = getRegistry();
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const file = (rel, content = read(rel)) => ({ path: rel, blobSha: `sha-${rel}`, content });

const NORTH_STAR = "docs/product/FORGE_NORTH_STAR.md";
const BOOTSTRAP = "docs/architecture/FORGE_EXECUTIVE_BOOTSTRAP.md";
const ROADMAP = "ROADMAP.md";
const PRODUCT_DECISIONS = "docs/product/FORGE_PRODUCT_DECISIONS.md";
const SYNC_STATUS = "docs/architecture/synchronized/FORGE_SYNC_STATUS.md";

// A manifest built the same way the indexer builds one, from the given files, with no coverage issues
// unless a test supplies them. Every test below is a pure function of these inputs.
function manifestFor(files, { coverageIssues = [], trackedFiles = files } = {}) {
  const { records, excluded, outOfScope } = buildIndexRecords({ commitSha: "sha-test", files, registry });
  return buildManifest({
    commitSha: "sha-test",
    generatedAt: "2026-01-01T00:00:00.000Z",
    trackedFiles: trackedFiles.map((f) => ({ path: f.path, blobSha: f.blobSha })),
    records,
    excluded,
    outOfScope,
    deletedPaths: [],
    extractorVersion: 4,
    registryHash: "reg-test",
    coverageIssues,
  });
}

function reportFor(manifest, { missingReferenceStatus = new Map(), reg = registry } = {}) {
  const model = buildCoverageModel({ registry: reg, manifest, missingReferenceStatus });
  return renderCanonicalCoverageReport(model);
}

const rowFor = (report, rel) => report.split("\n").find((line) => line.startsWith(`| \`${rel}\``)) ?? "";

describe("coverage report: contents", () => {
  const files = [file(NORTH_STAR), file(BOOTSTRAP), file(PRODUCT_DECISIONS), file(ROADMAP), file(SYNC_STATUS)];
  const manifest = manifestFor(files);

  it("a real canonical document shows its configured and emitted authority", () => {
    const row = rowFor(reportFor(manifest), NORTH_STAR);
    expect(row).toContain("| canonical | canonical_document | yes | canonical_document |");
  });

  it("the Executive Bootstrap is shown as historical_snapshot, not canonical", () => {
    const row = rowFor(reportFor(manifest), BOOTSTRAP);
    expect(row).toContain("| historical | historical_snapshot | yes | historical_snapshot |");
  });

  it("an excluded document stays visible with its reason", () => {
    const row = rowFor(reportFor(manifest), ROADMAP);
    expect(row).toContain("| excluded | - | no |");
    expect(row).toContain("registry: module_roadmap_pending_decision");
  });

  it("the declared-but-missing references are listed, and not treated as covered", () => {
    const report = reportFor(manifest, { missingReferenceStatus: new Map([["docs/governance/FORGE_IDEA_REGISTER.md", false]]) });
    for (const ref of MISSING_REFERENCES) {
      expect(report, ref).toContain(`\`${ref}\``);
    }
    expect(report).toContain("| `docs/governance/FORGE_IDEA_REGISTER.md` | no |");
  });

  it("the summary counts classification, authority, indexed state, and issue count", () => {
    const report = reportFor(manifest);
    expect(report).toMatch(/Registered documents: \*\*\d+\*\*\. Coverage issues: \*\*0\*\*/);
    expect(report).toContain("By classification:");
    expect(report).toContain("By configured authority:");
    expect(report).toContain("By indexed state:");
    expect(report).toContain("By emitted authority (indexed documents):");
  });

  it("explains each authority from the registry's rationale and evidence, and invents none", () => {
    const report = reportFor(manifest);
    const entry = registry.find((e) => e.path === PRODUCT_DECISIONS);
    expect(report).toContain(`Rationale: ${entry.rationale}`);
    expect(report).toContain(`Evidence: ${entry.evidence}`);
  });
});

describe("coverage report: issues are conspicuous and never converted into success", () => {
  it("a synthetic missing canonical path is shown as an issue and flagged at the top", () => {
    const manifest = manifestFor([file(NORTH_STAR)], {
      coverageIssues: [{ path: "docs/product/FORGE_GONE.md", classification: "canonical", issue: "registered_path_missing" }],
    });
    const report = reportFor(manifest);
    expect(report).toContain("> **COVERAGE ISSUES: 1.** Coverage is NOT clean.");
    expect(report).toContain("| `docs/product/FORGE_GONE.md` | canonical | registered_path_missing |");
    expect(report).not.toContain("Coverage issues: 0.");
  });

  it("an authority mismatch is shown as an issue", () => {
    const manifest = manifestFor([file(SYNC_STATUS)], {
      coverageIssues: [{
        path: SYNC_STATUS,
        classification: "canonical",
        issue: "authority_mismatch:registry=reviewed_decision,emitted=synchronized_document",
      }],
    });
    const report = reportFor(manifest);
    expect(report).toContain("COVERAGE ISSUES: 1");
    expect(report).toContain("authority_mismatch:registry=reviewed_decision,emitted=synchronized_document");
  });

  it("a clean run says so, and only then", () => {
    const report = reportFor(manifestFor([file(NORTH_STAR)]));
    expect(report).toContain("> Coverage issues: 0.");
    expect(report).not.toContain("COVERAGE ISSUES");
  });

  it("a declared reference that is present but unregistered is an issue, not a clean run", () => {
    const declared = "docs/governance/FORGE_IDEA_REGISTER.md";
    const model = buildCoverageModel({
      registry,
      manifest: manifestFor([file(NORTH_STAR)]),
      missingReferenceStatus: new Map([[declared, true]]),
      missingReferences: [declared],
    });
    expect(model.issueRows).toEqual([{ path: declared, classification: null, issue: "declared_reference_present_but_unregistered" }]);
    const report = renderCanonicalCoverageReport(model);
    expect(report).toContain("> **COVERAGE ISSUES: 1.** Coverage is NOT clean.");
    expect(report).toContain(`| \`${declared}\` | - | declared_reference_present_but_unregistered |`);
    expect(report).not.toContain("> Coverage issues: 0.");
  });

  it("a declared reference that is still absent stays informational and is not an issue", () => {
    const declared = "docs/governance/FORGE_IDEA_REGISTER.md";
    const model = buildCoverageModel({
      registry,
      manifest: manifestFor([file(NORTH_STAR)]),
      missingReferenceStatus: new Map([[declared, false]]),
      missingReferences: [declared],
    });
    expect(model.issueRows).toEqual([]);
    expect(renderCanonicalCoverageReport(model)).toContain("> Coverage issues: 0.");
  });
});

describe("coverage report: determinism", () => {
  it("the same inputs give byte-for-byte identical output", () => {
    const files = [file(NORTH_STAR), file(BOOTSTRAP), file(ROADMAP)];
    const first = reportFor(manifestFor(files), { missingReferenceStatus: new Map() });
    const second = reportFor(manifestFor(files), { missingReferenceStatus: new Map() });
    expect(first).toBe(second);
  });

  it("the order of the registry input does not change the output", () => {
    const manifest = manifestFor([file(NORTH_STAR), file(ROADMAP)]);
    expect(reportFor(manifest, { reg: [...registry].reverse() })).toBe(reportFor(manifest));
  });

  it("the report carries no timestamp, so it cannot drift by clock", () => {
    expect(reportFor(manifestFor([file(NORTH_STAR)]))).not.toMatch(/generated at|\d{4}-\d{2}-\d{2}T/i);
  });
});

describe("query citations and authority visibility", () => {
  const cannedFiles = [
    file(NORTH_STAR, "Alpha billing policy: invoices close on the first business day."),
    file(BOOTSTRAP, "Alpha billing policy: invoices close on the last day of the month (old continuity note)."),
  ];
  const manifest = manifestFor(cannedFiles);
  const excerptReader = {
    readFileAtCommit: (_sha, rel) => cannedFiles.find((f) => f.path === rel)?.content ?? null,
    readMigrationsAtCommit: () => [],
  };
  const query = (queryText) => runQuery({ manifest, queryText, excerptReader, contentProvider: null });

  it("a canonical result carries a citation that traces to the repository document", () => {
    const response = query("alpha billing policy invoices close");
    const canonical = response.results.find((r) => r.source_path === NORTH_STAR);
    expect(canonical.citation).toEqual({
      source_path: NORTH_STAR,
      symbol_or_section: null,
      commit_sha: "sha-test",
      content_hash: canonical.content_hash,
    });
    expect(canonical.authority_basis.classification).toBe("canonical");
    expect(canonical.authority_basis.configured_authority).toBe("canonical_document");
    expect(canonical.authority_rank).toBe(4);
  });

  it("a conflicting bootstrap result ranks below the canonical one and is labeled historical", () => {
    const response = query("alpha billing policy invoices close");
    const order = response.results.map((r) => r.source_path);
    expect(order.indexOf(NORTH_STAR)).toBeLessThan(order.indexOf(BOOTSTRAP));
    const bootstrap = response.results.find((r) => r.source_path === BOOTSTRAP);
    expect(bootstrap.historical).toBe(true);
    expect(bootstrap.authority_rank).toBe(6);
    const text = renderQueryOutputText(response);
    expect(text).toContain("HISTORICAL: continuity or bootstrap material, not current authority");
  });

  it("text output shows the basis for a canonical result", () => {
    const text = renderQueryOutputText(query("alpha billing policy invoices close"));
    expect(text).toContain("basis: canonical, configured canonical_document");
  });

  it("insufficient evidence still returns the explicit insufficient-evidence response", () => {
    const response = query("zzz-no-such-term-anywhere-qqq");
    expect(response.insufficient_evidence).toBe(true);
    expect(response.results).toEqual([]);
  });

  it("existing response fields are unchanged; new fields are additive", () => {
    const response = query("alpha billing policy invoices close");
    const result = response.results[0];
    for (const key of ["source_path", "source_type", "symbol_or_section", "commit_sha", "content_hash", "authority_level", "freshness", "confidence", "excerpt"]) {
      expect(result).toHaveProperty(key);
    }
  });

  it("FORGE_SYNC citations and authority do not regress", () => {
    const syncFiles = [file(SYNC_STATUS)];
    const syncManifest = manifestFor(syncFiles);
    const syncExcerpt = {
      readFileAtCommit: (_sha, rel) => read(rel),
      readMigrationsAtCommit: () => [],
    };
    const section = syncManifest.records.find((r) => r.source_type === "synchronized_document_section");
    const response = runQuery({
      manifest: syncManifest,
      queryText: section.symbol_or_section.replace(/[-_]/g, " "),
      excerptReader: syncExcerpt,
      contentProvider: null,
    });
    const hit = response.results.find((r) => r.source_path === SYNC_STATUS);
    expect(hit).toBeDefined();
    expect(hit.authority_level).toBe("synchronized_document");
    expect(hit.historical).toBe(false);
    expect(hit.citation.source_path).toBe(SYNC_STATUS);
  });
});
