/**
 * fix-round4.test.js — post-#665 verdict fix-forward regressions:
 *   Q665-002A.1 (P1) output hard links still overwrite the evidenced checkout
 *   Q665-003A.1 (P2) filename-only and empty reports still receive PASS
 *   Q665-005A.1 (P2) report truncation fabricates zero totals and drops the
 *                      pin while preserving ALL_SUITES_PASS
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  linkSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  classifySuiteResult,
  completedReport,
  refusalReport,
  enforceReportBytes,
  minimalEnvelope,
  reportBytes,
  validateReducedEnvelope,
  canonicalJson,
  MIN_REPORT_BYTES,
} from "../src/index.js";
import { loadFixtureJson } from "./helpers.js";

const CLI = fileURLToPath(new URL("../runner/run-job.mjs", import.meta.url));

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

function writeJobFile(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "qa-r4-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, "job.json");
  writeFileSync(p, text);
  return p;
}

/** Minimal clean git checkout (no node_modules at all). */
function makeBareCheckout(t) {
  const dir = mkdtempSync(join(tmpdir(), "qa-r4-bare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "package.json"), '{"name":"bare"}\n');
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  assert.equal(git(dir, ["status", "--porcelain"]), "", "fixture checkout is clean");
  return { dir, head: git(dir, ["rev-parse", "HEAD"]).trim() };
}

const cls = (json) =>
  classifySuiteResult({
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputExceeded: false,
    reporterExceeded: false,
    spawnError: null,
    json,
  });

/* ------------------------------------------------------------------ */
/* Q665-002A.1 — hard links must never let an output write mutate the  */
/* evidenced checkout. The install is atomic temp-file + rename: the   */
/* destination directory entry is replaced, never truncated in place.  */
/* ------------------------------------------------------------------ */

describe("Q665-002A.1: --out/--markdown-out never truncate a linked destination inode", () => {
  it("reviewer probe: --out as a hard link to the checkout's tracked package.json leaves the checkout untouched", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r4-ext-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const original = join(fx.dir, "package.json");
    const before = readFileSync(original, "utf8");
    const alias = join(ext, "report.json");
    linkSync(original, alias); // hard link: same inode, outside the checkout
    const jobPath = writeJobFile(
      t,
      JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "one", patterns: ["x"] }] })
    );
    const r = await runCli([jobPath, "--out", alias]);
    // The report is still produced at the requested path ...
    const written = JSON.parse(readFileSync(alias, "utf8"));
    assert.equal(written.agent, "qa-test-runner");
    // ... but the shared inode was never truncated through the link.
    assert.equal(readFileSync(original, "utf8"), before, "package.json bytes unchanged");
    assert.equal(git(fx.dir, ["status", "--porcelain"]), "", "git status still clean");
    assert.doesNotMatch(r.stderr, /cannot write --out/, "no write failure reported");
  });

  it("--markdown-out through a hard link to the checkout also leaves the checkout untouched", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r4-extmd-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const original = join(fx.dir, "package.json");
    const before = readFileSync(original, "utf8");
    const alias = join(ext, "report.md");
    linkSync(original, alias);
    const jobPath = writeJobFile(
      t,
      JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "one", patterns: ["x"] }] })
    );
    const r = await runCli([jobPath, "--markdown-out", alias]);
    const written = readFileSync(alias, "utf8");
    assert.match(written, /test-runner report/i, "markdown report produced at the requested path");
    assert.equal(readFileSync(original, "utf8"), before, "package.json bytes unchanged");
    assert.equal(git(fx.dir, ["status", "--porcelain"]), "", "git status still clean");
    assert.doesNotMatch(r.stderr, /cannot write --markdown-out/, "no write failure reported");
  });

  it("a valid existing external report file is still replaced (no over-refusal)", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r4-repl-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const dest = join(ext, "report.json");
    writeFileSync(dest, '{"stale":true}\n');
    const jobPath = writeJobFile(
      t,
      JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "one", patterns: ["x"] }] })
    );
    const r = await runCli([jobPath, "--out", dest]);
    const written = JSON.parse(readFileSync(dest, "utf8"));
    assert.equal(written.agent, "qa-test-runner", "existing external report replaced with fresh content");
    assert.doesNotMatch(r.stderr, /cannot write --out/, "no write failure reported");
  });

  it("regression: a leaf symlink to an outside file still installs through its canonical target", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r4-sym-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const real = join(ext, "real-report.json");
    writeFileSync(real, '{"stale":true}\n');
    const alias = join(ext, "alias.json");
    symlinkSync(real, alias);
    const jobPath = writeJobFile(
      t,
      JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "one", patterns: ["x"] }] })
    );
    const r = await runCli([jobPath, "--out", alias]);
    const written = JSON.parse(readFileSync(real, "utf8"));
    assert.equal(written.agent, "qa-test-runner", "content installed through the symlink's canonical target");
    assert.doesNotMatch(r.stderr, /cannot write --out/, "no write failure reported");
  });

  it("regression: a dangling leaf symlink creates the resolved file", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r4-dang-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const alias = join(ext, "dangling.json");
    symlinkSync(join(ext, "not-yet-there.json"), alias);
    const jobPath = writeJobFile(
      t,
      JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "one", patterns: ["x"] }] })
    );
    const r = await runCli([jobPath, "--out", alias]);
    const created = join(ext, "not-yet-there.json");
    const written = JSON.parse(readFileSync(created, "utf8"));
    assert.equal(written.agent, "qa-test-runner", "resolved dangling target created");
    assert.doesNotMatch(r.stderr, /cannot write --out/, "no write failure reported");
  });

  it("a leaf symlink pointing INTO the target is still refused before the run (exit 2, nothing written)", async (t) => {
    const fx = makeBareCheckout(t);
    const ext = mkdtempSync(join(tmpdir(), "qa-r4-insym-"));
    t.after(() => rmSync(ext, { recursive: true, force: true }));
    const inside = join(fx.dir, "inside-report.json");
    const alias = join(ext, "alias.json");
    symlinkSync(inside, alias);
    const jobPath = writeJobFile(
      t,
      JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "one", patterns: ["x"] }] })
    );
    const r = await runCli([jobPath, "--out", alias]);
    assert.equal(r.code, 2, "refused destination exits 2");
    assert.match(r.stderr, /refusing to write into the evidenced tree/, "refusal named on stderr");
    assert.throws(() => statSync(inside), "nothing written inside the checkout");
  });
});

