/**
 * budgets.test.js — input/output budgets and the host watchdog fail closed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { runCaseWithWatchdog, watchdogRefusal } from "./watchdog.js";
import { buildContext } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("evidence list beyond the source-object budget hits INPUT_LIMIT", () => {
  const context = buildContext(ROOT, { contextOverrides: null });
  const h = context.heads.find((x) => x.resource_id === "pr:707");
  const task = {
    request_id: "gov-budget-1",
    requested_action: "classify",
    actor_ref: "principal:claude",
    action_type: "merge",
    target: {
      repo: "onyxgolden/marketplace409",
      resource_id: "pr:707",
      resource_class: "pr",
      scope_ids: ["scope:release-cadence"],
      head: h.head,
      source_ref: JSON.parse(JSON.stringify(h.source_ref)),
    },
    payload_context: { evidence_record_ids: Array.from({ length: 65 }, (_, i) => `ev:pad-${i}`) },
  };
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INPUT_LIMIT"));
  assert.equal(r.complete, false);
});

test("host watchdog terminates a hanging case with a named fail-closed refusal", async () => {
  const context = buildContext(ROOT, { contextOverrides: null });
  const outcome = await runCaseWithWatchdog(ROOT, { request_id: "gov-hang" }, context, { timeoutMs: 300, hang: true });
  assert.equal(outcome.timeout, true, "hanging worker must hit the watchdog");
  const refusal = watchdogRefusal({ request_id: "gov-hang" }, 300);
  assert.equal(refusal.status, "REFUSED");
  assert.equal(refusal.diagnostics[0].code, "WATCHDOG_TIMEOUT");
  assert.equal(refusal.classification, "DENIED");
  assert.equal(refusal.complete, false);
});

test("empty evidence list and minimal task stay within budget", () => {
  const context = buildContext(ROOT, { contextOverrides: null });
  const h = context.heads.find((x) => x.resource_id === "doc:onboarding-guide");
  const task = {
    request_id: "gov-budget-2",
    requested_action: "classify",
    actor_ref: "principal:claude",
    action_type: "read",
    target: {
      repo: "onyxgolden/marketplace409",
      resource_id: "doc:onboarding-guide",
      resource_class: "doc",
      scope_ids: ["scope:docs-public"],
      head: h.head,
      source_ref: JSON.parse(JSON.stringify(h.source_ref)),
    },
    payload_context: { evidence_record_ids: [] },
  };
  const r = run(task, context);
  assert.equal(r.status, "CLASSIFIED");
  assert.equal(r.classification, "ALLOWED");
});

test("GOV-002: few records with large blob strings exceed the 256 KiB total-input cap", () => {
  const context = buildContext(ROOT, { contextOverrides: null });
  // A blob that is never resolved by this evaluation: far fewer than the
  // object caps, but its bytes must still count toward the 256 KiB cap.
  context.blobs["synthetic|unread/big.txt|" + "0".repeat(40)] = { content: "x".repeat(300 * 1024) };
  const h = context.heads.find((x) => x.resource_id === "doc:onboarding-guide");
  const task = {
    request_id: "gov-budget-gov002-over",
    requested_action: "classify",
    actor_ref: "principal:claude",
    action_type: "read",
    target: {
      repo: "onyxgolden/marketplace409",
      resource_id: "doc:onboarding-guide",
      resource_class: "doc",
      scope_ids: ["scope:docs-public"],
      head: h.head,
      source_ref: JSON.parse(JSON.stringify(h.source_ref)),
    },
    payload_context: { evidence_record_ids: [] },
  };
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INPUT_LIMIT"), "byte over-limit must report INPUT_LIMIT");
  assert.equal(r.complete, false);
});

test("GOV-002: large-but-under-cap context still classifies (no false refusal)", () => {
  const context = buildContext(ROOT, { contextOverrides: null });
  // ~200 KiB of never-resolved bytes: under the 256 KiB cap, must not
  // refuse on bytes.
  context.blobs["synthetic|unread/big.txt|" + "0".repeat(40)] = { content: "y".repeat(200 * 1024) };
  const h = context.heads.find((x) => x.resource_id === "doc:onboarding-guide");
  const task = {
    request_id: "gov-budget-gov002-under",
    requested_action: "classify",
    actor_ref: "principal:claude",
    action_type: "read",
    target: {
      repo: "onyxgolden/marketplace409",
      resource_id: "doc:onboarding-guide",
      resource_class: "doc",
      scope_ids: ["scope:docs-public"],
      head: h.head,
      source_ref: JSON.parse(JSON.stringify(h.source_ref)),
    },
    payload_context: { evidence_record_ids: [] },
  };
  const r = run(task, context);
  assert.equal(r.status, "CLASSIFIED");
  assert.equal(r.classification, "ALLOWED");
});

test("GOV-002: non-serializable context fails closed as invalid input, never throws", () => {
  const context = buildContext(ROOT, { contextOverrides: null });
  context.circular = context; // JSON.stringify would throw
  const h = context.heads.find((x) => x.resource_id === "doc:onboarding-guide");
  const task = {
    request_id: "gov-budget-gov002-circular",
    requested_action: "classify",
    actor_ref: "principal:claude",
    action_type: "read",
    target: {
      repo: "onyxgolden/marketplace409",
      resource_id: "doc:onboarding-guide",
      resource_class: "doc",
      scope_ids: ["scope:docs-public"],
      head: h.head,
      source_ref: JSON.parse(JSON.stringify(h.source_ref)),
    },
    payload_context: { evidence_record_ids: [] },
  };
  let r;
  assert.doesNotThrow(() => { r = run(task, context); });
  assert.equal(r.status, "REFUSED");
});

test("GOV-003: grounded outputs cite the exact consulted SourceRefs", () => {
  const context = buildContext(ROOT, { contextOverrides: null });
  const h = context.heads.find((x) => x.resource_id === "doc:onboarding-guide");
  const targetSourceRef = JSON.parse(JSON.stringify(h.source_ref));
  const task = {
    request_id: "gov-budget-gov003",
    requested_action: "classify",
    actor_ref: "principal:claude",
    action_type: "read",
    target: {
      repo: "onyxgolden/marketplace409",
      resource_id: "doc:onboarding-guide",
      resource_class: "doc",
      scope_ids: ["scope:docs-public"],
      head: h.head,
      source_ref: targetSourceRef,
    },
    payload_context: { evidence_record_ids: [] },
  };
  const r = run(task, context);
  assert.equal(r.status, "CLASSIFIED");
  assert.equal(r.validity, "GROUNDED");
  assert.ok(Array.isArray(r.source_refs) && r.source_refs.length > 0, "GROUNDED output must list consulted sources");
  for (const s of r.source_refs) {
    assert.ok(typeof s.repo === "string" && s.repo.length > 0);
    assert.ok(typeof s.path === "string" && s.path.length > 0);
    assert.ok(/^[0-9a-f]{40}$/.test(s.commit), "commit must be 40-hex");
    assert.ok(/^[0-9a-f]{40}$/.test(s.blob), "blob must be 40-hex git sha1");
  }
  const keys = r.source_refs.map((s) => `${s.repo}|${s.path}|${s.commit}|${s.blob}`);
  assert.deepEqual(keys, [...keys].sort(), "source_refs must be deterministically ordered");
  assert.equal(new Set(keys).size, keys.length, "source_refs must not duplicate");
  const tkey = `${targetSourceRef.repo}|${targetSourceRef.path}|${targetSourceRef.commit}|${targetSourceRef.blob}`;
  assert.ok(keys.includes(tkey), "target source_ref must be cited");
  const hkey = `${h.source_ref.repo}|${h.source_ref.path}|${h.source_ref.commit}|${h.source_ref.blob}`;
  assert.ok(keys.includes(hkey), "head-registry source_ref must be cited");
});

test("GOV-003: quarantined sources are dropped from the consulted list", async () => {
  const { makeBudget } = await import("../src/resolver.js");
  const b = makeBudget();
  const sr = { repo: "r", path: "p", commit: "a".repeat(40), blob: "b".repeat(40) };
  b.noteSourceRef(sr);
  b.noteSourceRef(sr); // idempotent
  assert.equal(b.listedSourceRefs().length, 1);
  b.dropSourceRef(sr);
  assert.equal(b.listedSourceRefs().length, 0, "quarantined source must not be listed");
});
