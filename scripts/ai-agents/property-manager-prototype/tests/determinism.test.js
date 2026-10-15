/**
 * determinism.test.js — repeat runs under a fixed clock are byte-identical;
 * returned objects are detached snapshots (caller mutation cannot affect
 * fixtures, history, or future runs).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { run, canonicalJson } from "../src/index.js";
import { loadStore, baseContext, taskFor } from "./testutil.js";

const store = loadStore();

test("repeat runs are byte-identical under a fixed clock", () => {
  const t = taskFor(store, "SYN-CASE-003", { claimed_relay_ids: ["SYN-RELAY-001"] });
  const a = canonicalJson(run(t, baseContext()));
  const b = canonicalJson(run(t, baseContext()));
  assert.equal(a, b);
});

test("task_id is stable for identical tasks", () => {
  const t = taskFor(store, "SYN-CASE-010");
  assert.equal(run(t, baseContext()).task_id, run(t, baseContext()).task_id);
});

test("caller mutation of a result cannot affect the next run", () => {
  const t = taskFor(store, "SYN-CASE-003");
  const before = canonicalJson(run(t, baseContext()));
  const r = run(t, baseContext());
  r.recommendations.push({ recommendation_id: "rec-forged" });
  r.escalation_triggers.length = 0;
  r.diagnostics.push({ code: "FORGED" });
  const after = canonicalJson(run(t, baseContext()));
  assert.equal(before, after);
});

test("recommendation and escalation ids are deterministic", () => {
  const t = taskFor(store, "SYN-CASE-021");
  const a = run(t, baseContext());
  const b = run(t, baseContext());
  assert.deepEqual(
    a.recommendations.map((r) => r.recommendation_id),
    b.recommendations.map((r) => r.recommendation_id)
  );
  assert.deepEqual(
    a.escalation_triggers.map((e) => e.escalation_id),
    b.escalation_triggers.map((e) => e.escalation_id)
  );
});
