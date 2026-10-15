/**
 * envelope-provenance.test.js — PM-005 regression: every result carries a
 * deterministic, deduplicated list of every consulted source with exact
 * pins, revalidated at emission. A consulted object without a valid
 * source binding cannot yield a complete result.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { run, canonicalJson } from "../src/index.js";
import { makeBudget } from "../src/resolver.js";
import { gitBlobId } from "../src/canonical.js";
import { loadStore, baseContext, taskFor } from "./testutil.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const HEX40 = /^[0-9a-f]{40}$/;

function validRefShape(ref) {
  assert.equal(typeof ref.repo, "string");
  assert.equal(typeof ref.path, "string");
  assert.ok(HEX40.test(ref.commit), `bad commit ${ref.commit}`);
  assert.ok(HEX40.test(ref.blob), `bad blob ${ref.blob}`);
  assert.equal(ref.algorithm, "git-sha1");
  assert.equal(typeof ref.revision, "string");
}

test("successful result populates source_refs (PM-005)", () => {
  const store = loadStore();
  const r = run(taskFor(store, "SYN-CASE-001"), baseContext());
  assert.equal(r.status, "PROPOSED");
  assert.equal(r.complete, true);
  assert.ok(Array.isArray(r.source_refs) && r.source_refs.length > 0, "source_refs must be populated");
  for (const ref of r.source_refs) validRefShape(ref);
});

test("source_refs are deterministic, deduplicated, and sorted (PM-005)", () => {
  const store = loadStore();
  const a = run(taskFor(store, "SYN-CASE-001"), baseContext());
  const b = run(taskFor(store, "SYN-CASE-001"), baseContext());
  assert.deepEqual(a.source_refs, b.source_refs, "source_refs must be deterministic");
  const keys = a.source_refs.map((r) => `${r.repo}|${r.path}|${r.commit}|${r.blob}`);
  assert.equal(new Set(keys).size, keys.length, "source_refs must be deduplicated");
  assert.deepEqual(keys, [...keys].sort(), "source_refs must be sorted");
});

test("source_refs cover case, note, permission, config, and trust sources (PM-005)", () => {
  const store = loadStore();
  const r = run(taskFor(store, "SYN-CASE-001"), baseContext());
  const paths = r.source_refs.map((x) => x.path);
  assert.ok(paths.some((p) => p.startsWith("cases/")), "consulted case must be listed");
  assert.ok(paths.some((p) => p.startsWith("notes/")), "consulted note must be listed");
  assert.ok(paths.some((p) => p.startsWith("permissions/")), "consulted permission must be listed");
  assert.ok(paths.some((p) => p.startsWith("config/")), "consulted config must be listed");
  assert.ok(paths.some((p) => p === "fixtures/trust.json"), "consulted trust registry must be listed");
});

test("source_ref pins revalidate against recomputed blobs (PM-005)", () => {
  const store = loadStore();
  const ctx = baseContext();
  const r = run(taskFor(store, "SYN-CASE-001"), ctx);
  assert.equal(r.complete, true);
  // Recompute the case and permission pins from the consulted bytes.
  const caseObj = ctx.caseStore.cases.find((x) => x.case_id === "SYN-CASE-001");
  const caseBytes = Buffer.from(canonicalJson(caseObj), "utf8");
  const caseRef = r.source_refs.find((x) => x.path === "cases/SYN-CASE-001.json");
  assert.ok(caseRef, "case source must be present");
  assert.equal(caseRef.blob, gitBlobId(caseBytes), "case pin must match recomputed blob");
  for (const ref of r.source_refs) {
    if (!ref.path.startsWith("permissions/")) continue;
    const pid = ref.path.split("/")[1].replace(".json", "");
    const perm = ctx.caseStore.permission_records.find((x) => x.permission_id === pid);
    const permBytes = Buffer.from(canonicalJson(perm), "utf8");
    assert.equal(ref.blob, gitBlobId(permBytes), `permission pin ${pid} must match recomputed blob`);
  }
});

test("denials also carry consulted sources (PM-005)", () => {
  const store = loadStore();
  // A refusal after consultation: tampered case blob is consulted then rejected.
  const ctx = baseContext();
  ctx.caseStore = clone(ctx.caseStore);
  const cs = ctx.caseStore.cases.find((x) => x.case_id === "SYN-CASE-001");
  cs.facts.amount_usd = 999999; // blob mismatch, but bytes were consulted
  const r = run(taskFor(store, "SYN-CASE-001"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.complete, false);
  assert.ok(Array.isArray(r.source_refs), "denials must carry source_refs");
  assert.ok(r.source_refs.some((x) => x.path === "cases/SYN-CASE-001.json"), "consulted case must be listed even on denial");
});

test("emission revalidation fails closed on tampered bytes (PM-005)", () => {
  // Budget-level: if the bytes behind a ledgered pin change before
  // emission, revalidation throws and the envelope cannot be complete.
  const b = makeBudget();
  const bytes = Buffer.from("original bytes");
  const ref = {
    repo: "r",
    path: "x.json",
    commit: "c",
    blob: gitBlobId(bytes),
    algorithm: "git-sha1",
    revision: "v1",
  };
  b.addSource(ref, bytes);
  // Sanity: unmodified bytes revalidate cleanly.
  b.revalidateSources(gitBlobId);
  // Tampered bytes behind the same pin must fail revalidation.
  const b2 = makeBudget();
  b2.addSource(ref, Buffer.from("tampered bytes"));
  assert.throws(() => b2.revalidateSources(gitBlobId), (e) => e.code === "SOURCE_UNVERIFIED");
});
