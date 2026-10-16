import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCaseWithWatchdog, watchdogRefusal } from "./watchdog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("runCaseWithWatchdog terminates a hung worker at the timeout and reports timeout:true", async () => {
  const t0 = Date.now();
  const outcome = await runCaseWithWatchdog(ROOT, {}, {}, { timeoutMs: 200, hang: true });
  const elapsed = Date.now() - t0;
  assert.equal(outcome.timeout, true);
  assert.ok(elapsed >= 200, `expected at least 200ms elapsed, got ${elapsed}`);
  assert.ok(elapsed < 2000, `watchdog should terminate promptly, took ${elapsed}ms`);
});

test("watchdogRefusal produces a well-formed REFUSED envelope with no partial domain output", () => {
  const r = watchdogRefusal({ task_id: "x" }, 5000);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.complete, false);
  assert.equal(r.diagnostics[0].code, "WATCHDOG_TIMEOUT");
  assert.equal(r.report.backlog.total, 0);
  assert.equal(r.report.integrity_findings.length, 0);
});

test("a non-hung case completes normally well under the timeout", async () => {
  const outcome = await runCaseWithWatchdog(
    ROOT,
    { schema_version: "1", task_id: "x", operation: "analyze", fixture_refs: { register: { repo: "a", path: "b.txt", commit: "0".repeat(40), blob: "0".repeat(40), algorithm: "git-sha1", revision: "v1" } }, options: { as_of_date: "2026-01-01", window: { start_date: "2026-01-01", end_date: "2026-01-01" }, population: { declared_total: 0, complete: true } } },
    { clock: Date.parse("2026-01-01T00:00:00Z") },
    { timeoutMs: 5000, hang: false }
  );
  assert.equal(outcome.timeout, undefined);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.status, "REFUSED"); // invalid context (missing principal etc.), but NOT a timeout
});
