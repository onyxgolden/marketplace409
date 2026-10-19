/** execution-addendum.test.js — contract regression probes for the
 * Research Agent: descriptor safety, grant-before-bytes, population
 * completeness, and budget-integrated admission, as runtime tests.
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
    provenance_registry: {},
    ...overrides,
  };
}
function taskFor(bundle, claims = []) {
  const ref = store.bundleRefs[bundle];
  const n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  return {
    schema_version: "1", task_id: "addendum-test", operation: "analyze",
    fixture_refs: { evidence_bundle: ref },
    options: {
      population: { declared_total: n, complete: true },
      requested_claims: claims,
    },
  };
}
const REV = { subject: "ACME-CORP", predicate: "q3-revenue", value: 1200000, value_type: "number", scope: "fy-2026-q3", polarity: "positive" };

test("instant 2026-02-30T00:00:00Z is rejected (no normalization)", () => {
  assert.equal(isRealInstant("2026-02-30T00:00:00Z"), false);
  assert.equal(isRealInstant("2026-01-15T00:00:00Z"), true);
});

test("malformed principal valid_from refuses INVALID_INPUT", () => {
  assert.throws(() => validateDate("2026-02-30", "t"), SchemaError);
});

test("getter beyond the budget is never invoked (task-side sentinel)", () => {
  const task = taskFor("single-passage");
  let invoked = 0;
  const evil = {};
  Object.defineProperty(evil, "claim_id", { get() { invoked++; return "evil"; }, enumerable: true });
  const claims = Array.from({ length: 11 }, (_, i) => ({
    claim_id: `c${i}`, atoms: [REV], origin_passage_refs: [],
  }));
  claims.push(evil);
  task.options.requested_claims = claims;
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED" || d.code === "INVALID_INPUT"));
  assert.equal(invoked, 0, "getter beyond the budget must never fire");
});

test("accessor property on task root is rejected", () => {
  const task = taskFor("single-passage");
  Object.defineProperty(task, "evil", { get() { return 1; }, enumerable: true });
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
});

test("denied grant never reads revision text (byte canary)", () => {
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  const text = store.sources[key].revisions[ref.commit].text;
  const evilText = text.replace("ACME-CORP", "CANARY-CORP");
  const ctx = ctxFor("single-passage", {
    sources: { [key]: { revisions: { [ref.commit]: { text: evilText, blob: ref.blob, label: "v1", expected_records: 1 } } } },
    readGrants: [],
  });
  const r = run(taskFor("single-passage"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "READ_DENIED"));
});

test("fabricated revision label is rejected (tuple spoof)", () => {
  const ref = { ...store.bundleRefs["single-passage"], revision: "v9" };
  const task = taskFor("single-passage");
  task.fixture_refs.evidence_bundle = ref;
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "SOURCE_UNVERIFIED"));
});

test("empty fixture with incomplete population is not complete", () => {
  const task = taskFor("empty");
  task.options.population.complete = false;
  const r = run(task, ctxFor("empty"));
  assert.equal(r.status, "EMPTY");
  assert.equal(r.complete, false);
  assert.equal(r.report.coverage.state, "UNKNOWN_EMPTY");
});

test("quarantined-away origin is not complete:true", () => {
  const r = run(taskFor("quarantine-origin", [{
    claim_id: "c1", atoms: [REV],
    origin_passage_refs: [{ doc_id: "doc-inj", passage_id: "p1" }],
  }]), ctxFor("quarantine-origin"));
  assert.equal(r.complete, false);
  assert.ok(r.quarantined_sources.length > 0);
});

test("PARTIAL results are never complete:true", () => {
  const r = run(taskFor("contradiction", [{
    claim_id: "c1", atoms: [REV],
    origin_passage_refs: [{ doc_id: "doc-a", passage_id: "p1" }],
  }]), ctxFor("contradiction"));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.complete, false);
});

test("prototype-polluted claim is rejected", () => {
  const task = taskFor("single-passage");
  const evil = JSON.parse(`{"claim_id": "c1", "atoms": [], "origin_passage_refs": [], "__proto__": {"polluted": true}}`);
  task.options.requested_claims = [evil];
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
});

test("deeply nested task beyond depth 32 refuses", () => {
  const task = taskFor("single-passage");
  let deep = { claim_id: "c1", atoms: [REV], origin_passage_refs: [] };
  for (let i = 0; i < 40; i++) deep = { nest: deep };
  task.options.requested_claims = [deep];
  const r = run(task, ctxFor("single-passage"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT" || d.code === "BUDGET_EXCEEDED"));
});

// ---- RA652-006: grant-before-bytes sentinels ----
// The denied-source grant must be checked BEFORE any source byte or
// payload metadata is accessed. These sentinels fail on the old head,
// which validated (and thereby inspected) every source revision's
// metadata before the grant check.

function ra652Ctx(overrides = {}) {
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  return {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    provenance_registry: {},
    ...overrides,
  };
}

test("RA652-006: denied source revision metadata is never touched (proxy sentinel)", () => {
  // The selected source's revision entry is a Proxy that throws on ANY
  // inspection (get, ownKeys, getOwnPropertyDescriptor, has). With no
  // read grant, the run must refuse READ_DENIED without touching it.
  let touches = 0;
  const throwing = {
    get(t, p) { touches++; throw new Error(`revision metadata touched: ${String(p)}`); },
    has(t, p) { touches++; throw new Error(`revision metadata touched: has ${String(p)}`); },
    ownKeys(t) { touches++; throw new Error("revision metadata touched: ownKeys"); },
    getOwnPropertyDescriptor(t, p) { touches++; throw new Error("revision metadata touched: descriptor"); },
  };
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  const ctx = ra652Ctx({
    sources: { [key]: new Proxy({}, throwing) },
    readGrants: [],
  });
  const r = run(taskFor("single-passage"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "READ_DENIED"), "must refuse with READ_DENIED");
  assert.equal(r.report, null);
  assert.equal(touches, 0, "denied revision metadata must remain completely untouched");
});

test("RA652-006: denied source payload metadata is never validated", () => {
  // The denied revision carries metadata that would fail validation
  // (non-hex blob, empty label, negative expected_records) and a
  // marker in its text. The grant check must fire first: the refusal is
  // READ_DENIED and the marker never appears in the output.
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  const ctx = ra652Ctx({
    sources: {
      [key]: {
        revisions: {
          [ref.commit]: {
            text: "RA652-006-DENIED-PAYLOAD-MARKER",
            blob: "not-a-hex-blob",
            label: "",
            expected_records: -1,
          },
        },
      },
    },
    readGrants: [],
  });
  const r = run(taskFor("single-passage"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "READ_DENIED"), "grant denial precedes metadata validation");
  assert.ok(!r.diagnostics.some((d) => d.code === "INVALID_INPUT"), "metadata must not be validated before the grant check");
  assert.equal(r.report, null);
  assert.ok(
    !JSON.stringify(r).includes("RA652-006-DENIED-PAYLOAD-MARKER"),
    "denied payload must not leak into the refusal"
  );
});

test("RA652-006: non-selected sources are never admitted", () => {
  // A second source entry is outright malformed. The grant covers only
  // the selected bundle, so the run must succeed — proving the
  // non-selected entry was never inspected or charged.
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  const ctx = ra652Ctx({
    sources: {
      [key]: store.sources[key],
      "other|bundles/garbage.json": { revisions: { "nope": "garbage" } },
    },
  });
  const r = run(taskFor("single-passage", [{
    claim_id: "c1", atoms: [REV],
    origin_passage_refs: [{ doc_id: "doc-alpha", passage_id: "p1" }],
  }]), ctx);
  assert.equal(r.status, "REPORT_READY", "malformed non-selected source must be ignored");
  assert.equal(r.report.claims[0].research_status, "attributed-only");
});

test("RA652-006: grant for a different path still denies the selected bundle", () => {
  // A grant exists, but for another path: the selected bundle's bytes
  // stay unread and the refusal is READ_DENIED naming the bundle.
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  let touches = 0;
  const throwing = {
    get(t, p) { touches++; throw new Error("touched"); },
    ownKeys(t) { touches++; throw new Error("touched"); },
    getOwnPropertyDescriptor(t, p) { touches++; throw new Error("touched"); },
  };
  const ctx = ra652Ctx({
    sources: { [key]: new Proxy({}, throwing) },
    readGrants: [{ repo: ref.repo, path: "bundles/other.json" }],
  });
  const r = run(taskFor("single-passage"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "READ_DENIED"));
  assert.equal(touches, 0, "wrong-path grant must not admit the selected source");
});
