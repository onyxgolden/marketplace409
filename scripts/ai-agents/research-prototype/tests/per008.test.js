/**
 * per008.test.js — PER-008 round 2 focused tests: the CHARGED own-data
 * admission primitive for every consulted host object/array.
 *
 * Covers the verdict's exact probes (inherited principal getter,
 * inherited revisions getter, nested applies_to Proxy, nested
 * derivation-link Proxy) through run(), the admitHostObject unit
 * contract (trap-free Proxy rejection, charge-before-inspection,
 * prototype rejection, own-data reads, exact-64 fit / 65th-refuses),
 * and the round-1 task candidate-65 proof (kept intact).
 *
 * Hostile fixtures (native Proxy, inherited getters) cannot cross
 * the JSON guarded transport, so probe tests run through run()
 * in-process; plain positives are additionally exercised through
 * runGuarded().
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { admitHostObject, ownData, SchemaError } from "../src/schemas.js";
import { makeBudget, BudgetError } from "../src/resolver.js";
import { runGuarded } from "../runner/run-guarded.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
const byId = new Map(battery.filter((c) => c.case_id).map((c) => [c.case_id, c]));

function cloneBase(id) {
  const b = byId.get(id);
  assert.ok(b && b.task, `base case ${id} resolves`);
  return { task: structuredClone(b.task), context: structuredClone(b.context) };
}

function refusedInvalidInput(r) {
  assert.equal(r.status, "REFUSED");
  assert.equal(r.complete, false);
  assert.equal(r.report, null);
  assert.ok((r.diagnostics ?? []).some((d) => d.code === "INVALID_INPUT"), "INVALID_INPUT diagnostic");
}

// ---------- verdict probe 1: inherited principal getter ----------
test("PER-008r2: inherited principal_id getter refuses with ZERO getter calls (run)", () => {
  const { task, context } = cloneBase("nom-002-single-attributed");
  const pid = context.principal.principal_id;
  let calls = 0;
  const proto = { ...context.principal };
  Object.defineProperty(proto, "principal_id", {
    enumerable: true,
    get() { calls++; return pid; },
  });
  context.principal = Object.create(proto);
  const r = run(task, context);
  refusedInvalidInput(r);
  assert.equal(calls, 0, "inherited principal_id getter must never fire");
});

// ---------- verdict probe 2: inherited revisions getter ----------
test("PER-008r2: inherited source revisions getter refuses with ZERO getter calls (run)", () => {
  const { task, context } = cloneBase("nom-002-single-attributed");
  const key = Object.keys(context.sources)[0];
  const entry = context.sources[key];
  let calls = 0;
  const prot = {};
  Object.defineProperty(prot, "revisions", {
    enumerable: true,
    get() { calls++; return entry.revisions; },
  });
  context.sources[key] = Object.create(prot);
  const r = run(task, context);
  refusedInvalidInput(r);
  assert.equal(calls, 0, "inherited revisions getter must never fire");
});

// ---------- verdict probe 3: nested applies_to Proxy ----------
test("PER-008r2: nested applies_to Proxy refuses with ZERO traps (run)", () => {
  const { task, context } = cloneBase("nom-002-single-attributed");
  let traps = 0;
  const key = Object.keys(context.provenance_registry)[0];
  context.provenance_registry[key].applies_to = new Proxy(context.provenance_registry[key].applies_to, {
    get(t, k, recv) { traps++; return Reflect.get(t, k, recv); },
    getOwnPropertyDescriptor(t, k) { traps++; return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  const r = run(task, context);
  refusedInvalidInput(r);
  assert.equal(traps, 0, "no Proxy trap may fire during admission");
});

// ---------- verdict probe 4: nested derivation-link Proxy ----------
test("PER-008r2: nested derivation_links Proxy refuses with ZERO traps (run)", () => {
  const { task, context } = cloneBase("nom-018-derivation-link");
  let traps = 0;
  const key = Object.keys(context.provenance_registry).find((k) => (context.provenance_registry[k].derivation_links ?? []).length > 0)
    ?? Object.keys(context.provenance_registry)[0];
  context.provenance_registry[key].derivation_links = new Proxy(context.provenance_registry[key].derivation_links ?? [], {
    get(t, k, recv) { traps++; return Reflect.get(t, k, recv); },
    getOwnPropertyDescriptor(t, k) { traps++; return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  const r = run(task, context);
  refusedInvalidInput(r);
  assert.equal(traps, 0, "no Proxy trap may fire during admission");
});

// ---------- plain positives stay valid (run + runGuarded) ----------
test("PER-008r2: plain own-data positive stays REPORT_READY (run and runGuarded)", async () => {
  const { task, context } = cloneBase("nom-002-single-attributed");
  const r = run(task, context);
  assert.equal(r.status, "REPORT_READY");
  const g = await runGuarded(JSON.stringify(task), JSON.stringify(context));
  assert.equal(g.status, "REPORT_READY");
});

test("PER-008r2: null-prototype maps stay valid (run)", () => {
  const { task, context } = cloneBase("nom-002-single-attributed");
  const np = Object.create(null);
  for (const [k, v] of Object.entries(context.provenance_registry)) np[k] = v;
  context.provenance_registry = np;
  const r = run(task, context);
  assert.equal(r.status, "REPORT_READY");
});

// ---------- admitHostObject unit contract ----------
test("PER-008r2: admitHostObject rejects native Proxy BEFORE any reflective op", () => {
  const budget = makeBudget();
  let traps = 0;
  const p = new Proxy({ a: 1 }, {
    get(t, k, r) { traps++; return Reflect.get(t, k, r); },
    getPrototypeOf(t) { traps++; return Reflect.getPrototypeOf(t); },
    getOwnPropertyDescriptor(t, k) { traps++; return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  assert.throws(() => admitHostObject(p, "w", budget), SchemaError);
  assert.equal(traps, 0, "trap-free detection first");
});

test("PER-008r2: admitHostObject rejects custom prototypes (no own-data reads)", () => {
  const budget = makeBudget();
  class Custom { constructor() { this.a = 1; } }
  assert.throws(() => admitHostObject(new Custom(), "w", budget), SchemaError);
  assert.throws(() => admitHostObject(Object.create({ inherited: 1 }), "w", budget), SchemaError);
  // plain and null-prototype pass
  assert.deepEqual(admitHostObject({ a: 1 }, "w", budget), { a: 1 });
  const npAdmitted = admitHostObject(Object.assign(Object.create(null), { a: 1 }), "w", budget);
  assert.equal(npAdmitted.a, 1);
  assert.equal(Object.getPrototypeOf(npAdmitted), null);
  // arrays require the array flag
  assert.throws(() => admitHostObject([1], "w", budget), SchemaError);
  assert.deepEqual(admitHostObject([1], "w", budget, { array: true }), [1]);
});

test("PER-008r2: admitHostObject rejects accessor control fields without invoking them", () => {
  const budget = makeBudget();
  let calls = 0;
  const hostile = {};
  Object.defineProperty(hostile, "a", { enumerable: true, get() { calls++; return 1; } });
  assert.throws(() => admitHostObject(hostile, "w", budget), SchemaError);
  assert.equal(calls, 0, "accessor must never fire");
  // symbol keys rejected
  const sym = { a: 1, [Symbol("s")]: 2 };
  assert.throws(() => admitHostObject(sym, "w", budget), SchemaError);
});

test("PER-008r2: admitHostObject charges exactly once per object (exact-64 fit, 65th refuses)", () => {
  const budget = makeBudget();
  for (let i = 0; i < 64; i++) admitHostObject({ i }, `w[${i}]`, budget);
  assert.throws(() => admitHostObject({ over: true }, "w[64]", budget), BudgetError);
  // idempotent: re-admitting an already-charged object costs nothing
  const budget2 = makeBudget();
  const shared = { a: 1 };
  for (let i = 0; i < 64; i++) admitHostObject(shared, `w[${i}]`, budget2);
  // 64 admissions of the SAME object cost 1 — 63 further distinct
  // objects still fit, the 65th distinct object refuses.
  for (let i = 0; i < 63; i++) admitHostObject({ i }, `w2[${i}]`, budget2);
  assert.throws(() => admitHostObject({ over: true }, "w2[63]", budget2), BudgetError);
});

test("PER-008r2: ownData reads only own data descriptors (inherited fields invisible)", () => {
  const proto = { inherited: 1 };
  const o = Object.create(proto);
  o.own = 2;
  assert.equal(ownData(o, "own", "w"), 2);
  assert.throws(() => ownData(o, "inherited", "w"), SchemaError);
  assert.throws(() => ownData(o, "missing", "w"), SchemaError);
});

// ---------- round-1 task candidate-65 proof kept intact ----------
test("PER-008r2: round-1 task candidate-65 proof intact (options.padding accessor sentinel)", () => {
  // The task-side admitGraph still refuses at candidate 65 with zero
  // getter calls when options.padding carries an accessor on child 79.
  // In-process run(): JSON serialization would fire the getter in the
  // harness, so (as in round 1) this goes through run(), not runGuarded.
  const { task, context } = cloneBase("nom-002-single-attributed");
  let calls = 0;
  const pad = new Array(80).fill(0).map((_, i) => ({ i }));
  Object.defineProperty(pad[79], "x", { enumerable: true, get() { calls++; return 1; } });
  task.options = { ...task.options, padding: pad };
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.ok((r.diagnostics ?? []).some((d) => d.code === "BUDGET_EXCEEDED"), "BUDGET_EXCEEDED at candidate 65");
  assert.equal(calls, 0, "zero getter calls on the sentinel");
  assert.equal(r.report, null, "no partial domain artifact");
});
