/**
 * schemas.test.js — malformed tasks, pins, and control objects are denied
 * with structured INVALID_INPUT-family codes: never an exception, never a
 * default success.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, FixtureResolver } from "../src/index.js";

const CLOCK = "2026-10-12T00:00:00Z";
const COMMIT = "a".repeat(40);

function ctx() {
  return {
    clock: CLOCK,
    resolver: new FixtureResolver({ builds: {}, evidence: [], artifacts: {}, runs: {}, grants: {} }),
  };
}

function goodTask() {
  return {
    task_id: "t-schema-1",
    surface: { id: "s1", route: "/rentals", environment: "synthetic" },
    build_pin: { repo: "r", commit: COMMIT, build_id: "b1", environment: "synthetic-ci" },
    controls: [
      {
        control_id: "c1",
        kind: "navigation",
        requested_operation: "report",
        assertion_ids: ["a1"],
        required_modalities: ["automated"],
      },
    ],
    evidence_sources: [],
  };
}

function codesOf(result) {
  return (result.diagnostics ?? []).map((d) => d.code);
}

describe("task schema denials", () => {
  it("rejects unknown properties in control-bearing objects", () => {
    const t = goodTask();
    t.controls[0].exec_now = true;
    const r = run(t, ctx());
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("UNKNOWN_PROPERTY"));
  });

  it("rejects unknown top-level task properties", () => {
    const t = goodTask();
    t.debug = true;
    const r = run(t, ctx());
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("UNKNOWN_PROPERTY"));
  });

  it("rejects duplicate control_ids", () => {
    const t = goodTask();
    t.controls.push({ ...t.controls[0] });
    const r = run(t, ctx());
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("DUPLICATE_ID"));
  });

  it("rejects invalid kind enum values", () => {
    const t = goodTask();
    t.controls[0].kind = "teleport";
    const r = run(t, ctx());
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("INVALID_KIND"));
  });

  it("rejects abbreviated/malformed commit pins", () => {
    for (const bad of ["abc123", "A".repeat(40), "g".repeat(40), "", 12345]) {
      const t = goodTask();
      t.build_pin.commit = bad;
      const r = run(t, ctx());
      assert.equal(r.status, "REFUSED", `pin ${JSON.stringify(bad)}`);
      assert.ok(codesOf(r).includes("MALFORMED_PIN"), `pin ${JSON.stringify(bad)}`);
    }
  });

  it("rejects non-synthetic environments", () => {
    const t = goodTask();
    t.surface.environment = "production";
    const r = run(t, ctx());
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("UNSUPPORTED_ENVIRONMENT"));
  });

  it("rejects invalid timestamps and clocks", () => {
    const t = goodTask();
    const badCtx = { clock: "not-a-date", resolver: ctx().resolver };
    const r = run(t, badCtx);
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("INVALID_INPUT"));
  });

  it("rejects non-object tasks without throwing", () => {
    for (const bad of [null, 42, "task", []]) {
      const r = run(bad, ctx());
      assert.equal(r.status, "REFUSED");
    }
  });

  it("unregistered build pin fails closed (no evidence can bind)", () => {
    const t = goodTask(); // b1 not in the empty registry
    const r = run(t, ctx());
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("UNREGISTERED_BUILD_PIN"));
  });

  it("oversize task input is denied with INPUT_LIMIT (valid schema, >256KiB)", () => {
    const t = goodTask();
    t.controls = [];
    for (let i = 0; i < 64; i++) {
      t.controls.push({
        control_id: `c${i}`,
        kind: "navigation",
        requested_operation: "report",
        assertion_ids: Array.from({ length: 64 }, (_, j) => `a${i}-${j}-` + "x".repeat(110)),
        required_modalities: ["automated"],
      });
    }
    const bytes = Buffer.byteLength(JSON.stringify(t), "utf8");
    assert.ok(bytes > 256 * 1024, `task is ${bytes} bytes`);
    const r = run(t, ctx());
    assert.equal(r.status, "REFUSED");
    assert.ok(codesOf(r).includes("INPUT_LIMIT"));
  });
});
