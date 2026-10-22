/**
 * runner.js — runJob(job, options): the QA test-runner's core.
 *
 * Order of operations is the contract:
 *   1. Validate the job and CHARGE all budgets (schemas.js). An
 *      over-budget or malformed job is REFUSED before anything runs.
 *   2. Verify the target checkout's HEAD equals the job's 40-hex pin
 *      exactly (`git rev-parse HEAD`). A mismatch is REFUSED /
 *      HEAD_MISMATCH and NOTHING executes — a GO at head X never
 *      blesses head Y.
 *   3. Execute suites sequentially. Argv is constructed here —
 *      `npx vitest run <patterns> --reporter=json --outputFile <file>` —
 *      never taken from the job. The JSON report file lives in a fresh
 *      temp directory OUTSIDE the target tree; the target is treated
 *      read-only (no checkout, fetch, or writes by this runner).
 *   4. Classify each suite from its exit code + parsed JSON report and
 *      emit the deterministic advisory report.
 *
 * If vitest is not resolvable in the target (no
 * node_modules/.bin/vitest), the suite is ERROR — never skipped, never
 * passed, and npx is never allowed to fetch it from the network.
 */

import { spawn, execFile } from "node:child_process";
import { existsSync, statSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateJob, suiteTimeoutMs } from "./schemas.js";
import { parseVitestJson, classifySuiteResult } from "./classify.js";
import { refusalReport, completedReport, emptySuiteEntry } from "./report.js";

const KILL_GRACE_MS = 2_000;
const MAX_REPORT_FILE_BYTES = 32 * 1024 * 1024;

/** Resolve a checkout's HEAD via git. Returns the 40-hex string or null. */
export function resolveHead(target) {
  return new Promise((resolve) => {
    execFile("git", ["-C", target, "rev-parse", "HEAD"], { timeout: 15_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const head = String(stdout).trim();
      resolve(/^[0-9a-f]{40}$/.test(head) ? head : null);
    });
  });
}

/** Vitest is resolvable only as an installed local binary. */
export function vitestResolvable(target) {
  const bin = process.platform === "win32" ? "vitest.cmd" : "vitest";
  return existsSync(join(target, "node_modules", ".bin", bin));
}

function runSuiteProcess({ target, suite, timeoutMs, maxCapturedBytes, outFile }) {
  return new Promise((resolve) => {
    const argv = ["vitest", "run", ...suite.patterns, "--reporter=json", "--outputFile", outFile];
    let child;
    try {
      child = spawn("npx", argv, {
        cwd: target,
        shell: false,
        // Own process group (POSIX): a kill must reach the whole tree —
        // npx's child (vitest, and anything it spawns) inherits our stdio
        // pipes, so killing npx alone would leave the pipes open and the
        // suite would hang until its children exited on their own.
        detached: process.platform !== "win32",
        env: { ...process.env, CI: "1", NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ exitCode: null, signal: null, timedOut: false, outputExceeded: false, spawnError: String(e?.message ?? e) });
      return;
    }
    const killTree = (sig) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          /* already gone */
        }
      }
    };
    let captured = 0;
    let outputExceeded = false;
    let timedOut = false;
    let settled = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), KILL_GRACE_MS).unref();
    }, timeoutMs);
    const onData = (chunk) => {
      captured += chunk.length;
      if (captured > maxCapturedBytes && !outputExceeded) {
        outputExceeded = true;
        killTree("SIGKILL");
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ exitCode: null, signal: null, timedOut, outputExceeded, spawnError: String(e?.message ?? e) });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ exitCode: code, signal, timedOut, outputExceeded, spawnError: null });
    });
  });
}

