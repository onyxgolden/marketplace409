/**
 * integration.test.js — the runner executes suites in a fixture
 * checkout end to end and classifies pass/fail/error/timeout correctly.
 *
 * The fixture checkout's vitest is a shell stub in node_modules/.bin
 * (see helpers.js): the runner's own process plumbing — spawn of
 * `npx vitest run ...`, timeout kill, output-file capture outside the
 * target tree, JSON parsing, classification — is exercised for real.
 * Only vitest itself is stubbed; the real-vitest proof is the live
 * smoke against a marketplace409 checkout (see README).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runJob, canonicalJson } from "../src/index.js";
import { makeStubCheckout, loadFixtureJson } from "./helpers.js";

const CLI = fileURLToPath(new URL("../runner/run-job.mjs", import.meta.url));

function runCli(jobPath, extraArgs = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, jobPath, ...extraArgs], { encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

function writeJob(t, job) {
  const dir = mkdtempSync(join(tmpdir(), "qa-runner-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "job.json");
  writeFileSync(path, JSON.stringify(job));
  return { dir, path };
}

describe("runner integration (stub vitest, real process plumbing)", () => {
  it("runs a passing suite end to end: ALL_SUITES_PASS, marker proves execution, no report file leaks into the target", async (t) => {
    const { dir, head, markerPath } = makeStubCheckout(t, { json: loadFixtureJson("vitest-pass.json"), exitCode: 0 });
    const report = await runJob({
      job_id: "job-int-pass",
      target: dir,
      head_pin: head,
      suites: [{ id: "unit", patterns: ["src/alpha.test.js"] }],
    });
    assert.equal(report.status, "COMPLETED");
    assert.equal(report.verdict, "ALL_SUITES_PASS");
    assert.equal(report.checkout_head, head);
    assert.equal(report.suites[0].status, "PASS");
    assert.equal(report.suites[0].exit_code, 0);
    assert.deepEqual(report.suites[0].test_counts, { total: 2, passed: 2, failed: 0, pending: 0 });
    assert.equal(report.totals.tests_passed, 2);
    assert.equal(existsSync(markerPath), true, "the suite process really ran");
    assert.equal(existsSync(join(dir, "suite-0-unit.json")), false, "vitest report file must live outside the target tree");
  });

  it("runs a failing suite end to end: FAIL with failing test name + file, verdict SUITES_FAILED", async (t) => {
    const { dir, head } = makeStubCheckout(t, { json: loadFixtureJson("vitest-fail.json"), exitCode: 1 });
    const report = await runJob({
      job_id: "job-int-fail",
      target: dir,
      head_pin: head,
      suites: [{ id: "unit", patterns: ["src/beta.test.js"] }],
    });
    assert.equal(report.status, "COMPLETED");
    assert.equal(report.verdict, "SUITES_FAILED");
    assert.equal(report.suites[0].status, "FAIL");
    assert.equal(report.suites[0].exit_code, 1);
    assert.deepEqual(report.suites[0].failing_tests, [
      { name: "beta divides numbers", file: "/fixture-checkout/src/beta.test.js" },
    ]);
    assert.equal(report.totals.tests_failed, 1);
  });

  it("a checkout without vitest classifies the suite ERROR/VITEST_NOT_RESOLVABLE — never PASS, never skipped", async (t) => {
    const { dir, head, markerPath } = makeStubCheckout(t, { withVitest: false });
    const report = await runJob({
      target: dir,
      head_pin: head,
      suites: [{ id: "unit", patterns: ["src/alpha.test.js"] }],
    });
    assert.equal(report.status, "COMPLETED");
    assert.equal(report.verdict, "SUITES_FAILED");
    assert.equal(report.suites[0].status, "ERROR");
    assert.equal(report.suites[0].reason_code, "VITEST_NOT_RESOLVABLE");
    assert.equal(existsSync(markerPath), false);
  });

  it("a suite that outlives its timeout is killed and classified TIMEOUT", async (t) => {
    const { dir, head } = makeStubCheckout(t, { sleepSeconds: 30 });
    const started = Date.now();
    const report = await runJob({
      target: dir,
      head_pin: head,
      suites: [{ id: "slow", patterns: ["src/slow.test.js"], timeout_ms: 400 }],
    });
    const elapsed = Date.now() - started;
    assert.equal(report.suites[0].status, "TIMEOUT");
    assert.equal(report.suites[0].reason_code, "SUITE_TIMEOUT");
    assert.ok(elapsed < 20_000, `timeout kill must be prompt (took ${elapsed}ms)`);
  });

  it("when the per-job timeout budget is exhausted, remaining suites are SKIPPED_BUDGET and never run", async (t) => {
    const { dir, head, markerPath } = makeStubCheckout(t, { sleepSeconds: 30 });
    const report = await runJob({
      target: dir,
      head_pin: head,
      budgets: { per_job_timeout_ms: 1000, per_suite_timeout_ms: 60_000 },
      suites: [
        { id: "first", patterns: ["src/a.test.js"] },
        { id: "second", patterns: ["src/b.test.js"] },
      ],
    });
    assert.equal(report.suites[0].status, "TIMEOUT");
    assert.equal(report.suites[1].status, "SKIPPED_BUDGET");
    assert.equal(report.suites[1].reason_code, "JOB_TIMEOUT_EXHAUSTED");
    assert.equal(report.totals.suites_skipped_budget, 1);
    assert.equal(existsSync(markerPath), true, "only the first suite ran");
  });

  it("the same job on the same head produces byte-identical canonical JSON", async (t) => {
    const { dir, head } = makeStubCheckout(t, { json: loadFixtureJson("vitest-pass.json"), exitCode: 0 });
    const job = {
      job_id: "job-det",
      target: dir,
      head_pin: head,
      suites: [{ id: "unit", patterns: ["src/alpha.test.js"] }],
    };
    const a = await runJob(job);
    const b = await runJob(job);
    assert.equal(canonicalJson(a), canonicalJson(b));
  });

  it("CLI: exit 0 only on ALL_SUITES_PASS; --out writes the same canonical JSON as stdout", async (t) => {
    const passFx = makeStubCheckout(t, { json: loadFixtureJson("vitest-pass.json"), exitCode: 0 });
    const passJob = writeJob(t, {
      job_id: "job-cli-pass",
      target: passFx.dir,
      head_pin: passFx.head,
      suites: [{ id: "unit", patterns: ["src/alpha.test.js"] }],
    });
    const outPath = join(passJob.dir, "report.json");
    const ok = await runCli(passJob.path, ["--out", outPath]);
    assert.equal(ok.code, 0, ok.stderr);
    const printed = JSON.parse(ok.stdout);
    assert.equal(printed.verdict, "ALL_SUITES_PASS");
    assert.equal(readFileSync(outPath, "utf8").trim(), ok.stdout.trim());

    const failFx = makeStubCheckout(t, { json: loadFixtureJson("vitest-fail.json"), exitCode: 1 });
    const failJob = writeJob(t, {
      job_id: "job-cli-fail",
      target: failFx.dir,
      head_pin: failFx.head,
      suites: [{ id: "unit", patterns: ["src/beta.test.js"] }],
    });
    const bad = await runCli(failJob.path);
    assert.equal(bad.code, 1);
    assert.equal(JSON.parse(bad.stdout).verdict, "SUITES_FAILED");
  });
});
