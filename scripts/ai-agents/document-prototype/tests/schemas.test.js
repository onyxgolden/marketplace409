import test from "node:test";
import assert from "node:assert/strict";
import {
  SchemaError,
  validateDate,
  validateSourceRef,
  validateDocument,
  validateAssertion,
  validateDocumentSetShape,
  validateTask,
  validateContext,
} from "../src/schemas.js";
import { makeBudget } from "../src/resolver.js";

const REF = { repo: "edu-sources", path: "content/x.txt", commit: "a".repeat(40), blob: "b".repeat(40), algorithm: "git-sha1", revision: "v1" };

test("validateDate rejects non-calendar dates and wrong format", () => {
  assert.throws(() => validateDate("2026-02-30", "x"), SchemaError); // not a real date
  assert.throws(() => validateDate("2026/01/01", "x"), SchemaError);
  assert.throws(() => validateDate(20260101, "x"), SchemaError);
  assert.doesNotThrow(() => validateDate("2026-01-01", "x"));
});

test("validateSourceRef rejects short/uppercase hex and wrong algorithm", () => {
  assert.throws(() => validateSourceRef({ ...REF, commit: "A".repeat(40) }, "x"), SchemaError);
  assert.throws(() => validateSourceRef({ ...REF, blob: "b".repeat(39) }, "x"), SchemaError);
  assert.throws(() => validateSourceRef({ ...REF, algorithm: "sha256" }, "x"), SchemaError);
  assert.throws(() => validateSourceRef({ ...REF, extra: 1 }, "x"), SchemaError);
});

function baseDoc(overrides = {}) {
  return {
    doc_id: "d-1",
    logical_id: "spec-a",
    revision: 1,
    declared_date: "2026-01-01",
    metadata: { author: "a", date: "2026-01-01", id: "d-1", status: "draft" },
    content_ref: REF,
    sections: [],
    markers: [],
    references: [],
    ...overrides,
  };
}

test("validateDocument accepts a well-formed record", () => {
  const d = validateDocument(baseDoc(), "x", makeBudget());
  assert.equal(d.doc_id, "d-1");
});

test("validateDocument rejects unknown property, bad revision, dup section id, dup marker key", () => {
  assert.throws(() => validateDocument({ ...baseDoc(), extra: 1 }, "x", makeBudget()), SchemaError);
  assert.throws(() => validateDocument(baseDoc({ revision: 0 }), "x", makeBudget()), SchemaError);
  assert.throws(() => validateDocument(baseDoc({ revision: 1.5 }), "x", makeBudget()), SchemaError);
  assert.throws(
    () => validateDocument(baseDoc({ sections: [{ section_id: "s", start_byte: 0, end_byte: 1 }, { section_id: "s", start_byte: 2, end_byte: 3 }] }), "x", makeBudget()),
    SchemaError
  );
  assert.throws(
    () => validateDocument(baseDoc({ markers: [{ key: "author", start_byte: 0, end_byte: 1 }, { key: "author", start_byte: 2, end_byte: 3 }] }), "x", makeBudget()),
    SchemaError
  );
});

test("validateDocument rejects section/marker spans where end <= start", () => {
  assert.throws(() => validateDocument(baseDoc({ sections: [{ section_id: "s", start_byte: 5, end_byte: 5 }] }), "x", makeBudget()), SchemaError);
  assert.throws(() => validateDocument(baseDoc({ markers: [{ key: "id", start_byte: 5, end_byte: 3 }] }), "x", makeBudget()), SchemaError);
});

test("validateDocument reference rules: INTERNAL requires target_doc_id and forbids external_pointer; EXTERNAL requires external_pointer and forbids target fields", () => {
  const internalOk = { ref_id: "r1", kind: "CITATION", target_kind: "INTERNAL", target_doc_id: "d-2", target_section_id: null, external_pointer: null };
  assert.doesNotThrow(() => validateDocument(baseDoc({ references: [internalOk] }), "x", makeBudget()));
  const internalMissingTarget = { ref_id: "r1", kind: "CITATION", target_kind: "INTERNAL", target_doc_id: null, target_section_id: null, external_pointer: null };
  assert.throws(() => validateDocument(baseDoc({ references: [internalMissingTarget] }), "x", makeBudget()), SchemaError);
  const internalWithPointer = { ref_id: "r1", kind: "CITATION", target_kind: "INTERNAL", target_doc_id: "d-2", target_section_id: null, external_pointer: "https://x" };
  assert.throws(() => validateDocument(baseDoc({ references: [internalWithPointer] }), "x", makeBudget()), SchemaError);
  const externalOk = { ref_id: "r1", kind: "CITATION", target_kind: "EXTERNAL", target_doc_id: null, target_section_id: null, external_pointer: "https://x" };
  assert.doesNotThrow(() => validateDocument(baseDoc({ references: [externalOk] }), "x", makeBudget()));
  const externalMissingPointer = { ref_id: "r1", kind: "CITATION", target_kind: "EXTERNAL", target_doc_id: null, target_section_id: null, external_pointer: null };
  assert.throws(() => validateDocument(baseDoc({ references: [externalMissingPointer] }), "x", makeBudget()), SchemaError);
  const externalWithTarget = { ref_id: "r1", kind: "CITATION", target_kind: "EXTERNAL", target_doc_id: "d-2", target_section_id: null, external_pointer: "https://x" };
  assert.throws(() => validateDocument(baseDoc({ references: [externalWithTarget] }), "x", makeBudget()), SchemaError);
  const dupRefId = [internalOk, { ...internalOk }];
  assert.throws(() => validateDocument(baseDoc({ references: dupRefId }), "x", makeBudget()), SchemaError);
});