/* ------------------------------------------------------------------ */
/* Q665-003A.1 — PASS requires usable execution evidence: the          */
/* supported successful-file shape is name + at least one recorded    */
/* assertion (or a failed file). A name alone never authenticates a    */
/* pass; empty or nonexecuted suites are ERROR/NO_EXECUTION_EVIDENCE.  */
/* ------------------------------------------------------------------ */

describe("Q665-003A.1: filename-only and empty reports never receive PASS", () => {
  it("probe verbatim: {success:true,testResults:[{name:'a.test.js'}]} is ERROR/NO_EXECUTION_EVIDENCE", () => {
    const r = cls({ success: true, testResults: [{ name: "a.test.js" }] });
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "NO_EXECUTION_EVIDENCE");
  });

  it("probe verbatim: {success:true,testResults:[]} is ERROR/NO_EXECUTION_EVIDENCE", () => {
    const r = cls({ success: true, testResults: [] });
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "NO_EXECUTION_EVIDENCE");
  });

  it("probe verbatim: pending file with empty assertions is ERROR/NO_EXECUTION_EVIDENCE", () => {
    const r = cls({
      success: true,
      testResults: [{ name: "a.test.js", status: "pending", assertionResults: [] }],
    });
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "NO_EXECUTION_EVIDENCE");
  });

  it("positive partner: the real pass fixture still classifies PASS", () => {
    const r = cls(loadFixtureJson("vitest-pass.json"));
    assert.equal(r.status, "PASS");
  });

  it("positive partner: the real fail fixture still classifies FAIL", () => {
    const r = classifySuiteResult({ exitCode: 1, json: loadFixtureJson("vitest-fail.json") });
    assert.equal(r.status, "FAIL");
  });

  it("positive partner: the real load-error fixture still classifies ERROR/SUITE_LOAD_ERROR", () => {
    const r = classifySuiteResult({ exitCode: 1, json: loadFixtureJson("vitest-error.json") });
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "SUITE_LOAD_ERROR");
  });

  it("positive partner: the real TODO/skip fixture still classifies PASS with distinct counters", () => {
    const r = cls(loadFixtureJson("vitest-todo-skip-real.json"));
    assert.equal(r.status, "PASS");
    assert.deepEqual(r.test_counts, { total: 3, passed: 1, failed: 0, pending: 2, skipped: 1, todo: 1 });
  });

  it("a report whose only evidence is one skipped test still counts as executed (PASS)", () => {
    const r = cls({
      success: true,
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 1,
      numTodoTests: 0,
      testResults: [
        {
          name: "/f/s.test.js",
          status: "passed",
          assertionResults: [{ title: "s", status: "skipped", fullName: "s" }],
        },
      ],
    });
    assert.equal(r.status, "PASS");
    assert.equal(r.test_counts.skipped, 1);
  });
});

