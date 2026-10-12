/**
 * determinism.test.js — repeat runs are byte-identical under a fixed
 * context; returned objects are detached snapshots (caller mutation cannot
 * alter fixtures, history, registry, earlier results or future runs);
 * metamorphic ordering/dedup checks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, FixtureResolver, canonicalJson } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLOCK = "2026-10-12T00:00:00Z";

function loadCase(id) {
  const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
  return battery.find((c) => c.id === id);
}

function runCase(c) {
  return run(c.task, {
    clock: CLOCK,
    resolver: new FixtureResolver(c.fixtures),
    recordToolCall: () => {},
  });
}

describe("determinism", () => {
  it("repeat runs are byte-identical under the fixed context", () => {
    for (const id of ["QA-V-001", "QA-D-001", "QA-X-001", "QA-I-001", "QA-F-005"]) {
      const c = loadCase(id);
      const a = canonicalJson(runCase(c));
      const b = canonicalJson(runCase(c));
      assert.equal(a, b, id);
    }
  });

  it("report_ids are deterministic across runs", () => {
    const c = loadCase("QA-V-002");
    assert.equal(runCase(c).report_id, runCase(c).report_id);
    assert.match(runCase(c).report_id, /^qair-[0-9a-f]{16}$/);
  });

  it("returned objects are detached: caller mutation cannot alter future runs", () => {
    const c = loadCase("QA-V-003");
    const r1 = runCase(c);
    r1.results[0].result = "FAIL";
    r1.results[0].assertion_results[0].evidence_ids.push("ev-forged");
    r1.ledger_preview.push({ synthetic: false });
    const r2 = runCase(c);
    assert.equal(r2.results[0].result, "PASS");
    assert.deepEqual(r2.results[0].assertion_results[0].evidence_ids, ["ev-QA-V-003-automated"]);
    assert.equal(r2.ledger_preview.length, 1);
  });

  it("mutating the task between runs does not corrupt the second run", () => {
    const c = loadCase("QA-V-004");
    const t1 = JSON.parse(JSON.stringify(c.task));
    const r1 = run(t1, { clock: CLOCK, resolver: new FixtureResolver(c.fixtures), recordToolCall: () => {} });
    t1.controls[0].kind = "payment"; // mutate the caller's copy after the run
    const r2 = run(c.task, { clock: CLOCK, resolver: new FixtureResolver(c.fixtures), recordToolCall: () => {} });
    assert.equal(r1.results[0].result, "PASS");
    assert.equal(r2.results[0].result, "PASS");
  });

  it("control ordering does not change per-control outcomes (metamorphic)", () => {
    const c = loadCase("QA-X-039"); // mixed exercise + report task
    const fwd = runCase(c);
    const rev = JSON.parse(JSON.stringify(c));
    rev.task.controls = [...rev.task.controls].reverse();
    const bwd = run(rev.task, { clock: CLOCK, resolver: new FixtureResolver(rev.fixtures), recordToolCall: () => {} });
    const byId = (r) => Object.fromEntries(r.results.map((x) => [x.control_id, x.result]));
    assert.deepEqual(byId(fwd), byId(bwd));
  });
});
