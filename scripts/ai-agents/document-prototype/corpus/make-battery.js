#!/usr/bin/env node
/**
 * make-battery.js — AUTHORING TOOL (not part of the scored path).
 *
 * Authors corpus/battery.json: >=120 independently specified cases
 * against the frozen fixtures in fixtures/store.json. The "oracle"
 * functions below are an INDEPENDENT re-derivation of the brief's rules
 * (exact-duplicate content hashing, version-conflict detection, checklist
 * coverage, reference-graph resolution + cycle detection, cross-document
 * assertion conflicts) written from the brief's text, not by importing or
 * mirroring src/*. They exist only to make hand-deriving 120+ expected
 * structural projections tractable without transcription error — every
 * case's expected value is still a property of the brief's own stated
 * rules, never of the implementation under test.
 *
 * Category targets (per this slice's brief): 40 nominal/boundary domain,
 * 30 contradiction/incomplete/duplicate, 20 injection/prohibited-
 * operation, 20 schema/provenance/permission, 10 budget/replay/mutation.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rawSetOf(setName) {
  const ref = store.documentSetRefs[setName];
  const key = `${ref.repo}|${ref.path}`;
  const text = store.sources[key].revisions[ref.commit].text;
  return JSON.parse(text);
}

function resolvedTextOf(contentRef) {
  const key = `${contentRef.repo}|${contentRef.path}`;
  return store.sources[key].revisions[contentRef.commit].text;
}

// ---------------------------------------------------------------------
// Independent oracle (re-derived from the brief, not from src/*)
// ---------------------------------------------------------------------

const INJECTED_DOC_IDS = new Set(["d-inj-1", "d-injmd-1", "d-inj-html-1", "d-inj-js-1", "d-inj-two-a", "d-inj-two-b", "d-inj-sib-bad"]);

function oracleDocsWithHashes(documents) {
  return documents.map((doc) => {
    const text = resolvedTextOf(doc.content_ref);
    return { ...doc, contentSha256: sha256(Buffer.from(text, "utf8")), quarantined: INJECTED_DOC_IDS.has(doc.doc_id) };
  });
}

function oracleDuplicateGroups(docs) {
  const byHash = {};
  for (const d of docs) (byHash[d.contentSha256] ??= []).push(d.doc_id);
  return Object.entries(byHash)
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ content_sha256: hash, doc_ids: [...ids].sort() }))
    .sort((a, b) => (a.content_sha256 < b.content_sha256 ? -1 : 1));
}

function oracleVersionConflicts(docs) {
  const byLogical = {};
  for (const d of docs) (byLogical[d.logical_id] ??= []).push(d);
  const out = [];
  for (const [logical_id, group] of Object.entries(byLogical)) {
    if (group.length < 2) continue;
    const byRev = {};
    for (const d of group) (byRev[d.revision] ??= []).push(d);
    for (const [revision, bucket] of Object.entries(byRev)) {
      const distinct = new Set(bucket.map((d) => d.contentSha256));
      if (distinct.size > 1) out.push({ type: "PARALLEL_VERSION", logical_id, doc_ids: bucket.map((d) => d.doc_id).sort() });
    }
    const repByRev = {};
    for (const d of group) if (!(d.revision in repByRev)) repByRev[d.revision] = d;
    const seq = Object.values(repByRev).sort((a, b) => a.revision - b.revision);
    for (let i = 1; i < seq.length; i++) {
      if (!(seq[i].declared_date > seq[i - 1].declared_date)) {
        out.push({ type: "TIMELINE_MISMATCH", logical_id, doc_ids: [seq[i - 1].doc_id, seq[i].doc_id].sort() });
      }
    }
  }
  return out.sort((a, b) => (a.logical_id < b.logical_id ? -1 : a.logical_id > b.logical_id ? 1 : a.type < b.type ? -1 : 1));
}

function oracleChecklist(criteria, docs) {
  const sectionDocs = {};
  const logicalDocs = {};
  for (const d of docs) {
    if (d.quarantined) continue;
    for (const s of d.sections) (sectionDocs[s.section_id] ??= []).push(d.doc_id);
    (logicalDocs[d.logical_id] ??= []).push(d.doc_id);
  }
  const required_sections = criteria.required_sections
    .map((id) => ({ section_id: id, present: !!sectionDocs[id], evidence_state: sectionDocs[id] ? "verified" : "mismatch" }))
    .sort((a, b) => (a.section_id < b.section_id ? -1 : 1));
  const required_companions = criteria.required_companions
    .map((id) => ({ logical_id: id, present: !!logicalDocs[id], evidence_state: logicalDocs[id] ? "verified" : "mismatch" }))
    .sort((a, b) => (a.logical_id < b.logical_id ? -1 : 1));
  const overall = required_sections.every((s) => s.present) && required_companions.every((s) => s.present) ? "SATISFIED" : "MISMATCH";
  return { overall, required_sections, required_companions };
}

function oracleReferenceEdges(docs) {
  const byId = {};
  for (const d of docs) byId[d.doc_id] = d;
  const edges = [];
  for (const d of docs) {
    for (const r of d.references) {
      if (r.target_kind === "EXTERNAL") {
        edges.push({ ref_id: r.ref_id, status: "EXTERNAL_REFERENCE", evidence_state: "unverifiable" });
        continue;
      }
      const target = byId[r.target_doc_id];
      if (!target) {
        edges.push({ ref_id: r.ref_id, status: "MISMATCH", evidence_state: "mismatch" });
        continue;
      }
      if (r.target_section_id && !target.sections.some((s) => s.section_id === r.target_section_id)) {
        edges.push({ ref_id: r.ref_id, status: "MISMATCH", evidence_state: "mismatch" });
        continue;
      }
      edges.push({ ref_id: r.ref_id, status: "RESOLVED", evidence_state: "verified" });
    }
  }
  return edges.sort((a, b) => (a.ref_id < b.ref_id ? -1 : 1));
}

/** BFS-based reachability cycle check — deliberately a different
 *  algorithm from src/integrity.js's DFS-with-color-stack, so the two
 *  implementations could genuinely diverge on a bug. Returns the sorted
 *  list of doc_ids that participate in some cycle (reachable from
 *  themselves via >=1 edge), or null if none. This battery's actual
 *  cycle fixtures are simple mutual (2-node) cycles, where "all
 *  participating nodes, sorted" is exactly equal to src/integrity.js's
 *  lexicographically-rotated canonical path — stated plainly as a
 *  scoping limitation rather than silently assumed for larger cycles. */
