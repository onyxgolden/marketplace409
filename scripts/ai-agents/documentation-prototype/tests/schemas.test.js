/**
 * schemas.test.js — runtime schema gates: unknown properties, malformed
 * pins, duplicate claim IDs, bad spans, bad enums.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { buildContext } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function ctxFor(c) {
  return buildContext(ROOT, c).context;
}

function firstDriftTask() {
  const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
  return JSON.parse(JSON.stringify(battery[0]));
}

test("unknown top-level property -> REFUSED INVALID_INPUT", () => {
  const c = firstDriftTask();
  c.task.bogus = 1;
  const r = run(c.task, ctxFor(c));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("unknown claim_spec property -> REFUSED INVALID_INPUT", () => {
  const c = firstDriftTask();
  c.task.claim_specs[0].extra = "x";
  const r = run(c.task, ctxFor(c));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("duplicate claim_id -> REFUSED INVALID_INPUT", () => {
  const c = firstDriftTask();
  c.task.claim_specs.push({ ...c.task.claim_specs[0] });
  const r = run(c.task, ctxFor(c));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("abbreviated commit pin -> REFUSED INVALID_INPUT", () => {
  const c = firstDriftTask();
  c.task.doc_ref.commit = c.task.doc_ref.commit.slice(0, 7);
  const r = run(c.task, ctxFor(c));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("path traversal in doc_ref -> REFUSED INVALID_INPUT", () => {
  const c = firstDriftTask();
  c.task.doc_ref.path = "../../etc/passwd";
  const r = run(c.task, ctxFor(c));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("inverted doc_span bytes -> REFUSED INVALID_INPUT", () => {
  const c = firstDriftTask();
  const s = c.task.claim_specs[0].doc_span;
  c.task.claim_specs[0].doc_span = { quoted_text: s.quoted_text, start_byte: s.end_byte, end_byte: s.start_byte };
  const r = run(c.task, ctxFor(c));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("empty claim_specs -> REFUSED INVALID_INPUT", () => {
  const c = firstDriftTask();
  c.task.claim_specs = [];
  const r = run(c.task, ctxFor(c));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("missing context clock -> REFUSED INVALID_INPUT, never an exception", () => {
  const c = firstDriftTask();
  const ctx = ctxFor(c);
  delete ctx.clock;
  const r = run(c.task, ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("unsupported requested_action -> REFUSED UNSUPPORTED_TASK", () => {
  const c = firstDriftTask();
  c.task.requested_action = "summarize";
  const r = run(c.task, ctxFor(c));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "UNSUPPORTED_TASK");
});
