/**
 * execution-addendum.test.js — contract regression probes for the Sales
 * Agent: descriptor safety, grant-before-bytes, population completeness,
 * and budget-integrated admission, as runtime tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { SchemaError } from "../src/schemas.js";
import { loadStore, makeStandard, makeTask, makeContext, boundPopulation } from "./helpers.js";

const store = loadStore();

test("addendum: denied-source grant checked before bytes are accessed", () => {
  const { task, context } = makeStandard(store);
  context.readGrants = []; // no grants at all
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "ACTION_DENIED");
});

test("addendum: unsupported operation returns named refusal", () => {
  const { task, context } = makeStandard(store);
  task.operation = "dispatch_outreach";
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  // validateTask rejects unknown operations structurally
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("addendum: unknown principal role is denied", () => {
  const { task, context } = makeStandard(store);
  context.principal.role = "SUPERUSER";
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
});

test("addendum: complete population declaration binds identities", () => {
  const { task, context } = makeStandard(store);
  const t2 = makeTask(store, {
    population: {
      declared_complete: true, dataset_id: "sales-fixtures", dataset_version: "2026-10-19",
      expected_lead_ids: ["lead-high-01"], // wrong: not the full set
      expected_count: 16,
    },
  });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
  assert.ok(r.diagnostics.some((d) => d.code === "POPULATION_INCOMPLETE"));
});

test("addendum: same-sized unrelated dataset is not complete", () => {
  // Declared-complete against the wrong identity set must fail even when
  // the count matches.
  const { task, context } = makeStandard(store);
  const t2 = makeTask(store, {
    population: {
      declared_complete: true, dataset_id: "sales-fixtures", dataset_version: "2026-10-19",
      expected_lead_ids: Array.from({ length: 16 }, (_, i) => `other-${i}`),
      expected_count: 16,
    },
  });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
});

test("addendum: unbound dataset identity is not complete even with matching ids", () => {
  // S653-001: the caller's ids match, but the dataset identity does not
  // bind to the host registration -> no trusted coverage.
  const { task, context } = makeStandard(store);
  const pop = boundPopulation(store, "main");
  const t2 = makeTask(store, {
    population: { ...pop, dataset_id: "unrelated", dataset_version: "never-registered" },
  });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
  assert.equal(r.report.summary, null);
  assert.ok(r.diagnostics.some((d) => d.code === "POPULATION_INCOMPLETE"));
});

test("addendum: absent host expected_records means unknown coverage", () => {
  // Host registration without expected_records: coverage unknown, never
  // verified complete, even with a bound identity and matching ids.
  const s2 = JSON.parse(JSON.stringify(store));
  const key = "sales-fixtures|leads/main.json";
  const ref = s2.bundleRefs["main"];
  const rev = s2.sources[key].revisions[ref.commit];
  delete rev.expected_records;
  const { task, context } = makeStandard(s2);
  const pop = boundPopulation(s2, "main");
  const t2 = makeTask(s2, { population: pop });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
  assert.equal(r.report.summary, null);
});

test("addendum: proxy task refuses with ZERO trap invocations", () => {
  const { context } = makeStandard(store);
  let touched = false;
  const task = new Proxy({ schema_version: "1" }, {
    get(t, k) { touched = true; return t[k]; },
    getOwnPropertyDescriptor(t, k) { touched = true; return Object.getOwnPropertyDescriptor(t, k); },
    getPrototypeOf(t) { touched = true; return Object.getPrototypeOf(t); },
    ownKeys(t) { touched = true; return Object.getOwnPropertyNames(t); },
  });
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
  assert.equal(touched, false, "no proxy trap may fire before refusal");
});

test("addendum: denied source metadata stays untouched (label accessor sentinel)", () => {
  // Deep-copy the store: the accessor sentinel must not leak into other tests.
  const s2 = JSON.parse(JSON.stringify(store));
  const { task, context } = makeStandard(s2);
  let touched = false;
  const key = Object.keys(context.sources)[0];
  const commit = Object.keys(context.sources[key].revisions)[0];
  Object.defineProperty(context.sources[key].revisions[commit], "label", {
    get() { touched = true; return "x"; }, enumerable: true, configurable: true,
  });
  context.readGrants = []; // no grants: the grant check must come first
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "ACTION_DENIED");
  assert.equal(touched, false, "denied source metadata must remain untouched");
});

test("addendum: expired principal is denied before source admission", () => {
  const { task, context } = makeStandard(store);
  context.principal = { ...context.principal, valid_from: "2019-01-01", expires_at: "2020-06-01" };
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "ACTION_DENIED");
  assert.equal(r.report, null);
});

test("addendum: future principal window is denied", () => {
  const { task, context } = makeStandard(store);
  context.principal = { ...context.principal, valid_from: "2027-01-01", expires_at: "2028-01-01" };
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "ACTION_DENIED");
});

test("addendum: each classification carries a byte-exact citation", () => {
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  assert.ok(r.report.classifications.length > 0);
  for (const c of r.report.classifications) {
    const cit = c.citation;
    assert.ok(cit, "classification must carry a citation");
    assert.equal(cit.source_ref.algorithm, "git-sha1");
    assert.ok(/^[0-9a-f]{40}$/.test(cit.source_ref.blob));
    assert.ok(Number.isInteger(cit.span.start_byte) && Number.isInteger(cit.span.end_byte));
    assert.ok(cit.span.end_byte > cit.span.start_byte);
    assert.equal(typeof cit.span.quoted_text, "string");
    assert.equal(cit.verification.round_trip_ok, true);
  }
});

test("addendum: drafts cite the lead span and mark product evidence as trusted-context", () => {
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  assert.ok(r.report.drafts.length > 0);
  for (const d of r.report.drafts) {
    assert.ok(d.citation && d.citation.span, "draft must carry a citation");
    assert.ok(d.citation.product_evidence.includes("trusted context"));
  }
});

test("addendum: structurally corrupt lead bundle refuses with no partial payload", () => {
  const { task, context } = makeStandard(store, { bundleNames: ["duplicates"] }, { bundleNames: ["duplicates"] });
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.report, null);
  assert.equal(r.complete, false);
  assert.deepEqual(r.routing_flags, []);
});

test("addendum: output envelope carries the fixed public fields", () => {
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  assert.equal(r.schema_version, "1");
  assert.equal(r.agent, "sales-agent");
  assert.equal(r.advisory, true);
  assert.equal(r.fixture_only, true);
  assert.equal(r.authorization_granted, false);
  assert.ok(Array.isArray(r.source_refs));
  assert.ok(r.source_refs.length > 0);
  for (const s of r.source_refs) {
    assert.equal(s.algorithm, "git-sha1");
    assert.ok(/^[0-9a-f]{40}$/.test(s.commit));
    assert.ok(/^[0-9a-f]{40}$/.test(s.blob));
  }
});
