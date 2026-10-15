/**
 * sourceref.test.js — GOV-003 residual regression (fix round 2).
 *
 * noteSourceRef must preserve the FULL six-field common SourceRef identity
 * {repo,path,commit,blob,algorithm,revision}. The round-1 fix recorded only
 * four fields, so envelopes listed consulted identities that were not valid
 * exact SourceRefs and could not preserve the fixture revision/algorithm
 * binding. Every assertion here goes through the shared
 * src/schemas.js::validateSourceRef validator.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const six = (over = {}) => ({
  repo: "onyxgolden/marketplace409",
  path: "fixtures/target.md",
  commit: "a".repeat(40),
  blob: "b".repeat(40),
  algorithm: "git-sha1",
  revision: "v1",
  ...over,
});

test("GOV-003r: listedSourceRefs items validate through the shared SourceRef validator", async () => {
  const { makeBudget } = await import("../src/resolver.js");
  const { validateSourceRef } = await import("../src/schemas.js");
  const b = makeBudget();
  b.noteSourceRef(six());
  b.noteSourceRef(six({ path: "fixtures/other.md", blob: "c".repeat(40), revision: "v2" }));
  const listed = b.listedSourceRefs();
  assert.equal(listed.length, 2);
  for (const s of listed) {
    const v = validateSourceRef(s, "listedSourceRefs");
    assert.equal(v.algorithm, "git-sha1");
    assert.ok(v.revision.length > 0, "revision binding must survive the record/list round-trip");
    assert.deepEqual(Object.keys(s).sort(), ["algorithm", "blob", "commit", "path", "repo", "revision"]);
  }
  // Deterministic order includes the new identity fields.
  const keys = listed.map((s) => [s.repo, s.path, s.commit, s.blob, s.algorithm, s.revision].join("|"));
  assert.deepEqual(keys, [...keys].sort());
});

test("GOV-003r: revision is part of the stable identity — different revisions are distinct sources", async () => {
  const { makeBudget } = await import("../src/resolver.js");
  const b = makeBudget();
  b.noteSourceRef(six({ revision: "v1" }));
  b.noteSourceRef(six({ revision: "v2" })); // must NOT dedupe against v1
  const listed = b.listedSourceRefs();
  assert.equal(listed.length, 2, "refs differing only in revision must be distinct identities");
  assert.deepEqual(listed.map((s) => s.revision).sort(), ["v1", "v2"]);
});

test("GOV-003r: exact duplicate six-field ref stays idempotent", async () => {
  const { makeBudget } = await import("../src/resolver.js");
  const b = makeBudget();
  b.noteSourceRef(six());
  b.noteSourceRef(six());
  assert.equal(b.listedSourceRefs().length, 1);
});

test("GOV-003r: the old four-field shape fails the shared validator (residual bug proof)", async () => {
  const { validateSourceRef, SchemaError } = await import("../src/schemas.js");
  const fourField = { repo: "r", path: "p", commit: "a".repeat(40), blob: "b".repeat(40) };
  assert.throws(() => validateSourceRef(fourField, "residual"), SchemaError,
    "four-field records are not valid exact SourceRefs");
});

test("GOV-003r: dropSourceRef needs the full six-field identity to remove", async () => {
  const { makeBudget } = await import("../src/resolver.js");
  const b = makeBudget();
  b.noteSourceRef(six({ revision: "v1" }));
  b.noteSourceRef(six({ revision: "v2" }));
  b.dropSourceRef(six({ revision: "v1" }));
  const listed = b.listedSourceRefs();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].revision, "v2", "drop must not remove a different-revision sibling");
});