function oracleCycleDocIds(docs, kind) {
  const adj = {};
  for (const d of docs) adj[d.doc_id] = [];
  for (const d of docs) {
    for (const r of d.references) {
      if (r.kind === kind && r.target_kind === "INTERNAL" && r.target_doc_id in adj) adj[d.doc_id].push(r.target_doc_id);
    }
  }
  const inCycle = new Set();
  for (const start of Object.keys(adj)) {
    const seen = new Set([start]);
    let frontier = [...adj[start]];
    while (frontier.length > 0) {
      const next = [];
      for (const n of frontier) {
        if (n === start) {
          inCycle.add(start);
          frontier = [];
          break;
        }
        if (!seen.has(n)) {
          seen.add(n);
          next.push(...(adj[n] ?? []));
        }
      }
      frontier = next;
    }
  }
  return inCycle.size > 0 ? [...inCycle].sort() : null;
}

function oracleCrossDocConflicts(assertions, docs) {
  const docById = {};
  for (const d of docs) docById[d.doc_id] = d;
  const byKey = {};
  for (const a of assertions) {
    const owner = docById[a.doc_id];
    if (!owner || owner.quarantined) continue;
    const key = `${a.subject}|${a.property}|${a.scope}`;
    (byKey[key] ??= []).push(a);
  }
  const out = [];
  for (const [key, group] of Object.entries(byKey)) {
    const distinctDocs = new Set(group.map((a) => a.doc_id));
    if (distinctDocs.size < 2) continue;
    const distinctVals = new Set(group.map((a) => `${a.value_type}:${JSON.stringify(a.value)}`));
    if (distinctVals.size < 2) continue;
    const [subject, property, scope] = key.split("|");
    out.push({ subject, property, scope, assertion_ids: group.map((a) => a.assertion_id).sort() });
  }
  return out.sort((a, b) => {
    const ka = `${a.subject}|${a.property}|${a.scope}`;
    const kb = `${b.subject}|${b.property}|${b.scope}`;
    return ka < kb ? -1 : 1;
  });
}

/** Per-document metadata-vs-content-marker verification: absent marker
 *  is unverifiable, present-and-matching is verified, present-and-
 *  differing is mismatch. Forced to all-unverifiable for quarantined
 *  content (a hostile document cannot manufacture a trusted marker). */
function oracleMetadataVerification(doc) {
  if (doc.quarantined) {
    return ["author", "date", "id", "status"].map((key) => ({ key, evidence_state: "unverifiable" }));
  }
  const text = resolvedTextOf(doc.content_ref);
  const bytes = Buffer.from(text, "utf8");
  const markerText = {};
  for (const m of doc.markers) {
    if (m.end_byte <= bytes.length) markerText[m.key] = bytes.slice(m.start_byte, m.end_byte).toString("utf8");
  }
  return ["author", "date", "id", "status"].map((key) => {
    if (!(key in markerText)) return { key, evidence_state: "unverifiable" };
    return { key, evidence_state: markerText[key] === doc.metadata[key] ? "verified" : "mismatch" };
  });
}

/** Full expected structural projection for a clean (non-refused) domain
 *  case, matching tests/harness.js's structuralOf() shape. */
