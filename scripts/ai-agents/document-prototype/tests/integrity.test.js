import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDuplicateGroups,
  computeVersionConflicts,
  computeChecklistResults,
  computeMetadataVerification,
  computeReferenceEdges,
  detectCycles,
  computeCrossDocumentConflicts,
} from "../src/integrity.js";

function d(overrides) {
  return { doc_id: "d-1", logical_id: "l-1", revision: 1, declared_date: "2026-01-01", contentSha256: "h1", sections: [], references: [], ...overrides };
}

test("computeDuplicateGroups groups by content hash, ignores singletons", () => {
  const groups = computeDuplicateGroups([d({ doc_id: "a", contentSha256: "h1" }), d({ doc_id: "b", contentSha256: "h1" }), d({ doc_id: "c", contentSha256: "h2" })]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].doc_ids, ["a", "b"]);
  assert.equal(groups[0].evidence_state, "verified");
});

test("computeDuplicateGroups retains distinct doc_ids across logical_id/revision differences", () => {
  const groups = computeDuplicateGroups([
    d({ doc_id: "a", logical_id: "x", revision: 1, contentSha256: "h1" }),
    d({ doc_id: "b", logical_id: "y", revision: 9, contentSha256: "h1" }),
  ]);
  assert.deepEqual(groups[0].doc_ids, ["a", "b"]);
});

