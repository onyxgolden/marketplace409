/**
 * battery.test.js — the frozen 52-case battery. Each case's expected output
 * was authored by the independent oracle (corpus/oracle.js); this test
 * asserts the implementation reproduces it exactly (declared expected-field
 * match, 100%), plus invariant checks: watermark present, no PII canaries
 * echoed, statuses within the brief's enum.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStore, loadBattery, makeContext, run, CLOCK } from "./harness.js";
import { WATERMARK } from "../src/index.js";

const CANARIES = ["SYNTHETIC-CANARY-7f2a91c4", "SYNTHETIC-CANARY-b81c0e55"];
const STATUSES = new Set(["ASSEMBLED", "PARTIAL", "BLOCKED", "REFUSED"]);

test("battery: 52 frozen cases, exact expected match", (t) => {
  const store = loadStore();
  const battery = loadBattery();
  assert.equal(battery.cases.length, 52, "battery must hold 12 named + 40 variants");
  const seen = new Set();
  for (const c of battery.cases) {
    assert.ok(c.case_id && !seen.has(c.case_id), `duplicate case ${c.case_id}`);
    seen.add(c.case_id);
    const ctx = makeContext(store);
    const actual = run(c.input.task, { ...ctx, clock: c.input.clock || CLOCK });
    assert.deepStrictEqual(actual, c.expected, `case ${c.case_id} diverged from frozen expected`);
  }
});

test("battery: every result carries the watermark and a valid status", () => {
  const store = loadStore();
  const battery = loadBattery();
  for (const c of battery.cases) {
    const actual = run(c.input.task, makeContext(store));
    assert.equal(actual.watermark, WATERMARK, `${c.case_id}: watermark`);
    assert.ok(STATUSES.has(actual.status), `${c.case_id}: status ${actual.status}`);
    assert.equal(actual.advisory, true);
    assert.equal(actual.fixture_only, true);
  }
});

test("battery: zero PII canaries echoed in any output", () => {
  const store = loadStore();
  const battery = loadBattery();
  for (const c of battery.cases) {
    const actual = run(c.input.task, makeContext(store));
    const blob = JSON.stringify(actual);
    for (const canary of CANARIES) {
      assert.ok(!blob.includes(canary), `${c.case_id}: canary leaked into output`);
    }
  }
});

test("battery: case ids cover the 12 named fixtures and 40 variants", () => {
  const battery = loadBattery();
  const ids = battery.cases.map((c) => c.case_id).sort();
  const named = Array.from({ length: 12 }, (_, i) => `fm-${String(i + 1).padStart(2, "0")}`).sort();
  const variants = Array.from({ length: 40 }, (_, i) => `fm-v${String(i + 1).padStart(2, "0")}`).sort();
  assert.deepStrictEqual(ids, [...named, ...variants].sort());
});