function oracleProjection(setName, { criteriaName = "standard", declared_total, complete = true } = {}) {
  const raw = rawSetOf(setName);
  const docs = oracleDocsWithHashes(raw.documents);
  const criteria = store.criteria[criteriaName];
  const inventory = docs
    .map((d) => ({
      doc_id: d.doc_id,
      logical_id: d.logical_id,
      revision: d.revision,
      quarantined: d.quarantined,
      content_sha256: d.contentSha256,
      metadata_verification: oracleMetadataVerification(d).sort((a, b) => (a.key < b.key ? -1 : 1)),
    }))
    .sort((a, b) => (a.doc_id < b.doc_id ? -1 : 1));
  const populationVerified = complete === true && declared_total === raw.documents.length;
  const cycles = [];
  const prereqCycle = oracleCycleDocIds(docs, "PREREQUISITE");
  const citationCycle = oracleCycleDocIds(docs, "CITATION");
  if (prereqCycle) cycles.push({ kind: "PREREQUISITE", doc_ids: prereqCycle, status: "MISMATCH" });
  if (citationCycle) cycles.push({ kind: "CITATION", doc_ids: citationCycle, status: "CYCLE_DETECTED" });
  const admittedCount = docs.length;
  const coverageState = admittedCount === 0 ? (populationVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY") : populationVerified ? "COMPLETE" : "PARTIAL";
  return {
    status: docs.length === 0 ? "EMPTY" : populationVerified ? "REPORT_READY" : "PARTIAL",
    complete: true,
    diagnostic_codes: [],
    quarantined_doc_ids: docs.filter((d) => d.quarantined).map((d) => d.doc_id).sort(),
    inventory,
    duplicate_groups: oracleDuplicateGroups(docs),
    version_conflicts: oracleVersionConflicts(docs),
    checklist_results: { overall: oracleChecklist(criteria, docs).overall, required_sections: oracleChecklist(criteria, docs).required_sections, required_companions: oracleChecklist(criteria, docs).required_companions },
    reference_edges: oracleReferenceEdges(docs),
    cycles: cycles.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.doc_ids.join(">") < b.doc_ids.join(">") ? -1 : 1)),
    cross_document_conflicts: oracleCrossDocConflicts(raw.assertions ?? [], docs),
    excluded_ids: [],
    excluded_assertions: [],
    coverage: { state: coverageState, admitted_count: docs.length, excluded_count: 0 },
    population: { declared_total, complete, actual_total: raw.documents.length, evidence_state: !complete ? "unverifiable" : declared_total === raw.documents.length ? "verified" : "mismatch" },
  };
}

function trimForCompare(full, keys) {
  const out = {};
  for (const k of keys) out[k] = full[k];
  return out;
}

const DOMAIN_KEYS = [
  "status", "complete", "diagnostic_codes", "quarantined_doc_ids", "inventory", "duplicate_groups", "version_conflicts",
  "checklist_results", "reference_edges", "cycles", "cross_document_conflicts", "excluded_ids", "excluded_assertions",
  "coverage", "population",
];

function refusedExpected(code, overrides = {}) {
  return {
    status: "REFUSED",
    complete: false,
    diagnostic_codes: [code],
    quarantined_doc_ids: [],
    quarantined_other: [],
    source_ref_count: 0,
    inventory: [],
    duplicate_groups: [],
    version_conflicts: [],
    checklist_results: { overall: "UNKNOWN", required_sections: [], required_companions: [] },
    reference_edges: [],
    cycles: [],
    cross_document_conflicts: [],
    excluded_ids: [],
    excluded_assertions: [],
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
    population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
    ...overrides,
  };
}

function taskFor(setName, { declared_total, complete = true } = {}) {
  return {
    schema_version: "1",
    task_id: `t-${setName}-${declared_total}-${complete}`,
    operation: "analyze",
    fixture_refs: { document_set: store.documentSetRefs[setName] },
    options: { population: { declared_total, complete } },
  };
}

const cases = [];
function addCase(case_id, category, task, { principal = "jasonActive", criteria = "standard", clock = "2026-07-01T00:00:00Z", contextOverrides } = {}, expectedPartial, extraExpectedKeys = DOMAIN_KEYS) {
  const expected = {};
  for (const k of extraExpectedKeys) expected[k] = expectedPartial[k];
  if (!("quarantined_other" in expected)) expected.quarantined_other = expectedPartial.quarantined_other ?? [];
  if (!("source_ref_count" in expected)) expected.source_ref_count = expectedPartial.source_ref_count;
  cases.push({ case_id, category, principal, criteria, clock, contextOverrides, task, expected });
}

// ---- helper for a "domain" case with full oracle projection ----
function addDomainCase(case_id, category, setName, opts = {}) {
  const declared = opts.declared_total ?? rawSetOf(setName).documents.length;
  const complete = opts.complete ?? true;
  const criteriaName = opts.criteriaName ?? "standard";
  const proj = oracleProjection(setName, { criteriaName, declared_total: declared, complete });
  const task = taskFor(setName, { declared_total: declared, complete });
  const sourceRefCount = 2 + new Set(rawSetOf(setName).documents.filter((d) => !INJECTED_DOC_IDS.has(d.doc_id)).map((d) => `${d.content_ref.repo}|${d.content_ref.path}|${d.content_ref.commit}`)).size;
  addCase(case_id, category, task, { criteria: criteriaName }, { ...proj, source_ref_count: sourceRefCount, quarantined_other: [] });
}

