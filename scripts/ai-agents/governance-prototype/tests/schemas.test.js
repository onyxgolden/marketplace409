/**
 * schemas.test.js — strict runtime schema rejections.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { buildContext } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = () => buildContext(ROOT, { contextOverrides: null });

function baseTask() {
  const c = ctx();
  const h = c.heads.find((x) => x.resource_id === "pr:707");
  return {
    request_id: "gov-schema-1",
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
    payload_context: { evidence_record_ids: [] },
  };
}

function refusedWith(task, context, code) {
  const r = run(task, context ?? ctx());
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === code), `expected ${code}, got ${r.diagnostics.map((d) => d.code)}`);
  assert.equal(r.classification, "DENIED");
  assert.equal(r.complete, false);
}

test("unknown control field is rejected", () => {
  const t = baseTask(); t.extra_field = 1;
  refusedWith(t, null, "INVALID_INPUT");
});

test("abbreviated head pin is rejected", () => {
  const t = baseTask(); t.target.head = "deadbeef";
  refusedWith(t, null, "INVALID_INPUT");
});

test("unsupported action_type enum is rejected", () => {
  const t = baseTask(); t.action_type = "launch";
  refusedWith(t, null, "INVALID_INPUT");
});

test("duplicate evidence ids are rejected", () => {
  const t = baseTask(); t.payload_context = { evidence_record_ids: ["ev:clean-note-1", "ev:clean-note-1"] };
  refusedWith(t, null, "INVALID_INPUT");
});

test("unregistered evidence reference is refused", () => {
  const t = baseTask(); t.payload_context = { evidence_record_ids: ["ev:nope"] };
  refusedWith(t, null, "INVALID_INPUT");
});

test("unsafe source path is rejected", () => {
  const t = baseTask(); t.target.source_ref.path = "../../etc/passwd";
  refusedWith(t, null, "INVALID_INPUT");
});

test("nonfinite clock is rejected", () => {
  const t = baseTask(); const c = ctx(); c.clock = NaN;
  refusedWith(t, c, "INVALID_INPUT");
});

test("duplicate principal ids fail closed", () => {
  const t = baseTask(); const c = ctx();
  c.principals = [...c.principals, { ...c.principals[0] }];
  refusedWith(t, c, "INVALID_INPUT");
});

test("oversize evidence list hits INPUT_LIMIT", () => {
  const t = baseTask();
  t.payload_context = { evidence_record_ids: Array.from({ length: 65 }, (_, i) => `ev:pad-${i}`) };
  refusedWith(t, null, "INPUT_LIMIT");
});

test("execute_action is ACTION_DENIED", () => {
  const t = baseTask(); t.requested_action = "execute_action";
  const r = run(t, ctx());
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "ACTION_DENIED"));
  assert.equal(r.authorization_granted, false);
  assert.equal(r.execution_performed, false);
});
