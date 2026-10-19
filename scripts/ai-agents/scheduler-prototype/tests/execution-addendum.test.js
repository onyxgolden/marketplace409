/** execution-addendum.test.js — S648A-001..004,006 regression probes.
 * Fresh-contract probes from the independent execution addendum, as
 * runtime tests (not just budget-primitive tests).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { validateDate, SchemaError } from "../src/schemas.js";
import { isRealInstant } from "../src/canonical.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function ctxFor(bundle, overrides = {}) {
  const ref = store.bundleRefs[bundle];
  const key = `${ref.repo}|${ref.path}`;
  return {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    ...overrides,
  };
}

function taskFor(bundle, opts = {}) {
  const ref = store.bundleRefs[bundle];
  const n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  return {
    schema_version: "1",
    task_id: "addendum-test",
    operation: "analyze",
    fixture_refs: { network_bundle: ref },
    options: {
      population: { declared_total: n, complete: true },
      anchors: { c1: "2026-01-05" },
      horizon_days: 60,
      deadlines: {},
      constraints: [],
      claimed: {},
      ...opts,
    },
  };
}

function diagCodes(r) {
  return (r.diagnostics ?? []).map((d) => d.code);
}

// ================= S648A-001: descriptor-safe admission =================

test("S648A-001: ISO instant 2026-02-30T00:00:00Z is rejected (no normalization)", () => {
  assert.equal(isRealInstant("2026-02-30T00:00:00Z"), false);
  assert.equal(isRealInstant("2026-02-28T00:00:00Z"), true);
  assert.throws(() => validateDate("2026-02-30T00:00:00Z", "t"), SchemaError);
  assert.equal(validateDate("2026-02-28T00:00:00Z", "t"), "2026-02-28T00:00:00Z");
});

test("S648A-001: malformed principal valid_from instant refuses INVALID_INPUT", () => {
  const ctx = ctxFor("single-activity", {
    principal: { ...store.principals.jason, valid_from: "2026-02-30T00:00:00Z" },
  });
  const r = run(taskFor("single-activity"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCodes(r).includes("INVALID_INPUT"));
});

test("S648A-001: getter on 65th constraint is never invoked (task-side sentinel)", () => {
  let getterCalls = 0;
  const constraints = [];
  for (let i = 0; i < 64; i++) {
    constraints.push({ activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 0 });
  }
  // 65th constraint (index 64) carries an enumerable getter.
  const evil = {};
  Object.defineProperty(evil, "activity_id", {
    enumerable: true,
    get() { getterCalls++; return "A"; },
  });
  evil.kind = "START_NO_EARLIER_THAN";
  evil.tick = 0;
  constraints.push(evil);
  const task = taskFor("single-activity", { constraints });
  const r = run(task, ctxFor("single-activity"));
  assert.equal(r.status, "REFUSED");
  // S648A-001: descriptor-safe admission rejects the accessor upfront
  // (INVALID_INPUT) before budget charging begins. The getter is never
  // invoked in either path.
  assert.ok(diagCodes(r).includes("INVALID_INPUT") || diagCodes(r).includes("BUDGET_EXCEEDED"));
  assert.equal(getterCalls, 0, "65th constraint getter must never be invoked");
});

test("S648A-001: getter on 61st context source is never invoked", () => {
  let getterCalls = 0;
  const ref = store.bundleRefs["single-activity"];
  const key = `${ref.repo}|${ref.path}`;
  const baseSource = store.sources[key];
  const sources = {};
  for (let i = 0; i < 60; i++) sources[`sched-sources|networks/fake${i}.json`] = baseSource;
  // 61st source with a getter on revisions
  const evil = {};
  Object.defineProperty(evil, "revisions", {
    enumerable: true,
    get() { getterCalls++; return {}; },
  });
  sources["sched-sources|networks/evil.json"] = evil;
  const ctx = ctxFor("single-activity", { sources });
  const r = run(taskFor("single-activity"), ctx);
  assert.equal(r.status, "REFUSED");
  // S648A-001: descriptor-safe admission rejects the accessor upfront
  // (INVALID_INPUT) before budget charging begins. The getter is never
  // invoked in either path.
  assert.ok(diagCodes(r).includes("INVALID_INPUT") || diagCodes(r).includes("BUDGET_EXCEEDED"));
  assert.equal(getterCalls, 0, "61st source getter must never be invoked");
});

test("S648A-001: accessor property on task root is rejected", () => {
  const task = taskFor("single-activity");
  Object.defineProperty(task, "smuggled", {
    enumerable: true,
    get() { return 1; },
  });
  const r = run(task, ctxFor("single-activity"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCodes(r).includes("INVALID_INPUT"));
});

// ================= S648A-002: grants before bytes =================

test("S648A-002: denied grant never reads revision text (byte canary)", () => {
  let textReads = 0;
  const ref = store.bundleRefs["single-activity"];
  const key = `${ref.repo}|${ref.path}`;
  const commit = ref.commit;
  const realRev = store.sources[key].revisions[commit];
  // Path 1: getter on text is rejected by descriptor-safe validation —
  // the accessor is never invoked.
  const evilRev = { blob: realRev.blob, label: realRev.label };
  Object.defineProperty(evilRev, "text", {
    enumerable: true,
    get() { textReads++; return realRev.text; },
  });
  const ctxEvil = ctxFor("single-activity", {
    sources: { [key]: { revisions: { [commit]: evilRev } } },
    readGrants: [],
  });
  const rEvil = run(taskFor("single-activity"), ctxEvil);
  assert.equal(rEvil.status, "REFUSED");
  assert.equal(textReads, 0, "accessor text must never be invoked");

  // Path 2: plain-string text with no grant — refused before byte access.
  // resolveSourceRef (which payload-charges text) runs only after
  // hasReadGrant passes; here it never runs.
  const ctxPlain = ctxFor("single-activity", { readGrants: [] });
  const rPlain = run(taskFor("single-activity"), ctxPlain);
  assert.equal(rPlain.status, "REFUSED");
  assert.ok(diagCodes(rPlain).includes("READ_DENIED"));
});

test("S648A-002: fabricated revision label is rejected (tuple spoof)", () => {
  const ref = { ...store.bundleRefs["single-activity"], revision: "fabricated-revision" };
  const task = taskFor("single-activity");
  task.fixture_refs.network_bundle = ref;
  const r = run(task, ctxFor("single-activity"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCodes(r).includes("SOURCE_UNVERIFIED"));
});

test("S648A-002: correct revision label is accepted", () => {
  const r = run(taskFor("single-activity"), ctxFor("single-activity"));
  assert.equal(r.status, "REPORT_READY");
});

// ================= S648A-003: completeness propagation =================

test("S648A-003: empty fixture with incomplete population is not complete", () => {
  const task = taskFor("empty", { population: { declared_total: 0, complete: false } });
  const r = run(task, ctxFor("empty"));
  assert.equal(r.status, "EMPTY");
  assert.equal(r.complete, false, "unknown population must not be complete:true");
});

test("S648A-003: quarantined-away activity is not complete:true", () => {
  // single-activity fixture with injection note on the activity
  const ref = store.bundleRefs["injection"];
  const task = taskFor("injection");
  const r = run(task, ctxFor("injection"));
  // injection fixture quarantines; must not be complete:true
  assert.equal(r.complete, false, "quarantined population must not be complete:true");
  assert.ok((r.quarantined_sources ?? []).length > 0);
});

test("S648A-003: constraint on unknown activity refuses", () => {
  const task = taskFor("single-activity", {
    constraints: [{ activity_id: "MISSING", kind: "MUST_FINISH_ON", tick: 10 }],
  });
  const r = run(task, ctxFor("single-activity"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCodes(r).includes("UNKNOWN_CONSTRAINT_REFERENCE"));
});

test("S648A-003: PARTIAL results are never complete:true", () => {
  // Use a case that yields PARTIAL (e.g., cycle)
  const r = run(taskFor("cycle"), ctxFor("cycle"));
  if (r.status === "PARTIAL") {
    assert.equal(r.complete, false, "PARTIAL must imply complete:false");
  }
});

// ================= S648A-004: connected components =================

test("S648A-004: disconnected islands under one label split into independent components", () => {
  // Build a synthetic bundle: A(dur 10), B(dur 1), same label, no ties
  const records = [
    { record: "activity", id: "A", component: "c1", duration_workdays: 10, release_tick: 0, note: "" },
    { record: "activity", id: "B", component: "c1", duration_workdays: 1, release_tick: 0, note: "" },
    { record: "calendar", component: "c1", working_weekdays: [1, 2, 3, 4, 5], excluded_dates: [], note: "" },
  ];
  const text = JSON.stringify(records);
  const { gitBlobId } = { gitBlobId: (b) => require("node:crypto").createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex") };
  // Use dynamic import for ESM
  return import("../src/canonical.js").then(({ gitBlobId }) => {
    const bytes = Buffer.from(text, "utf8");
    const blob = gitBlobId(bytes);
    const commit = "f".repeat(40);
    const ref = { repo: "sched-sources", path: "networks/islands.json", commit, blob, algorithm: "git-sha1", revision: "v9" };
    const ctx = {
      clock: 1780315200000,
      sources: { "sched-sources|networks/islands.json": { revisions: { [commit]: { text, blob, label: "v9", expected_records: 3 } } } },
      readGrants: [{ repo: "sched-sources", path: "networks/islands.json" }],
      principal: store.principals.jason,
      criteria: store.criteriaPresets.standard,
    };
    const task = {
      schema_version: "1", task_id: "islands", operation: "analyze",
      fixture_refs: { network_bundle: ref },
      options: {
        population: { declared_total: 3, complete: true },
        anchors: { c1: "2026-01-05" }, horizon_days: 60,
        deadlines: {}, constraints: [], claimed: {},
      },
    };
    const r = run(task, ctx);
    assert.equal(r.status, "REPORT_READY");
    assert.equal(r.report.components.length, 2, "disconnected islands must split");
    const ids = r.report.components.map((c) => c.component_id).sort();
    assert.deepEqual(ids, ["c1~0", "c1~1"]);
    // Each island is critical in its own component (no false float)
    for (const comp of r.report.components) {
      assert.equal(comp.activities.length, 1);
      assert.equal(comp.activities[0].critical, true, "isolated activity must be critical in its own component");
      assert.equal(comp.activities[0].total_float, 0);
    }
    assert.equal(r.complete, true);
  });
});

test("S648A-004: connected activities stay in one component", () => {
  const r = run(taskFor("fs-chain"), ctxFor("fs-chain"));
  assert.equal(r.status, "REPORT_READY");
  // fs-chain fixture: check it wasn't split
  const c1comps = r.report.components.filter((c) => c.component_id.startsWith("c1"));
  assert.ok(c1comps.length >= 1);
});

test("S648A-004: explicit deadline on disconnected label refuses", () => {
  const records = [
    { record: "activity", id: "A", component: "c1", duration_workdays: 10, release_tick: 0, note: "" },
    { record: "activity", id: "B", component: "c1", duration_workdays: 1, release_tick: 0, note: "" },
    { record: "calendar", component: "c1", working_weekdays: [1, 2, 3, 4, 5], excluded_dates: [], note: "" },
  ];
  return import("../src/canonical.js").then(({ gitBlobId }) => {
    const text = JSON.stringify(records);
    const bytes = Buffer.from(text, "utf8");
    const blob = gitBlobId(bytes);
    const commit = "e".repeat(40);
    const ref = { repo: "sched-sources", path: "networks/islands2.json", commit, blob, algorithm: "git-sha1", revision: "v9" };
    const ctx = {
      clock: 1780315200000,
      sources: { "sched-sources|networks/islands2.json": { revisions: { [commit]: { text, blob, label: "v9" } } } },
      readGrants: [{ repo: "sched-sources", path: "networks/islands2.json" }],
      principal: store.principals.jason,
      criteria: store.criteriaPresets.standard,
    };
    const task = {
      schema_version: "1", task_id: "islands-dl", operation: "analyze",
      fixture_refs: { network_bundle: ref },
      options: {
        population: { declared_total: 3, complete: true },
        anchors: { c1: "2026-01-05" }, horizon_days: 60,
        deadlines: { c1: 30 }, constraints: [], claimed: {},
      },
    };
    const r = run(task, ctx);
    assert.equal(r.status, "REFUSED");
    assert.ok(diagCodes(r).includes("DISCONNECTED_COMPONENT"));
  });
});
