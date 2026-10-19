/** budgets.test.js — candidate/span/payload/output boundaries, exact-fit,
 * +1 refusal, candidate-65 poison with untouched later records, and the
 * host-only output-record prefill (256 allowed / 257 refused).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, BUDGET_LIMITS, countFinalEnvelopeRecords } from "../src/index.js";
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

test("RA652-004: final-envelope walk counts every public record per the taxonomy", () => {
  // The old head counted a hand-maintained field list and missed the
  // public report, coverage, summary, each claim's atom/origin, and the
  // nested citation/source-ref/span records inside origins, evidence
  // and contradictions. The walk must count all of them, once per
  // emitted occurrence.
  const claims = [{
    claim_id: "c1", atoms: [REV_ALPHA],
    origin_passage_refs: [{ doc_id: "doc-alpha", passage_id: "p1" }],
  }];
  const r = run(taskFor("single-passage", claims), ctxFor("single-passage"));
  assert.equal(r.status, "REPORT_READY");
  const n = countFinalEnvelopeRecords(r);
  const c = r.report.claims[0];
  // Hand-derived for the single-passage 1-claim REPORT_READY envelope:
  // report(1) + coverage(1) + summary(1) + claim(1) + atom(1) +
  // origin(1) + origin.citation(1) + citation.source_ref(1) +
  // citation.span(1) + corroboration(1) + top-level source_refs[0](1) = 11.
  // The old hand-maintained field list counted 2.
  assert.equal(n, 11, `walk must count 11 public records (got ${n})`);
  assert.equal(c.corroboration.evidence.length, 0);
});

test("RA652-004: walk counts nested evidence/contradiction records", () => {
  const claims = [{
    claim_id: "c1", atoms: [REV_ALPHA],
    origin_passage_refs: [{ doc_id: "doc-alpha", passage_id: "p1" }],
  }];
  const r = run(taskFor("contradiction", claims), ctxFor("contradiction"));
  assert.equal(r.status, "PARTIAL");
  const n = countFinalEnvelopeRecords(r);
  const c = r.report.claims[0];
  assert.equal(c.fidelity, "FAITHFUL");
  assert.equal(c.contradictions.length, 1);
  // report(1) + coverage(1) + claim(1) + atom(1) + origin(1) +
  // origin.citation(1) + cit.source_ref(1) + cit.span(1) +
  // corroboration(1) + contradiction(1) + k.citation(1) + k.source_ref(1) + k.span(1) +
  // top-level source_refs[0](1) = 14. (PARTIAL => summary null.)
  assert.equal(n, 14, `walk must count 14 public records (got ${n})`);
  // Scalars/arrays are not records: the walk of a refusal (report null)
  // counts zero.
  assert.equal(countFinalEnvelopeRecords({ report: null, source_refs: [], diagnostics: [], quarantined_sources: [] }), 0);
});

test("RA652-004: walk is cycle-safe (shared references counted once)", () => {
  const shared = { repo: "r", path: "p.json" };
  const env = {
    report: { claims: [], coverage: { state: "X" }, summary: null },
    source_refs: [shared, shared],
    diagnostics: [],
    quarantined_sources: [],
  };
  // report(1) + coverage(1) + shared source_ref(1, once) = 3.
  assert.equal(countFinalEnvelopeRecords(env), 3);
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  const env2 = { report: { claims: [cyclic], coverage: null, summary: null }, source_refs: [], diagnostics: [], quarantined_sources: [] };
  assert.ok(Number.isFinite(countFinalEnvelopeRecords(env2)), "cyclic envelope must terminate");
});

test("output prefill: 256 records allowed through the actual public run", () => {
  // RA652-004: the 256/257 boundary is exercised through the real run()
  // path with the real final-envelope walk — not an isolated counter.
  const claims = [{
    claim_id: "c1", atoms: [REV_ALPHA],
    origin_passage_refs: [{ doc_id: "doc-alpha", passage_id: "p1" }],
  }];
  const natural = countFinalEnvelopeRecords(run(taskFor("single-passage", claims), ctxFor("single-passage")));
  assert.ok(natural > 0 && natural < 256, `natural record count must be within bounds (got ${natural})`);
  const r = run(taskFor("single-passage", claims), ctxFor("single-passage", {
    test_hooks: { prefill_output_records: 256 - natural },
  }));
  // 256 total: allowed.
  assert.equal(r.status, "REPORT_READY");
  assert.notEqual(r.report, null);
  assert.equal(countFinalEnvelopeRecords(r), natural, "the walk — not the prefill — counts the envelope");
});

test("output prefill: 257 records refused with report:null through the actual public run", () => {
  const claims = [{
    claim_id: "c1", atoms: [REV_ALPHA],
    origin_passage_refs: [{ doc_id: "doc-alpha", passage_id: "p1" }],
  }];
  const natural = countFinalEnvelopeRecords(run(taskFor("single-passage", claims), ctxFor("single-passage")));
  const r = run(taskFor("single-passage", claims), ctxFor("single-passage", {
    test_hooks: { prefill_output_records: 257 - natural },
  }));
  // 257 total: refused with report:null.
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
