/**
 * watchdog.test.js — the host watchdog interrupts stuck work and refuses
 * fail-closed with the named WATCHDOG_TIMEOUT denial; no partial output
 * is ever accepted.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { runCaseWithWatchdog, watchdogRefusal } from "./watchdog.js";
import { ROOT, loadStore, baseContext, taskFor } from "./testutil.js";

const store = loadStore();

test("hanging worker is terminated and refused fail-closed", async () => {
  const outcome = await runCaseWithWatchdog(
    ROOT,
    taskFor(store, "SYN-CASE-001"),
    baseContext(),
    { timeoutMs: 300, hang: true }
  );
  assert.equal(outcome.timeout, true);
  const r = watchdogRefusal(taskFor(store, "SYN-CASE-001"), 300);
  assert.equal(r.status, "REFUSED");
  assert.deepEqual(r.diagnostics.map((d) => d.code), ["WATCHDOG_TIMEOUT"]);
  assert.equal(r.complete, false);
  assert.equal(r.recommendations.length, 0);
});

test("healthy case completes well under the watchdog timeout", async () => {
  const outcome = await runCaseWithWatchdog(
    ROOT,
    taskFor(store, "SYN-CASE-001"),
    baseContext(),
    { timeoutMs: 5000 }
  );
  assert.equal(outcome.timeout ?? false, false);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.status, "PROPOSED");
});
