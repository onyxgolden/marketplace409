import { describe, expect, it } from "vitest";
import { assembleDiagnosticContext, derivePairedTestPaths } from "../assembleDiagnosticContext.mjs";
import { hashContent } from "../../hashContent.mjs";

const codeContent = "export function calculateLateFee(balance) { return balance * 0.05; }";
const testContent = "import { calculateLateFee } from './billing.js';\nit('computes 5%', () => {});";
const unpairedTestContent = "it('unrelated', () => {});";
const docContent = "# Billing\nLate fees are 5% of the outstanding balance, computed by calculateLateFee.";
const decisionContent = "# Decision 12\nWe chose a flat 5% late fee for calculateLateFee after reviewing competitor pricing.";
const staleDocContent = "# Billing (old)\nLate fees are 10% of the outstanding balance.";

function record(path, type, symbol, content, authority = "current") {
  return {
    source_path: path,
    source_type: type,
    symbol_or_section: symbol,
    commit_sha: "sha1",
    content_hash: hashContent(content),
    authority_level: authority,
    version: null,
    details: {},
  };
}

function sampleManifest() {
  return {
    schema_version: "1.0",
    commit_sha: "sha1",
    index_content_hash: "manifest-hash",
    records: [
      record("src/lib/billing.js", "application_source_symbol", "calculateLateFee", codeContent),
      // Paired by naming convention (billing.test.js <-> billing.js) but does NOT match the query.
      record("src/lib/billing.test.js", "test_file", null, unpairedTestContent),
      record("docs/billing.md", "synchronized_document_section", "Billing", docContent),
      record("decisions/decision-12.md", "reviewed_decision", null, decisionContent, "reviewed_decision"),
      // Same subject as the doc above ("billing"), different authority tier, different content:
      // a genuine contradiction for the assembler to promote.
      record("docs/archive/billing-old.md", "synchronized_document_section", "Billing", staleDocContent, "historical_snapshot"),
    ],
  };
}

function contentProvider() {
  const byPath = {
    "src/lib/billing.js": codeContent,
    "src/lib/billing.test.js": unpairedTestContent,
    "docs/billing.md": docContent,
    "decisions/decision-12.md": decisionContent,
    "docs/archive/billing-old.md": staleDocContent,
  };
  return (sha, p) => byPath[p] || null;
}
function reader() {
  return {
    readFileAtCommit: contentProvider(),
    readMigrationsAtCommit: () => [],
  };
}

const bugRecords = [
  { sha: "aaa", date: "2026-09-20", subject: "fix(billing): correct late fee rounding", pr: 100, class: "fix", files: ["src/lib/billing.js"] },
  { sha: "bbb", date: "2026-09-21", subject: "fix(auth): token refresh race", pr: 101, class: "fix", files: ["src/lib/auth.js"] },
];

describe("derivePairedTestPaths", () => {
  it("mirrors the indexer naming convention in reverse", () => {
    expect(derivePairedTestPaths("src/lib/billing.js")).toContain("src/lib/billing.test.js");
    expect(derivePairedTestPaths("src/lib/billing.jsx")).toContain("src/lib/billing.test.jsx");
  });
  it("never pairs a test file with itself or a non-source path", () => {
    expect(derivePairedTestPaths("src/lib/billing.test.js")).toEqual([]);
    expect(derivePairedTestPaths("README.md")).toEqual([]);
  });
});

