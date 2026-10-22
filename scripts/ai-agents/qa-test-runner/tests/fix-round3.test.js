/**
 * fix-round3.test.js — regression tests for the Q665 fix round 3
 * findings (ChatGPT full re-review at f6416ed1):
 *   Q665-002A (P1) setup/CLI writes bypass the suite sandbox
 *   Q665-002B (P2) installed bubblewrap mistaken for a usable boundary
 *   Q665-003A (P2) malformed/failure-bearing reports still PASS
 *   Q665-003B (P2) real Vitest TODO reports falsely rejected
 *   Q665-004A (P1) __proto__-as-own-key prototype control (trap half
 *              was fixed in round 2)
 *   Q665-004B (P2) admission byte limit counts characters, not
 *              serialized UTF-8 bytes
 *   Q665-005A (P2) final report byte cap enforced only by the CLI
 *
 * Every finding was reproduced with ChatGPT's probes against the
 * pre-fix head before the fix (see the fix-round-3 re-review request);
 * each test below fails on the pre-fix code and passes after.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  admitValue,
  ADMISSION_LIMITS,
  validateJob,
  runJob,
  canonicalJson,
  classifySuiteResult,
  validateReportShape,
  deriveCounts,
  parseVitestJson,
  detectIsolation,
  buildIsolatedSpawn,
  enforceReportBytes,
  minimalEnvelope,
  reportBytes,
  completedReport,
  refusalReport,
  MIN_REPORT_BYTES,
  BUDGET_LIMITS,
} from "../src/index.js";
import { loadFixtureJson } from "./helpers.js";

const CLI = fileURLToPath(new URL("../runner/run-job.mjs", import.meta.url));
const ISOLATION_URL = new URL("../src/isolation.js", import.meta.url).href;

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
  const dir = mkdtempSync(join(tmpdir(), "qa-r3-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, "job.json");
  writeFileSync(p, text);
  return p;
}

/** Clean git checkout whose node_modules is a COMMITTED symlink to an external dir. */
function makeSymlinkNodeModulesCheckout(t) {
  const dir = mkdtempSync(join(tmpdir(), "qa-r3-link-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ext = mkdtempSync(join(tmpdir(), "qa-r3-extdeps-"));
  t.after(() => rmSync(ext, { recursive: true, force: true }));
  writeFileSync(join(ext, ".bin-keep"), "x\n");
  writeFileSync(join(dir, "package.json"), '{"name":"link-fixture"}\n');
  symlinkSync(ext, join(dir, "node_modules"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  const head = git(dir, ["rev-parse", "HEAD"]).trim();
  assert.equal(git(dir, ["status", "--porcelain"]), "", "fixture checkout is clean");
  return { dir, head, ext };
}

/** Minimal clean git checkout (no node_modules at all). */
function makeBareCheckout(t) {
  const dir = mkdtempSync(join(tmpdir(), "qa-r3-bare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "package.json"), '{"name":"bare"}\n');
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  return { dir, head: git(dir, ["rev-parse", "HEAD"]).trim() };
}

const cls = (json) => classifySuiteResult({ exitCode: 0, signal: null, timedOut: false, outputExceeded: false, reporterExceeded: false, spawnError: null, json });

/* ------------------------------------------------------------------ */
/* Q665-002A — setup and CLI writes bypass the suite sandbox           */
/* ------------------------------------------------------------------ */

describe("Q665-002A: no-follow setup writes and canonical --out containment", () => {
  it("a symlinked node_modules root is REFUSED before any copy — no host-side write through the link", async (t) => {
    const fx = makeSymlinkNodeModulesCheckout(t);
    const before = readdirSync(fx.ext).sort().join(",");
    // Force the mechanism seam past the isolation gate: the refusal
    // under test happens at overlay time, before any suite spawns.
    const report = await runJob(
      { target: fx.dir, head_pin: fx.head, suites: [{ id: "s", patterns: ["x"] }] },
      { isolation: "bwrap" }
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.reason_code, "MATERIALIZATION_FAILED");
    assert.match(report.diagnostics[0].message, /not a real directory/);
    assert.equal(
      readdirSync(fx.ext).sort().join(","),
      before,
      "the external dependency dir is untouched — no node_modules link was written through the symlink"
    );
  });

  it("CLI --out through an alias directory into the target is refused BEFORE the run (exit 2, nothing written)", async (t) => {
    const fx = makeBareCheckout(t);
    const alias = join(tmpdir(), `qa-r3-alias-${Date.now()}`);
    symlinkSync(fx.dir, alias);
    t.after(() => rmSync(alias, { force: true }));
    const jobPath = writeJobFile(t, JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "s", patterns: ["x"] }] }));
    const evil = join(alias, "injected-report.json");
    const r = await runCli([jobPath, "--out", evil]);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /refusing to write into the evidenced tree/);
    assert.equal(existsSync(join(fx.dir, "injected-report.json")), false, "nothing landed inside the target");
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.status, "REFUSED", "stdout still carries the report");
  });

  it("CLI --out through an ANCESTOR alias is refused (symlinks resolved, not just the leaf)", async (t) => {
    const fx = makeBareCheckout(t);
    const aliasDir = join(tmpdir(), `qa-r3-ancalias-${Date.now()}`);
    symlinkSync(fx.dir, aliasDir);
    t.after(() => rmSync(aliasDir, { force: true }));
    const jobPath = writeJobFile(t, JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "s", patterns: ["x"] }] }));
    const evil = join(aliasDir, "sub", "r.json");
    const r = await runCli([jobPath, "--out", evil]);
    assert.equal(r.code, 2, r.stderr);
    assert.equal(existsSync(join(fx.dir, "sub", "r.json")), false);
  });

  it("CLI --out to an existing destination symlink pointing into the target is refused", async (t) => {
    const fx = makeBareCheckout(t);
    const destDir = mkdtempSync(join(tmpdir(), "qa-r3-destlink-"));
    t.after(() => rmSync(destDir, { recursive: true, force: true }));
    const link = join(destDir, "link.json");
    symlinkSync(join(fx.dir, "r.json"), link); // dangling link into the target
    const jobPath = writeJobFile(t, JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "s", patterns: ["x"] }] }));
    const r = await runCli([jobPath, "--out", link]);
    assert.equal(r.code, 2, r.stderr);
    assert.equal(existsSync(join(fx.dir, "r.json")), false);
  });

  it("CLI --out to a normal path outside the target still works and matches stdout", async (t) => {
    const fx = makeBareCheckout(t);
    const outDir = mkdtempSync(join(tmpdir(), "qa-r3-ok-"));
    t.after(() => rmSync(outDir, { recursive: true, force: true }));
    const out = join(outDir, "report.json");
    const jobPath = writeJobFile(t, JSON.stringify({ target: fx.dir, head_pin: fx.head, suites: [{ id: "s", patterns: ["x"] }] }));
    const r = await runCli([jobPath, "--out", out]);
    assert.equal(existsSync(out), true, "normal destination is written");
    assert.equal(readFileSync(out, "utf8").trim(), r.stdout.trim(), "file and stdout agree");
  });
});

