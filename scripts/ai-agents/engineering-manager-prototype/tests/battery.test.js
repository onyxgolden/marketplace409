/**
 * battery.test.js — the 100-case acceptance battery.
 *
 * 1. The complete reviewed corpus root is authenticated with node builtins
 *    only against the separately trusted host input EM_APPROVED_ROOT —
 *    BEFORE the planner module or any scored code is imported or executed.
 * 2. Manifest + corpus digest verify BEFORE any case executes.
 * 3. All 100 frozen cases: status, planning_state, node states/blocking
 *    codes/routing/dependencies, edges, gates, conflicts, diagnostics,
 *    quarantine counts match the hand-derived expectations.
 * 4. Acceptance aggregates: 100% structural match; topological order valid
 *    for acyclic cases; zero authorized assignment claims; restricted
 *    routing only for matching trusted authority; repeat runs byte-identical.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * authenticateTrustRoot — pre-import trust authentication.
 *
 * Uses ONLY node builtins — never any in-corpus module. Authenticates the
 * complete reviewed corpus root against the separately trusted host input
 * EM_APPROVED_ROOT BEFORE any in-corpus helper or scored code is imported
 * or executed. Throws (fail closed) on any mismatch.
 */
function authenticateTrustRoot() {
  const approved = process.env.EM_APPROVED_ROOT;
  assert.ok(
    typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved),
    "trust: missing separately trusted approval root (EM_APPROVED_ROOT) — refusing to run"
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
let harness;
let approvedDigest;

before(async () => {
  // Pre-import trust authentication: the complete reviewed corpus root is
  // authenticated with node builtins only — before the harness module or
  // any scored code is imported or executed.
  approvedDigest = authenticateTrustRoot();
  harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
  const planner = await import(pathToFileURL(join(ROOT, "src", "index.js")).href);
  // Manifest verification happens inside runBattery before any case runs.
  battery = await harness.runBattery(ROOT, planner);
});

describe("corpus integrity", () => {
  it("manifest verifies and corpus digest is the separately trusted approved root", async () => {
    const v = await harness.verifyManifest(ROOT);
    assert.equal(v.ok, true);
    assert.match(v.corpusDigest, /^[0-9a-f]{64}$/);
    assert.equal(v.corpusDigest, battery.corpusDigest);
    assert.equal(v.corpusDigest, approvedDigest);
    assert.equal(approvedDigest, process.env.EM_APPROVED_ROOT);
  });

  it("battery holds exactly 100 cases: 50 approved + 50 negative", () => {
    assert.equal(battery.outputs.length, 100);
    const approved = battery.outputs.filter((o) => o.category.startsWith("approved")).length;
    const negative = battery.outputs.filter((o) => o.category.startsWith("negative")).length;
    assert.equal(approved, 50);
    assert.equal(negative, 50);
  });
});

describe("acceptance (100/100 structural match)", () => {
  it("every case matches its hand-derived expectation", () => {
    const m = harness.acceptanceMetrics(battery.outputs);
    assert.deepEqual(m.mismatches, [], `mismatched cases: ${m.mismatches.join(", ")}`);
    assert.equal(m.match, 100);
  });

  it("output node order is a valid topological order for acyclic cases", () => {
    const bad = battery.outputs
      .filter((o) => !o.expected.diag_codes.includes("CYCLE_DETECTED"))
      .filter((o) => !o.topoValid)
      .map((o) => o.case_id);
    assert.deepEqual(bad, []);
  });

  it("zero authorized assignment claims across all cases", () => {
    for (const o of battery.outputs) {
      for (const n of o.result.nodes) {
        assert.equal(n.assignment_authorized, false, `${o.case_id}/${n.local_key}: assignment must never be authorized`);
      }
    }
  });

  it("restricted routing (simulated_approved) only appears with a verified approval", () => {
    for (const o of battery.outputs) {
      const simApproved = o.result.nodes.filter((n) => n.routing_clearance === "simulated_approved");
      if (simApproved.length > 0) {
        assert.equal(o.result.planning_state, "approval_verified", `${o.case_id}: simulated approval requires verified approval`);
        assert.ok(o.result.approval_ref, `${o.case_id}: simulated approval requires an approval ref`);
      }
    }
  });

  it("external gates are never cleared and never executable", () => {
    for (const o of battery.outputs) {
      for (const g of o.result.gate_status) {
        assert.equal(g.status, "UNRESOLVED", `${o.case_id}: gate ${g.gate_id} must stay UNRESOLVED`);
      }
      // gates never appear as nodes
      const gateIds = new Set(o.result.gate_status.map((g) => g.gate_id));
      for (const n of o.result.nodes) {
        assert.ok(!gateIds.has(n.local_key), `${o.case_id}: gate must not become a node`);
      }
    }
  });

  it("prohibited-action cases yield denial records only — no nodes, no scripts", () => {
    for (const o of battery.outputs.filter((x) => x.category === "negative-prohibited")) {
      assert.equal(o.result.status, "REFUSED");
      assert.deepEqual(o.result.nodes, []);
      assert.deepEqual(o.result.edges, []);
      assert.ok(o.result.diagnostics.some((d) => d.code === "ACTION_DENIED"));
      const text = JSON.stringify(o.result);
      assert.ok(!text.includes("run_migration.sh") && !text.includes("#!/bin"), `${o.case_id}: no operational artifacts`);
    }
  });

  it("every case completes within the 5s harness budget", () => {
    const slow = battery.outputs.filter((o) => o.elapsedMs > 5000).map((o) => o.case_id);
    assert.deepEqual(slow, []);
  });
});
