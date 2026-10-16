import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { run } from "../src/index.js";

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
  return { task, context };
}

test("chargeContext: an unused, oversized registered revision is charged against the payload budget before any content is resolved — never silently traversed for free (CS-001/DOC-002 regression)", () => {
  const { task, context } = baseTaskAndContext("nominal-small");
  context.sources["maint-sources|content/unused-padding.txt"] = { revisions: { [store.paddingRef.commit]: { text: "x".repeat(300000), blob: store.paddingRef.blob } } };
  const result = run(task, context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "INPUT_LIMIT");
});

test("chargeContext: later context.sources entries past the object cap are never read — proven with a throwing getter, not just a final-count check", () => {
  const { task, context } = baseTaskAndContext("nominal-small");
  let touched = false;
  // Pad context.sources past the 64-object cap with benign entries, sorted
  // AFTER the poisoned one lexicographically ("zzz-poison" > any real key
  // used by this fixture), so the poisoned entry is charged (and must
  // refuse) before any of the padding entries would be reached either.
  for (let i = 0; i < 70; i++) {
    context.sources[`maint-sources|content/zzz-pad-${String(i).padStart(3, "0")}.txt`] = {
      revisions: { [`${"b".repeat(39)}${i % 10}`]: { text: `pad ${i}`, blob: "c".repeat(40) } },
    };
  }
  Object.defineProperty(context.sources, "maint-sources|content/zzz-poison.txt", {
    enumerable: true,
    get() {
      touched = true;
      throw new Error("poisoned context.sources entry was read — budget did not cut off before it");
    },
  });
  const result = run(task, context);
  assert.equal(touched, false, "the poisoned registry entry must never be read once the object budget is exhausted");
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
});