describe("assembleDiagnosticContext", () => {
  it("partitions matched results into role-labeled facets", () => {
    const bundle = assembleDiagnosticContext({ manifest: sampleManifest(), queryText: "calculateLateFee", excerptReader: reader(), contentProvider: contentProvider() });
    expect(bundle.insufficient_evidence).toBe(false);
    expect(bundle.facets.implicated_code.map((r) => r.source_path)).toContain("src/lib/billing.js");
    expect(bundle.facets.intended_behavior.map((r) => r.source_path)).toContain("docs/billing.md");
    expect(bundle.facets.decisions.map((r) => r.source_path)).toContain("decisions/decision-12.md");
    // Every matched result lands in exactly one facet -- nothing silently dropped.
    const total = Object.values(bundle.facets).reduce((n, arr) => n + arr.length, 0);
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it("pairs naming-convention tests to implicated code and labels them honestly", () => {
    const bundle = assembleDiagnosticContext({ manifest: sampleManifest(), queryText: "calculateLateFee", excerptReader: reader() });
    const paired = bundle.facets.behavior_pins.find((r) => r.source_path === "src/lib/billing.test.js");
    expect(paired).toBeTruthy();
    expect(paired.association).toBe("naming-convention pair");
    expect(paired.paired_to).toBe("src/lib/billing.js");
    // A paired test is weak query evidence, never presented as a strong match.
    expect(paired.confidence).not.toBe("high");
  });

  it("promotes cross-authority contradictions to the top level", () => {
    const bundle = assembleDiagnosticContext({ manifest: sampleManifest(), queryText: "billing", excerptReader: reader() });
    expect(bundle.contradictions.length).toBeGreaterThan(0);
    const subjects = bundle.contradictions.map((c) => c.subject);
    expect(subjects.some((s) => s.includes("billing"))).toBe(true);
  });

  it("attaches related past fixes from the bug catalog, and degrades to [] without one", () => {
    const withBugs = assembleDiagnosticContext({ manifest: sampleManifest(), queryText: "late fee billing", excerptReader: reader(), bugRecords });
    expect(withBugs.past_fixes.length).toBeGreaterThan(0);
    expect(withBugs.past_fixes[0].record.pr).toBe(100);

    const withoutBugs = assembleDiagnosticContext({ manifest: sampleManifest(), queryText: "late fee billing", excerptReader: reader(), bugRecords: [] });
    expect(withoutBugs.past_fixes).toEqual([]);
  });

  it("admits insufficient evidence honestly when nothing matches anywhere", () => {
    const bundle = assembleDiagnosticContext({
      manifest: sampleManifest(),
      queryText: "somethingThatDoesNotExistAnywhere",
      excerptReader: reader(),
      bugRecords: [],
    });
    expect(bundle.insufficient_evidence).toBe(true);
    expect(bundle.reason).toBeTruthy();
    for (const entries of Object.values(bundle.facets)) expect(entries).toEqual([]);
    expect(bundle.past_fixes).toEqual([]);
  });

  it("past fixes alone are enough to avoid an insufficient-evidence refusal", () => {
    const bundle = assembleDiagnosticContext({
      manifest: sampleManifest(),
      queryText: "zzz-no-code-match billing late fee",
      excerptReader: reader(),
      bugRecords,
    });
    // "late fee billing" terms hit the bug catalog even though no code record matched.
    expect(bundle.past_fixes.length).toBeGreaterThan(0);
    expect(bundle.insufficient_evidence).toBe(false);
  });

  it("determinism: two identical runs produce a byte-identical result_content_hash", () => {
    const a = assembleDiagnosticContext({ manifest: sampleManifest(), queryText: "billing", excerptReader: reader(), bugRecords });
    const b = assembleDiagnosticContext({ manifest: sampleManifest(), queryText: "billing", excerptReader: reader(), bugRecords });
    expect(a.result_content_hash).toBe(b.result_content_hash);
  });

  it("evidenceSignal re-ranks implicated_code without touching other facets or inventing results", () => {
    const aContent = "export function calculateLateFee(balance) { return balance * 0.05; }";
    const bContent = "import { calculateLateFee } from './billing.js';\nexport function buildNsisInstaller() { const fee = calculateLateFee(100); return fee; }";
    const manifest = {
      schema_version: "1.0",
      commit_sha: "sha1",
      index_content_hash: "manifest-hash",
      records: [
        record("src/lib/billing.js", "application_source_symbol", "calculateLateFee", aContent),
        record("src/lib/nsis-pack.js", "application_source_symbol", "buildNsisInstaller", bContent),
        record("docs/billing.md", "synchronized_document_section", "Billing", docContent),
      ],
    };
    const byPath = { "src/lib/billing.js": aContent, "src/lib/nsis-pack.js": bContent, "docs/billing.md": docContent };
    const cp = (sha, p) => byPath[p] || null;
    const rdr = { readFileAtCommit: cp, readMigrationsAtCommit: () => [] };
    const signal = { failed_step: "package installer", error_lines: [], mentioned_paths: ["src/lib/nsis-pack.js"] };

    const natural = assembleDiagnosticContext({ manifest, queryText: "calculateLateFee", excerptReader: rdr, contentProvider: cp });
    expect(natural.evidence_signal_applied).toBe(false);
    expect(natural.facets.implicated_code[0].source_path).toBe("src/lib/billing.js");
    expect(natural.facets.implicated_code[0].evidence_match).toBeUndefined();

    const ranked = assembleDiagnosticContext({ manifest, queryText: "calculateLateFee", excerptReader: rdr, contentProvider: cp, evidenceSignal: signal });
    expect(ranked.evidence_signal_applied).toBe(true);
    // The failure log named nsis-pack.js exactly: it promotes to first with a tier-0 annotation.
    expect(ranked.facets.implicated_code[0].source_path).toBe("src/lib/nsis-pack.js");
    expect(ranked.facets.implicated_code[0].evidence_match.tier).toBe(0);
    // Nothing dropped, nothing invented; other facets keep their order.
    expect(ranked.facets.implicated_code.map((e) => e.source_path).sort())
      .toEqual(natural.facets.implicated_code.map((e) => e.source_path).sort());
    expect(ranked.facets.intended_behavior.map((e) => e.source_path))
      .toEqual(natural.facets.intended_behavior.map((e) => e.source_path));
  });

  it("empty/malformed evidenceSignal leaves evidence_signal_applied false and entries unannotated", () => {
    const aContent = "export function calculateLateFee(balance) { return balance * 0.05; }";
    const manifest = {
      schema_version: "1.0",
      commit_sha: "sha1",
      index_content_hash: "manifest-hash",
      records: [
        record("src/lib/billing.js", "application_source_symbol", "calculateLateFee", aContent),
      ],
    };
    const byPath = { "src/lib/billing.js": aContent };
    const cp = (sha, p) => byPath[p] || null;
    const rdr = { readFileAtCommit: cp, readMigrationsAtCommit: () => [] };
    const base = { manifest, queryText: "calculateLateFee", excerptReader: rdr, contentProvider: cp };

    const natural = assembleDiagnosticContext(base);
    for (const empty of [{}, { mentioned_paths: [], error_lines: [] }, { failed_step: "   " }, null, undefined]) {
      const bundle = assembleDiagnosticContext({ ...base, evidenceSignal: empty });
      expect(bundle.evidence_signal_applied).toBe(false);
      // Same implicated_code as the no-signal run, in the same order, no annotations.
      expect(bundle.facets.implicated_code.map((e) => e.source_path))
        .toEqual(natural.facets.implicated_code.map((e) => e.source_path));
      for (const entry of bundle.facets.implicated_code) {
        expect(entry.evidence_match).toBeUndefined();
      }
    }
  });
});
