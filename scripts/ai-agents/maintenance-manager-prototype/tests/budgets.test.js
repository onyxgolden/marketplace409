import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
