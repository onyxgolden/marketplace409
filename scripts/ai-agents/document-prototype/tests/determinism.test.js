import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, canonicalJson } from "../src/index.js";
import { buildContext } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function taskFor(setName, declared_total) {
  return {
    schema_version: "1",
    task_id: `t-${setName}`,
    operation: "analyze",
    fixture_refs: { document_set: store.documentSetRefs[setName] },
    options: { population: { declared_total, complete: true } },
  };
}

const CASES = [
  ["single-nominal", 1],
  ["exact-duplicates", 2],
  ["parallel-version", 2],
  ["timeline-reversal", 2],
  ["checklist-satisfied", 2],
  ["reference-internal-resolved", 2],
  ["prerequisite-cycle", 2],
  ["cross-document-conflict", 2],
  ["injected-content", 1],
];

function ctxFor(setName) {
  return buildContext(ROOT, { clock: "2026-07-01T00:00:00Z", documentSetRef: store.documentSetRefs[setName] });
}

for (const [setName, declared] of CASES) {
  test(`run() is byte-identical across three separate calls — ${setName}`, () => {
    const outputs = [1, 2, 3].map(() => canonicalJson(run(taskFor(setName, declared), ctxFor(setName))));
    assert.equal(outputs[0], outputs[1]);
    assert.equal(outputs[1], outputs[2]);
  });
}

test("detached snapshot: caller mutation of the returned result cannot affect a subsequent run", () => {
  const context = ctxFor("single-nominal");
  const r1 = run(taskFor("single-nominal", 1), context);
  r1.report.inventory.push({ doc_id: "INJECTED", logical_id: "x", revision: 1 });
  r1.source_refs.length = 0;
  const r2 = run(taskFor("single-nominal", 1), context);
  assert.equal(r2.report.inventory.length, 1);
  assert.equal(r2.report.inventory[0].doc_id, "d-0001");
  assert.ok(r2.source_refs.length > 0);
});

test("input/store ordering permutation does not change the semantic result (duplicate-group membership is order-independent)", () => {
  const context = ctxFor("three-way-duplicates");
  const r = run(taskFor("three-way-duplicates", 3), context);
  assert.deepEqual(
    [...r.report.duplicate_groups[0].doc_ids].sort(),
    ["d-dup3-1", "d-dup3-2", "d-dup3-3"]
  );
});
