/**
 * schemas.test.js — strict validation: unknown properties, missing
 * fields, wrong types, invalid enums/dates, duplicate IDs.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateTask, validateContext, validateTicket, validateSourceRef, SchemaError } from "../src/schemas.js";
import { makeBudget } from "../src/resolver.js";

const GOOD_REF = { repo: "edu-sources", path: "policy/customer-success-policy.md", commit: "a".repeat(40), blob: "b".repeat(40), algorithm: "git-sha1", revision: "v1" };

function goodTask() {
  return {
    schema_version: "1",
    task_id: "t-1",
    operation: "analyze",
    fixture_refs: { ticket_bundle: GOOD_REF },
    options: { population: { declared_total: 0, complete: true }, header_claims: { avg_response_minutes: null, avg_resolution_minutes: null, sla_compliance_pct: null, csat_mean: null, csat_positive_pct: null } },
  };
}

function goodTicket() {
  return {
    ticket_id: "t-1",
    created_at: "2026-06-01T10:00:00Z",
    first_response_at: null,
    resolved_at: null,
    status: "OPEN",
    issue_tags: ["TECHNICAL"],
    impact: "NONE",
    sentiment_signal: "UNKNOWN",
    rating: null,
    subject: "",
    body: "",
    notes: "",
  };
}

test("validateTask accepts a well-formed task", () => {
  assert.equal(validateTask(goodTask()).kind, "analyze");
});

test("validateTask rejects unknown top-level property", () => {
  assert.throws(() => validateTask({ ...goodTask(), extra: 1 }), SchemaError);
});

test("validateTask rejects missing schema_version", () => {
  const t = goodTask();
  delete t.schema_version;
  assert.throws(() => validateTask(t), SchemaError);
});

test("validateTask rejects wrong schema_version", () => {
  assert.throws(() => validateTask({ ...goodTask(), schema_version: "2" }), SchemaError);
});

test("validateTask marks a non-'analyze' operation as prohibited, not a throw", () => {
  const v = validateTask({ ...goodTask(), operation: "refund" });
  assert.equal(v.kind, "prohibited");
  assert.equal(v.operation, "refund");
});

test("validateTask rejects unknown fixture_refs key", () => {
  const t = goodTask();
  t.fixture_refs.extra = GOOD_REF;
  assert.throws(() => validateTask(t), SchemaError);
});

test("validateTask rejects non-integer population.declared_total", () => {
  const t = goodTask();
  t.options.population.declared_total = "zero";
  assert.throws(() => validateTask(t), SchemaError);
});

test("validateTask rejects non-finite header claim", () => {
  const t = goodTask();
  t.options.header_claims.csat_mean = Infinity;
  assert.throws(() => validateTask(t), SchemaError);
});

test("validateSourceRef rejects short commit hash", () => {
  assert.throws(() => validateSourceRef({ ...GOOD_REF, commit: "abc" }, "ref"), SchemaError);
});

test("validateSourceRef rejects wrong algorithm", () => {
  assert.throws(() => validateSourceRef({ ...GOOD_REF, algorithm: "sha256" }, "ref"), SchemaError);
});

test("validateTicket accepts a well-formed ticket", () => {
  assert.equal(validateTicket(goodTicket(), "t").ticket_id, "t-1");
});

test("validateTicket rejects missing required field", () => {
  const t = goodTicket();
  delete t.notes;
  assert.throws(() => validateTicket(t, "t"), SchemaError);
});

test("validateTicket rejects unknown property", () => {
  assert.throws(() => validateTicket({ ...goodTicket(), extra: 1 }, "t"), SchemaError);
});

test("validateTicket rejects invalid status enum", () => {
  assert.throws(() => validateTicket({ ...goodTicket(), status: "CLOSED" }, "t"), SchemaError);
});

test("validateTicket rejects invalid impact enum", () => {
  assert.throws(() => validateTicket({ ...goodTicket(), impact: "SEVERE" }, "t"), SchemaError);
});

test("validateTicket rejects lowercase tag (tags are uppercase)", () => {
  assert.throws(() => validateTicket({ ...goodTicket(), issue_tags: ["technical"] }, "t"), SchemaError);
});

test("validateTicket rejects duplicate tags within one ticket", () => {
  assert.throws(() => validateTicket({ ...goodTicket(), issue_tags: ["TECHNICAL", "TECHNICAL"] }, "t"), SchemaError);
});

test("validateTicket rejects rating out of 1..5 range", () => {
  assert.throws(() => validateTicket({ ...goodTicket(), rating: 6 }, "t"), SchemaError);
});

test("validateTicket rejects malformed ISO date", () => {
  assert.throws(() => validateTicket({ ...goodTicket(), created_at: "2026/06/01" }, "t"), SchemaError);
});

test("validateTicket rejects a nonexistent calendar date", () => {
  assert.throws(() => validateTicket({ ...goodTicket(), created_at: "2026-02-30T00:00:00Z" }, "t"), SchemaError);
});

test("validateContext rejects unknown top-level property", () => {
  assert.throws(
    () =>
      validateContext({
        clock: 0,
        sources: { "a|b.md": { revisions: { [GOOD_REF.commit]: { text: "x", blob: GOOD_REF.blob } } } },
        readGrants: [],
        principal: { principal_id: "p", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
        criteria: { taxonomy_version: "v1", response_sla_minutes: 30, policy_ref: GOOD_REF },
        extra: true,
      }, makeBudget()),
    SchemaError
  );
});

test("validateContext rejects a non-finite clock", () => {
  assert.throws(() => validateContext({ clock: NaN, sources: {}, readGrants: [], principal: {}, criteria: {} }, makeBudget()), SchemaError);
});

test("validateContext rejects invalid principal role", () => {
  assert.throws(
    () =>
      validateContext({
        clock: 0,
        sources: { "a|b.md": { revisions: { [GOOD_REF.commit]: { text: "x", blob: GOOD_REF.blob } } } },
        readGrants: [],
        principal: { principal_id: "p", role: "ADMIN", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
        criteria: { taxonomy_version: "v1", response_sla_minutes: 30, policy_ref: GOOD_REF },
      }, makeBudget()),
    SchemaError
  );
});

test("validateContext rejects negative response_sla_minutes", () => {
  assert.throws(
    () =>
      validateContext({
        clock: 0,
        sources: { "a|b.md": { revisions: { [GOOD_REF.commit]: { text: "x", blob: GOOD_REF.blob } } } },
        readGrants: [],
        principal: { principal_id: "p", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
        criteria: { taxonomy_version: "v1", response_sla_minutes: -5, policy_ref: GOOD_REF },
      }, makeBudget()),
    SchemaError
  );
});
