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
    provenance_registry: {},
  };
}
function taskFor(bundle) {
  const ref = store.bundleRefs[bundle];
  const n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  return {
    schema_version: "1", task_id: "det-test", operation: "analyze",
    fixture_refs: { evidence_bundle: ref },
    options: {
      population: { declared_total: n, complete: true },
      requested_claims: [],
    },
  };
}

test("three consecutive runs are byte-identical", () => {
  for (const bundle of ["single-passage", "cross-doc-support", "contradiction", "injection"]) {
    const outs = [run(taskFor(bundle), ctxFor(bundle)), run(taskFor(bundle), ctxFor(bundle)), run(taskFor(bundle), ctxFor(bundle))]
      .map((r) => canonicalJson(r));
    assert.equal(outs[0], outs[1], `${bundle} run1 != run2`);
    assert.equal(outs[1], outs[2], `${bundle} run2 != run3`);
  }
});

test("mutating a returned result cannot affect later runs (detached snapshots)", () => {
  const t = taskFor("single-passage");
  const c = ctxFor("single-passage");
  const r1 = run(t, c);
  const before = canonicalJson(r1);
  // Aggressive caller mutation of the returned envelope and the inputs.
  r1.report.claims.push({ claim_id: "evil" });
  r1.diagnostics.push({ code: "EVIL" });
  t.options.population.declared_total = 999;
  const r2 = run(taskFor("single-passage"), ctxFor("single-passage"));
  assert.equal(canonicalJson(r2), before);
});

test("fixture store bytes unchanged after runs", () => {
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  const before = store.sources[key].revisions[ref.commit].text;
  run(taskFor("single-passage"), ctxFor("single-passage"));
  assert.equal(store.sources[key].revisions[ref.commit].text, before);
});