test("chargeContext: padding context.readGrants past the object cap trips BUDGET_EXCEEDED, not a silent success", () => {
  const { task, context } = baseTaskAndContext("nominal-small");
  for (let i = 0; i < 70; i++) context.readGrants.push({ repo: "maint-sources", path: `content/unused-grant-${i}.txt` });
  const result = run(task, context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
});

test("a valid task under budget still succeeds (sanity check that the budget tests above aren't just always refusing)", () => {
  const { task, context } = baseTaskAndContext("nominal-small");
  const result = run(task, context);
  assert.equal(result.status, "REPORT_READY");
});

// ---------------------------------------------------------------------
// MM-S1-001: assets[] must be charged against the SAME monotonic budget
// as work orders/PM occurrences, before any asset value is read. Minimal
// self-built register (no fixture store) so the exact asset count is
// fully controlled here. Entries past index 63 are non-string — if the
// budget actually cuts off before reading them, the result is
// BUDGET_EXCEEDED; if a candidate past the cap were ever read (the
// MM-S1-001 bug), it would instead fail validation first and return
// INVALID_INPUT, proving the poisoned entries were touched.
// ---------------------------------------------------------------------
function minimalContextFor(register, overrides = {}) {
  const text = JSON.stringify(register);
  const commit = "a".repeat(40);
  const blobBytes = Buffer.from(text, "utf8");
  const header = Buffer.from(`blob ${blobBytes.length}\0`, "utf8");
  const blob = createHash("sha1").update(header).update(blobBytes).digest("hex");
  const ref = { repo: "maint-sources", path: "registers/unit.json", commit, blob, algorithm: "git-sha1", revision: "v1" };
  const task = {
    schema_version: "1", task_id: "unit-asset-budget", operation: "analyze",
    fixture_refs: { register: ref },
    options: { as_of_date: "2026-06-01", window: { start_date: "2026-01-01", end_date: "2026-12-31" }, population: { declared_total: register.assets.length, complete: true }, claimed_summary: null, ...overrides.options },
  };
  const context = {
    clock: Date.parse("2026-06-01T12:00:00Z"),
    sources: { "maint-sources|registers/unit.json": { revisions: { [commit]: { text, blob } } } },
    readGrants: [{ repo: "maint-sources", path: "registers/unit.json" }],
    principal: store.principals.jasonActive,
    criteria: store.criteria.standard,
  };
  return { task, context };
}

// Fixed object-charge overhead for this minimal single-asset-array
// register (chargeContext's principal+criteria+1 grant+1 source key+1
// revision = 5, plus resolveSourceRef(register) = 1, plus MM-S1-001 task
// admission's 6 task objects) is 12, empirically confirmed below — 52
// clean assets exactly fills the 64-object budget (12+52=64); the 53rd
// asset is candidate 65.
test("assets[] budget: the first poisoned asset past the cap refuses BUDGET_EXCEEDED before being read — a non-string entry would otherwise surface as INVALID_INPUT, proving it was touched", () => {
  const assets = [];
  for (let i = 0; i < 52; i++) assets.push(`AST-${i}`);
  for (let i = 0; i < 3; i++) assets.push(12345 + i); // non-string: would fail validation if ever read
  const { task, context } = minimalContextFor({ assets, work_orders: [], pm_occurrences: [] });
  const result = run(task, context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED", "the first poisoned non-string asset (candidate 65) must never be read");
});

test("assets[] budget: exactly 52 clean assets (filling the budget to exactly 64 with fixed overhead) succeeds (sanity boundary — the test above isn't just always refusing)", () => {
  const assets = [];
  for (let i = 0; i < 52; i++) assets.push(`AST-${i}`);
  const { task, context } = minimalContextFor({ assets, work_orders: [], pm_occurrences: [] });
  const result = run(task, context);
  assert.notEqual(result.diagnostics[0]?.code, "BUDGET_EXCEEDED");
});

// ---------------------------------------------------------------------
// MM-S1-001: pre-inspection depth guard, exact boundary (32 succeeds,
// 33 refuses INPUT_LIMIT before any shape validation runs). Depth is
// checked on the raw task BEFORE validateTask and on the raw parsed
// register BEFORE validateRegisterShape.
// ---------------------------------------------------------------------
function deepValue(n) {
  let v = "leaf";
  for (let i = 0; i < n; i++) v = { nested: v };
  return v;
}

test("depth guard: a register nested past 32 levels refuses INPUT_LIMIT before any shape validation", () => {
  // The element sits at depth 3 (register=1, work_orders array=2,
  // element=3); deepValue(n) adds (n-1) further levels below that
  // outermost wrapper. n=31 -> max depth 3+30 = 33, one past the cap.
  const { task, context } = minimalContextFor({ assets: [], work_orders: [deepValue(31)], pm_occurrences: [] });
  const result = run(task, context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "INPUT_LIMIT");
});

test("depth guard: exactly 32 levels of register nesting succeeds (boundary sanity — not just always refusing)", () => {
  // pm_occurrences[0] sits at depth 3; n=30 -> max depth 3+29 = 32, exactly at the limit.
  const { task, context } = minimalContextFor({ assets: [], work_orders: [], pm_occurrences: [deepValue(30)] });
  // pm_occurrences[0] is not a valid PM occurrence shape, but that's a
  // SchemaError (INVALID_INPUT), not the depth guard — proving the guard
  // itself let a depth-32 structure through to validation instead of
  // refusing it outright.
  const result = run(task, context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "INVALID_INPUT", "depth 32 must pass the depth guard and fail on ordinary schema validation instead");
});

test("depth guard: a deeply nested TASK (not the register) also refuses INPUT_LIMIT, checked before validateTask runs", () => {
  const { task, context } = minimalContextFor({ assets: [], work_orders: [], pm_occurrences: [] });
  // Graft deep nesting onto a field that would otherwise fail a totally
  // different validation rule — proving the depth guard runs first.
  task.options.population = deepValue(33);
  const result = run(task, context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "INPUT_LIMIT");
});
