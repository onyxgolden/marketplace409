/**
 * watchdog.test.js — the host watchdog never synthesizes success.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCaseWithWatchdog, watchdogRefusal } from "./watchdog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("hanging case times out and refuses closed", async () => {
  const outcome = await runCaseWithWatchdog(ROOT, { task_id: "x" }, {}, { timeoutMs: 200, hang: true });
  assert.equal(outcome.timeout, true);
  const refusal = watchdogRefusal({ task_id: "x" }, 200);
  assert.equal(refusal.status, "REFUSED");
  assert.equal(refusal.diagnostics[0].code, "WATCHDOG_TIMEOUT");
  assert.equal(refusal.complete, false);
  assert.equal(refusal.claims.length, 0);
});

test("watchdog refusal carries no advisory success fields", () => {
  const refusal = watchdogRefusal({ task_id: "x" }, 200);
  assert.equal(refusal.advisory, true);
  assert.equal(refusal.fixture_only, true);
  assert.equal(refusal.publication_authorized, false);
  assert.equal(refusal.published, false);
});