/* ------------------------------------------------------------------ */
/* Q665-005A.1 — truncation must never fabricate a green receipt: the  */
/* minimal envelope is an explicit REFUSED/REPORT_TRUNCATED refusal;   */
/* the shrunk envelope recomputes its verdict from the kept records    */
/* and keeps true identity and counts. Every reduced form is checked   */
/* against the report contract.                                        */
/* ------------------------------------------------------------------ */

function passSuite(id, n, extra = {}) {
  return {
    id,
    patterns: ["x"],
    timeout_ms: 1000,
    status: "PASS",
    exit_code: 0,
    signal: null,
    reason_code: null,
    reason: null,
    test_counts: { total: n, passed: n, failed: 0, pending: 0, skipped: 0, todo: 0 },
    failing_tests: [],
    failing_tests_total: 0,
    failing_tests_truncated: false,
    cleanup_failed: false,
    ...extra,
  };
}

function failSuite(id, n) {
  return {
    ...passSuite(id, n),
    status: "FAIL",
    exit_code: 1,
    reason_code: null,
    reason: "failing",
    test_counts: { total: n, passed: n - 1, failed: 1, pending: 0, skipped: 0, todo: 0 },
    failing_tests: [{ name: "n", file: "/f.test.js" }],
    failing_tests_total: 1,
  };
}

const HEAD = "a".repeat(40);

