/**
 * provenance.test.js — DOC-001 regressions, through the public run()
 * entrypoint: a content-cache keyed by a PARTIAL identity (repo|path|
 * commit, omitting blob/algorithm/revision) let a later document supply
 * a forged blob/revision at the same repo/path/commit and silently reuse
 * an earlier, unrelated, already-resolved result without its own ref
 * ever being validated. The fix keys resolved-content reuse by the FULL
 * exact SourceRef identity (fullSourceRefKey in src/canonical.js).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { gitBlobId } from "../src/canonical.js";

function contentRef(text, { path = "content/probe.txt", commit = "a".repeat(40), revision = "v1" } = {}) {
  return { repo: "edu-sources", path, commit, blob: gitBlobId(Buffer.from(text, "utf8")), algorithm: "git-sha1", revision };
}

function baseFixture() {
  const checklistText = "Checklist.\n";
  const checklistRef = contentRef(checklistText, { path: "checklists/doc-set-checklist.md" });
  const sources = {
    [`${checklistRef.repo}|${checklistRef.path}`]: { revisions: { [checklistRef.commit]: { text: checklistText, blob: checklistRef.blob } } },
  };
  const grants = [{ repo: checklistRef.repo, path: checklistRef.path }];
  return { checklistText, checklistRef, sources, grants };
}

function contextFor(sources, grants, checklistRef) {
  return {
    clock: Date.parse("2026-07-01T00:00:00Z"),
    sources,
    readGrants: grants,
    principal: { principal_id: "p1", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
    criteria: { checklist_version: "v1", required_sections: [], required_companions: [], checklist_ref: checklistRef },
  };
}

function docFor(id, ref) {
  return {
    doc_id: id,
    logical_id: `spec-${id}`,
    revision: 1,
    declared_date: "2026-01-01",
    metadata: { author: "a", date: "2026-01-01", id, status: "draft" },
    content_ref: ref,
    sections: [],
    markers: [],
    references: [],
  };
}

function runWithDocs(docs, { sources, grants, checklistRef }) {
  const setText = JSON.stringify({ documents: docs, assertions: [] });
  const setRef = contentRef(setText, { path: "document-sets/probe.json" });
  const fullSources = { ...sources, [`${setRef.repo}|${setRef.path}`]: { revisions: { [setRef.commit]: { text: setText, blob: setRef.blob } } } };
  const fullGrants = [...grants, { repo: setRef.repo, path: setRef.path }];
  const task = {
    schema_version: "1",
    task_id: "t-provenance-probe",
    operation: "analyze",
    fixture_refs: { document_set: setRef },
    options: { population: { declared_total: docs.length, complete: true } },
  };
  return run(task, contextFor(fullSources, fullGrants, checklistRef));
}

test("DOC-001: a second document claiming the first's repo/path/commit with a FORGED blob is independently verified and refused, never reused from cache", () => {
  const { sources, grants, checklistRef } = baseFixture();
  const realText = "Real, legitimately registered content.\n";
  const realRef = contentRef(realText, { path: "content/shared.txt", commit: "b".repeat(40) });
  const fullSources = { ...sources, [`${realRef.repo}|${realRef.path}`]: { revisions: { [realRef.commit]: { text: realText, blob: realRef.blob } } } };
  const fullGrants = [...grants, { repo: realRef.repo, path: realRef.path }];

  const docA = docFor("d-a", realRef); // genuine: content_ref.blob matches the actual registered bytes.
  const forgedRef = { ...realRef, blob: "0".repeat(40), revision: "forged-v2" }; // same repo/path/commit, forged blob+revision.
  const docB = docFor("d-b", forgedRef);

  const result = runWithDocs([docA, docB], { sources: fullSources, grants: fullGrants, checklistRef });

  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "HASH_MISMATCH");
  // The forged ref must never be reported as a verified/used source.
  assert.ok(!result.source_refs.some((r) => r.blob === "0".repeat(40)), "forged ref must not appear in source_refs");
});

test("DOC-001: same repo/path/commit/blob but a DIFFERENT revision label is independently re-verified (not blocked, not blindly cache-reused) and succeeds because the actual bytes genuinely match", () => {
  const { sources, grants, checklistRef } = baseFixture();
  const realText = "Shared, genuinely identical content.\n";
  const realRef = contentRef(realText, { path: "content/shared2.txt", commit: "c".repeat(40), revision: "v1" });
  const fullSources = { ...sources, [`${realRef.repo}|${realRef.path}`]: { revisions: { [realRef.commit]: { text: realText, blob: realRef.blob } } } };
  const fullGrants = [...grants, { repo: realRef.repo, path: realRef.path }];

  const docA = docFor("d-a", realRef);
  const sameBytesDifferentRevisionLabel = { ...realRef, revision: "v2-relabeled" }; // blob still correct — genuinely the same bytes.
  const docB = docFor("d-b", sameBytesDifferentRevisionLabel);

  const result = runWithDocs([docA, docB], { sources: fullSources, grants: fullGrants, checklistRef });

  assert.equal(result.status, "REPORT_READY");
  assert.equal(result.report.coverage.admitted_count, 2);
});

test("DOC-001: wrong algorithm is rejected at schema validation, before any content resolution is attempted", () => {
  const { sources, grants, checklistRef } = baseFixture();
  const realText = "Content.\n";
  const realRef = contentRef(realText, { path: "content/alg.txt", commit: "d".repeat(40) });
  const fullSources = { ...sources, [`${realRef.repo}|${realRef.path}`]: { revisions: { [realRef.commit]: { text: realText, blob: realRef.blob } } } };
  const fullGrants = [...grants, { repo: realRef.repo, path: realRef.path }];

  const badAlgRef = { ...realRef, algorithm: "sha256" };
  const docA = docFor("d-a", badAlgRef);

  const result = runWithDocs([docA], { sources: fullSources, grants: fullGrants, checklistRef });

  // A single document with an invalid content_ref is a per-document
  // MALFORMED_RECORD exclusion (schema validation inside validateDocument
  // rejects the bad algorithm before content resolution is ever
  // attempted), not a whole-task hard refusal — consistent with how any
  // other structurally malformed document is handled. The decisive check
  // is that it's excluded and never silently admitted/resolved.
  assert.equal(result.report.coverage.admitted_count, 0);
  assert.ok(result.report.excluded_ids.some((e) => e.doc_id === "d-a" && e.reason === "MALFORMED_RECORD"));
});
