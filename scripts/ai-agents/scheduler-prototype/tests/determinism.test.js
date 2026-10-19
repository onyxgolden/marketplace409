/** determinism.test.js — byte-identical output across runs; detached mutation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, canonicalJson } from "../src/index.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function ctxFor(bundle) {
  const ref = store.bundleRefs[bundle];
  const key = `${ref.repo}|${ref.path}`;
  return {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
  };
}
function taskFor(bundle) {
  const ref = store.bundleRefs[bundle];
  const n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  return {
    schema_version: "1", task_id: "det-test", operation: "analyze",
    fixture_refs: { network_bundle: ref },
    options: {
      population: { declared_total: n, complete: true },
      anchors: { c1: "2026-01-05" }, horizon_days: 60,
      deadlines: {}, constraints: [], claimed: {},
    },
  };
}

test("three consecutive runs are byte-identical", () => {
  for (const bundle of ["fs-chain", "diamond", "injection", "cycle"]) {
    const outs = [run(taskFor(bundle), ctxFor(bundle)), run(taskFor(bundle), ctxFor(bundle)), run(taskFor(bundle), ctxFor(bundle))]
      .map((r) => canonicalJson(r));
    assert.equal(outs[0], outs[1], `${bundle} run1 != run2`);
    assert.equal(outs[1], outs[2], `${bundle} run2 != run3`);
  }
});

test("mutating a returned result cannot affect later runs (detached snapshots)", () => {
  const t = taskFor("fs-chain");
  const c = ctxFor("fs-chain");
  const r1 = run(t, c);
  const before = canonicalJson(r1);
  // Aggressive caller mutation of the returned envelope and the inputs.
  r1.report.components[0].activities[0].es = 999;
  r1.report.components.push({ component_id: "evil" });
  t.options.horizon_days = 1;
  const r2 = run(taskFor("fs-chain"), ctxFor("fs-chain"));
  assert.equal(canonicalJson(r2), before);
});

test("fixture store bytes unchanged after runs", () => {
  const ref = store.bundleRefs["fs-chain"];
  const key = `${ref.repo}|${ref.path}`;
  const before = store.sources[key].revisions[ref.commit].text;
  run(taskFor("fs-chain"), ctxFor("fs-chain"));
  assert.equal(store.sources[key].revisions[ref.commit].text, before);
});
