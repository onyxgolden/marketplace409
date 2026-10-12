/**
 * battery.test.js — the 200-case acceptance battery.
 *
 * 1. The trust bootstrap's bytes are checked against the pinned manifest
 *    entry, then the whole corpus is authenticated against the separately
 *    trusted host input QA_APPROVED_ROOT — BEFORE the harness module is
 *    imported (QAI-004, round 2).
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
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * authenticateTrustRoot — pre-import trust authentication (QAI-004, round 3).
 *
 * Uses ONLY node builtins — never any in-corpus module. Authenticates the
 * complete reviewed corpus root against the separately trusted host input
 * QA_APPROVED_ROOT BEFORE any in-corpus helper (bootstrap, harness, scorer)
 * is imported or executed.
 *
 * Checking a helper's bytes against its manifest-local entry is NOT
 * authentication: the helper would already have executed by the time any
 * root check runs. Throws (fail closed) on any mismatch.
 */
function authenticateTrustRoot() {
  const approved = process.env.QA_APPROVED_ROOT;
  assert.ok(
    typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved),
    "trust: missing separately trusted approval root (QA_APPROVED_ROOT) — refusing to run"
  );
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  } catch {
    assert.fail("trust: corpus/manifest.json unreadable");
  }
  const files = manifest.files;
  assert.ok(Array.isArray(files), "trust: manifest shape invalid");
  const seen = new Set();
  for (const e of files) {
    const p = e?.path;
    assert.ok(
      typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") &&
        normalize(p) === p && !p.startsWith("..") && !p.includes("../") && !seen.has(p),
      `trust: bad manifest entry: ${String(p)}`
    );
    seen.add(p);
    let bytes;
    try {
      bytes = readFileSync(join(ROOT, p));
    } catch {
      assert.fail(`trust: missing pinned file: ${p}`);
    }
    assert.equal(sha(bytes), e.sha256, `trust: hash mismatch: ${p}`);
  }
  const want = ["package.json", "README.md"];
  for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
    for (const f of readdirSync(join(ROOT, dir)).filter((x) => !x.startsWith("."))) {
      if (dir === "fixtures" ? f.endsWith(".json") : f.endsWith(".js")) want.push(`${dir}/${f}`);
    }
  }
  for (const p of want.sort()) assert.ok(seen.has(p), `trust: unlisted file: ${p}`);
  const canonical = JSON.stringify(
    files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  const digest = sha(Buffer.from(canonical, "utf8"));
  assert.equal(digest, manifest.corpus_digest, "trust: manifest corpus_digest does not match recomputed digest");
  const recorded = readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim();
  assert.equal(recorded, manifest.corpus_digest, "trust: corpus_digest.txt does not match manifest digest");
  assert.equal(digest, approved, "trust: corpus digest is not the separately trusted approved root");
  return digest;
}

let battery;
let verifyManifest;
let acceptanceMetrics;
let approvedDigest;

before(async () => {
  // Pre-import trust authentication (QAI-004, round 3): the complete
  // reviewed corpus root is authenticated with node builtins only — before
  // the harness module or any scored code is imported or executed. A
  // manifest-local byte check of a bootstrap helper is not authentication:
  // the helper would already have executed.
  approvedDigest = authenticateTrustRoot();
  const harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
  verifyManifest = harness.verifyManifest;
  acceptanceMetrics = harness.acceptanceMetrics;
  // Manifest verification happens inside runBattery before any case runs.
  battery = await harness.runBattery(ROOT);
});

describe("corpus integrity", () => {
  it("manifest verifies and corpus digest is the separately trusted approved root", async () => {
    const v = await verifyManifest(ROOT);
    assert.equal(v.ok, true);
    assert.match(v.corpusDigest, /^[0-9a-f]{64}$/);
    assert.equal(v.corpusDigest, battery.corpusDigest);
    assert.equal(v.corpusDigest, approvedDigest);
    assert.equal(approvedDigest, process.env.QA_APPROVED_ROOT);
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
