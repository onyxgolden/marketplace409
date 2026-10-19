/** execution-addendum.test.js — contract regression probes for the
 * Research Agent: descriptor safety, grant-before-bytes, population
 * completeness, and budget-integrated admission, as runtime tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { validateDate, SchemaError } from "../src/schemas.js";
import { isRealInstant } from "../src/canonical.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function ctxFor(bundle, overrides = {}) {
  const ref = store.bundleRefs[bundle];
  const key = `${ref.repo}|${ref.path}`;
  return {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    provenance_registry: {},
    ...overrides,
  };
}
function taskFor(bundle, claims = []) {
  const ref = store.bundleRefs[bundle];
  const n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  return {
    schema_version: "1", task_id: "addendum-test", operation: "analyze",
    fixture_refs: { evidence_bundle: ref },
    options: {
      population: { declared_total: n, complete: true },
      requested_claims: claims,
    },
  };
}
const REV = { subject: "ACME-CORP", predicate: "q3-revenue", value: 1200000, value_type: "number", scope: "fy-2026-q3", polarity: "positive" };

test("instant 2026-02-30T00:00:00Z is rejected (no normalization)", () => {
  assert.equal(isRealInstant("2026-02-30T00:00:00Z"), false);
  assert.equal(isRealInstant("2026-01-15T00:00:00Z"), true);
});

test("malformed principal valid_from refuses INVALID_INPUT", () => {
  assert.throws(() => validateDate("2026-02-30", "t"), SchemaError);
});

test("getter beyond the budget is never invoked (task-side sentinel)", () => {
  const task = taskFor("single-passage");
  let invoked = 0;
  const evil = {};
  Object.defineProperty(evil, "claim_id", { get() { invoked++; return "evil"; }, enumerable: true });
  const claims = Array.from({ length: 11 }, (_, i) => ({
    claim_id: `c${i}`, atoms: [REV], origin_passage_refs: [],
  }));
  claims.push(evil);
  task.options.requested_claims = claims;
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED" || d.code === "INVALID_INPUT"));
  assert.equal(invoked, 0, "getter beyond the budget must never fire");
});

test("accessor property on task root is rejected", () => {
  const task = taskFor("single-passage");
  Object.defineProperty(task, "evil", { get() { return 1; }, enumerable: true });
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
});

test("denied grant never reads revision text (byte canary)", () => {
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  const text = store.sources[key].revisions[ref.commit].text;
  const evilText = text.replace("ACME-CORP", "CANARY-CORP");
  const ctx = ctxFor("single-passage", {
    sources: { [key]: { revisions: { [ref.commit]: { text: evilText, blob: ref.blob, label: "v1", expected_records: 1 } } } },
    readGrants: [],
  });
  const r = run(taskFor("single-passage"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "READ_DENIED"));
});

test("fabricated revision label is rejected (tuple spoof)", () => {
  const ref = { ...store.bundleRefs["single-passage"], revision: "v9" };
  const task = taskFor("single-passage");
  task.fixture_refs.evidence_bundle = ref;
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "SOURCE_UNVERIFIED"));
});

test("empty fixture with incomplete population is not complete", () => {
  const task = taskFor("empty");
  task.options.population.complete = false;
  const r = run(task, ctxFor("empty"));
  assert.equal(r.status, "EMPTY");
  assert.equal(r.complete, false);
  assert.equal(r.report.coverage.state, "UNKNOWN_EMPTY");
});

test("quarantined-away origin is not complete:true", () => {
  const r = run(taskFor("quarantine-origin", [{
    claim_id: "c1", atoms: [REV],
    origin_passage_refs: [{ doc_id: "doc-inj", passage_id: "p1" }],
  }]), ctxFor("quarantine-origin"));
  assert.equal(r.complete, false);
  assert.ok(r.quarantined_sources.length > 0);
});

test("PARTIAL results are never complete:true", () => {
  const r = run(taskFor("contradiction", [{
    claim_id: "c1", atoms: [REV],
    origin_passage_refs: [{ doc_id: "doc-a", passage_id: "p1" }],
  }]), ctxFor("contradiction"));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.complete, false);
});

test("prototype-polluted claim is rejected", () => {
  const task = taskFor("single-passage");
  const evil = JSON.parse(`{"claim_id": "c1", "atoms": [], "origin_passage_refs": [], "__proto__": {"polluted": true}}`);
  task.options.requested_claims = [evil];
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
});

test("deeply nested task beyond depth 32 refuses", () => {
  const task = taskFor("single-passage");
  let deep = { claim_id: "c1", atoms: [REV], origin_passage_refs: [] };
  for (let i = 0; i < 40; i++) deep = { nest: deep };
  task.options.requested_claims = [deep];
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT" || d.code === "BUDGET_EXCEEDED"));
});
