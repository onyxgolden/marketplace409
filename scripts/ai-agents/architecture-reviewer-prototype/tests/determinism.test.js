/**
 * determinism.test.js — repeat runs are byte-identical; clause order
 * does not change the verdict or findings; inputs are never mutated.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { canonicalJson, gitBlobSha1Utf8 } from "../src/canonical.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLOCK = Date.parse("2026-10-12T12:00:00Z");
const clone = (v) => JSON.parse(JSON.stringify(v));

function loadCase(id) {
  const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
  const c = battery.find((x) => x.case_id === id);
  const designs = {};
  designs[`${c.task.design_ref.repo}\0${c.task.design_ref.path}\0${c.task.design_ref.commit}`] = c.fixture.design;
  return { task: c.task, context: { clock: CLOCK, designs, principals: [], gatePolicy: {} } };
}

test("repeat runs are byte-identical under a fixed context", () => {
  const { task, context } = loadCase("ar-clean-01");
  const a = canonicalJson(run(clone(task), clone(context)));
  const b = canonicalJson(run(clone(task), clone(context)));
  assert.equal(a, b);
});

test("clause declaration order does not change the verdict or findings", () => {
  const { task, context } = loadCase("ar-clean-01");
  const key = Object.keys(context.designs)[0];
  const bytes = context.designs[key];
  const lines = bytes.split("\n");
  const shuffled = [lines[0], ...lines.slice(1).reverse()].join("\n");
  // Re-pin the blob for the shuffled bytes so source binding still verifies.
  const task2 = clone(task);
  task2.design_ref = { ...task2.design_ref, blob: gitBlobSha1Utf8(shuffled) };
  const context2 = clone(context);
  context2.designs[key] = shuffled;
  const a = run(clone(task), clone(context));
  const b = run(task2, context2);
  assert.equal(a.status, b.status);
  assert.equal(a.verdict_proposal.value, b.verdict_proposal.value);
  assert.deepEqual(
    a.findings.map((f) => [f.check_id, f.severity, f.validity]).sort(),
    b.findings.map((f) => [f.check_id, f.severity, f.validity]).sort()
  );
});

test("duplicate identical clauses are deduplicated, not double-counted", () => {
  const { task, context } = loadCase("ar-clean-05");
  const r = run(task, context);
  assert.equal(r.status, "REVIEWED");
  assert.equal(r.verdict_proposal.value, "GO");
  assert.equal(r.findings.length, 0);
});

test("run() never mutates the task or context objects", () => {
  const { task, context } = loadCase("ar-contra-01");
  const beforeTask = canonicalJson(task);
  const beforeCtx = canonicalJson(context);
  run(task, context);
  assert.equal(canonicalJson(task), beforeTask, "task mutated");
  assert.equal(canonicalJson(context), beforeCtx, "context mutated");
});
