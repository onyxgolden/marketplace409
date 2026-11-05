import { test } from "node:test";
import assert from "node:assert/strict";
import { RunBudget } from "../src/budget.js";
import { expectCode } from "./helpers.js";

const LIMITS = { max_items_per_run: 2, max_bytes_per_run: 100, max_tool_calls_per_run: 1 };

test("fits/consume/receipt semantics", () => {
  const b = new RunBudget(LIMITS);
  assert.equal(b.fits("items", 1), true);
  assert.equal(b.fits("items", 3), false);
  b.consumeItem();
  assert.equal(b.used.items, 1);
  b.consumeBytes(60);
  assert.equal(b.fits("bytes", 40), true);
  assert.equal(b.fits("bytes", 41), false);
  b.consumeToolCall();
  assert.equal(b.fits("tool_calls", 1), false);
  assert.deepEqual(b.receipt(), {
    max_items_per_run: 2,
    max_bytes_per_run: 100,
    max_tool_calls_per_run: 1,
    items_used: 1,
    bytes_used: 60,
    tool_calls_used: 1,
  });
});

test("consume past a cap refuses without charging", () => {
  const b = new RunBudget(LIMITS);
  b.consumeItem();
  b.consumeItem();
  expectCode(() => b.consumeItem(), "BUDGET_EXCEEDED");
  assert.equal(b.used.items, 2);
  expectCode(() => b.consumeBytes(101), "BUDGET_EXCEEDED");
  assert.equal(b.used.bytes, 0);
});