describe("Q665-005A.1: truncation never fabricates a green receipt", () => {
  it("reviewer pure probe: a passing report that cannot fit even shrunk becomes an explicit truncation refusal", () => {
    const suites = Array.from({ length: 16 }, (_, i) => passSuite(`s${i}`, 1));
    const big = completedReport(
      { job_id: "probe", target: "/t", head_pin: HEAD },
      HEAD,
      suites
    );
    assert.equal(big.verdict, "ALL_SUITES_PASS", "precondition: the full report is green");
    const { report: reduced, truncated } = enforceReportBytes(big, 1024);
    assert.equal(truncated, true);
    assert.ok(reportBytes(reduced) <= 1024, "reduced form fits the cap");
    assert.equal(reduced.status, "REFUSED", "status is not COMPLETED");
    assert.equal(reduced.verdict, "REFUSED", "no detached green verdict");
    assert.equal(reduced.reason_code, "REPORT_TRUNCATED", "explicit truncation refusal");
    assert.equal(reduced.head_pin, null, "head pin dropped, not fabricated");
    assert.equal(reduced.checkout_head, null, "checkout head dropped, not fabricated");
    assert.deepEqual(reduced.suites, [], "no invented suite records");
    assert.equal(reduced.diagnostics[0].code, "REPORT_TRUNCATED");
    assert.equal(validateReducedEnvelope(reduced), null, "reduced form satisfies the report contract");
  });

  it("a failing report at the floor is also a nonpassing refusal, never ALL_SUITES_PASS", () => {
    const big = completedReport(
      { job_id: "failfloor", target: "/t", head_pin: HEAD },
      HEAD,
      [failSuite("s", 10, )].concat(
        Array.from({ length: 8 }, (_, i) => passSuite(`p${i}`, 10, { reason: "x".repeat(400) }))
      )
    );
    assert.equal(big.verdict, "SUITES_FAILED", "precondition");
    const { report: reduced } = enforceReportBytes(big, MIN_REPORT_BYTES);
    assert.ok(reportBytes(reduced) <= MIN_REPORT_BYTES);
    assert.notEqual(reduced.verdict, "ALL_SUITES_PASS", "never green");
    assert.equal(validateReducedEnvelope(reduced), null);
  });

  it("the shrunk (non-minimal) form keeps a recomputed green verdict with true identity and true totals", () => {
    const suites = [passSuite("s", 4, { reason: "r".repeat(600) })];
    const big = completedReport({ job_id: "shrink", target: "/t", head_pin: HEAD }, HEAD, suites);
    const B = reportBytes(big);
    const { report: shrunk, truncated } = enforceReportBytes(big, B - 1);
    assert.equal(truncated, true);
    assert.equal(shrunk.verdict, "ALL_SUITES_PASS", "verdict recomputed from the kept PASS records");
    assert.equal(shrunk.head_pin, HEAD, "identity preserved");
    assert.equal(shrunk.checkout_head, HEAD, "checkout head preserved");
    assert.equal(shrunk.totals.tests_total, 4, "true totals preserved, not invented zeros");
    assert.equal(shrunk.suites.length, 1, "per-suite records kept");
    assert.equal(shrunk.diagnostics[0].code, "REPORT_TRUNCATED", "truncation explicit");
    assert.equal(validateReducedEnvelope(shrunk), null, "shrunk form satisfies the report contract");
  });

  it("the shrunk form recomputes a failing verdict from the kept records", () => {
    const suites = [failSuite("s", 10)];
    suites[0].reason = "failing ".repeat(400);
    const big = completedReport({ job_id: "shrinkfail", target: "/t", head_pin: HEAD }, HEAD, suites);
    const B = reportBytes(big);
    const { report: shrunk } = enforceReportBytes(big, B - 1);
    assert.equal(shrunk.verdict, "SUITES_FAILED", "verdict recomputed, not copied");
    assert.equal(shrunk.totals.tests_total, 10, "true totals kept");
    assert.equal(validateReducedEnvelope(shrunk), null);
  });

  it("a shrunk refusal keeps its REFUSED verdict (never recomputed to SUITES_FAILED)", () => {
    const r = refusalReport(
      { job_id: "j", target: "/t", head_pin: HEAD, suites: [{ id: "s", patterns: ["x"] }] },
      "TARGET_NOT_CLEAN",
      [{ code: "TARGET_NOT_CLEAN", path: "$.target", message: "dirty: " + "M file\n".repeat(500) }]
    );
    const B = reportBytes(r);
    assert.ok(B > 2048, "precondition: refusal exceeds 2048 bytes");
    const { report: bounded } = enforceReportBytes(r, 2048);
    assert.ok(reportBytes(bounded) <= 2048);
    assert.equal(bounded.verdict, "REFUSED", "refusal verdict preserved exactly");
    assert.equal(bounded.status, "REFUSED");
    assert.equal(validateReducedEnvelope(bounded), null);
  });

  it("exact-fit still passes through byte-identical; one byte less truncates", () => {
    const big = completedReport({ job_id: "exact", target: "/t", head_pin: HEAD }, HEAD, [
      passSuite("s", 2, { reason: "ok" }),
    ]);
    const B = reportBytes(big);
    const { report: same, truncated: t0 } = enforceReportBytes(big, B);
    assert.equal(t0, false);
    assert.equal(canonicalJson(same), canonicalJson(big), "exact-fit passes through untouched");
    const { report: smaller, truncated: t1 } = enforceReportBytes(big, B - 1);
    assert.equal(t1, true);
    assert.ok(reportBytes(smaller) <= B - 1);
    assert.equal(validateReducedEnvelope(smaller), null);
  });

  it("the minimal envelope fits inside the admission floor and satisfies the contract", () => {
    const m = minimalEnvelope({ status: "COMPLETED", verdict: "ALL_SUITES_PASS", reason_code: null });
    assert.equal(m.verdict, "REFUSED", "input verdict is never inherited");
    assert.equal(m.reason_code, "REPORT_TRUNCATED");
    assert.ok(reportBytes(m) <= MIN_REPORT_BYTES);
    assert.equal(validateReducedEnvelope(m), null);
  });
});
