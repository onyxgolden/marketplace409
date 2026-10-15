import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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

function ctxFor(setName, extra = {}) {
  return buildContext(ROOT, { clock: "2026-07-01T00:00:00Z", documentSetRef: store.documentSetRefs[setName], ...extra });
}

test("exact boundary: 50 documents sharing one content blob succeed fully (empirically verified boundary, not hand-derived)", () => {
  const context = ctxFor("fifty-documents-shared-content");
  const result = run(taskFor("fifty-documents-shared-content", 50), context);
  assert.equal(result.status, "REPORT_READY");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.report.coverage.admitted_count, 50);
});

test("budget sentinel: documents with the last 3 structurally poisoned, refuses BUDGET_EXCEEDED — proving the poisoned entries were never inspected", () => {
  const context = ctxFor("sixty-five-documents-poisoned-tail");
  const result = run(taskFor("sixty-five-documents-poisoned-tail", 65), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  // If the poisoned entries (missing required fields) had been inspected
  // at all, the schema validator would raise SchemaError for them first —
  // the only way this test can see BUDGET_EXCEEDED instead is if the
  // budget check fired before validateDocument ever ran on them.
  assert.ok(!result.diagnostics.some((d) => d.code === "INVALID_INPUT"));
});

test("65 documents (no sharing) refuses — 65 distinct content refs means a 67-entry source catalog, which now fails the schema-level 64-entry catalog cap before any object charging even begins", () => {
  const context = ctxFor("sixty-five-documents");
  const result = run(taskFor("sixty-five-documents", 65), context);
  assert.equal(result.status, "REFUSED");
  // Either refusal reason is a correct fail-closed outcome here — the
  // catalog itself is too large (INVALID_INPUT, the schema-level 1..64
  // entries cap) or, if it somehow got past that, the object budget
  // would catch it (BUDGET_EXCEEDED). What matters is REFUSED, not which
  // specific earlier gate caught it first.
  assert.ok(["INVALID_INPUT", "BUDGET_EXCEEDED"].includes(result.diagnostics[0].code));
});

test("11 documents (distinct content) refuses — the 11th document's content resolution overflows after all 11 document records charged successfully (empirically verified boundary)", () => {
  const context = ctxFor("eleven-documents-distinct-content");
  const result = run(taskFor("eleven-documents-distinct-content", 11), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
});

test("65 assertions on one document refuses BUDGET_EXCEEDED before inspecting the remaining assertions", () => {
  const context = ctxFor("sixty-five-assertions");
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
  const context = ctxFor("oversized-document-set-text");
  const result = run(taskFor("oversized-document-set-text", 900), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "INPUT_LIMIT");
});

// ---------------------------------------------------------------------
// DOC-002R: context (sources/revisions/readGrants) is itself a candidate
// population now, not a free pre-pass. These prove the fix against
// ChatGPT's exact reproduction: candidates past the object cap are
// genuinely never read — not merely never used — for BOTH registry
// revisions and read grants.
// ---------------------------------------------------------------------

function fillerCommit(seed) {
  return createHash("sha1").update(Buffer.from(`doc002r-filler|${seed}`, "utf8")).digest("hex");
}

// Deliberately generous: the point is only that the poisoned candidate
// — inserted LAST, so it's iterated last under Object.keys()'s
// insertion-order guarantee for string keys — sits well past the
// 64-object cap regardless of exactly how many fixed charges the base
// context itself costs. The exact overflow point doesn't need to be
// hand-derived for this test to be meaningful. Kept small enough (with
// the base context's own few real entries) to stay under the separate
// 1..64-entry SOURCES CATALOG schema cap — that cap would otherwise
// reject the context before any object-budget charging is even
// reached, which would make this test pass for the wrong reason.
const SOURCES_FILLER_COUNT = 30;
const GRANTS_FILLER_COUNT = 100; // no analogous structural cap on readGrants' length, so this one can stay generous.

test("DOC-002R poisoned tail (registry revisions): a context.sources revision past the object cap is never read, not merely never charged", () => {
  const base = ctxFor("single-nominal");
  let poisonTouched = false;
  const poisonedRevision = new Proxy(
    {},
    {
      get(_target, prop) {
        poisonTouched = true;
        throw new Error(`poisoned registry revision had '${String(prop)}' read — it should have been refused before any field access`);
      },
    }
  );
  const extraSources = {};
  const extraGrants = [];
  for (let i = 0; i < SOURCES_FILLER_COUNT; i++) {
    const path = `filler/${String(i).padStart(4, "0")}.md`;
    const commit = fillerCommit(i);
    extraSources[`edu-sources|${path}`] = { revisions: { [commit]: { text: "filler", blob: "a".repeat(40) } } };
    extraGrants.push({ repo: "edu-sources", path });
  }
  // Poisoned entry inserted LAST, with a real-looking commit key so the
  // for-loop over Object.keys(revs) actually reaches it, but the VALUE
  // at that commit is the throwing Proxy — real validateContext code
  // charges budget.countObject() before ever reading rev.text/rev.blob.
  const poisonCommit = fillerCommit("poison");
  extraSources["edu-sources|poison/zzzz.md"] = { revisions: { [poisonCommit]: poisonedRevision } };
  extraGrants.push({ repo: "edu-sources", path: "poison/zzzz.md" });

  const context = { ...base, sources: { ...base.sources, ...extraSources }, readGrants: [...base.readGrants, ...extraGrants] };
  const result = run(taskFor("single-nominal", 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.equal(poisonTouched, false, "the poisoned revision past the object cap must never be read, not just never used");
});

test("DOC-002R poisoned tail (read grants): a context.readGrants entry past the object cap is never read, not merely never charged", () => {
  const base = ctxFor("single-nominal");
  let poisonTouched = false;
  // A grant entry that looks real-ish structurally (so validateReadGrant
  // reading .repo/.path, IF it were ever reached, would trip the proxy)
  // but throws the moment ANY property is read.
  const poisonedGrant = new Proxy(
    {},
    {
      get(_target, prop) {
        poisonTouched = true;
        throw new Error(`poisoned read grant had '${String(prop)}' read — it should have been refused before any field access`);
      },
    }
  );
  const extraGrants = [];
  for (let i = 0; i < GRANTS_FILLER_COUNT; i++) {
    extraGrants.push({ repo: "edu-sources", path: `filler-grant/${String(i).padStart(4, "0")}.md` });
  }
  const context = { ...base, readGrants: [...base.readGrants, ...extraGrants, poisonedGrant] };
  const result = run(taskFor("single-nominal", 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.equal(poisonTouched, false, "the poisoned read grant past the object cap must never be read, not just never used");
});
