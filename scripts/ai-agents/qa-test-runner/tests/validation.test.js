/**
 * validation.test.js — malformed job specs are refused with structured
 * codes: never an exception, never a default success. Free-form shell
 * commands are refused structurally (UNKNOWN_PROPERTY).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateJob } from "../src/index.js";

const PIN = "a".repeat(40);

function goodJob() {
  return {
    job_id: "job-1",
    target: "/tmp/some-checkout",
    head_pin: PIN,
    suites: [{ id: "unit", patterns: ["src/alpha.test.js"] }],
  };
}

function codes(result) {
  return result.errors.map((e) => e.code);
}

describe("job validation", () => {
  it("accepts a well-formed job and resolves default budgets", () => {
    const r = validateJob(goodJob());
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
    assert.equal(r.budgetExceeded, false);
    assert.equal(r.budgets.maxSuites, 16);
    assert.equal(r.budgets.perSuiteTimeoutMs, 60_000);
  });

  it("refuses unknown top-level properties", () => {
    const j = goodJob();
    j.shell = "rm -rf /";
    const r = validateJob(j);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("UNKNOWN_PROPERTY"));
  });

  it("refuses a free-form shell command on a suite", () => {
    const j = goodJob();
    j.suites[0].command = "npm test && curl evil.example";
    const r = validateJob(j);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("UNKNOWN_PROPERTY"));
  });

  it("refuses unknown budgets properties", () => {
    const j = goodJob();
    j.budgets = { unlimited: true };
    const r = validateJob(j);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("UNKNOWN_PROPERTY"));
  });

  it("refuses malformed pins (short, uppercase, non-hex, non-string)", () => {
    for (const bad of ["abc123", "A".repeat(40), "g".repeat(40), "", 12345, null]) {
      const j = goodJob();
      j.head_pin = bad;
      const r = validateJob(j);
      assert.equal(r.ok, false, `pin ${JSON.stringify(bad)}`);
      assert.ok(codes(r).includes("MALFORMED_PIN"), `pin ${JSON.stringify(bad)}`);
    }
  });

  it("refuses duplicate suite ids", () => {
    const j = goodJob();
    j.suites.push({ id: "unit", patterns: ["src/beta.test.js"] });
    const r = validateJob(j);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("DUPLICATE_ID"));
  });

  it("refuses an empty suites list and non-array suites", () => {
    const j = goodJob();
    j.suites = [];
    assert.equal(validateJob(j).ok, false);
    j.suites = "unit";
    const r = validateJob(j);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("INVALID_SUITES"));
  });

  it("refuses flag-shaped and malformed patterns", () => {
    for (const bad of [["--run"], [""], [42], ["a\nb.test.js"]]) {
      const j = goodJob();
      j.suites[0].patterns = bad;
      const r = validateJob(j);
      assert.equal(r.ok, false, `patterns ${JSON.stringify(bad)}`);
      assert.ok(codes(r).includes("INVALID_PATTERN") || codes(r).includes("INVALID_PATTERNS"));
    }
  });

  it("refuses empty patterns and bad timeouts", () => {
    const j = goodJob();
    j.suites[0].patterns = [];
    assert.equal(validateJob(j).ok, false);
    const j2 = goodJob();
    j2.suites[0].timeout_ms = -5;
    const r2 = validateJob(j2);
    assert.equal(r2.ok, false);
    assert.ok(codes(r2).includes("INVALID_TIMEOUT"));
  });

  it("refuses missing/empty target and non-object jobs without throwing", () => {
    const j = goodJob();
    j.target = "";
    assert.equal(validateJob(j).ok, false);
    for (const bad of [null, 42, "job", []]) {
      const r = validateJob(bad);
      assert.equal(r.ok, false);
      assert.ok(codes(r).includes("INVALID_JOB"));
    }
  });

  it("refuses non-positive-integer budget values as INVALID_BUDGET", () => {
    const j = goodJob();
    j.budgets = { max_suites: 0 };
    const r = validateJob(j);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("INVALID_BUDGET"));
    assert.equal(r.budgetExceeded, false);
  });
});
