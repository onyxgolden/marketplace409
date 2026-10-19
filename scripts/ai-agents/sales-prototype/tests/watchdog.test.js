/**
 * watchdog.test.js — the 5-second external watchdog terminates hangs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuarded, runGuardedWithWorker, GUARD_TIMEOUT_MS } from "../runner/run-guarded.js";
import { loadStore, makeStandard } from "./helpers.js";

const store = loadStore();
const HANG_WORKER = join(dirname(fileURLToPath(import.meta.url)), "hang-worker.js");

describe("runGuarded", () => {
  it("timeout is 5000ms", () => {
    assert.equal(GUARD_TIMEOUT_MS, 5000);
  });

  it("a normal task settles through the guarded path", async () => {
    const { task, context } = makeStandard(store);
    const r = await runGuarded(JSON.stringify(task), JSON.stringify(context));
    assert.ok(["REPORT_READY", "PARTIAL"].includes(r.status));
    assert.equal(r.agent, "sales-agent");
  });

  it("non-string transport refuses without touching the worker", async () => {
    const r = await runGuarded({ not: "a string" }, "{}");
    assert.equal(r.status, "REFUSED");
  });

  it("oversized transport refuses before worker creation", async () => {
    const big = "x".repeat(300000);
    const r = await runGuarded(big, "{}");
    assert.equal(r.status, "REFUSED");
    assert.ok(r.diagnostics[0].code.includes("TRANSPORT") || r.diagnostics[0].code === "INPUT_LIMIT");
  });

  it("a hung worker is terminated by the external watchdog (bounded, report:null)", async () => {
    // S653-008: hang coverage uses the fixed, manifest-authenticated
    // tests/hang-worker.js — never eval, never a factory string.
    const t0 = Date.now();
    const r = await runGuardedWithWorker("{}", "{}", 1500, HANG_WORKER);
    const elapsed = Date.now() - t0;
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "EXECUTION_TIMEOUT");
    assert.equal(r.report, null);
    assert.equal(r.complete, false);
    assert.ok(elapsed < 10000, `watchdog must terminate promptly (took ${elapsed}ms)`);
  });

  it("malformed JSON transport refuses with report:null", async () => {
    // S653-008: the refusal contract — no Research-shaped artifact.
    const r = await runGuarded("{not json", "{}");
    assert.equal(r.status, "REFUSED");
    assert.equal(r.report, null);
  });
});
