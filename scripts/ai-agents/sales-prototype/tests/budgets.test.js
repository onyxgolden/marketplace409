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
  // S653-005: with the standard test context the fixed admission overhead
  // is 23 objects (task 4 + control plane 12 + one granted source 4 +
  // resolve 1 + validate-time re-charges deduped). Records are charged one
  // slot each BEFORE decode, so 41 records fit exactly (64/64) and the
  // 42nd record — the 65th candidate — refuses before JSON.parse runs.
  function dncBundle(n, poisonLast) {
    const leads = [];
    for (let i = 0; i < n; i++) leads.push({
      lead_id: `d${String(i).padStart(3, "0")}`, opportunity_id: `d${String(i).padStart(3, "0")}-opp`,
      need_match: true, budget_match: true, timing_days: 30, do_not_contact: true, stage: "NEW",
      amount_minor: "1000", currency: "USD", probability_num: 1, probability_den: 2,
      created_at: "2026-09-01", stage_entered_at: "2026-09-15", closed_at: null,
      fixture_product_id: "crm-starter", display_name: "T", notes: "",
    });
    let text = JSON.stringify(leads);
    if (poisonLast) text = text.replace(/,"notes":""}]$/, ',"notes":""}, {broken}]');
    const s2 = JSON.parse(JSON.stringify(store));
    const key = "sales-fixtures|leads/dnc.json";
    const commit = "c".repeat(40);
    const header = Buffer.from(`blob ${Buffer.byteLength(text, "utf8")}\0`, "utf8");
    const blob = createHash("sha1").update(Buffer.concat([header, Buffer.from(text, "utf8")])).digest("hex");
    s2.sources[key] = { revisions: { [commit]: { text, blob, label: "dnc", expected_records: n, dataset_id: "sales-fixtures", dataset_version: "2026-10-19" } } };
    s2.bundleRefs["dnc"] = { repo: "sales-fixtures", path: "leads/dnc.json", commit };
    return s2;
  }

  it("candidate 65 refuses before decode; later records untouched (sentinel)", () => {
    // 41 records = exactly 64 admitted candidates: valid positive control.
    const s41 = dncBundle(41, false);
    const r41 = run(makeTask(s41, { bundleNames: ["dnc"] }), makeContext(s41, { bundleNames: ["dnc"] }));
    assert.notEqual(r41.diagnostics[0]?.code, "BUDGET_EXCEEDED", "41 records must not trip the object budget");
    // 42 records: the 42nd record is candidate 65 and refuses BUDGET_EXCEEDED.
    const s42 = dncBundle(42, false);
    const r42 = run(makeTask(s42, { bundleNames: ["dnc"] }), makeContext(s42, { bundleNames: ["dnc"] }));
    assert.equal(r42.status, "REFUSED");
    assert.equal(r42.diagnostics[0].code, "BUDGET_EXCEEDED");
    assert.equal(r42.report, null);
    assert.equal(r42.complete, false);
  });

  it("over-budget candidate with malformed JSON refuses BUDGET_EXCEEDED, not INVALID_INPUT", () => {
    // The poisoned 42nd record proves the over-budget candidate is refused
    // BEFORE JSON.parse decodes it: the refusal must be BUDGET_EXCEEDED,
    // never INVALID_INPUT for the malformed bytes.
    const s = dncBundle(42, true);
    const r = run(makeTask(s, { bundleNames: ["dnc"] }), makeContext(s, { bundleNames: ["dnc"] }));
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
    assert.ok(r.diagnostics[0].reason.includes("record 41 slot"));
    assert.equal(r.report, null);
  });

  it("output-record boundary: exact 256 allowed, 257 refused (final-envelope walk)", async () => {
    const { countOutputRecords } = await import("../src/index.js");
    const base = makeStandard(store);
    const r0 = run(base.task, base.context);
    const natural = countOutputRecords(r0);
    assert.ok(natural > 0 && natural < 256, `natural count ${natural} must be within bounds`);
    // Exact-fit: prefill so the total is exactly 256 -> allowed.
    const ctxFit = makeContext(store, { testHooks: { prefill_output_records: 256 - natural } });
    const rFit = run(base.task, ctxFit);
    assert.notEqual(rFit.diagnostics[0]?.code, "OUTPUT_LIMIT", "exactly 256 records must be allowed");
    // Plus one: 257 -> bounded REFUSED with report:null.
    const ctxOver = makeContext(store, { testHooks: { prefill_output_records: 256 - natural + 1 } });
    const rOver = run(base.task, ctxOver);
    assert.equal(rOver.status, "REFUSED");
    assert.equal(rOver.diagnostics[0].code, "OUTPUT_LIMIT");
    assert.equal(rOver.report, null);
    assert.equal(rOver.complete, false);
  });

  it("output walk counts nested citations, spans, stage ages, and aliased summary metrics", async () => {
    const { countOutputRecords } = await import("../src/index.js");
    const s = makeStandard(store, { bundleNames: ["empty"] }, { bundleNames: ["empty"] });
    s.task.population = (await import("./helpers.js")).boundPopulation(store, "empty");
    const r = run(s.task, s.context);
    assert.equal(r.status, "REPORT_READY");
    // source_refs 1 + classifications 0 + metrics 0 + population 1 +
    // summary 1 (+ its aliased empty metrics array 0) = 3.
    assert.equal(countOutputRecords(r), 3);
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
