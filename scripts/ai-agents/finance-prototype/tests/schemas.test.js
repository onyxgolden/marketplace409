/** schemas.test.js — validation unit tests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateTask, validateContext, validateTransaction, SchemaError,
} from "../src/schemas.js";
import { makeBudget } from "../src/resolver.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function validTask() {
  return {
    schema_version: "1",
    task_id: "t1",
    operation: "analyze",
    fixture_refs: { transaction_bundle: store.bundleRefs["single-income"] },
    options: {
      population: { declared_total: 1, complete: true },
      period: { start_date: "2026-01-01", end_date: "2026-01-31", opening_balance_minor: "0", currency: "USD" },
      header_claims: {},
    },
  };
}

function validContext() {
  const ref = store.bundleRefs["single-income"];
  const key = `${ref.repo}|${ref.path}`;
  const chartKey = "fin-sources|chart/finance-chart-v1.md";
  return {
    clock: Date.parse("2026-06-01T12:00:00Z"),
    sources: { [chartKey]: store.sources[chartKey], [key]: store.sources[key] },
    readGrants: [
      { repo: "fin-sources", path: "chart/finance-chart-v1.md" },
      { repo: ref.repo, path: ref.path },
    ],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
  };
}

test("validateTask: accepts valid task", () => {
  const v = validateTask(validTask());
  assert.equal(v.kind, "analyze");
  assert.equal(v.period.currency, "USD");
});

test("validateTask: rejects unknown operation field", () => {
  const t = validTask();
  t.operation = "send-payment";
  const v = validateTask(t);
  assert.equal(v.kind, "prohibited");
});

test("validateTask: rejects extra keys", () => {
  const t = validTask();
  t.extra = 1;
  assert.throws(() => validateTask(t), SchemaError);
});

test("validateTask: rejects bad schema version", () => {
  const t = validTask();
  t.schema_version = "2";
  assert.throws(() => validateTask(t), SchemaError);
});

test("validateTask: opening_balance is claimed (parsed, not verified)", () => {
  const t = validTask();
  t.options.period.opening_balance_minor = "-5000";
  const v = validateTask(t);
  assert.equal(v.period.opening_balance_minor, -5000n);
});

test("validateContext: requires a live budget", () => {
  assert.throws(() => validateContext(validContext(), null), /requires a live budget/);
  assert.throws(() => validateContext(validContext(), {}), /requires a live budget/);
});

test("validateContext: charges context candidates", () => {
  const budget = makeBudget();
  const before = budget.used.objects;
  validateContext(validContext(), budget);
  // 2 sources + 2 revisions + 2 grants + principal + criteria = 8
  assert.equal(budget.used.objects - before, 8);
});

test("validateContext: rejects missing clock", () => {
  const c = validContext();
  delete c.clock;
  assert.throws(() => validateContext(c, makeBudget()), SchemaError);
});

test("validateTransaction: accepts valid", () => {
  const v = validateTransaction({
    transaction_id: "txn-1", date: "2026-01-15", account_code: "REV001",
    direction: "IN", amount_minor: "10000", currency: "USD",
  }, "t");
  assert.equal(v.amount_minor, 10000n);
});

test("validateTransaction: TRANSFER requires pair id", () => {
  assert.throws(() => validateTransaction({
    transaction_id: "txn-1", date: "2026-01-15", account_code: "TRF001",
    direction: "TRANSFER", amount_minor: "100", currency: "USD",
  }, "t"), /transfer_pair_id/);
});

test("validateTransaction: invoice fields all-or-nothing", () => {
  assert.throws(() => validateTransaction({
    transaction_id: "txn-1", date: "2026-01-15", account_code: "REV001",
    direction: "IN", amount_minor: "100", currency: "USD", quantity: "2",
  }, "t"), /must appear together/);
});

test("validateTransaction: rejects negative tax rate", () => {
  assert.throws(() => validateTransaction({
    transaction_id: "txn-1", date: "2026-01-15", account_code: "REV001",
    direction: "IN", amount_minor: "100", currency: "USD",
    quantity: "1", unit_price_minor: "100", tax_rate: "-0.05",
  }, "t"), /must not be negative/);
});

test("validateTransaction: rejects malformed amount", () => {
  assert.throws(() => validateTransaction({
    transaction_id: "txn-1", date: "2026-01-15", account_code: "REV001",
    direction: "IN", amount_minor: "10.5", currency: "USD",
  }, "t"), SchemaError);
});

test("validateTransaction: rejects invalid date", () => {
  assert.throws(() => validateTransaction({
    transaction_id: "txn-1", date: "2026-02-30", account_code: "REV001",
    direction: "IN", amount_minor: "100", currency: "USD",
  }, "t"), /not a real calendar date/);
});