/* ------------------------------------------------------------------ */
/* Q665-002B — installed bubblewrap mistaken for a usable boundary     */
/* ------------------------------------------------------------------ */

describe("Q665-002B: isolation detection proves the boundary", () => {
  it("a fake bwrap that answers --version but fails namespace creation is NOT advertised (ChatGPT's exact scenario)", async (t) => {
    const bin = mkdtempSync(join(tmpdir(), "qa-r3-fakebin-"));
    t.after(() => rmSync(bin, { recursive: true, force: true }));
    writeFileSync(
      join(bin, "bwrap"),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "bubblewrap 0.9.0"; exit 0; fi\necho "bwrap: Creating new namespace failed: Operation not permitted." >&2\nexit 1\n'
    );
    chmodSync(join(bin, "bwrap"), 0o755);
    const probe = `import(${JSON.stringify(ISOLATION_URL)}).then((m) => console.log(String(m.detectIsolation())));`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      timeout: 60000,
    }).trim();
    assert.notEqual(out, "bwrap", "an installed-but-broken bwrap must not be advertised as a usable boundary");
  });

  it("with no usable binaries on PATH, detection returns null (installed binary is not capability evidence)", async () => {
    const probe = `import(${JSON.stringify(ISOLATION_URL)}).then((m) => console.log(String(m.detectIsolation())));`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      encoding: "utf8",
      env: { PATH: "/nonexistent" },
      timeout: 60000,
    }).trim();
    assert.equal(out, "null");
  });

  it("the unshare spawn shape carries the SAME scratch-only write policy as bwrap (ro rootfs, rw scratch re-bind)", () => {
    const u = buildIsolatedSpawn("unshare", { execDir: "/s/exec", scratchDir: "/s", originalTarget: "/t", argv: ["true"] });
    const script = u.args[3]; // ["-Urnpfm", "sh", "-c", script, name, scratch, exec, ...argv]
    assert.match(script, /mount -o remount,ro,bind \//, "rootfs remounted read-only");
    assert.match(script, /remount,rw,bind "\$1"/, "only the scratch dir re-bound writable");
    assert.ok(!script.includes("/t"), "no weaker per-target bind remains");
    const b = buildIsolatedSpawn("bwrap", { execDir: "/s/exec", scratchDir: "/s", originalTarget: "/t", argv: ["true"] });
    assert.ok(b.args.includes("--ro-bind") && b.args.includes("--bind"), "bwrap shape keeps ro-bind + scratch bind");
  });

  it("an unknown mechanism throws instead of spawning unisolated", () => {
    assert.throws(
      () => buildIsolatedSpawn("nope", { execDir: "/x", scratchDir: "/x", originalTarget: "/t", argv: ["a"] }),
      /no isolation mechanism/
    );
  });
});

/* ------------------------------------------------------------------ */
/* Q665-003A — malformed and failure-bearing reports still receive PASS */
/* ------------------------------------------------------------------ */

