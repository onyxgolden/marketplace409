/**
 * schemas.test.js — malformed tasks are denied structurally; prohibited
 * actions are refused with ACTION_DENIED; valid minimal tasks pass.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { run } from "../src/index.js";

const CLOCK = Date.parse("2026-10-12T12:00:00Z");
const hex40 = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 40);
const ctx = { clock: CLOCK, designs: {}, principals: [], gatePolicy: {} };

function validReviewTask() {
  const id = "schema-ok";
  const text = [
    "# DESIGN: ok",
    "[check:component-io] inputs: a; outputs: b",
    "[check:migration-pre-post] precondition: p; postcondition: q",
    "[check:read-write-boundary] reads: r; writes: w",
    "[check:retry-bounds] max_retries: 3",
    "[check:rollback] rollback: reverse on failure",
    "[check:failure-handling] on_failure: queue",
  ].join("\n");
  const b = Buffer.from(text, "utf8");
  const blob = createHash("sha1").update(Buffer.from(`blob ${b.length}\0`, "utf8")).update(b).digest("hex");
  const commit = hex40(id);
  const design_ref = { repo: "r", path: "d.md", commit, blob, algorithm: "git-sha1" };
  return {
    task: {
      design_ref,
      base_pin: { repo: "r", commit },
      scope_ids: [],
      required_check_ids: [],
      evidence_refs: [],
      requested_action: "review",
    },
    context: { clock: CLOCK, designs: { [`r\0d.md\0${commit}`]: text }, principals: [], gatePolicy: {} },
  };
}

test("valid review task is REVIEWED with GO", () => {
  const { task, context } = validReviewTask();
  const r = run(task, context);
  assert.equal(r.status, "REVIEWED");
  assert.equal(r.verdict_proposal.value, "GO");
  assert.equal(r.advisory, true);
  assert.equal(r.authorization_granted, false);
});

test("abbreviated blob pin is INVALID_INPUT", () => {
  const { task, context } = validReviewTask();
  task.design_ref.blob = "abc123";
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
});

test("unknown task property is INVALID_INPUT", () => {
  const { task, context } = validReviewTask();
  task.extra = 1;
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
});

test("duplicate required_check_ids are INVALID_INPUT", () => {
  const { task, context } = validReviewTask();
  task.required_check_ids = ["retry-bounds", "retry-bounds"];
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
});

test("non-object task is INVALID_INPUT", () => {
  const r = run("nope", ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
});

test("prohibited actions are REFUSED with ACTION_DENIED and null proposal", () => {
  for (const act of ["merge", "deploy", "execute", "approve", "activate"]) {
    const { task, context } = validReviewTask();
    task.requested_action = act;
    const r = run(task, context);
    assert.equal(r.status, "REFUSED", act);
    assert.ok(r.diagnostics.some((d) => d.code === "ACTION_DENIED"), act);
    assert.equal(r.verdict_proposal, null, act);
    assert.equal(r.authorization_granted, false, act);
  }
});

test("unsupported action is INVALID_INPUT, not a silent success", () => {
  const { task, context } = validReviewTask();
  task.requested_action = "teleport";
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
  assert.notEqual(r.verdict_proposal?.value, "GO");
});
