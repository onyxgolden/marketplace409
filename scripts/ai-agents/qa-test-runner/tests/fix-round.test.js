/**
 * fix-round.test.js — regression probes for the PR #665 fix round
 * (ChatGPT verdict Q665-001..007, NEEDS CHANGES at bd8ed711).
 *
 * Each block names the finding it closes and exercises the verdict's
 * own probe shapes: dirty/staged/untracked refusal, write-attempt +
 * network-denial + env-scrub inside the boundary, the contradictory
 * report, deep-nesting / getter-tail admission, reporter exact/+1
 * byte budgets, the escaped-descendant timeout, and the piped CLI.
 *
 * Fixture checkouts here use a NODE-script vitest stub (helpers.js
 * uses a shell stub) so stubs can attempt writes, open sockets and
 * spawn descendants — the adversary behaviors the findings describe.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runJob,
  validateJob,
  classifySuiteResult,
  canonicalJson,
  isolationAvailable,
  admitValue,
} from "../src/index.js";
import { loadFixtureJson } from "./helpers.js";

const CLI = fileURLToPath(new URL("../runner/run-job.mjs", import.meta.url));
const PASS_JSON = loadFixtureJson("vitest-pass.json");

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

/** A vitest stub (node script) that writes `payload` to --outputFile. */
function reportStub(payload, exitCode = 0, padTo = 0) {
  return [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    "const i = process.argv.indexOf('--outputFile');",
    `let payload = ${JSON.stringify(JSON.stringify(payload))};`,
    padTo > 0 ? `if (payload.length < ${padTo}) payload += " ".repeat(${padTo} - payload.length);` : "",
    "if (i >= 0) fs.writeFileSync(process.argv[i + 1], payload);",
    `process.exit(${exitCode});`,
  ].join("\n");
}

/**
 * makeNodeCheckout(t, {bin}) -> {dir, head}
 * A committed git checkout whose node_modules/.bin/vitest is `bin`.
 */
function makeNodeCheckout(t, { bin }) {
  const dir = mkdtempSync(join(tmpdir(), "qa-runner-fix-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fix-fixture", private: true, version: "0.0.0" }) + "\n");
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  const binPath = join(dir, "node_modules", ".bin", "vitest");
  writeFileSync(binPath, bin);
  chmodSync(binPath, 0o755);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  const head = git(dir, ["rev-parse", "HEAD"]).trim();
  return { dir, head };
}

