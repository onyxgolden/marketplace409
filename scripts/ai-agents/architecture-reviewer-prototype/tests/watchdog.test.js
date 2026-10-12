/**
 * watchdog.test.js — the host worker watchdog terminates hanging work
 * and converts it into a named fail-closed refusal.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCaseWithWatchdog, watchdogRefusal } from "./watchdog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("injected hanging work is terminated and refused with WATCHDOG_TIMEOUT", async () => {
  const outcome = await runCaseWithWatchdog(
    ROOT,
    { requested_action: "review" },
    { clock: 1, designs: {}, principals: [], gatePolicy: {} },
    { timeoutMs: 300, hang: true }
  );
  assert.equal(outcome.timeout, true);
  const r = watchdogRefusal({ requested_action: "review" }, 300);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "WATCHDOG_TIMEOUT"));
  assert.equal(r.complete, false);
  assert.equal(r.verdict_proposal, null);
});

test("a normal case completes well under the watchdog", async () => {
  const outcome = await runCaseWithWatchdog(
    ROOT,
    { requested_action: "merge" },
    { clock: 1, designs: {}, principals: [], gatePolicy: {} },
    { timeoutMs: 5000 }
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.status, "REFUSED");
});
