/**
 * watchdog.test.js — host worker watchdog regressions (EM-005).
 *
 * The battery runs every case in a worker thread under a real interrupting
 * host watchdog. These tests prove the mechanism:
 *  - injected hanging work (worker-level `hang` flag, never the planner)
 *    is terminated at the timeout and refused with the named
 *    WATCHDOG_TIMEOUT fail-closed refusal;
 *  - a normal case completes through the worker path with its real result.
 *
 * Trust: pre-import authentication (builtins only) in before().
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function authenticateTrustRoot() {
  const approved = process.env.EM_APPROVED_ROOT;
  assert.ok(typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved), "trust: missing EM_APPROVED_ROOT");
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const seen = new Set();
  for (const e of manifest.files) {
    const p = e?.path;
    assert.ok(typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") && normalize(p) === p && !p.startsWith("..") && !p.includes("../") && !seen.has(p));
    seen.add(p);
    assert.equal(sha(readFileSync(join(ROOT, p))), e.sha256, `trust: hash mismatch: ${p}`);
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
  const digest = sha(Buffer.from(JSON.stringify(manifest.files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))), "utf8"));
  assert.equal(digest, manifest.corpus_digest);
  assert.equal(digest, approved);
  return digest;
}

let runCaseWithWatchdog;
let watchdogRefusal;

before(async () => {
  authenticateTrustRoot();
  const mod = await import(pathToFileURL(join(ROOT, "tests", "watchdog.js")).href);
  runCaseWithWatchdog = mod.runCaseWithWatchdog;
  watchdogRefusal = mod.watchdogRefusal;
});

function tinyCase() {
  const brief = {
    objective_id: "objective-watchdog",
    scope_ids: ["general"],
    task_specs: [
      {
        local_key: "w1",
        title: "Watchdog probe",
        owner_proposal: "muse",
        action_ids: ["draft_plan"],
        dependency_keys: [],
        acceptance_checks: [{ check_id: "w1-ac1", expected: "complete", evidence_kind: "fixture_record" }],
        external_gate_ids: [],
        source_spans: [],
      },
    ],
    non_goals: [],
  };
  const canon = JSON.stringify(
    (function sort(v) {
      if (Array.isArray(v)) return v.map(sort);
      if (v && typeof v === "object") {
        const o = {};
        for (const k of Object.keys(v).sort()) o[k] = sort(v[k]);
        return o;
      }
      return v;
    })(brief)
  );
  const bytes = Buffer.from(canon, "utf8");
  const blob = createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`, "utf8")).update(bytes).digest("hex");
  const ref = {
    repo: "forge-fixture-briefs",
    path: "commands/chatgpt/brief-watchdog.md",
    commit: createHash("sha1").update("fixture-commit:commands/chatgpt/brief-watchdog.md", "utf8").digest("hex"),
    blob,
    algorithm: "git-sha1",
    revision: "fixture-main",
  };
  const task = {
    brief_ref: ref,
    objective_id: brief.objective_id,
    constraints: { budget_units: 256, max_nodes: 256, owner_allowlist: ["muse"] },
    requested_action: "plan",
    related_brief_refs: [],
  };
  const NUL = String.fromCharCode(0);
  const briefs = {};
  briefs[ref.repo + NUL + ref.path + NUL + ref.commit] = { brief, blob };
  const context = { clock: "2026-10-12T12:00:00Z", briefs, approvals: [], owners: ["muse"], relays: [] };
  return { task, context };
}

describe("host worker watchdog", () => {
  it("injected hanging work is terminated at the timeout with a named fail-closed refusal", async () => {
    const { task, context } = tinyCase();
    const t0 = Date.now();
    const outcome = await runCaseWithWatchdog(ROOT, task, context, { timeoutMs: 1500, hang: true });
    const elapsed = Date.now() - t0;
    assert.equal(outcome.timeout, true, "the hanging worker must be reported as a timeout");
    assert.ok(elapsed < 15000, `watchdog must terminate the hang promptly (took ${elapsed}ms)`);
    assert.ok(elapsed >= 1400, `watchdog must wait for the timeout (took ${elapsed}ms)`);
    const refusal = watchdogRefusal(task, 1500);
    assert.equal(refusal.status, "REFUSED");
    assert.equal(refusal.complete, false);
    assert.equal(refusal.diagnostics.length, 1);
    assert.equal(refusal.diagnostics[0].code, "WATCHDOG_TIMEOUT");
    assert.equal(refusal.diagnostics[0].severity, "critical");
    assert.equal(refusal.nodes.length, 0, "no partial output on timeout");
  });

  it("a normal case completes through the worker path with its real result", async () => {
    const { task, context } = tinyCase();
    const outcome = await runCaseWithWatchdog(ROOT, task, context, { timeoutMs: 5000 });
    assert.equal(outcome.timeout ?? false, false);
    assert.equal(outcome.ok, true, `worker failed: ${outcome.error}`);
    assert.equal(outcome.result.status, "PLANNED");
    assert.equal(outcome.result.nodes.length, 1);
    assert.equal(outcome.result.complete, true);
  });
});
