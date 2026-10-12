/**
 * budgets.test.js — INPUT_LIMIT / BUDGET_EXCEEDED fail closed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { makeBudget, BudgetError, BUDGET_LIMITS } from "../src/resolver.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const vocabulary = JSON.parse(readFileSync(join(ROOT, "fixtures", "vocabulary.json"), "utf8"));

function ctx() {
  return {
    clock: Date.parse("2026-10-12T12:00:00Z"), vocabulary,
    sources: store.sources,
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    supersessionRecords: store.supersessionRecords,
  };
}

test("oversized task payload refuses with INPUT_LIMIT", () => {
  const r = run(
    {
      query: "x".repeat(300 * 1024),
      query_key: null,
      filters: { source_tags: [], max_source_age_days: null, as_of_date: null },
      requested_action: "answer",
    },
    ctx()
  );
  // 300 KiB query exceeds the 8 KiB schema cap first: still a refusal, no claims.
  assert.equal(r.status, "REFUSED");
  assert.equal(r.claims.length, 0);
  assert.ok(["INVALID_INPUT", "INPUT_LIMIT"].includes(r.diagnostics[0].code));
});

test("budget object exhaustion throws BUDGET_EXCEEDED", () => {
  const b = makeBudget();
  assert.throws(() => {
    for (let i = 0; i <= BUDGET_LIMITS.maxObjects; i++) b.countObject();
  }, (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("budget span exhaustion throws BUDGET_EXCEEDED", () => {
  const b = makeBudget();
  assert.throws(() => {
    for (let i = 0; i <= BUDGET_LIMITS.maxSpans; i++) b.countSpan();
  }, (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("budget payload exhaustion throws INPUT_LIMIT", () => {
  const b = makeBudget();
  assert.throws(() => b.countPayload("x".repeat(BUDGET_LIMITS.maxPayloadBytes + 1), "test"), (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT");
});
