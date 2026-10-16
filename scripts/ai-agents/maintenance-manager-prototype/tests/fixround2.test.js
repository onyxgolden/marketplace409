/**
 * fixround2.test.js — MM-S1-001 through MM-S1-005 regression tests for
 * Maintenance Manager Agent Phase 2 slice 1 fix round 2.
 *
 * Each test proves a specific verdict requirement with explicit
 * boundary/throwing/poisoned-entry evidence, not bare final-count
 * assertions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { maxContainerDepth, maxJsonNestingDepth, MAX_CONTAINER_DEPTH } from "../src/canonical.js";
import { verifySpanBounds, makeBudget, ResolutionError } from "../src/resolver.js";
import { computePmCompliance } from "../src/audit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function baseTaskAndContext(setName) {
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
    sources: JSON.parse(JSON.stringify(bag)),
    readGrants: JSON.parse(JSON.stringify(store.readGrantsBySet[setName])),
    principal: store.principals.jasonActive,
    criteria: store.criteria.standard,
  };
  return { task, context, register };
}

// ─── MM-S1-001: depth guard never touches uncharged candidates ───

test("MM-S1-001: maxContainerDepth never invokes throwing accessors, even on candidates past the 64-object cap", () => {
  // 100-element array mimicking work_orders; elements 64+ are throwing getters.
  const arr = [];
  for (let i = 0; i < 100; i++) {
    if (i < 64) {
      arr.push({ id: i });
    } else {
      const o = {};
      Object.defineProperty(o, "id", {
        enumerable: true,
        get() { throw new Error(`depth guard touched candidate ${i} — must never happen`); },
      });
      arr.push(o);
    }
  }
  const register = { assets: [], work_orders: arr, pm_occurrences: [] };
  // Must not throw: the depth guard must not invoke any getter.
  const depth = maxContainerDepth(register);
  assert.ok(depth <= MAX_CONTAINER_DEPTH, `depth ${depth} should be within cap`);
  assert.equal(depth, 3, "register=1, work_orders array=2, element=3");
});

test("MM-S1-001: maxContainerDepth skips accessor properties without invoking them (task path)", () => {
  let invoked = false;
  const task = {
    schema_version: "1",
    task_id: "poison",
    options: { nested: { deep: { deeper: "leaf" } } },
  };
  Object.defineProperty(task, "evil", {
    enumerable: true,
    get() { invoked = true; throw new Error("depth guard invoked task getter"); },
  });
  const depth = maxContainerDepth(task);
  assert.equal(invoked, false, "the depth guard must never invoke the task getter");
  assert.ok(depth >= 3, "depth should reflect the real nested structure");
});

test("MM-S1-001: run() with a throwing getter on an unknown task property refuses INVALID_INPUT (not an uncaught throw), proving the depth guard skipped it", () => {
  const { task, context } = baseTaskAndContext("nominal-small");
  Object.defineProperty(task, "evil", {
    enumerable: true,
    get() { throw new Error("depth guard invoked task getter — budget bypass"); },
  });
  // The depth guard must skip the accessor; validateTask then rejects the
  // unknown property with a clean INVALID_INPUT (the getter is never invoked
  // by the guard, and validateTask's exactKeys only uses Object.keys).
  const result = run(task, context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "INVALID_INPUT");
});

test("MM-S1-001: maxJsonNestingDepth computes depth from raw text without materializing candidates", () => {
  // Text with brackets inside strings must not confuse the scanner.
  const text = JSON.stringify({ a: "}{[", b: [{ c: "}]" }, { d: [1, 2] }] });
  const fromText = maxJsonNestingDepth(text);
  const fromObj = maxContainerDepth(JSON.parse(text));
  assert.equal(fromText, fromObj, "text scanner and object walk must agree");
  assert.equal(fromText, 4, "outer=1, b array=2, object=3, d array=4");
});

test("MM-S1-001: maxJsonNestingDepth handles escaped quotes and backslashes in strings", () => {
  const text = '{"a": "he said \\"hi\\" \\\\ [", "b": {"c": 1}}';
  assert.equal(maxJsonNestingDepth(text), 2);
});

test("MM-S1-001: maxJsonNestingDepth refuses depth past 32 (early exit)", () => {
  let text = "";
  for (let i = 0; i < 40; i++) text += '{"n":';
  text += "1";
  for (let i = 0; i < 40; i++) text += "}";
  const depth = maxJsonNestingDepth(text);
  assert.ok(depth > MAX_CONTAINER_DEPTH, `depth ${depth} must exceed cap`);
});

// ─── MM-S1-002: UTF-8 boundaries and aggregate citation support ───

test("MM-S1-002: verifySpanBounds rejects a span that splits a multibyte UTF-8 code point", () => {
  const budget = makeBudget();
  // "héllo": h(1) + é(2 bytes: 0xC3 0xA9) + llo(3) = 6 bytes total.
  const bytes = Buffer.from("héllo", "utf8");
  assert.equal(bytes.length, 6);
  // Span [1,2) splits the é (bytes 1-2 are 0xC3 0xA9).
  assert.throws(
    () => verifySpanBounds(bytes, { start_byte: 1, end_byte: 2 }, budget, "test"),
    (e) => e instanceof ResolutionError && e.code === "SPAN_MISMATCH",
    "a span splitting a code point must not verify"
  );
  // Span [1,3) covers the full é — valid boundaries.
  const ok = verifySpanBounds(bytes, { start_byte: 1, end_byte: 3 }, budget, "test");
  assert.equal(ok.quoted_text, "é");
});

test("MM-S1-002: verifySpanBounds rejects a span ending mid-emoji (4-byte character)", () => {
  const budget = makeBudget();
  const bytes = Buffer.from("a😀b", "utf8"); // a(1) + 😀(4) + b(1) = 6 bytes
  assert.equal(bytes.length, 6);
  // Span [1,3) splits the emoji (bytes 1-4).
  assert.throws(
    () => verifySpanBounds(bytes, { start_byte: 1, end_byte: 3 }, budget, "test"),
    (e) => e instanceof ResolutionError && e.code === "SPAN_MISMATCH"
  );
  // Full emoji span verifies.
  const ok = verifySpanBounds(bytes, { start_byte: 1, end_byte: 5 }, budget, "test");
  assert.equal(ok.quoted_text, "😀");
});

test("MM-S1-002: aggregate sections carry VERIFIED citation support when records contribute", () => {
  const { task, context } = baseTaskAndContext("nominal-small");
  const result = run(task, context);
  assert.equal(result.status, "REPORT_READY");
  const backlogSupport = result.report.backlog.citation_support;
  assert.equal(backlogSupport.state, "VERIFIED");
  assert.ok(backlogSupport.record_count > 0);
  assert.equal(backlogSupport.citations.length, backlogSupport.record_count);
  for (const c of backlogSupport.citations) {
    assert.equal(c.verification, "VERIFIED");
  }
});

test("MM-S1-002: empty aggregates carry explicit UNAVAILABLE citation support", () => {
  const { task, context } = baseTaskAndContext("empty");
  const result = run(task, context);
  assert.equal(result.status, "EMPTY");
  assert.equal(result.report.backlog.citation_support.state, "UNAVAILABLE");
  assert.ok(result.report.backlog.citation_support.reason);
  assert.equal(result.report.overdue.citation_support.state, "UNAVAILABLE");
  assert.equal(result.report.cancelled_citation_support.state, "UNAVAILABLE");
});

// ─── MM-S1-004: incomplete population → UNVERIFIABLE PM basis ───

test("MM-S1-004: population.complete=false with due occurrences yields UNVERIFIABLE (not VERIFIED)", () => {
  const { task, context } = baseTaskAndContext("pm-on-window");
  task.options.population.complete = false;
  const result = run(task, context);
  assert.equal(result.report.pm_compliance.basis_state, "UNVERIFIABLE");
  assert.equal(result.report.pm_compliance.denominator, null, "no verified denominator without complete population");
  assert.equal(result.report.pm_compliance.numerator, null);
  assert.equal(result.report.pm_compliance.ratio, null);
  assert.equal(result.report.pm_compliance.display_percent, null);
  // Visible-subset counts are retained but explicitly labeled.
  const vs = result.report.pm_compliance.visible_subset;
  assert.ok(vs, "visible-subset counts must be retained");
  assert.ok(vs.note.includes("not whole-population"), "visible subset must be clearly labeled non-whole-population");
  assert.ok(vs.due_count > 0, "there are due occurrences in this fixture");
});

test("MM-S1-004: declared_total mismatch with due occurrences yields UNVERIFIABLE", () => {
  const { task, context, register } = baseTaskAndContext("pm-on-window");
  task.options.population.declared_total = register.assets.length + 5; // mismatch
  task.options.population.complete = true;
  const result = run(task, context);
  assert.equal(result.report.pm_compliance.basis_state, "UNVERIFIABLE");
  assert.equal(result.report.pm_compliance.denominator, null);
  assert.ok(result.report.pm_compliance.visible_subset, "visible subset retained");
});

// ─── MM-S1-005: complete derived from status ───

test("MM-S1-005: PARTIAL status always has complete:false", () => {
  const { task, context } = baseTaskAndContext("nominal-small");
  task.options.population.complete = false; // forces PARTIAL via unverifiable population
  const result = run(task, context);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.complete, false, "PARTIAL must never be complete:true");
});

test("MM-S1-005: REPORT_READY has complete:true", () => {
  const { task, context } = baseTaskAndContext("nominal-small");
  const result = run(task, context);
  assert.equal(result.status, "REPORT_READY");
  assert.equal(result.complete, true);
});

test("MM-S1-005: EMPTY with verified population has complete:true; with unverified, complete:false", () => {
  const { task: t1, context: c1 } = baseTaskAndContext("empty");
  const r1 = run(t1, c1);
  assert.equal(r1.status, "EMPTY");
  assert.equal(r1.complete, true, "verified empty population is complete");

  const { task: t2, context: c2 } = baseTaskAndContext("empty");
  t2.options.population.complete = false;
  const r2 = run(t2, c2);
  assert.equal(r2.status, "EMPTY");
  assert.equal(r2.complete, false, "unverified empty population is not complete");
});
