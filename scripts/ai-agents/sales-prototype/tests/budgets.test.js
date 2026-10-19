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
  // is 25 objects (task 4 + control plane 14 + one granted source 3 +
  // resolve 1 + validate-time re-charges deduped; the control plane grew
  // by 2 for the S653-002 product-evidence records). Records are charged
  // one slot each BEFORE decode, so 39 records fit exactly (64/64) and the
  // 40th record — the 65th object — refuses before JSON.parse runs.
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
    // 39 records = exactly 64 admitted objects: valid positive control.
    const s39 = dncBundle(39, false);
    const r39 = run(makeTask(s39, { bundleNames: ["dnc"] }), makeContext(s39, { bundleNames: ["dnc"] }));
    assert.notEqual(r39.diagnostics[0]?.code, "BUDGET_EXCEEDED", "39 records must not trip the object budget");
    // 40 records: the 40th record is the 65th object and refuses BUDGET_EXCEEDED.
    const s40 = dncBundle(40, false);
    const r40 = run(makeTask(s40, { bundleNames: ["dnc"] }), makeContext(s40, { bundleNames: ["dnc"] }));
    assert.equal(r40.status, "REFUSED");
    assert.equal(r40.diagnostics[0].code, "BUDGET_EXCEEDED");
    assert.equal(r40.report, null);
    assert.equal(r40.complete, false);
  });

  it("over-budget candidate with malformed JSON refuses BUDGET_EXCEEDED, not INVALID_INPUT", () => {
    // The poisoned 40th record proves the over-budget candidate is refused
    // BEFORE JSON.parse decodes it: the refusal must be BUDGET_EXCEEDED,
    // never INVALID_INPUT for the malformed bytes.
    const s = dncBundle(40, true);
    const r = run(makeTask(s, { bundleNames: ["dnc"] }), makeContext(s, { bundleNames: ["dnc"] }));
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
    assert.ok(r.diagnostics[0].reason.includes("record 39 slot"));
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
    // S653-007 (fix round 2): the complete-envelope walk counts every
    // object occurrence except the outer envelope shell and transparent
    // arrays: source_refs 1 + report 1 + population 1 + summary 1 = 4.
    assert.equal(countOutputRecords(r), 4);
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

describe("S653 fix round 2: serialized input accounting (S653-005)", () => {
  it("escaped metadata cannot bypass the input cap (reviewer probe)", async () => {
    // The reviewer's exact probe: 50,000 NUL chars in principal.registered_by.
    // Serialized with JSON escaping this is ~300KiB — INPUT_LIMIT, never REPORT_READY.
    const { makeStandard } = await import("./helpers.js");
    const { run } = await import("../src/index.js");
    const { task, context } = makeStandard(store);
    context.principal = { ...context.principal, registered_by: "\0".repeat(50000) };
    const r = run(task, context);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
    assert.equal(r.report, null);
  });

  it("quote/backslash/unicode metadata is charged with escaping", async () => {
    const { makeStandard } = await import("./helpers.js");
    const { run } = await import("../src/index.js");
    const { serializedByteLength } = await import("../src/resolver.js");
    const { task, context } = makeStandard(store);
    // '"' serializes as 2 bytes; '\\' as 2; 'é' as 2 UTF-8 bytes.
    const pad = '"'.repeat(100000) + "\\".repeat(100000) + "é".repeat(40000);
    context.principal = { ...context.principal, registered_by: pad };
    const measured = serializedByteLength(context.principal);
    assert.ok(measured > 262144, `escaped payload must exceed cap (measured ${measured})`);
    const r = run(task, context);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
  });

  it("aggregate exact-fit is allowed, +1 refuses (task+context serialized)", async () => {
    const { makeStandard, PRINCIPAL } = await import("./helpers.js");
    const { run } = await import("../src/index.js");
    const { serializedByteLength } = await import("../src/resolver.js");
    const { BUDGET_LIMITS } = await import("../src/resolver.js");
    const cap = BUDGET_LIMITS.maxPayloadBytes;
    // Replicate run()'s byte accounting exactly: task + each context
    // control value (sources container = keys only) + revision metadata +
    // the once-charged selected source bytes.
    const key = "sales-fixtures|leads/main.json";
    const ref = store.bundleRefs["main"];
    const rev = store.sources[key].revisions[ref.commit];
    const probe = makeStandard(store);
    const fixedBytes =
      serializedByteLength(probe.task) +
      serializedByteLength(probe.context.clock) +
      serializedByteLength(Object.getOwnPropertyNames(probe.context.sources)) +
      serializedByteLength(probe.context.readGrants) +
      serializedByteLength(probe.context.criteria) +
      serializedByteLength(probe.context.product_registry) +
      serializedByteLength({
        commit: ref.commit, blob: rev.blob, label: rev.label,
        expected_records: rev.expected_records, dataset_id: rev.dataset_id,
        dataset_version: rev.dataset_version, coverage: rev.coverage,
      }) +
      Buffer.byteLength(rev.text, "utf8");
    const principalBase = (padLen) =>
      serializedByteLength({ ...PRINCIPAL, registered_by: "p".repeat(padLen) });
    const padFor = (target) => target - fixedBytes - principalBase(0);
    const padLen = padFor(cap);
    assert.ok(padLen > 0, "fixture must leave headroom under the cap");
    // Exact-fit: total byte charge equals the cap -> allowed.
    const t2 = makeStandard(store);
    t2.context.principal.registered_by = "p".repeat(padLen);
    const checkTotal =
      fixedBytes + principalBase(padLen);
    assert.equal(checkTotal, cap, `sized total ${checkTotal} must equal cap ${cap}`);
    const rFit = run(t2.task, t2.context);
    assert.notEqual(rFit.diagnostics[0]?.code, "INPUT_LIMIT", "exact-fit aggregate must be allowed");
    // +1 byte over the cap refuses.
    const t3 = makeStandard(store);
    t3.context.principal.registered_by = "p".repeat(padLen + 1);
    const rOver = run(t3.task, t3.context);
    assert.equal(rOver.status, "REFUSED");
    assert.equal(rOver.diagnostics[0].code, "INPUT_LIMIT");
    assert.equal(rOver.report, null);
  });

  it("selected source bytes are charged exactly once (S653-005)", async () => {
    // Direct accounting verification: resolveSourceRef must charge the
    // revision text bytes exactly once. If the bytes were counted three
    // times (resolver + bundle + per-record), the delta would be 3x.
    const { makeBudget, resolveSourceRef } = await import("../src/resolver.js");
    const { makeTask } = await import("./helpers.js");
    const key = "sales-fixtures|leads/main.json";
    const ref = store.bundleRefs["main"];
    const rev = store.sources[key].revisions[ref.commit];
    const textBytes = Buffer.byteLength(rev.text, "utf8");
    const budget = makeBudget();
    const before = budget.used.payloadBytes;
    const task = makeTask(store);
    const sourceRef = task.fixture_refs[0];
    const sources = { [key]: store.sources[key] };
    resolveSourceRef(sourceRef, sources, budget, "test");
    const after = budget.used.payloadBytes;
    const delta = after - before;
    // The delta includes the text bytes (once) + the small metadata
    // serialization. It must NOT include 3x the text bytes.
    assert.ok(delta < textBytes * 1.5, `source bytes must be charged once, not three times (delta ${delta}, text ${textBytes})`);
    assert.ok(delta >= textBytes, `delta ${delta} must include the ${textBytes} text bytes`);
  });
});

describe("S653 fix round 2: complete-envelope output walk (S653-007)", () => {
  it("the walk counts every emitted object occurrence (independent derivation)", async () => {
    // Independent complete-envelope count, written without importing the
    // candidate's counter: every object occurrence except the outer
    // envelope shell; arrays transparent; scalars not records.
    const { makeStandard } = await import("./helpers.js");
    const { run, countOutputRecords } = await import("../src/index.js");
    const { task, context } = makeStandard(store);
    const r = run(task, context);
    let independent = 0;
    const walk = (v, depth) => {
      if (v === null || typeof v !== "object" || depth > 64) return;
      if (Array.isArray(v)) { for (const e of v) walk(e, depth + 1); return; }
      independent += 1;
      for (const k of Object.keys(v)) walk(v[k], depth + 1);
    };
    for (const k of Object.keys(r)) walk(r[k], 0);
    assert.equal(countOutputRecords(r), independent, "walk must match the independent derivation");
    assert.ok(independent > 200, `main envelope should have >200 records (got ${independent})`);
    assert.ok(independent <= 256, `main envelope must fit the 256 cap (got ${independent})`);
  });

  it("256 allowed / 257 refused derives prefill from the independent count", async () => {
    const { makeStandard } = await import("./helpers.js");
    const { run, countOutputRecords } = await import("../src/index.js");
    const base = makeStandard(store);
    const natural = countOutputRecords(run(base.task, base.context));
    // Derive the remaining prefill from the INDEPENDENT complete-envelope
    // count, not from the candidate's own helper.
    let independent = 0;
    const walk = (v, depth) => {
      if (v === null || typeof v !== "object" || depth > 64) return;
      if (Array.isArray(v)) { for (const e of v) walk(e, depth + 1); return; }
      independent += 1;
      for (const k of Object.keys(v)) walk(v[k], depth + 1);
    };
    const r0 = run(base.task, base.context);
    for (const k of Object.keys(r0)) walk(r0[k], 0);
    assert.equal(independent, natural);
    const ctxFit = makeStandard(store).context;
    Object.assign(ctxFit, { test_hooks: { prefill_output_records: 256 - independent } });
    const rFit = run(base.task, ctxFit);
    assert.notEqual(rFit.diagnostics[0]?.code, "OUTPUT_LIMIT", "exactly 256 must be allowed");
    const ctxOver = makeStandard(store).context;
    Object.assign(ctxOver, { test_hooks: { prefill_output_records: 256 - independent + 1 } });
    const rOver = run(base.task, ctxOver);
    assert.equal(rOver.status, "REFUSED");
    assert.equal(rOver.diagnostics[0].code, "OUTPUT_LIMIT");
    assert.equal(rOver.report, null);
  });
});
