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

test("contract limits match the common contract", () => {
  assert.equal(BUDGET_LIMITS.maxInputBytes, 256 * 1024);
  assert.equal(BUDGET_LIMITS.maxSourceObjects, 64);
  assert.equal(BUDGET_LIMITS.maxEvidenceSpans, 512);
  assert.equal(BUDGET_LIMITS.maxOutputRecords, 256);
  assert.equal(BUDGET_LIMITS.maxOutputBytes, 256 * 1024);
  assert.equal(BUDGET_LIMITS.maxObjectResolutions, 64);
  assert.equal(BUDGET_LIMITS.maxSpanChecks, 512);
});
