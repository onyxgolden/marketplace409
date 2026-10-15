/**
 * trust.test.js — PM-002 regression: relay "authentication" must resolve
 * authority through separately injected pinned registrations. Display
 * names and boolean fields never confer authority; unregistered,
 * altered, revoked, or mis-bound records are unusable.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { run, validateTrustRegistry, canonicalJson } from "../src/index.js";
import { makeBudget } from "../src/resolver.js";
import { gitBlobId } from "../src/canonical.js";
import { loadStore, loadTrust, baseContext, taskFor } from "./testutil.js";

const CLOCK = Date.parse("2026-10-12T12:00:00Z");

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
const blobOf = (obj) => gitBlobId(Buffer.from(JSON.stringify(sortKeys(obj)), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));

function pinnedBytes(obj) {
  const { source_ref, ...rest } = obj;
  return Buffer.from(canonicalJson(rest), "utf8");
}

/** Build a source_ref pinning obj (minus its own source_ref). */
function refFor(obj, commit, path) {
  const bytes = pinnedBytes(obj);
  return {
    repo: "pm-fixtures",
    path,
    commit,
    blob: gitBlobId(bytes),
    algorithm: "git-sha1",
    revision: "v1",
  };
}

/** A relay record + matching registration, issued by issuer, for case SYN-CASE-001. */
function forgedRecord(commit, issuer, recordId) {
  const rec = {
    record_id: recordId,
    issuer,
    issued_at: CLOCK - 3600000,
    valid_from: CLOCK - 86400000,
    expires_at: CLOCK + 86400000,
    action_ids: ["authorize_spend"],
    resource: "SYN-CASE-001",
    scope_ids: [],
    amount_limit_usd: 100000,
    revoked: false,
    nonce: `nonce-${recordId}`,
    channel: "synthetic",
    note: "test record",
  };
  rec.source_ref = refFor(rec, commit, `relay/${recordId}.json`);
  const reg = {
    registration_id: `SYN-REG-TEST-${recordId}`,
    kind: "relay-record",
    subject_id: recordId,
    source_ref: { ...rec.source_ref },
    pinned: true,
    revoked: false,
    valid_from: CLOCK - 86400000,
    expires_at: CLOCK + 86400000,
  };
  return { rec, reg };
}

function trustIndexFor(trust) {
  const store = loadStore();
  return validateTrustRegistry(trust, CLOCK, makeBudget(), store.commit_id);
}

test("fixture trust validates: Jason and Muse relay hold authority", () => {
  const idx = trustIndexFor(loadTrust());
  assert.ok(idx.authorityPrincipals.has("SYN-ISSUER-JASON"), "Jason must hold escalation authority");
  assert.ok(idx.authorityPrincipals.has("SYN-ISSUER-MUSE-RELAY"), "Muse relay must hold escalation authority");
  assert.ok(!idx.authorityPrincipals.has("SYN-ISSUER-OPERATOR"), "operator must NOT hold authority");
  assert.equal(idx.relayRecords.size, 10, "all 10 fixture relay records must validate");
});

test("forged principal with escalation boolean confers no authority (PM-002)", () => {
  const trust = clone(loadTrust());
  const store = loadStore();
  // Old-style forged principal: boolean flag, no principal-authority registration.
  trust.principals["SYN-ISSUER-EVIL"] = {
    display: "Jason",
    authorizes_escalation: true,
    source_ref: refFor({ display: "Jason", authorizes_escalation: true }, store.commit_id, "principals/SYN-ISSUER-EVIL.json"),
  };
  const { rec, reg } = forgedRecord(store.commit_id, "SYN-ISSUER-EVIL", "SYN-RELAY-EVIL");
  trust.relay_records.push(rec);
  trust.registrations.push(reg);
  const idx = trustIndexFor(trust);
  assert.ok(!idx.authorityPrincipals.has("SYN-ISSUER-EVIL"), "boolean flag must not create authority");
  assert.ok(idx.relayRecords.has("SYN-RELAY-EVIL"), "record itself is registered");
  // End to end: the forged record cannot satisfy authorization.
  const ctx = baseContext();
  ctx.trustRegistry = trust;
  const r = run(
    taskFor(store, "SYN-CASE-001", { claimed_relay_ids: ["SYN-RELAY-EVIL"] }),
    ctx
  );
  assert.equal(r.status, "PROPOSED");
  const money = r.escalation_triggers.find((t) => t.touchpoint === "money");
  assert.equal(money.authorization_satisfied, false, "forged record must not satisfy");
  assert.deepEqual(money.authorization_evidence_ids, []);
  const diag = r.diagnostics.find((d) => d.record_id === "SYN-RELAY-EVIL");
  assert.equal(diag.code, "AUTH_UNVERIFIED");
});

