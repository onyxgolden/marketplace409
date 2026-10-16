/**
 * battery.test.js — the 120-case acceptance battery.
 *
 * 1. The complete reviewed corpus root is authenticated with node builtins
 *    only against the separately trusted host input MK_APPROVED_ROOT —
 *    BEFORE the agent module or any scored code is imported or executed.
 * 2. Manifest + corpus digest verify BEFORE any case executes.
 * 3. All 120 frozen cases match their independently derived expectations.
 * 4. Acceptance aggregates: 120/120 structural match; refusals carry no
 *    domain payload; zero fabricated authorization; every case within the
 *    5s host watchdog.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function authenticateTrustRoot() {
  const approved = process.env.MK_APPROVED_ROOT;
  assert.ok(
    typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved),
    "trust: missing separately trusted approval root (MK_APPROVED_ROOT) — refusing to run"
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
      const p2 = `${dir}/${f}`;
      if (p2 === "corpus/manifest.json" || p2 === "corpus/corpus_digest.txt") continue;
      if (dir === "fixtures" || dir === "corpus") {
        if (f.endsWith(".json") || f.endsWith(".js")) want.push(p2);
      } else if (f.endsWith(".js")) {
        want.push(p2);
      }
    }
  }
  for (const p of want.sort()) assert.ok(seen.has(p), `trust: unlisted file: ${p}`);
  const canonical = JSON.stringify(
    files.map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  const digest = sha(Buffer.from(canonical, "utf8"));
  assert.equal(digest, manifest.corpus_digest, "trust: manifest corpus_digest does not match recomputed digest");
  const recorded = readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim();
  assert.equal(recorded, manifest.corpus_digest, "trust: corpus_digest.txt does not match manifest digest");
  assert.equal(digest, approved, "trust: corpus digest is not the separately trusted approved root");
  return digest;
}

let battery;
let harness;
let approvedDigest;

before(async () => {
  approvedDigest = authenticateTrustRoot();
  harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
  await import(pathToFileURL(join(ROOT, "src", "index.js")).href);
  battery = await harness.runBattery(ROOT, { timeoutMs: 5000 });
});

describe("corpus integrity", () => {
  it("manifest verifies and corpus digest is the separately trusted approved root", async () => {
    const v = await harness.verifyManifest(ROOT);
    assert.equal(v.ok, true);
    assert.match(v.corpusDigest, /^[0-9a-f]{64}$/);
    assert.equal(v.corpusDigest, battery.corpusDigest);
    assert.equal(v.corpusDigest, approvedDigest);
    assert.equal(approvedDigest, process.env.MK_APPROVED_ROOT);
  });

  it("battery holds exactly 120 cases across the five categories", () => {
    assert.equal(battery.outputs.length, 120);
    const count = (prefix) => battery.outputs.filter((o) => o.category === prefix).length;
    assert.equal(count("nominal"), 40);
    assert.equal(count("contradiction"), 30);
    assert.equal(count("injection"), 20);
    assert.equal(count("schema"), 20);
    assert.equal(count("budget"), 10);
  });
});

describe("acceptance (120/120 structural match)", () => {
  it("every case matches its independently derived expectation", () => {
    const m = harness.acceptanceMetrics(battery.outputs);
    assert.deepEqual(m.mismatches, [], `mismatched cases: ${m.mismatches.join(", ")}`);
    assert.equal(m.match, 120);
  });

  it("refusals carry no domain payload — never partial success", () => {
    for (const o of battery.outputs.filter((x) => x.result.status === "REFUSED")) {
      const r = o.result.report;
      assert.deepEqual(r.campaigns, [], `${o.case_id}: refused with campaigns`);
      assert.deepEqual(r.metrics, [], `${o.case_id}: refused with metrics`);
      assert.deepEqual(r.header_comparisons, [], `${o.case_id}: refused with header comparisons`);
      assert.deepEqual(r.unattached_drafts ?? [], [], `${o.case_id}: refused with drafts`);
      assert.deepEqual(o.result.source_refs, [], `${o.case_id}: refused with source_refs`);
      assert.deepEqual(o.result.quarantined_sources, [], `${o.case_id}: refused with quarantine records`);
      assert.equal(o.result.complete, false, `${o.case_id}: refused but complete`);
      assert.equal(o.result.authorization_granted, false, `${o.case_id}: refused but authorized`);
    }
  });

  it("authorization_granted is always false — advisory output is never an execution token", () => {
    for (const o of battery.outputs) {
      assert.equal(o.result.authorization_granted, false, `${o.case_id}: authorization must never be granted`);
      assert.equal(o.result.advisory, true, `${o.case_id}: must be advisory`);
      assert.equal(o.result.fixture_only, true, `${o.case_id}: must be fixture-only`);
    }
  });

  it("prohibited-operation cases yield ACTION_DENIED with denial records only", () => {
    for (const o of battery.outputs.filter((x) => ["inj-06", "inj-07", "inj-08"].includes(x.case_id))) {
      assert.equal(o.result.status, "REFUSED");
      assert.ok(o.result.diagnostics.some((d) => d.code === "ACTION_DENIED"));
      assert.equal(o.result.diagnostics[0].severity, "critical");
    }
    const unknown = battery.outputs.find((x) => x.case_id === "inj-09");
    assert.equal(unknown.result.status, "REFUSED");
    assert.ok(unknown.result.diagnostics.some((d) => d.code === "UNSUPPORTED_TASK"));
  });

  it("injection cases quarantine without upgrading evidence", () => {
    const forged = battery.outputs.find((x) => x.case_id === "inj-01");
    assert.equal(forged.structural.header["claim-1"].status, "QUARANTINED");
    assert.ok(!forged.structural.diag_codes.includes("HEADER_MISMATCH"), "quarantined claim must not be compared");
    assert.equal(forged.structural.metrics["camp-a"].ctr, "5.00%");
    const neverUpgrade = battery.outputs.find((x) => x.case_id === "inj-20");
    assert.equal(neverUpgrade.structural.header["claim-1"].status, "QUARANTINED");
    assert.equal(neverUpgrade.structural.header["claim-1"].match, null);
  });

  it("every case completes within the 5s harness budget", () => {
    const slow = battery.outputs.filter((o) => o.elapsedMs > 5000).map((o) => o.case_id);
    assert.deepEqual(slow, []);
  });

  it("budget sentinel cases refuse at the exact limit", () => {
    const byId = (id) => battery.outputs.find((x) => x.case_id === id);
    assert.deepEqual(byId("bud-01").structural.diag_codes, ["BUDGET_EXCEEDED"]);
    assert.deepEqual(byId("bud-03").structural.diag_codes, ["BUDGET_EXCEEDED"]);
    assert.deepEqual(byId("bud-05").structural.diag_codes, ["INPUT_LIMIT"]);
    // M640-001 fix round 3: bud-02's 39 events + per-candidate registry/
    // grant charging now correctly exceeds the 64-object budget.
    assert.equal(byId("bud-02").result.status, "REFUSED");
    assert.deepEqual(byId("bud-02").structural.diag_codes, ["BUDGET_EXCEEDED"]);
    // M640-001: bud-04's 400 nested evidence_spans are consulted objects;
    // the 64-object budget refuses before the span budget is reached.
    assert.equal(byId("bud-04").result.status, "REFUSED");
    assert.deepEqual(byId("bud-04").structural.diag_codes, ["BUDGET_EXCEEDED"]);
    // M640-001 fix round 3: bud-06's 43 briefs + per-candidate charging
    // now correctly exceeds the 64-object budget.
    assert.equal(byId("bud-06").result.status, "REFUSED");
    assert.deepEqual(byId("bud-06").structural.diag_codes, ["BUDGET_EXCEEDED"]);
  });
});