// ======================= nominal/boundary domain (40) =======================
addDomainCase("nom-001-single-nominal", "nominal_boundary", "single-nominal");
addDomainCase("nom-002-single-nominal-incomplete", "nominal_boundary", "single-nominal", { complete: false });
addDomainCase("nom-003-single-nominal-mismatch", "nominal_boundary", "single-nominal", { declared_total: 5 });
addDomainCase("nom-004-checklist-satisfied", "nominal_boundary", "checklist-satisfied");
addDomainCase("nom-005-checklist-satisfied-norequirements", "nominal_boundary", "checklist-satisfied", { criteriaName: "noRequirements" });
addDomainCase("nom-006-checklist-missing-section", "nominal_boundary", "checklist-missing-section");
addDomainCase("nom-007-checklist-missing-section-norequirements", "nominal_boundary", "checklist-missing-section", { criteriaName: "noRequirements" });
addDomainCase("nom-008-checklist-missing-companion", "nominal_boundary", "checklist-missing-companion");
addDomainCase("nom-009-reference-internal-resolved", "nominal_boundary", "reference-internal-resolved");
addDomainCase("nom-010-reference-internal-resolved-incomplete", "nominal_boundary", "reference-internal-resolved", { complete: false });
addDomainCase("nom-011-reference-internal-missing-document", "nominal_boundary", "reference-internal-missing-document");
addDomainCase("nom-012-reference-internal-missing-section", "nominal_boundary", "reference-internal-missing-section");
addDomainCase("nom-013-reference-external", "nominal_boundary", "reference-external");
addDomainCase("nom-014-reference-external-mismatch-declared", "nominal_boundary", "reference-external", { declared_total: 9 });
addDomainCase("nom-015-prerequisite-cycle", "nominal_boundary", "prerequisite-cycle");
addDomainCase("nom-016-citation-cycle", "nominal_boundary", "citation-cycle");
addDomainCase("nom-017-cross-document-conflict", "nominal_boundary", "cross-document-conflict");
addDomainCase("nom-018-cross-document-conflict-incomplete", "nominal_boundary", "cross-document-conflict", { complete: false });
addDomainCase("nom-019-cross-document-consistent", "nominal_boundary", "cross-document-consistent");
addDomainCase("nom-020-metadata-marker-match", "nominal_boundary", "metadata-marker-match");
addDomainCase("nom-021-metadata-marker-mismatch", "nominal_boundary", "metadata-marker-mismatch");
addDomainCase("nom-022-two-documents-mixed", "nominal_boundary", "two-documents-mixed");
addDomainCase("nom-023-two-documents-mixed-incomplete", "nominal_boundary", "two-documents-mixed", { complete: false });
addDomainCase("nom-024-two-documents-mixed-mismatch", "nominal_boundary", "two-documents-mixed", { declared_total: 1 });
addDomainCase("nom-025-timeline-valid-sequence", "nominal_boundary", "timeline-valid-sequence");
addDomainCase("nom-026-timeline-valid-sequence-incomplete", "nominal_boundary", "timeline-valid-sequence", { complete: false });
addDomainCase("nom-027-empty-set-verified-empty", "nominal_boundary", "empty", { declared_total: 0 });
addDomainCase("nom-028-empty-set-unverified-empty", "nominal_boundary", "empty", { declared_total: 0, complete: false });
addDomainCase("nom-029-single-nominal-museRelay", "nominal_boundary", "single-nominal", {});
cases[cases.length - 1].principal = "museRelayActive";
addDomainCase("nom-030-checklist-satisfied-mismatch-declared", "nominal_boundary", "checklist-satisfied", { declared_total: 1 });
addDomainCase("nom-031-reference-internal-resolved-norequirements", "nominal_boundary", "reference-internal-resolved", { criteriaName: "noRequirements" });
addDomainCase("nom-032-reference-internal-missing-document-norequirements", "nominal_boundary", "reference-internal-missing-document", { criteriaName: "noRequirements" });
addDomainCase("nom-033-reference-internal-missing-section-norequirements", "nominal_boundary", "reference-internal-missing-section", { criteriaName: "noRequirements" });
addDomainCase("nom-034-citation-cycle-norequirements", "nominal_boundary", "citation-cycle", { criteriaName: "noRequirements" });
addDomainCase("nom-035-prerequisite-cycle-norequirements", "nominal_boundary", "prerequisite-cycle", { criteriaName: "noRequirements" });
addDomainCase("nom-036-cross-document-conflict-norequirements", "nominal_boundary", "cross-document-conflict", { criteriaName: "noRequirements" });
addDomainCase("nom-037-cross-document-consistent-incomplete", "nominal_boundary", "cross-document-consistent", { complete: false });
addDomainCase("nom-038-metadata-marker-match-incomplete", "nominal_boundary", "metadata-marker-match", { complete: false });
addDomainCase("nom-039-metadata-marker-mismatch-norequirements", "nominal_boundary", "metadata-marker-mismatch", { criteriaName: "noRequirements" });
addDomainCase("nom-040-reference-external-norequirements", "nominal_boundary", "reference-external", { criteriaName: "noRequirements" });

