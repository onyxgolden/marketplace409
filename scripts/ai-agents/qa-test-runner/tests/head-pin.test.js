/**
 * head-pin.test.js — pin verification happens before execution, and a
 * refusal executes NOTHING. Proven with a sentinel: the fixture
 * checkout's stub vitest drops a marker file on every invocation; after
 * any refusal the marker must not exist.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJob } from "../src/index.js";
import { makeStubCheckout, loadFixtureJson } from "./helpers.js";

const WRONG_PIN = "0".repeat(40);

describe("HEAD pin verification", () => {
  it("SENTINEL: HEAD_MISMATCH refuses and executes nothing", async (t) => {
    const { dir, head, markerPath } = makeStubCheckout(t, { json: loadFixtureJson("vitest-pass.json"), exitCode: 0 });
    assert.notEqual(head, WRONG_PIN);
    const report = await runJob({
      job_id: "job-pin",
      target: dir,
      head_pin: WRONG_PIN,
      suites: [{ id: "unit", patterns: ["src/alpha.test.js"] }],
    });
    assert.equal(report.status, "REFUSED");
    assert.equal(report.verdict, "REFUSED");
    assert.equal(report.reason_code, "HEAD_MISMATCH");
    assert.equal(report.checkout_head, head);
    assert.equal(report.head_pin, WRONG_PIN);
    assert.ok(report.diagnostics.some((d) => d.code === "HEAD_MISMATCH"));
    assert.equal(report.suites.length, 1);
    assert.equal(report.suites[0].status, "SKIPPED_BUDGET");
    assert.equal(existsSync(markerPath), false, "a mismatched pin must execute nothing — marker sentinel tripped");
  });

  it("a malformed pin is an INVALID_JOB refusal and executes nothing", async (t) => {
    const { dir, markerPath } = makeStubCheckout(t, { json: loadFixtureJson("vitest-pass.json"), exitCode: 0 });
    const report = await runJob({
      target: dir,
      head_pin: "not-a-pin",
      suites: [{ id: "unit", patterns: ["src/alpha.test.js"] }],
    });
    assert.equal(report.status, "REFUSED");
    assert.equal(report.reason_code, "INVALID_JOB");
    assert.equal(existsSync(markerPath), false);
  });

  it("a missing target is REFUSED/TARGET_NOT_FOUND", async () => {
    const report = await runJob({
      target: join(tmpdir(), "qa-runner-definitely-missing-checkout"),
      head_pin: WRONG_PIN,
      suites: [{ id: "unit", patterns: ["src/alpha.test.js"] }],
    });
    assert.equal(report.status, "REFUSED");
    assert.equal(report.reason_code, "TARGET_NOT_FOUND");
    assert.equal(report.checkout_head, null);
  });

  it("a non-git target directory is REFUSED/HEAD_UNRESOLVABLE", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "qa-runner-nogit-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const report = await runJob({
      target: dir,
      head_pin: WRONG_PIN,
      suites: [{ id: "unit", patterns: ["src/alpha.test.js"] }],
    });
    assert.equal(report.status, "REFUSED");
    assert.equal(report.reason_code, "HEAD_UNRESOLVABLE");
  });
});
