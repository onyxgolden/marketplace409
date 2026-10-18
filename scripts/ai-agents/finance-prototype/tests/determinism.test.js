/** determinism.test.js — byte-identical output across runs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, canonicalJson, sha256HexUtf8 } from "../src/index.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function ctxFor(bundleName) {
  const ref = store.bundleRefs[bundleName];
  const key = `${ref.repo}|${ref.path}`;
  const chartKey = "fin-sources|chart/finance-chart-v1.md";
  return {
    clock: Date.parse("2026-06-01T12:00:00Z"),
    sources: { [chartKey]: store.sources[chartKey], [key]: store.sources[key] },
    readGrants: [
      { repo: "fin-sources", path: "chart/finance-chart-v1.md" },
      { repo: ref.repo, path: ref.path },
    ],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
  };
}

function taskFor(bundleName) {
  const ref = store.bundleRefs[bundleName];
  const key = `${ref.repo}|${ref.path}`;
  const n = JSON.parse(store.sources[key].revisions[ref.commit].text).length;
  return {
    schema_version: "1",
    task_id: "determinism-test",
    operation: "analyze",
    fixture_refs: { transaction_bundle: ref },
    options: {
      population: { declared_total: n, complete: true },
      period: { start_date: "2026-01-01", end_date: "2026-01-31", opening_balance_minor: "1000", currency: "USD" },
      header_claims: {},
    },
  };
}

test("determinism: three runs byte-identical", () => {
  const hashes = [];
  for (let i = 0; i < 3; i++) {
    const r = run(taskFor("mixed-period"), ctxFor("mixed-period"));
    hashes.push(sha256HexUtf8(canonicalJson(r)));
  }
  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[1], hashes[2]);
});

test("determinism: detached snapshots (caller mutation is safe)", () => {
  const r1 = run(taskFor("single-income"), ctxFor("single-income"));
  r1.report.income_expense.net_income_minor = "MUTATED";
  const r2 = run(taskFor("single-income"), ctxFor("single-income"));
  assert.notEqual(r2.report.income_expense.net_income_minor, "MUTATED");
  assert.equal(r2.report.income_expense.net_income_minor, "10000");
});

test("determinism: fixture bytes unchanged by run", () => {
  const ref = store.bundleRefs["mixed-period"];
  const key = `${ref.repo}|${ref.path}`;
  const before = store.sources[key].revisions[ref.commit].text;
  run(taskFor("mixed-period"), ctxFor("mixed-period"));
  const after = store.sources[key].revisions[ref.commit].text;
  assert.equal(before, after);
});