// ============ contradiction/incomplete/duplicate domain (30) ============
addDomainCase("ci-001-exact-duplicates", "contradiction_incomplete_duplicate", "exact-duplicates");
addDomainCase("ci-002-exact-duplicates-incomplete", "contradiction_incomplete_duplicate", "exact-duplicates", { complete: false });
addDomainCase("ci-003-exact-duplicates-mismatch", "contradiction_incomplete_duplicate", "exact-duplicates", { declared_total: 5 });
addDomainCase("ci-004-three-way-duplicates", "contradiction_incomplete_duplicate", "three-way-duplicates");
addDomainCase("ci-005-three-way-duplicates-incomplete", "contradiction_incomplete_duplicate", "three-way-duplicates", { complete: false });
addDomainCase("ci-006-parallel-version", "contradiction_incomplete_duplicate", "parallel-version");
addDomainCase("ci-007-parallel-version-incomplete", "contradiction_incomplete_duplicate", "parallel-version", { complete: false });
addDomainCase("ci-008-same-revision-identical-content", "contradiction_incomplete_duplicate", "same-revision-identical-content");
addDomainCase("ci-009-same-revision-identical-content-incomplete", "contradiction_incomplete_duplicate", "same-revision-identical-content", { complete: false });
addDomainCase("ci-010-timeline-reversal", "contradiction_incomplete_duplicate", "timeline-reversal");
addDomainCase("ci-011-timeline-reversal-incomplete", "contradiction_incomplete_duplicate", "timeline-reversal", { complete: false });
addDomainCase("ci-012-timeline-reversal-mismatch", "contradiction_incomplete_duplicate", "timeline-reversal", { declared_total: 9 });
addDomainCase("ci-013-exact-duplicates-norequirements", "contradiction_incomplete_duplicate", "exact-duplicates", { criteriaName: "noRequirements" });
addDomainCase("ci-014-three-way-duplicates-norequirements", "contradiction_incomplete_duplicate", "three-way-duplicates", { criteriaName: "noRequirements" });
addDomainCase("ci-015-parallel-version-norequirements", "contradiction_incomplete_duplicate", "parallel-version", { criteriaName: "noRequirements" });
addDomainCase("ci-016-same-revision-identical-content-norequirements", "contradiction_incomplete_duplicate", "same-revision-identical-content", { criteriaName: "noRequirements" });
addDomainCase("ci-017-timeline-reversal-norequirements", "contradiction_incomplete_duplicate", "timeline-reversal", { criteriaName: "noRequirements" });
addDomainCase("ci-018-exact-duplicates-museRelay", "contradiction_incomplete_duplicate", "exact-duplicates", {});
cases[cases.length - 1].principal = "museRelayActive";
addDomainCase("ci-019-three-way-duplicates-mismatch", "contradiction_incomplete_duplicate", "three-way-duplicates", { declared_total: 1 });
addDomainCase("ci-020-same-revision-identical-content-mismatch", "contradiction_incomplete_duplicate", "same-revision-identical-content", { declared_total: 1 });

// Hand-specified structural-corruption and referential cases (oracle not
// applicable: these exercise exclusion/refusal paths directly).
function addHandCase(case_id, category, task, expected, opts = {}) {
  addCase(case_id, category, task, opts, expected);
}

const NO_MARKERS = [
  { key: "author", evidence_state: "unverifiable" },
  { key: "date", evidence_state: "unverifiable" },
  { key: "id", evidence_state: "unverifiable" },
  { key: "status", evidence_state: "unverifiable" },
];
const NO_REQUIREMENTS_MET = {
  overall: "MISMATCH",
  required_sections: [{ section_id: "schedule", present: false, evidence_state: "mismatch" }, { section_id: "scope", present: false, evidence_state: "mismatch" }],
  required_companions: [{ logical_id: "companion-zeta", present: false, evidence_state: "mismatch" }],
};

/** Shared shape for this battery's single-admitted-document,
 *  no-markers, structural-exclusion/referential cases — manually
 *  derived from the brief's stated rules (population/coverage math,
 *  exclusion bookkeeping) rather than the generic domain oracle above,
 *  and cross-checked against a reference execution; documented here per
 *  the common contract's allowance for manually-derived expected cases. */
