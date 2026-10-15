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

function ctx() {
  return {
    clock: Date.parse("2026-06-01T00:00:00Z"),
    registry: JSON.parse(JSON.stringify(store.registry)),
    sources: JSON.parse(JSON.stringify(store.sources)),
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    reviewRecords: store.reviewRecords,
  };
}
const task = {
  task_id: "demo-determinism-1",
  requested_action: "draft_education",
  topic_id: "recordkeeping-basics",
  topic_label: "Recordkeeping Basics",
  jurisdiction: "US-FEDERAL",
  tax_year: 2026,
  as_of_date: "2026-06-01T00:00:00Z",
  mode: "current_education",
  source_refs: [],
};

test("repeat runs are byte-identical", () => {
  const a = canonicalJson(run(task, ctx()));
  const b = canonicalJson(run(task, ctx()));
  assert.equal(a, b);
});

test("caller mutation of a result cannot affect later runs", () => {
  const r1 = run(task, ctx());
  r1.claims.push({ claim_id: "forged", concept_key: "forged", text: "forged", citation_ids: [] });
  r1.diagnostics.length = 0;
  const r2 = run(task, ctx());
  assert.ok(!r2.claims.some((c) => c.claim_id === "forged"));
});

test("task_id is deterministic for the same task", () => {
  assert.equal(run(task, ctx()).task_id, run(task, ctx()).task_id);
});

test("three fixed-context runs are byte-identical (official battery determinism contract)", () => {
  const outs = [run(task, ctx()), run(task, ctx()), run(task, ctx())].map(canonicalJson);
  assert.equal(outs[0], outs[1]);
  assert.equal(outs[1], outs[2]);
});
