/**
 * determinism.test.js — repeat runs are byte-identical; returned objects
 * are detached snapshots; caller mutation of a result cannot affect
 * later runs or the underlying fixtures.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, canonicalJson } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

const BUNDLE_REF = store.bundleRefs["multi-tag-precedence"];
const POLICY_KEY = `${store.criteria.standard.policy_ref.repo}|${store.criteria.standard.policy_ref.path}`;
const BUNDLE_KEY = `${BUNDLE_REF.repo}|${BUNDLE_REF.path}`;

// Minimal context (policy + this one bundle only) — CS-001 fix made
// context validation itself object-charged, so the whole shared
// 25-bundle fixture store would blow the 64-object budget before any
// ticket is reached (see tests/harness.js's minimalRegistry).
function ctx() {
  return {
    clock: Date.parse("2026-07-01T00:00:00Z"),
    sources: JSON.parse(JSON.stringify({ [POLICY_KEY]: store.sources[POLICY_KEY], [BUNDLE_KEY]: store.sources[BUNDLE_KEY] })),
    readGrants: [{ repo: store.criteria.standard.policy_ref.repo, path: store.criteria.standard.policy_ref.path }, { repo: BUNDLE_REF.repo, path: BUNDLE_REF.path }],
    principal: store.principals.jasonActive,
    criteria: store.criteria.standard,
  };
}
const task = {
  schema_version: "1",
  task_id: "demo-determinism-1",
  operation: "analyze",
  fixture_refs: { ticket_bundle: BUNDLE_REF },
  options: { population: { declared_total: 1, complete: true }, header_claims: { avg_response_minutes: null, avg_resolution_minutes: null, sla_compliance_pct: null, csat_mean: null, csat_positive_pct: null } },
};

test("repeat runs are byte-identical", () => {
  const a = canonicalJson(run(task, ctx()));
  const b = canonicalJson(run(task, ctx()));
  assert.equal(a, b);
});

test("task_id is deterministic for the same task", () => {
  assert.equal(run(task, ctx()).task_id, run(task, ctx()).task_id);
});

test("caller mutation of a result cannot affect later runs", () => {
  const r1 = run(task, ctx());
  r1.report.ticket_results.push({ ticket_id: "forged", classification: {}, taxonomy_version: "x", drafts: [], suppression_reason: null, citations: [] });
  r1.diagnostics.length = 0;
  r1.source_refs.length = 0;
  const r2 = run(task, ctx());
  assert.ok(!r2.report.ticket_results.some((t) => t.ticket_id === "forged"));
  assert.equal(r2.source_refs.length, 2);
});

test("three fixed-context runs are byte-identical (official battery determinism contract)", () => {
  const outs = [run(task, ctx()), run(task, ctx()), run(task, ctx())].map(canonicalJson);
  assert.equal(outs[0], outs[1]);
  assert.equal(outs[1], outs[2]);
});

test("input/store key-ordering permutation does not change the semantic result", () => {
  const c1 = ctx();
  const c2 = ctx();
  // Rebuild context.sources with keys inserted in reverse order — a
  // JS object iterates insertion order, so this actually exercises it.
  const reversedSources = {};
  for (const k of Object.keys(c2.sources).reverse()) reversedSources[k] = c2.sources[k];
  c2.sources = reversedSources;
  const r1 = canonicalJson(run(task, c1));
  const r2 = canonicalJson(run(task, c2));
  assert.equal(r1, r2);
});