function oneDocExpected(setName, { status, coverageState, declared_total, actual_total, evidence_state, excluded_ids = [], excluded_assertions = [] }) {
  const docRaw = rawSetOf(setName).documents[0];
  const content_sha256 = sha256(Buffer.from(resolvedTextOf(docRaw.content_ref), "utf8"));
  return {
    status,
    complete: true,
    diagnostic_codes: [],
    quarantined_doc_ids: [],
    quarantined_other: [],
    source_ref_count: 3, // checklist + document-set + the one admitted document's content
    inventory: [{ doc_id: docRaw.doc_id, logical_id: docRaw.logical_id, revision: docRaw.revision, quarantined: false, content_sha256, metadata_verification: NO_MARKERS }],
    duplicate_groups: [],
    version_conflicts: [],
    checklist_results: NO_REQUIREMENTS_MET,
    reference_edges: [],
    cycles: [],
    cross_document_conflicts: [],
    excluded_ids,
    excluded_assertions,
    coverage: { state: coverageState, admitted_count: 1, excluded_count: excluded_ids.length },
    population: { declared_total, complete: true, actual_total, evidence_state },
  };
}
addHandCase(
  "ci-021-malformed-entries",
  "contradiction_incomplete_duplicate",
  taskFor("malformed-entries", { declared_total: 3 }),
  oneDocExpected("malformed-entries", {
    status: "PARTIAL",
    coverageState: "PARTIAL",
    declared_total: 3,
    actual_total: 3,
    evidence_state: "mismatch",
    excluded_ids: [{ doc_id: "d-bad-1", reason: "MALFORMED_RECORD" }, { doc_id: "malformed-index-2", reason: "MALFORMED_RECORD" }],
  })
);
addHandCase(
  "ci-022-duplicate-primary-id",
  "contradiction_incomplete_duplicate",
  taskFor("duplicate-primary-id", { declared_total: 2 }),
  refusedExpected("INVALID_INPUT")
);
addHandCase(
  "ci-023-assertion-span-mismatch",
  "contradiction_incomplete_duplicate",
  taskFor("assertion-span-mismatch", { declared_total: 1 }),
  oneDocExpected("assertion-span-mismatch", {
    status: "REPORT_READY",
    coverageState: "COMPLETE",
    declared_total: 1,
    actual_total: 1,
    evidence_state: "verified",
    excluded_assertions: [{ assertion_id: "a-asmm-1", reason: "SPAN_MISMATCH" }],
  })
);
addHandCase(
  "ci-024-assertion-owner-not-admitted",
  "contradiction_incomplete_duplicate",
  taskFor("assertion-owner-not-admitted", { declared_total: 1 }),
  oneDocExpected("assertion-owner-not-admitted", {
    status: "REPORT_READY",
    coverageState: "COMPLETE",
    declared_total: 1,
    actual_total: 1,
    evidence_state: "verified",
    excluded_assertions: [{ assertion_id: "a-aona-1", reason: "OWNER_DOCUMENT_NOT_ADMITTED" }],
  })
);
addDomainCase("ci-025-exact-duplicates-mismatch2", "contradiction_incomplete_duplicate", "exact-duplicates", { declared_total: 1 });
addDomainCase("ci-026-parallel-version-mismatch", "contradiction_incomplete_duplicate", "parallel-version", { declared_total: 9 });
addDomainCase("ci-027-timeline-reversal-museRelay", "contradiction_incomplete_duplicate", "timeline-reversal", {});
cases[cases.length - 1].principal = "museRelayActive";
addDomainCase("ci-028-three-way-duplicates-museRelay", "contradiction_incomplete_duplicate", "three-way-duplicates", {});
cases[cases.length - 1].principal = "museRelayActive";
addDomainCase("ci-029-same-revision-identical-content-museRelay", "contradiction_incomplete_duplicate", "same-revision-identical-content", {});
cases[cases.length - 1].principal = "museRelayActive";
addDomainCase("ci-030-parallel-version-museRelay", "contradiction_incomplete_duplicate", "parallel-version", {});
cases[cases.length - 1].principal = "museRelayActive";

// ================= injection/prohibited-operation (20) =================
addDomainCase("inj-001-injected-content", "injection_prohibited", "injected-content");
addDomainCase("inj-002-injected-metadata", "injection_prohibited", "injected-metadata");
addDomainCase("inj-003-injected-content-incomplete", "injection_prohibited", "injected-content", { complete: false });
addDomainCase("inj-004-injected-metadata-incomplete", "injection_prohibited", "injected-metadata", { complete: false });
addDomainCase("inj-005-injected-content-norequirements", "injection_prohibited", "injected-content", { criteriaName: "noRequirements" });
addDomainCase("inj-006-injected-metadata-norequirements", "injection_prohibited", "injected-metadata", { criteriaName: "noRequirements" });
addDomainCase("inj-007-injected-content-mismatch", "injection_prohibited", "injected-content", { declared_total: 5 });
addDomainCase("inj-008-injected-metadata-mismatch", "injection_prohibited", "injected-metadata", { declared_total: 5 });
addDomainCase("inj-009-injected-content-museRelay", "injection_prohibited", "injected-content", {});
cases[cases.length - 1].principal = "museRelayActive";
addDomainCase("inj-010-injected-metadata-museRelay", "injection_prohibited", "injected-metadata", {});
cases[cases.length - 1].principal = "museRelayActive";
for (const [i, op] of ["mutate", "delete", "approve", "fetch_external", "publish", "merge", "activate", "send"].entries()) {
  addHandCase(
    `inj-${String(11 + i).padStart(3, "0")}-prohibited-${op}`,
    "injection_prohibited",
    { schema_version: "1", task_id: `t-prohibited-${op}`, operation: op, fixture_refs: { document_set: store.documentSetRefs["single-nominal"] }, options: { population: { declared_total: 1, complete: true } } },
    refusedExpected("ACTION_DENIED")
  );
}
addHandCase(
  "inj-019-injected-checklist",
  "injection_prohibited",
  taskFor("single-nominal", { declared_total: 1 }),
  refusedExpected("INSTRUCTION_INJECTION", { quarantined_other: ["edu-sources|checklists/injected-checklist.md"] }),
  { criteria: "injectedChecklist" }
);
addHandCase(
  "inj-020-prohibited-empty-operation",
  "injection_prohibited",
  { schema_version: "1", task_id: "t-prohibited-empty", operation: "", fixture_refs: { document_set: store.documentSetRefs["single-nominal"] }, options: { population: { declared_total: 1, complete: true } } },
  refusedExpected("INVALID_INPUT")
);

