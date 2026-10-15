/**
 * schemas.test.js — malformed task/context shapes yield structured
 * REFUSED denials, never exceptions or default success.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { loadStore, baseContext, taskFor, diagCodes } from "./testutil.js";

const store = loadStore();

function refusedWith(result, code) {
  assert.equal(result.status, "REFUSED");
  assert.ok(diagCodes(result).includes(code), `expected ${code}, got ${diagCodes(result)}`);
}

test("unknown task property is rejected", () => {
  const t = taskFor(store, "SYN-CASE-001");
  t.bogus = 1;
  refusedWith(run(t, baseContext()), "INVALID_INPUT");
});

test("unknown case_ref property is rejected", () => {
  const t = taskFor(store, "SYN-CASE-001");
  t.case_ref.extra = "x";
  refusedWith(run(t, baseContext()), "INVALID_INPUT");
});

test("invalid workflow enum is rejected", () => {
  const t = taskFor(store, "SYN-CASE-001");
  t.workflow = "plumbing";
  refusedWith(run(t, baseContext()), "INVALID_INPUT");
});

test("non-SYN case_id is rejected", () => {
  const t = taskFor(store, "SYN-CASE-001");
  t.case_ref.case_id = "CASE-001";
  refusedWith(run(t, baseContext()), "INVALID_INPUT");
});

test("malformed commit hex is rejected", () => {
  const t = taskFor(store, "SYN-CASE-001");
  t.case_ref.commit = "zzz";
  refusedWith(run(t, baseContext()), "INVALID_INPUT");
});

test("empty property scope is rejected", () => {
  const t = taskFor(store, "SYN-CASE-001");
  t.context_filters.property_fixture_ids = [];
  refusedWith(run(t, baseContext()), "INVALID_INPUT");
});

test("duplicate property scope ids are rejected", () => {
  const t = taskFor(store, "SYN-CASE-001");
  t.context_filters.property_fixture_ids = ["SYN-PROP-01", "SYN-PROP-01"];
  refusedWith(run(t, baseContext()), "INVALID_INPUT");
});

test("unknown requested_action is unsupported, not guessed", () => {
  const t = taskFor(store, "SYN-CASE-001");
  t.requested_action = "frobnicate";
  refusedWith(run(t, baseContext()), "UNSUPPORTED_TASK");
});

test("non-finite clock is rejected", () => {
  const ctx = baseContext();
  ctx.clock = NaN;
  refusedWith(run(taskFor(store, "SYN-CASE-001"), ctx), "INVALID_INPUT");
});

test("unknown context property is rejected", () => {
  const ctx = baseContext();
  ctx.extra = true;
  refusedWith(run(taskFor(store, "SYN-CASE-001"), ctx), "INVALID_INPUT");
});

test("null task is rejected without throwing", () => {
  const r = run(null, baseContext());
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCodes(r).includes("INVALID_INPUT"));
});
