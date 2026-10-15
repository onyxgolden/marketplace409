/**
 * budgets.test.js — the budget model fails closed: oversize payloads and
 * exhausted resolution/span budgets raise BudgetError with the contract's
 * fixed codes, and the entrypoint converts them to structured denials.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeBudget, BudgetError, BUDGET_LIMITS } from "../src/resolver.js";

test("payload over 256 KiB raises INPUT_LIMIT", () => {
  const b = makeBudget();
  assert.throws(() => b.countPayload(BUDGET_LIMITS.maxInputBytes + 1, "x"), (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT");
});

test("payload at exactly the limit is accepted", () => {
  const b = makeBudget();
  b.countPayload(BUDGET_LIMITS.maxInputBytes, "x");
});

test("resolution budget exhaustion raises BUDGET_EXCEEDED", () => {
  const b = makeBudget();
  for (let i = 0; i < BUDGET_LIMITS.maxObjectResolutions; i++) b.countResolution(`r${i}`);
  assert.throws(() => b.countResolution("one-too-many"), (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("span budget exhaustion raises BUDGET_EXCEEDED", () => {
  const b = makeBudget();
  for (let i = 0; i < BUDGET_LIMITS.maxEvidenceSpans; i++) b.countSpan(`s${i}`);
  assert.throws(() => b.countSpan("one-too-many"), (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("cumulative input bytes: exact limit accepted, +1 refused (PM-004)", () => {
  const b = makeBudget();
  b.countInputBytes(BUDGET_LIMITS.maxInputBytes - 100, "a");
  b.countInputBytes(100, "b"); // exactly at the cap
  assert.throws(() => b.countInputBytes(1, "c"), (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT");
});

test("cumulative input bytes accumulate across consultations (PM-004)", () => {
  const b = makeBudget();
  b.countInputBytes(100000, "task");
  b.countInputBytes(100000, "case");
  assert.throws(() => b.countInputBytes(100000, "notes"), (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT");
  assert.equal(b.used.inputBytes, 200000);
});

test("source ledger dedupes and sorts deterministically (PM-005)", () => {
  const b = makeBudget();
  const refB = { repo: "r", path: "b.json", commit: "c", blob: "d", algorithm: "git-sha1", revision: "v1" };
  const refA = { repo: "r", path: "a.json", commit: "c", blob: "d", algorithm: "git-sha1", revision: "v1" };
  b.addSource(refB, Buffer.from("x"));
  b.addSource(refA, Buffer.from("y"));
  b.addSource(refB, Buffer.from("x")); // duplicate
  const refs = b.sourceRefs();
  assert.equal(refs.length, 2);
  assert.equal(refs[0].path, "a.json");
  assert.equal(refs[1].path, "b.json");
});

test("contract limits match the common contract", () => {
  assert.equal(BUDGET_LIMITS.maxInputBytes, 256 * 1024);
  assert.equal(BUDGET_LIMITS.maxSourceObjects, 64);
  assert.equal(BUDGET_LIMITS.maxEvidenceSpans, 512);
  assert.equal(BUDGET_LIMITS.maxOutputRecords, 256);
  assert.equal(BUDGET_LIMITS.maxOutputBytes, 256 * 1024);
  assert.equal(BUDGET_LIMITS.maxObjectResolutions, 64);
  assert.equal(BUDGET_LIMITS.maxSpanChecks, 512);
});
