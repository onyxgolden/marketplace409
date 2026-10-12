/**
 * determinism.test.js — repeat runs are byte-identical; returned objects
 * are detached snapshots.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, canonicalJson } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const vocabulary = JSON.parse(readFileSync(join(ROOT, "fixtures", "vocabulary.json"), "utf8"));

function ctx() {
  return {
    clock: Date.parse("2026-10-12T12:00:00Z"), vocabulary,
    sources: JSON.parse(JSON.stringify(store.sources)),
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    supersessionRecords: store.supersessionRecords,
  };
}
const task = {
  query: "What are the parking rules?",
  query_key: null,
  filters: { source_tags: [], max_source_age_days: null, as_of_date: null },
  requested_action: "answer",
};

test("repeat runs are byte-identical", () => {
  const a = canonicalJson(run(task, ctx()));
  const b = canonicalJson(run(task, ctx()));
  assert.equal(a, b);
});

test("caller mutation of a result cannot affect later runs", () => {
  const r1 = run(task, ctx());
  r1.claims.push({ claim_id: "forged", text: "forged", validity: "GROUNDED", citations: [] });
  r1.diagnostics.length = 0;
  const r2 = run(task, ctx());
  assert.ok(!r2.claims.some((c) => c.claim_id === "forged"));
  assert.ok(r2.diagnostics.length > 0);
});

test("task_id is deterministic for the same task", () => {
  assert.equal(run(task, ctx()).task_id, run(task, ctx()).task_id);
});
