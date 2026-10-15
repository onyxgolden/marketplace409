/**
 * trust-chain.test.js — TAX-002 (registry entries must be pinned to an
 * independently resolved SourceRef and bound to an authenticated
 * registration's exact content digest/version/scope — matching ID
 * strings alone is never enough) and TAX-003 (successful outputs must
 * carry deterministic provenance in the common envelope's source_refs,
 * never including quarantined/denied sources).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { registryEntryDigest } from "../src/canonical.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const CLOCK = Date.parse("2026-06-01T00:00:00Z");

function ctx(overrides = {}) {
  return {
    clock: CLOCK,
    registry: store.registry,
    sources: store.sources,
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    reviewRecords: store.reviewRecords,
    ...overrides,
  };
}
const baseTask = (overrides = {}) => ({
  task_id: "demo-trust-1",
  requested_action: "draft_education",
  topic_id: "recordkeeping-basics",
  topic_label: "Recordkeeping Basics",
  jurisdiction: "US-FEDERAL",
  tax_year: 2026,
  as_of_date: "2026-06-01T00:00:00Z",
  mode: "current_education",
  source_refs: [],
  ...overrides,
});

function rkEntry() {
  return JSON.parse(JSON.stringify(store.registry.find((e) => e.topic_id === "recordkeeping-basics")));
}
function rkCitationRef() {
  const entry = rkEntry();
  return entry.current.claims[0].source_ref;
}

// ---------------------------------------------------------------- TAX-003

test("DRAFT source_refs includes the verified registry ref and every verified claim ref", () => {
  const r = run(baseTask(), ctx());
  assert.equal(r.status, "DRAFT");
  const entry = rkEntry();
  const claimRef = rkCitationRef();
  const keys = r.source_refs.map((x) => `${x.repo}|${x.path}|${x.commit}|${x.blob}`).sort();
  const want = [entry.registry_ref, claimRef].map((x) => `${x.repo}|${x.path}|${x.commit}|${x.blob}`).sort();
  assert.deepEqual(keys, want);
  for (const sr of r.source_refs) {
    assert.equal(sr.algorithm, "git-sha1");
    assert.ok(/^[0-9a-f]{40}$/.test(sr.commit));
    assert.ok(/^[0-9a-f]{40}$/.test(sr.blob));
  }
});

test("source_refs is empty for REFUSED outcomes (nothing was consulted/verified)", () => {
  const personal = run(baseTask({ topic_label: "my rental income is $85,000" }), ctx());
  assert.equal(personal.status, "REFUSED");
  assert.deepEqual(personal.source_refs, []);
});

test("source_refs is empty for REVIEW_REQUIRED on an unregistered topic (no entry was ever authenticated)", () => {
  const r = run(baseTask({ topic_id: "reps-qualification", topic_label: "REPS Qualification" }), ctx());
  assert.equal(r.status, "REVIEW_REQUIRED");
  assert.deepEqual(r.source_refs, []);
});

test("quarantined sources never appear in source_refs, even though the run is blocked", () => {
  const mal = store.sources["edu-sources|misc/malicious-note.md"];
  const commit = Object.keys(mal.revisions)[0];
  const ref = { repo: "edu-sources", path: "misc/malicious-note.md", commit, blob: mal.revisions[commit].blob, algorithm: "git-sha1", revision: "rev-1" };
  const r = run(baseTask({ source_refs: [ref] }), ctx());
  assert.equal(r.status, "REFUSED");
  assert.ok(r.quarantined_sources.length > 0);
  assert.deepEqual(r.source_refs, []);
  for (const q of r.quarantined_sources) {
    assert.ok(!r.source_refs.some((sr) => sr.repo === q.repo && sr.path === q.path));
  }
});

test("conflicting-source BLOCKED output still carries the verified registry ref and both verified (preserved) claim refs", () => {
  const conflictEntry = JSON.parse(readFileSync(join(ROOT, "fixtures", "depreciation-conflict-entry.json"), "utf8"));
  const r = run(
    baseTask({ topic_id: "depreciation-concept", topic_label: "Depreciation Concept Vocabulary" }),
    ctx({ registry: [conflictEntry] })
  );
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.uncertainty_flags.includes("CONFLICTING_SOURCES"), true);
  assert.equal(r.source_refs.length, 3); // registry ref + 2 conflicting claim refs
  const paths = r.source_refs.map((x) => x.path).sort();
  assert.deepEqual(paths, ["depreciation/concept-conflict-a.md", "depreciation/concept-conflict-b.md", "registry/depreciation-concept-conflict-entry.md"].sort());
});

test("a claim-resolution failure (e.g. HASH_MISMATCH) still yields empty source_refs (whole draft withheld, no partial provenance)", () => {
  const entry = rkEntry();
  entry.current.claims[0].source_ref.blob = "0".repeat(40);
  const r = run(baseTask(), ctx({ registry: [entry] }));
  assert.equal(r.status, "BLOCKED");
  assert.deepEqual(r.source_refs, []);
});

// ---------------------------------------------------------------- TAX-002

test("tampered registry entry content (digest no longer matches declared entry_digest) is rejected before any claim is consulted", () => {
  const entry = rkEntry();
  // Swap in different claim text without recomputing entry_digest — the
  // entry's own declared digest is now stale relative to its content.
  entry.current.claims[0].text = "This text was never approved by the steward chain.";
  const r = run(baseTask(), ctx({ registry: [entry] }));
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.uncertainty_flags.includes("HASH_MISMATCH"), true);
  assert.deepEqual(r.claims, []);
  assert.deepEqual(r.citations, []);
});

test("entry pointed at a different registration is caught by its OWN self-consistency check first (registration_ref is part of the digested content, so it can't be swapped without also invalidating entry_digest)", () => {
  const entry = rkEntry();
  entry.registration_ref = "reg-tax-rk-wrong-digest";
  const r = run(baseTask(), ctx({ registry: [entry] }));
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.uncertainty_flags.includes("HASH_MISMATCH"), true);
  assert.deepEqual(r.claims, []);
});

test("self-consistent entry rejected when the registration it legitimately points to has drifted to bind a DIFFERENT digest (matching IDs alone is not authentication)", () => {
  const entry = rkEntry(); // unmodified: entry.entry_digest matches its own content, registration_ref unchanged
  const registrations = store.registrations.map((r) =>
    r.registration_ref === "reg-tax-rk-001" ? { ...r, entry_digest: "9".repeat(64) } : r
  );
  const r = run(baseTask(), ctx({ registry: [entry], registrations }));
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.uncertainty_flags.includes("SOURCE_UNVERIFIED"), true);
  assert.deepEqual(r.claims, []);
});

test("registration bound to the right digest but the WRONG topic_id is rejected", () => {
  const entry = rkEntry();
  const registrations = store.registrations.map((r) =>
    r.registration_ref === "reg-tax-rk-001" ? { ...r, topic_id: "depreciation-concept" } : r
  );
  const r = run(baseTask(), ctx({ registry: [entry], registrations }));
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.uncertainty_flags.includes("SOURCE_UNVERIFIED"), true);
});

test("registry_ref pointing at an unregistered source is rejected (registry provenance is independently resolved, not trusted on declaration)", () => {
  const entry = rkEntry();
  entry.registry_ref = { ...entry.registry_ref, path: "registry/does-not-exist.md" };
  // Recompute entry_digest so THIS check (registry_ref resolution), not
  // the digest check, is what's actually being exercised.
  entry.entry_digest = registryEntryDigest(entry);
  const r = run(
    baseTask(),
    ctx({ registry: [entry], registrations: store.registrations.map((r) => (r.registration_ref === "reg-tax-rk-001" ? { ...r, entry_digest: entry.entry_digest } : r)) })
  );
  assert.equal(r.status, "BLOCKED");
  assert.ok(r.uncertainty_flags.includes("SOURCE_UNVERIFIED") || r.uncertainty_flags.includes("READ_DENIED"));
});

test("registry_ref not in readGrants is rejected with READ_DENIED even though the entry is otherwise internally consistent", () => {
  const entry = rkEntry();
  const readGrants = store.readGrants.filter((g) => g.path !== entry.registry_ref.path);
  const r = run(baseTask(), ctx({ registry: [entry], readGrants }));
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.uncertainty_flags.includes("READ_DENIED"), true);
});

test("a corrupted registry_ref blob (bytes do not match the pinned hash) is rejected with HASH_MISMATCH at the registry-provenance layer", () => {
  const entry = rkEntry();
  entry.registry_ref = { ...entry.registry_ref, blob: "1".repeat(40) };
  // entry_digest intentionally NOT recomputed: we want this specific
  // case to fail at registry_ref resolution before the content-digest
  // check is even reached, proving resolution happens first.
  const r = run(baseTask(), ctx({ registry: [entry] }));
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.uncertainty_flags.includes("HASH_MISMATCH"), true);
});

test("the legitimate entry/registration pairing still authenticates and drafts normally (fix did not break the clean path)", () => {
  const r = run(baseTask(), ctx());
  assert.equal(r.status, "DRAFT");
  assert.equal(r.complete, true);
  assert.equal(r.citations.length, 1);
});
