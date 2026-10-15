/**
 * schemas.test.js — runtime validation unit tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSourceRef,
  validateTask,
  validateRegistryEntry,
  validateRegistration,
  validateContext,
  validateIsoDate,
  SchemaError,
} from "../src/schemas.js";
import { registryEntryDigest } from "../src/canonical.js";

const goodRef = {
  repo: "edu-sources",
  path: "recordkeeping/basics-current.md",
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

test("impossible calendar date rejected", () => {
  assert.throws(() => validateIsoDate("2026-02-30T00:00:00Z", "t"), SchemaError);
  assert.equal(validateIsoDate("2026-02-28T00:00:00Z", "t"), Date.parse("2026-02-28T00:00:00Z"));
});

const goodTask = {
  task_id: "demo-task-001",
  requested_action: "draft_education",
  topic_id: "recordkeeping-basics",
  topic_label: "Recordkeeping Basics",
  jurisdiction: "US-FEDERAL",
  tax_year: 2026,
  as_of_date: "2026-06-01T00:00:00Z",
  mode: "current_education",
  source_refs: [],
};

test("task schema: prohibited kind detected", () => {
  const t = validateTask({ ...goodTask, requested_action: "file_tax_return" });
  assert.equal(t.kind, "prohibited");
});

test("task schema: draft_education kind detected", () => {
  assert.equal(validateTask(goodTask).kind, "draft");
});

test("task schema: bad as_of_date rejected", () => {
  assert.throws(() => validateTask({ ...goodTask, as_of_date: "tomorrow" }), SchemaError);
});

test("task schema: unsupported jurisdiction rejected", () => {
  assert.throws(() => validateTask({ ...goodTask, jurisdiction: "US-CA" }), SchemaError);
});

test("task schema: unsupported tax_year rejected", () => {
  assert.throws(() => validateTask({ ...goodTask, tax_year: 2019 }), SchemaError);
  assert.throws(() => validateTask({ ...goodTask, tax_year: 2031 }), SchemaError);
  assert.throws(() => validateTask({ ...goodTask, tax_year: 2026.5 }), SchemaError);
});

test("task schema: unknown topic_id does not throw (routes to review, not invalid)", () => {
  const t = validateTask({ ...goodTask, topic_id: "reps-qualification", topic_label: "REPS Qualification" });
  assert.equal(t.topic_id, "reps-qualification");
});

test("task schema: invalid mode rejected", () => {
  assert.throws(() => validateTask({ ...goodTask, mode: "future_education" }), SchemaError);
});

test("task schema: unknown top-level property rejected", () => {
  assert.throws(() => validateTask({ ...goodTask, extra: 1 }), SchemaError);
});

const goodEntryBase = {
  topic_id: "recordkeeping-basics",
  topic_label: "Recordkeeping Basics",
  entry_version: "v1",
  jurisdiction: "US-FEDERAL",
  steward_id: "steward-tax-edu",
  registration_ref: "reg-tax-001",
  review_record_ref: "review-rk-001",
  registry_ref: { ...goodRef, path: "registry/recordkeeping-basics-entry.md" },
  current: {
    tax_year_from: 2024, tax_year_to: 2026,
    effective_from: "2024-01-01T00:00:00Z", reviewed_through: "2026-12-31T23:59:59Z",
    claims: [{ claim_id: "claim-rk-cur-1", concept_key: "recordkeeping-categories", template_id: "general-educational", text: "x", source_ref: goodRef }],
  },
  historical: null,
};
const goodEntry = { ...goodEntryBase, entry_digest: registryEntryDigest(goodEntryBase) };

test("valid registry entry passes", () => {
  assert.equal(validateRegistryEntry(goodEntry, "t").topic_id, "recordkeeping-basics");
});

test("registry entry requires registry_ref and entry_digest", () => {
  const { registry_ref, ...noRef } = goodEntry;
  assert.throws(() => validateRegistryEntry(noRef, "t"), SchemaError);
  const { entry_digest, ...noDigest } = goodEntry;
  assert.throws(() => validateRegistryEntry(noDigest, "t"), SchemaError);
});

test("registry entry rejects a malformed entry_digest", () => {
  assert.throws(() => validateRegistryEntry({ ...goodEntry, entry_digest: "not-hex" }, "t"), SchemaError);
  assert.throws(() => validateRegistryEntry({ ...goodEntry, entry_digest: "a".repeat(63) }, "t"), SchemaError);
});

const goodRegistration = {
  registration_ref: "reg-tax-001",
  steward_id: "steward-tax-edu",
  action_ids: ["register_topic"],
  valid_from: "2020-01-01T00:00:00Z",
  expires_at: "2030-01-01T00:00:00Z",
  revoked: false,
  topic_id: "recordkeeping-basics",
  entry_version: "v1",
  jurisdiction: "US-FEDERAL",
  entry_digest: goodEntry.entry_digest,
};

test("valid registration passes", () => {
  assert.equal(validateRegistration(goodRegistration, "t").entry_digest, goodEntry.entry_digest);
});

test("registration requires topic_id/entry_version/jurisdiction/entry_digest binding fields", () => {
  for (const key of ["topic_id", "entry_version", "jurisdiction", "entry_digest"]) {
    const { [key]: _drop, ...bad } = goodRegistration;
    assert.throws(() => validateRegistration(bad, "t"), SchemaError, `missing ${key} must be rejected`);
  }
});

test("registration rejects an unregistered jurisdiction or malformed digest", () => {
  assert.throws(() => validateRegistration({ ...goodRegistration, jurisdiction: "US-CA" }, "t"), SchemaError);
  assert.throws(() => validateRegistration({ ...goodRegistration, entry_digest: "z".repeat(64) }, "t"), SchemaError);
});

test("registry entry requires at least one coverage block", () => {
  assert.throws(() => validateRegistryEntry({ ...goodEntry, current: null, historical: null }, "t"), SchemaError);
});

test("registry entry rejects duplicate claim_id within a block", () => {
  const bad = { ...goodEntry, current: { ...goodEntry.current, claims: [goodEntry.current.claims[0], goodEntry.current.claims[0]] } };
  assert.throws(() => validateRegistryEntry(bad, "t"), SchemaError);
});

test("context rejects duplicate registry topic_id", () => {
  const base = { clock: 1, registry: [goodEntry, goodEntry], sources: { "edu-sources|recordkeeping/basics-current.md": { revisions: {} } }, readGrants: [], stewards: [], registrations: [], reviewRecords: [] };
  assert.throws(() => validateContext(base), SchemaError);
});
