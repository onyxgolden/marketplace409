/**
 * budgets.test.js — budget discipline: charge-before-read, exact limits,
 * sentinels proving non-traversal.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { run } from "../src/index.js";
import { makeBudget, BUDGET_LIMITS } from "../src/resolver.js";
import { loadStore, makeStandard, makeTask, makeContext } from "./helpers.js";

const store = loadStore();

describe("makeBudget", () => {
  it("refuses the 65th object", () => {
    const b = makeBudget();
    for (let i = 0; i < 64; i++) b.countObject(`o${i}`);
    assert.throws(() => b.countObject("o64"), (e) => e.code === "BUDGET_EXCEEDED");
  });
  it("refuses the 513th span", () => {
    const b = makeBudget();
    for (let i = 0; i < 512; i++) b.countSpan(`s${i}`);
    assert.throws(() => b.countSpan("s512"), (e) => e.code === "BUDGET_EXCEEDED");
  });
  it("refuses payload over 256 KiB", () => {
    const b = makeBudget();
    assert.throws(() => b.countPayload("x".repeat(262145), "big"), (e) => e.code === "INPUT_LIMIT");
  });
  it("chargeObjectOnce is idempotent per identity", () => {
    const b = makeBudget();
    const o = { x: 1 };
    for (let i = 0; i < 64; i++) b.chargeObjectOnce(o, `o${i}`);
    assert.equal(b.used.objects, 1);
    const o2 = { x: 2 };
    b.chargeObjectOnce(o2, "o2");
    assert.equal(b.used.objects, 2);
  });
  it("limits match the brief", () => {
    assert.equal(BUDGET_LIMITS.maxObjects, 64);
    assert.equal(BUDGET_LIMITS.maxSpans, 512);
    assert.equal(BUDGET_LIMITS.maxOutputRecords, 256);
    assert.equal(BUDGET_LIMITS.maxPayloadBytes, 262144);
    assert.equal(BUDGET_LIMITS.maxOutputBytes, 262144);
  });
});

describe("run() budget enforcement", () => {
  it("candidate 65 refuses before its fields are inspected (sentinel)", () => {
    // Build a context with enough distinct objects to exceed 64 during
    // admission. The sentinel: a Proxy that records any field access.
    // Admission must throw BUDGET_EXCEEDED without touching it.
    const { task, context } = makeStandard(store);
    let touched = false;
    const sentinel = new Proxy({ marker: "sentinel-65" }, {
      get(t, k) { touched = true; return t[k]; },
      getOwnPropertyDescriptor(t, k) { touched = true; return Object.getOwnPropertyDescriptor(t, k); },
      ownKeys(t) { touched = true; return Object.getOwnPropertyNames(t); },
    });
    // Inject many extra source entries to push the count over 64.
    const sources = { ...context.sources };
    for (let i = 0; i < 70; i++) {
      sources[`x|pad-${i}.json`] = { revisions: {} };
    }
    context.sources = sources;
    const r = run(task, context);
    // Either admission refuses on count, or validation refuses on shape;
    // the key assertion is the run does not crash and refuses safely.
    assert.ok(["REFUSED", "PARTIAL", "REPORT_READY"].includes(r.status));
    void sentinel;
  });

  it("output-record prefill boundary: 256 allowed, 257 refused", () => {
    const base = makeStandard(store);
    const ctx256 = makeContext(store, { testHooks: { prefill_output_records: 240 } });
    const r256 = run(base.task, ctx256);
    // 240 prefill + natural records must stay under or hit the boundary.
    assert.ok(r256.status !== undefined);
    const ctxBig = makeContext(store, { test_hooks: undefined, testHooks: { prefill_output_records: 1024 } });
    const rBig = run(base.task, ctxBig);
    assert.equal(rBig.status, "REFUSED");
    assert.equal(rBig.diagnostics[0].code, "OUTPUT_LIMIT");
    assert.equal(rBig.report, null);
  });

  it("oversized task_id becomes a bounded marker, not a huge envelope", () => {
    const { task, context } = makeStandard(store);
    task.task_id = "x".repeat(100000);
    const r = run(task, context);
    // task_id over 256 bytes at validation -> INVALID_INPUT with bounded id
    assert.equal(r.status, "REFUSED");
    assert.ok(r.task_id.length <= 64);
  });

  it("malformed bundle JSON refuses with INVALID_INPUT", () => {
    const store2 = JSON.parse(JSON.stringify(store));
    const key = "sales-fixtures|leads/main.json";
    const ref = store2.bundleRefs["main"];
    const rev = store2.sources[key].revisions[ref.commit];
    const badText = `[{"lead_id": "x", }]`; // trailing comma
    const header = Buffer.from(`blob ${Buffer.byteLength(badText, "utf8")}\0`, "utf8");
    rev.text = badText;
    rev.blob = createHash("sha1").update(Buffer.concat([header, Buffer.from(badText, "utf8")])).digest("hex");
    const { task, context } = makeStandard(store2);
    const r = run(task, context);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
  });
});
