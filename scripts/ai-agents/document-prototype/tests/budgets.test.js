import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeBudget, BudgetError, BUDGET_LIMITS } from "../src/resolver.js";
import { run } from "../src/index.js";
import { buildContext } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

test("makeBudget: object count fails closed exactly at the limit+1, not before", () => {
  const b = makeBudget();
  for (let i = 0; i < BUDGET_LIMITS.maxObjects; i++) assert.doesNotThrow(() => b.countObject(`x${i}`));
  assert.throws(() => b.countObject("over"), BudgetError);
});

test("makeBudget: span count fails closed exactly at the limit+1", () => {
  const b = makeBudget();
  for (let i = 0; i < BUDGET_LIMITS.maxSpans; i++) assert.doesNotThrow(() => b.countSpan(`x${i}`));
  assert.throws(() => b.countSpan("over"), BudgetError);
});

test("makeBudget: payload byte count fails closed over the limit", () => {
  const b = makeBudget();
  assert.doesNotThrow(() => b.countPayload("a".repeat(BUDGET_LIMITS.maxPayloadBytes), "x"));
  assert.throws(() => b.countPayload("a", "x"), BudgetError);
});

function taskFor(setName, declared_total) {
  return {
    schema_version: "1",
    task_id: `t-${setName}`,
    operation: "analyze",
    fixture_refs: { document_set: store.documentSetRefs[setName] },
    options: { population: { declared_total, complete: true } },
  };
}

test("exact boundary: 56 documents sharing one content blob (6 fixed + 56 docs + 1 shared content grant+resolution = 64) succeed fully", () => {
  const context = buildContext(ROOT, { clock: "2026-07-01T00:00:00Z" });
  const result = run(taskFor("sixty-one-documents-shared-content", 56), context);
  assert.equal(result.status, "REPORT_READY");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.report.coverage.admitted_count, 56);
});

test("budget sentinel: 65 documents, the last 3 structurally poisoned, refuses BUDGET_EXCEEDED — proving the poisoned entries were never inspected", () => {
  const context = buildContext(ROOT, { clock: "2026-07-01T00:00:00Z" });
  const result = run(taskFor("sixty-five-documents-poisoned-tail", 65), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  // If the poisoned entries (missing required fields) had been inspected
  // at all, the schema validator would raise SchemaError for them first —
  // the only way this test can see BUDGET_EXCEEDED instead is if the
  // budget check fired before validateDocument ever ran on them.
  assert.ok(!result.diagnostics.some((d) => d.code === "INVALID_INPUT"));
});

test("65 documents (no sharing) refuses during the document-record charging phase itself", () => {
  const context = buildContext(ROOT, { clock: "2026-07-01T00:00:00Z" });
  const result = run(taskFor("sixty-five-documents", 65), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.match(result.diagnostics[0].reason, /remaining documents/);
});

test("58 documents (distinct content) refuses during the content-resolution phase, after all 58 document records were themselves charged successfully", () => {
  const context = buildContext(ROOT, { clock: "2026-07-01T00:00:00Z" });
  const result = run(taskFor("sixty-two-documents", 58), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.match(result.diagnostics[0].reason, /content read grant/);
});

test("65 assertions on one document refuses BUDGET_EXCEEDED before inspecting the remaining assertions", () => {
  const context = buildContext(ROOT, { clock: "2026-07-01T00:00:00Z" });
  const result = run(taskFor("sixty-five-assertions", 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.match(result.diagnostics[0].reason, /remaining assertions/);
});

test("oversized document-set bundle text is rejected (INPUT_LIMIT) before any per-document parsing or charging", () => {
  // task_id itself is capped at 2048 bytes by schema validation, so the
  // task payload can never organically exceed 256 KiB — this exercises
  // the OTHER countPayload call, on the resolved document-set bundle
  // text itself, which has no such schema-level cap.
  const context = buildContext(ROOT, { clock: "2026-07-01T00:00:00Z" });
  const result = run(taskFor("oversized-document-set-text", 900), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "INPUT_LIMIT");
});
