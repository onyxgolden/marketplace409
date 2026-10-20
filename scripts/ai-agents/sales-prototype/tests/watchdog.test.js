/**
 * watchdog.test.js — the 5-second external watchdog terminates hangs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runGuarded, runGuardedWithTestWorker, GUARD_TIMEOUT_MS } from "../runner/run-guarded.js";
import * as guardedModule from "../runner/run-guarded.js";
import { loadStore, makeStandard } from "./helpers.js";

const store = loadStore();

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
    // S653-008 (fix round 2): hang coverage uses the CLOSED test-worker
    // identity — the caller names "hang", the path resolves inside the
    // package. No eval, no factories, no caller-supplied paths.
    const t0 = Date.now();
    const r = await runGuardedWithTestWorker("{}", "{}", 1500, "hang");
    const elapsed = Date.now() - t0;
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "EXECUTION_TIMEOUT");
    assert.equal(r.report, null);
    assert.equal(r.complete, false);
    assert.ok(elapsed < 10000, `watchdog must terminate promptly (took ${elapsed}ms)`);
  });

  it("the arbitrary worker-path seam is removed (S653-008 fix round 2)", async () => {
    // The old runGuardedWithWorker(taskJson, contextJson, timeoutMs,
    // workerPath) export — which passed any filesystem path to new Worker
    // — must not exist. A reviewer-supplied external script can no longer
    // be executed through the production API.
    assert.equal(guardedModule.runGuardedWithWorker, undefined);
  });

  it("unknown test-worker names refuse with TRANSPORT_REFUSED", async () => {
    const r = await runGuardedWithTestWorker("{}", "{}", 1500, "reviewer-script");
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "TRANSPORT_REFUSED");
    assert.equal(r.report, null);
  });

  it("malformed JSON transport refuses with report:null", async () => {
    // S653-008: the refusal contract — no Research-shaped artifact.
    const r = await runGuarded("{not json", "{}");
    assert.equal(r.status, "REFUSED");
    assert.equal(r.report, null);
  });
});

describe("S653 fix round 3: worker identity validated before lookup, no coercion (S653-008)", () => {
  it("object identity with a toString counter refuses with zero coercion-hook calls", async () => {
    // The reviewer's exact probe: an object whose toString counts calls.
    // typeof must reject it BEFORE the TEST_WORKERS lookup, and the
    // refusal must not String(workerName).
    let calls = 0;
    const evil = { toString() { calls++; return "hang"; } };
    const r = await runGuardedWithTestWorker("{}", "{}", 1500, evil);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "TRANSPORT_REFUSED");
    assert.equal(calls, 0, "toString must never be called");
  });

  it("Proxy identity refuses with zero trap invocations", async () => {
    let traps = 0;
    const proxy = new Proxy({}, {
      get(t, k) { traps++; return t[k]; },
      getOwnPropertyDescriptor(t, k) { traps++; return Object.getOwnPropertyDescriptor(t, k); },
      getPrototypeOf(t) { traps++; return Object.getPrototypeOf(t); },
      ownKeys(t) { traps++; return Object.getOwnPropertyNames(t); },
      has(t, k) { traps++; return k in t; },
    });
    const r = await runGuardedWithTestWorker("{}", "{}", 1500, proxy);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "TRANSPORT_REFUSED");
    assert.equal(traps, 0, "no proxy trap may fire");
  });

  it("symbol identity refuses without coercion", async () => {
    const r = await runGuardedWithTestWorker("{}", "{}", 1500, Symbol("hang"));
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "TRANSPORT_REFUSED");
  });

  it("inherited key names do not match (closed enum, own-key only)", async () => {
    // "toString", "constructor", "hasOwnProperty" are inherited on a
    // normal object; the null-prototype TEST_WORKERS map must not match
    // them.
    for (const name of ["toString", "constructor", "hasOwnProperty", "watch"]) {
      const r = await runGuardedWithTestWorker("{}", "{}", 1500, name);
      assert.equal(r.status, "REFUSED", `"${name}" must not resolve to a worker`);
      assert.equal(r.diagnostics[0].code, "TRANSPORT_REFUSED");
    }
  });

  it("unknown strings refuse", async () => {
    const r = await runGuardedWithTestWorker("{}", "{}", 1500, "definitely-not-a-worker");
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "TRANSPORT_REFUSED");
    assert.equal(r.report, null);
  });

  it("the registered hang worker still terminates under the watchdog", async () => {
    // Control: the real "hang" identity keeps working after the fix.
    const t0 = Date.now();
    const r = await runGuardedWithTestWorker("{}", "{}", 1500, "hang");
    const elapsed = Date.now() - t0;
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "EXECUTION_TIMEOUT");
    assert.ok(elapsed < 10000, `watchdog must terminate promptly (took ${elapsed}ms)`);
  });
});
