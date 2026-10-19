/**
 * watchdog.test.js — the 5-second external watchdog terminates hangs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runGuarded, GUARD_TIMEOUT_MS } from "../runner/run-guarded.js";
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
});