// ================= schema/provenance/permission (20) =================
const baseTask = taskFor("single-nominal", { declared_total: 1 });
addHandCase("sch-001-revoked-principal", "schema_provenance_permission", baseTask, refusedExpected("ACTION_DENIED"), { principal: "revoked" });
addHandCase("sch-002-expired-principal", "schema_provenance_permission", baseTask, refusedExpected("ACTION_DENIED"), { principal: "expired" });
addHandCase("sch-003-clock-before-valid-from", "schema_provenance_permission", baseTask, refusedExpected("ACTION_DENIED"), { clock: "2019-01-01T00:00:00Z" });
addHandCase("sch-004-missing-grant-checklist", "schema_provenance_permission", baseTask, refusedExpected("READ_DENIED"), { contextOverrides: { removeGrants: ["edu-sources|checklists/document-set-checklist.md"] } });
addHandCase("sch-005-missing-grant-document-set", "schema_provenance_permission", baseTask, refusedExpected("READ_DENIED"), { contextOverrides: { removeGrants: ["edu-sources|document-sets/single-nominal.json"] } });
addHandCase("sch-006-missing-grant-content", "schema_provenance_permission", baseTask, refusedExpected("READ_DENIED"), { contextOverrides: { removeGrants: ["edu-sources|content/d-0001-1.txt"] } });
addHandCase(
  "sch-007-tampered-checklist-blob",
  "schema_provenance_permission",
  baseTask,
  refusedExpected("HASH_MISMATCH"),
  { contextOverrides: { replaceCriteria: { checklist_version: "v1", required_sections: [], required_companions: [], checklist_ref: { ...store.criteria.standard.checklist_ref, blob: "f".repeat(40) } } } }
);
addHandCase(
  "sch-008-tampered-document-set-blob",
  "schema_provenance_permission",
  { ...baseTask, fixture_refs: { document_set: { ...store.documentSetRefs["single-nominal"], blob: "f".repeat(40) } } },
  refusedExpected("HASH_MISMATCH")
);
addHandCase(
  "sch-009-unregistered-checklist-commit",
  "schema_provenance_permission",
  baseTask,
  refusedExpected("SOURCE_UNVERIFIED"),
  { contextOverrides: { replaceCriteria: { checklist_version: "v1", required_sections: [], required_companions: [], checklist_ref: { ...store.criteria.standard.checklist_ref, commit: "1".repeat(40) } } } }
);
addHandCase(
  "sch-010-unregistered-document-set-commit",
  "schema_provenance_permission",
  { ...baseTask, fixture_refs: { document_set: { ...store.documentSetRefs["single-nominal"], commit: "1".repeat(40) } } },
  refusedExpected("SOURCE_UNVERIFIED")
);
addHandCase("sch-011-wrong-schema-version", "schema_provenance_permission", { ...baseTask, schema_version: "2" }, refusedExpected("INVALID_INPUT"));
addHandCase("sch-012-malformed-fixture-refs-extra-key", "schema_provenance_permission", { ...baseTask, fixture_refs: { document_set: store.documentSetRefs["single-nominal"], extra: store.documentSetRefs["single-nominal"] } }, refusedExpected("INVALID_INPUT"));
addHandCase("sch-013-malformed-options-missing-field", "schema_provenance_permission", { ...baseTask, options: { population: { declared_total: 1 } } }, refusedExpected("INVALID_INPUT"));
addHandCase("sch-014-non-finite-clock", "schema_provenance_permission", baseTask, refusedExpected("INVALID_INPUT"), { clock: "not-a-date" });
addHandCase("sch-015-unknown-top-level-task-property", "schema_provenance_permission", { ...baseTask, extra: 1 }, refusedExpected("INVALID_INPUT"));
addHandCase("sch-016-bad-commit-hex-length", "schema_provenance_permission", { ...baseTask, fixture_refs: { document_set: { ...store.documentSetRefs["single-nominal"], commit: "abc" } } }, refusedExpected("INVALID_INPUT"));
addHandCase("sch-017-bad-algorithm-value", "schema_provenance_permission", { ...baseTask, fixture_refs: { document_set: { ...store.documentSetRefs["single-nominal"], algorithm: "sha256" } } }, refusedExpected("INVALID_INPUT"));
addHandCase(
  "sch-018-criteria-duplicate-required-sections",
  "schema_provenance_permission",
  baseTask,
  refusedExpected("INVALID_INPUT"),
  { contextOverrides: { replaceCriteria: { checklist_version: "v1", required_sections: ["scope", "scope"], required_companions: [], checklist_ref: store.criteria.standard.checklist_ref } } }
);
addHandCase(
  "sch-019-criteria-unknown-property",
  "schema_provenance_permission",
  baseTask,
  refusedExpected("INVALID_INPUT"),
  { contextOverrides: { replaceCriteria: { checklist_version: "v1", required_sections: [], required_companions: [], checklist_ref: store.criteria.standard.checklist_ref, extra: 1 } } }
);
addHandCase(
  "sch-020-principal-unknown-role",
  "schema_provenance_permission",
  baseTask,
  refusedExpected("INVALID_INPUT"),
  { contextOverrides: { replacePrincipal: { ...store.principals.jasonActive, role: "ADMIN" } } }
);

