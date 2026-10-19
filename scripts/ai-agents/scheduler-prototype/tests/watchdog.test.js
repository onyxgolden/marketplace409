/** watchdog.test.js — S648A-006: external 5s watchdog around run().
 * Hang probes at factory/admission/runtime levels must terminate with a
 * bounded REFUSED envelope, never hang the parent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuarded, GUARD_TIMEOUT_MS } from "../runner/run-guarded.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function baseTaskContext() {
  const ref = store.bundleRefs["single-activity"];
  const key = `${ref.repo}|${ref.path}`;
  const task = {
    schema_version: "1", task_id: "watchdog-test", operation: "analyze",
    fixture_refs: { network_bundle: ref },
    options: {
      population: { declared_total: 2, complete: true },
      anchors: { c1: "2026-01-05" }, horizon_days: 60,
      deadlines: {}, constraints: [], claimed: {},
    },
  };
  const context = {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
  };
  return { task, context };
}

test("S648A-006: normal task settles with the real result", async () => {
  const { task, context } = baseTaskContext();
  const r = await runGuarded(task, context, 10000);
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.complete, true);
});

test("S648A-006: runtime hang (blocking loop in worker) times out bounded", async () => {
  // Factory itself hangs before returning: the worker blocks, the
  // parent's external watchdog terminates it. (Getter-based hangs are
  // rejected by descriptor-safe admission; this probes a true hang.)
  const factorySource = `() => { while (true) {} }`;
  const start = Date.now();
  const r = await runGuarded(null, null, 3000, factorySource);
  const elapsed = Date.now() - start;
  assert.equal(r.status, "REFUSED");
  assert.equal(r.complete, false);
  assert.ok(r.diagnostics.some((d) => d.code === "EXECUTION_TIMEOUT"));
  assert.ok(elapsed < 10000, `watchdog must fire near the timeout (took ${elapsed}ms)`);
  assert.deepEqual(r.report.components, []);
});

test("S648A-006: admission hang (blocking factory) times out", async () => {
  // Infinite loop during input construction — never reaches validation.
  const factorySource = `() => { let i = 0; while (true) { i++; } }`;
  const start = Date.now();
  const r = await runGuarded(null, null, 3000, factorySource);
  const elapsed = Date.now() - start;
  assert.equal(r.status, "REFUSED");
  assert.equal(r.complete, false);
  assert.ok(elapsed < 10000);
});

test("S648A-006: timeout envelope is bounded (no partial domain data)", async () => {
  const factorySource = `() => {
    const t = { x: 1 };
    Object.defineProperty(t, "x", { enumerable: true, get() { while (true) {} } });
    return { task: t, context: {} };
  }`;
  const r = await runGuarded(null, null, 2000, factorySource);
  assert.equal(r.report.components.length, 0);
  assert.equal(r.report.claimed_comparisons.length, 0);
  assert.equal(r.source_refs.length, 0);
  assert.equal(r.quarantined_sources.length, 0);
  assert.equal(r.report.summary, null);
});

test("S648A-006: guard timeout constant is 5000ms", () => {
  assert.equal(GUARD_TIMEOUT_MS, 5000);
});