/** A scratch parent the test can inspect after the run (keepJobTmp). */
function scratchParent(t) {
  const dir = mkdtempSync(join(tmpdir(), "qa-runner-scratch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function findScratch(parent) {
  const kids = readdirSync(parent).filter((k) => k.startsWith("qa-test-runner-"));
  assert.equal(kids.length, 1, "exactly one job scratch dir");
  return join(parent, kids[0]);
}

const baseJob = (fx, extra = {}) => ({
  target: fx.dir,
  head_pin: fx.head,
  suites: [{ id: "unit", patterns: ["src/a.test.js"] }],
  ...extra,
});

/* ------------------------------------------------------------------ */
/* Q665-001 — execution binds to the pinned commit's bytes             */
/* ------------------------------------------------------------------ */

describe("Q665-001: dirty / staged / untracked checkouts are refused, never cleaned", () => {
  it("a modified tracked file refuses TARGET_NOT_CLEAN and the file is left exactly as dirty as it was", async (t) => {
    const fx = makeNodeCheckout(t, { bin: reportStub(PASS_JSON) });
    const pkg = join(fx.dir, "package.json");
    const dirty = readFileSync(pkg, "utf8") + "\n";
    writeFileSync(pkg, dirty);
    const report = await runJob(baseJob(fx));
    assert.equal(report.status, "REFUSED");
    assert.equal(report.reason_code, "TARGET_NOT_CLEAN");
    assert.equal(report.verdict, "REFUSED");
    // The operator's checkout was NOT mutated or cleaned by the refusal.
    assert.equal(readFileSync(pkg, "utf8"), dirty);
    assert.match(git(fx.dir, ["status", "--porcelain"]), /M package\.json/);
  });

  it("a staged change refuses TARGET_NOT_CLEAN", async (t) => {
    const fx = makeNodeCheckout(t, { bin: reportStub(PASS_JSON) });
    writeFileSync(join(fx.dir, "staged.txt"), "staged\n");
    git(fx.dir, ["add", "staged.txt"]);
    const report = await runJob(baseJob(fx));
    assert.equal(report.status, "REFUSED");
    assert.equal(report.reason_code, "TARGET_NOT_CLEAN");
  });

  it("an untracked test file refuses TARGET_NOT_CLEAN", async (t) => {
    const fx = makeNodeCheckout(t, { bin: reportStub(PASS_JSON) });
    writeFileSync(join(fx.dir, "untracked.test.js"), "// untracked\n");
    const report = await runJob(baseJob(fx));
    assert.equal(report.status, "REFUSED");
    assert.equal(report.reason_code, "TARGET_NOT_CLEAN");
  });

  it("the operator checkout changing MID-RUN voids the blessing: CHECKOUT_CHANGED_DURING_RUN", async (t) => {
    const sleepBin = [
      "#!/bin/sh",
      "touch runner-executed.marker",
      "exec sleep 3",
    ].join("\n");
    const fx = makeNodeCheckout(t, { bin: sleepBin });
    const pending = runJob(baseJob(fx));
    // Mutate the original while the suite is executing in its copy.
    await new Promise((r) => setTimeout(r, 900));
    writeFileSync(join(fx.dir, "package.json"), readFileSync(join(fx.dir, "package.json"), "utf8") + "\n");
    const report = await pending;
    assert.notEqual(report.verdict, "ALL_SUITES_PASS");
    assert.equal(report.reason_code, "CHECKOUT_CHANGED_DURING_RUN");
  });
});

/* ------------------------------------------------------------------ */
/* Q665-002 — real read-only / offline isolation                       */
/* ------------------------------------------------------------------ */

describe("Q665-002: isolation boundary (write attempt, network, environment)", () => {
  it("a suite cannot write into the original, cannot reach the network, and inherits no credentials", async (t) => {
    if (!isolationAvailable()) {
      t.skip("no isolation mechanism on this host");
      return;
    }
    // A listening server the suite will try (and fail) to reach.
    const { createServer } = await import("node:net");
    const server = createServer(() => {});
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => server.close());
    const port = server.address().port;

    const probeBin = [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const net = require("node:net");',
      'const path = require("node:path");',
      "const out = {};",
      'try { fs.writeFileSync("cwd-write.txt", "x"); out.cwdWrite = "ok"; } catch (e) { out.cwdWrite = e.code; }',
      'try { fs.writeFileSync("__ORIGINAL__/attacker-write.txt", "x"); out.originalWrite = "ok"; } catch (e) { out.originalWrite = e.code; }',
      "out.leakedSecret = process.env.QA_LEAK_SECRET ?? null;",
      "out.home = process.env.HOME;",
      "const done = (netResult) => {",
      "  out.net = netResult;",
      '  fs.writeFileSync(path.join(process.env.TMPDIR, "probe-results.json"), JSON.stringify(out));',
      "  const i = process.argv.indexOf('--outputFile');",
      `  if (i >= 0) fs.writeFileSync(process.argv[i + 1], ${JSON.stringify(JSON.stringify(PASS_JSON))});`,
      "  process.exit(0);",
      "};",
      `const sock = net.connect(${port}, "127.0.0.1");`,
      'sock.on("connect", () => done("CONNECTED"));',
      'sock.on("error", (e) => done(e.code));',
      'setTimeout(() => done("TIMEOUT"), 2000);',
    ].join("\n");

    const fx = makeNodeCheckout(t, { bin: "PLACEHOLDER" });
    // Bake the original path into the stub, then re-commit so the tree is clean.
    const binPath = join(fx.dir, "node_modules", ".bin", "vitest");
    writeFileSync(binPath, probeBin.replaceAll("__ORIGINAL__", fx.dir));
    chmodSync(binPath, 0o755);
    git(fx.dir, ["add", "-A"]);
    git(fx.dir, ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "probe"]);
    fx.head = git(fx.dir, ["rev-parse", "HEAD"]).trim();

    const parent = scratchParent(t);
    process.env.QA_LEAK_SECRET = "must-not-cross-the-boundary";
    let report;
    try {
      report = await runJob(baseJob(fx), { tmpRoot: parent, keepJobTmp: true });
    } finally {
      delete process.env.QA_LEAK_SECRET;
    }
    assert.equal(report.verdict, "ALL_SUITES_PASS", JSON.stringify(report.suites));
    assert.ok(report.isolation && report.isolation.mechanism, "report declares its isolation mechanism");

    const scratch = findScratch(parent);
    const probe = JSON.parse(readFileSync(join(scratch, "tmp", "probe-results.json"), "utf8"));
    assert.equal(probe.cwdWrite, "ok", "writes land in the disposable copy");
    assert.notEqual(probe.originalWrite, "ok", "write into the original checkout must fail");
    assert.notEqual(probe.net, "CONNECTED", "network must be denied inside the boundary");
    assert.equal(probe.leakedSecret, null, "operator environment must not cross the boundary");
    assert.ok(probe.home.startsWith(scratch), "HOME is redirected into the job scratch dir");
    // The original is byte-clean after the run.
    assert.equal(existsSync(join(fx.dir, "attacker-write.txt")), false);
    assert.equal(existsSync(join(fx.dir, "cwd-write.txt")), false);
    assert.equal(git(fx.dir, ["status", "--porcelain"]), "");
  });

  it("with no isolation mechanism the job is REFUSED/ISOLATION_UNAVAILABLE and nothing executes", async (t) => {
    const fx = makeNodeCheckout(t, { bin: reportStub(PASS_JSON) });
    const parent = scratchParent(t);
    const report = await runJob(baseJob(fx), { tmpRoot: parent, isolation: null, keepJobTmp: true });
    assert.equal(report.status, "REFUSED");
    assert.equal(report.reason_code, "ISOLATION_UNAVAILABLE");
    assert.deepEqual(readdirSync(parent), [], "no scratch dir, no execution");
  });
});

