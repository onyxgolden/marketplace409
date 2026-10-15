import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCaseWithWatchdog, watchdogRefusal } from "./watchdog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("watchdog: a hung case is terminated at the timeout, not left to run forever", async () => {
  const t0 = Date.now();
  const outcome = await runCaseWithWatchdog(ROOT, { schema_version: "1" }, {}, { timeoutMs: 300, hang: true });
  const elapsed = Date.now() - t0;
  assert.equal(outcome.timeout, true);
  assert.ok(elapsed < 2000, `watchdog took too long to fire: ${elapsed}ms`);
});

test("watchdog: a normal (non-hanging) case completes well under the timeout", async () => {
  const outcome = await runCaseWithWatchdog(ROOT, { schema_version: "2" }, {}, { timeoutMs: 5000, hang: false });
  assert.equal(outcome.timeout, undefined);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.status, "REFUSED"); // schema_version "2" is invalid input, but that's a clean result, not a hang
});

test("watchdogRefusal: produces a complete, well-shaped envelope with no partial domain output", () => {
  const r = watchdogRefusal({ schema_version: "1" }, 5000);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.complete, false);
  assert.equal(r.diagnostics[0].code, "WATCHDOG_TIMEOUT");
  assert.deepEqual(r.report.source_reports, []);
  assert.deepEqual(r.report.derived_statements, []);
});