test("computeVersionConflicts flags PARALLEL_VERSION when same logical_id+revision diverge in content", () => {
  const conflicts = computeVersionConflicts([
    d({ doc_id: "a", logical_id: "x", revision: 2, contentSha256: "h1" }),
    d({ doc_id: "b", logical_id: "x", revision: 2, contentSha256: "h2" }),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "PARALLEL_VERSION");
  assert.equal(conflicts[0].evidence_state, "mismatch");
});

test("computeVersionConflicts does not flag same revision with identical content as parallel", () => {
  const conflicts = computeVersionConflicts([
    d({ doc_id: "a", logical_id: "x", revision: 1, contentSha256: "h1" }),
    d({ doc_id: "b", logical_id: "x", revision: 1, contentSha256: "h1" }),
  ]);
  assert.equal(conflicts.filter((c) => c.type === "PARALLEL_VERSION").length, 0);
});

test("computeVersionConflicts flags TIMELINE_MISMATCH when a later revision has an earlier-or-equal date", () => {
  const conflicts = computeVersionConflicts([
    d({ doc_id: "a", logical_id: "x", revision: 1, declared_date: "2026-03-05", contentSha256: "h1" }),
    d({ doc_id: "b", logical_id: "x", revision: 2, declared_date: "2026-03-01", contentSha256: "h2" }),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "TIMELINE_MISMATCH");
});

test("computeVersionConflicts does not flag a strictly increasing valid sequence", () => {
  const conflicts = computeVersionConflicts([
    d({ doc_id: "a", logical_id: "x", revision: 1, declared_date: "2026-01-01", contentSha256: "h1" }),
    d({ doc_id: "b", logical_id: "x", revision: 2, declared_date: "2026-02-01", contentSha256: "h2" }),
    d({ doc_id: "c", logical_id: "x", revision: 3, declared_date: "2026-03-01", contentSha256: "h3" }),
  ]);
  assert.equal(conflicts.length, 0);
});

test("computeVersionConflicts never selects a 'latest' or 'authoritative' document", () => {
  const conflicts = computeVersionConflicts([
    d({ doc_id: "a", logical_id: "x", revision: 1, declared_date: "2026-01-01", contentSha256: "h1" }),
    d({ doc_id: "b", logical_id: "x", revision: 2, declared_date: "2026-02-01", contentSha256: "h2" }),
  ]);
  for (const c of conflicts) {
    assert.ok(!("authoritative_doc_id" in c));
    assert.ok(!("current" in c));
  }
});

test("computeChecklistResults: present sections/companions are verified, missing ones are mismatch", () => {
  const criteria = { checklist_version: "v1", required_sections: ["scope", "missing-section"], required_companions: ["comp-a", "missing-comp"] };
  const docs = [d({ doc_id: "a", logical_id: "comp-a", sections: [{ section_id: "scope", start_byte: 0, end_byte: 1 }] })];
  const r = computeChecklistResults(criteria, docs);
  const scope = r.required_sections.find((s) => s.section_id === "scope");
  const missingSection = r.required_sections.find((s) => s.section_id === "missing-section");
  assert.equal(scope.present, true);
  assert.equal(scope.evidence_state, "verified");
  assert.equal(missingSection.present, false);
  assert.equal(missingSection.evidence_state, "mismatch");
  const compA = r.required_companions.find((c) => c.logical_id === "comp-a");
  assert.equal(compA.present, true);
  assert.equal(r.overall, "MISMATCH");
});

test("computeChecklistResults: overall SATISFIED only when every requirement is met", () => {
  const criteria = { checklist_version: "v1", required_sections: ["scope"], required_companions: [] };
  const docs = [d({ sections: [{ section_id: "scope", start_byte: 0, end_byte: 1 }] })];
  assert.equal(computeChecklistResults(criteria, docs).overall, "SATISFIED");
});

test("computeMetadataVerification: absent marker is unverifiable, present-and-matching is verified, present-and-differing is mismatch", () => {
  const doc = { metadata: { author: "Jane", date: "2026-01-01", id: "x", status: "draft" } };
  const markerTexts = new Map([["author", "Jane"], ["date", "2099-01-01"]]);
  const r = computeMetadataVerification(doc, markerTexts);
  assert.equal(r.find((x) => x.key === "author").evidence_state, "verified");
  assert.equal(r.find((x) => x.key === "date").evidence_state, "mismatch");
  assert.equal(r.find((x) => x.key === "id").evidence_state, "unverifiable");
});

function docWithRefs(doc_id, refs, sections = []) {
  return d({ doc_id, references: refs, sections });
}

test("computeReferenceEdges: EXTERNAL is always EXTERNAL_REFERENCE/unverifiable and never resolved", () => {
  const docs = [docWithRefs("a", [{ ref_id: "r1", kind: "CITATION", target_kind: "EXTERNAL", target_doc_id: null, target_section_id: null, external_pointer: "https://x" }])];
  const edges = computeReferenceEdges(docs);
  assert.equal(edges[0].status, "EXTERNAL_REFERENCE");
  assert.equal(edges[0].evidence_state, "unverifiable");
});

test("computeReferenceEdges: INTERNAL missing document is mismatch", () => {
  const docs = [docWithRefs("a", [{ ref_id: "r1", kind: "PREREQUISITE", target_kind: "INTERNAL", target_doc_id: "nope", target_section_id: null, external_pointer: null }])];
  const edges = computeReferenceEdges(docs);
  assert.equal(edges[0].status, "MISMATCH");
  assert.equal(edges[0].reason, "missing internal document");
});

test("computeReferenceEdges: INTERNAL missing section on an existing target is mismatch", () => {
  const docs = [
    docWithRefs("a", [{ ref_id: "r1", kind: "CITATION", target_kind: "INTERNAL", target_doc_id: "b", target_section_id: "nope", external_pointer: null }]),
    docWithRefs("b", []),
  ];
  const edges = computeReferenceEdges(docs);
  assert.equal(edges[0].status, "MISMATCH");
  assert.equal(edges[0].reason, "missing internal section");
});

test("computeReferenceEdges: INTERNAL resolved document+section is verified", () => {
  const docs = [
    docWithRefs("a", [{ ref_id: "r1", kind: "CITATION", target_kind: "INTERNAL", target_doc_id: "b", target_section_id: "s1", external_pointer: null }]),
    docWithRefs("b", [], [{ section_id: "s1", start_byte: 0, end_byte: 1 }]),
  ];
  const edges = computeReferenceEdges(docs);
  assert.equal(edges[0].status, "RESOLVED");
  assert.equal(edges[0].evidence_state, "verified");
});

test("detectCycles finds a two-node cycle and returns it canonically rotated", () => {
  const docs = [
    docWithRefs("b-doc", [{ ref_id: "r1", kind: "PREREQUISITE", target_kind: "INTERNAL", target_doc_id: "a-doc", target_section_id: null, external_pointer: null }]),
    docWithRefs("a-doc", [{ ref_id: "r2", kind: "PREREQUISITE", target_kind: "INTERNAL", target_doc_id: "b-doc", target_section_id: null, external_pointer: null }]),
  ];
  const cycles = detectCycles(docs, "PREREQUISITE");
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ["a-doc", "b-doc"]);
});

test("detectCycles never crosses reference kinds (a PREREQUISITE edge does not create a CITATION cycle)", () => {
  const docs = [
    docWithRefs("a", [{ ref_id: "r1", kind: "PREREQUISITE", target_kind: "INTERNAL", target_doc_id: "b", target_section_id: null, external_pointer: null }]),
    docWithRefs("b", [{ ref_id: "r2", kind: "PREREQUISITE", target_kind: "INTERNAL", target_doc_id: "a", target_section_id: null, external_pointer: null }]),
  ];
  assert.equal(detectCycles(docs, "CITATION").length, 0);
  assert.equal(detectCycles(docs, "PREREQUISITE").length, 1);
});

test("detectCycles with no cycle returns empty", () => {
  const docs = [
    docWithRefs("a", [{ ref_id: "r1", kind: "CITATION", target_kind: "INTERNAL", target_doc_id: "b", target_section_id: null, external_pointer: null }]),
    docWithRefs("b", []),
  ];
  assert.equal(detectCycles(docs, "CITATION").length, 0);
});

function citedAssertion(assertion_id, doc_id, value_type, value) {
  return { assertion_id, doc_id, subject: "s", property: "p", scope: "sc", value_type, value, citation: { quoted_span: String(value) } };
}

test("computeCrossDocumentConflicts flags differing values across distinct doc_ids on the same subject/property/scope", () => {
  const conflicts = computeCrossDocumentConflicts([citedAssertion("a1", "d1", "NUMBER", 500), citedAssertion("a2", "d2", "NUMBER", 750)]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].assertions.length, 2);
  assert.equal(conflicts[0].evidence_state, "mismatch");
});

test("computeCrossDocumentConflicts does not flag agreeing values across documents", () => {
  const conflicts = computeCrossDocumentConflicts([citedAssertion("a1", "d1", "NUMBER", 500), citedAssertion("a2", "d2", "NUMBER", 500)]);
  assert.equal(conflicts.length, 0);
});

test("computeCrossDocumentConflicts does not flag two differing assertions from the SAME document (no cross-document conflict)", () => {
  const conflicts = computeCrossDocumentConflicts([citedAssertion("a1", "d1", "NUMBER", 500), citedAssertion("a2", "d1", "NUMBER", 750)]);
  assert.equal(conflicts.length, 0);
});

test("computeCrossDocumentConflicts shows every passage in a multi-document conflict group, not just two", () => {
  const conflicts = computeCrossDocumentConflicts([citedAssertion("a1", "d1", "NUMBER", 500), citedAssertion("a2", "d2", "NUMBER", 750), citedAssertion("a3", "d3", "NUMBER", 900)]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].assertions.length, 3);
});
