/**
 * schemas.test.js — runtime validation unit tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSourceRef,
  validateCitation,
  validateTask,
  validateSupersessionRecord,
  validateContext,
  validateIsoDate,
  SchemaError,
} from "../src/schemas.js";

const goodRef = {
  repo: "vault",
  path: "handbook/policies.md",
  commit: "a".repeat(40),
  blob: "b".repeat(40),
  algorithm: "git-sha1",
  revision: "rev-1",
};

test("valid SourceRef passes", () => {
  assert.deepEqual(validateSourceRef(goodRef, "t"), goodRef);
});

test("abbreviated commit pin rejected", () => {
  assert.throws(() => validateSourceRef({ ...goodRef, commit: "abc123" }, "t"), SchemaError);
});

test("wrong algorithm rejected", () => {
  assert.throws(() => validateSourceRef({ ...goodRef, algorithm: "sha256" }, "t"), SchemaError);
});

test("path traversal rejected", () => {
  assert.throws(() => validateSourceRef({ ...goodRef, path: "../etc/passwd" }, "t"), SchemaError);
  assert.throws(() => validateSourceRef({ ...goodRef, path: "/abs/path.md" }, "t"), SchemaError);
});

test("unknown SourceRef property rejected", () => {
  assert.throws(() => validateSourceRef({ ...goodRef, extra: 1 }, "t"), SchemaError);
});

test("citation requires quoted_span === span.quoted_text", () => {
  const line = "claim: wifi-password = x; units: string; scopes: facilities";
  const good = { ...goodRef, quoted_span: line, span: { start_byte: 0, end_byte: line.length, quoted_text: line }, verification: "VERIFIED" };
  assert.equal(validateCitation(good, "t").verification, "VERIFIED");
  const bad = { ...good, span: { start_byte: 0, end_byte: 5, quoted_text: "claim" } };
  assert.throws(() => validateCitation(bad, "t"), SchemaError);
});

test("citation verification must be VERIFIED", () => {
  const line = "claim: x = y";
  const c = { ...goodRef, quoted_span: line, span: { start_byte: 0, end_byte: line.length, quoted_text: line }, verification: "UNVERIFIED" };
  assert.throws(() => validateCitation(c, "t"), SchemaError);
});

test("impossible calendar date rejected", () => {
  assert.throws(() => validateIsoDate("2026-02-30T00:00:00Z", "t"), SchemaError);
  assert.equal(validateIsoDate("2026-02-28T00:00:00Z", "t"), Date.parse("2026-02-28T00:00:00Z"));
});

test("task schema: prohibited kind detected", () => {
  const t = validateTask({ query: "q", query_key: null, filters: { source_tags: [], max_source_age_days: null, as_of_date: null }, requested_action: "delete" });
  assert.equal(t.kind, "prohibited");
});

test("task schema: bad as_of_date rejected", () => {
  assert.throws(() => validateTask({ query: "q", query_key: null, filters: { source_tags: [], max_source_age_days: null, as_of_date: "tomorrow" }, requested_action: "answer" }), SchemaError);
});

test("supersession record requires matching pins shape", () => {
  const r = {
    record_id: "sup-1",
    issuer: "steward-ops",
    old_ref: goodRef,
    new_ref: { ...goodRef, commit: "c".repeat(40), blob: "d".repeat(40), revision: "rev-2" },
    effective_at: "2026-06-01T00:00:00Z",
    scope_ids: ["facilities"],
    registration_ref: "reg-001",
  };
  assert.equal(validateSupersessionRecord(r, "t").record_id, "sup-1");
});

test("context rejects duplicate steward ids", () => {
  const steward = { steward_id: "s1", registered_by: "jason", authority_scope_ids: ["facilities"], revoked: false, valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" };
  const base = { clock: 1, vocabulary: [{ query_key: "a-b", phrases: ["a b"] }], sources: { "v|p.md": {} }, readGrants: [], stewards: [steward, steward], registrations: [], supersessionRecords: [] };
  assert.throws(() => validateContext(base), SchemaError);
});
