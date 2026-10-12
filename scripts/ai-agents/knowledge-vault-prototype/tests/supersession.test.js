/**
 * supersession.test.js — steward authentication and effective-revision
 * selection (b1–b5) against the real fixtures.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectEffectiveRevision, authenticateRecord } from "../src/supersession.js";
import { makeBudget } from "../src/resolver.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const vocabulary = JSON.parse(readFileSync(join(ROOT, "fixtures", "vocabulary.json"), "utf8"));

const CLOCK = Date.parse("2026-10-12T12:00:00Z");
function ctx() {
  return {
    clock: CLOCK, vocabulary,
    sources: JSON.parse(JSON.stringify(store.sources)),
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    supersessionRecords: store.supersessionRecords,
  };
}
function commitsOf(key, label) {
  const entry = store.sources[key].revisions;
  return Object.keys(entry).find((c) => entry[c].revision === label);
}

test("b1: valid steward record selects the new revision", () => {
  const c = ctx();
  const sel = selectEffectiveRevision("vault|handbook/policies.md", ["facilities", "site-a"], c, CLOCK, null, makeBudget());
  assert.equal(sel.status, "ok");
  assert.equal(sel.ref.commit, commitsOf("vault|handbook/policies.md", "rev-2"));
  assert.deepEqual(sel.appliedRecords, ["sup-001"]);
});

test("b2: unrelated newer path never becomes this source's revision", () => {
  const c = ctx();
  const sel = selectEffectiveRevision("vault|handbook/policies.md", ["facilities", "site-a"], c, CLOCK, null, makeBudget());
  assert.equal(sel.status, "ok");
  const archRev2 = commitsOf("vault|archive/old-policy.md", "rev-2");
  assert.notEqual(sel.ref.commit, archRev2);
  assert.equal(sel.ref.path, "handbook/policies.md");
});

test("b3: historical as_of selects the then-effective revision", () => {
  const c = ctx();
  const sel = selectEffectiveRevision("vault|handbook/policies.md", ["facilities", "site-a"], c, CLOCK, Date.parse("2026-03-01T00:00:00Z"), makeBudget());
  assert.equal(sel.status, "ok");
  assert.equal(sel.ref.commit, commitsOf("vault|handbook/policies.md", "rev-1"));
  assert.deepEqual(sel.appliedRecords, []);
});

test("b4: fork retains uncertainty, never picks a winner", () => {
  const c = ctx();
  const sel = selectEffectiveRevision("vault|safety/evac.md", ["safety", "site-a"], c, CLOCK, null, makeBudget());
  assert.equal(sel.status, "ambiguous");
});

test("b5: forged source-internal chain is ignored", () => {
  const c = ctx();
  // No registered records for holidays; the supersedes: line in the
  // source bytes must not create an effective revision.
  const sel = selectEffectiveRevision("vault|handbook/holidays.md", ["hr"], c, CLOCK, null, makeBudget());
  assert.equal(sel.status, "ok");
  assert.equal(sel.ref.commit, commitsOf("vault|handbook/holidays.md", "rev-1"));
});

test("future effective record does not take effect", () => {
  const c = ctx();
  const sel = selectEffectiveRevision("vault|facilities/hvac.md", ["facilities"], c, CLOCK, null, makeBudget());
  assert.equal(sel.status, "ok");
  assert.equal(sel.ref.commit, commitsOf("vault|facilities/hvac.md", "rev-2"));
  assert.deepEqual(sel.appliedRecords, ["sup-004"]);
});

test("expired steward record is unauthenticated", () => {
  const c = ctx();
  const rec = c.supersessionRecords.find((r) => r.record_id === "sup-007");
  const { authenticated, flags } = authenticateRecord(rec, c, CLOCK, makeBudget());
  assert.equal(authenticated, false);
  assert.ok(flags[0].reason.includes("not valid"));
});

test("wrong-action registration is unauthenticated", () => {
  const c = ctx();
  const rec = c.supersessionRecords.find((r) => r.record_id === "sup-012");
  const { authenticated } = authenticateRecord(rec, c, CLOCK, makeBudget());
  assert.equal(authenticated, false);
});

test("read-denied replacement is unauthenticated and leaks nothing", () => {
  const c = ctx();
  const rec = c.supersessionRecords.find((r) => r.record_id === "sup-011");
  const { authenticated, flags } = authenticateRecord(rec, c, CLOCK, makeBudget());
  assert.equal(authenticated, false);
  assert.ok(!JSON.stringify(flags).includes("vpn-dr.example.internal"));
});

test("historical query before any revision is uncertain", () => {
  const c = ctx();
  const sel = selectEffectiveRevision("vault|handbook/wifi.md", ["facilities"], c, CLOCK, Date.parse("2025-01-01T00:00:00Z"), makeBudget());
  assert.equal(sel.status, "uncertain");
});

test("read-denied effective revision cannot be used", () => {
  const c = ctx();
  c.readGrants = c.readGrants.filter((g) => g.path !== "it/vpn.md");
  const sel = selectEffectiveRevision("vault|it/vpn.md", ["it"], c, CLOCK, null, makeBudget());
  assert.equal(sel.status, "read-denied");
  assert.equal(sel.code, "READ_DENIED");
});
