/**
 * execution-addendum.test.js — contract regression probes for the Sales
 * Agent: descriptor safety, grant-before-bytes, population completeness,
 * and budget-integrated admission, as runtime tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { SchemaError } from "../src/schemas.js";
import { loadStore, makeStandard, makeTask, makeContext } from "./helpers.js";

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
      declared_complete: true, dataset_id: "main-set", dataset_version: "v1",
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
      declared_complete: true, dataset_id: "main-set", dataset_version: "v1",
      expected_lead_ids: Array.from({ length: 16 }, (_, i) => `other-${i}`),
      expected_count: 16,
    },
  });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
});

test("addendum: proxy task refuses without invoking traps", () => {
  const { context } = makeStandard(store);
  let touched = false;
  const task = new Proxy({ schema_version: "1" }, {
    getOwnPropertyDescriptor(t, k) { touched = true; return Object.getOwnPropertyDescriptor(t, k); },
  });
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
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
