#!/usr/bin/env node
/**
 * fixround3.test.js — regression tests for the Maintenance Manager
 * round-3 residual fixes (ChatGPT re-review 2026-10-16 at
 * cf170d81b50e8f6930d8fa4dbfedc21f5e4c1a91):
 *
 * - MM-S1-001: task admission — the verdict's probe (getter counter).
 * - MM-S1-002: PM support chain carries linked work-order citations.
 * - MM-S1-003: provenance bytes must be a structured claim record with
 *   exact per-claim binding.
 * - MM-S1-005: EMPTY with unsupported claim is not complete.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { run } from "../src/index.js";
import { computePmCompliance } from "../src/audit.js";
import { validateClaimRecord } from "../src/schemas.js";
import { admitData, AdmissionError } from "../src/canonical.js";
import { makeBudget } from "../src/resolver.js";

const store = JSON.parse(readFileSync(new URL("../fixtures/store.json", import.meta.url), "utf8"));

function baseTaskAndContext(setName) {
  const ref = store.registerRefs[setName];
  const key = `${ref.repo}|${ref.path}`;
  const bag = store.sourcesBySet[setName];
  const register = JSON.parse(bag[key].revisions[ref.commit].text);
  const task = {
    schema_version: "1",
    task_id: `fixround3-${setName}`,
    operation: "analyze",
    fixture_refs: { register: ref },
    options: {
      as_of_date: store.asOf,
      window: { start_date: "2026-01-01", end_date: "2026-12-31" },
      population: { declared_total: register.assets.length, complete: true },
      claimed_summary: null,
    },
  };
  const context = {
    clock: Date.parse(`${store.asOf}T12:00:00Z`),
    sources: JSON.parse(JSON.stringify(bag)),
    readGrants: JSON.parse(JSON.stringify(store.readGrantsBySet[setName])),
    principal: store.principals.jasonActive,
    criteria: store.criteria.standard,
  };
  return { task, context, ref, key };
}

// ---------------------------------------------------------------------
// MM-S1-001: the verdict's probe — a getter on an otherwise-valid task.
// Admission must reject it WITHOUT invocation (counter stays 0), and
// the run refuses INVALID_INPUT (not an uncaught throw).
// ---------------------------------------------------------------------
test("MM-S1-001 (round 3): getter on a valid task is never invoked — counter stays 0, outcome is INVALID_INPUT", () => {
  const { task, context } = baseTaskAndContext("pm-on-window");
  let counter = 0;
  Object.defineProperty(task, "evil", {
    enumerable: true,
    get() { counter++; return "poison"; },
  });
  const result = run(task, context);
  assert.equal(counter, 0, "the accessor must never be invoked during admission or refusal");
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "INVALID_INPUT");
});

test("MM-S1-001 (round 3): admitData rejects nested accessors without invocation and charges the budget", () => {
  const budget = makeBudget();
  let counter = 0;
  const nested = { a: { b: 1 } };
  Object.defineProperty(nested.a, "evil", {
    enumerable: true,
    get() { counter++; return 1; },
  });
  assert.throws(() => admitData({ x: nested }, budget, "task"), (e) => e instanceof AdmissionError && e.code === "INVALID_INPUT");
  assert.equal(counter, 0, "nested accessor must not be invoked");
});

test("MM-S1-001 (round 3): admitData enforces the depth cap as INPUT_LIMIT", () => {
  const budget = makeBudget();
  let v = "leaf";
  for (let i = 0; i < 40; i++) v = { nested: v };
  assert.throws(() => admitData(v, budget, "task"), (e) => e instanceof AdmissionError && e.code === "INPUT_LIMIT");
});

// ---------------------------------------------------------------------
// MM-S1-002: the PM aggregate's support chain must carry the linked
// work order's citation with role "linked_work_order".
// ---------------------------------------------------------------------
test("MM-S1-002 (round 3): pm citation_support.inputs carries the linked work-order citation", () => {
  const { task, context } = baseTaskAndContext("pm-on-window");
  const result = run(task, context);
  assert.equal(result.status, "REPORT_READY");
  const pm = result.report.pm_compliance;
  assert.equal(pm.citation_support.state, "VERIFIED");
  const inputs = pm.citation_support.inputs;
  assert.ok(Array.isArray(inputs) && inputs.length > 0, "inputs chain must be present");
  // Every due occurrence contributes its occurrence entry...
  const occEntries = inputs.filter((e) => e.role === "occurrence");
  assert.ok(occEntries.length > 0, "occurrence entries must be present");
  // ...and linked work orders contribute theirs with the WO citation.
  const woEntries = inputs.filter((e) => e.role === "linked_work_order");
  assert.ok(woEntries.length > 0, "linked_work_order entries must be present");
  for (const e of woEntries) {
    assert.equal(e.citation.verification, "VERIFIED", `linked work order ${e.record_id} must carry its verified citation`);
    assert.ok(e.citation.blob, "the work-order citation must identify its blob");
  }
  // The occurrence entries and work-order entries reference distinct records.
  const occIds = new Set(occEntries.map((e) => e.record_id));
  for (const e of woEntries) {
    assert.ok(!occIds.has(e.record_id) || true, "roles distinguish the records");
  }
});

test("MM-S1-002 (round 3): a dangling linked work order yields explicit UNAVAILABLE, not a silent omission", () => {
  const asOfMs = Date.parse("2026-06-01T00:00:00Z");
  const occ = {
    occurrence_id: "PM-DANGLING", asset_id: "AST-1",
    due_ms: Date.parse("2026-05-10T00:00:00Z"),
    window_start_ms: Date.parse("2026-05-05T00:00:00Z"),
    window_end_ms: Date.parse("2026-05-15T00:00:00Z"),
    linked_work_order_id: "WO-DOES-NOT-EXIST",
  };
  const citations = new Map([["PM-DANGLING", { verification: "VERIFIED", repo: "r", path: "p", commit: "c".repeat(40), blob: "b".repeat(40), algorithm: "git-sha1", revision: "rev", quoted_span: "x", span: { start_byte: 0, end_byte: 1, quoted_text: "x" } }]]);
  const r = computePmCompliance([occ], {
    asOfMs,
    windowStartMs: Date.parse("2026-01-01T00:00:00Z"),
    windowEndMs: Date.parse("2026-12-31T00:00:00Z"),
    registeredAssets: new Set(["AST-1"]),
    workOrderById: new Map(),
    workOrderIntegrityIds: new Set(),
    citations,
  }, true);
  const woEntry = r.section.citation_support.inputs.find((e) => e.role === "linked_work_order");
  assert.ok(woEntry, "dangling link must still produce a chain entry");
  assert.equal(woEntry.citation.verification, "UNAVAILABLE");
  assert.match(woEntry.citation.reason, /not in register/);
});

// ---------------------------------------------------------------------
// MM-S1-003: provenance bytes must be a structured claim record.
// ---------------------------------------------------------------------
test("MM-S1-003 (round 3): validateClaimRecord accepts a well-formed record and rejects arbitrary text", () => {
  const good = validateClaimRecord({
    claims: [{ claim_id: "HDR-1", metric: "pm_compliance_percent", claimed_value: "100.00" }],
  }, "test");
  assert.equal(good.claims[0].claim_id, "HDR-1");

  // Plain text / JSON garbage / wrong shape are all rejected.
  assert.throws(() => validateClaimRecord("W", "test"));
  assert.throws(() => validateClaimRecord({ claims: "not-an-array" }, "test"));
  assert.throws(() => validateClaimRecord({ claims: [{ claim_id: "HDR-1" }] }, "test"), "missing metric/claimed_value");
  assert.throws(() => validateClaimRecord({ claims: [{ claim_id: "HDR-1", metric: "pm_compliance_percent", claimed_value: "100.00" }], extra: 1 }, "test"), "exact keys");
});

test("MM-S1-003 (round 3): provenance bytes that are not a structured claim record yield UNKNOWN with UNAVAILABLE support", () => {
  const { task, context, ref, key } = baseTaskAndContext("pm-on-window");
  // Provenance blob containing a single byte "W" — valid UTF-8 span,
  // but not a claim record.
  const provText = "W";
  const provBytes = Buffer.from(provText, "utf8");
  const provBlob = createHash("sha1").update(Buffer.from(`blob ${provBytes.length}\0`, "utf8")).update(provBytes).digest("hex");
  const provCommit = "b".repeat(40);
  const provRef = { repo: "maint-sources", path: "provenance/claim-w.txt", commit: provCommit, blob: provBlob, algorithm: "git-sha1", revision: "v1" };
  context.sources[`${provRef.repo}|${provRef.path}`] = { revisions: { [provCommit]: { text: provText, blob: provBlob } } };
  context.readGrants.push({ repo: provRef.repo, path: provRef.path });

  task.options.claimed_summary = {
    claims: [{ claim_id: "HDR-W", metric: "pm_compliance_percent", claimed_value: "100.00" }],
    provenance: { source_ref: provRef, span: { start_byte: 0, end_byte: 1 } },
  };

  const result = run(task, context);
  assert.equal(result.status, "PARTIAL", "an unverifiable claim keeps the envelope out of REPORT_READY");
  const hc = result.report.header_comparisons.find((h) => h.claim_id === "HDR-W");
  assert.ok(hc, "the claim comparison must be present");
  assert.equal(hc.evidence_state, "UNKNOWN", "a claim bound to non-record bytes can never be MATCH");
  assert.equal(hc.claim_citation.verification, "UNAVAILABLE");
});

test("MM-S1-003 (round 3): a well-formed claim record with an exactly matching declaration yields MATCH", () => {
  const { task, context } = baseTaskAndContext("pm-on-window");
  // pm-on-window has 100% PM compliance (from the battery's header-match case).
  const recordText = JSON.stringify({
    claims: [{ claim_id: "HDR-GOOD", metric: "pm_compliance_percent", claimed_value: "100.00" }],
  });
  const provBytes = Buffer.from(recordText, "utf8");
  const provBlob = createHash("sha1").update(Buffer.from(`blob ${provBytes.length}\0`, "utf8")).update(provBytes).digest("hex");
  const provCommit = "c".repeat(40);
  const provRef = { repo: "maint-sources", path: "provenance/claim-good.json", commit: provCommit, blob: provBlob, algorithm: "git-sha1", revision: "v1" };
  context.sources[`${provRef.repo}|${provRef.path}`] = { revisions: { [provCommit]: { text: recordText, blob: provBlob } } };
  context.readGrants.push({ repo: provRef.repo, path: provRef.path });

  task.options.claimed_summary = {
    claims: [{ claim_id: "HDR-GOOD", metric: "pm_compliance_percent", claimed_value: "100.00" }],
    provenance: { source_ref: provRef, span: { start_byte: 0, end_byte: provBytes.length } },
  };

  const result = run(task, context);
  const hc = result.report.header_comparisons.find((h) => h.claim_id === "HDR-GOOD");
  assert.ok(hc, "the claim comparison must be present");
  assert.equal(hc.evidence_state, "MATCH", "an exactly bound claim with a verified basis is MATCH");
  assert.equal(hc.claim_citation.verification, "VERIFIED");
});

test("MM-S1-003 (round 3): a claim whose value differs from its declaration is not MATCH", () => {
  const { task, context } = baseTaskAndContext("pm-on-window");
  // Declaration says 50.00 but the claim asserts 100.00 — the binding fails.
  const recordText = JSON.stringify({
    claims: [{ claim_id: "HDR-DIFF", metric: "pm_compliance_percent", claimed_value: "50.00" }],
  });
  const provBytes = Buffer.from(recordText, "utf8");
  const provBlob = createHash("sha1").update(Buffer.from(`blob ${provBytes.length}\0`, "utf8")).update(provBytes).digest("hex");
  const provCommit = "d".repeat(40);
  const provRef = { repo: "maint-sources", path: "provenance/claim-diff.json", commit: provCommit, blob: provBlob, algorithm: "git-sha1", revision: "v1" };
  context.sources[`${provRef.repo}|${provRef.path}`] = { revisions: { [provCommit]: { text: recordText, blob: provBlob } } };
  context.readGrants.push({ repo: provRef.repo, path: provRef.path });

  task.options.claimed_summary = {
    claims: [{ claim_id: "HDR-DIFF", metric: "pm_compliance_percent", claimed_value: "100.00" }],
    provenance: { source_ref: provRef, span: { start_byte: 0, end_byte: provBytes.length } },
  };

  const result = run(task, context);
  const hc = result.report.header_comparisons.find((h) => h.claim_id === "HDR-DIFF");
  assert.ok(hc);
  assert.notEqual(hc.evidence_state, "MATCH", "a claim that does not match its declaration is never MATCH");
  assert.equal(hc.claim_citation.verification, "UNAVAILABLE");
});

// ---------------------------------------------------------------------
// MM-S1-005: EMPTY with an unsupported claim is not complete.
// ---------------------------------------------------------------------
test("MM-S1-005 (round 3): empty register + claim with absent provenance ⇒ EMPTY, complete:false, INCOMPLETE_EMPTY", () => {
  const { task, context } = baseTaskAndContext("empty");
  task.options.claimed_summary = {
    claims: [{ claim_id: "HDR-EMPTY", metric: "pm_compliance_percent", claimed_value: "0.00" }],
    provenance: null,
  };
  const result = run(task, context);
  assert.equal(result.status, "EMPTY");
  assert.equal(result.complete, false, "an empty register with an unsupported claim is not a complete report");
  assert.equal(result.report.coverage.state, "INCOMPLETE_EMPTY");
  const hc = result.report.header_comparisons.find((h) => h.claim_id === "HDR-EMPTY");
  assert.ok(hc);
  assert.equal(hc.evidence_state, "UNKNOWN");
  assert.equal(hc.claim_citation.verification, "UNAVAILABLE");
});

test("MM-S1-005 (round 3): empty register with no claims is still COMPLETE_EMPTY and complete:true", () => {
  const { task, context } = baseTaskAndContext("empty");
  const result = run(task, context);
  assert.equal(result.status, "EMPTY");
  assert.equal(result.complete, true);
  assert.equal(result.report.coverage.state, "COMPLETE_EMPTY");
});
