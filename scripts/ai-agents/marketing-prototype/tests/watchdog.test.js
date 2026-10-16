/**
 * watchdog.test.js — the host watchdog terminates a hung case and yields
 * the named fail-closed WATCHDOG_TIMEOUT refusal (never a hang, never a
 * partial result).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCaseWithWatchdog, watchdogRefusal } from "./watchdog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("watchdog", () => {
  it("terminates a hung worker and reports a timeout", async () => {
    const t0 = Date.now();
    const outcome = await runCaseWithWatchdog(ROOT, { task_id: "hang" }, {}, { timeoutMs: 300, hang: true });
    const elapsed = Date.now() - t0;
    assert.equal(outcome.timeout, true);
    assert.ok(elapsed < 5000, `watchdog took too long: ${elapsed}ms`);
  });

  it("watchdogRefusal is a complete:false REFUSED envelope with no domain payload", () => {
    const r = watchdogRefusal({ task_id: "hang" }, 300);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.complete, false);
    assert.deepEqual(r.diagnostics.map((d) => d.code), ["WATCHDOG_TIMEOUT"]);
    assert.equal(r.diagnostics[0].severity, "critical");
    assert.deepEqual(r.report.campaigns, []);
    assert.deepEqual(r.source_refs, []);
    assert.equal(r.authorization_granted, false);
  });
});