describe("Q665-003A: closed reporter/status schemas, failure signals preclude PASS", () => {
  it("probe 1 verbatim: numFailedTestSuites:1 on a passing fixture is ERROR/INCONSISTENT_REPORT, never PASS", () => {
    const json = {
      success: true,
      numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0,
      numTotalTestSuites: 1, numPassedTestSuites: 1, numFailedTestSuites: 1,
      testResults: [{
        name: "/f/a.test.js", status: "passed",
        assertionResults: [
          { title: "a", status: "passed", fullName: "a" },
          { title: "b", status: "passed", fullName: "b" },
        ],
      }],
    };
    const r = cls(json);
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "INCONSISTENT_REPORT");
  });

  it("probe 2 verbatim: {success:true,testResults:[{}]} is ERROR/MALFORMED_REPORT — no usable file evidence, no PASS", () => {
    const r = cls({ success: true, testResults: [{}] });
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "MALFORMED_REPORT");
  });

  it("probe 3 verbatim: unknown 'crashed' file/assertion statuses are ERROR/MALFORMED_REPORT, never pending-by-default", () => {
    const json = {
      success: true,
      numTotalTests: 1, numPassedTests: 0, numFailedTests: 0, numPendingTests: 1,
      testResults: [{
        name: "/f/c.test.js", status: "crashed",
        assertionResults: [{ title: "c", status: "crashed", fullName: "c" }],
      }],
    };
    const r = cls(json);
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "MALFORMED_REPORT");
  });

  it("a genuine passing fixture still classifies PASS (no over-refusal)", () => {
    const json = parseVitestJson(readFileSync(new URL("../fixtures/vitest-pass.json", import.meta.url), "utf8"));
    const r = cls(json);
    assert.equal(r.status, "PASS");
  });

  it("a genuine load failure still classifies ERROR/SUITE_LOAD_ERROR", () => {
    const json = parseVitestJson(readFileSync(new URL("../fixtures/vitest-error.json", import.meta.url), "utf8"));
    const r = cls(json);
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "SUITE_LOAD_ERROR");
  });

  it("numFailedTestSuites>0 WITH matching failed records classifies FAIL (the signal agrees with the records)", () => {
    const json = parseVitestJson(readFileSync(new URL("../fixtures/vitest-fail.json", import.meta.url), "utf8"));
    assert.ok(json.numFailedTestSuites > 0);
    const r = classifySuiteResult({ exitCode: 1, json });
    assert.equal(r.status, "FAIL");
  });
});

/* ------------------------------------------------------------------ */
/* Q665-003B — real Vitest TODO reports falsely rejected                */
/* ------------------------------------------------------------------ */

describe("Q665-003B: distinct todo vs skipped counters", () => {
  const realTodo = loadFixtureJson("vitest-todo-skip-real.json"); // captured from REAL vitest 4.1.9

  it("the frozen REAL vitest 4.1.9 todo/skip/pass report classifies PASS with distinct counters", () => {
    assert.equal(validateReportShape(realTodo), null, "frozen real report satisfies the closed schema");
    const r = cls(realTodo);
    assert.equal(r.status, "PASS");
    assert.deepEqual(r.test_counts, { total: 3, passed: 1, failed: 0, pending: 2, skipped: 1, todo: 1 });
  });

  it("partner: a todo header that disagrees with the records is INCONSISTENT_REPORT", () => {
    const json = { ...realTodo, numTodoTests: 2 };
    const r = cls(json);
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "INCONSISTENT_REPORT");
  });

  it("partner: a pending header that disagrees with the derived skipped count is INCONSISTENT_REPORT", () => {
    const json = { ...realTodo, numPendingTests: 2 };
    const r = cls(json);
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "INCONSISTENT_REPORT");
  });

  it("partner: legacy shape without numTodoTests reconciles the combined pending bucket", () => {
    // A genuine legacy reporter: no todo tests at all, no numTodoTests
    // header — the single pending bucket covers the skipped test.
    const json = {
      success: true,
      numTotalTests: 2, numPassedTests: 1, numFailedTests: 0, numPendingTests: 1,
      testResults: [{
        name: "/f/legacy.test.js", status: "passed",
        assertionResults: [
          { title: "a", status: "passed", fullName: "a" },
          { title: "b", status: "skipped", fullName: "b" },
        ],
      }],
    };
    const r = cls(json);
    assert.equal(r.status, "PASS");
    assert.equal(r.test_counts.pending, 1, "pending stays the documented combined non-executed count");
    assert.equal(r.test_counts.skipped, 1);
    assert.equal(r.test_counts.todo, 0);
  });

  it("a modern header that omits numTodoTests while reporting todos is INCONSISTENT (the header must declare its counting shape)", () => {
    const { numTodoTests, ...legacy } = realTodo; // eslint-disable-line no-unused-vars
    const r = cls(legacy);
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "INCONSISTENT_REPORT");
  });

  it("deriveCounts keeps todo and skipped distinct (equivalent units, not combined pending)", () => {
    const d = deriveCounts(realTodo);
    assert.equal(d.counts.todo, 1);
    assert.equal(d.counts.skipped, 1);
    assert.equal(d.counts.pending, 2);
  });
});
