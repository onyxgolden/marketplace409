/**
 * sourceref-identity.test.js — PM-R2-001 regression: registrations must bind
 * the COMPLETE canonical SourceRef identity (all six fields: repo, path,
 * commit, blob, algorithm, revision) for both principal-authority and
 * relay-record subjects. A registration/record that moves to a different
 * repo, path, or revision while retaining the same blob and commit must be
 * unusable — the subject bytes/blob staying valid is not enough.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateTrustRegistry } from "../src/index.js";
import { makeBudget } from "../src/resolver.js";
import { loadStore, loadTrust } from "./testutil.js";

const CLOCK = Date.parse("2026-10-12T12:00:00Z");
const clone = (v) => JSON.parse(JSON.stringify(v));

function trustIndexFor(trust) {
  const store = loadStore();
  return validateTrustRegistry(trust, CLOCK, makeBudget(), store.commit_id);
}

/** A valid relay record + matching registration pair from the live fixtures. */
function relayPair(trust, recordId) {
  const rec = trust.relay_records.find((r) => r && r.record_id === recordId);
  const reg = trust.registrations.find(
    (r) => r && r.kind === "relay-record" && r.subject_id === recordId
  );
  assert.ok(rec, `fixture record ${recordId} present`);
  assert.ok(reg, `fixture registration for ${recordId} present`);
  return { rec, reg };
}

for (const field of ["repo", "path", "revision"]) {
  test(`relay record with mutated source_ref.${field} (same blob+commit) is unusable (PM-R2-001)`, () => {
    const trust = clone(loadTrust());
    const { rec } = relayPair(trust, "SYN-RELAY-001");
    rec.source_ref[field] = `forged-${field}-value`;
    const idx = trustIndexFor(trust);
    assert.ok(!idx.relayRecords.has("SYN-RELAY-001"), `record with forged ${field} must be excluded`);
    assert.equal(idx.recordProblems.get("SYN-RELAY-001"), "source binding mismatch");
  });
}

test("relay record with mutated source_ref.algorithm is unusable (PM-R2-001)", () => {
  const trust = clone(loadTrust());
  const { rec } = relayPair(trust, "SYN-RELAY-001");
  rec.source_ref.algorithm = "sha256";
  const idx = trustIndexFor(trust);
  assert.ok(!idx.relayRecords.has("SYN-RELAY-001"), "record with forged algorithm must be excluded");
  assert.equal(idx.recordProblems.get("SYN-RELAY-001"), "source binding mismatch");
});

test("relay record with registration source_ref moved to another path is unusable (PM-R2-001)", () => {
  const trust = clone(loadTrust());
  const { reg } = relayPair(trust, "SYN-RELAY-001");
  reg.source_ref.path = "relay-records/SYN-RELAY-001-moved.json";
  const idx = trustIndexFor(trust);
  assert.ok(!idx.relayRecords.has("SYN-RELAY-001"), "record whose registration moved must be excluded");
  assert.equal(idx.recordProblems.get("SYN-RELAY-001"), "source binding mismatch");
});

test("unmutated fixture relay record stays usable (PM-R2-001 control)", () => {
  const idx = trustIndexFor(loadTrust());
  assert.ok(idx.relayRecords.has("SYN-RELAY-001"), "valid record must stay usable");
  assert.ok(!idx.recordProblems.has("SYN-RELAY-001"));
});

for (const field of ["repo", "path", "revision"]) {
  test(`principal-authority registration with mutated source_ref.${field} (same blob) fails closed (PM-R2-001)`, () => {
    const trust = clone(loadTrust());
    const reg = trust.registrations.find((r) => r && r.registration_id === "SYN-REG-AUTH-JASON");
    assert.ok(reg, "fixture principal registration present");
    reg.source_ref[field] = `forged-${field}-value`;
    assert.throws(
      () => trustIndexFor(trust),
      (e) =>
        e.code === "SOURCE_UNVERIFIED" &&
        /does not bind the principal's full source identity/.test(e.reason),
      `registration with forged ${field} must fail closed`
    );
  });
}

test("principal-authority registration with mutated source_ref.algorithm fails closed (PM-R2-001)", () => {
  const trust = clone(loadTrust());
  const reg = trust.registrations.find((r) => r && r.registration_id === "SYN-REG-AUTH-JASON");
  reg.source_ref.algorithm = "sha256";
  assert.throws(
    () => trustIndexFor(trust),
    (e) =>
      e.code === "SOURCE_UNVERIFIED" &&
      /malformed source_ref|does not bind the principal's full source identity/.test(e.reason),
    "registration with forged algorithm must fail closed"
  );
});

test("unmutated fixture principal registration keeps authority (PM-R2-001 control)", () => {
  const idx = trustIndexFor(loadTrust());
  assert.ok(idx.authorityPrincipals.has("SYN-ISSUER-JASON"), "valid principal keeps authority");
});
