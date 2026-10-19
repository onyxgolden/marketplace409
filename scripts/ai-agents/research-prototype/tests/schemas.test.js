/** schemas.test.js — runtime validation: closed schemas, descriptor
 * safety, prototype rejection, and research-specific shapes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateTask, validateContext, validateDocumentRecord, validateAtom,
  renderAssertionText, splitTopLevelArray, admitGraph, assertNoAccessors,
  SchemaError,
} from "../src/schemas.js";
import { makeBudget, BudgetError } from "../src/resolver.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function goodTask() {
  const ref = store.bundleRefs["single-passage"];
  return {
    schema_version: "1", task_id: "t1", operation: "analyze",
    fixture_refs: { evidence_bundle: { ...ref } },
    options: {
      population: { declared_total: 1, complete: true },
      requested_claims: [{
        claim_id: "c1",
        atoms: [{ subject: "S", predicate: "p", value: 1, value_type: "number", scope: "s", polarity: "positive" }],
        origin_passage_refs: [{ doc_id: "doc-alpha", passage_id: "p1" }],
      }],
    },
  };
}
function goodContext() {
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  return {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    provenance_registry: { "doc-alpha|p1": { provenance_group_id: "g", derivation_links: [] } },
  };
}

test("validateTask accepts a well-formed task", () => {
  const t = validateTask(goodTask(), makeBudget());
  assert.equal(t.task_id, "t1");
  assert.equal(t.kind, "analyze");
  assert.equal(t.requested_claims.length, 1);
});

test("validateTask rejects unknown operation as prohibited (not a throw)", () => {
  const task = goodTask();
  task.operation = "delete";
  const t = validateTask(task, makeBudget());
  assert.equal(t.kind, "prohibited");
});

test("validateTask rejects unknown top-level property", () => {
  const task = goodTask();
  task.extra = 1;
  assert.throws(() => validateTask(task, makeBudget()), SchemaError);
});

test("validateTask rejects bad value_type", () => {
  const task = goodTask();
  task.options.requested_claims[0].atoms[0].value_type = "decimal";
  assert.throws(() => validateTask(task, makeBudget()), SchemaError);
});

test("validateTask rejects nonfinite number value", () => {
  const task = goodTask();
  task.options.requested_claims[0].atoms[0].value = NaN;
  assert.throws(() => validateTask(task, makeBudget()), SchemaError);
});

test("validateTask rejects duplicate claim ids", () => {
  const task = goodTask();
  task.options.requested_claims.push(task.options.requested_claims[0]);
  assert.throws(() => validateTask(task, makeBudget()), SchemaError);
});

test("validateTask rejects too many atoms", () => {
  const task = goodTask();
  task.options.requested_claims[0].atoms = Array.from({ length: 65 }, () => ({
    subject: "S", predicate: "p", value: 1, value_type: "number", scope: "s", polarity: "positive",
  }));
  assert.throws(() => validateTask(task, makeBudget()), SchemaError);
});

test("validateContext accepts a well-formed context", () => {
  const c = validateContext(goodContext(), makeBudget());
  assert.equal(c.principal.principal_id, "jason");
  assert.equal(c.provenance_registry["doc-alpha|p1"].provenance_group_id, "g");
});

test("validateContext rejects unknown context property", () => {
  const ctx = goodContext();
  ctx.extra = 1;
  assert.throws(() => validateContext(ctx, makeBudget()), SchemaError);
});

test("validateContext rejects bad provenance registry key", () => {
  const ctx = goodContext();
  ctx.provenance_registry = { "bad key": { provenance_group_id: "g", derivation_links: [] } };
  assert.throws(() => validateContext(ctx, makeBudget()), SchemaError);
});

test("validateContext rejects bad derivation link kind", () => {
  const ctx = goodContext();
  ctx.provenance_registry["doc-alpha|p1"].derivation_links = [{ from_doc: "d", from_passage: "p", kind: "forked" }];
  assert.throws(() => validateContext(ctx, makeBudget()), SchemaError);
});

test("validateContext accepts absent test_hooks; rejects bad prefill", () => {
  const c = validateContext(goodContext(), makeBudget());
  assert.equal(c.test_hooks, undefined);
  const ctx = goodContext();
  ctx.test_hooks = { prefill_output_records: -1 };
  assert.throws(() => validateContext(ctx, makeBudget()), SchemaError);
  const ctx2 = goodContext();
  ctx2.test_hooks = { prefill_output_records: 255 };
  assert.equal(validateContext(ctx2, makeBudget()).test_hooks.prefill_output_records, 255);
});

test("admitGraph rejects accessor properties without invoking them", () => {
  let invoked = 0;
  const evil = {};
  Object.defineProperty(evil, "x", { get() { invoked++; return 1; }, enumerable: true });
  assert.throws(() => admitGraph({ a: evil }, "t", makeBudget()), SchemaError);
  assert.equal(invoked, 0);
});

test("admitGraph rejects custom prototypes", () => {
  class Foo { }
  assert.throws(() => admitGraph(new Foo(), "t", makeBudget()), SchemaError);
});

test("admitGraph refuses candidate 65 without touching it", () => {
  const objs = Array.from({ length: 70 }, (_, i) => ({ i }));
  assert.throws(() => admitGraph({ list: objs }, "t", makeBudget()), (e) => e instanceof BudgetError);
});

test("splitTopLevelArray yields raw spans without decoding", () => {
  const spans = splitTopLevelArray(`[{"a":1}, {"b":2}]`, "t");
  assert.equal(spans.length, 2);
  assert.equal(spans[0].text, `{"a":1}`);
  assert.ok(spans[1].startByte > spans[0].endByte);
});

test("splitTopLevelArray rejects non-arrays and trailing content", () => {
  assert.throws(() => splitTopLevelArray(`{"a":1}`, "t"), SchemaError);
  assert.throws(() => splitTopLevelArray(`[1],`, "t"), SchemaError);
  assert.throws(() => splitTopLevelArray(`[1,]`, "t"), SchemaError);
});

test("validateDocumentRecord rejects duplicate passage ids", () => {
  const docs = JSON.parse(store.sources["research-sources|bundles/duplicate-passage.json"].revisions[store.bundleRefs["duplicate-passage"].commit].text);
  assert.throws(() => validateDocumentRecord(docs[0], "t", makeBudget()), SchemaError);
});

test("validateAtom enforces typed values", () => {
  assert.throws(() => validateAtom({ subject: "S", predicate: "p", value: "1", value_type: "number", scope: "s", polarity: "positive" }, "t"), SchemaError);
  const a = validateAtom({ subject: "S", predicate: "p", value: "1", value_type: "string", scope: "s", polarity: "positive" }, "t");
  assert.equal(a.value, "1");
});

test("assertNoAccessors rejects nonenumerable getters", () => {
  const o = {};
  Object.defineProperty(o, "hidden", { get() { return 1; }, enumerable: false });
  assert.throws(() => assertNoAccessors(o, "t"), SchemaError);
});
