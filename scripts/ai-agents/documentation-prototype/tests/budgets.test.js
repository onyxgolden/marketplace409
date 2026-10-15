/**
 * budgets.test.js — input/output/budget gates and the host watchdog.
 * Budget breach refuses with complete:false and no partial success; a
 * timed-out case yields the named fail-closed WATCHDOG_TIMEOUT refusal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { buildContext } from "./harness.js";
import { runCaseWithWatchdog, watchdogRefusal } from "./watchdog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function firstCase() {
  const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
  return battery[0];
}

test("oversize task payload -> REFUSED INPUT_LIMIT, no partial output", () => {
  const c = firstCase();
  const task = JSON.parse(JSON.stringify(c.task));
  // 64 schema-valid claim_specs x ~8.3 KiB quoted_text each > 256 KiB budget.
  const big = "x".repeat(8192);
  const one = task.claim_specs[0];
  task.claim_specs = Array.from({ length: 64 }, (_, i) => ({
    claim_id: `dd-big-${i}`,
    doc_span: { quoted_text: big, start_byte: 0, end_byte: 8192 },
    behavior_key: one.behavior_key,
    code_span_ids: [],
    required_usage_span_ids: [],
  }));
  const { context } = buildContext(ROOT, c);
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
  assert.equal(r.complete, false);
  assert.equal(r.claims.length, 0);
});

test("single over-long string trips the schema cap first (layered defense)", () => {
  const c = firstCase();
  const task = JSON.parse(JSON.stringify(c.task));
  task.claim_specs[0].doc_span.quoted_text = "x".repeat(8193);
  task.claim_specs[0].doc_span.end_byte = task.claim_specs[0].doc_span.start_byte + 8193;
  const { context } = buildContext(ROOT, c);
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("too many claim_specs -> REFUSED INVALID_INPUT", () => {
  const c = firstCase();
  const task = JSON.parse(JSON.stringify(c.task));
  const one = task.claim_specs[0];
  task.claim_specs = Array.from({ length: 65 }, (_, i) => ({ ...JSON.parse(JSON.stringify(one)), claim_id: `dd-x-${i}` }));
  const { context } = buildContext(ROOT, c);
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("watchdog timeout -> fail-closed WATCHDOG_TIMEOUT refusal", async () => {
  const c = firstCase();
  const { context } = buildContext(ROOT, c);
  const outcome = await runCaseWithWatchdog(ROOT, c.task, context, { timeoutMs: 200, hang: true });
  assert.equal(outcome.timeout, true);
  const r = watchdogRefusal(c.task, 200);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "WATCHDOG_TIMEOUT");
  assert.equal(r.complete, false);
});

test("normal case completes well under the watchdog budget", async () => {
  const c = firstCase();
  const { context } = buildContext(ROOT, c);
  const t0 = Date.now();
  const outcome = await runCaseWithWatchdog(ROOT, c.task, context, { timeoutMs: 5000 });
  const elapsed = Date.now() - t0;
  assert.ok(outcome.ok, outcome.error);
  assert.ok(elapsed < 5000, `case took ${elapsed}ms`);
});
