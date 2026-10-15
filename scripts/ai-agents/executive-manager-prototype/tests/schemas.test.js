import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateTask,
  validateReport,
  validateSourceRef,
  validatePrincipal,
  validatePopulationGroup,
  validateContextShape,
  validateRevisionEntry,
  SchemaError,
} from "../src/schemas.js";

const GOOD_REF = { repo: "edu-sources", path: "content/x.txt", commit: "a".repeat(40), blob: "b".repeat(40), algorithm: "git-sha1", revision: "v1" };

function goodTask() {
  return { schema_version: "1", task_id: "t1", operation: "analyze", fixture_refs: { report_set: GOOD_REF }, options: { population: { declared_total: 1, complete: true } } };
}

test("validateTask: accepts a well-formed task", () => {
  const t = validateTask(goodTask());
  assert.equal(t.kind, "analyze");
});

test("validateTask: unknown operation routes to prohibited, not thrown", () => {
  const t = validateTask({ ...goodTask(), operation: "deploy" });
  assert.equal(t.kind, "prohibited");
  assert.equal(t.operation, "deploy");
});

test("validateTask: rejects unknown top-level field", () => {
  assert.throws(() => validateTask({ ...goodTask(), extra: 1 }), SchemaError);
});

test("validateTask: rejects wrong schema_version", () => {
  assert.throws(() => validateTask({ ...goodTask(), schema_version: "2" }), SchemaError);
});

test("validateTask: rejects negative declared_total", () => {
  const t = goodTask();
  t.options.population.declared_total = -1;
  assert.throws(() => validateTask(t), SchemaError);
});

test("validateTask: rejects non-integer declared_total", () => {
  const t = goodTask();
  t.options.population.declared_total = 1.5;
  assert.throws(() => validateTask(t), SchemaError);
});

test("validateSourceRef: rejects non-40-hex commit", () => {
  assert.throws(() => validateSourceRef({ ...GOOD_REF, commit: "not-hex" }, "x"), SchemaError);
});

test("validateSourceRef: rejects path traversal", () => {
  assert.throws(() => validateSourceRef({ ...GOOD_REF, path: "../escape.txt" }, "x"), SchemaError);
});

test("validateSourceRef: rejects wrong algorithm", () => {
  assert.throws(() => validateSourceRef({ ...GOOD_REF, algorithm: "sha256" }, "x"), SchemaError);
});

function goodReport() {
  return {
    report_id: "rep-1",
    content_ref: GOOD_REF,
    source_principal: "Program Manager",
    workstream: "delivery",
    scope: "programwide",
    period: "2026-q3",
    statements: [{ item_id: "item-1", support_strength: "verified", flags: [], span: { start_byte: 0, end_byte: 5 } }],
    metrics: [],
    header_claims: [],
  };
}

test("validateReport: accepts a well-formed report", () => {
  const r = validateReport(goodReport(), "x");
  assert.equal(r.report_id, "rep-1");
});

test("validateReport: rejects invalid period format", () => {
  assert.throws(() => validateReport({ ...goodReport(), period: "Q3-2026" }, "x"), SchemaError);
});

test("validateReport: rejects workstream that isn't a slug", () => {
  assert.throws(() => validateReport({ ...goodReport(), workstream: "Not A Slug!" }, "x"), SchemaError);
});

test("validateReport: rejects unknown flag value", () => {
  const r = goodReport();
  r.statements[0].flags = ["bogus_flag"];
  assert.throws(() => validateReport(r, "x"), SchemaError);
});

test("validateReport: rejects duplicate flags on one statement", () => {
  const r = goodReport();
  r.statements[0].flags = ["mismatch", "mismatch"];
  assert.throws(() => validateReport(r, "x"), SchemaError);
});

test("validateReport: support_strength null is accepted (flag-only)", () => {
  const r = goodReport();
  r.statements[0].support_strength = null;
  r.statements[0].flags = ["mismatch"];
  const out = validateReport(r, "x");
  assert.equal(out.statements[0].support_strength, null);
});

test("validateReport: support_strength unknown string is accepted at schema layer (invalid-item semantics live in rollup, not schema)", () => {
  const r = goodReport();
  r.statements[0].support_strength = "green";
  const out = validateReport(r, "x");
  assert.equal(out.statements[0].support_strength, "green");
});

test("validateReport: metric currency must be null when unit is not 'currency'", () => {
  const r = goodReport();
  r.metrics = [{ line_item_id: "L1", metric_key: "spend", population_id: "pop-a", unit: "count", period: "2026-q3", currency: "usd", value: 1, span: { start_byte: 0, end_byte: 1 } }];
  assert.throws(() => validateReport(r, "x"), SchemaError);
});

test("validateReport: currency metric value must be an integer (minor units)", () => {
  const r = goodReport();
  r.metrics = [{ line_item_id: "L1", metric_key: "spend", population_id: "pop-a", unit: "currency", currency: "usd", period: "2026-q3", value: 1.5, span: { start_byte: 0, end_byte: 1 } }];
  assert.throws(() => validateReport(r, "x"), SchemaError);
});

test("validateReport: rejects span end_byte <= start_byte", () => {
  const r = goodReport();
  r.statements[0].span = { start_byte: 5, end_byte: 5 };
  assert.throws(() => validateReport(r, "x"), SchemaError);
});

test("validatePrincipal: rejects registered_by other than 'jason'", () => {
  assert.throws(
    () => validatePrincipal({ principal_id: "p1", role: "JASON", registered_by: "someone-else", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false }, "x"),
    SchemaError
  );
});

test("validatePopulationGroup: rejects fewer than 2 members", () => {
  assert.throws(() => validatePopulationGroup({ group_id: "g1", member_population_ids: ["only-one"], disjoint: true }, "x", new Set()), SchemaError);
});

test("validatePopulationGroup: rejects duplicate group_id via seen-set", () => {
  const seen = new Set();
  validatePopulationGroup({ group_id: "g1", member_population_ids: ["a", "b"], disjoint: true }, "x", seen);
  assert.throws(() => validatePopulationGroup({ group_id: "g1", member_population_ids: ["c", "d"], disjoint: true }, "x", seen), SchemaError);
});

test("validateContextShape: rejects context missing a required top-level key", () => {
  assert.throws(() => validateContextShape({ clock: 1, sources: {}, readGrants: [], principal: {} }), SchemaError);
});

test("validateContextShape: does not descend into source/revision fields (preflight only)", () => {
  // A source entry with completely bogus revision content still passes
  // shape preflight — descending into it is the charged walk's job.
  const shape = validateContextShape({
    clock: 1,
    sources: { "a|b": { revisions: { c: "not even an object" } } },
    readGrants: [],
    principal: {},
    criteria: {},
  });
  assert.deepEqual(shape.sourceKeys, ["a|b"]);
});

test("validateRevisionEntry: rejects non-40-hex blob", () => {
  assert.throws(() => validateRevisionEntry({ text: "hello", blob: "not-hex" }, "x"), SchemaError);
});
