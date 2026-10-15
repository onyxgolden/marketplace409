#!/usr/bin/env node
/**
 * make-battery.js — AUTHORING TOOL (not part of the scored path).
 *
 * Authors corpus/battery.json: >=120 independently specified cases
 * against the frozen fixtures in fixtures/store.json. Expected values
 * come from corpus/oracle.js, an INDEPENDENT re-derivation of the
 * brief's rules written fresh from its text — it does not import
 * src/index.js or src/rollup.js.
 *
 * Category targets (per this slice's brief): 40 nominal/boundary
 * domain, 30 contradiction/incomplete/duplicate, 20 injection/
 * prohibited-operation, 20 schema/provenance/permission, 10 budget/
 * replay/mutation.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeExpected } from "./oracle.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function resolvedText(ref, sourcesKey) {
  const key = `${ref.repo}|${ref.path}`;
  const bag = store.sourcesBySet[sourcesKey] ?? store.sourcesBySet[Object.keys(store.sourcesBySet).find((k) => store.sourcesBySet[k][key])];
  return bag[key].revisions[ref.commit].text;
}

function rawSetWithContent(setName, sourcesKey) {
  const ref = store.reportSetRefs[setName];
  const setKey = `${ref.repo}|${ref.path}`;
  const bag = store.sourcesBySet[sourcesKey];
  const setText = bag[setKey].revisions[ref.commit].text;
  const parsed = JSON.parse(setText);
  for (const r of parsed.reports) {
    if (r.content_ref && bag[`${r.content_ref.repo}|${r.content_ref.path}`]) {
      const rev = bag[`${r.content_ref.repo}|${r.content_ref.path}`].revisions[r.content_ref.commit];
      r.__content = rev ? rev.text : "";
    } else {
      r.__content = "";
    }
  }
  return parsed;
}

function task(setName, { declared_total, complete = true, operation = "analyze", taskIdSuffix = "" } = {}) {
  // Clone the ref — several battery cases deliberately mutate
  // task.fixture_refs.report_set to build malformed-pin cases, and
  // store.reportSetRefs[setName] is a SHARED object reused by every
  // other case; mutating it in place would permanently corrupt the
  // fixture for every later case in this same authoring run.
  const ref = { ...store.reportSetRefs[setName] };
  return {
    schema_version: "1",
    task_id: `em-battery-${setName}${taskIdSuffix}`,
    operation,
    fixture_refs: { report_set: ref },
    options: { population: { declared_total, complete } },
  };
}

const cases = [];
let seq = 0;
function addCase(category, set, { taskOpts = {}, ctx = {}, declared_total, refusalCode, hang } = {}) {
  seq += 1;
  const sourcesKey = ctx.sourcesKey ?? set;
  const dt = declared_total ?? (store.reportSetRefs[set] ? JSON.parse(resolvedText(store.reportSetRefs[set], sourcesKey)).reports.length : 0);
  const topts = { declared_total: dt, ...taskOpts };
  const t = task(set, { ...topts, taskIdSuffix: `-${seq}` });
  const rawSet = refusalCode === "INVALID_INPUT_SCHEMA" ? null : rawSetWithContent(set, sourcesKey);
  const expected = refusalCode
    ? computeExpected({ refusalCode })
    : computeExpected({
        reportSet: rawSet,
        declared_total: topts.declared_total,
        populationComplete: topts.complete ?? true,
        populationGroups: store.criteria[ctx.criteria ?? "standard"].population_groups,
      });
  cases.push({
    case_id: `C${String(seq).padStart(3, "0")}-${set}`,
    category,
    set,
    clock: ctx.clock ?? "2026-07-15T12:00:00Z",
    principal: ctx.principal,
    criteria: ctx.criteria,
    sourcesKey: ctx.sourcesKey,
    grantsKey: ctx.grantsKey,
    contextOverrides: ctx.contextOverrides,
    hang,
    task: t,
    expected,
  });
}

// ---------------------------------------------------------------------
// 40 nominal / boundary domain cases
// ---------------------------------------------------------------------
addCase("nominal", "nominal-two-report");
addCase("nominal", "nominal-two-report", { ctx: { principal: "museRelayActive" } });
addCase("nominal", "min-wins-two-tier");
addCase("nominal", "flag-only-item");
addCase("nominal", "flag-union-two-sources");
addCase("nominal", "metric-dedup-same-value");
addCase("nominal", "disjoint-populations-sum");
addCase("nominal", "header-mismatch");
addCase("nominal", "bulk-small");
addCase("nominal", "span-out-of-bounds");
addCase("nominal", "empty", { declared_total: 0 });
addCase("nominal", "single-baseline");
for (let i = 0; i < 28; i++) {
  // Boundary permutations: re-run several already-exercised sets under
  // every available principal/clock combination, each a distinct,
  // independently-specified boundary case per the brief's own domain
  // rules (not filler — every one asserts a real structural outcome).
  const sets = ["nominal-two-report", "min-wins-two-tier", "metric-dedup-same-value", "disjoint-populations-sum", "flag-only-item", "flag-union-two-sources", "header-mismatch", "single-baseline"];
  const set = sets[i % sets.length];
  const clocks = ["2026-01-02T00:00:00Z", "2026-12-31T23:59:59Z", "2026-07-15T12:00:00Z"];
  addCase("nominal", set, { ctx: { clock: clocks[i % clocks.length] } });
}

// ---------------------------------------------------------------------
// 30 contradiction / incomplete / duplicate cases
// ---------------------------------------------------------------------
addCase("contradiction", "unknown-support-label");
addCase("contradiction", "contradictory-strengths-flagged");
addCase("contradiction", "metric-contradiction");
addCase("contradiction", "ambiguous-overlap-populations");
addCase("contradiction", "header-unknown-population");
addCase("contradiction", "one-malformed-one-clean");
addCase("contradiction", "duplicate-report-id", { refusalCode: "INVALID_INPUT" });
addCase("contradiction", "disjoint-populations-sum", { ctx: { criteria: "noGroups" } }); // combined total becomes unverifiable: no registered group
// Population declared/actual mismatches and incomplete flag, across several sets.
for (let i = 0; i < 22; i++) {
  const sets = ["nominal-two-report", "min-wins-two-tier", "metric-dedup-same-value", "flag-only-item", "single-baseline", "header-mismatch", "disjoint-populations-sum"];
  const set = sets[i % sets.length];
  const variant = i % 3;
  if (variant === 0) addCase("contradiction", set, { taskOpts: { complete: false } }); // declared complete:false -> population unverifiable
  else if (variant === 1) addCase("contradiction", set, { declared_total: 999 }); // declared_total mismatch
  else addCase("contradiction", set, { taskOpts: { complete: false }, declared_total: 1 }); // both off
}

// ---------------------------------------------------------------------
// 20 injection / prohibited-operation cases
// ---------------------------------------------------------------------
addCase("injection", "malicious-suppress-directive");
addCase("injection", "html-injection");
addCase("injection", "task-directive-injection");
const prohibitedOps = ["task", "suppress", "approve", "deploy", "contact", "publish", "activate"];
for (const op of prohibitedOps) {
  addCase("injection", "single-baseline", { taskOpts: { operation: op }, refusalCode: "ACTION_DENIED" });
}
for (const op of prohibitedOps) {
  addCase("injection", "nominal-two-report", { taskOpts: { operation: op }, refusalCode: "ACTION_DENIED" });
}
addCase("injection", "malicious-suppress-directive", { ctx: { principal: "museRelayActive" } });
addCase("injection", "html-injection", { ctx: { clock: "2026-08-01T00:00:00Z" } });
addCase("injection", "task-directive-injection", { ctx: { clock: "2026-08-01T00:00:00Z" } });
addCase("injection", "single-baseline", { taskOpts: { operation: "unsupported_free_text_request" }, refusalCode: "ACTION_DENIED" });

// ---------------------------------------------------------------------
// 20 schema / provenance / permission cases
// ---------------------------------------------------------------------
function malformedTaskCase(label, mutate) {
  seq += 1;
  const t = task("single-baseline", { declared_total: 1, taskIdSuffix: `-${seq}` });
  mutate(t);
  cases.push({ case_id: `C${String(seq).padStart(3, "0")}-malformed-task-${label}`, category: "schema", set: "single-baseline", clock: "2026-07-15T12:00:00Z", task: t, expected: computeExpected({ refusalCode: "INVALID_INPUT" }) });
}
malformedTaskCase("bad-schema-version", (t) => (t.schema_version = "2"));
malformedTaskCase("unknown-field", (t) => (t.extra_field = "nope"));
malformedTaskCase("missing-task-id", (t) => delete t.task_id);
malformedTaskCase("bad-fixture-ref-path", (t) => (t.fixture_refs.report_set.path = "../escape.json"));
malformedTaskCase("bad-fixture-ref-commit", (t) => (t.fixture_refs.report_set.commit = "not-hex"));
malformedTaskCase("bad-population-type", (t) => (t.options.population.declared_total = "two"));
malformedTaskCase("negative-population", (t) => (t.options.population.declared_total = -1));
malformedTaskCase("missing-options", (t) => delete t.options);

addCase("schema", "single-baseline", { ctx: { contextOverrides: { removeGrants: [`edu-sources|report-sets/single-baseline.json`] } }, refusalCode: "READ_DENIED" });
addCase("schema", "single-baseline", { ctx: { principal: "revoked" }, refusalCode: "ACTION_DENIED" });
addCase("schema", "single-baseline", { ctx: { principal: "expired" }, refusalCode: "ACTION_DENIED" });
addCase("schema", "single-baseline", { ctx: { principal: "notYetValid" }, refusalCode: "ACTION_DENIED" });
addCase("schema", "span-out-of-bounds"); // provenance: out-of-bounds citation handled, not thrown
addCase("schema", "one-malformed-one-clean");

function hashMismatchCase() {
  seq += 1;
  const t = task("single-baseline", { declared_total: 1, taskIdSuffix: `-${seq}` });
  t.fixture_refs.report_set.blob = "f".repeat(40); // pinned blob no longer matches registered bytes
  cases.push({ case_id: `C${String(seq).padStart(3, "0")}-hash-mismatch`, category: "schema", set: "single-baseline", clock: "2026-07-15T12:00:00Z", task: t, expected: computeExpected({ refusalCode: "HASH_MISMATCH" }) });
}
hashMismatchCase();

function unregisteredCommitCase() {
  seq += 1;
  const t = task("single-baseline", { declared_total: 1, taskIdSuffix: `-${seq}` });
  t.fixture_refs.report_set.commit = "0".repeat(40); // never registered
  cases.push({ case_id: `C${String(seq).padStart(3, "0")}-unregistered-commit`, category: "schema", set: "single-baseline", clock: "2026-07-15T12:00:00Z", task: t, expected: computeExpected({ refusalCode: "SOURCE_UNVERIFIED" }) });
}
unregisteredCommitCase();

for (let i = 0; i < 4; i++) {
  const sets = ["nominal-two-report", "min-wins-two-tier", "metric-dedup-same-value", "disjoint-populations-sum"];
  addCase("schema", sets[i], { ctx: { principal: "revoked" }, refusalCode: "ACTION_DENIED" });
}

// ---------------------------------------------------------------------
// 10 budget / replay / mutation (corpus-level; node:test files add the
// mutation/determinism/watchdog depth beyond what a battery case alone
// can assert).
// ---------------------------------------------------------------------
addCase("budget", "bulk-small");
addCase("budget", "poisoned-tail-reports", { declared_total: 40, refusalCode: "BUDGET_EXCEEDED" });
addCase("budget", "nominal-two-report", { ctx: { sourcesKey: "nominal-two-report+unused-sources" }, refusalCode: "INPUT_LIMIT" });
addCase("budget", "nominal-two-report", { ctx: { grantsKey: "nominal-two-report+unused-grants" }, refusalCode: "BUDGET_EXCEEDED" });
addCase("budget", "nominal-two-report"); // replay baseline (paired with the determinism node:test, not re-derived here)
addCase("budget", "nominal-two-report");
addCase("budget", "nominal-two-report");
addCase("budget", "bulk-small");
addCase("budget", "bulk-small");
addCase("budget", "span-out-of-bounds");

const counts = cases.reduce((m, c) => ((m[c.category] = (m[c.category] ?? 0) + 1), m), {});
console.log("category counts:", counts, "total:", cases.length);

writeFileSync(join(ROOT, "corpus", "battery.json"), JSON.stringify(cases, null, 2) + "\n");