function baseAssertion(overrides = {}) {
  return {
    assertion_id: "a-1",
    doc_id: "d-1",
    subject: "unit-x",
    property: "capacity",
    scope: "rated",
    value_type: "NUMBER",
    value: 10,
    span: { start_byte: 0, end_byte: 5 },
    ...overrides,
  };
}

test("validateAssertion enforces value type matches value_type", () => {
  assert.doesNotThrow(() => validateAssertion(baseAssertion(), "x"));
  assert.throws(() => validateAssertion(baseAssertion({ value_type: "STRING", value: 10 }), "x"), SchemaError);
  assert.throws(() => validateAssertion(baseAssertion({ value_type: "NUMBER", value: "10" }), "x"), SchemaError);
  assert.throws(() => validateAssertion(baseAssertion({ value_type: "NUMBER", value: NaN }), "x"), SchemaError);
  assert.throws(() => validateAssertion(baseAssertion({ value_type: "BOOLEAN", value: "true" }), "x"), SchemaError);
  assert.doesNotThrow(() => validateAssertion(baseAssertion({ value_type: "BOOLEAN", value: true }), "x"));
  assert.doesNotThrow(() => validateAssertion(baseAssertion({ value_type: "STRING", value: "hello" }), "x"));
});

test("validateAssertion rejects span where end <= start", () => {
  assert.throws(() => validateAssertion(baseAssertion({ span: { start_byte: 5, end_byte: 5 } }), "x"), SchemaError);
});

test("validateDocumentSetShape enforces object shape with exactly documents/assertions arrays", () => {
  assert.doesNotThrow(() => validateDocumentSetShape({ documents: [], assertions: [] }, "x"));
  assert.throws(() => validateDocumentSetShape([], "x"), SchemaError);
  assert.throws(() => validateDocumentSetShape({ documents: [] }, "x"), SchemaError);
  assert.throws(() => validateDocumentSetShape({ documents: [], assertions: [], extra: 1 }, "x"), SchemaError);
});

test("validateTask rejects wrong schema_version and unknown fixture_refs key", () => {
  const task = {
    schema_version: "1",
    task_id: "t1",
    operation: "analyze",
    fixture_refs: { document_set: REF },
    options: { population: { declared_total: 0, complete: false } },
  };
  assert.doesNotThrow(() => validateTask(task));
  assert.throws(() => validateTask({ ...task, schema_version: "2" }), SchemaError);
  assert.throws(() => validateTask({ ...task, fixture_refs: { document_set: REF, extra: REF } }), SchemaError);
  const prohibited = validateTask({ ...task, operation: "mutate" });
  assert.equal(prohibited.kind, "prohibited");
});

test("validateContext rejects out-of-range source catalog size and malformed principal", () => {
  const ctx = {
    clock: Date.now(),
    sources: { "edu-sources|content/x.txt": { revisions: { [REF.commit]: { text: "hi", blob: REF.blob } } } },
    readGrants: [],
    principal: { principal_id: "p1", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
    criteria: { checklist_version: "v1", required_sections: [], required_companions: [], checklist_ref: REF },
  };
  assert.doesNotThrow(() => validateContext(ctx, makeBudget()));
  assert.throws(() => validateContext({ ...ctx, sources: {} }, makeBudget()), SchemaError);
  assert.throws(() => validateContext({ ...ctx, principal: { ...ctx.principal, role: "ADMIN" } }, makeBudget()), SchemaError);
  assert.throws(() => validateContext({ ...ctx, principal: { ...ctx.principal, registered_by: "someone-else" } }, makeBudget()), SchemaError);
});

test("validateContext charges principal and criteria as per-task candidates (DOC-002a, scoped)", () => {
  const ctx = {
    clock: Date.now(),
    sources: { "edu-sources|content/x.txt": { revisions: { [REF.commit]: { text: "hi", blob: REF.blob } } } },
    readGrants: [],
    principal: { principal_id: "p1", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
    criteria: { checklist_version: "v1", required_sections: [], required_companions: [], checklist_ref: REF },
  };
  // principal + criteria = 2 objects charged, regardless of catalog size
  // below — context.sources/readGrants are the host's large registered
  // catalog (the common contract's own explicit distinction from the
  // strict per-task budget), not per-task candidates in their own right.
  const budget = makeBudget();
  validateContext(ctx, budget);
  assert.equal(budget.used.objects, 2);

  // A large catalog — even one carrying an unused, oversized revision
  // nothing ever reads — must NOT by itself exhaust a task's budget: only
  // entries actually consulted (via resolveSourceRef, elsewhere) are
  // charged. This is the deliberate, documented resolution of DOC-002a's
  // literal "unused 300,000-byte revision" reproduction: catalog presence
  // alone costs nothing; actual consultation is what's bounded (and
  // already was, correctly, via resolveSourceRef's own charging).
  const bigCatalog = { ...ctx, sources: { ...ctx.sources } };
  for (let i = 0; i < 200; i++) {
    bigCatalog.sources[`edu-sources|content/extra-${i}.txt`] = { revisions: { [REF.commit]: { text: i === 100 ? "x".repeat(300000) : "small", blob: REF.blob } } };
  }
  const budget2 = makeBudget();
  assert.doesNotThrow(() => validateContext(bigCatalog, budget2));
  assert.equal(budget2.used.objects, 2);
});
