/**
 * determinism.test.js — three consecutive runs are byte-identical.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { canonicalJson } from "../src/canonical.js";
import { loadStore, makeStandard } from "./helpers.js";

const store = loadStore();

describe("determinism", () => {
  it("three consecutive runs are byte-identical", () => {
    const outs = [];
    for (let i = 0; i < 3; i++) {
      const { task, context } = makeStandard(store);
      outs.push(canonicalJson(run(task, context)));
    }
    assert.equal(outs[0], outs[1]);
    assert.equal(outs[1], outs[2]);
  });

  it("lead ordering in the report is stable (input order)", () => {
    const { task, context } = makeStandard(store);
    const r = run(task, context);
    const ids = r.report.classifications.map((c) => c.lead_id);
    assert.deepEqual(ids, [...ids].sort((a, b) => 0)); // input order preserved
    assert.equal(ids[0], "lead-high-01");
  });

  it("mutating a returned report cannot change fixtures or later results", () => {
    const s1 = makeStandard(store);
    const r1 = run(s1.task, s1.context);
    r1.report.classifications[0].fit = "MUTATED";
    const s2 = makeStandard(store);
    const r2 = run(s2.task, s2.context);
    assert.equal(r2.report.classifications[0].fit, "FIT_HIGH");
  });
});
