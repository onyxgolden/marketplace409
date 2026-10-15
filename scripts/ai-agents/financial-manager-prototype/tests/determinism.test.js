/**
 * determinism.test.js — repeat runs are byte-identical under the fixed
 * injected context. No wall-clock, randomness, or iteration-order effects
 * may leak into results.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStore, loadBattery, makeContext, run } from "./harness.js";

test("determinism: repeat runs byte-identical (rational-heavy case)", () => {
  const store = loadStore();
  const ctx = makeContext(store);
  const task = {
    task_id: "t",
    bundle_refs: [store.fixtures["fm-06"].source_ref],
    period_ids: [],
    requested_action: "assemble_draft",
  };
  const a = JSON.stringify(run(task, ctx));
  const b = JSON.stringify(run(task, makeContext(store)));
  assert.equal(a, b);
});

test("determinism: multi-section rollup byte-identical", () => {
  const store = loadStore();
  const task = {
    task_id: "t",
    bundle_refs: [store.fixtures["fm-12"].source_ref],
    period_ids: [],
    requested_action: "assemble_draft",
  };
  const runs = Array.from({ length: 5 }, () => JSON.stringify(run(task, makeContext(store))));
  for (const r of runs) assert.equal(r, runs[0]);
});

test("determinism: full battery byte-identical across two passes", () => {
  const store = loadStore();
  const battery = loadBattery();
  const pass = () =>
    battery.cases.map((c) => JSON.stringify(run(c.input.task, makeContext(store)))).join("\n");
  assert.equal(pass(), pass());
});

test("determinism: diagnostics ordering stable", () => {
  const store = loadStore();
  // fm-v39 yields MISSING_LABELS among section diagnostics; fm-03 narrative mismatch
  for (const fid of ["fm-v39", "fm-03", "fm-v32"]) {
    const task = {
      task_id: "t",
      bundle_refs: [store.fixtures[fid].source_ref],
      period_ids: [],
      requested_action: "assemble_draft",
    };
    const a = JSON.stringify(run(task, makeContext(store)).diagnostics);
    const b = JSON.stringify(run(task, makeContext(store)).diagnostics);
    assert.equal(a, b, fid);
  }
});
