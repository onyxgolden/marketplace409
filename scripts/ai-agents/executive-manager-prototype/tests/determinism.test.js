import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, canonicalJson } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function ctxFor(set) {
  return {
    clock: Date.parse("2026-07-15T12:00:00Z"),
    sources: store.sourcesBySet[set],
    readGrants: store.readGrantsBySet[set],
    principal: store.principals.jasonActive,
    criteria: store.criteria.standard,
  };
}
function taskFor(set, declared_total) {
  return { schema_version: "1", task_id: `det-${set}`, operation: "analyze", fixture_refs: { report_set: store.reportSetRefs[set] }, options: { population: { declared_total, complete: true } } };
}

test("determinism: three separate invocations of the same task+context produce byte-identical canonical JSON", () => {
  const t = taskFor("nominal-two-report", 2);
  const c = ctxFor("nominal-two-report");
  const r1 = canonicalJson(run(t, ctxFor("nominal-two-report")));
  const r2 = canonicalJson(run(t, ctxFor("nominal-two-report")));
  const r3 = canonicalJson(run(t, c));
  assert.equal(r1, r2);
  assert.equal(r2, r3);
});

test("determinism: input/store key ordering permutations do not change the semantic result", () => {
  const t = taskFor("disjoint-populations-sum", 2);
  const c1 = ctxFor("disjoint-populations-sum");
  // Rebuild context with object keys inserted in a different order —
  // JS preserves insertion order for string keys, so this is a genuine
  // ordering permutation, not a no-op.
  const reorderedSources = {};
  for (const k of Object.keys(c1.sources).reverse()) reorderedSources[k] = c1.sources[k];
  const c2 = { ...c1, sources: reorderedSources, readGrants: [...c1.readGrants].reverse() };
  const r1 = canonicalJson(run(t, c1));
  const r2 = canonicalJson(run(t, c2));
  assert.equal(r1, r2);
});

test("determinism: caller mutation of a returned result cannot affect a later call (detached snapshots)", () => {
  const t = taskFor("nominal-two-report", 2);
  const c = ctxFor("nominal-two-report");
  const r1 = run(t, c);
  r1.report.source_reports.push({ injected: "tamper" });
  r1.report.derived_statements = null;
  r1.diagnostics.push({ code: "FAKE" });
  const r2 = run(t, c);
  assert.equal(r2.report.source_reports.length, 2);
  assert.ok(Array.isArray(r2.report.derived_statements));
  assert.equal(r2.diagnostics.length, 0);
});

test("determinism: mutating the context object after a call does not affect a later call with a fresh context", () => {
  const t = taskFor("single-baseline", 1);
  const c1 = ctxFor("single-baseline");
  const r1 = run(t, c1);
  c1.sources = {}; // caller corrupts their own copy after the call
  const r2 = run(t, ctxFor("single-baseline"));
  assert.deepEqual(canonicalJson(r1), canonicalJson(r2));
});
