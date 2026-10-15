/**
 * input-budget.test.js — PM-004 regression: every consulted input byte
 * counts against the cumulative 256 KiB cap — task envelope, selected
 * case, notes, permission records, and trust records. Oversized
 * structures are rejected by the bounded preflight before deep
 * validation. (Unit boundary tests live in budgets.test.js.)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { BUDGET_LIMITS } from "../src/resolver.js";
import { loadStore, baseContext, taskFor } from "./testutil.js";

const LIMIT = BUDGET_LIMITS.maxInputBytes;
const clone = (v) => JSON.parse(JSON.stringify(v));

function oversizedContext(mutator) {
  const ctx = baseContext();
  ctx.caseStore = clone(ctx.caseStore);
  ctx.trustRegistry = clone(ctx.trustRegistry);
  mutator(ctx);
  return ctx;
}

test("oversized selected case refuses with INPUT_LIMIT (PM-004)", () => {
  const store = loadStore();
  const ctx = oversizedContext((c) => {
    const cs = c.caseStore.cases.find((x) => x.case_id === "SYN-CASE-001");
    cs.padding = "x".repeat(LIMIT); // consulted case bytes exceed the cap
  });
  const r = run(taskFor(store, "SYN-CASE-001"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
});

test("oversized note refuses with INPUT_LIMIT (PM-004)", () => {
  const store = loadStore();
  const ctx = oversizedContext((c) => {
    c.caseStore.note_texts["SYN-NOTE-001"] = "n".repeat(LIMIT);
  });
  const r = run(taskFor(store, "SYN-CASE-001"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
});

test("oversized permission record refuses with INPUT_LIMIT (PM-004)", () => {
  const store = loadStore();
  const ctx = oversizedContext((c) => {
    const p = c.caseStore.permission_records.find((x) => x.permission_id === "SYN-PERM-MAINT-01");
    p.padding = "p".repeat(LIMIT);
  });
  const r = run(taskFor(store, "SYN-CASE-001"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
});

test("oversized trust registry refuses with INPUT_LIMIT (PM-004)", () => {
  const store = loadStore();
  const ctx = oversizedContext((c) => {
    c.trustRegistry.principals["SYN-ISSUER-JASON"].padding = "t".repeat(LIMIT);
  });
  const r = run(taskFor(store, "SYN-CASE-001"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
});

test("deeply nested context is rejected by the preflight (PM-004)", () => {
  const store = loadStore();
  let deep = { leaf: "x" };
  for (let i = 0; i < 50; i++) deep = { nest: deep };
  const ctx = baseContext();
  ctx.extra = deep;
  const r = run(taskFor(store, "SYN-CASE-001"), ctx);
  // The preflight depth cap fires before deep validation traverses it.
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
});

test("preflight rejects a context that is too wide (PM-004)", () => {
  const store = loadStore();
  const ctx = baseContext();
  ctx.caseStore = clone(ctx.caseStore);
  ctx.caseStore.cases = Array.from({ length: 9000 }, (_, i) => ({ case_id: `SYN-PAD-${i}` }));
  const r = run(taskFor(store, "SYN-CASE-001"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
});

test("normal run stays well under the cumulative cap (PM-004)", () => {
  const store = loadStore();
  const r = run(taskFor(store, "SYN-CASE-001"), baseContext());
  assert.equal(r.status, "PROPOSED");
  assert.equal(r.complete, true);
});
