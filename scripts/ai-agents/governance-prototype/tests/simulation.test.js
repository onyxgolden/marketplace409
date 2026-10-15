/**
 * simulation.test.js — the 12 two-stage consumption mutations.
 *
 * Each mutation takes a task whose initial advisory evaluation is
 * ALLOWED, applies a fixture change (head/policy/evidence/principal/relay
 * change), and requires the revalidation simulator to report
 * gate_sufficient:false with required_reevaluation:true — never
 * "authorized" because the old JSON said ALLOWED.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { reevaluate } from "../src/simulator.js";
import { buildContext } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function baseContext() {
  return buildContext(ROOT, { contextOverrides: null });
}

test("12/12 stale evaluations are invalidated by the revalidation simulator", () => {
  const mutations = JSON.parse(readFileSync(join(ROOT, "corpus", "mutations.json"), "utf8"));
  assert.equal(mutations.length, 12, "must hold 12 two-stage mutations");
  for (const m of mutations) {
    const before = buildContext(ROOT, { contextOverrides: null });
    const initial = run(m.task, before);
    assert.equal(initial.classification, "ALLOWED", `${m.mutation_id}: initial advisory must be ALLOWED`);
    assert.equal(initial.validity, "GROUNDED");
    const after = buildContext(ROOT, { mutate: m.mutate });
    const sim = reevaluate(m.task, initial, before, after);
    assert.equal(sim.gate_sufficient, false, `${m.mutation_id}: stale evaluation must not gate-suffice`);
    assert.equal(sim.required_reevaluation, true, `${m.mutation_id}: reevaluation required`);
    assert.equal(sim.execution_performed, false, `${m.mutation_id}: simulator never executes`);
    const got = [...sim.changes.map((c) => c.change_id)].sort();
    assert.deepEqual(got, m.expected.change_ids, `${m.mutation_id}: change ids`);
  }
});

test("simulator: unchanged fixtures keep the gate sufficient", () => {
  const mutations = JSON.parse(readFileSync(join(ROOT, "corpus", "mutations.json"), "utf8"));
  const m = mutations[0];
  const before = baseContext();
  const initial = run(m.task, before);
  assert.equal(initial.classification, "ALLOWED");
  const sim = reevaluate(m.task, initial, baseContext(), baseContext());
  assert.equal(sim.gate_sufficient, true, "identical fixture state keeps the advisory gate-sufficient");
  assert.equal(sim.required_reevaluation, false);
  assert.deepEqual(sim.changes, []);
  assert.equal(sim.execution_performed, false);
});

test("simulator: a non-ALLOWED initial result can never gate-suffice", () => {
  const before = baseContext();
  const task = {
    request_id: "gov-sim-neg",
    requested_action: "classify",
    actor_ref: "principal:claude",
    action_type: "merge",
    target: {
      repo: "onyxgolden/marketplace409",
      resource_id: "pr:701",
      resource_class: "pr",
      scope_ids: ["scope:release-cadence"],
      head: before.heads.find((h) => h.resource_id === "pr:701").head,
      source_ref: before.heads.find((h) => h.resource_id === "pr:701").source_ref,
    },
    payload_context: { evidence_record_ids: [] },
  };
  const initial = run(task, before);
  assert.equal(initial.classification, "NEEDS-APPROVAL");
  const sim = reevaluate(task, initial, before, baseContext());
  assert.equal(sim.gate_sufficient, false, "NEEDS-APPROVAL is never consumption-sufficient");
  assert.equal(sim.required_reevaluation, true);
});
