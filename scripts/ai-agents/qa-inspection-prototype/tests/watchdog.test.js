/**
 * watchdog.test.js — the host-side watchdog terminates a stuck worker with a
 * named incomplete failure (QAI-005): no hang, no success.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let runWorkerScript;

before(async () => {
  // Pre-import trust bootstrap (QAI-004, round 2): bootstrap bytes checked
  // against the pinned manifest entry, then the corpus authenticated against
  // the separately trusted QA_APPROVED_ROOT before the harness is imported.
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const entry = (manifest.files ?? []).find((e) => e.path === "tests/trust-bootstrap.js");
  const actual = createHash("sha256").update(readFileSync(join(ROOT, "tests", "trust-bootstrap.js"))).digest("hex");
  assert.ok(entry && actual === entry.sha256, "tests/trust-bootstrap.js does not match the pinned manifest entry");
  const bootstrap = await import(pathToFileURL(join(ROOT, "tests", "trust-bootstrap.js")).href);
  bootstrap.verifyTrustRoot(ROOT);
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
