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

function ctx() {
  return {
    clock: Date.parse("2026-06-01T00:00:00Z"),
    registry: store.registry,
    sources: store.sources,
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    reviewRecords: store.reviewRecords,
  };
}
const baseTask = () => ({
  task_id: "demo-budget-1",
  requested_action: "draft_education",
  topic_id: "recordkeeping-basics",
  topic_label: "Recordkeeping Basics",
  jurisdiction: "US-FEDERAL",
  tax_year: 2026,
  as_of_date: "2026-06-01T00:00:00Z",
  mode: "current_education",
  source_refs: [],
});

test("oversized task_id refuses with INVALID_INPUT before any context work", () => {
  const r = run({ ...baseTask(), task_id: "x".repeat(3000) }, ctx());
  assert.equal(r.status, "REFUSED");
  assert.equal(r.claims.length, 0);
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
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

test("consulted-object exhaustion (4200 tiny read grants) refuses with BUDGET_EXCEEDED, no partial draft", () => {
  // Small-schema objects (~50 bytes each) so the 4096-object COUNT limit
  // is hit well before the 256 KiB payload limit — isolates the count
  // budget from the payload budget (reviewRecords' larger shape would
  // trip INPUT_LIMIT first, which is a separate, also-correct fail-closed
  // path exercised in budgets/corpus evidence cases instead).
  const exhaustion = [];
  for (let i = 0; i < 4200; i++) {
    exhaustion.push({ repo: "edu-sources", path: `dummy/g${i}.md` });
  }
  const c = ctx();
  c.readGrants = exhaustion;
  const r = run(baseTask(), c);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.claims.length, 0);
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
});
