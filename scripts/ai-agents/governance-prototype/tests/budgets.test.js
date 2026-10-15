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
