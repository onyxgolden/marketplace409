/** budgets.test.js — candidate/span/payload/output boundaries, exact-fit,
 * +1 refusal, candidate-65 poison with untouched later records, and the
 * host-only output-record prefill (256 allowed / 257 refused).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, BUDGET_LIMITS } from "../src/index.js";
import { makeBudget, BudgetError } from "../src/resolver.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function ctxFor(bundle, overrides = {}) {
  const ref = store.bundleRefs[bundle];
  const key = `${ref.repo}|${ref.path}`;
  const docs = JSON.parse(store.sources[key].revisions[ref.commit].text);
  const reg = {};
  for (const d of docs) for (const p of d.passages || []) {
    const k = `${d.doc_id}|${p.passage_id}`;
    if (store.provenanceRegistry[k]) reg[k] = store.provenanceRegistry[k];
  }
  return {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    provenance_registry: reg,
    ...overrides,
  };
}
function taskFor(bundle, claims = []) {
  const ref = store.bundleRefs[bundle];
  const n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  return {
    schema_version: "1", task_id: "budget-test", operation: "analyze",
    fixture_refs: { evidence_bundle: ref },
    options: {
      population: { declared_total: n, complete: true },
      requested_claims: claims,
    },
  };
}
const REV_ALPHA = { subject: "ACME-CORP", predicate: "q3-revenue", value: 1200000, value_type: "number", scope: "fy-2026-q3", polarity: "positive" };

test("budget limits are the contract values", () => {
  assert.equal(BUDGET_LIMITS.maxObjects, 64);
  assert.equal(BUDGET_LIMITS.maxSpans, 512);
  assert.equal(BUDGET_LIMITS.maxOutputRecords, 256);
  assert.equal(BUDGET_LIMITS.maxPayloadBytes, 262144);
  assert.equal(BUDGET_LIMITS.maxOutputBytes, 262144);
});

test("primitive: 64 objects allowed, 65th refuses", () => {
  const b = makeBudget();
  for (let i = 0; i < 64; i++) b.countObject(`o${i}`);
  assert.throws(() => b.countObject("o65"), (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("primitive: 512 spans allowed, 513th refuses", () => {
  const b = makeBudget();
  for (let i = 0; i < 512; i++) b.countSpan(`s${i}`);
  assert.throws(() => b.countSpan("s513"), (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("boundary-fit: exactly 64 candidates succeeds", () => {
  const r = run(taskFor("boundary-fit"), ctxFor("boundary-fit", { provenance_registry: {} }));
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.complete, true);
});

test("boundary-plus1: 65 candidates refuses before inspection", () => {
  const r = run(taskFor("boundary-plus1"), ctxFor("boundary-plus1", { provenance_registry: {} }));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.report, null);
  assert.equal(r.complete, false);
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"));
});

test("sentinel-65: poison candidate refuses; poison and later records untouched", () => {
  const r = run(taskFor("sentinel-65"), ctxFor("sentinel-65", { provenance_registry: {} }));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"), "must refuse with BUDGET_EXCEEDED");
  // The poison record's fields were never inspected: had they been, the
  // injection marker would appear in quarantined_sources.
  assert.equal(r.quarantined_sources.length, 0, "poison record must be untouched (never quarantined)");
  assert.ok(
    !JSON.stringify(r.diagnostics).includes("doc-poison"),
    "refusal must not name the poison record"
  );
  assert.equal(r.report, null, "no partial domain artifact");
});

test("over-budget-docs: 100 documents refuse with BUDGET_EXCEEDED", () => {
  const r = run(taskFor("over-budget-docs"), ctxFor("over-budget-docs", { provenance_registry: {} }));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"));
});

test("output prefill: 254 + 2 natural records = 256 allowed", () => {
  const claims = [{
    claim_id: "c1", atoms: [REV_ALPHA],
    origin_passage_refs: [{ doc_id: "doc-alpha", passage_id: "p1" }],
  }];
  const r = run(taskFor("single-passage", claims), ctxFor("single-passage", {
    test_hooks: { prefill_output_records: 254 },
  }));
  // Natural records: 1 claim + 1 source_ref = 2; 254 + 2 = 256 <= 256.
  assert.equal(r.status, "REPORT_READY");
  assert.notEqual(r.report, null);
});

test("output prefill: 255 + 2 natural records = 257 refused with report:null", () => {
  const claims = [{
    claim_id: "c1", atoms: [REV_ALPHA],
    origin_passage_refs: [{ doc_id: "doc-alpha", passage_id: "p1" }],
  }];
  const r = run(taskFor("single-passage", claims), ctxFor("single-passage", {
    test_hooks: { prefill_output_records: 255 },
  }));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.report, null);
  assert.equal(r.complete, false);
  assert.ok(r.diagnostics.some((d) => d.code === "OUTPUT_LIMIT"));
  assert.equal(r.task_id, "budget-test");
});

test("input limit: 300KB bundle text refuses with INPUT_LIMIT", () => {
  const r = run(taskFor("huge-text"), ctxFor("huge-text"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INPUT_LIMIT"));
});

test("100-claim task refuses with BUDGET_EXCEEDED at admission", () => {
  const claims = Array.from({ length: 100 }, (_, i) => ({
    claim_id: `c${i}`, atoms: [REV_ALPHA],
    origin_passage_refs: [{ doc_id: "doc-alpha", passage_id: "p1" }],
  }));
  const r = run(taskFor("single-passage", claims), ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"));
});

test("oversized task_id becomes a bounded marker, not a 300KB envelope", () => {
  const task = taskFor("single-passage");
  task.task_id = "x".repeat(300 * 1024);
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.task_id, "[task-id-exceeds-256-bytes]");
  assert.ok(JSON.stringify(r).length <= BUDGET_LIMITS.maxOutputBytes);
});