// ===================== budget/replay/mutation (10) =====================
// 65 distinct-content documents means a 67-entry source catalog (2
// fixed refs + 65 content refs), which now fails the schema-level
// 1..64-entry catalog cap (INVALID_INPUT) before any object-budget
// charging is even reached — not BUDGET_EXCEEDED. Both are correct
// fail-closed outcomes; this fixture now demonstrates the catalog-size
// gate specifically.
addHandCase("bud-001-objects-exceeded-documents", "budget_replay_mutation", taskFor("sixty-five-documents", { declared_total: 65 }), refusedExpected("INVALID_INPUT"));
addHandCase("bud-002-content-phase-exceeded", "budget_replay_mutation", taskFor("eleven-documents-distinct-content", { declared_total: 11 }), refusedExpected("BUDGET_EXCEEDED"));
addHandCase("bud-003-assertions-exceeded", "budget_replay_mutation", taskFor("sixty-five-assertions", { declared_total: 1 }), refusedExpected("BUDGET_EXCEEDED"));
addDomainCase("bud-004-exact-boundary-success-50-shared", "budget_replay_mutation", "fifty-documents-shared-content");
addHandCase("bud-005-poisoned-tail-sentinel", "budget_replay_mutation", taskFor("sixty-five-documents-poisoned-tail", { declared_total: 65 }), refusedExpected("BUDGET_EXCEEDED"));
addHandCase("bud-006-input-payload-too-large", "budget_replay_mutation", taskFor("oversized-document-set-text", { declared_total: 900 }), refusedExpected("INPUT_LIMIT"));
addHandCase("bud-007-duplicate-primary-id-again", "budget_replay_mutation", taskFor("duplicate-primary-id", { declared_total: 2 }), refusedExpected("INVALID_INPUT"));
addHandCase(
  "bud-008-assertion-span-mismatch-again",
  "budget_replay_mutation",
  taskFor("assertion-span-mismatch", { declared_total: 1 }),
  oneDocExpected("assertion-span-mismatch", {
    status: "REPORT_READY",
    coverageState: "COMPLETE",
    declared_total: 1,
    actual_total: 1,
    evidence_state: "verified",
    excluded_assertions: [{ assertion_id: "a-asmm-1", reason: "SPAN_MISMATCH" }],
  })
);
addHandCase(
  "bud-009-assertion-owner-not-admitted-again",
  "budget_replay_mutation",
  taskFor("assertion-owner-not-admitted", { declared_total: 1 }),
  oneDocExpected("assertion-owner-not-admitted", {
    status: "REPORT_READY",
    coverageState: "COMPLETE",
    declared_total: 1,
    actual_total: 1,
    evidence_state: "verified",
    excluded_assertions: [{ assertion_id: "a-aona-1", reason: "OWNER_DOCUMENT_NOT_ADMITTED" }],
  })
);
addHandCase(
  "bud-010-malformed-entries-again",
  "budget_replay_mutation",
  taskFor("malformed-entries", { declared_total: 3 }),
  oneDocExpected("malformed-entries", {
    status: "PARTIAL",
    coverageState: "PARTIAL",
    declared_total: 3,
    actual_total: 3,
    evidence_state: "mismatch",
    excluded_ids: [{ doc_id: "d-bad-1", reason: "MALFORMED_RECORD" }, { doc_id: "malformed-index-2", reason: "MALFORMED_RECORD" }],
  })
);

// ---------------------------------------------------------------------

const counts = {};
for (const c of cases) counts[c.category] = (counts[c.category] ?? 0) + 1;
console.log(`total cases: ${cases.length}`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);

writeFileSync(join(ROOT, "corpus", "battery.json"), JSON.stringify(cases, null, 2) + "\n");
