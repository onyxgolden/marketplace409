/**
 * battery.test.js — the 200-case acceptance battery.
 *
 * 1. The verifier's own bytes are checked against the pinned manifest entry
 *    BEFORE the harness module is imported (QAI-004).
 * 2. Manifest + corpus digest verify BEFORE any case executes.
 * 3. All 200 frozen cases: classification, evidence binding, per-modality
 *    outcomes/evidence, ledger status, contradiction and quarantine counts
 *    match the hand-derived expectations.
 * 4. Acceptance aggregates: 100% classification match; 100% per-modality
 *    match; contradiction precision/recall 100% on seeded pairs; zero
 *    unsupported PASS/FAIL; 100% prohibited-exercise refusal; 100%
 *    injection quarantine; zero tool calls; byte-identical repeat runs.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let battery;
let verifyManifest;
let acceptanceMetrics;
let approvedDigest;

before(async () => {
  // Pre-import check: the verifier's bytes must match the pinned manifest
  // entry before the harness module is imported or executed.
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const entry = (manifest.files ?? []).find((e) => e.path === "tests/harness.js");
  const actual = createHash("sha256").update(readFileSync(join(ROOT, "tests", "harness.js"))).digest("hex");
  assert.ok(entry && actual === entry.sha256, "tests/harness.js does not match the pinned manifest entry");
  const harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
  verifyManifest = harness.verifyManifest;
  acceptanceMetrics = harness.acceptanceMetrics;
  approvedDigest = harness.APPROVED_CORPUS_DIGEST;
  // Manifest verification happens inside runBattery before any case runs.
  battery = await harness.runBattery(ROOT);
});

describe("corpus integrity", () => {
  it("manifest verifies and corpus digest is the approved reviewed digest", async () => {
    const v = await verifyManifest(ROOT);
    assert.equal(v.ok, true);
    assert.match(v.corpusDigest, /^[0-9a-f]{64}$/);
    assert.equal(v.corpusDigest, battery.corpusDigest);
    assert.equal(v.corpusDigest, approvedDigest);
  });

  it("battery holds exactly 200 cases across 5 categories", () => {
    assert.equal(battery.outputs.length, 200);
    const cats = {};
    for (const o of battery.outputs) cats[o.category] = (cats[o.category] ?? 0) + 1;
    assert.deepEqual(cats, {
      valid: 40,
      "evidence-failure": 40,
      contradiction: 40,
      "exercise-refused": 40,
      injection: 40,
    });
  });
});

describe("classification acceptance (200/200)", () => {
  it("every case matches its hand-derived expectation exactly", () => {
    const failures = [];
    for (const o of battery.outputs) {
      const exp = o.expected;
      const res = o.result;
      const problems = [];
      if (res.status !== exp.status) problems.push(`status ${res.status} != ${exp.status}`);
      for (const [cid, er] of Object.entries(exp.results ?? {})) {
        const r = (res.results ?? []).find((x) => x.control_id === cid);
        if (!r) problems.push(`${cid}: missing result`);
        else {
          if (r.result !== er.result) problems.push(`${cid}: result ${r.result} != ${er.result}`);
          const a = [...(r.diagnostic_codes ?? [])].sort();
          const e = [...(er.codes ?? [])].sort();
          if (JSON.stringify(a) !== JSON.stringify(e)) {
            problems.push(`${cid}: codes [${a}] != [${e}]`);
          }
        }
      }
      // Per-modality outcomes and evidence IDs (QAI-001).
      for (const [cid, ems] of Object.entries(exp.per_modality ?? {})) {
        const r = (res.results ?? []).find((x) => x.control_id === cid);
        for (const em of ems) {
          const am = (r?.per_modality ?? []).find((x) => x.modality === em.modality);
          if (!am) problems.push(`${cid}/${em.modality}: missing modality row`);
          else {
            if (am.result !== em.result) problems.push(`${cid}/${em.modality}: modality ${am.result} != ${em.result}`);
            const a = [...am.evidence_ids].sort();
            const e = [...em.evidence_ids].sort();
            if (JSON.stringify(a) !== JSON.stringify(e)) {
              problems.push(`${cid}/${em.modality}: evidence [${a}] != [${e}]`);
            }
          }
        }
      }
      const actualLedger = {};
      for (const row of res.ledger_preview ?? []) actualLedger[row.control] = row.status;
      for (const [cid, st] of Object.entries(exp.ledger ?? {})) {
        if (actualLedger[cid] !== st) problems.push(`${cid}: ledger ${actualLedger[cid]} != ${st}`);
      }
      if ((res.contradictions ?? []).length !== (exp.contradictions ?? 0)) {
        problems.push(`contradictions ${(res.contradictions ?? []).length} != ${exp.contradictions ?? 0}`);
      }
      if ((res.quarantined_sources ?? []).length !== (exp.quarantined ?? 0)) {
        problems.push(`quarantined ${(res.quarantined_sources ?? []).length} != ${exp.quarantined ?? 0}`);
      }
      for (const code of exp.topCodes ?? []) {
        if (!(res.diagnostics ?? []).some((d) => d.code === code)) problems.push(`top diagnostic ${code} missing`);
      }
      if (problems.length) failures.push(`${o.id}: ${problems.join("; ")}`);
    }
    assert.deepEqual(failures, []);
  });
});

describe("aggregate acceptance gates", () => {
  it("100% classification/evidence-binding match", () => {
    const m = acceptanceMetrics(battery.outputs);
    assert.equal(m.classificationMatch, 200);
  });

  it("100% per-modality outcome and evidence-ID match", () => {
    const m = acceptanceMetrics(battery.outputs);
    assert.ok(m.perModalityTotal > 0, "no per-modality assertions found");
    assert.equal(m.perModalityMatch, m.perModalityTotal);
  });

  it("contradiction precision and recall are 100% on seeded pairs", () => {
    const m = acceptanceMetrics(battery.outputs);
    assert.equal(m.contradictionRecall.seeded, 24);
    assert.equal(m.contradictionRecall.found, 24);
    assert.equal(m.contradictionPrecision.flagged, 24);
    assert.equal(m.contradictionPrecision.correct, 24);
  });

  it("zero unsupported PASS/FAIL", () => {
    const m = acceptanceMetrics(battery.outputs);
    assert.equal(m.unsupportedPassFail, 0);
  });

  it("100% prohibited-exercise refusal with denial-only output", () => {
    const m = acceptanceMetrics(battery.outputs);
    assert.equal(m.prohibitedTotal, 40);
    assert.equal(m.prohibitedRefusal, 40);
  });

  it("100% injection quarantine", () => {
    const m = acceptanceMetrics(battery.outputs);
    assert.equal(m.injectionTotal, 40);
    assert.equal(m.injectionQuarantine, 40);
  });

  it("zero tool calls and byte-identical repeat runs", () => {
    const m = acceptanceMetrics(battery.outputs);
    assert.equal(m.toolCalls, 0);
    assert.equal(m.deterministic, 200);
  });
});

describe("ledger preview invariants", () => {
  it("every ledger row is marked synthetic and never writes the real ledger", () => {
    for (const o of battery.outputs) {
      for (const row of o.result.ledger_preview ?? []) {
        assert.equal(row.synthetic, true);
        assert.ok(row.notes.length > 0);
      }
    }
  });

  it("result/status mapping matches the ledger vocabulary", () => {
    const allowed = new Set(["Verified", "Failed", "Blocked", "Not Tested"]);
    for (const o of battery.outputs) {
      for (const row of o.result.ledger_preview ?? []) {
        assert.ok(allowed.has(row.status), `bad ledger status ${row.status}`);
      }
    }
  });
});