async function executeSuite({ target, suite, timeoutMs, budgets, tmpRoot, index }) {
  const base = {
    id: suite.id,
    patterns: [...suite.patterns],
    timeout_ms: timeoutMs,
    exit_code: null,
    signal: null,
    reason_code: null,
    reason: null,
    test_counts: { total: 0, passed: 0, failed: 0, pending: 0 },
    failing_tests: [],
  };
  if (!vitestResolvable(target)) {
    return {
      ...base,
      status: "ERROR",
      reason_code: "VITEST_NOT_RESOLVABLE",
      reason: "vitest is not resolvable in the target checkout (node_modules/.bin/vitest missing); suite not run and never counted as a pass",
    };
  }
  const safeId = suite.id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outFile = join(tmpRoot, `suite-${index}-${safeId}.json`);
  const raw = await runSuiteProcess({
    target,
    suite,
    timeoutMs,
    maxCapturedBytes: budgets.maxCapturedBytesPerSuite,
    outFile,
  });
  let json = null;
  try {
    const st = statSync(outFile);
    if (st.isFile() && st.size <= MAX_REPORT_FILE_BYTES) {
      json = parseVitestJson(readFileSync(outFile, "utf8"));
    }
  } catch {
    json = null;
  }
  const cls = classifySuiteResult({ ...raw, json });
  return {
    ...base,
    status: cls.status,
    exit_code: raw.exitCode,
    signal: raw.signal,
    reason_code: cls.reason_code,
    reason: cls.reason,
    test_counts: cls.test_counts,
    failing_tests: cls.failing_tests,
  };
}

/**
 * Run a validated job end to end. Always resolves with a report object;
 * refusals are reports, not exceptions. options.tmpRoot may name a
 * parent directory for the per-job temp dir (defaults to os.tmpdir()).
 */
export async function runJob(job, options = {}) {
  const v = validateJob(job);
  if (!v.ok) {
    if (v.budgetExceeded) {
      return refusalReport(job, "BUDGET_EXCEEDED", v.errors);
    }
    return refusalReport(
      job,
      "INVALID_JOB",
      v.errors.map((e) => ({ code: e.code, path: e.path, message: e.message }))
    );
  }
  const budgets = v.budgets;

  const target = job.target;
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return refusalReport(job, "TARGET_NOT_FOUND", [
      { code: "TARGET_NOT_FOUND", path: "$.target", message: `target checkout "${target}" does not exist or is not a directory` },
    ]);
  }

  const head = await resolveHead(target);
  if (head === null) {
    return refusalReport(job, "HEAD_UNRESOLVABLE", [
      { code: "HEAD_UNRESOLVABLE", path: "$.target", message: "could not resolve HEAD via `git rev-parse HEAD` in the target checkout" },
    ]);
  }
  if (head !== job.head_pin) {
    return refusalReport(
      job,
      "HEAD_MISMATCH",
      [
        {
          code: "HEAD_MISMATCH",
          path: "$.head_pin",
          message: `checkout HEAD ${head} does not equal job pin ${job.head_pin}; nothing executed`,
        },
      ],
      head
    );
  }

  const tmpRoot = mkdtempSync(join(options.tmpRoot ?? tmpdir(), "qa-test-runner-"));
  try {
    const entries = [];
    const jobStart = Date.now();
    let jobBudgetExhausted = false;
    for (const [i, suite] of job.suites.entries()) {
      const elapsed = Date.now() - jobStart;
      const remaining = budgets.perJobTimeoutMs - elapsed;
      if (jobBudgetExhausted || remaining <= 0) {
        jobBudgetExhausted = true;
        entries.push({
          ...emptySuiteEntry(suite, "SKIPPED_BUDGET", "JOB_TIMEOUT_EXHAUSTED", "per-job timeout budget exhausted before this suite started; not executed"),
          timeout_ms: suiteTimeoutMs(job, suite, budgets),
        });
        continue;
      }
      const timeoutMs = Math.min(suiteTimeoutMs(job, suite, budgets), remaining);
      entries.push(await executeSuite({ target, suite, timeoutMs, budgets, tmpRoot, index: i }));
    }
    return completedReport(job, head, entries);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
