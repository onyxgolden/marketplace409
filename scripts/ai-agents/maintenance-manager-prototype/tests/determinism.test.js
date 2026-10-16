import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { canonicalJson, gitBlobId } from "../src/canonical.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function taskAndContext(setName) {
  const ref = store.registerRefs[setName];
  const key = `${ref.repo}|${ref.path}`;
  const bag = store.sourcesBySet[setName];
  const register = JSON.parse(bag[key].revisions[ref.commit].text);
  const task = {
    schema_version: "1", task_id: "unit", operation: "analyze",
    fixture_refs: { register: ref },
    options: { as_of_date: store.asOf, window: { start_date: "2026-01-01", end_date: "2026-12-31" }, population: { declared_total: register.assets.length, complete: true } },
  };
  const context = {
    clock: Date.parse(`${store.asOf}T12:00:00Z`),
    sources: bag,
    readGrants: store.readGrantsBySet[setName],
    principal: store.principals.jasonActive,
    criteria: store.criteria.standard,
  };
  return { task, context };
}

test("run() is byte-identical across three separate invocations with fixed context", () => {
  const { task, context } = taskAndContext("nominal-small");
  const r1 = canonicalJson(run(task, context));
  const r2 = canonicalJson(run(task, context));
  const r3 = canonicalJson(run(task, context));
  assert.equal(r1, r2);
  assert.equal(r2, r3);
});

test("run() output is detached: mutating the returned result does not affect a subsequent fresh run", () => {
  const { task, context } = taskAndContext("nominal-small");
  const result = run(task, context);
  result.report.backlog.total = 999999;
  result.integrity_findings = ["tampered"];
  const fresh = run(task, context);
  assert.notEqual(fresh.report.backlog.total, 999999);
});

test("input/store ordering permutation does not change the semantic result (work order array reordered)", () => {
  const { task, context } = taskAndContext("nominal-small");
  const a = run(task, context);

  const ref = task.fixture_refs.register;
  const key = `${ref.repo}|${ref.path}`;
  const reorderedContext = JSON.parse(JSON.stringify(context));
  const reg = JSON.parse(reorderedContext.sources[key].revisions[ref.commit].text);
  reg.work_orders.reverse();
  reorderedContext.sources[key].revisions[ref.commit].text = JSON.stringify(reg);
  // Re-pin the blob to the reordered text so the resolver's independent
  // hash check doesn't itself refuse this case — a different (but
  // honestly repinned) register, not a forged one.
  const newBlob = gitBlobId(Buffer.from(JSON.stringify(reg), "utf8"));
  const reorderedTask = JSON.parse(JSON.stringify(task));
  reorderedTask.fixture_refs.register.blob = newBlob;

  const b = run(reorderedTask, reorderedContext);
  assert.deepEqual(a.report.backlog, b.report.backlog);
  assert.deepEqual(a.report.overdue, b.report.overdue);
  assert.equal(a.report.cancelled_count, b.report.cancelled_count);
});
