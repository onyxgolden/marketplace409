/**
 * watchdog.test.js — the host-side watchdog terminates a stuck worker with a
 * named incomplete failure (QAI-005): no hang, no success.
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

let runWorkerScript;

before(async () => {
  // Pre-import trust authentication (QAI-004, round 3): the complete
  // reviewed corpus root is authenticated with node builtins only — before
  // the harness module or any scored code is imported or executed.
  authenticateTrustRoot();
  ({ runWorkerScript } = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href));
});

describe("host watchdog", () => {
  it("a stuck worker is terminated with a named incomplete failure", async () => {
    const outcome = await runWorkerScript(join(ROOT, "tests", "hang-worker.js"), { hang: true }, 300);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "WATCHDOG_TIMEOUT");
    assert.match(outcome.reason, /terminated/);
  });

  it("a healthy case worker completes and reports determinism", async () => {
    const task = {
      task_id: "t-watchdog-1",
      surface: { id: "s1", route: "/rentals", environment: "synthetic" },
      build_pin: { repo: "r", commit: "a".repeat(40), build_id: "b1", environment: "synthetic-ci" },
      controls: [],
      evidence_sources: [],
    };
    const outcome = await runWorkerScript(
      join(ROOT, "tests", "case-worker.js"),
      {
        moduleRoot: ROOT,
        task,
        fixtures: {
          builds: { b1: { build_id: "b1", repo: "r", commit: "a".repeat(40), environment: "synthetic-ci" } },
          evidence: [],
          artifacts: {},
          runs: {},
          grants: {},
        },
        clock: "2026-10-12T00:00:00Z",
      },
      5000
    );
    assert.equal(outcome.ok, true);
    assert.equal(outcome.value.result.status, "REPORTED");
    assert.equal(outcome.value.deterministic, true);
  });
});