/* ------------------------------------------------------------------ */
/* Materialization robustness — found by the exact-head receipt run:   */
/* `cp -a` on a real dependency tree can emit >1MiB of ownership       */
/* warnings; the overlay must drain stderr, never die on maxBuffer.    */
/* ------------------------------------------------------------------ */

describe("materialization: a chatty overlay copy cannot break the run", () => {
  it("a `cp` that spews 2MiB of stderr warnings still completes the overlay", async (t) => {
    const fx = makeNodeCheckout(t, { bin: reportStub(PASS_JSON) });
    const fakeBin = mkdtempSync(join(tmpdir(), "qa-runner-fakebin-"));
    t.after(() => rmSync(fakeBin, { recursive: true, force: true }));
    const realCp = execFileSync("which", ["cp"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(fakeBin, "cp"),
      [
        "#!/bin/sh",
        // 2 MiB of warning noise on stderr, then delegate for real.
        'head -c 2097152 /dev/zero | tr "\\0" "w" >&2',
        `exec ${realCp} "$@"`,
      ].join("\n")
    );
    chmodSync(join(fakeBin, "cp"), 0o755);
    const prevPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${prevPath}`;
    try {
      const report = await runJob(baseJob(fx));
      assert.equal(report.verdict, "ALL_SUITES_PASS", JSON.stringify(report.diagnostics));
    } finally {
      process.env.PATH = prevPath;
    }
  });
});

/* ------------------------------------------------------------------ */
/* Q665-003 — a failed assertion can never classify PASS               */
/* ------------------------------------------------------------------ */

describe("Q665-003: classification integrity", () => {
  const contradictory = () => {
    const j = structuredClone(PASS_JSON);
    j.numFailedTests = 0;
    j.numFailedTestSuites = 0;
    j.success = true;
    j.testResults[0].status = "passed";
    j.testResults[0].assertionResults[0].status = "failed";
    return j;
  };

  it("the verdict's exact contradictory report is ERROR/INCONSISTENT_REPORT, never PASS", () => {
    const r = classifySuiteResult({ exitCode: 0, json: contradictory() });
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "INCONSISTENT_REPORT");
    assert.equal(r.test_counts.failed, 1, "counts are derived from the records");
    assert.equal(r.failing_tests_total, 1);
  });

  it("the contradictory report through runJob fails the suite and the verdict", async (t) => {
    const fx = makeNodeCheckout(t, { bin: reportStub(contradictory(), 0) });
    const report = await runJob(baseJob(fx));
    assert.equal(report.suites[0].status, "ERROR");
    assert.equal(report.suites[0].reason_code, "INCONSISTENT_REPORT");
    assert.equal(report.verdict, "SUITES_FAILED");
  });

  it("malformed reporter shapes classify ERROR/MALFORMED_REPORT and never throw", () => {
    const shapes = [
      { testResults: [42] },
      { testResults: [{ name: "x", assertionResults: "nope" }] },
      { testResults: [{ name: "x", assertionResults: [null] }] },
      { testResults: [{ name: "x", assertionResults: [{ title: "no status" }] }] },
      { numFailedTests: "x", testResults: [] },
      { success: "yes", testResults: [] },
    ];
    for (const json of shapes) {
      const r = classifySuiteResult({ exitCode: 0, json });
      assert.equal(r.status, "ERROR", JSON.stringify(json));
      assert.equal(r.reason_code, "MALFORMED_REPORT", JSON.stringify(json));
    }
  });

  it("a consistent failing report still classifies FAIL (not inconsistent)", () => {
    const r = classifySuiteResult({ exitCode: 1, json: loadFixtureJson("vitest-fail.json") });
    assert.equal(r.status, "FAIL");
    assert.equal(r.test_counts.failed, 1);
  });

  it("real vitest suite counters (describe blocks) are NOT reconciled against per-file records", () => {
    // Shape captured from vitest 4.1.9 on a real marketplace409 suite:
    // one file, one describe, two tests — the header counts TWO suites
    // (file + describe) against ONE testResults entry. Reconciling
    // those units cried INCONSISTENT on a genuine pass (found by the
    // PR #665 exact-head receipt run).
    const json = {
      numTotalTests: 2,
      numPassedTests: 2,
      numFailedTests: 0,
      numPendingTests: 0,
      numTotalTestSuites: 2,
      numPassedTestSuites: 2,
      numFailedTestSuites: 0,
      success: true,
      testResults: [
        {
          name: "/repo/src/app/api/capture/config/route.test.js",
          status: "passed",
          message: "",
          assertionResults: [
            { status: "passed", fullName: "config returns defaults", title: "returns defaults" },
            { status: "passed", fullName: "config rejects bad input", title: "rejects bad input" },
          ],
        },
      ],
    };
    const r = classifySuiteResult({ exitCode: 0, json });
    assert.equal(r.status, "PASS");
    assert.deepEqual(r.test_counts, { total: 2, passed: 2, failed: 0, pending: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Q665-004 — charge-before-inspect on every public path               */
/* ------------------------------------------------------------------ */

describe("Q665-004: bounded admission (no getters invoked, no unbounded walks)", () => {
  it("10,000-deep plain JSON nesting is a named INPUT_LIMIT refusal, not a RangeError", () => {
    let deep = "x";
    for (let i = 0; i < 10_000; i++) deep = [deep];
    const job = { target: "/tmp/x", head_pin: "a".repeat(40), suites: [{ id: "s", patterns: [deep] }] };
    const r = validateJob(job);
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, "INPUT_LIMIT");
  });

  it("the tail-getter sentinel: the getter is NEVER invoked (admission refuses before charging)", () => {
    let reads = 0;
    const tail = { patterns: ["b"] };
    Object.defineProperty(tail, "id", {
      enumerable: true,
      get() {
        reads += 1;
        return "tail";
      },
    });
    const job = {
      target: "/tmp/x",
      head_pin: "a".repeat(40),
      budgets: { max_suites: 1 },
      suites: [{ id: "one", patterns: ["a"] }, tail],
    };
    const r = validateJob(job);
    assert.equal(r.ok, false);
    assert.equal(reads, 0, "admission must refuse the accessor without invoking it");
  });

  it("a runJob refusal over a getter-bearing job never invokes the getter either", async () => {
    let reads = 0;
    const job = { target: "/tmp/x", head_pin: "a".repeat(40), suites: [{ id: "one", patterns: ["a"] }] };
    Object.defineProperty(job, "job_id", {
      enumerable: true,
      get() {
        reads += 1;
        return "x";
      },
    });
    const report = await runJob(job);
    assert.equal(report.status, "REFUSED");
    assert.equal(reads, 0);
    // The refusal envelope itself is bounded plain JSON.
    assert.ok(Buffer.byteLength(canonicalJson(report)) < 32 * 1024);
  });

  it("a revoked Proxy job is refused without throwing", () => {
    const { proxy, revoke } = Proxy.revocable({ target: "/tmp/x" }, {});
    revoke();
    const r = validateJob(proxy);
    assert.equal(r.ok, false);
  });

  it("a refusal built from a 500-suite raw job is capped at the suite limit", async () => {
    const suites = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, patterns: ["x".repeat(400)] }));
    const report = await runJob({ target: "/tmp/x", head_pin: "a".repeat(40), suites });
    assert.equal(report.status, "REFUSED");
    assert.ok(report.suites.length <= 16, `refusal listed ${report.suites.length} suites`);
    assert.ok(Buffer.byteLength(canonicalJson(report)) < 64 * 1024);
  });
});

/* ------------------------------------------------------------------ */
/* Q665-005 — reporter bytes inside the declared capture budget        */
/* ------------------------------------------------------------------ */

/** A pass report padded (with JSON-legal trailing spaces) to N bytes. */
function paddedPassReport(totalBytes, big = true) {
  const json = structuredClone(PASS_JSON);
  if (big) {
    json.numTotalTests = 100;
    json.numPassedTests = 100;
    json.testResults[0].assertionResults = Array.from({ length: 100 }, (_, i) => ({
      status: "passed",
      fullName: `${i}${"x".repeat(500)}`,
    }));
  }
  const base = JSON.stringify(json);
  assert.ok(base.length <= totalBytes, `fixture base ${base.length} > ${totalBytes}`);
  return base + " ".repeat(totalBytes - base.length);
}

function rawReportStub(rawText, exitCode = 0) {
  return [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    "const i = process.argv.indexOf('--outputFile');",
    `if (i >= 0) fs.writeFileSync(process.argv[i + 1], ${JSON.stringify(rawText)});`,
    `process.exit(${exitCode});`,
  ].join("\n");
}

describe("Q665-005: reporter-file bytes are charged before read/parse", () => {
  it("a reporter file exactly AT the per-suite reporter budget is admitted", async (t) => {
    const cap = 4096;
    const fx = makeNodeCheckout(t, { bin: rawReportStub(paddedPassReport(cap, false)) });
    const report = await runJob(baseJob(fx, { budgets: { max_reporter_bytes_per_suite: cap } }));
    assert.equal(report.suites[0].status, "PASS", JSON.stringify(report.suites[0]));
    assert.equal(report.verdict, "ALL_SUITES_PASS");
  });

  it("a reporter file ONE BYTE over the budget is ERROR/REPORTER_CAP_EXCEEDED — never PASS, never truncated", async (t) => {
    const cap = 4096;
    const fx = makeNodeCheckout(t, { bin: rawReportStub(paddedPassReport(cap + 1, false)) });
    const report = await runJob(baseJob(fx, { budgets: { max_reporter_bytes_per_suite: cap } }));
    assert.equal(report.suites[0].status, "ERROR");
    assert.equal(report.suites[0].reason_code, "REPORTER_CAP_EXCEEDED");
    assert.equal(report.verdict, "SUITES_FAILED");
  });

  it("the verdict's shape: a 53,897-byte report under a 1,024-byte STDOUT cap passes on the separate reporter budget", async (t) => {
    const raw = paddedPassReport(53_897);
    const fx = makeNodeCheckout(t, { bin: rawReportStub(raw) });
    const report = await runJob(baseJob(fx, { budgets: { max_captured_bytes_per_suite: 1024 } }));
    assert.equal(report.suites[0].status, "PASS", JSON.stringify(report.suites[0]));
    assert.equal(report.suites[0].test_counts.passed, 100);
  });

  it("the same report under a 1,024-byte REPORTER budget is REPORTER_CAP_EXCEEDED", async (t) => {
    const raw = paddedPassReport(53_897);
    const fx = makeNodeCheckout(t, { bin: rawReportStub(raw) });
    const report = await runJob(baseJob(fx, { budgets: { max_reporter_bytes_per_suite: 1024 } }));
    assert.equal(report.suites[0].status, "ERROR");
    assert.equal(report.suites[0].reason_code, "REPORTER_CAP_EXCEEDED");
  });
});

/* ------------------------------------------------------------------ */
/* Q665-006 — supervisor deadline independent of inherited pipes       */
/* ------------------------------------------------------------------ */

describe("Q665-006: bounded timeout against an escaped descendant", () => {
  it("a detached descendant holding stdout/stderr cannot extend the job past its settle bound", async (t) => {
    if (!isolationAvailable()) {
      t.skip("no isolation mechanism on this host");
      return;
    }
    const escapeBin = [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const { spawn } = require("node:child_process");',
      'const hb = path.join(process.env.TMPDIR, "heartbeat.log");',
      "const childScript = \"const fs=require('node:fs');const hb=process.env.HB_PATH;const iv=setInterval(()=>{try{fs.appendFileSync(hb,'x')}catch{}},100);setTimeout(()=>{clearInterval(iv);process.exit(0)},12000);\";",
      // Detached (own session) + inherits our stdout/stderr fds: the
      // exact escape shape from the verdict's probe.
      "spawn(process.execPath, ['-e', childScript], { detached: true, stdio: ['ignore', 1, 2], env: { ...process.env, HB_PATH: hb } });",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const fx = makeNodeCheckout(t, { bin: escapeBin });
    const parent = scratchParent(t);
    const started = Date.now();
    const report = await runJob(baseJob(fx, { budgets: { per_suite_timeout_ms: 1500, per_job_timeout_ms: 1500 } }), {
      tmpRoot: parent,
      keepJobTmp: true,
    });
    const elapsed = Date.now() - started;
    assert.equal(report.suites[0].status, "TIMEOUT", JSON.stringify(report.suites[0]));
    assert.equal(report.suites[0].cleanup_failed, false, "contained work must be confirmed dead");
    assert.ok(elapsed < 1500 + 3250 + 2500, `supervisor settle bound violated: ${elapsed}ms`);
    assert.ok(elapsed >= 1400, `settled suspiciously early: ${elapsed}ms`);
    // No-descendant-left evidence: the heartbeat stops growing.
    const scratch = findScratch(parent);
    const hbPath = join(scratch, "tmp", "heartbeat.log");
    const size1 = existsSync(hbPath) ? statSync(hbPath).size : 0;
    await new Promise((r) => setTimeout(r, 600));
    const size2 = existsSync(hbPath) ? statSync(hbPath).size : 0;
    assert.equal(size2, size1, "the escaped descendant is still running after the job settled");
  });

  it("an output-cap kill also settles promptly", async (t) => {
    const spewBin = [
      "#!/usr/bin/env node",
      'const chunk = "x".repeat(65536);',
      "for (let i = 0; i < 64; i++) process.stdout.write(chunk);",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const fx = makeNodeCheckout(t, { bin: spewBin });
    const started = Date.now();
    const report = await runJob(baseJob(fx, { budgets: { max_captured_bytes_per_suite: 65_536 } }));
    const elapsed = Date.now() - started;
    assert.equal(report.suites[0].status, "ERROR");
    assert.equal(report.suites[0].reason_code, "OUTPUT_CAP_EXCEEDED");
    assert.ok(elapsed < 10_000, `output-cap settle took ${elapsed}ms`);
  });
});

/* ------------------------------------------------------------------ */
/* Q665-007 — the CLI stdout channel is never truncated                */
/* ------------------------------------------------------------------ */

function runCliPiped(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
  });
}

function writeJobFile(t, job) {
  const dir = mkdtempSync(join(tmpdir(), "qa-runner-jobfile-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "job.json");
  writeFileSync(path, typeof job === "string" ? job : JSON.stringify(job));
  return path;
}

describe("Q665-007 + CLI bounds: piped stdout, input cap, output containment", () => {
  it("a large failing report arrives COMPLETE on a pipe: parseable, full counts, verdict exit code", async (t) => {
    const bigFail = {
      numTotalTests: 2000,
      numPassedTests: 0,
      numFailedTests: 2000,
      numPendingTests: 0,
      numTotalTestSuites: 1,
      numFailedTestSuites: 1,
      success: false,
      testResults: [
        {
          name: "/fixture/big.test.js",
          status: "failed",
          message: "",
          assertionResults: Array.from({ length: 2000 }, (_, i) => ({
            status: "failed",
            fullName: `${i}${"x".repeat(300)}`,
            title: String(i),
          })),
        },
      ],
    };
    const fx = makeNodeCheckout(t, { bin: reportStub(bigFail, 1) });
    const jobPath = writeJobFile(t, baseJob(fx));
    const r = await runCliPiped([jobPath]);
    assert.equal(r.code, 1, r.stderr);
    const parsed = JSON.parse(r.stdout); // throws if truncated — the Q665-007 defect
    assert.equal(parsed.verdict, "SUITES_FAILED");
    assert.equal(parsed.totals.tests_failed, 2000);
    assert.equal(parsed.suites[0].failing_tests_total, 2000);
    assert.equal(parsed.suites[0].failing_tests.length, 100, "extracted records are bounded");
    assert.equal(parsed.suites[0].failing_tests_truncated, true);
  });

  it("an oversized job file is refused INPUT_LIMIT without being parsed", async (t) => {
    const jobPath = writeJobFile(t, " ".repeat(65_537));
    const r = await runCliPiped([jobPath]);
    assert.equal(r.code, 1);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.status, "REFUSED");
    assert.equal(parsed.reason_code, "INPUT_LIMIT");
  });

  it("a job file exactly AT the byte limit is admitted (and then refused on its merits)", async (t) => {
    const job = { target: join(tmpdir(), "qa-runner-no-such-checkout"), head_pin: "a".repeat(40), suites: [{ id: "s", patterns: ["x"] }] };
    const text = JSON.stringify(job);
    const padded = text + " ".repeat(65_536 - text.length);
    assert.equal(Buffer.byteLength(padded), 65_536);
    const jobPath = writeJobFile(t, padded);
    const r = await runCliPiped([jobPath]);
    assert.equal(r.code, 1);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.reason_code, "TARGET_NOT_FOUND");
  });

  it("--out inside the target checkout is refused (containment) and nothing is written there", async (t) => {
    const fx = makeNodeCheckout(t, { bin: reportStub(PASS_JSON) });
    const jobPath = writeJobFile(t, baseJob(fx));
    const evil = join(fx.dir, "evil-report.json");
    const r = await runCliPiped([jobPath, "--out", evil]);
    assert.equal(r.code, 2, r.stderr);
    assert.equal(existsSync(evil), false);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.verdict, "ALL_SUITES_PASS", "the run itself still reports on stdout");
    assert.equal(git(fx.dir, ["status", "--porcelain"]), "", "target untouched");
  });
});

/* ------------------------------------------------------------------ */
/* Q665-008 — admission must not invoke a single caller-controlled    */
/* Proxy trap. Proxies are refused via the trap-free util.types       */
/* isProxy gate BEFORE any reflective traversal, so side-effecting    */
/* traps (even non-throwing ones returning valid metadata) can never  */
/* execute. Revoked-only coverage was insufficient.                   */
/* ------------------------------------------------------------------ */

/** A handler that counts every trap invocation; non-throwing traps. */
function countingHandler(counts, target) {
  const names = [
    "getPrototypeOf",
    "ownKeys",
    "getOwnPropertyDescriptor",
    "get",
    "set",
    "has",
    "defineProperty",
    "deleteProperty",
    "setPrototypeOf",
    "preventExtensions",
    "isExtensible",
    "apply",
    "construct",
  ];
  const h = {};
  for (const name of names) {
    h[name] = (t, ...args) => {
      counts[name] = (counts[name] || 0) + 1;
      return Reflect[name](t, ...args);
    };
  }
  void target;
  return h;
}

function totalTrapCalls(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

describe("Q665-008 — admission refuses caller-controlled Proxies without invoking any trap", () => {
  it("ChatGPT's exact probe: live Proxy with non-throwing getPrototypeOf/ownKeys/getOwnPropertyDescriptor traps is refused with zero trap invocations", () => {
    let calls = 0;
    const input = new Proxy(
      {},
      {
        getPrototypeOf(target) {
          calls += 1;
          return Reflect.getPrototypeOf(target);
        },
        ownKeys(target) {
          calls += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          calls += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      }
    );
    const result = admitValue(input);
    assert.equal(result.ok, false, "Proxy must be refused, not admitted");
    assert.equal(calls, 0, `expected zero trap invocations, got ${calls}`);
  });

  it("every reflective operation the admission performs is covered: a handler that counts ALL traps fires zero times", () => {
    const counts = {};
    const input = new Proxy({ a: 1, b: "two" }, countingHandler(counts, null));
    const result = admitValue(input);
    assert.equal(result.ok, false);
    assert.equal(totalTrapCalls(counts), 0, `trap counts: ${JSON.stringify(counts)}`);
  });

  it("a Proxy over an ARRAY target (exercising the array-length descriptor path) is refused with zero trap invocations", () => {
    const counts = {};
    const input = new Proxy([1, 2, 3], countingHandler(counts, null));
    const result = admitValue(input);
    assert.equal(result.ok, false);
    assert.equal(totalTrapCalls(counts), 0, `trap counts: ${JSON.stringify(counts)}`);
  });

  it("a Proxy NESTED inside a plain object is refused without invoking its traps when the walk reaches it", () => {
    const counts = {};
    const nested = new Proxy({ secret: true }, countingHandler(counts, null));
    const input = { level: "plain", nested };
    const result = admitValue(input);
    assert.equal(result.ok, false);
    assert.equal(totalTrapCalls(counts), 0, `trap counts: ${JSON.stringify(counts)}`);
  });

  it("traps that RETURN valid metadata (no throw) still execute zero times — refusal is not throw-dependent", () => {
    let calls = 0;
    const input = new Proxy(
      { ok: true },
      {
        getPrototypeOf() {
          calls += 1;
          return Object.prototype; // valid metadata, would pass the plain-proto check
        },
        ownKeys() {
          calls += 1;
          return ["ok"];
        },
        getOwnPropertyDescriptor(target, key) {
          calls += 1;
          return { value: true, writable: true, enumerable: true, configurable: true };
        },
      }
    );
    const result = admitValue(input);
    assert.equal(result.ok, false, "even a well-behaved Proxy is refused");
    assert.equal(calls, 0, `expected zero trap invocations, got ${calls}`);
  });

  it("non-proxy objects are unaffected: plain data still admits with ok:true", () => {
    const result = admitValue({ a: [1, "two", { three: 3 }], b: null });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { a: [1, "two", { three: 3 }], b: null });
  });
});
