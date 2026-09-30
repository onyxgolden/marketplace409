import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCollectedEvidenceFile,
  parseCollectedEvidence,
  selectEvidenceSignal,
} from "../loadCollectedEvidence.mjs";
import { runCli } from "../queryEngineeringBrainCli.mjs";
import { hashContent } from "../../hashContent.mjs";

function ciSignal(id) {
  return {
    signal_id: id,
    kind: "ci_failed",
    failed_step: "Run tests",
    error_lines: [`##[error] FAIL src/lib/${id}.js`],
    mentioned_paths: [`src/lib/${id}.js`],
    collected_at: "2026-09-30T05:00:00Z",
  };
}

function envelope(signals) {
  return {
    schema_version: "1.0",
    collected_at: "2026-09-30T05:00:00Z",
    repo: "owner/repo",
    evidence: Object.fromEntries(signals.map((s) => [s.signal_id, s])),
  };
}

function writeTmp(name, content) {
  const dir = mkdtempSync(join(tmpdir(), "evidence-"));
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe("parseCollectedEvidence", () => {
  it("loads the collector envelope and keeps provenance on each signal", () => {
    const { signals, warnings } = parseCollectedEvidence(envelope([ciSignal("s1"), ciSignal("s2")]));
    expect(warnings).toEqual([]);
    expect(signals.map((s) => s.signal_id)).toEqual(["s1", "s2"]);
    expect(signals[0]).toMatchObject({ kind: "ci_failed", failed_step: "Run tests" });
  });

  it("accepts a bare signal map defensively", () => {
    const { signals } = parseCollectedEvidence({ s1: ciSignal("s1") });
    expect(signals).toHaveLength(1);
    expect(signals[0].signal_id).toBe("s1");
  });

  it("skips failed-collection and evidence-free signals with warnings", () => {
    const broken = { status: "error", error: "HTTP 404" };
    const thin = { signal_id: "thin", kind: "delivery", status: "failed" };
    const { signals, warnings } = parseCollectedEvidence(
      envelope([ciSignal("ok"), broken, thin].map((s, i) => ({ ...s, signal_id: ["ok", "broken", "thin"][i] }))),
    );
    expect(signals.map((s) => s.signal_id)).toEqual(["ok"]);
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toContain("broken");
    expect(warnings.join(" ")).toContain("thin");
  });

  it("rejects non-object payloads", () => {
    expect(() => parseCollectedEvidence(null)).toThrow(/must be a JSON object/);
    expect(() => parseCollectedEvidence([1, 2])).toThrow(/must be a JSON object/);
  });
});

describe("loadCollectedEvidenceFile", () => {
  it("reads a real evidence.json file", () => {
    const file = writeTmp("evidence.json", JSON.stringify(envelope([ciSignal("s1")])));
    const { signals } = loadCollectedEvidenceFile(file);
    expect(signals).toHaveLength(1);
  });

  it("fails closed on missing file and malformed JSON", () => {
    expect(() => loadCollectedEvidenceFile("/no/such/evidence.json")).toThrow(/cannot read evidence file/);
    const bad = writeTmp("bad.json", "{ not json");
    expect(() => loadCollectedEvidenceFile(bad)).toThrow(/not valid JSON/);
  });
});

describe("selectEvidenceSignal", () => {
  const two = [ciSignal("s1"), ciSignal("s2")];

  it("auto-selects the only usable signal", () => {
    expect(selectEvidenceSignal([ciSignal("s1")], null).signal_id).toBe("s1");
  });

  it("requires an explicit id when several signals are usable", () => {
    expect(() => selectEvidenceSignal(two, null)).toThrow(/pass --signal with one of: s1, s2/);
  });

  it("selects the named signal and rejects unknown ids", () => {
    expect(selectEvidenceSignal(two, "s2").signal_id).toBe("s2");
    expect(() => selectEvidenceSignal(two, "nope")).toThrow(/unknown signal "nope"; available: s1, s2/);
  });

  it("fails when nothing usable remains", () => {
    expect(() => selectEvidenceSignal([], null)).toThrow(/no usable evidence signals/);
  });
});

describe("diagnose CLI evidence wiring", () => {
  const codeContent = "export function calculateLateFee(balance) { return balance * 0.05; }";

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "diag-evidence-"));
    const manifest = {
      schema_version: "1.0",
      commit_sha: "sha1",
      index_content_hash: "manifest-hash",
      records: [
        {
          source_path: "src/lib/billing.js",
          source_type: "application_source_symbol",
          symbol_or_section: "calculateLateFee",
          commit_sha: "sha1",
          content_hash: hashContent(codeContent),
          authority_level: "current",
          version: null,
          details: {},
        },
        {
          source_path: "src/lib/unrelated.js",
          source_type: "application_source_symbol",
          symbol_or_section: "formatDate",
          commit_sha: "sha1",
          content_hash: hashContent("export function formatDate(d) { return d; }"),
          authority_level: "current",
          version: null,
          details: {},
        },
      ],
    };
    const manifestPath = join(dir, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const evidence = {
      schema_version: "1.0",
      collected_at: "2026-09-30T05:00:00Z",
      repo: "owner/repo",
      evidence: {
        s1: {
          signal_id: "s1",
          kind: "ci_failed",
          failed_step: "Run tests",
          error_lines: ["##[error] FAIL src/lib/billing.js"],
          mentioned_paths: ["src/lib/billing.js"],
        },
      },
    };
    const evidencePath = join(dir, "evidence.json");
    writeFileSync(evidencePath, JSON.stringify(evidence));
    return { dir, manifestPath, evidencePath };
  }

  it("applies the collected evidence to the diagnose bundle with provenance", () => {
    const { dir, manifestPath, evidencePath } = setup();
    const { response, output } = runCli(
      ["--diagnose", "--manifest", manifestPath, "--evidence", evidencePath, "--json", "billing"],
      { cwd: dir },
    );
    expect(response.evidence_signal_applied).toBe(true);
    expect(response.evidence_signal_id).toBe("s1");
    expect(response.evidence_failed_step).toBe("Run tests");
    const top = response.facets.implicated_code[0];
    expect(top.source_path).toBe("src/lib/billing.js");
    expect(top.evidence_match.tier).toBe(0);
    expect(JSON.parse(output).evidence_signal_id).toBe("s1");
  });

  it("renders the applied signal in text output", () => {
    const { dir, manifestPath, evidencePath } = setup();
    const { output } = runCli(
      ["--diagnose", "--manifest", manifestPath, "--evidence", evidencePath, "billing"],
      { cwd: dir },
    );
    expect(output).toContain('Evidence re-rank from collected signal "s1" (failed step: Run tests)');
  });

  it("leaves provenance null when no evidence file is given", () => {
    const { dir, manifestPath } = setup();
    const { response } = runCli(
      ["--diagnose", "--manifest", manifestPath, "--json", "billing"],
      { cwd: dir },
    );
    expect(response.evidence_signal_applied).toBe(false);
    expect(response.evidence_signal_id).toBeNull();
  });

  it("rejects evidence flags without --diagnose and --signal without --evidence", () => {
    const { dir, manifestPath, evidencePath } = setup();
    expect(() => runCli(["--manifest", manifestPath, "--evidence", evidencePath], { cwd: dir }))
      .toThrow(/--evidence\/--signal require --diagnose/);
    expect(() => runCli(["--diagnose", "--manifest", manifestPath, "--signal", "s1"], { cwd: dir }))
      .toThrow(/--signal requires --evidence/);
  });

  it("fails closed on an ambiguous evidence file instead of guessing", () => {
    const { dir, manifestPath, evidencePath } = setup();
    const payload = JSON.parse(readFileSync(evidencePath, "utf8"));
    payload.evidence.s2 = {
      signal_id: "s2",
      kind: "ci_failed",
      failed_step: "Build",
      error_lines: ["##[error] build broke"],
      mentioned_paths: ["src/lib/other.js"],
    };
    writeFileSync(evidencePath, JSON.stringify(payload));
    expect(() => runCli(
      ["--diagnose", "--manifest", manifestPath, "--evidence", evidencePath, "billing"],
      { cwd: dir },
    )).toThrow(/pass --signal with one of: s1, s2/);
    // ...and the named signal resolves the ambiguity.
    const { response } = runCli(
      ["--diagnose", "--manifest", manifestPath, "--evidence", evidencePath, "--signal", "s2", "--json", "billing"],
      { cwd: dir },
    );
    expect(response.evidence_signal_id).toBe("s2");
  });
});