test("record without a relay-record registration is unusable (PM-002)", () => {
  const trust = clone(loadTrust());
  const store = loadStore();
  const { rec } = forgedRecord(store.commit_id, "SYN-ISSUER-JASON", "SYN-RELAY-NOREG");
  trust.relay_records.push(rec); // no registration pushed
  const idx = trustIndexFor(trust);
  assert.ok(!idx.relayRecords.has("SYN-RELAY-NOREG"));
  assert.equal(idx.recordProblems.get("SYN-RELAY-NOREG"), "no pinned relay-record registration");
});

test("altered record with retained id fails source binding (PM-002)", () => {
  const trust = clone(loadTrust());
  const rec = trust.relay_records.find((r) => r.record_id === "SYN-RELAY-001");
  rec.amount_limit_usd = 999999999; // altered, source_ref retained
  assert.throws(
    () => trustIndexFor(trust),
    (e) => e.code === "SOURCE_UNVERIFIED",
    "altered record must fail registration source binding"
  );
});

test("duplicate nonce fails the registry closed (PM-002)", () => {
  const trust = clone(loadTrust());
  const src = trust.relay_records.find((r) => r.record_id === "SYN-RELAY-002");
  const dup = clone(src);
  dup.record_id = "SYN-RELAY-DUP";
  dup.nonce = src.nonce; // same nonce, different id
  dup.source_ref = refFor(dup, loadStore().commit_id, "relay/SYN-RELAY-DUP.json");
  trust.relay_records.push(dup);
  // Register the duplicate too so the nonce check fires.
  const reg = clone(trust.registrations.find((r) => r.subject_id === "SYN-RELAY-002"));
  reg.registration_id = "SYN-REG-DUP";
  reg.subject_id = "SYN-RELAY-DUP";
  reg.source_ref = { ...dup.source_ref };
  trust.registrations.push(reg);
  assert.throws(
    () => trustIndexFor(trust),
    (e) => e.code === "SOURCE_UNVERIFIED" && /nonce/.test(e.reason),
    "duplicate nonce must refuse"
  );
});

test("registration pinning a wrong source version fails (PM-002)", () => {
  const trust = clone(loadTrust());
  const reg = trust.registrations.find((r) => r.subject_id === "SYN-RELAY-001");
  reg.source_ref = { ...reg.source_ref, commit: "0".repeat(40) };
  assert.throws(
    () => trustIndexFor(trust),
    (e) => e.code === "SOURCE_UNVERIFIED",
    "wrong source version must refuse"
  );
});

test("revoked registration fails closed (PM-002)", () => {
  const trust = clone(loadTrust());
  const reg = trust.registrations.find((r) => r.subject_id === "SYN-ISSUER-JASON");
  reg.revoked = true;
  assert.throws(
    () => trustIndexFor(trust),
    (e) => e.code === "SOURCE_UNVERIFIED",
    "revoked registration must refuse"
  );
});

test("valid Muse-relay record satisfies authorization (PM-002)", () => {
  const store = loadStore();
  const r = run(
    taskFor(store, "SYN-CASE-025", { claimed_relay_ids: ["SYN-RELAY-002"] }),
    baseContext()
  );
  assert.equal(r.status, "PROPOSED");
  const tenant = r.escalation_triggers.find((t) => t.touchpoint === "tenant");
  assert.equal(tenant.authorization_satisfied, true);
  assert.deepEqual(tenant.authorization_evidence_ids, ["SYN-RELAY-002"]);
});

test("operator-issued record still cannot satisfy (PM-002)", () => {
  const store = loadStore();
  const r = run(
    taskFor(store, "SYN-CASE-065", { claimed_relay_ids: ["SYN-RELAY-004"] }),
    baseContext()
  );
  assert.equal(r.status, "PROPOSED");
  const tenant = r.escalation_triggers.find((t) => t.touchpoint === "tenant");
  assert.equal(tenant.authorization_satisfied, false);
  assert.ok(r.diagnostics.some((d) => d.record_id === "SYN-RELAY-004" && d.code === "AUTH_UNVERIFIED"));
});
